import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hasSupabase = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasSupabase) {
    return NextResponse.json({
      totalEpisodes: 0, totalChunks: 0, totalDurationHours: 0,
      yearDistribution: {}, speakerDistribution: {},
      latestEpisode: null, oldestEpisode: null, topEpisodes: [],
    });
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

    // Fetch basic episode metadata in parallel with speaker counts to minimize latency
    const [
      episodesRes,
      totalChunksRes,
      matthiasRes,
      florianRes,
      lenzRes,
      topEpsRes
    ] = await Promise.all([
      supabase
        .from('episodes')
        .select('id, title, pub_date, duration')
        .order('pub_date', { ascending: false }),
      supabase
        .from('transcript_chunks')
        .select('id', { count: 'exact', head: true }),
      supabase
        .from('transcript_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('speaker', 'Matthias Daum'),
      supabase
        .from('transcript_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('speaker', 'Florian Gasser'),
      supabase
        .from('transcript_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('speaker', 'Lenz Jacobsen'),
      supabase
        .from('episodes')
        .select('id, title, duration')
        .order('duration', { ascending: false })
        .limit(5)
    ]);

    if (episodesRes.error) throw episodesRes.error;
    if (totalChunksRes.error) throw totalChunksRes.error;

    const episodes = episodesRes.data || [];
    const totalChunks = totalChunksRes.count || 0;

    const matthiasCount = matthiasRes.count || 0;
    const florianCount = florianRes.count || 0;
    const lenzCount = lenzRes.count || 0;
    const guestsCount = Math.max(0, totalChunks - matthiasCount - florianCount - lenzCount);

    const yearDistribution: Record<string, number> = {};
    let totalDurationSeconds = 0;
    for (const ep of episodes) {
      const year = new Date(ep.pub_date).getFullYear().toString();
      yearDistribution[year] = (yearDistribution[year] || 0) + 1;
      totalDurationSeconds += ep.duration || 0;
    }

    const speakerDistribution: Record<string, number> = {
      'Matthias Daum': matthiasCount,
      'Florian Gasser': florianCount,
      'Lenz Jacobsen': lenzCount,
      'Gäste & Sonstige': guestsCount,
    };

    const uniqueYears = Array.from(new Set(episodes.map(e => new Date(e.pub_date).getFullYear()))).sort();
    const speakerSharesByYear: Record<string, any> = {};

    await Promise.all(uniqueYears.map(async (year) => {
      const epsInYear = episodes.filter(e => new Date(e.pub_date).getFullYear() === year).map(e => e.id);
      if (epsInYear.length === 0) return;

      const [mRes, fRes, lRes, totalRes] = await Promise.all([
        supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('speaker', 'Matthias Daum').in('episode_id', epsInYear),
        supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('speaker', 'Florian Gasser').in('episode_id', epsInYear),
        supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('speaker', 'Lenz Jacobsen').in('episode_id', epsInYear),
        supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).in('episode_id', epsInYear),
      ]);

      const mCount = mRes.count || 0;
      const fCount = fRes.count || 0;
      const lCount = lRes.count || 0;
      const tCount = totalRes.count || 0;
      const gCount = Math.max(0, tCount - mCount - fCount - lCount);

      speakerSharesByYear[year.toString()] = {
        'Matthias Daum': mCount,
        'Florian Gasser': fCount,
        'Lenz Jacobsen': lCount,
        'Gäste & Sonstige': gCount
      };
    }));

    // Retrieve the exact transcript chunk count only for the top 5 longest duration episodes
    const topEps = topEpsRes.data || [];
    const topEpisodes = await Promise.all(
      topEps.map(async (ep) => {
        const { count } = await supabase
          .from('transcript_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('episode_id', ep.id);
        return {
          id: ep.id,
          title: ep.title,
          chunkCount: count || 0
        };
      })
    );

    // Fun keywords barometer split
    const keywords = [
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
      { label: 'Krankenhaus 🇩🇪', query: 'Krankenhaus' }
    ];


    const keywordMentions = await Promise.all(
      keywords.map(async (kw) => {
        const { count } = await supabase
          .from('transcript_chunks')
          .select('id', { count: 'exact', head: true })
          .ilike('content', `%${kw.query}%`);
        return {
          label: kw.label,
          count: count || 0
        };
      })
    );

    // Host signature words counts
    const hostSignatureWords = {
      'Matthias Daum': ['Schweiz', 'Kanton', 'Abstimmung', 'Zürich', 'Velo', 'Initiative', 'Bundesrat'],
      'Florian Gasser': ['Österreich', 'Wien', 'FPÖ', 'ÖVP', 'Kanzler', 'bissel', 'Jänner'],
      'Lenz Jacobsen': ['Deutschland', 'Berlin', 'Scholz', 'CDU', 'Ampel', 'Bundestag', 'bisschen']
    };

    const hostWordCounts = await Promise.all(
      Object.entries(hostSignatureWords).map(async ([host, words]) => {
        const counts = await Promise.all(
          words.map(async (word) => {
            const { count } = await supabase
              .from('transcript_chunks')
              .select('id', { count: 'exact', head: true })
              .eq('speaker', host)
              .ilike('content', `%${word}%`);
            return {
              word,
              count: count || 0
            };
          })
        );
        return {
          host,
          words: counts.sort((a, b) => b.count - a.count)
        };
      })
    );

    // Cross-border mentions per host
    const [
      matthiasDE, matthiasAT,
      florianDE, florianCH,
      lenzAT, lenzCH
    ] = await Promise.all([
      supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('speaker', 'Matthias Daum').ilike('content', '%Deutschland%'),
      supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('speaker', 'Matthias Daum').ilike('content', '%Österreich%'),
      supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('speaker', 'Florian Gasser').ilike('content', '%Deutschland%'),
      supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('speaker', 'Florian Gasser').ilike('content', '%Schweiz%'),
      supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('speaker', 'Lenz Jacobsen').ilike('content', '%Österreich%'),
      supabase.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('speaker', 'Lenz Jacobsen').ilike('content', '%Schweiz%')
    ]);

    const crossBorderMentions = {
      'Matthias Daum': {
        'Deutschland': matthiasDE.count || 0,
        'Österreich': matthiasAT.count || 0
      },
      'Florian Gasser': {
        'Deutschland': florianDE.count || 0,
        'Schweiz': florianCH.count || 0
      },
      'Lenz Jacobsen': {
        'Österreich': lenzAT.count || 0,
        'Schweiz': lenzCH.count || 0
      }
    };

    return NextResponse.json({
      totalEpisodes: episodes.length,
      totalChunks: totalChunks,
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
    });

  } catch (err: any) {
    console.error('Stats API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
