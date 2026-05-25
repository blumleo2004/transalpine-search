import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET: Fetch speaker mappings for an episode
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const episodeId = searchParams.get('episode_id');

  if (!episodeId) {
    return NextResponse.json({ error: 'episode_id is required' }, { status: 400 });
  }

  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasSupabase) {
    return NextResponse.json({ mappings: [] });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data, error } = await supabase
      .from('speaker_mappings')
      .select('speaker_label, real_name')
      .eq('episode_id', episodeId);

    if (error) throw error;

    return NextResponse.json({ mappings: data || [] });
  } catch (err: any) {
    console.error('Speaker mappings GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Save speaker mappings for an episode
export async function POST(request: Request) {
  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasSupabase) {
    return NextResponse.json({ error: 'No database configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { episode_id, mappings } = body;

    if (!episode_id || !mappings || !Array.isArray(mappings)) {
      return NextResponse.json({ error: 'episode_id and mappings[] are required' }, { status: 400 });
    }

    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Upsert each mapping
    for (const mapping of mappings) {
      if (!mapping.speaker_label || !mapping.real_name) continue;

      const { error } = await supabase
        .from('speaker_mappings')
        .upsert(
          {
            episode_id,
            speaker_label: mapping.speaker_label,
            real_name: mapping.real_name.trim(),
          },
          { onConflict: 'episode_id,speaker_label' }
        );

      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Speaker mappings POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
