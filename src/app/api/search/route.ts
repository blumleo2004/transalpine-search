import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import * as fs from 'fs';
import * as path from 'path';

// Speaker matching helper
function speakerMatches(chunkSpeaker: string, filters: string[]) {
  if (filters.length === 0) return true;
  const normalized = chunkSpeaker.toLowerCase();
  
  // Map database speaker labels to filters
  const matchesMatthias = normalized.includes('matthias') || normalized === 'sprecher 0';
  const matchesFlorian = normalized.includes('florian') || normalized === 'sprecher 1';
  const matchesLenz = normalized.includes('lenz') || normalized === 'sprecher 2';
  
  if (filters.includes('matthias') && matchesMatthias) return true;
  if (filters.includes('florian') && matchesFlorian) return true;
  if (filters.includes('lenz') && matchesLenz) return true;
  
  // Guest filter (not Matthias, Florian, or Lenz)
  if (filters.includes('guest') && !matchesMatthias && !matchesFlorian && !matchesLenz) return true;
  
  return false;
}

// Year matching helper
function yearMatches(pubDateStr: string, filterYear: string) {
  if (!filterYear || filterYear === 'all') return true;
  try {
    const date = new Date(pubDateStr);
    return date.getFullYear().toString() === filterYear;
  } catch {
    return true;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const type = searchParams.get('type') || 'semantic'; // 'semantic' | 'exact' | 'hybrid'
  const speakers = searchParams.get('speakers') || ''; // comma-separated, e.g. 'matthias,florian'
  const year = searchParams.get('year') || 'all'; // 'all' or '2026', '2025', etc.

  if (!q) {
    return NextResponse.json({ error: 'Query parameter q is required' }, { status: 400 });
  }

  const speakerFilters = speakers ? speakers.split(',') : [];
  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasSupabase) {
    try {
      const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      let results: any[] = [];

      // Resolve speaker filters for database query
      let dbSpeakers: string[] | null = null;
      let dbExcludeSpeakers: string[] | null = null;
      if (speakerFilters.length > 0) {
        const resolved: string[] = [];
        if (speakerFilters.includes('matthias')) resolved.push('Matthias Daum');
        if (speakerFilters.includes('florian')) resolved.push('Florian Gasser');
        if (speakerFilters.includes('lenz')) resolved.push('Lenz Jacobsen');
        
        if (speakerFilters.includes('guest')) {
          // If guest is checked, we exclude unchecked hosts
          const uncheckedHosts: string[] = [];
          if (!speakerFilters.includes('matthias')) uncheckedHosts.push('Matthias Daum');
          if (!speakerFilters.includes('florian')) uncheckedHosts.push('Florian Gasser');
          if (!speakerFilters.includes('lenz')) uncheckedHosts.push('Lenz Jacobsen');
          
          if (uncheckedHosts.length > 0) {
            dbExcludeSpeakers = uncheckedHosts;
          }
        } else {
          // Just the checked hosts, no guests
          dbSpeakers = resolved;
        }
      }

      const filterYearParam = year !== 'all' ? year : null;

      // 1. EXACT SEARCH
      if (type === 'exact') {
        let dbQuery = supabase
          .from('transcript_chunks')
          .select(`
            id,
            episode_id,
            speaker,
            start_time,
            end_time,
            content,
            episodes!inner (
              title,
              audio_url,
              pub_date
            )
          `)
          .ilike('content', `%${q}%`);

        // Apply filters in database
        if (dbSpeakers) {
          dbQuery = dbQuery.in('speaker', dbSpeakers);
        }
        if (dbExcludeSpeakers) {
          dbQuery = dbQuery.not('speaker', 'in', `(${dbExcludeSpeakers.map(s => `"${s}"`).join(',')})`);
        }
        if (filterYearParam) {
          const startYear = `${filterYearParam}-01-01T00:00:00Z`;
          const endYear = `${filterYearParam}-12-31T23:59:59Z`;
          dbQuery = dbQuery.gte('episodes.pub_date', startYear).lte('episodes.pub_date', endYear);
        }

        const { data, error } = await dbQuery.limit(100);
        if (error) throw error;

        if (data) {
          results = data.map((chunk: any) => ({
            id: chunk.id,
            episode_id: chunk.episode_id,
            speaker: chunk.speaker,
            start_time: Number(chunk.start_time),
            end_time: Number(chunk.end_time),
            content: chunk.content,
            title: chunk.episodes?.title || '',
            audio_url: chunk.episodes?.audio_url || '',
            pub_date: chunk.episodes?.pub_date || '',
            similarity: 1.0
          }));
        }
      } 
      // 2. SEMANTIC SEARCH
      else if (type === 'semantic') {
        let semanticResults: any[] = [];
        
        // Try vector search if OpenAI is available
        if (hasOpenAI) {
          try {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const embResponse = await openai.embeddings.create({
              model: 'text-embedding-3-small',
              input: q,
            });
            const embedding = embResponse.data[0].embedding;

            try {
              // Use Promise.race to enforce a 3s client-side timeout
              // so we don't blow Vercel's 10s function limit before falling back to text search
              const rpcPromise = supabase.rpc('match_chunks', {
                query_embedding: embedding,
                match_threshold: 0.1,
                match_count: 50,
                filter_speakers: dbSpeakers,
                exclude_speakers: dbExcludeSpeakers,
                filter_year: filterYearParam
              });
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('match_chunks client timeout after 3s')), 3000)
              );
              const { data, error } = await Promise.race([rpcPromise, timeoutPromise]) as any;
              if (error) throw error;
              semanticResults = data || [];
            } catch (rpcErr: any) {
              console.warn('RPC match_chunks failed, falling back to exact search:', rpcErr.message);
              // Don't rethrow — fall through to exact search below
            }
          } catch (embErr: any) {
            console.warn('OpenAI embedding failed, falling back to exact search:', embErr.message);
          }
        }

        // Always also fetch exact text matches (acts as fallback if semantic failed)
        let exactQuery = supabase
          .from('transcript_chunks')
          .select(`
            id,
            episode_id,
            speaker,
            start_time,
            end_time,
            content,
            episodes!inner (
              title,
              audio_url,
              pub_date
            )
          `)
          .ilike('content', `%${q}%`);

        if (dbSpeakers) exactQuery = exactQuery.in('speaker', dbSpeakers);
        if (dbExcludeSpeakers) exactQuery = exactQuery.not('speaker', 'in', `(${dbExcludeSpeakers.map(s => `"${s}"`).join(',')})`);
        if (filterYearParam) {
          const startYear = `${filterYearParam}-01-01T00:00:00Z`;
          const endYear = `${filterYearParam}-12-31T23:59:59Z`;
          exactQuery = exactQuery.gte('episodes.pub_date', startYear).lte('episodes.pub_date', endYear);
        }

        const { data: exactData } = await exactQuery.limit(50);
        const exactResults = (exactData || []).map((chunk: any) => ({
          id: chunk.id,
          episode_id: chunk.episode_id,
          speaker: chunk.speaker,
          start_time: Number(chunk.start_time),
          end_time: Number(chunk.end_time),
          content: chunk.content,
          title: chunk.episodes?.title || '',
          audio_url: chunk.episodes?.audio_url || '',
          pub_date: chunk.episodes?.pub_date || '',
          similarity: 1.0
        }));

        const resultMap = new Map<string, any>();
        
        // Add semantic results first
        for (const item of semanticResults) {
          resultMap.set(item.id, { ...item });
        }

        // Add or boost with exact results
        for (const item of exactResults) {
          if (resultMap.has(item.id)) {
            const existing = resultMap.get(item.id);
            existing.similarity = 1.0;
          } else {
            resultMap.set(item.id, item);
          }
        }

        results = Array.from(resultMap.values());
      }
      // 3. HYBRID SEARCH
      else {
        let exactResults: any[] = [];
        let semanticResults: any[] = [];

        // Exact query in DB
        let exactQuery = supabase
          .from('transcript_chunks')
          .select(`
            id,
            episode_id,
            speaker,
            start_time,
            end_time,
            content,
            episodes!inner (
              title,
              audio_url,
              pub_date
            )
          `)
          .ilike('content', `%${q}%`);

        if (dbSpeakers) exactQuery = exactQuery.in('speaker', dbSpeakers);
        if (dbExcludeSpeakers) exactQuery = exactQuery.not('speaker', 'in', `(${dbExcludeSpeakers.map(s => `"${s}"`).join(',')})`);
        if (filterYearParam) {
          const startYear = `${filterYearParam}-01-01T00:00:00Z`;
          const endYear = `${filterYearParam}-12-31T23:59:59Z`;
          exactQuery = exactQuery.gte('episodes.pub_date', startYear).lte('episodes.pub_date', endYear);
        }

        const { data: exactData } = await exactQuery.limit(50);
        if (exactData) {
          exactResults = exactData.map((chunk: any) => ({
            id: chunk.id,
            episode_id: chunk.episode_id,
            speaker: chunk.speaker,
            start_time: Number(chunk.start_time),
            end_time: Number(chunk.end_time),
            content: chunk.content,
            title: chunk.episodes?.title || '',
            audio_url: chunk.episodes?.audio_url || '',
            pub_date: chunk.episodes?.pub_date || '',
            similarity: 0.98 // High base similarity for exact keyword hits in hybrid
          }));
        }

        // Semantic query
        if (hasOpenAI) {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const embResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: q,
          });
          const embedding = embResponse.data[0].embedding;

          try {
            const rpcPromise = supabase.rpc('match_chunks', {
              query_embedding: embedding,
              match_threshold: 0.1,
              match_count: 50,
              filter_speakers: dbSpeakers,
              exclude_speakers: dbExcludeSpeakers,
              filter_year: filterYearParam
            });
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('match_chunks client timeout after 3s')), 3000)
            );
            const { data, error } = await Promise.race([rpcPromise, timeoutPromise]) as any;
            if (error) throw error;
            semanticResults = data || [];
          } catch (rpcErr: any) {
            console.warn('RPC match_chunks failed for hybrid, continuing with exact results only:', rpcErr.message);
            // Don't rethrow — exact results will still be returned
          }
        }

        // Merge results
        const resultMap = new Map<string, any>();
        
        // Add semantic results first
        for (const item of semanticResults) {
          resultMap.set(item.id, { ...item });
        }

        // Add or boost with exact results
        for (const item of exactResults) {
          if (resultMap.has(item.id)) {
            const existing = resultMap.get(item.id);
            // Boost similarity if it's both a semantic and exact hit
            existing.similarity = 1.0;
          } else {
            resultMap.set(item.id, item);
          }
        }

        results = Array.from(resultMap.values());
      }

      // Sort by similarity descending
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

  // Mock search fallback
  console.log(`Mock search for query: "${q}" (Type: ${type}, Speakers: ${speakers}, Year: ${year})`);
  
  const results: any[] = [];
  const scratchDir = path.join(process.cwd(), 'scratch');
  
  if (fs.existsSync(scratchDir)) {
    try {
      const files = fs.readdirSync(scratchDir).filter(f => f.startsWith('mock_ingest_') && f.endsWith('.json'));
      
      for (const file of files) {
        const fileContent = fs.readFileSync(path.join(scratchDir, file), 'utf8');
        const data = JSON.parse(fileContent);
        const episode = data.episode;
        const chunks = data.chunks;
        
        for (const chunk of chunks) {
          // Filter by speaker and year
          if (!speakerMatches(chunk.speaker, speakerFilters)) continue;
          if (!yearMatches(episode.pub_date, year)) continue;

          const isExactMatch = chunk.content.toLowerCase().includes(q.toLowerCase());
          const matchCount = (chunk.content.toLowerCase().match(new RegExp(q.toLowerCase(), 'g')) || []).length;
          
          if (type === 'exact' && !isExactMatch) continue;
          
          if (isExactMatch || type === 'semantic' || type === 'hybrid') {
            let similarity = 0.5;
            
            if (type === 'exact') {
              similarity = 1.0;
            } else if (type === 'semantic') {
              // Simulated similarity
              similarity = 0.6 + (isExactMatch ? 0.29 : Math.random() * 0.2);
            } else {
              // Hybrid: higher base for exact matches
              similarity = 0.7 + (isExactMatch ? 0.2 : Math.random() * 0.15);
            }

            results.push({
              id: chunk.id || Math.random().toString(),
              episode_id: episode.id,
              speaker: chunk.speaker,
              start_time: chunk.start_time,
              end_time: chunk.end_time,
              content: chunk.content,
              title: episode.title,
              audio_url: episode.audio_url,
              pub_date: episode.pub_date,
              similarity: parseFloat(similarity.toFixed(3))
            });
          }
        }
      }
    } catch (e: any) {
      console.error('Error parsing local mock files:', e.message);
    }
  }

  // Sort by similarity descending
  results.sort((a, b) => b.similarity - a.similarity);

  // If no results found in local files, return some default static mock results
  if (results.length === 0) {
    const mockFeed = [
      {
        id: '1',
        episode_id: 'ep-395',
        speaker: 'Sprecher 0',
        start_time: 5.0,
        end_time: 25.0,
        content: `Servus, Grüezi und Hallo zu einer neuen Ausgabe unseres transalpinen Podcasts. Heute sprechen wir über Windkraft in den Alpen.`,
        title: 'Folge 395: Der transalpine Windkraftstreit',
        audio_url: 'https://zeitonline.simplecastaudio.com/5c4ef034-52ef-432d-99e8-c0f3785b3a9d/episodes/b3a10590-7b91-426d-bf4b-93335b425cec/audio/128/default.mp3?aid=rss_feed&awCollectionId=5c4ef034-52ef-432d-99e8-c0f3785b3a9d&awEpisodeId=b3a10590-7b91-426d-bf4b-93335b425cec&feed=br4J_MDH',
        pub_date: '2026-05-20T04:55:00.000Z',
        similarity: type === 'exact' ? 1.0 : 0.88
      },
      {
        id: '2',
        episode_id: 'ep-395',
        speaker: 'Sprecher 1',
        start_time: 25.5,
        end_time: 48.0,
        content: `Genau, besonders die Windkraft in den Alpen sorgt ja in Österreich, der Schweiz und Deutschland für viel Diskussionsstoff. In der Schweiz blockieren viele Naturschützer geplante Parks.`,
        title: 'Folge 395: Der transalpine Windkraftstreit',
        audio_url: 'https://zeitonline.simplecastaudio.com/5c4ef034-52ef-432d-99e8-c0f3785b3a9d/episodes/b3a10590-7b91-426d-bf4b-93335b425cec/audio/128/default.mp3?aid=rss_feed&awCollectionId=5c4ef034-52ef-432d-99e8-c0f3785b3a9d&awEpisodeId=b3a10590-7b91-426d-bf4b-93335b425cec&feed=br4J_MDH',
        pub_date: '2026-05-20T04:55:00.000Z',
        similarity: type === 'exact' ? 1.0 : 0.85
      },
      {
        id: '3',
        episode_id: 'ep-395',
        speaker: 'Sprecher 2',
        start_time: 49.0,
        end_time: 68.0,
        content: `Bei uns in Österreich ist das ähnlich. Auf den Kämmen der Steiermark stehen schon einige Räder, aber im Westen in Tirol ist es fast unmöglich. Wie sieht es in Deutschland aus?`,
        title: 'Folge 395: Der transalpine Windkraftstreit',
        audio_url: 'https://zeitonline.simplecastaudio.com/5c4ef034-52ef-432d-99e8-c0f3785b3a9d/episodes/b3a10590-7b91-426d-bf4b-93335b425cec/audio/128/default.mp3?aid=rss_feed&awCollectionId=5c4ef034-52ef-432d-99e8-c0f3785b3a9d&awEpisodeId=b3a10590-7b91-426d-bf4b-93335b425cec&feed=br4J_MDH',
        pub_date: '2026-05-20T04:55:00.000Z',
        similarity: type === 'exact' ? 1.0 : 0.78
      },
      {
        id: '4',
        episode_id: 'ep-395',
        speaker: 'Sprecher 0',
        start_time: 69.0,
        end_time: 85.0,
        content: `In Deutschland gab es die 10H-Regel in Bayern, die den Ausbau blockierte. Aber nun wird versucht, das aufzuweichen, weil grüner Strom dringend benötigt wird.`,
        title: 'Folge 395: Der transalpine Windkraftstreit',
        audio_url: 'https://zeitonline.simplecastaudio.com/5c4ef034-52ef-432d-99e8-c0f3785b3a9d/episodes/b3a10590-7b91-426d-bf4b-93335b425cec/audio/128/default.mp3?aid=rss_feed&awCollectionId=5c4ef034-52ef-432d-99e8-c0f3785b3a9d&awEpisodeId=b3a10590-7b91-426d-bf4b-93335b425cec&feed=br4J_MDH',
        pub_date: '2026-05-20T04:55:00.000Z',
        similarity: type === 'exact' ? 1.0 : 0.75
      }
    ];
    
    // Apply filters to static list
    let filtered = mockFeed.filter(item => 
      (item.content.toLowerCase().includes(q.toLowerCase()) || item.title.toLowerCase().includes(q.toLowerCase())) &&
      speakerMatches(item.speaker, speakerFilters) &&
      yearMatches(item.pub_date, year)
    );
    
    // If exact query matches nothing, but type is exact, return empty
    if (type === 'exact' && filtered.length === 0) {
      return NextResponse.json({ results: [], mode: 'mock-static-filtered' });
    }

    return NextResponse.json({ 
      results: filtered.length > 0 ? filtered : mockFeed.filter(m => speakerMatches(m.speaker, speakerFilters) && yearMatches(m.pub_date, year)), 
      mode: 'mock-static-filtered' 
    });
  }

  return NextResponse.json({ results: results.slice(0, 12), mode: `mock-local-${type}` });
}
