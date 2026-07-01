import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: false, error: 'No database config' }, { status: 500 });
  }

  try {
    const rows = await query<{ count: string }>('SELECT count(*) FROM transcript_chunks');
    return NextResponse.json({ ok: true, chunks: Number(rows[0].count), ts: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
