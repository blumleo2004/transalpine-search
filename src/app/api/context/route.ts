import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const episodeId = searchParams.get('episode_id');
  const startTimeStr = searchParams.get('start_time');

  if (!episodeId || !startTimeStr) {
    return NextResponse.json({ error: 'Parameters episode_id and start_time are required' }, { status: 400 });
  }

  const startTime = parseFloat(startTimeStr);
  if (isNaN(startTime)) {
    return NextResponse.json({ error: 'Parameter start_time must be a valid number' }, { status: 400 });
  }

  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (hasSupabase) {
    try {
      const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      
      // 1. Fetch all chunks for this episode ordered by start_time
      const { data: chunks, error } = await supabase
        .from('transcript_chunks')
        .select('id, speaker, start_time, end_time, content')
        .eq('episode_id', episodeId)
        .order('start_time', { ascending: true });

      if (error) throw error;

      if (chunks && chunks.length > 0) {
        // 2. Find the index of the target chunk (closest start_time)
        let targetIndex = chunks.findIndex(c => Math.abs(Number(c.start_time) - startTime) < 0.1);
        
        // Fallback: find closest chunk
        if (targetIndex === -1) {
          let minDiff = Infinity;
          for (let i = 0; i < chunks.length; i++) {
            const diff = Math.abs(Number(chunks[i].start_time) - startTime);
            if (diff < minDiff) {
              minDiff = diff;
              targetIndex = i;
            }
          }
        }

        if (targetIndex !== -1) {
          // 3. Slice surrounding chunks (2 before, target, 2 after)
          const startIdx = Math.max(0, targetIndex - 2);
          const endIdx = Math.min(chunks.length, targetIndex + 3); // exclusive end
          
          const contextChunks = chunks.slice(startIdx, endIdx).map(c => ({
            ...c,
            is_target: c.start_time === chunks[targetIndex].start_time
          }));

          return NextResponse.json({ chunks: contextChunks, mode: 'database' });
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch context from database:', err.message);
      return NextResponse.json(
        { error: `Failed to fetch context: ${err.message}`, chunks: [], mode: 'database-error' },
        { status: 500 }
      );
    }
  }

  // Mock context fallback
  console.log(`Mock context for episode: ${episodeId}, time: ${startTime}`);
  
  // Try loading from local mock file
  const scratchDir = path.join(process.cwd(), 'scratch');
  if (fs.existsSync(scratchDir)) {
    try {
      const cleanId = episodeId.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = path.join(scratchDir, `mock_ingest_${cleanId}.json`);
      
      if (fs.existsSync(filename)) {
        const fileContent = fs.readFileSync(filename, 'utf8');
        const data = JSON.parse(fileContent);
        const chunks = data.chunks;
        
        // Find closest chunk
        let closestIndex = 0;
        let minDiff = Infinity;
        for (let i = 0; i < chunks.length; i++) {
          const diff = Math.abs(chunks[i].start_time - startTime);
          if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
          }
        }

        const startIdx = Math.max(0, closestIndex - 2);
        const endIdx = Math.min(chunks.length, closestIndex + 3);
        const contextChunks = chunks.slice(startIdx, endIdx).map((c: any, index: number) => ({
          id: c.id || `${episodeId}-mock-${index}`,
          speaker: c.speaker,
          start_time: c.start_time,
          end_time: c.end_time,
          content: c.content,
          is_target: (startIdx + index) === closestIndex
        }));

        return NextResponse.json({ chunks: contextChunks, mode: 'mock-local' });
      }
    } catch (e: any) {
      console.error('Error reading mock context file:', e.message);
    }
  }

  // Static mock context fallback
  const mockChunks = [
    { id: 'm1', speaker: 'Sprecher 0', start_time: 5.0, end_time: 25.0, content: 'Servus, Grüezi und Hallo zu einer neuen Ausgabe unseres transalpinen Podcasts. Heute sprechen wir über Windkraft in den Alpen.', is_target: startTime < 25 },
    { id: 'm2', speaker: 'Sprecher 1', start_time: 25.5, end_time: 48.0, content: 'Genau, besonders die Windkraft in den Alpen sorgt ja in Österreich, der Schweiz und Deutschland für viel Diskussionsstoff. In der Schweiz blockieren viele Naturschützer geplante Parks.', is_target: startTime >= 25 && startTime < 49 },
    { id: 'm3', speaker: 'Sprecher 2', start_time: 49.0, end_time: 68.0, content: 'Bei uns in Österreich ist das ähnlich. Auf den Kämmen der Steiermark stehen schon einige Räder, aber im Westen in Tirol ist es fast unmöglich. Wie sieht es in Deutschland aus?', is_target: startTime >= 49 && startTime < 69 },
    { id: 'm4', speaker: 'Sprecher 0', start_time: 69.0, end_time: 85.0, content: 'In Deutschland gab es die 10H-Regel in Bayern, die den Ausbau blockierte. Aber nun wird versucht, das aufzuweichen, weil grüner Strom dringend benötigt wird.', is_target: startTime >= 69 }
  ];

  return NextResponse.json({ chunks: mockChunks, mode: 'mock-static' });
}
