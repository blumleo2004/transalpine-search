import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ success: false, error: 'Database not configured' }, { status: 500 });
  }

  try {
    const { q, type } = await request.json();

    if (!q || !q.trim()) {
      return NextResponse.json({ success: false, error: 'Query q is required' }, { status: 400 });
    }

    await query(
      'INSERT INTO search_queries (query, search_type) VALUES ($1, $2)',
      [q.trim().substring(0, 100), type || 'semantic']
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Log search error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
