import { query } from '../src/lib/db';
import Parser from 'rss-parser';
import { OpenAI } from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from .env.local or process environment
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const RSS_FEED_URL = process.env.RSS_FEED_URL || 'https://feeds.simplecast.com/br4J_MDH';

interface Utterance {
  start: number;
  end: number;
  speaker: string | number;
  transcript: string;
}

interface Chunk {
  speaker: string;
  start_time: number;
  end_time: number;
  content: string;
}

// Convert duration string "HH:MM:SS" or "MM:SS" or raw seconds to seconds integer
function parseDuration(durationStr?: string): number {
  if (!durationStr) return 0;
  if (!isNaN(Number(durationStr))) return Math.round(Number(durationStr));
  
  const parts = durationStr.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  
  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

// Helper to group raw word objects into chunks by speaker and timing gap
function groupWordsIntoChunks(words: any[]): Chunk[] {
  const chunks: Chunk[] = [];
  if (!words || words.length === 0) return chunks;

  let currentChunk: {
    speaker: string;
    start_time: number;
    end_time: number;
    wordsList: string[];
  } | null = null;

  for (const w of words) {
    const speakerLabel = `Sprecher ${w.speaker !== undefined ? w.speaker : '0'}`;
    const wordText = w.punctuated_word || w.word;
    if (!wordText) continue;
    
    if (!currentChunk) {
      currentChunk = {
        speaker: speakerLabel,
        start_time: w.start,
        end_time: w.end,
        wordsList: [wordText]
      };
    } else {
      const speakerChanged = currentChunk.speaker !== speakerLabel;
      const pauseDuration = w.start - currentChunk.end_time;
      const segmentTooLong = currentChunk.wordsList.length >= 80;

      if (speakerChanged || pauseDuration > 2.0 || segmentTooLong) {
        // Save current chunk
        chunks.push({
          speaker: currentChunk.speaker,
          start_time: currentChunk.start_time,
          end_time: currentChunk.end_time,
          content: currentChunk.wordsList.join(' ')
        });
        // Start new chunk
        currentChunk = {
          speaker: speakerLabel,
          start_time: w.start,
          end_time: w.end,
          wordsList: [wordText]
        };
      } else {
        // Continue current chunk
        currentChunk.wordsList.push(wordText);
        currentChunk.end_time = w.end;
      }
    }
  }

  if (currentChunk) {
    chunks.push({
      speaker: currentChunk.speaker,
      start_time: currentChunk.start_time,
      end_time: currentChunk.end_time,
      content: currentChunk.wordsList.join(' ')
    });
  }

  return chunks;
}

// Helper to chunk utterances by speaker and word limit
function chunkUtterances(utterances: Utterance[]): Chunk[] {
  const chunks: Chunk[] = [];
  let currentChunk: {
    speaker: string;
    start_time: number;
    end_time: number;
    transcriptParts: string[];
    wordCount: number;
  } | null = null;

  for (const utt of utterances) {
    const speakerLabel = `Sprecher ${utt.speaker}`;
    const text = utt.transcript.trim();
    if (!text) continue;
    const wordCount = text.split(/\s+/).length;

    if (!currentChunk) {
      currentChunk = {
        speaker: speakerLabel,
        start_time: utt.start,
        end_time: utt.end,
        transcriptParts: [text],
        wordCount: wordCount
      };
    } else if (currentChunk.speaker === speakerLabel && currentChunk.wordCount + wordCount < 90) {
      currentChunk.transcriptParts.push(text);
      currentChunk.end_time = utt.end;
      currentChunk.wordCount += wordCount;
    } else {
      chunks.push({
        speaker: currentChunk.speaker,
        start_time: currentChunk.start_time,
        end_time: currentChunk.end_time,
        content: currentChunk.transcriptParts.join(' ')
      });
      currentChunk = {
        speaker: speakerLabel,
        start_time: utt.start,
        end_time: utt.end,
        transcriptParts: [text],
        wordCount: wordCount
      };
    }
  }

  if (currentChunk) {
    chunks.push({
      speaker: currentChunk.speaker,
      start_time: currentChunk.start_time,
      end_time: currentChunk.end_time,
      content: currentChunk.transcriptParts.join(' ')
    });
  }

  return chunks;
}

// Automatically resolve speaker identities using LLM semantic heuristics on a sample of chunks
async function resolveSpeakerNames(chunks: Chunk[], openai: OpenAI | null): Promise<Record<string, string>> {
  const mapping: Record<string, string> = {};
  if (!openai || chunks.length === 0) return mapping;

  console.log('Analyzing speaker dialogue patterns with OpenAI to identify hosts...');

  const speakerLabels = Array.from(new Set(chunks.map(c => c.speaker))).sort();
  
  // Strategy: take first 20 chunks (hosts greet each other by name at the start)
  // + up to 25 chunks spread across the episode (for geographic context clues)
  const openingChunks = chunks.slice(0, 20);
  const step = Math.max(1, Math.floor(chunks.length / 25));
  const spreadChunks: typeof chunks = [];
  for (let i = 20; i < chunks.length; i += step) {
    spreadChunks.push(chunks[i]);
    if (spreadChunks.length >= 25) break;
  }
  const sampleChunks = [...openingChunks, ...spreadChunks];

  const sampleText = sampleChunks
    .map(c => `[${c.speaker}]: "${c.content}"`)
    .join('\n');

  const prompt = `
Du bist ein Experte für den ZEIT-Podcast "Servus. Grüezi. Hallo." mit den drei festen Moderatoren:
- Matthias Daum (Schweizer, nennt Orte wie Zürich, Bern, Genf, sagt "bei uns in der Schweiz")
- Florian Gasser (Österreicher, nennt Orte wie Wien, Graz, Innsbruck, sagt "bei uns in Österreich")
- Lenz Jacobsen (Deutscher, nennt Orte wie Berlin, Hamburg, Deutschland, sagt "bei uns in Deutschland")

Manchmal gibt es Gäste oder Vertretungen (z. B. wenn einer der drei fehlt).

WICHTIG: Am Anfang einer Episode begrüßen sich die Hosts fast immer namentlich, z. B.:
"Hallo Florian, hallo Lenz!" — das ist der stärkste Hinweis auf die Sprecherzuordnung.

Analysiere das folgende Transkript-Fragment sorgfältig und ordne die Sprecherzuordnung für alle erkannten Sprecher zu:
${speakerLabels.map(s => `- ${s}`).join('\n')}

Transkript-Ausschnitt (Anfang der Episode + weitere Stellen):
${sampleText}

Gib das Ergebnis AUSSCHLIESSLICH als JSON-Objekt zurück. Ordne jedem Sprecherlabel den echten Namen ("Matthias Daum", "Florian Gasser", "Lenz Jacobsen") oder "Gast" (falls es ein Gast oder eine andere Person ist) zu.
Beispiel:
{
  ${speakerLabels.map(s => `"${s}": "Matthias Daum"`).join(',\n  ')}
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const resultText = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(resultText);
    
    console.log('Detected speaker mapping:', parsed);
    return parsed;
  } catch (err: any) {
    console.error('Failed to resolve speaker names automatically:', err.message);
    return {};
  }
}

// Chronological LLM speaker validation/correction on chunks
async function correctMergedSpeakers(chunks: Chunk[], openai: OpenAI | null): Promise<Chunk[]> {
  if (!openai || chunks.length === 0) return chunks;

  console.log('Running chronological LLM speaker validation/correction on chunks...');
  const batchSize = 35;
  const contextOverlap = 3;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const startIdx = i;
    const endIdx = Math.min(chunks.length, i + batchSize);
    const currentBatch = chunks.slice(startIdx, endIdx);

    const prevContext = startIdx > 0
      ? chunks.slice(Math.max(0, startIdx - contextOverlap), startIdx)
      : [];

    const promptContext = prevContext
      .map(c => `[CONTEXT] [${c.speaker}] (${c.start_time}s): "${c.content}"`)
      .join('\n');

    const promptBatch = currentBatch
      .map((c, idx) => `[INDEX: ${startIdx + idx}] (Current: ${c.speaker}) (${c.start_time}s): "${c.content}"`)
      .join('\n');

    const prompt = `Du bist ein Sprachexperte für den wöchentlichen ZEIT-Podcast "Servus. Grüezi. Hallo." mit den drei Moderatoren:
- Matthias Daum (Schweizer, sagt "Grüezi", redet über Schweizer Themen wie SRG, Zürich, Abstimmungen, Kantone, sagt "bei uns in der Schweiz")
- Florian Gasser (Österreicher, sagt "Servus", redet über Österreich, Wien, Bundesländer, die ÖVP/FPÖ, sagt "bei uns in Österreich", nutzt Worte wie "bissel", "Schas", "Jänner")
- Lenz Jacobsen (Deutscher, sagt "Hallo", redet über Deutschland, Berlin, die Ampel, Scholz, CDU, sagt "bei uns in Deutschland")

Manchmal gibt es auch Gäste oder Werbung (diese sollten als "Gast" klassifiziert werden).

Aufgrund von Fehlern bei der automatischen Spracherkennung (Diarisierung) wurden manche Sprecher fälschlicherweise zusammengelegt (z. B. wurden Sätze von Matthias Daum oder Lenz Jacobsen als Florian Gasser markiert). Deine Aufgabe ist es, für jeden Redebeitrag (gekennzeichnet durch INDEX) den korrekten Sprecher zu bestimmen.

Achte besonders auf den Gesprächsfluss:
- Wenn ein Moderator eine Frage stellt (z. B. "Matthias, was meinst du dazu?"), antwortet in der Regel Matthias Daum im nächsten Beitrag.
- Wenn consecutive Beiträge des gleichen Sprechers miteinander diskutieren, liegt oft ein Diarisierungsfehler vor und einer der Beiträge gehört einem anderen Host.
- Achte auf die landesspezifischen Bezüge und typische Dialektwörter.

Hier ist der vorherige Kontext (nur zur Information, nicht zu ändern):
\${promptContext}

Hier sind die zu klassifizierenden Beiträge:
\${promptBatch}

Gib ein JSON-Objekt zurück, das für jeden INDEX aus den zu klassifizierenden Beiträgen den korrekten Namen enthält. Das Format MUSS exakt so aussehen:
{
  "reasoning": "Kurze Begründung für schwierige Fälle",
  "corrections": {
    "INDEX_Zahl_1": "Matthias Daum",
    "INDEX_Zahl_2": "Florian Gasser",
    "INDEX_Zahl_3": "Lenz Jacobsen",
    "INDEX_Zahl_4": "Gast"
  }
}
Ordne JEDEM INDEX in den corrections den korrekten Namen zu! Verwende nur die vier exakten Werte: "Matthias Daum", "Florian Gasser", "Lenz Jacobsen", "Gast".`;

    let success = false;
    let retries = 3;

    while (retries > 0 && !success) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        });

        const rawContent = response.choices[0].message.content || '{}';
        const parsed = JSON.parse(rawContent);
        const corrections: Record<string, string> = parsed.corrections || {};

        for (let idx = startIdx; idx < endIdx; idx++) {
          const correctSpeaker = corrections[idx.toString()];
          if (correctSpeaker && correctSpeaker !== chunks[idx].speaker) {
            console.log(`  🔄 LLM correction at index \${idx} (\${chunks[idx].start_time}s): "\${chunks[idx].speaker}" ➔ "\${correctSpeaker}"`);
            chunks[idx].speaker = correctSpeaker;
          }
        }
        success = true;
      } catch (err: any) {
        retries--;
        console.error(`  ⚠️ Error in LLM speaker validation (retries left: \${retries}):`, err.message);
        if (retries > 0) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
  }

  return chunks;
}


// Mock transcription generator for testing
function generateMockUtterances(title: string, durationSeconds: number): Utterance[] {
  const hosts = ['0', '1', '2']; // Mapped to Matthias, Florian, Lenz
  const mockStatements = [
    "Servus, Grüezi und Hallo zu einer neuen Ausgabe unseres transalpinen Podcasts.",
    "Hallo Matthias, hallo Lenz! Diese Woche wollen wir uns intensiv mit der Frage der Energiewende beschäftigen.",
    "Genau, besonders die Windkraft in den Alpen sorgt ja in Österreich, der Schweiz und Deutschland für viel Diskussionsstoff.",
    "Matthias, wie sieht denn die Lage in der Schweiz aus? Da gibt es doch starke Widerstände, oder?",
    "Ja, Florian. In der Schweiz blockieren Naturschutzverbände und lokale Initiativen viele geplante Windparks.",
    "Aber das Bundesgericht hat kürzlich einige Urteile gefällt, die den Bau von Windrädern in alpinen Regionen erleichtern könnten.",
    "Bei uns in Österreich ist das ähnlich. Auf den Kämmen der Steiermark stehen schon einige Räder, aber im Westen ist es fast unmöglich.",
    "In Deutschland wird ja auch gestritten. Die 10H-Regel in Bayern war lange Zeit ein großes Hindernis.",
    "Mittlerweile wird aber versucht, diese Regeln aufzuweichen, um den Ausbau der erneuerbaren Energien zu beschleunigen.",
    "Wir müssen uns fragen: Was wiegt schwerer? Der Landschaftsschutz oder die Notwendigkeit von grünem Strom?",
    "Das ist eine klassische transalpine Abwägung. Und damit kommen wir auch gleich zu unserem zweiten Thema heute...",
    "Vielen Dank für diesen Einblick. Wir hören uns nächste Woche wieder bei Servus. Grüezi. Hallo!"
  ];

  const utterances: Utterance[] = [];
  let currentTime = 5.0; // start after 5 seconds intro
  const segmentDuration = durationSeconds / (mockStatements.length + 2);

  for (let i = 0; i < mockStatements.length; i++) {
    const speaker = hosts[i % hosts.length];
    const duration = Math.min(segmentDuration, 15 + Math.random() * 10);
    
    utterances.push({
      start: parseFloat(currentTime.toFixed(2)),
      end: parseFloat((currentTime + duration).toFixed(2)),
      speaker: speaker,
      transcript: mockStatements[i]
    });
    
    currentTime += duration + 1.0; // add a small pause
  }

  return utterances;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArgIndex = args.indexOf('--limit');
  const limit = limitArgIndex !== -1 ? parseInt(args[limitArgIndex + 1], 10) : null;
  const episodeArgIndex = args.indexOf('--episode');
  const targetEpisodeId = episodeArgIndex !== -1 ? args[episodeArgIndex + 1] : null;
  const force = args.includes('--force');
  const preScan = args.includes('--pre-scan');

  console.log('--- STARTING INGESTION PIPELINE ---');
  console.log(`Limit: ${limit !== null ? limit : 'None'}`);
  console.log(`Specific Episode: ${targetEpisodeId || 'None'}`);
  console.log(`Force Update: ${force}`);
  console.log(`Pre-Scan / Dry Run: ${preScan}`);

  // Check API keys
  const hasDb = !!process.env.DATABASE_URL;
  const hasDeepgram = !!process.env.DEEPGRAM_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  console.log('\n--- ENVIRONMENT CHECK ---');
  console.log(`Database Configured: ${hasDb ? 'YES' : 'NO (Mock mode for database)'}`);
  console.log(`Deepgram API Key: ${hasDeepgram ? 'YES' : 'NO (Generating mock transcripts)'}`);
  console.log(`OpenAI API Key: ${hasOpenAI ? 'YES' : 'NO (Generating mock vector embeddings)'}`);
  console.log('-------------------------\n');

  const openai = hasOpenAI
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

  // Load pre-scraped ZEIT episodes
  const scrapedPath = path.resolve(process.cwd(), 'scripts', 'scraped_zeit_episodes.json');
  let scrapedEpisodes: any[] = [];
  if (fs.existsSync(scrapedPath)) {
    try {
      scrapedEpisodes = JSON.parse(fs.readFileSync(scrapedPath, 'utf8'));
      console.log(`Loaded ${scrapedEpisodes.length} scraped ZEIT episodes from ${scrapedPath}`);
    } catch (err: any) {
      console.error(`Failed to load scraped episodes: ${err.message}`);
    }
  } else {
    console.warn(`Scraped episodes file not found at ${scrapedPath}. Date matching will be limited.`);
  }

  // Helper function to clean titles for matching
  function cleanTitle(text: string): string {
    if (!text) return "";
    let cleaned = text.replace(/<[^>]+>/g, '');
    cleaned = cleaned.toLowerCase();
    // Strip prefixes first (before removing colons)
    cleaned = cleaned.replace(/^(alpenpodcast|jubiläum|live|live-folge|live folge|special|sonderfolge|sommerpause\s+[ivxldcm]+)\s*:?\s*/, '');
    // Strip non-alphanumeric
    cleaned = cleaned.replace(/[^a-z0-9äöüß\s]/g, ' ');
    // Collapse spaces
    return cleaned.split(/\s+/).filter(Boolean).join(' ');
  }

  // Parse RSS Feed
  console.log(`Fetching RSS feed from: ${RSS_FEED_URL}...`);
  const parser = new Parser();
  let feed;
  try {
    feed = await parser.parseURL(RSS_FEED_URL);
    console.log(`Successfully fetched feed! Found ${feed.items.length} episodes.`);
  } catch (err: any) {
    console.error('Error fetching RSS feed:', err.message);
    process.exit(1);
  }

  // Filter episodes
  let episodesToProcess = feed.items;
  if (targetEpisodeId) {
    episodesToProcess = episodesToProcess.filter(item => item.guid === targetEpisodeId || item.id === targetEpisodeId);
    if (episodesToProcess.length === 0) {
      console.error(`Episode with ID ${targetEpisodeId} not found in RSS feed.`);
      process.exit(1);
    }
  }

  // If not force mode, filter out episodes that are already in the database
  if (hasDb && !force && !targetEpisodeId) {
    console.log('Querying database to filter out already indexed episodes...');
    try {
      const existingEps = await query<{ id: string }>('SELECT id FROM episodes');
      const existingIds = new Set(existingEps.map(e => e.id));
      const beforeCount = episodesToProcess.length;
      episodesToProcess = episodesToProcess.filter(item => {
        const episodeId = item.guid || item.id || '';
        return !existingIds.has(episodeId);
      });
      console.log(`Filtered out ${beforeCount - episodesToProcess.length} already indexed episodes. ${episodesToProcess.length} pending.`);
    } catch (err: any) {
      console.error('Failed to pre-filter indexed episodes, will check during loop:', err.message);
    }
  }

  if (limit !== null) {
    episodesToProcess = episodesToProcess.slice(0, limit);
  }


  // PRE-SCAN / DRY RUN MODE
  if (preScan) {
    console.log('\n==================================================');
    console.log('             INGESTION PRE-SCAN REPORT             ');
    console.log('==================================================\n');
    console.log(`Total episodes found in RSS Feed: ${episodesToProcess.length}`);

    let indexedCount = 0;
    let pendingCount = 0;
    let pendingSeconds = 0;
    const pendingList: string[] = [];

    if (hasDb) {
      console.log('Checking database for existing episodes...');
      try {
        const existingEps = await query<{ id: string }>('SELECT id FROM episodes');
        const existingIds = new Set(existingEps.map(e => e.id));
        for (const item of episodesToProcess) {
          const episodeId = item.guid || item.id || '';
          const durationSeconds = parseDuration(item.itunes?.duration);

          if (existingIds.has(episodeId) && !force) {
            indexedCount++;
          } else {
            pendingCount++;
            pendingSeconds += durationSeconds;
            pendingList.push(`- ${item.title} (${Math.round(durationSeconds / 60)} min)`);
          }
        }
      } catch (err: any) {
        console.error('Failed to check existing episodes:', err.message);
      }
    } else {
      console.log('No database connected, listing all episodes as pending.');
      pendingCount = episodesToProcess.length;
      pendingSeconds = episodesToProcess.reduce((acc, item) => acc + parseDuration(item.itunes?.duration), 0);
    }

    const pendingHours = (pendingSeconds / 3600).toFixed(2);
    // Cost estimation: Deepgram Nova-2 is approx $0.258 per hour ($0.0043/min)
    const deepgramCost = (Number(pendingHours) * 0.258).toFixed(2);
    // Cost estimation: OpenAI text-embedding-3-small is $0.02 per 1M tokens. 
    // Approx 13k tokens (10k words) per episode * pendingCount
    const openaiCost = (pendingCount * 13000 * 0.00000002).toFixed(4);

    console.log(`\nStatus Summary:`);
    console.log(`  ✓ Already Indexed:     ${indexedCount} episodes`);
    console.log(`  ➔ Pending Ingestion:   ${pendingCount} episodes`);
    console.log(`  ➔ Total Audio Pending: ${pendingHours} hours`);
    
    console.log(`\nCost & Time Estimates:`);
    console.log(`  • Deepgram (Nova-2 API):      ~$${deepgramCost}`);
    console.log(`  • OpenAI (Embeddings API):    ~$${openaiCost}`);
    console.log(`  • Estimated Total Duration:   ~${(pendingCount * 0.75).toFixed(1)} minutes (approx 45s per episode)`);

    if (pendingList.length > 0) {
      console.log(`\nPending Ingestion List (Up to 10):`);
      pendingList.slice(0, 10).forEach(line => console.log(line));
      if (pendingList.length > 10) {
        console.log(`  ... and ${pendingList.length - 10} more.`);
      }
    }

    console.log('\n==================================================');
    console.log('To run this ingestion, execute without --pre-scan.');
    console.log('==================================================\n');
    process.exit(0);
  }

  console.log(`Processing ${episodesToProcess.length} episodes...\n`);

  for (const item of episodesToProcess) {
    const episodeId = item.guid || item.id || '';
    let title = item.title || 'Unknown Title';
    const audioUrl = item.enclosure?.url || '';
    let pubDate = item.isoDate || item.pubDate || new Date().toISOString();
    
    // Find matching scraped episode
    const normTitle = cleanTitle(title);
    let matchedEp = scrapedEpisodes.find(se => cleanTitle(se.title) === normTitle);

    if (!matchedEp && normTitle) {
      // Try substring match
      matchedEp = scrapedEpisodes.find(se => {
        const seNorm = cleanTitle(se.title);
        return seNorm && (seNorm.includes(normTitle) || normTitle.includes(seNorm));
      });
    }

    const durationSeconds = parseDuration(item.itunes?.duration);
    let description = item.contentSnippet || item.content || item.summary || '';

    // Try description matching
    if (!matchedEp && description) {
      const normDesc = cleanTitle(description).substring(0, 50);
      if (normDesc) {
        matchedEp = scrapedEpisodes.find(se => {
          const seNormDesc = cleanTitle(se.description || '').substring(0, 50);
          return seNormDesc && (seNormDesc.includes(normDesc) || normDesc.includes(seNormDesc));
        });
      }
    }

    if (matchedEp) {
      pubDate = matchedEp.pub_date || pubDate;
      if (matchedEp.title) {
        title = matchedEp.title.replace("Z+ (abopflichtiger Inhalt);", "").trim();
      }
      if (matchedEp.description) {
        description = matchedEp.description;
      }
      console.log(`  [Matched] Linked "${item.title}" to ZEIT article "${matchedEp.title}" -> Date: ${pubDate}`);
    } else {
      // Fallback for known unmatched items by order / title
      if (item.itunes?.order === "384") {
        pubDate = "2026-01-20T14:32:07.000Z";
        console.log(`  [Manual Match] Crossover episode order 384 -> Date: ${pubDate}`);
      } else if (item.itunes?.order === "263") {
        pubDate = "2019-05-20T16:00:00+02:00";
        title = "Sommerpause II: Die Ibiza-Sonderfolge";
        description = "Die Sonderfolge zur Ibiza-Affäre in Österreich aus dem Mai 2019.";
        console.log(`  [Manual Match] Ibiza Sonderfolge order 263 -> Date: ${pubDate}`);
      } else if (item.itunes?.order === "310") {
        pubDate = "2024-06-26T16:00:00+02:00";
        title = "Geht uns nicht auf den Sender";
        description = "Warum Schweizer einfacher ausländische Fernsehkanäle empfangen können als Deutsche und Österreicher.";
        console.log(`  [Manual Match] Geht uns nicht auf den Sender order 310 -> Date: ${pubDate}`);
      } else {
        console.log(`  [Unmatched] Could not find ZEIT article for "${title}", keeping feed date: ${pubDate}`);
      }
    }

    const imageUrl = item.itunes?.image || feed.image?.url || '';

    if (!episodeId) {
      console.log(`Skipping item without ID: "${title}"`);
      continue;
    }

    if (!audioUrl) {
      console.log(`Skipping episode without audio URL: "${title}" (ID: ${episodeId})`);
      continue;
    }

    console.log(`=== Processing: "${title}" (ID: ${episodeId}) ===`);

    // Check if already processed in database
    if (hasDb && !force) {
      const existingEpisode = await query<{ id: string }>('SELECT id FROM episodes WHERE id = $1', [episodeId]);
      if (existingEpisode.length > 0) {
        console.log(`Episode already exists in database. Skipping. (Use --force to re-process)`);
        continue;
      }
    }

    let chunks: Chunk[] = [];

    // Step 1: Transcription & Step 2: Chunking
    if (hasDeepgram) {
      console.log(`Requesting transcription from Deepgram for audio URL: ${audioUrl}...`);
      try {
        const queryParams = new URLSearchParams({
          model: 'nova-2',
          language: 'de',
          diarize: 'true',
          punctuate: 'true',
          utterances: 'true'
        });
        
        const response = await fetch(`https://api.deepgram.com/v1/listen?${queryParams}`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ url: audioUrl })
        });

        if (!response.ok) {
          const errMsg = await response.text();
          throw new Error(`Deepgram API returned status ${response.status}: ${errMsg}`);
        }

        const data: any = await response.json();
        const words = data.results?.channels?.[0]?.alternatives?.[0]?.words;
        
        if (words && words.length > 0) {
          console.log(`Using word-level diarization to group ${words.length} words...`);
          chunks = groupWordsIntoChunks(words);
        } else if (data.results?.utterances) {
          console.log(`Fallback: Using utterance-level diarization...`);
          const utterances = data.results.utterances.map((utt: any) => ({
            start: utt.start,
            end: utt.end,
            speaker: utt.speaker,
            transcript: utt.transcript
          }));
          chunks = chunkUtterances(utterances);
        } else {
          throw new Error('Deepgram transcript has unexpected format (no words or utterances)');
        }
        
        console.log(`Successfully chunked transcript. Total chunks: ${chunks.length}`);
      } catch (err: any) {
        console.error(`Deepgram transcription failed for "${title}":`, err.message);
        console.log(`Skipping episode "${title}" to avoid writing mock data.`);
        continue;
      }
    } else {
      console.log('Generating mock diarized transcript...');
      const utterances = generateMockUtterances(title, durationSeconds || 3600);
      chunks = chunkUtterances(utterances);
    }

    // Step 2.5: Auto-identify speakers
    const speakerMapping = await resolveSpeakerNames(chunks, openai);
    if (Object.keys(speakerMapping).length > 0) {
      console.log('Applying speaker identification mapping to chunks...');
      for (const chunk of chunks) {
        if (speakerMapping[chunk.speaker]) {
          chunk.speaker = speakerMapping[chunk.speaker];
        }
      }
    }

    // Step 2.6: Chronological LLM speaker validation/correction
    if (openai) {
      await correctMergedSpeakers(chunks, openai);
    }

    // Step 3: Vectorization & Database Insertions
    console.log(`Vectorizing chunks...`);
    const processedChunks = [];
    
    // Process in batches to avoid API rate limits
    const batchSize = 10;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      console.log(`  Processing chunk batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(chunks.length / batchSize)}...`);
      
      const batchPromises = batch.map(async (chunk) => {
        let embedding: number[] = [];
        if (openai) {
          try {
            const embResponse = await openai.embeddings.create({
              model: 'text-embedding-3-small',
              input: chunk.content,
              dimensions: 512,
              encoding_format: 'float'
            });
            embedding = embResponse.data[0].embedding;
          } catch (err: any) {
            console.error(`  Embedding generation failed for chunk: "${chunk.content.substring(0, 30)}...":`, err.message);
            // Fallback to mock embedding on error
            embedding = Array.from({ length: 512 }, () => (Math.random() - 0.5) * 0.1);
          }
        } else {
          // Mock embedding
          embedding = Array.from({ length: 512 }, () => (Math.random() - 0.5) * 0.1);
        }
        return {
          ...chunk,
          embedding
        };
      });

      const batchResults = await Promise.all(batchPromises);
      processedChunks.push(...batchResults);
    }

    // Step 4: Write to DB or write to mock local file
    if (hasDb) {
      console.log('Writing episode and chunks to database...');
      try {
        // Upsert episode
        await query(
          `INSERT INTO episodes (id, title, pub_date, audio_url, image_url, description, duration)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, pub_date=EXCLUDED.pub_date,
             audio_url=EXCLUDED.audio_url, image_url=EXCLUDED.image_url,
             description=EXCLUDED.description, duration=EXCLUDED.duration`,
          [episodeId, title, pubDate, audioUrl, imageUrl, description, durationSeconds]
        );

        // Insert chunks (delete existing if force updating)
        if (force) {
          await query('DELETE FROM transcript_chunks WHERE episode_id = $1', [episodeId]);
        }

        // Insert in smaller batches of 10 with retries to avoid statement timeouts while keeping updates extremely fast
        const chunkBatchSize = 10;
        for (let j = 0; j < processedChunks.length; j += chunkBatchSize) {
          const dbBatch = processedChunks.slice(j, j + chunkBatchSize);

          console.log(`    Ingesting chunks ${j} to ${Math.min(j + chunkBatchSize, processedChunks.length)} of ${processedChunks.length}...`);

          let retries = 3;
          let success = false;
          while (retries > 0 && !success) {
            try {
              const values: string[] = [];
              const params: any[] = [];
              dbBatch.forEach((c, i) => {
                const base = i * 6;
                values.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6}::vector)`);
                params.push(episodeId, c.speaker, c.start_time, c.end_time, c.content, `[${c.embedding.join(',')}]`);
              });
              await query(
                `INSERT INTO transcript_chunks (episode_id, speaker, start_time, end_time, content, embedding) VALUES ${values.join(',')}`,
                params
              );
              success = true;
            } catch (chunkError: any) {
              retries--;
              console.error(`    Insert failed at chunk ${j}: ${chunkError.message}. Retrying in 1.5s... (${retries} retries left)`);
              if (retries === 0) throw chunkError;
              await new Promise(resolve => setTimeout(resolve, 1500));
            }
          }

          // Tiny delay between batches to keep the database stable
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        console.log(`Successfully ingested episode "${title}" and its ${processedChunks.length} chunks!`);
      } catch (err: any) {
        console.error('Failed to write to database:', err.message);
        try {
          console.log(`Rollback: Deleting empty/incomplete episode "${title}" (ID: ${episodeId})...`);
          await query('DELETE FROM episodes WHERE id = $1', [episodeId]);
        } catch (rollbackErr: any) {
          console.error('Rollback failed:', rollbackErr.message);
        }
        writeToMockFile(episodeId, title, pubDate, audioUrl, imageUrl, description, durationSeconds, processedChunks);
      }
    } else {
      writeToMockFile(episodeId, title, pubDate, audioUrl, imageUrl, description, durationSeconds, processedChunks);
    }
  }

  // Invalidate statistics cache
  if (hasDb) {
    try {
      await query('DELETE FROM app_cache WHERE key = $1', ['stats']);
      console.log('Invalidated statistics cache.');
    } catch (err: any) {
      console.error('Failed to invalidate stats cache:', err.message);
    }
  }

  console.log('\n--- INGESTION PIPELINE COMPLETED ---');
}

function writeToMockFile(
  episodeId: string, 
  title: string, 
  pubDate: string, 
  audioUrl: string, 
  imageUrl: string, 
  description: string, 
  durationSeconds: number, 
  chunks: any[]
) {
  const dir = path.join(process.cwd(), 'scratch');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const cleanId = episodeId.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = path.join(dir, `mock_ingest_${cleanId}.json`);
  
  // Strip embeddings out of the printed console log so it doesn't clutter output,
  // but keep them in the JSON file
  const printableChunks = chunks.map(c => ({
    speaker: c.speaker,
    start_time: c.start_time,
    end_time: c.end_time,
    content: c.content,
    embedding_length: c.embedding.length
  }));

  console.log(`Writing mock data for "${title}" to local file: ${filename}...`);
  fs.writeFileSync(filename, JSON.stringify({
    episode: {
      id: episodeId,
      title,
      pub_date: pubDate,
      audio_url: audioUrl,
      image_url: imageUrl,
      description,
      duration: durationSeconds
    },
    chunks: chunks
  }, null, 2));

  console.log(`Mock Summary: Ingested episode "${title}" with ${chunks.length} chunks. (Embeddings simulated)`);
}

main().catch((err) => {
  console.error('Fatal pipeline error:', err);
  process.exit(1);
});
