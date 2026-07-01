import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';

export const dynamic = 'force-dynamic';

// Temporary diagnostic endpoint used to debug DB/search health without needing
// the app password. Gated by DEBUG_TOKEN. Remove once diagnosis is complete.
export async function GET(request: Request) {
  const token = request.headers.get('x-debug-token');
  if (!token || token !== process.env.DEBUG_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const report: any = {};

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'No Supabase config' }, { status: 500 });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Basic connectivity + row count
  const t0 = Date.now();
  const { count, error: countErr } = await supabase
    .from('transcript_chunks')
    .select('*', { count: 'exact', head: true });
  report.rowCountMs = Date.now() - t0;
  report.rowCount = count;
  report.rowCountError = countErr?.message || null;

  // 2. match_chunks RPC timing (semantic search core)
  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const t1 = Date.now();
      const embResp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'Windkraft in den Alpen',
      });
      report.embeddingMs = Date.now() - t1;
      const embedding = embResp.data[0].embedding;

      const t2 = Date.now();
      const { data, error } = await supabase.rpc('match_chunks', {
        query_embedding: embedding,
        match_threshold: 0.1,
        match_count: 10,
        filter_speakers: null,
        exclude_speakers: null,
        filter_year: null,
      });
      report.matchChunksMs = Date.now() - t2;
      report.matchChunksError = error?.message || null;
      report.matchChunksCount = data?.length || 0;
      report.matchChunksSample = data?.slice(0, 2).map((d: any) => ({ id: d.id, similarity: d.similarity, content: d.content?.slice(0, 80) }));

      // Second call to see if latency is consistent (rules out cold cache flukes)
      const t3 = Date.now();
      const { data: data2, error: error2 } = await supabase.rpc('match_chunks', {
        query_embedding: embedding,
        match_threshold: 0.1,
        match_count: 10,
        filter_speakers: null,
        exclude_speakers: null,
        filter_year: null,
      });
      report.matchChunksMs2 = Date.now() - t3;
      report.matchChunksError2 = error2?.message || null;
      report.matchChunksCount2 = data2?.length || 0;
    } catch (e: any) {
      report.embeddingOrRpcException = e.message;
    }
  } else {
    report.openaiMissing = true;
  }

  // 3. Duplicate function check (calling with wrong arg count would 404/PGRST error differently)
  report.env = {
    hasSupabase: true,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    disableVectorSearch: !!process.env.DISABLE_VECTOR_SEARCH,
  };

  return NextResponse.json(report);
}
