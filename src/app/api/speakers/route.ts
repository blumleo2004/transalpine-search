import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const episodeId = searchParams.get('episode_id');

  if (!episodeId) {
    return NextResponse.json({ error: 'episode_id is required' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ mappings: [] });
  }

  try {
    const mappings = await query<any>(
      'SELECT speaker_label, real_name FROM speaker_mappings WHERE episode_id = $1',
      [episodeId]
    );
    return NextResponse.json({ mappings });
  } catch (err: any) {
    console.error('Speaker mappings GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'No database configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { episode_id, mappings } = body;

    if (!episode_id || !mappings || !Array.isArray(mappings)) {
      return NextResponse.json({ error: 'episode_id and mappings[] are required' }, { status: 400 });
    }

    for (const mapping of mappings) {
      if (!mapping.speaker_label || !mapping.real_name) continue;

      await query(
        `INSERT INTO speaker_mappings (episode_id, speaker_label, real_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (episode_id, speaker_label) DO UPDATE SET real_name = EXCLUDED.real_name`,
        [episode_id, mapping.speaker_label, mapping.real_name.trim()]
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Speaker mappings POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
