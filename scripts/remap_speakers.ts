import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  // Find all episodes that still have "Sprecher X" style speaker labels
  const { data: episodes } = await supabase.from('episodes').select('id, title');
  if (!episodes) return;

  let totalUpdated = 0;
  let totalEpisodes = 0;

  for (const ep of episodes) {
    // Get all chunks for this episode
    const { data: chunks } = await supabase
      .from('transcript_chunks')
      .select('id, speaker, content, start_time')
      .eq('episode_id', ep.id)
      .order('start_time', { ascending: true });

    if (!chunks || chunks.length === 0) continue;

    // Check if this episode still has unmapped speakers
    const unmappedSpeakers = Array.from(
      new Set(
        chunks
          .filter(c => /^Sprecher \d+$/i.test(c.speaker))
          .map(c => c.speaker)
      )
    ).sort();

    if (unmappedSpeakers.length === 0) {
      console.log(`✓ "${ep.title}" — already mapped, skipping.`);
      continue;
    }

    console.log(`\n🔄 Remapping speakers for: "${ep.title}" (${chunks.length} chunks)`);
    console.log(`  Unmapped speakers found: ${unmappedSpeakers.join(', ')}`);
    totalEpisodes++;

    // Build speaker sample: first 20 chunks + spread
    const opening = chunks.slice(0, 20);
    const step = Math.max(1, Math.floor(chunks.length / 20));
    const spread: typeof chunks = [];
    for (let i = 20; i < chunks.length; i += step) {
      spread.push(chunks[i]);
      if (spread.length >= 20) break;
    }
    const sample = [...opening, ...spread];

    const sampleText = sample
      .map(c => `[${c.speaker}]: "${c.content}"`)
      .join('\n');

    const prompt = `Du bist ein Experte für den ZEIT-Podcast "Servus. Grüezi. Hallo." mit diesen Moderatoren:
- Matthias Daum (Schweizer, Zürich, Bern, "bei uns in der Schweiz")
- Florian Gasser (Österreicher, Wien, Graz, "bei uns in Österreich")  
- Lenz Jacobsen (Deutscher, Berlin, "bei uns in Deutschland")

WICHTIG: Am Anfang begrüßen sich die Hosts namentlich z.B. "Hallo Florian, hallo Lenz!"

Analysiere dieses Transkript-Fragment und bestimme die Sprecherzuordnung für die folgenden unmapped Sprecher:
${unmappedSpeakers.map(s => `- ${s}`).join('\n')}

Gib NUR ein JSON zurück, das genau diese unmapped Sprecher als Keys enthält. Ordne jeden Sprecher entweder einem der Hosts ("Matthias Daum", "Florian Gasser", "Lenz Jacobsen") oder "Gast" (falls es ein Gast ist) zu.
Beispiel:
{
  ${unmappedSpeakers.map(s => `"${s}": "Matthias Daum"`).join(',\n  ')}
}`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      });
      
      const mapping: Record<string, string> = JSON.parse(response.choices[0].message.content || '{}');
      console.log('  Mapping:', mapping);

      // Update chunks in DB by ID to leverage primary key index and avoid timeouts
      let updated = 0;
      for (const [speakerKey, realName] of Object.entries(mapping)) {
        if (!realName || realName === speakerKey) continue;
        if (!unmappedSpeakers.includes(speakerKey)) continue;

        const idsToUpdate = chunks
          .filter(c => c.speaker === speakerKey)
          .map(c => c.id);

        if (idsToUpdate.length === 0) continue;

        let successCount = 0;
        const concurrency = 15; // 15 parallel workers updating single rows
        let currentIndex = 0;

        const workers = Array.from({ length: concurrency }, async () => {
          while (currentIndex < idsToUpdate.length) {
            const idx = currentIndex;
            currentIndex++;
            const id = idsToUpdate[idx];
            if (!id) break;

            let retries = 3;
            while (retries > 0) {
              const { error } = await supabase
                .from('transcript_chunks')
                .update({ speaker: realName })
                .eq('id', id);

              if (!error) {
                successCount++;
                break;
              }

              retries--;
              if (retries === 0) {
                console.error(`    ❌ Error updating chunk ${id}:`, error.message);
              } else {
                await new Promise(r => setTimeout(r, 500));
              }
            }
          }
        });

        await Promise.all(workers);
        updated += successCount;
        console.log(`  ✓ ${speakerKey} → ${realName} (${successCount} chunks)`);
      }
      totalUpdated += updated;
    } catch (err: any) {
      console.error(`  Failed for "${ep.title}":`, err.message);
    }

    // Small delay to avoid OpenAI rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== Done! Updated ${totalUpdated} chunks across ${totalEpisodes} episodes. ===`);
}

main().catch(console.error);
