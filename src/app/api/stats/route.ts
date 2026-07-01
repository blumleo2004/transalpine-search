import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'stats';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const HOSTS = ['Matthias Daum', 'Florian Gasser', 'Lenz Jacobsen'] as const;

// Fun keywords barometer split
const KEYWORDS = [
  { label: 'René Benko 🇦🇹', query: 'Benko' },
  { label: 'Olaf Scholz 🇩🇪', query: 'Scholz' },
  { label: 'Karl Nehammer 🇦🇹', query: 'Nehammer' },
  { label: 'Christoph Blocher 🇨🇭', query: 'Blocher' },
  { label: 'Donald Trump 🇺🇸', query: 'Trump' },
  { label: 'Velo 🇨🇭', query: 'Velo' },
  { label: 'Fahrrad 🇩🇪/🇦🇹', query: 'Fahrrad' },
  { label: 'Bier 🍺', query: 'Bier' },
  { label: 'Wein 🍷', query: 'Wein' },
  { label: 'Kaffee ☕', query: 'Kaffee' },
  { label: 'Alpen 🏔️', query: 'Alpen' },
  { label: 'Europa 🇪🇺', query: 'Europa' },
  { label: 'Geld 💰', query: 'Geld' },
  { label: 'Werbung 📢', query: 'Werbung' },
  { label: 'Deutschland 🇩🇪', query: 'Deutschland' },
  { label: 'Österreich 🇦🇹', query: 'Österreich' },
  { label: 'Schweiz 🇨🇭', query: 'Schweiz' },
  { label: 'Bahn 🚄', query: 'Bahn' },
  { label: 'Auto 🚗', query: 'Auto' },
  { label: 'Käse 🧀', query: 'Käse' },
  { label: 'Schnitzel 🥩', query: 'Schnitzel' },
  { label: 'Wurst 🌭', query: 'Wurst' },
  { label: 'Krise 📉', query: 'Krise' },
  { label: 'Klima 🌱', query: 'Klima' },
  { label: 'Wahl 🗳️', query: 'Wahl' },
  { label: 'Kanzler 👑', query: 'Kanzler' },
  { label: 'Bundesrat 🏛️', query: 'Bundesrat' },
  { label: 'Föderalismus 🏛️', query: 'Föderalismus' },
  { label: 'Neutralität 🏳️', query: 'Neutralität' },
  { label: 'Tourismus 🏔️', query: 'Tourismus' },
  { label: 'Inflation 💸', query: 'Inflation' },
  { label: 'Steuer 🪙', query: 'Steuer' },
  { label: 'Asyl 🛂', query: 'Asyl' },
  { label: 'Migration 🗺️', query: 'Migration' },
  { label: 'Grenze 🚧', query: 'Grenze' },
  { label: 'Initiative 🇨🇭', query: 'Initiative' },
  { label: 'Kanton 🇨🇭', query: 'Kanton' },
  { label: 'Bundesland 🇩🇪/🇦🇹', query: 'Bundesland' },
  { label: 'Matura 🇦🇹/🇨🇭', query: 'Matura' },
  { label: 'Abitur 🇩🇪', query: 'Abitur' },
  { label: 'Spital 🇦🇹/🇨🇭', query: 'Spital' },
  { label: 'Krankenhaus 🇩🇪', query: 'Krankenhaus' },
];

const HOST_SIGNATURE_WORDS: Record<string, string[]> = {
  'Matthias Daum': ['Schweiz', 'Kanton', 'Abstimmung', 'Zürich', 'Velo', 'Initiative', 'Bundesrat'],
  'Florian Gasser': ['Österreich', 'Wien', 'FPÖ', 'ÖVP', 'Kanzler', 'bissel', 'Jänner'],
  'Lenz Jacobsen': ['Deutschland', 'Berlin', 'Scholz', 'CDU', 'Ampel', 'Bundestag', 'bisschen'],
};

// Postgres has a hard limit of 65535 bound params per query, and FILTER
// clauses fired one-per-keyword still only cost a single sequential/index
// scan of the table (vs. the ~68 separate round trips this used to take).
function buildFilterCountsSql(conditions: { alias: string; speaker?: string; word: string }[]) {
  const selects: string[] = [];
  const params: any[] = [];
  let i = 1;
  for (const c of conditions) {
    if (c.speaker) {
      selects.push(`count(*) FILTER (WHERE speaker = $${i++} AND content ILIKE $${i++}) AS "${c.alias}"`);
      params.push(c.speaker, `%${c.word}%`);
    } else {
      selects.push(`count(*) FILTER (WHERE content ILIKE $${i++}) AS "${c.alias}"`);
      params.push(`%${c.word}%`);
    }
  }
  return { sql: `SELECT ${selects.join(', ')} FROM transcript_chunks`, params };
}

