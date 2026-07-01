import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('perPage') || '20');
  const year = searchParams.get('year') || 'all';
  const sort = searchParams.get('sort') || 'newest';

  if (!process.env.DATABASE_URL) {
    if (id) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    return NextResponse.json({ episodes: [], total: 0, page, perPage });
  }

  try {
    if (id) {
      const rows = await query<any>(
        'SELECT id, title, pub_date, audio_url FROM episodes WHERE id = $1',
        [id]
      );
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
      }
      return NextResponse.json({ episode: rows[0] });
    }

    const filters: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (year && year !== 'all') {
      filters.push(`pub_date >= $${i++} AND pub_date < $${i++}`);
      params.push(`${year}-01-01T00:00:00.000Z`, `${parseInt(year) + 1}-01-01T00:00:00.000Z`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const orderClause = `ORDER BY pub_date ${sort === 'oldest' ? 'ASC' : 'DESC'}`;
    const offset = (page - 1) * perPage;

    const countRows = await query<{ count: string }>(
      `SELECT count(*) FROM episodes ${whereClause}`,
      params
    );
    const total = Number(countRows[0].count);

    const episodeRows = await query<any>(
      `SELECT id, title, pub_date, audio_url FROM episodes ${whereClause} ${orderClause} LIMIT $${i++} OFFSET $${i++}`,
      [...params, perPage, offset]
    );

    const episodeIds = episodeRows.map((e) => e.id);
    const chunkCounts = episodeIds.length
      ? await query<{ episode_id: string; count: string }>(
          `SELECT episode_id, count(*) FROM transcript_chunks WHERE episode_id = ANY($1) GROUP BY episode_id`,
          [episodeIds]
        )
      : [];
    const countMap = new Map(chunkCounts.map((c) => [c.episode_id, Number(c.count)]));

    const episodesWithMeta = episodeRows.map((ep) => ({
      ...ep,
      chunk_count: countMap.get(ep.id) || 0,
    }));

    return NextResponse.json({ episodes: episodesWithMeta, total, page, perPage });
  } catch (err: any) {
    console.error('Episodes API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
