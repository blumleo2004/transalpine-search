import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasSupabase) {
    return NextResponse.json({ success: false, error: 'Database not configured' }, { status: 500 });
  }

  try {
    const { q, type } = await request.json();

    if (!q || !q.trim()) {
      return NextResponse.json({ success: false, error: 'Query q is required' }, { status: 400 });
    }

    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { error } = await supabase
      .from('search_queries')
      .insert({
        query: q.trim().substring(0, 100), // Limit query string length for safety
        search_type: type || 'semantic'
      });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Log search error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