async function computeStats() {
  const [episodes, chunkTotals, speakerYearRows, topEpisodes] = await Promise.all([
    query<any>('SELECT id, title, pub_date, duration FROM episodes ORDER BY pub_date DESC'),
    query<{ count: string }>('SELECT count(*) FROM transcript_chunks'),
    query<any>(`
      SELECT tc.speaker, to_char(e.pub_date, 'YYYY') AS year, count(*)::int AS count
      FROM transcript_chunks tc JOIN episodes e ON tc.episode_id = e.id
      GROUP BY tc.speaker, year
    `),
    query<any>(`
      SELECT e.id, e.title, count(tc.id)::int AS "chunkCount"
      FROM episodes e JOIN transcript_chunks tc ON tc.episode_id = e.id
      GROUP BY e.id, e.title
      ORDER BY e.duration DESC NULLS LAST
      LIMIT 5
    `),
  ]);

  const totalChunks = Number(chunkTotals[0].count);

  const yearDistribution: Record<string, number> = {};
  let totalDurationSeconds = 0;
  for (const ep of episodes) {
    const year = new Date(ep.pub_date).getFullYear().toString();
    yearDistribution[year] = (yearDistribution[year] || 0) + 1;
    totalDurationSeconds += ep.duration || 0;
  }

  const speakerDistribution: Record<string, number> = {
    'Matthias Daum': 0, 'Florian Gasser': 0, 'Lenz Jacobsen': 0, 'Gäste & Sonstige': 0,
  };
  const speakerSharesByYear: Record<string, Record<string, number>> = {};

  for (const row of speakerYearRows) {
    const isHost = HOSTS.includes(row.speaker);
    const bucket = isHost ? row.speaker : 'Gäste & Sonstige';
    speakerDistribution[bucket] = (speakerDistribution[bucket] || 0) + row.count;

    if (!speakerSharesByYear[row.year]) {
      speakerSharesByYear[row.year] = { 'Matthias Daum': 0, 'Florian Gasser': 0, 'Lenz Jacobsen': 0, 'Gäste & Sonstige': 0 };
    }
    speakerSharesByYear[row.year][bucket] += row.count;
  }

  // Single sequential scan computing all keyword + host-word + cross-border
  // counts via FILTER clauses, instead of ~68 separate round trips.
  const conditions = [
    ...KEYWORDS.map((k) => ({ alias: `kw__${k.label}`, word: k.query })),
    ...Object.entries(HOST_SIGNATURE_WORDS).flatMap(([host, words]) =>
      words.map((w) => ({ alias: `hw__${host}__${w}`, speaker: host, word: w }))
    ),
    { alias: 'cb__Matthias Daum__Deutschland', speaker: 'Matthias Daum', word: 'Deutschland' },
    { alias: 'cb__Matthias Daum__Österreich', speaker: 'Matthias Daum', word: 'Österreich' },
    { alias: 'cb__Florian Gasser__Deutschland', speaker: 'Florian Gasser', word: 'Deutschland' },
    { alias: 'cb__Florian Gasser__Schweiz', speaker: 'Florian Gasser', word: 'Schweiz' },
    { alias: 'cb__Lenz Jacobsen__Österreich', speaker: 'Lenz Jacobsen', word: 'Österreich' },
    { alias: 'cb__Lenz Jacobsen__Schweiz', speaker: 'Lenz Jacobsen', word: 'Schweiz' },
  ];

  const { sql, params } = buildFilterCountsSql(conditions);
  const [countsRow] = await query<Record<string, number>>(sql, params);

  const keywordMentions = KEYWORDS.map((k) => ({ label: k.label, count: Number(countsRow[`kw__${k.label}`]) || 0 }));

  const hostWordCounts = Object.entries(HOST_SIGNATURE_WORDS).map(([host, words]) => ({
    host,
    words: words
      .map((w) => ({ word: w, count: Number(countsRow[`hw__${host}__${w}`]) || 0 }))
      .sort((a, b) => b.count - a.count),
  }));

  const crossBorderMentions = {
    'Matthias Daum': {
      Deutschland: Number(countsRow['cb__Matthias Daum__Deutschland']) || 0,
      Österreich: Number(countsRow['cb__Matthias Daum__Österreich']) || 0,
    },
    'Florian Gasser': {
      Deutschland: Number(countsRow['cb__Florian Gasser__Deutschland']) || 0,
      Schweiz: Number(countsRow['cb__Florian Gasser__Schweiz']) || 0,
    },
    'Lenz Jacobsen': {
      Österreich: Number(countsRow['cb__Lenz Jacobsen__Österreich']) || 0,
      Schweiz: Number(countsRow['cb__Lenz Jacobsen__Schweiz']) || 0,
    },
  };

  return {
    totalEpisodes: episodes.length,
    totalChunks,
    totalDurationHours: Math.round(totalDurationSeconds / 3600),
    yearDistribution,
    speakerDistribution,
    speakerSharesByYear,
    keywordMentions,
    hostWordCounts,
    crossBorderMentions,
    latestEpisode: episodes[0] || null,
    oldestEpisode: episodes[episodes.length - 1] || null,
    topEpisodes,
  };
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      totalEpisodes: 0, totalChunks: 0, totalDurationHours: 0,
      yearDistribution: {}, speakerDistribution: {},
      latestEpisode: null, oldestEpisode: null, topEpisodes: [],
    });
  }

  // Durable cache in Postgres (app_cache table) — survives serverless cold
  // starts, unlike a local file cache which only helps the single warm
  // instance that wrote it.
  try {
    const cached = await query<{ value: any; updated_at: string }>(
      'SELECT value, updated_at FROM app_cache WHERE key = $1',
      [CACHE_KEY]
    );
    if (cached.length > 0 && Date.now() - new Date(cached[0].updated_at).getTime() < CACHE_TTL_MS) {
      return NextResponse.json(cached[0].value);
    }
  } catch (err: any) {
    console.warn('Stats cache read failed, recomputing:', err.message);
  }

  try {
    const result = await computeStats();

    query(
      `INSERT INTO app_cache (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [CACHE_KEY, JSON.stringify(result)]
    ).catch((err) => console.error('Failed to save stats cache:', err.message));

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Stats API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
