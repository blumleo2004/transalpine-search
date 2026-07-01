import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

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

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured', chunks: [], mode: 'no-database' }, { status: 500 });
  }

  try {
    const chunks = await query<any>(
      `SELECT id, speaker, start_time, end_time, content
       FROM transcript_chunks WHERE episode_id = $1 ORDER BY start_time ASC`,
      [episodeId]
    );

    if (chunks.length === 0) {
      return NextResponse.json({ chunks: [], mode: 'database' });
    }

    let targetIndex = chunks.findIndex((c) => Math.abs(Number(c.start_time) - startTime) < 0.1);
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

    const startIdx = Math.max(0, targetIndex - 2);
    const endIdx = Math.min(chunks.length, targetIndex + 3);

    const contextChunks = chunks.slice(startIdx, endIdx).map((c) => ({
      ...c,
      start_time: Number(c.start_time),
      end_time: Number(c.end_time),
      is_target: Number(c.start_time) === Number(chunks[targetIndex].start_time),
    }));

    return NextResponse.json({ chunks: contextChunks, mode: 'database' });
  } catch (err: any) {
    console.error('Failed to fetch context from database:', err.message);
    return NextResponse.json(
      { error: `Failed to fetch context: ${err.message}`, chunks: [], mode: 'database-error' },
      { status: 500 }
    );
  }
}
