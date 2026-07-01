import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { query } from '@/lib/db';

const CHUNK_SELECT = `
  tc.id, tc.episode_id, tc.speaker, tc.start_time, tc.end_time, tc.content,
  e.title, e.audio_url, e.pub_date
`;

function resolveSpeakerFilters(speakerFilters: string[]) {
  let dbSpeakers: string[] | null = null;
  let dbExcludeSpeakers: string[] | null = null;

  if (speakerFilters.length > 0) {
    const resolved: string[] = [];
    if (speakerFilters.includes('matthias')) resolved.push('Matthias Daum');
    if (speakerFilters.includes('florian')) resolved.push('Florian Gasser');
    if (speakerFilters.includes('lenz')) resolved.push('Lenz Jacobsen');

    if (speakerFilters.includes('guest')) {
      const uncheckedHosts: string[] = [];
      if (!speakerFilters.includes('matthias')) uncheckedHosts.push('Matthias Daum');
      if (!speakerFilters.includes('florian')) uncheckedHosts.push('Florian Gasser');
      if (!speakerFilters.includes('lenz')) uncheckedHosts.push('Lenz Jacobsen');
      if (uncheckedHosts.length > 0) dbExcludeSpeakers = uncheckedHosts;
    } else {
      dbSpeakers = resolved;
    }
  }

  return { dbSpeakers, dbExcludeSpeakers };
}

function buildFilterClause(
  dbSpeakers: string[] | null,
  dbExcludeSpeakers: string[] | null,
  filterYear: string | null,
  startParamIndex: number
) {
  const clauses: string[] = [];
  const params: any[] = [];
  let i = startParamIndex;

  if (dbSpeakers) {
    clauses.push(`tc.speaker = ANY($${i++})`);
    params.push(dbSpeakers);
  }
  if (dbExcludeSpeakers) {
    clauses.push(`tc.speaker != ALL($${i++})`);
    params.push(dbExcludeSpeakers);
  }
  if (filterYear) {
    clauses.push(`to_char(e.pub_date, 'YYYY') = $${i++}`);
    params.push(filterYear);
  }

  return { clause: clauses.length ? 'AND ' + clauses.join(' AND ') : '', params, nextIndex: i };
}

function mapRow(row: any, similarity: number) {
  return {
    id: row.id,
    episode_id: row.episode_id,
    speaker: row.speaker,
    start_time: Number(row.start_time),
    end_time: Number(row.end_time),
    content: row.content,
    title: row.title || '',
    audio_url: row.audio_url || '',
    pub_date: row.pub_date || '',
    similarity: row.similarity !== undefined ? Number(row.similarity) : similarity,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const type = searchParams.get('type') || 'semantic';
  const speakers = searchParams.get('speakers') || '';
  const year = searchParams.get('year') || 'all';

  if (!q) {
    return NextResponse.json({ error: 'Query parameter q is required' }, { status: 400 });
  }

  const speakerFilters = speakers ? speakers.split(',') : [];
  const hasDb = !!process.env.DATABASE_URL;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (!hasDb) {
    return NextResponse.json({ error: 'Database not configured', results: [], mode: 'no-database' }, { status: 500 });
  }

  try {
    const { dbSpeakers, dbExcludeSpeakers } = resolveSpeakerFilters(speakerFilters);
    const filterYear = year !== 'all' ? year : null;

    const exactSearch = async (limit: number): Promise<any[]> => {
      const { clause, params } = buildFilterClause(dbSpeakers, dbExcludeSpeakers, filterYear, 3);
      const rows = await query(
        `SELECT ${CHUNK_SELECT}
         FROM transcript_chunks tc JOIN episodes e ON tc.episode_id = e.id
         WHERE tc.content ILIKE $1 ${clause}
         LIMIT $2`,
        [`%${q}%`, limit, ...params]
      );
      return rows.map((r) => mapRow(r, 1.0));
    };

    const semanticSearch = async (limit: number): Promise<any[]> => {
      if (!hasOpenAI || process.env.DISABLE_VECTOR_SEARCH) return [];
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const embResponse = await openai.embeddings.create({ model: 'text-embedding-3-small', input: q, dimensions: 256 });
        const embedding = `[${embResponse.data[0].embedding.join(',')}]`;

        const { clause, params } = buildFilterClause(dbSpeakers, dbExcludeSpeakers, filterYear, 3);
        const rows = await query(
          `SELECT ${CHUNK_SELECT}, 1 - (tc.embedding <=> $1::vector) AS similarity
           FROM transcript_chunks tc JOIN episodes e ON tc.episode_id = e.id
           WHERE 1=1 ${clause}
           ORDER BY tc.embedding <=> $1::vector
           LIMIT $2`,
          [embedding, limit, ...params]
        );
        return rows.map((r) => mapRow(r, Number(r.similarity)));
      } catch (err: any) {
        console.warn('Semantic search failed, falling back:', err.message);
        return [];
      }
    };

    let results: any[] = [];

    if (type === 'exact') {
      results = await exactSearch(100);
    } else if (type === 'semantic') {
      const [semanticResults, exactResults] = await Promise.all([semanticSearch(50), exactSearch(50)]);
      const resultMap = new Map<string, any>();
      for (const item of semanticResults) resultMap.set(item.id, { ...item });
      for (const item of exactResults) {
        if (resultMap.has(item.id)) resultMap.get(item.id).similarity = 1.0;
        else resultMap.set(item.id, item);
      }
      results = Array.from(resultMap.values());
    } else {
      const [semanticResults, exactRows] = await Promise.all([
        semanticSearch(50),
        exactSearch(50),
      ]);
      const exactResults = exactRows.map((r) => ({ ...r, similarity: 0.98 }));
      const resultMap = new Map<string, any>();
      for (const item of semanticResults) resultMap.set(item.id, { ...item });
      for (const item of exactResults) {
        if (resultMap.has(item.id)) resultMap.get(item.id).similarity = 1.0;
        else resultMap.set(item.id, item);
      }
      results = Array.from(resultMap.values());
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return NextResponse.json({ results: results.slice(0, 50), mode: `database-${type}` });
  } catch (err: any) {
    console.error('Database search failed:', err.message);
    return NextResponse.json(
      { error: `Database search failed: ${err.message}`, results: [], mode: 'database-error' },
      { status: 500 }
    );
  }
}
