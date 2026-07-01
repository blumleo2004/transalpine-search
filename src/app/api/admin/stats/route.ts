import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('pw');

  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (password !== adminPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ queries: [] });
  }

  try {
    const rows = await query<{ query: string; search_type: string; created_at: string }>(
      'SELECT query, search_type, created_at FROM search_queries ORDER BY created_at DESC LIMIT 2000'
    );

    const counts: Record<string, { query: string; count: number; types: Set<string>; last_searched: string }> = {};
    for (const row of rows) {
      const qNorm = row.query.trim().toLowerCase();
      if (!counts[qNorm]) {
        counts[qNorm] = { query: row.query, count: 0, types: new Set<string>(), last_searched: row.created_at };
      }
      counts[qNorm].count++;
      counts[qNorm].types.add(row.search_type);
    }

    const sortedQueries = Object.values(counts)
      .map((item) => ({
        query: item.query,
        count: item.count,
        types: Array.from(item.types),
        last_searched: item.last_searched,
      }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ queries: sortedQueries.slice(0, 30) });
  } catch (err: any) {
    console.error('Admin stats error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
