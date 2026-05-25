import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

dotenv.config({ path: '.env.local' });

const CACHE_FILE = path.join(process.cwd(), 'scratch', 'processed_episodes.json');

// Simple logger to avoid interleaved output from parallel tasks
class EpisodeLogger {
  private lines: string[] = [];
  
  log(message: string) {
    this.lines.push(message);
  }
  
  error(message: string) {
    this.lines.push(`❌ ${message}`);
  }
  
  warn(message: string) {
    this.lines.push(`⚠️ ${message}`);
  }
  
  flush() {
    console.log(this.lines.join('\n'));
  }
}

// Load cache of processed episodes
function loadProcessedEpisodes(): Set<string> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf8');
      const list = JSON.parse(data);
      if (Array.isArray(list)) {
        return new Set(list);
      }
    }
  } catch (err: any) {
    console.error('Warning: Failed to load processed episodes cache:', err.message);
  }
  return new Set();
}

// Save cache of processed episodes
function saveProcessedEpisode(episodeId: string, processedSet: Set<string>) {
  try {
    processedSet.add(episodeId);
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Array.from(processedSet), null, 2), 'utf8');
  } catch (err: any) {
    console.error('Warning: Failed to save processed episodes cache:', err.message);
  }
}

async function main() {
  const customFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
    return fetch(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timeoutId);
    });
  };

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    global: {
      fetch: customFetch
    }
  });
  // Initialize OpenAI with a default timeout of 20 seconds
  const openai = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY!,
    timeout: 20000 
  });

  console.log('Fetching all episodes...');
  const { data: episodes, error: epError } = await supabase
    .from('episodes')
    .select('id, title')
    .order('pub_date', { ascending: false });

  if (epError || !episodes) {
    console.error('Error fetching episodes:', epError);
    return;
  }

  const processedSet = loadProcessedEpisodes();
  console.log(`Found ${episodes.length} episodes total. Already processed: ${processedSet.size}`);
  
  const remainingEpisodes = episodes.filter(ep => !processedSet.has(ep.id));
  console.log(`Remaining episodes to process: ${remainingEpisodes.length}`);

  if (remainingEpisodes.length === 0) {
    console.log('All episodes have already been processed! Verification complete.');
    return;
  }

  // Fetch all chunks upfront with pagination to avoid slow sequential scans and database timeouts
  console.log('Fetching all transcript chunks upfront (paginated)...');
  const startFetch = Date.now();
  const allChunks: any[] = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    console.log(`  Fetching chunks ${from} to ${from + pageSize - 1}...`);
    const { data, error } = await supabase
      .from('transcript_chunks')
      .select('id, episode_id, speaker, content, start_time')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error('Error fetching chunk page:', error.message);
      return;
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allChunks.push(...data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        from += pageSize;
      }
    }
  }

  console.log(`Fetched ${allChunks.length} chunks in ${Date.now() - startFetch}ms. Grouping in memory...`);

  // Group chunks by episode and sort by start_time
  const chunksByEpisode: Record<string, typeof allChunks> = {};
  for (const chunk of allChunks) {
    if (!chunksByEpisode[chunk.episode_id]) {
      chunksByEpisode[chunk.episode_id] = [];
    }
    chunksByEpisode[chunk.episode_id].push(chunk);
  }

  for (const epId of Object.keys(chunksByEpisode)) {
    chunksByEpisode[epId].sort((a, b) => Number(a.start_time) - Number(b.start_time));
  }

  let totalChunksUpdated = 0;
  let finishedCount = 0;

  // Process remaining episodes with a concurrency limit of 1
  const concurrencyLimit = 1;
  let activeIndex = 0;

  const processNextEpisode = async (): Promise<void> => {
    while (activeIndex < remainingEpisodes.length) {
      const idx = activeIndex;
      activeIndex++;
      const ep = remainingEpisodes[idx];
      if (!ep) break;

      const logger = new EpisodeLogger();
      const currentNumber = episodes.length - remainingEpisodes.length + idx + 1;
      logger.log(`\n[${currentNumber}/${episodes.length}] Processing: "${ep.title}" (ID: ${ep.id})`);

      try {
        const chunks = chunksByEpisode[ep.id] || [];

        if (chunks.length === 0) {
          logger.warn(`No chunks found in DB.`);
          saveProcessedEpisode(ep.id, processedSet);
          logger.flush();
          continue;
        }

        const uniqueSpeakers = Array.from(new Set(chunks.map(c => c.speaker))).sort();
        logger.log(`  Current unique speakers in DB: ${uniqueSpeakers.join(', ')}`);

        // Anonymize current speakers
        const speakerToPlaceholder: Record<string, string> = {};
        const placeholderToSpeaker: Record<string, string> = {};
        uniqueSpeakers.forEach((sp, sIdx) => {
          const placeholder = `Sprecher ${String.fromCharCode(65 + sIdx)}`;
          speakerToPlaceholder[sp] = placeholder;
          placeholderToSpeaker[placeholder] = sp;
        });

        // Build the sample text for OpenAI (opening 20 chunks + 20 spread chunks)
        const opening = chunks.slice(0, 20);
        const step = Math.max(1, Math.floor(chunks.length / 20));
        const spread: typeof chunks = [];
        for (let i = 20; i < chunks.length; i += step) {
          spread.push(chunks[i]);
          if (spread.length >= 20) break;
        }
        const sample = [...opening, ...spread];
        const sampleText = sample
          .map(c => `[${speakerToPlaceholder[c.speaker]}] (${c.start_time}s): "${c.content}"`)
          .join('\n');

        const prompt = `Du bist ein Experte für den deutschen ZEIT-Podcast "Servus. Grüezi. Hallo." mit den folgenden drei Moderatoren:
- Matthias Daum (Schweizer, sagt "Grüezi", redet über die Schweiz/Zürich/Bern, sagt "bei uns in der Schweiz")
- Florian Gasser (Österreicher, sagt "Servus", redet über Österreich/Wien/Tirol, sagt "bei uns in Österreich")
- Lenz Jacobsen (Deutscher, sagt "Hallo", redet über Deutschland/Berlin, sagt "bei uns in Deutschland")

Die Sprecher im folgenden Transkript-Ausschnitt sind anonymisiert als Sprecher A, Sprecher B, Sprecher C etc.
Deine Aufgabe ist es, für jeden Sprecher den korrekten echten Namen ("Matthias Daum", "Florian Gasser", "Lenz Jacobsen") oder "Gast" (wenn es eine andere Person/Gast ist) zu bestimmen.

Bitte wende folgende logische Deduktionsregeln an:
1. ANSPRACHE & ANTWORT:
   - Wenn Sprecher X sagt: "Matthias, möchtest Du gestehen..." oder "kann man das so nennen, Matthias?", dann kann Sprecher X NICHT Matthias Daum sein.
   - Wenn Sprecher Y darauf antwortet: "Zu meiner Verteidigung, es waren nur zwanzig Minuten...", dann muss Sprecher Y Matthias Daum sein (weil er sich verteidigt).
2. LÄNDERSPEZIFISCHE THEMEN & WORTWAHL:
   - Wer über "wir stehen in der Schweiz bei neun Komma ein Millionen" oder Schweizer Abstimmungen/Themen spricht, ist der Schweizer (Matthias Daum).
   - Wer über die deutsche Politik (CSU, Seehofer, Olaf Scholz, Deutschlandtakt, Bundestag) spricht, ist der Deutsche (Lenz Jacobsen).
   - Wer über österreichische Themen (Traiskirchen, Asylwerber, Simone Brunner, Nationalrat) spricht oder österreichische Grammatik verwendet ("ihr habt's gemeinsam einen Text geschrieben"), ist der Österreicher (Florian Gasser).
3. VORSICHT BEI DIARISIERUNGS-MISCHUNG:
   - Kurze Begrüßungsworte ("Servus", "Grüezi", "Hallo") können von der Spracherkennung manchmal falsch zugeordnet oder mit dem Folgesatz eines anderen Sprechers verschmolzen werden. Nutze daher längere Redebeiträge zur sicheren Identifikation!

Transkript-Ausschnitt:
${sampleText}

Gib das Ergebnis als JSON-Objekt zurück mit folgendem Format:
{
  "reasoning": "Detaillierte Schritt-für-Schritt-Deduktion für jeden einzelnen Sprecher basierend auf den obigen Regeln.",
  "mapping": {
    "Sprecher A": "Florian Gasser / Lenz Jacobsen / Matthias Daum / Gast",
    "Sprecher B": "Florian Gasser / Lenz Jacobsen / Matthias Daum / Gast",
    "Sprecher C": "Florian Gasser / Lenz Jacobsen / Matthias Daum / Gast"
  }
}
`;

        let finalMapping: Record<string, string> = {};
        let openaiSuccess = false;
        let apiRetries = 3;

        while (apiRetries > 0 && !openaiSuccess) {
          try {
            const response = await openai.chat.completions.create({
              model: 'gpt-4o',
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            });

            const rawContent = response.choices[0].message.content || '{}';
            const data = JSON.parse(rawContent);
            const rawMapping: Record<string, string> = data.mapping || {};
            logger.log(`  Raw OpenAI Mapping: ${JSON.stringify(rawMapping)}`);

            const normalizeKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

            const normalizedPlaceholderToSpeaker: Record<string, string> = {};
            for (const [placeholder, sp] of Object.entries(placeholderToSpeaker)) {
              normalizedPlaceholderToSpeaker[normalizeKey(placeholder)] = sp;
            }

            for (const [placeholder, realName] of Object.entries(rawMapping)) {
              let norm = normalizeKey(placeholder);
              if (norm.length === 1 && norm >= 'a' && norm <= 'z') {
                norm = 'sprecher' + norm;
              }
              const originalSpeaker = normalizedPlaceholderToSpeaker[norm];
              if (originalSpeaker) {
                finalMapping[originalSpeaker] = realName;
              }
            }
            openaiSuccess = true;
          } catch (err: any) {
            apiRetries--;
            logger.warn(`OpenAI call failed (retries left: ${apiRetries}): ${err.message}`);
            if (apiRetries > 0) {
              await new Promise(r => setTimeout(r, 2000));
            }
          }
        }

        if (!openaiSuccess) {
          logger.error(`Failed to resolve mapping for "${ep.title}" after all retries. Skipping.`);
          logger.flush();
          continue;
        }

        logger.log(`  Resolved mapping: ${JSON.stringify(finalMapping, null, 2)}`);

        // Identify which speakers actually need updates
        const updatesNeeded: { from: string; to: string; count: number }[] = [];
        for (const [currentName, correctName] of Object.entries(finalMapping)) {
          if (currentName !== correctName && correctName) {
            const count = chunks.filter(c => c.speaker === currentName).length;
            if (count > 0) {
              updatesNeeded.push({ from: currentName, to: correctName, count });
            }
          }
        }

        if (updatesNeeded.length === 0) {
          logger.log('  ✓ No updates needed for this episode.');
          saveProcessedEpisode(ep.id, processedSet);
          logger.flush();
          continue;
        }

        logger.log(`  Updating speakers in database:`);
        for (const item of updatesNeeded) {
          logger.log(`    - "${item.from}" -> "${item.to}" (${item.count} chunks)`);
        }

        let epUpdatedCount = 0;
        let updateFailed = false;

        const updateInBatches = async (ids: string[], newSpeaker: string): Promise<boolean> => {
          const batchSize = 10;
          for (let start = 0; start < ids.length; start += batchSize) {
            const batchIds = ids.slice(start, start + batchSize);
            let dbRetries = 3;
            let success = false;
            while (dbRetries > 0) {
              const { error } = await supabase
                .from('transcript_chunks')
                .update({ speaker: newSpeaker })
                .in('id', batchIds);

              if (!error) {
                success = true;
                break;
              }

              dbRetries--;
              logger.warn(`Failed to update batch (size ${batchIds.length}, retries left: ${dbRetries}): ${error.message}`);
              if (dbRetries > 0) {
                await new Promise(r => setTimeout(r, 1000));
              }
            }
            if (!success) {
              return false;
            }
          }
          return true;
        };

        // Step 1: Update to unique temp names to avoid clashing when swapping speaker roles
        for (let i = 0; i < updatesNeeded.length; i++) {
          if (updateFailed) break;
          const item = updatesNeeded[i];
          const tempSpeakerName = `Temp_${ep.id.substring(0, 8)}_${i}`;

          const idsToUpdate = chunks
            .filter(c => c.speaker === item.from)
            .map(c => c.id);

          if (idsToUpdate.length === 0) {
            continue;
          }

          const success = await updateInBatches(idsToUpdate, tempSpeakerName);
          if (!success) {
            updateFailed = true;
          }
        }

        // Step 2: Update from temp names to their final correct host names
        for (let i = 0; i < updatesNeeded.length; i++) {
          if (updateFailed) break;
          const item = updatesNeeded[i];
          const tempSpeakerName = `Temp_${ep.id.substring(0, 8)}_${i}`;

          const idsToUpdate = chunks
            .filter(c => c.speaker === item.from)
            .map(c => c.id);

          if (idsToUpdate.length === 0) {
            continue;
          }

          const success = await updateInBatches(idsToUpdate, item.to);
          if (success) {
            epUpdatedCount += idsToUpdate.length;
          } else {
            updateFailed = true;
          }
        }

        if (!updateFailed) {
          totalChunksUpdated += epUpdatedCount;
          logger.log(`  ✓ Episode update complete. Updated ${epUpdatedCount} chunks.`);
          saveProcessedEpisode(ep.id, processedSet);
        } else {
          logger.error(`Database updates failed. Skipping caching so it will retry next time.`);
        }
      } catch (err: any) {
        logger.error(`Unexpected error processing episode: ${err.message}`);
      }

      logger.flush();
      finishedCount++;
    }
  };

  // Launch parallel episode processing workers
  const pool = Array.from({ length: concurrencyLimit }, () => processNextEpisode());
  await Promise.all(pool);

  console.log(`\n=== Remapping Finished! Total updated chunks: ${totalChunksUpdated} ===`);
}

main().catch(console.error);
