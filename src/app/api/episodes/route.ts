import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('perPage') || '20');
  const year = searchParams.get('year') || 'all';
  const sort = searchParams.get('sort') || 'newest'; // 'newest' | 'oldest'

  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasSupabase) {
    return NextResponse.json({ episodes: [], total: 0, page, perPage });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Build query
    let query = supabase
      .from('episodes')
      .select('id, title, pub_date, audio_url', { count: 'exact' });

    // Year filter
    if (year && year !== 'all') {
      const yearStart = `${year}-01-01T00:00:00.000Z`;
      const yearEnd = `${parseInt(year) + 1}-01-01T00:00:00.000Z`;
      query = query.gte('pub_date', yearStart).lt('pub_date', yearEnd);
    }

    // Sort
    query = query.order('pub_date', { ascending: sort === 'oldest' });

    // Pagination
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) throw error;

    // For each episode, get chunk count
    const episodesWithMeta = await Promise.all(
      (data || []).map(async (ep) => {
        const { count: chunkCount } = await supabase
          .from('transcript_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('episode_id', ep.id);

        return {
          ...ep,
          chunk_count: chunkCount || 0,
        };
      })
    );

    return NextResponse.json({
      episodes: episodesWithMeta,
      total: count || 0,
      page,
      perPage,
    });
  } catch (err: any) {
    console.error('Episodes API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
