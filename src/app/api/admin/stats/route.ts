import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('pw');

  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (password !== adminPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasSupabase) {
    return NextResponse.json({ queries: [] });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        global: {
          fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' })
        }
      }
    );

    // Query last 2000 search queries
    const { data, error } = await supabase
      .from('search_queries')
      .select('query, search_type, created_at')
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) throw error;

    // Group and count
    const counts: Record<string, { query: string; count: number; types: Set<string>; last_searched: string }> = {};
    for (const row of data || []) {
      const qNorm = row.query.trim().toLowerCase();
      if (!counts[qNorm]) {
        counts[qNorm] = {
          query: row.query,
          count: 0,
          types: new Set<string>(),
          last_searched: row.created_at
        };
      }
      counts[qNorm].count++;
      counts[qNorm].types.add(row.search_type);
    }

    const sortedQueries = Object.values(counts)
      .map(item => ({
        query: item.query,
        count: item.count,
        types: Array.from(item.types),
        last_searched: item.last_searched
      }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ queries: sortedQueries.slice(0, 30) });
  } catch (err: any) {
    console.error('Admin stats error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
