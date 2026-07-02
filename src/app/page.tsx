'use client';

import React, { useState, useEffect, useRef } from 'react';
import styles from './page.module.css';
import Logo from '@/components/Logo';
import CountryFlag from '@/components/CountryFlag';

// ──────────────────────── Types ────────────────────────

interface SearchResult {
  id: string;
  episode_id: string;
  speaker: string;
  start_time: number;
  end_time: number;
  content: string;
  title: string;
  audio_url: string;
  pub_date: string;
  similarity: number;
}

interface ContextChunk {
  id: string;
  speaker: string;
  start_time: number;
  end_time: number;
  content: string;
  is_target: boolean;
}

interface EpisodeGroup {
  episode_id: string;
  title: string;
  audio_url: string;
  pub_date: string;
  avgSimilarity: number;
  maxSimilarity: number;
  chunks: SearchResult[];
}

interface StatsData {
  totalEpisodes: number;
  totalChunks: number;
  totalDurationHours: number;
  yearDistribution: Record<string, number>;
  speakerDistribution: Record<string, number>;
  speakerSharesByYear?: Record<string, Record<string, number>>;
  keywordMentions?: { label: string; count: number }[];
  topWords?: { word: string; count: number }[];
  hostWordCounts?: { host: string; words: { word: string; count: number }[] }[];
  crossBorderMentions?: Record<string, Record<string, number>>;
  yesNoButCounts?: { host: string; ja: number; nein: number; aber: number }[];
  vocabularySizes?: { host: string; distinctWords: number }[];
  topEpisodes: { id: string; title: string; chunkCount: number }[];
  latestEpisode: { title: string; pub_date: string } | null;
  oldestEpisode: { title: string; pub_date: string } | null;
}

interface BrowseEpisode {
  id: string;
  title: string;
  pub_date: string;
  audio_url: string;
  chunk_count: number;
}

// ──────────────────────── Constants ────────────────────────

const SUGGESTIONS = [
  'Windkraft in den Alpen',
  'Föderalismus in Österreich',
  'Schweizer Direkte Demokratie',
  'René Benko'
];

// ──────────────────────── Utilities ────────────────────────

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toString().padStart(2, '0');
  if (h > 0) return `${h}:${mStr}:${sStr}`;
  return `${mStr}:${sStr}`;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return dateStr; }
}

function getSpeakerClass(speaker: string): string {
  if (speaker.includes('0') || speaker.toLowerCase().includes('matthias')) return styles.speakerMatthias;
  if (speaker.includes('1') || speaker.toLowerCase().includes('florian')) return styles.speakerFlorian;
  if (speaker.includes('2') || speaker.toLowerCase().includes('lenz')) return styles.speakerLenz;
  return styles.speakerGuest;
}

function getSpeakerDisplayName(speaker: string): string {
  const norm = speaker.toLowerCase();
  if (norm.includes('matthias') || norm === 'sprecher 0') return 'Matthias Daum 🇨🇭';
  if (norm.includes('florian') || norm === 'sprecher 1') return 'Florian Gasser 🇦🇹';
  if (norm.includes('lenz') || norm === 'sprecher 2') return 'Lenz Jacobsen 🇩🇪';
  return speaker;
}

function groupByEpisode(results: SearchResult[]): EpisodeGroup[] {
  const map = new Map<string, EpisodeGroup>();
  for (const r of results) {
    if (!map.has(r.episode_id)) {
      map.set(r.episode_id, {
        episode_id: r.episode_id,
        title: r.title,
        audio_url: r.audio_url,
        pub_date: r.pub_date,
        avgSimilarity: 0,
        maxSimilarity: 0,
        chunks: [],
      });
    }
    const group = map.get(r.episode_id)!;
    group.chunks.push(r);
    group.maxSimilarity = Math.max(group.maxSimilarity, r.similarity);
  }
  const allGroups = Array.from(map.values());
  for (const group of allGroups) {
    group.avgSimilarity = group.chunks.reduce((sum, c) => sum + c.similarity, 0) / group.chunks.length;
    group.chunks.sort((a, b) => b.similarity - a.similarity);
  }
  // Sort episodes primarily by their single best match (an exact hit or a
  // strong semantic match should always outrank an episode that only has
  // several weak/noisy matches), then by chunk count as a tiebreaker.
  // Previously this weighted chunks.length * avgSimilarity, which let an
  // episode with three 35%-similarity chunks outrank one with a single
  // 100% exact match.
  allGroups.sort((a, b) => {
    if (b.maxSimilarity !== a.maxSimilarity) return b.maxSimilarity - a.maxSimilarity;
    return b.chunks.length - a.chunks.length;
  });
  return allGroups;
}

// Highlight search query within text (supports query words and semantic keywords)
function highlightText(text: string, query: string, semanticKeywords: string[] = []): React.ReactNode {
  if ((!query || query.length < 2) && semanticKeywords.length === 0) return text;
  
  const queryWords = query
    ? query
        .split(/\s+/)
        .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, ''))
        .filter(w => w.length >= 3 && !['und', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'mit', 'von', 'auf', 'für', 'ist', 'sind', 'war', 'aber', 'als', 'auch', 'das', 'des', 'ein', 'eine', 'einer', 'einem', 'einen'].includes(w.toLowerCase()))
    : [];

  const allTerms = [...queryWords, ...semanticKeywords]
    .filter(w => w && w.trim().length >= 2);

  if (allTerms.length === 0) return text;

  // Sort by length descending to match longer terms first (e.g. "erneuerbare Energien" before "Energien")
  allTerms.sort((a, b) => b.length - a.length);

  const escapedWords = allTerms.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = `(${escapedWords.join('|')})`;
  
  try {
    const regex = new RegExp(pattern, 'gi');
    const parts = text.split(regex);

    return parts.map((part, i) => {
      const isExactMatch = queryWords.some(w => part.toLowerCase() === w.toLowerCase());
      const isSemanticMatch = semanticKeywords.some(w => part.toLowerCase() === w.toLowerCase());
      
      if (isExactMatch) {
        return <mark key={i} className={styles.highlight}>{part}</mark>;
      }
      if (isSemanticMatch) {
        return <mark key={i} className={styles.semanticHighlight}>{part}</mark>;
      }
      return part;
    });
  } catch (err) {
    return text;
  }
}


// ──────────────────────── Component ────────────────────────

export default function SearchPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<'search' | 'browse' | 'stats' | 'about'>('search');

  // Search state
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [allEpisodeTitles, setAllEpisodeTitles] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchMode, setSearchMode] = useState<string>('');
  const [totalOccurrences, setTotalOccurrences] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchType, setSearchType] = useState<'semantic' | 'exact' | 'hybrid'>('semantic');
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>(['matthias', 'florian', 'lenz', 'guest']);
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set());

  // Context viewer state
  const [activeContext, setActiveContext] = useState<{
    episodeTitle: string;
    episodeId: string;
    targetStartTime: number;
    chunks: ContextChunk[];
    loading: boolean;
  } | null>(null);

  // Audio player state
  const [currentAudio, setCurrentAudio] = useState<{
    url: string;
    title: string;
    episodeId: string;
    startTime: number;
    chunkId: string;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playSpeed, setPlaySpeed] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isInitialParse = useRef(true);

  // Stats state
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Admin stats state
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [adminPwInput, setAdminPwInput] = useState('');
  const [adminQueries, setAdminQueries] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');

  const handleLoadAdminQueries = async (pw = adminPwInput) => {
    if (!pw) return;
    setAdminLoading(true);
    setAdminError('');
    try {
      const res = await fetch(`/api/admin/stats?pw=${encodeURIComponent(pw)}`);
      if (!res.ok) {
        if (res.status === 401) throw new Error('Falsches Admin-Passwort!');
        throw new Error('Fehler beim Laden der Admin-Statistiken');
      }
      const data = await res.json();
      setAdminQueries(data.queries || []);
      setIsAdminUnlocked(true);
    } catch (err: any) {
      console.error(err);
      setAdminError(err.message || 'Ladefehler');
    } finally {
      setAdminLoading(false);
    }
  };

  // Browse state
  const [browseEpisodes, setBrowseEpisodes] = useState<BrowseEpisode[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseYear, setBrowseYear] = useState('all');
  const [browseSort, setBrowseSort] = useState<'newest' | 'oldest'>('newest');

  // Toast state
  const [toast, setToast] = useState<string | null>(null);

  // Match explanation state (key: result id)
  const [explanations, setExplanations] = useState<Record<string, {
    explanation: string;
    keywords: string[];
    loading: boolean;
  }>>({});

  // Categorized stats expanded state
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // ──── Autocomplete Suggestions Logic ────

  useEffect(() => {
    const fetchAllTitles = async () => {
      try {
        const res = await fetch('/api/episodes?page=1&perPage=250&year=all&sort=newest');
        if (res.ok) {
          const data = await res.json();
          const titles = (data.episodes || []).map((e: any) => e.title);
          setAllEpisodeTitles(titles);
        }
      } catch (err) {
        console.error('Failed to fetch titles for autocomplete:', err);
      }
    };
    fetchAllTitles();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getFilteredSuggestions = () => {
    if (!query.trim()) return [];
    const normalizedQuery = query.toLowerCase();
    
    const customTopics = [
      'Windkraft in den Alpen',
      'Föderalismus in Österreich',
      'Schweizer Direkte Demokratie',
      'René Benko',
      'Werbung und Sponsoring',
      'EU-Beitritt der Schweiz',
      'Inflation und Preise in der Schweiz',
      'Koalition in Deutschland',
      'Neutralität von Österreich und der Schweiz',
      'Olympische Spiele in der Schweiz'
    ];

    const matchedTopics = customTopics.filter(t => t.toLowerCase().includes(normalizedQuery));
    const matchedEpisodes = allEpisodeTitles.filter(t => t.toLowerCase().includes(normalizedQuery));
    
    return Array.from(new Set([...matchedTopics, ...matchedEpisodes])).slice(0, 8);
  };

  const filteredSuggestions = getFilteredSuggestions();

  // ──── Search Logic ────

  const handleSearch = async (
    searchQuery: string,
    currentType = searchType,
    currentSpeakers = selectedSpeakers,
    currentYear = selectedYear
  ): Promise<SearchResult[]> => {
    if (!searchQuery.trim()) return [];
    setLoading(true);
    setHasSearched(true);
    setSearchError(null);
    setExpandedEpisodes(new Set());
    setExplanations({});
    try {
      const speakersParam = currentSpeakers.join(',');
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}&type=${currentType}&speakers=${speakersParam}&year=${currentYear}`
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Search failed');
      }
      const data = await res.json();
      const searchResults = data.results || [];
      setResults(searchResults);
      setSearchMode(data.mode || '');
      setTotalOccurrences(typeof data.totalOccurrences === 'number' ? data.totalOccurrences : null);

      // Log search query for analytics asynchronously
      fetch('/api/log-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: searchQuery, type: currentType })
      }).catch(err => console.error('Failed to log search:', err));

      return searchResults;
    } catch (e: any) {
      console.error(e);
      setSearchError(e.message || 'Search failed');
      setResults([]);
      setTotalOccurrences(null);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(query);
  };

  const selectSuggestion = (sug: string) => {
    setQuery(sug);
    setActiveTab('search');
    handleSearch(sug);
  };

  useEffect(() => {
    if (hasSearched && query) {
      handleSearch(query, searchType, selectedSpeakers, selectedYear);
    }
  }, [searchType, selectedSpeakers, selectedYear]);

  // ──── Audio Logic ────

  const playChunk = (result: SearchResult | ContextChunk, episodeUrl: string, episodeTitle: string, episodeId: string) => {
    const isNewEpisode = !currentAudio || currentAudio.url !== episodeUrl;
    setCurrentAudio({
      url: episodeUrl,
      title: episodeTitle,
      episodeId,
      startTime: Number(result.start_time),
      chunkId: result.id
    });
    if (audioRef.current) {
      if (isNewEpisode) {
        audioRef.current.src = episodeUrl;
        audioRef.current.load();
      }
      audioRef.current.currentTime = Number(result.start_time);
      audioRef.current.playbackRate = playSpeed;
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(err => console.error('Audio playback error:', err));
    }
  };

  const showContext = async (result: SearchResult) => {
    setActiveContext({
      episodeTitle: result.title,
      episodeId: result.episode_id,
      targetStartTime: Number(result.start_time),
      chunks: [],
      loading: true
    });
    try {
      const res = await fetch(`/api/context?episode_id=${encodeURIComponent(result.episode_id)}&start_time=${result.start_time}`);
      if (!res.ok) throw new Error('Failed to load context');
      const data = await res.json();
      setActiveContext({
        episodeTitle: result.title,
        episodeId: result.episode_id,
        targetStartTime: Number(result.start_time),
        chunks: data.chunks || [],
        loading: false
      });
    } catch (e) {
      console.error(e);
      setActiveContext(null);
    }
  };

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 1.75, 2];
    const currentIndex = speeds.indexOf(playSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    const nextSpeed = speeds[nextIndex];
    setPlaySpeed(nextSpeed);
    if (audioRef.current) audioRef.current.playbackRate = nextSpeed;
  };

  const copyShareLink = (result: SearchResult) => {
    const origin = window.location.origin;
    const shareUrl = `${origin}?q=${encodeURIComponent(query)}&type=${searchType}&speakers=${selectedSpeakers.join(',')}&year=${selectedYear}&episode=${encodeURIComponent(result.episode_id)}&t=${Math.floor(result.start_time)}`;
    navigator.clipboard.writeText(shareUrl)
      .then(() => showToast('Deep-Link in die Zwischenablage kopiert!'))
      .catch(err => console.error('Deep link sharing failed:', err));
  };

  const explainMatch = async (result: SearchResult) => {
    if (explanations[result.id]) {
      setExplanations(prev => {
        const next = { ...prev };
        delete next[result.id];
        return next;
      });
      return;
    }

    setExplanations(prev => ({
      ...prev,
      [result.id]: { explanation: '', keywords: [], loading: true }
    }));

    try {
      const res = await fetch('/api/explain-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, content: result.content })
      });
      if (!res.ok) throw new Error('Explanation failed');
      const data = await res.json();
      setExplanations(prev => ({
        ...prev,
        [result.id]: {
          explanation: data.explanation,
          keywords: data.keywords || [],
          loading: false
        }
      }));
    } catch (e) {
      console.error(e);
      showToast('Konnte Erklärung nicht laden.');
      setExplanations(prev => {
        const next = { ...prev };
        delete next[result.id];
        return next;
      });
    }
  };

  const openInPlatform = (platform: 'spotify' | 'apple', result: SearchResult) => {
    const timeStr = formatTime(result.start_time);
    const platformName = platform === 'spotify' ? 'Spotify' : 'Apple Podcasts';
    navigator.clipboard.writeText(timeStr).catch(() => {});
    showToast(`Timecode ${timeStr} kopiert — öffne ${platformName}…`);
    const searchTerm = encodeURIComponent("Servus Grüezi Hallo " + result.title);
    const url = platform === 'spotify'
      ? `https://open.spotify.com/search/${searchTerm}`
      : `https://podcasts.apple.com/search?term=${searchTerm}`;
    setTimeout(() => window.open(url, '_blank'), 600);
  };

  // ──── Deep Linking & URL Sync ────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get('tab');
    const urlQuery = params.get('q');
    const urlType = params.get('type') as any;
    const urlSpeakers = params.get('speakers');
    const urlYear = params.get('year');
    const urlEpisode = params.get('episode');
    const urlTime = params.get('t');

    let finalType = searchType;
    let finalSpeakers = selectedSpeakers;
    let finalYear = selectedYear;

    if (urlTab && ['search', 'browse', 'stats', 'about'].includes(urlTab)) {
      setActiveTab(urlTab as any);
    }
    if (urlType) { setSearchType(urlType); finalType = urlType; setShowFilters(true); }
    if (urlSpeakers) { const p = urlSpeakers.split(','); setSelectedSpeakers(p); finalSpeakers = p; setShowFilters(true); }
    if (urlYear) { setSelectedYear(urlYear); finalYear = urlYear; setShowFilters(true); }

    if (urlQuery) {
      setQuery(urlQuery);
      handleSearch(urlQuery, finalType, finalSpeakers, finalYear).then((searchResults) => {
        if (urlEpisode && urlTime && searchResults?.length > 0) {
          const match = searchResults.find(r => r.episode_id === urlEpisode);
          if (match) {
            playChunk({ ...match, start_time: Number(urlTime) }, match.audio_url, match.title, match.episode_id);
          }
        }
      });
    } else if (urlEpisode && urlTime) {
      // Direct deep link to a specific quote/episode (without search query)
      fetch(`/api/episodes?id=${encodeURIComponent(urlEpisode)}`)
        .then(res => {
          if (!res.ok) throw new Error('Episode not found');
          return res.json();
        })
        .then(data => {
          const ep = data.episode;
          if (ep) {
            const mockResult = {
              id: `chunk-${urlTime}`,
              episode_id: ep.id,
              speaker: 'Sprecher',
              start_time: Number(urlTime),
              end_time: Number(urlTime) + 10,
              content: '',
              title: ep.title,
              audio_url: ep.audio_url,
              pub_date: ep.pub_date,
              similarity: 1.0
            };
            playChunk(mockResult, ep.audio_url, ep.title, ep.id);
            showContext(mockResult);
          }
        })
        .catch(err => console.error('Failed to load shared quote context:', err));
    }

    setTimeout(() => {
      isInitialParse.current = false;
    }, 500);
  }, []);

  // Sync state to URL search parameters live
  useEffect(() => {
    if (isInitialParse.current) return;

    const params = new URLSearchParams();
    if (activeTab !== 'search') {
      params.set('tab', activeTab);
    }
    if (query.trim()) {
      params.set('q', query.trim());
    }
    if (searchType !== 'semantic') {
      params.set('type', searchType);
    }
    if (selectedSpeakers.length !== 4) {
      params.set('speakers', selectedSpeakers.join(','));
    }
    if (selectedYear !== 'all') {
      params.set('year', selectedYear);
    }
    if (currentAudio?.episodeId) {
      params.set('episode', currentAudio.episodeId);
      params.set('t', Math.floor(currentAudio.startTime).toString());
    }

    const newSearch = params.toString();
    const newUrl = `${window.location.pathname}${newSearch ? '?' + newSearch : ''}`;
    window.history.replaceState(null, '', newUrl);
  }, [activeTab, query, searchType, selectedSpeakers, selectedYear, currentAudio?.episodeId, currentAudio?.startTime]);

  // Audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else {
      audioRef.current.playbackRate = playSpeed;
      audioRef.current.play().then(() => setIsPlaying(true)).catch(err => console.error(err));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTime = parseFloat(e.target.value);
    if (audioRef.current) { audioRef.current.currentTime = seekTime; setCurrentTime(seekTime); }
  };

  const isChunkActive = (result: SearchResult | ContextChunk, episodeId: string) => {
    if (!currentAudio || currentAudio.episodeId !== episodeId || !isPlaying) return false;
    return currentTime >= Number(result.start_time) && currentTime <= Number(result.end_time);
  };

  // ──── Stats Logic ────

  const STATS_CACHE_KEY = 'transalpine_stats_cache_v2';

  const loadStats = async () => {
    // Show cached stats instantly (from this browser session) instead of a
    // loading skeleton every time the tab is opened; the server itself
    // already caches for 24h, this just avoids the client round-trip too.
    try {
      const cached = sessionStorage.getItem(STATS_CACHE_KEY);
      if (cached) {
        setStats(JSON.parse(cached));
        return;
      }
    } catch { /* sessionStorage unavailable, fall through to fetch */ }

    setStatsLoading(true);
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setStats(data);
      try { sessionStorage.setItem(STATS_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore quota errors */ }
    } catch (e) { console.error(e); }
    finally { setStatsLoading(false); }
  };

  // ──── Browse Logic ────

  const loadEpisodes = async (page = 1, year = browseYear, sort = browseSort) => {
    setBrowseLoading(true);
    try {
      const res = await fetch(`/api/episodes?page=${page}&perPage=20&year=${year}&sort=${sort}`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setBrowseEpisodes(data.episodes);
      setBrowseTotal(data.total);
      setBrowsePage(page);
    } catch (e) { console.error(e); }
    finally { setBrowseLoading(false); }
  };

  // Load data when switching tabs
  useEffect(() => {
    if (activeTab === 'stats' && !stats) loadStats();
    if (activeTab === 'browse' && browseEpisodes.length === 0) loadEpisodes();
  }, [activeTab]);

  // ──── Grouped Results ────

  const episodeGroups = groupByEpisode(results);
  const currentEpisodeMatches = currentAudio
    ? results.filter(r => r.episode_id === currentAudio.episodeId)
    : [];
  const toggleEpisodeExpand = (episodeId: string) => {
    setExpandedEpisodes(prev => {
      const next = new Set(prev);
      if (next.has(episodeId)) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
  };

  const getPatriotismKing = () => {
    if (!stats?.hostWordCounts) return { value: 'Matthias Daum 🇨🇭', subtext: 'Lade...' };
    
    const chCount = stats.hostWordCounts
      .find(h => h.host.toLowerCase().includes('matthias'))
      ?.words.find(w => w.word === 'Schweiz')?.count || 0;
      
    const atCount = stats.hostWordCounts
      .find(h => h.host.toLowerCase().includes('florian'))
      ?.words.find(w => w.word === 'Österreich')?.count || 0;
      
    const deCount = stats.hostWordCounts
      .find(h => h.host.toLowerCase().includes('lenz'))
      ?.words.find(w => w.word === 'Deutschland')?.count || 0;
      
    let winner = 'Matthias Daum 🇨🇭';
    if (atCount > chCount && atCount > deCount) winner = 'Florian Gasser 🇦🇹';
    else if (deCount > chCount && deCount > atCount) winner = 'Lenz Jacobsen 🇩🇪';
    
    return {
      value: winner,
      subtext: `Matthias: ${chCount}x „Schweiz“ | Florian: ${atCount}x „Österreich“ | Lenz: ${deCount}x „Deutschland“`
    };
  };

  const getFavoriteDrink = () => {
    if (!stats?.keywordMentions) return { value: 'Bier 🍺', subtext: 'Lade...' };
    const bier = stats.keywordMentions.find(m => m.label.includes('Bier'))?.count || 0;
    const wein = stats.keywordMentions.find(m => m.label.includes('Wein'))?.count || 0;
    const kaffee = stats.keywordMentions.find(m => m.label.includes('Kaffee'))?.count || 0;
    
    let maxVal = 'Bier 🍺';
    if (wein > bier && wein > kaffee) maxVal = 'Wein 🍷';
    else if (kaffee > bier && kaffee > wein) maxVal = 'Kaffee ☕';
    
    return {
      value: maxVal,
      subtext: `Bier: ${bier}x, Wein: ${wein}x, Kaffee: ${kaffee}x`
    };
  };

  const getCleanQuery = (label: string): string => {
    return label
      .replace(/[^a-zA-Z0-9\säöüÄÖÜßéÉèÈàÀçÇíÍóÓúÚ\-\.]/g, '')
      .trim();
  };

  const hashString = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  };

  const stableShuffle = <T extends { label: string }>(arr: T[], seed: string): T[] => {
    return [...arr].sort((a, b) => {
      const hashA = hashString(a.label + seed);
      const hashB = hashString(b.label + seed);
      return hashA - hashB;
    });
  };

  const handleWordClick = (label: string) => {
    const cleanQuery = getCleanQuery(label);
    setQuery(cleanQuery);
    setActiveTab('search');
    handleSearch(cleanQuery);
    
    // Smooth scroll to search input container
    setTimeout(() => {
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        searchInput.focus();
      }
    }, 100);
  };

  const patriotismKing = getPatriotismKing();
  const favDrink = getFavoriteDrink();

  // ──────────────────────── RENDER ────────────────────────

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logoBadge}>DIE TRANSALPINE KI-SUCHE</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <Logo size={36} />
          <h1 className={styles.title}>Servus. Grüezi. Hallo.</h1>
        </div>
        <p className={styles.subtitle}>
          Die semantische Suchmaschine für den wöchentlichen transalpinen Podcast von ZEIT ONLINE.
          Finde Themen, Transkripte und Audio-Mitschritte sofort.
        </p>
        <div className={styles.platformBadges}>
          <a href="https://www.zeit.de/serie/servus-grueezi-hallo" target="_blank" rel="noopener noreferrer" className={styles.badgeZeit}>📰 ZEIT ONLINE</a>
          <a href="https://open.spotify.com/show/2Bv372138L5YjLhD1ZqK0L" target="_blank" rel="noopener noreferrer" className={styles.badgeSpotify}>🟢 Spotify</a>
          <a href="https://podcasts.apple.com/de/podcast/servus-gr%C3%BCezi-hallo/id1350410729" target="_blank" rel="noopener noreferrer" className={styles.badgeApple}>🍎 Apple Podcasts</a>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className={styles.tabNav}>
        <button
          className={`${styles.tabButton} ${activeTab === 'search' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('search')}
        >
          🔍 Suche
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'browse' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          📋 Alle Episoden
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'stats' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          📊 Statistiken
        </button>
        <button
          className={`${styles.tabButton} ${activeTab === 'about' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('about')}
        >
          ℹ️ Über das Projekt
        </button>
      </nav>

      <main className={styles.main}>

        {/* ════════════ SEARCH TAB ════════════ */}
        {activeTab === 'search' && (
          <>
            <section className={styles.searchSection}>
              <form onSubmit={onSubmit} className={styles.searchForm}>
                <div className={styles.searchContainer} ref={dropdownRef}>
                  <svg className={styles.searchIcon} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    id="search-input"
                    type="text"
                    className={styles.searchInput}
                    placeholder="z.B. Diskussionen über Windkraft in den Alpen..."
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    autoComplete="off"
                  />
                  <button type="submit" className={styles.searchButton} disabled={loading}>
                    {loading ? 'Suche...' : 'Finden'}
                  </button>

                  {/* Autocomplete Dropdown */}
                  {showSuggestions && filteredSuggestions.length > 0 && (
                    <div className={styles.autocompleteDropdown}>
                      {filteredSuggestions.map((sug, i) => (
                        <div
                          key={i}
                          className={styles.autocompleteItem}
                          onClick={() => {
                            setQuery(sug);
                            setShowSuggestions(false);
                            handleSearch(sug);
                          }}
                        >
                          <span className={styles.autocompleteIcon}>
                            {allEpisodeTitles.includes(sug) ? '📻' : '🏷️'}
                          </span>
                          <span className={styles.autocompleteText}>
                            {highlightText(sug, query)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </form>

              <div className={styles.suggestions}>
                <span className={styles.suggestionsLabel}>Häufig gesucht:</span>
                <div className={styles.suggestionsList}>
                  {SUGGESTIONS.map((sug) => (
                    <button key={sug} onClick={() => selectSuggestion(sug)} className={styles.suggestionTag} type="button">
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filter toggle */}
              <div className={styles.filterToggleRow}>
                <button
                  type="button"
                  className={`${styles.filterToggleBtn} ${showFilters ? styles.filterActive : ''}`}
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <svg className={styles.filterIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 8.293A1 1 0 013 7.586V4z" />
                  </svg>
                  Filter & Suchoptionen {showFilters ? 'ausblenden' : 'anzeigen'}
                </button>
              </div>

              {/* Filter panel */}
              {showFilters && (
                <div className={styles.filterPanel}>
                  <div className={styles.filterGroup}>
                    <span className={styles.filterLabel}>Suchmodus</span>
                    <div className={styles.segmentedControl}>
                      <button type="button" className={`${styles.segmentBtn} ${searchType === 'semantic' ? styles.activeSegment : ''}`} onClick={() => setSearchType('semantic')}>🔍 Sinnsuche (KI)</button>
                      <button type="button" className={`${styles.segmentBtn} ${searchType === 'exact' ? styles.activeSegment : ''}`} onClick={() => setSearchType('exact')}>🔤 Genaue Textsuche</button>
                      <button type="button" className={`${styles.segmentBtn} ${searchType === 'hybrid' ? styles.activeSegment : ''}`} onClick={() => setSearchType('hybrid')}>🔀 Hybrid-Suche</button>
                    </div>
                    <p className={styles.filterHint}>
                      {searchType === 'semantic' && 'Sucht nach dem Sinn und der Bedeutung Ihrer Frage (z.B. versteht Windkraft auch bei Nennung von Windrad oder erneuerbaren Energien).'}
                      {searchType === 'exact' && 'Sucht nach der exakten Zeichenkette in den Transkripten.'}
                      {searchType === 'hybrid' && 'Kombiniert KI-Sinnsuche und exakte Textsuche für präziseste Ergebnisse.'}
                    </p>
                  </div>

                  <div className={styles.filterRow}>
                    <div className={styles.filterGroup}>
                      <span className={styles.filterLabel}>Sprecher filtern</span>
                      <div className={styles.speakerChips}>
                        {[
                          { id: 'matthias', name: 'Matthias Daum', flag: '🇨🇭' },
                          { id: 'florian', name: 'Florian Gasser', flag: '🇦🇹' },
                          { id: 'lenz', name: 'Lenz Jacobsen', flag: '🇩🇪' },
                          { id: 'guest', name: 'Gäste', flag: '🎙️' }
                        ].map((sp) => {
                          const isSelected = selectedSpeakers.includes(sp.id);
                          return (
                            <button
                              key={sp.id}
                              type="button"
                              className={`${styles.speakerChip} ${isSelected ? styles.activeChip : ''}`}
                              onClick={() => {
                                if (isSelected) {
                                  if (selectedSpeakers.length > 1) setSelectedSpeakers(selectedSpeakers.filter(s => s !== sp.id));
                                } else {
                                  setSelectedSpeakers([...selectedSpeakers, sp.id]);
                                }
                              }}
                            >
                              <span className={styles.chipFlag}>{sp.flag}</span>
                              <span className={styles.chipName}>{sp.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className={styles.filterGroup}>
                      <span className={styles.filterLabel}>Zeitraum (Jahr)</span>
                      <select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className={styles.yearSelect}>
                        <option value="all">Alle Jahre</option>
                        <option value="2026">2026</option>
                        <option value="2025">2025</option>
                        <option value="2024">2024</option>
                        <option value="2023">2023</option>
                        <option value="2022">2022</option>
                        <option value="2021">2021</option>
                        <option value="2020">2020</option>
                        <option value="2019">2019</option>
                        <option value="2018">2018</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Mode Notification */}
            {searchMode && searchMode.startsWith('mock') && (
              <div className={styles.mockAlert}>
                <div className={styles.mockAlertIcon}>💡</div>
                <div>
                  <strong>Demo-Modus aktiv:</strong> Es sind keine API-Schlüssel hinterlegt.
                  Die Suchmaschine läuft mit synthetischen Beispieldaten.
                </div>
              </div>
            )}

            {/* Results Section — Grouped by Episode */}
            <section className={styles.resultsSection}>
              {loading && (
                <div className={styles.loadingContainer}>
                  <div className={styles.spinner}></div>
                  <p>KI durchsucht die Episoden-Transkripte...</p>
                </div>
              )}

              {!loading && !hasSearched && (
                <div className={styles.emptyState}>
                  <div className={styles.emptyStateIcon}>🎙️</div>
                  <h3>Bereit zur Suche</h3>
                  <p>Stelle komplexe Sinn-Fragen zum Podcast und springe direkt zu der Stelle, an der darüber gesprochen wurde.</p>
                </div>
              )}

              {!loading && hasSearched && searchError && (
                <div className={styles.errorState}>
                  <div className={styles.errorStateIcon}>⚠</div>
                  <h3>Die Suche hat gerade ein Problem</h3>
                  <p>Versuch's in ein paar Sekunden nochmal.</p>
                </div>
              )}

              {!loading && hasSearched && !searchError && results.length === 0 && (
                <div className={styles.emptyState}>
                  <div className={styles.emptyStateIcon}>🔍</div>
                  <h3>Keine passenden Segmente gefunden</h3>
                  <p>Versuche es mit anderen Begriffen oder einer breiteren Fragestellung.</p>
                </div>
              )}

              {!loading && episodeGroups.length > 0 && (
                <div className={styles.resultsGrid}>
                  <div className={styles.resultsHeader}>
                    <h2>{episodeGroups.length} Episode{episodeGroups.length !== 1 ? 'n' : ''} mit {results.length} Treffern</h2>
                    {totalOccurrences !== null && totalOccurrences > 0 && (
                      <p className={styles.resultsSubheader}>
                        „{query}“ wurde insgesamt {totalOccurrences.toLocaleString('de-DE')}x im Archiv gesagt
                      </p>
                    )}
                  </div>

                  <div className={styles.resultsList}>
                    {episodeGroups.map((group) => {
                      const isExpanded = expandedEpisodes.has(group.episode_id);
                      const relevanceScore = Math.round(group.chunks.length * group.avgSimilarity * 100);
                      const visibleChunks = isExpanded ? group.chunks : group.chunks.slice(0, 2);

                      return (
                        <div key={group.episode_id} className={styles.episodeGroupCard}>
                          {/* Episode Header */}
                          <div className={styles.episodeGroupHeader} onClick={() => toggleEpisodeExpand(group.episode_id)}>
                            <div className={styles.episodeGroupInfo}>
                              <h3 className={styles.episodeGroupTitle}>{group.title}</h3>
                              <span className={styles.episodeGroupDate}>{formatDate(group.pub_date)}</span>
                            </div>
                            <div className={styles.episodeGroupMeta}>
                              <div className={styles.relevanceMeter}>
                                <div className={styles.relevanceBar} style={{ width: `${Math.min(100, relevanceScore)}%` }} />
                              </div>
                              <span className={styles.chunkCountBadge}>{group.chunks.length} Treffer</span>
                              <span className={styles.expandArrow}>{isExpanded ? '▲' : '▼'}</span>
                            </div>
                          </div>

                          {/* Chunks inside episode */}
                          <div className={styles.episodeGroupChunks}>
                            {visibleChunks.map((result) => {
                              const active = isChunkActive(result, result.episode_id);
                              const isCurrentSource = currentAudio && currentAudio.chunkId === result.id;

                              return (
                                <div
                                  key={result.id}
                                  className={`${styles.chunkCard} ${active ? styles.activeCard : ''} ${isCurrentSource ? styles.selectedCard : ''}`}
                                >
                                  <div className={styles.chunkHeader}>
                                    <span className={`${styles.speakerBadge} ${getSpeakerClass(result.speaker)}`}>
                                      {getSpeakerDisplayName(result.speaker)}
                                    </span>
                                    <span className={styles.chunkTimestamp}>{formatTime(result.start_time)}</span>
                                    {(() => {
                                      const score = Math.round(result.similarity * 100);
                                      let relLabel = 'Relevanz hoch';
                                      let relClass = styles.relevanceHigh;
                                      let tooltip = 'Sehr hohe Übereinstimmung mit Ihrer Suchanfrage.';
                                      if (score < 70) {
                                        relLabel = 'Relevanz gering';
                                        relClass = styles.relevanceLow;
                                        tooltip = 'Möglicherweise ungenauer Treffer. Die Ähnlichkeit ist gering.';
                                      } else if (score < 80) {
                                        relLabel = 'Relevanz mittel';
                                        relClass = styles.relevanceMedium;
                                        tooltip = 'Mittelmäßige Übereinstimmung mit Ihrer Suchanfrage.';
                                      }
                                      return (
                                        <span className={`${styles.relevanceBadge} ${relClass}`} title={tooltip}>
                                          {relLabel} ({score}%)
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  <p className={styles.transcriptText}>
                                    {highlightText(result.content, query, explanations[result.id]?.keywords || [])}
                                  </p>
                                  <div className={styles.chunkActions}>
                                    <button onClick={() => playChunk(result, result.audio_url, result.title, result.episode_id)} className={styles.playButton}>
                                      <svg className={styles.playIcon} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                                      Anhören
                                    </button>
                                    <button onClick={() => showContext(result)} className={styles.contextButton}>Umfeld</button>
                                    <button onClick={() => openInPlatform('spotify', result)} className={styles.platformButton} title="In Spotify suchen">🟢 Spotify</button>
                                    <button onClick={() => openInPlatform('apple', result)} className={styles.platformButton} title="In Apple Podcasts suchen">🍎 Apple</button>
                                    <button onClick={() => copyShareLink(result)} className={styles.shareButton} title="Link kopieren">🔗</button>
                                    <button onClick={() => explainMatch(result)} className={`${styles.explainButton} ${explanations[result.id] ? styles.explainButtonActive : ''}`} title="Warum wurde dieser Abschnitt gefunden?">
                                      {explanations[result.id]?.loading ? (
                                        <span className={styles.explainSpinner}></span>
                                      ) : '🔍 Warum?'}
                                    </button>
                                  </div>

                                  {/* Match Explanation Box */}
                                  {explanations[result.id] && !explanations[result.id].loading && (
                                    <div className={styles.explainBox}>
                                      <p className={styles.explainText}>
                                        <strong>💡 Warum-Erklärung:</strong> {explanations[result.id].explanation}
                                      </p>
                                      {explanations[result.id].keywords && explanations[result.id].keywords.length > 0 && (
                                        <div className={styles.explainKeywordsRow}>
                                          <span className={styles.explainKeywordsLabel}>Vektormarkierungen:</span>
                                          <div className={styles.explainKeywordsList}>
                                            {explanations[result.id].keywords.map((kw, kwIdx) => (
                                              <span key={kwIdx} className={styles.explainKeywordTag}>{kw}</span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Show more / less */}
                          {group.chunks.length > 2 && (
                            <button className={styles.showMoreBtn} onClick={() => toggleEpisodeExpand(group.episode_id)}>
                              {isExpanded
                                ? `Weniger anzeigen`
                                : `${group.chunks.length - 2} weitere Treffer anzeigen`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {/* ════════════ BROWSE TAB ════════════ */}
        {activeTab === 'browse' && (
          <section className={styles.browseSection}>
            <div className={styles.browseHeader}>
              <h2>Alle indizierten Episoden</h2>
              <div className={styles.browseControls}>
                <select value={browseYear} onChange={(e) => { setBrowseYear(e.target.value); loadEpisodes(1, e.target.value, browseSort); }} className={styles.yearSelect}>
                  <option value="all">Alle Jahre</option>
                  <option value="2026">2026</option>
                  <option value="2025">2025</option>
                  <option value="2024">2024</option>
                  <option value="2023">2023</option>
                  <option value="2022">2022</option>
                </select>
                <button className={styles.sortBtn} onClick={() => { const next = browseSort === 'newest' ? 'oldest' : 'newest'; setBrowseSort(next); loadEpisodes(1, browseYear, next); }}>
                  {browseSort === 'newest' ? '↓ Neueste zuerst' : '↑ Älteste zuerst'}
                </button>
              </div>
            </div>

            {browseLoading ? (
              <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <p>Episoden werden geladen...</p>
              </div>
            ) : (
              <>
                <div className={styles.browseGrid}>
                  {browseEpisodes.map((ep) => (
                    <div key={ep.id} className={styles.browseCard}>
                      <div className={styles.browseCardTop}>
                        <h3 className={styles.browseTitle}>{ep.title}</h3>
                        <span className={styles.browseDate}>{formatDate(ep.pub_date)}</span>
                      </div>
                      <div className={styles.browseCardBottom}>
                        <span className={styles.browseChunks}>{ep.chunk_count} Transkript-Abschnitte</span>
                        <button className={styles.browseSearchBtn} onClick={() => { setQuery(ep.title.split(':').pop()?.trim() || ep.title); setActiveTab('search'); handleSearch(ep.title.split(':').pop()?.trim() || ep.title); }}>
                          🔍 In dieser Folge suchen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {browseTotal > 20 && (
                  <div className={styles.pagination}>
                    <button disabled={browsePage <= 1} onClick={() => loadEpisodes(browsePage - 1, browseYear, browseSort)} className={styles.pageBtn}>← Zurück</button>
                    <span className={styles.pageInfo}>Seite {browsePage} von {Math.ceil(browseTotal / 20)}</span>
                    <button disabled={browsePage >= Math.ceil(browseTotal / 20)} onClick={() => loadEpisodes(browsePage + 1, browseYear, browseSort)} className={styles.pageBtn}>Weiter →</button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ════════════ STATS TAB ════════════ */}
        {activeTab === 'stats' && (
          <section className={styles.statsSection}>
            {statsLoading ? (
              <div className={styles.bentoHero}>
                <div className={`${styles.bentoFeature} ${styles.skeleton}`} />
                <div className={`${styles.bentoTile} ${styles.skeleton}`} />
                <div className={`${styles.bentoTile} ${styles.skeleton}`} />
                <div className={`${styles.bentoTile} ${styles.skeleton}`} />
                <div className={`${styles.bentoTile} ${styles.skeleton}`} />
              </div>
            ) : stats ? (
              <>
                {/* ── Hero KPI Cards ── */}
                <div className={styles.heroWatermarkWrap}>
                  <svg className={styles.heroWatermark} viewBox="0 0 800 200" preserveAspectRatio="none">
                    <polygon points="0,200 100,60 180,140 260,20 340,110 420,50 500,150 580,70 660,130 740,40 800,90 800,200" fill="currentColor" />
                  </svg>
                  <div className={styles.bentoHero}>
                    <div className={styles.bentoFeature}>
                      <div className={styles.bentoFeatureLabel}>Archiv-Umfang</div>
                      <div className={styles.bentoFeatureNumber}>{stats.totalChunks.toLocaleString('de-DE')}</div>
                      <div className={styles.bentoFeatureSub}>Gesprächsfetzen aus {stats.totalEpisodes} Episoden</div>
                      <div className={styles.bentoFeatureFooter}>
                        <div>
                          <div className={styles.bentoFooterNumber}>{stats.totalDurationHours}h</div>
                          <div className={styles.bentoFooterLabel}>Audio</div>
                        </div>
                      </div>
                    </div>

                    <div className={styles.bentoTile}>
                      <div className={styles.bentoTileNumber}>{stats.totalEpisodes}</div>
                      <div className={styles.bentoTileLabel}>Episoden</div>
                    </div>

                    <div className={styles.bentoTile}>
                      <div className={styles.bentoTileNumber}>{stats.totalDurationHours}h</div>
                      <div className={styles.bentoTileLabel}>Audiomaterial</div>
                    </div>

                    {(() => {
                      const shares = Object.entries(stats.speakerDistribution || {}).filter(([n]) => n !== 'Gäste & Sonstige');
                      const total = shares.reduce((s, [, v]) => s + v, 0) || 1;
                      const leader = shares.sort((a, b) => b[1] - a[1])[0];
                      const flagFor = (name: string): 'CH' | 'AT' | 'DE' =>
                        name === 'Matthias Daum' ? 'CH' : name === 'Florian Gasser' ? 'AT' : 'DE';
                      if (!leader) return null;
                      return (
                        <div className={styles.bentoTile}>
                          <div className={styles.bentoTileHeader}>
                            <CountryFlag country={flagFor(leader[0])} size={16} />
                            <div className={styles.bentoTileNumber} style={{ fontSize: '1.1rem' }}>{leader[0].split(' ')[0]}</div>
                          </div>
                          <div className={styles.bentoTileLabel}>Redeanteil-Sieger ({Math.round((leader[1] / total) * 100)}%)</div>
                        </div>
                      );
                    })()}

                    {(() => {
                      const vocab = stats.vocabularySizes || [];
                      if (vocab.length === 0) return null;
                      const maxWords = Math.max(...vocab.map((v) => v.distinctWords), 1);
                      const flagFor = (name: string): 'CH' | 'AT' | 'DE' =>
                        name === 'Matthias Daum' ? 'CH' : name === 'Florian Gasser' ? 'AT' : 'DE';
                      return (
                        <div className={styles.bentoTile}>
                          <div className={styles.bentoTileLabel} style={{ marginTop: 0, marginBottom: '8px' }}>Wortschatz-Vergleich</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {vocab.map((v) => (
                              <div key={v.host} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <CountryFlag country={flagFor(v.host)} size={12} />
                                <div style={{ flex: 1, height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                                  <div style={{ width: `${(v.distinctWords / maxWords) * 100}%`, height: '100%', background: 'var(--accent-orange)' }} />
                                </div>
                                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', minWidth: '38px', textAlign: 'right' }}>
                                  {(v.distinctWords / 1000).toFixed(1)}k
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* ── Charts Row ── */}
                <div className={styles.chartsRow}>

                  {/* Donut Chart: Speaker Distribution */}
                  {stats.speakerDistribution && (() => {
                    const speakers = Object.entries(stats.speakerDistribution).filter(([, v]) => v > 0);
                    const total = speakers.reduce((s, [, v]) => s + v, 0);
                    const colors = ['#6ee7b7', '#93c5fd', '#fca5a5', '#fde68a'];
                    const labels = ['Matthias Daum', 'Florian Gasser', 'Lenz Jacobsen', 'Gäste & Sonstige'];
                    const flags = ['🇨🇭', '🇦🇹', '🇩🇪', '🎙️'];
                    let offset = 0;
                    const r = 54; const cx = 70; const cy = 70;
                    const slices = speakers.map(([name, count], i) => {
                      const pct = count / total;
                      const angle = pct * 360;
                      const startAngle = offset;
                      offset += angle;
                      const toRad = (d: number) => (d - 90) * Math.PI / 180;
                      const x1 = cx + r * Math.cos(toRad(startAngle));
                      const y1 = cy + r * Math.sin(toRad(startAngle));
                      const x2 = cx + r * Math.cos(toRad(startAngle + angle));
                      const y2 = cy + r * Math.sin(toRad(startAngle + angle));
                      const large = angle > 180 ? 1 : 0;
                      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
                      const color = colors[labels.indexOf(name)] ?? colors[i % colors.length];
                      return { name, count, pct, d, color };
                    });
                    return (
                      <div className={styles.chartCard}>
                        <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Redeanteil der Hosts</h3>
                        <div className={styles.donutWrapper}>
                          <svg width="140" height="140" viewBox="0 0 140 140">
                            {slices.map((s, i) => (
                              <path key={i} d={s.d} fill={s.color} opacity="0.9" />
                            ))}
                            <circle cx={cx} cy={cy} r="30" fill="var(--bg-secondary)" />
                            <text x={cx} y={cy + 5} textAnchor="middle" fontSize="11" fill="var(--text-secondary)">{stats.totalChunks.toLocaleString('de-DE')}</text>
                          </svg>
                          <div className={styles.donutLegend}>
                            {slices.map((s, i) => (
                              <div key={i} className={styles.donutLegendItem}>
                                <span className={styles.donutDot} style={{ background: s.color }} />
                                <span className={styles.donutName}>{flags[labels.indexOf(s.name)] ?? '🎙️'} {s.name}</span>
                                <span className={styles.donutPct}>{Math.round(s.pct * 100)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Vertical Bar Chart: Episodes per Year */}
                  <div className={styles.chartCard}>
                    <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Episoden nach Jahr</h3>
                    <div className={styles.barChartWrapper}>
                      {(() => {
                        const entries = Object.entries(stats.yearDistribution).sort(([a], [b]) => a.localeCompare(b));
                        const maxCount = Math.max(...entries.map(([, v]) => v));
                        return entries.map(([year, count]) => {
                          const height = (count / maxCount) * 100;
                          return (
                            <div key={year} className={styles.barCol}>
                              <span className={styles.barColCount}>{count}</span>
                              <div className={styles.barColTrack}>
                                <div className={styles.barColFill} style={{ height: `${height}%` }} />
                              </div>
                              <span className={styles.barColLabel}>{year}</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>

                {/* ── Speaker Trend comparison Chart ── */}
                {stats.speakerSharesByYear && (
                  <div className={styles.chartCard} style={{ marginTop: '24px' }}>
                    <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Sprechanteile im Jahresvergleich</h3>
                    <div className={styles.trendChartContainer}>
                      {Object.entries(stats.speakerSharesByYear).map(([year, shares]) => {
                        const total = Object.values(shares).reduce((a, b) => a + b, 0);
                        const colors = {
                          'Matthias Daum': '#6ee7b7',
                          'Florian Gasser': '#93c5fd',
                          'Lenz Jacobsen': '#fca5a5',
                          'Gäste & Sonstige': '#fde68a'
                        };
                        const flags = {
                          'Matthias Daum': '🇨🇭',
                          'Florian Gasser': '🇦🇹',
                          'Lenz Jacobsen': '🇩🇪',
                          'Gäste & Sonstige': '🎙️'
                        };
                        return (
                          <div key={year} className={styles.trendYearCol}>
                            <div className={styles.trendYearLabel}>{year}</div>
                            <div className={styles.stackedBarTrack}>
                              {Object.entries(shares).map(([name, count]) => {
                                const pct = total > 0 ? (count / total) * 100 : 0;
                                if (pct === 0) return null;
                                return (
                                  <div
                                    key={name}
                                    className={styles.stackedBarSegment}
                                    style={{
                                      height: `${pct}%`,
                                      backgroundColor: colors[name as keyof typeof colors] || '#ccc'
                                    }}
                                    title={`${flags[name as keyof typeof flags]} ${name}: ${Math.round(pct)}% (${count.toLocaleString('de-DE')} Abschnitte)`}
                                  >
                                    {pct > 12 && (
                                      <span className={styles.stackedBarText}>
                                        {flags[name as keyof typeof flags]} {Math.round(pct)}%
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Blick über die Grenze (Länder-Erwähnungen der Hosts) ── */}
                {stats.crossBorderMentions && (
                  <div className={styles.chartCard} style={{ marginTop: '24px' }}>
                    <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Blick über die Grenze</h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '-8px', marginBottom: '20px', lineHeight: '1.4' }}>
                      Wie oft blicken die Hosts über ihre eigenen Landesgrenzen? Diese Statistik zeigt das Verhältnis der Erwähnungen der jeweiligen Nachbarländer durch die einzelnen Hosts.
                    </p>
                    <div className={styles.inlineStatRow}>
                      <span className={styles.inlineStatLabel}>Eigenland-Erwähnungen (Spitzenreiter):</span>
                      <span className={styles.inlineStatValue}>{patriotismKing.value} — {patriotismKing.subtext}</span>
                    </div>
                    <div className={styles.crossBorderGrid}>
                      {/* Matthias Daum */}
                      {(() => {
                        const mentions = stats.crossBorderMentions['Matthias Daum'] || { 'Deutschland': 0, 'Österreich': 0 };
                        const de = mentions['Deutschland'] || 0;
                        const at = mentions['Österreich'] || 0;
                        const total = de + at || 1;
                        const dePct = (de / total) * 100;
                        const atPct = (at / total) * 100;
                        return (
                          <div className={styles.crossBorderRow}>
                            <div className={styles.hostWordsHeader}>
                              <div className={`${styles.hostAvatar} ${styles.hostAvatarMatthias}`}>🇨🇭</div>
                              <div className={styles.hostMeta}>
                                <span className={styles.hostName}>Matthias Daum</span>
                                <span className={styles.hostRole}>Blick nach DE & AT (Gesamt: {de + at}x)</span>
                              </div>
                            </div>
                            <div className={styles.crossBorderBarWrapper}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                                <span>🇩🇪 Deutschland ({de}x)</span>
                                <span>🇦🇹 Österreich ({at}x)</span>
                              </div>
                              <div className={styles.crossBorderBarTrack}>
                                <div style={{ width: `${dePct}%`, backgroundColor: '#fca5a5' }} className={styles.crossBorderBarFill} title={`Deutschland: ${Math.round(dePct)}% (${de}x)`} />
                                <div style={{ width: `${atPct}%`, backgroundColor: '#93c5fd' }} className={styles.crossBorderBarFill} title={`Österreich: ${Math.round(atPct)}% (${at}x)`} />
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Florian Gasser */}
                      {(() => {
                        const mentions = stats.crossBorderMentions['Florian Gasser'] || { 'Deutschland': 0, 'Schweiz': 0 };
                        const de = mentions['Deutschland'] || 0;
                        const ch = mentions['Schweiz'] || 0;
                        const total = de + ch || 1;
                        const dePct = (de / total) * 100;
                        const chPct = (ch / total) * 100;
                        return (
                          <div className={styles.crossBorderRow}>
                            <div className={styles.hostWordsHeader}>
                              <div className={`${styles.hostAvatar} ${styles.hostAvatarFlorian}`}>🇦🇹</div>
                              <div className={styles.hostMeta}>
                                <span className={styles.hostName}>Florian Gasser</span>
                                <span className={styles.hostRole}>Blick nach DE & CH (Gesamt: {de + ch}x)</span>
                              </div>
                            </div>
                            <div className={styles.crossBorderBarWrapper}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                                <span>🇩🇪 Deutschland ({de}x)</span>
                                <span>🇨🇭 Schweiz ({ch}x)</span>
                              </div>
                              <div className={styles.crossBorderBarTrack}>
                                <div style={{ width: `${dePct}%`, backgroundColor: '#fca5a5' }} className={styles.crossBorderBarFill} title={`Deutschland: ${Math.round(dePct)}% (${de}x)`} />
                                <div style={{ width: `${chPct}%`, backgroundColor: '#6ee7b7' }} className={styles.crossBorderBarFill} title={`Schweiz: ${Math.round(chPct)}% (${ch}x)`} />
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Lenz Jacobsen */}
                      {(() => {
                        const mentions = stats.crossBorderMentions['Lenz Jacobsen'] || { 'Österreich': 0, 'Schweiz': 0 };
                        const at = mentions['Österreich'] || 0;
                        const ch = mentions['Schweiz'] || 0;
                        const total = at + ch || 1;
                        const atPct = (at / total) * 100;
                        const chPct = (ch / total) * 100;
                        return (
                          <div className={styles.crossBorderRow}>
                            <div className={styles.hostWordsHeader}>
                              <div className={`${styles.hostAvatar} ${styles.hostAvatarLenz}`}>🇩🇪</div>
                              <div className={styles.hostMeta}>
                                <span className={styles.hostName}>Lenz Jacobsen</span>
                                <span className={styles.hostRole}>Blick nach AT & CH (Gesamt: {at + ch}x)</span>
                              </div>
                            </div>
                            <div className={styles.crossBorderBarWrapper}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                                <span>🇦🇹 Österreich ({at}x)</span>
                                <span>🇨🇭 Schweiz ({ch}x)</span>
                              </div>
                              <div className={styles.crossBorderBarTrack}>
                                <div style={{ width: `${atPct}%`, backgroundColor: '#93c5fd' }} className={styles.crossBorderBarFill} title={`Österreich: ${Math.round(atPct)}% (${at}x)`} />
                                <div style={{ width: `${chPct}%`, backgroundColor: '#6ee7b7' }} className={styles.crossBorderBarFill} title={`Schweiz: ${Math.round(chPct)}% (${ch}x)`} />
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}



                {/* ── Das transalpine Wortgewitter (Interaktive Wortwolke) ── */}
                {stats.topWords && stats.topWords.length > 0 && (
                  <div className={styles.chartCard} style={{ marginTop: '24px' }}>
                    <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Das transalpine Wortgewitter</h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '-8px', marginBottom: '20px', lineHeight: '1.4' }}>
                      Die tatsächlich meistgesagten Wörter im gesamten Podcast-Archiv (Füllwörter ausgenommen). Die Schriftgröße zeigt die Häufigkeit der Nennung. Ein Klick startet direkt eine Echtzeit-Suche!
                    </p>
                    <div className={styles.inlineStatRow}>
                      <span className={styles.inlineStatLabel}>Meistgenanntes Getränk:</span>
                      <span className={styles.inlineStatValue}>{favDrink.value} — {favDrink.subtext}</span>
                    </div>
                    <div className={styles.wordCloudWrapper}>
                      {(() => {
                        const items = stableShuffle(
                          stats.topWords.map((w) => ({ label: w.word, count: w.count })),
                          'servus-gruezi-hallo-wordcloud'
                        );
                        const counts = items.map((m) => m.count);
                        const maxCount = Math.max(...counts, 1);
                        const minCount = Math.min(...counts, 0);
                        return items.map((item, idx) => {
                          const ratio = maxCount > minCount ? (item.count - minCount) / (maxCount - minCount) : 0.5;
                          const fontSize = `${0.85 + ratio * 1.65}rem`;
                          const opacity = 0.6 + ratio * 0.4;
                          return (
                            <span
                              key={idx}
                              className={styles.wordTag}
                              style={{
                                fontSize,
                                color: 'var(--accent-gold)',
                                opacity,
                                border: '1px solid rgba(var(--accent-gold-rgb), 0.15)',
                              }}
                              onClick={() => handleWordClick(item.label)}
                              title={`"${item.label}" wurde ${item.count}x gesagt. Klick zum Suchen.`}
                            >
                              {item.label}
                              <span className={styles.wordCountBadge}>{item.count}</span>
                            </span>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {/* ── Typische Wörter der Hosts (Vokabular-Vergleich) ── */}
                {stats.hostWordCounts && stats.hostWordCounts.length > 0 && (
                  <div className={styles.chartCard} style={{ marginTop: '24px' }}>
                    <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Typische Wörter der Hosts</h3>
                    <div className={styles.hostWordsColumns}>
                      {stats.hostWordCounts.map((group, idx) => {
                        // Determine host specific styles and details
                        const isMatthias = group.host.toLowerCase().includes('matthias');
                        const isFlorian = group.host.toLowerCase().includes('florian');
                        const isLenz = group.host.toLowerCase().includes('lenz');
                        
                        let flag = '🎙️';
                        let country = 'Gast';
                        let fillClass = styles.hostWordFill;
                        let avatarClass = styles.hostAvatar;

                        if (isMatthias) {
                          flag = '🇨🇭';
                          country = 'Schweiz';
                          fillClass = `${styles.hostWordFill} ${styles.fillMatthias}`;
                          avatarClass = `${styles.hostAvatar} ${styles.hostAvatarMatthias}`;
                        } else if (isFlorian) {
                          flag = '🇦🇹';
                          country = 'Österreich';
                          fillClass = `${styles.hostWordFill} ${styles.fillFlorian}`;
                          avatarClass = `${styles.hostAvatar} ${styles.hostAvatarFlorian}`;
                        } else if (isLenz) {
                          flag = '🇩🇪';
                          country = 'Deutschland';
                          fillClass = `${styles.hostWordFill} ${styles.fillLenz}`;
                          avatarClass = `${styles.hostAvatar} ${styles.hostAvatarLenz}`;
                        }

                        const maxHostCount = Math.max(...group.words.map(w => w.count), 1);

                        return (
                          <div key={idx} className={styles.hostWordsCol}>
                            <div className={styles.hostWordsHeader}>
                              <div className={avatarClass}>
                                {flag}
                              </div>
                              <div className={styles.hostMeta}>
                                <span className={styles.hostName}>{group.host}</span>
                                <span className={styles.hostRole}>{country}</span>
                              </div>
                            </div>
                            <div className={styles.hostWordsList}>
                              {group.words.map((w, wIdx) => {
                                const wordPct = (w.count / maxHostCount) * 100;
                                return (
                                  <div key={wIdx} className={styles.hostWordItem}>
                                    <div className={styles.hostWordTextRow}>
                                      <span className={styles.hostWordLabel}>{w.word}</span>
                                      <span className={styles.hostWordCount}>{w.count}x</span>
                                    </div>
                                    <div className={styles.hostWordTrack}>
                                      <div className={fillClass} style={{ width: `${wordPct}%` }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Transalpine Duelle ── */}
                {stats.keywordMentions && stats.hostWordCounts && (
                  <div className={styles.chartCard} style={{ marginTop: '24px' }}>
                    <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Transalpine Sprach- & Kulturduelle</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      
                      {/* Duel 1: Velo vs. Fahrrad */}
                      {(() => {
                        const velo = stats.keywordMentions.find(m => m.label.includes('Velo'))?.count || 0;
                        const fahrrad = stats.keywordMentions.find(m => m.label.includes('Fahrrad'))?.count || 0;
                        const total = velo + fahrrad || 1;
                        const veloPct = (velo / total) * 100;
                        const fahrradPct = (fahrrad / total) * 100;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600 }}>
                              <span>🇨🇭 Schweizer Velo ({velo}x)</span>
                              <span style={{ color: 'var(--text-muted)' }}>vs.</span>
                              <span>🇩🇪/🇦🇹 Fahrrad ({fahrrad}x)</span>
                            </div>
                            <div style={{ height: '24px', borderRadius: '12px', overflow: 'hidden', display: 'flex', background: 'rgba(255, 255, 255, 0.05)' }}>
                              <div style={{ width: `${veloPct}%`, background: '#6ee7b7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {veloPct > 15 && `Velo ${Math.round(veloPct)}%`}
                              </div>
                              <div style={{ width: `${fahrradPct}%`, background: '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {fahrradPct > 15 && `Fahrrad ${Math.round(fahrradPct)}%`}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Duel 2: Kanton vs. Bundesland */}
                      {(() => {
                        const kanton = stats.keywordMentions.find(m => m.label.includes('Kanton'))?.count || 0;
                        const bundesland = stats.keywordMentions.find(m => m.label.includes('Bundesland'))?.count || 0;
                        const total = kanton + bundesland || 1;
                        const kantonPct = (kanton / total) * 100;
                        const bundeslandPct = (bundesland / total) * 100;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600 }}>
                              <span>🇨🇭 Kanton ({kanton}x)</span>
                              <span style={{ color: 'var(--text-muted)' }}>vs.</span>
                              <span>🇩🇪/🇦🇹 Bundesland ({bundesland}x)</span>
                            </div>
                            <div style={{ height: '24px', borderRadius: '12px', overflow: 'hidden', display: 'flex', background: 'rgba(255, 255, 255, 0.05)' }}>
                              <div style={{ width: `${kantonPct}%`, background: '#6ee7b7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {kantonPct > 15 && `Kanton ${Math.round(kantonPct)}%`}
                              </div>
                              <div style={{ width: `${bundeslandPct}%`, background: '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {bundeslandPct > 15 && `Bundesland ${Math.round(bundeslandPct)}%`}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Duel 3: Matura vs. Abitur */}
                      {(() => {
                        const matura = stats.keywordMentions.find(m => m.label.includes('Matura'))?.count || 0;
                        const abitur = stats.keywordMentions.find(m => m.label.includes('Abitur'))?.count || 0;
                        const total = matura + abitur || 1;
                        const maturaPct = (matura / total) * 100;
                        const abiturPct = (abitur / total) * 100;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600 }}>
                              <span>🇦🇹/🇨🇭 Matura ({matura}x)</span>
                              <span style={{ color: 'var(--text-muted)' }}>vs.</span>
                              <span>🇩🇪 Abitur ({abitur}x)</span>
                            </div>
                            <div style={{ height: '24px', borderRadius: '12px', overflow: 'hidden', display: 'flex', background: 'rgba(255, 255, 255, 0.05)' }}>
                              <div style={{ width: `${maturaPct}%`, background: '#93c5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {maturaPct > 15 && `Matura ${Math.round(maturaPct)}%`}
                              </div>
                              <div style={{ width: `${abiturPct}%`, background: '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {abiturPct > 15 && `Abitur ${Math.round(abiturPct)}%`}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Duel 4: Spital vs. Krankenhaus */}
                      {(() => {
                        const spital = stats.keywordMentions.find(m => m.label.includes('Spital'))?.count || 0;
                        const krankenhaus = stats.keywordMentions.find(m => m.label.includes('Krankenhaus'))?.count || 0;
                        const total = spital + krankenhaus || 1;
                        const spitalPct = (spital / total) * 100;
                        const krankenhausPct = (krankenhaus / total) * 100;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600 }}>
                              <span>🇦🇹/🇨🇭 Spital ({spital}x)</span>
                              <span style={{ color: 'var(--text-muted)' }}>vs.</span>
                              <span>🇩🇪 Krankenhaus ({krankenhaus}x)</span>
                            </div>
                            <div style={{ height: '24px', borderRadius: '12px', overflow: 'hidden', display: 'flex', background: 'rgba(255, 255, 255, 0.05)' }}>
                              <div style={{ width: `${spitalPct}%`, background: '#6ee7b7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {spitalPct > 15 && `Spital ${Math.round(spitalPct)}%`}
                              </div>
                              <div style={{ width: `${krankenhausPct}%`, background: '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {krankenhausPct > 15 && `Krankenhaus ${Math.round(krankenhausPct)}%`}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Duel 5: Bier vs. Wein vs. Kaffee */}
                      {(() => {
                        const bier = stats.keywordMentions.find(m => m.label.includes('Bier'))?.count || 0;
                        const wein = stats.keywordMentions.find(m => m.label.includes('Wein'))?.count || 0;
                        const kaffee = stats.keywordMentions.find(m => m.label.includes('Kaffee'))?.count || 0;
                        const total = bier + wein + kaffee || 1;
                        const bierPct = (bier / total) * 100;
                        const weinPct = (wein / total) * 100;
                        const kaffeePct = (kaffee / total) * 100;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600 }}>
                              <span>🍺 Bier ({bier}x)</span>
                              <span>🍷 Wein ({wein}x)</span>
                              <span>☕ Kaffee ({kaffee}x)</span>
                            </div>
                            <div style={{ height: '24px', borderRadius: '12px', overflow: 'hidden', display: 'flex', background: 'rgba(255, 255, 255, 0.05)' }}>
                              <div style={{ width: `${bierPct}%`, background: '#fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {bierPct > 15 && `Bier ${Math.round(bierPct)}%`}
                              </div>
                              <div style={{ width: `${weinPct}%`, background: '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {weinPct > 15 && `Wein ${Math.round(weinPct)}%`}
                              </div>
                              <div style={{ width: `${kaffeePct}%`, background: '#d1b999', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {kaffeePct > 15 && `Kaffee ${Math.round(kaffeePct)}%`}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Duel 6: Bahn 🚄 vs. Auto 🚗 */}
                      {(() => {
                        const bahn = stats.keywordMentions.find(m => m.label.includes('Bahn'))?.count || 0;
                        const auto = stats.keywordMentions.find(m => m.label.includes('Auto'))?.count || 0;
                        const total = bahn + auto || 1;
                        const bahnPct = (bahn / total) * 100;
                        const autoPct = (auto / total) * 100;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600 }}>
                              <span>🚄 Bahn ({bahn}x)</span>
                              <span style={{ color: 'var(--text-muted)' }}>vs.</span>
                              <span>🚗 Auto ({auto}x)</span>
                            </div>
                            <div style={{ height: '24px', borderRadius: '12px', overflow: 'hidden', display: 'flex', background: 'rgba(255, 255, 255, 0.05)' }}>
                              <div style={{ width: `${bahnPct}%`, background: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {bahnPct > 15 && `Bahn ${Math.round(bahnPct)}%`}
                              </div>
                              <div style={{ width: `${autoPct}%`, background: '#fb7185', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {autoPct > 15 && `Auto ${Math.round(autoPct)}%`}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Duel 7: Käse 🧀 vs. Schnitzel 🥩 vs. Wurst 🌭 */}
                      {(() => {
                        const kaese = stats.keywordMentions.find(m => m.label.includes('Käse'))?.count || 0;
                        const schnitzel = stats.keywordMentions.find(m => m.label.includes('Schnitzel'))?.count || 0;
                        const wurst = stats.keywordMentions.find(m => m.label.includes('Wurst'))?.count || 0;
                        const total = kaese + schnitzel + wurst || 1;
                        const kaesePct = (kaese / total) * 100;
                        const schnitzelPct = (schnitzel / total) * 100;
                        const wurstPct = (wurst / total) * 100;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600 }}>
                              <span>🧀 Käse ({kaese}x)</span>
                              <span>🥩 Schnitzel ({schnitzel}x)</span>
                              <span>🌭 Wurst ({wurst}x)</span>
                            </div>
                            <div style={{ height: '24px', borderRadius: '12px', overflow: 'hidden', display: 'flex', background: 'rgba(255, 255, 255, 0.05)' }}>
                              <div style={{ width: `${kaesePct}%`, background: '#fbbf24', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {kaesePct > 15 && `Käse ${Math.round(kaesePct)}%`}
                              </div>
                              <div style={{ width: `${schnitzelPct}%`, background: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {schnitzelPct > 15 && `Schnitzel ${Math.round(schnitzelPct)}%`}
                              </div>
                              <div style={{ width: `${wurstPct}%`, background: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {wurstPct > 15 && `Wurst ${Math.round(wurstPct)}%`}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Duel 8: Deutschland 🇩🇪 vs. Österreich 🇦🇹 vs. Schweiz 🇨🇭 (Länder-Nennungen) */}
                      {(() => {
                        const de = stats.keywordMentions.find(m => m.label.includes('Deutschland'))?.count || 0;
                        const at = stats.keywordMentions.find(m => m.label.includes('Österreich'))?.count || 0;
                        const ch = stats.keywordMentions.find(m => m.label.includes('Schweiz'))?.count || 0;
                        const total = de + at + ch || 1;
                        const dePct = (de / total) * 100;
                        const atPct = (at / total) * 100;
                        const chPct = (ch / total) * 100;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: 600 }}>
                              <span>🇩🇪 Deutschland ({de}x)</span>
                              <span>🇦🇹 Österreich ({at}x)</span>
                              <span>🇨🇭 Schweiz ({ch}x)</span>
                            </div>
                            <div style={{ height: '24px', borderRadius: '12px', overflow: 'hidden', display: 'flex', background: 'rgba(255, 255, 255, 0.05)' }}>
                              <div style={{ width: `${dePct}%`, background: '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {dePct > 15 && `DE ${Math.round(dePct)}%`}
                              </div>
                              <div style={{ width: `${atPct}%`, background: '#93c5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {atPct > 15 && `AT ${Math.round(atPct)}%`}
                              </div>
                              <div style={{ width: `${chPct}%`, background: '#6ee7b7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#1a1612', transition: 'width 1s ease' }}>
                                {chPct > 15 && `CH ${Math.round(chPct)}%`}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                    </div>
                  </div>
                )}

                {/* ── Ja, Nein & Aber ── */}
                {stats.yesNoButCounts && stats.yesNoButCounts.length > 0 && (
                  <div className={styles.chartCard} style={{ marginTop: '24px' }}>
                    <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Ja, Nein & Aber</h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '-8px', marginBottom: '20px', lineHeight: '1.4' }}>
                      Wer stimmt am häufigsten zu, wer widerspricht am meisten, und wer relativiert am liebsten mit einem "aber"?
                    </p>
                    <div className={styles.hostWordsColumns}>
                      {stats.yesNoButCounts.map((row) => {
                        const flag: 'CH' | 'AT' | 'DE' =
                          row.host === 'Matthias Daum' ? 'CH' : row.host === 'Florian Gasser' ? 'AT' : 'DE';
                        const maxVal = Math.max(row.ja, row.nein, row.aber, 1);
                        return (
                          <div key={row.host} className={styles.hostWordsCol}>
                            <div className={styles.hostWordsHeader}>
                              <div className={styles.hostAvatar}><CountryFlag country={flag} size={18} /></div>
                              <div className={styles.hostMeta}>
                                <span className={styles.hostName}>{row.host}</span>
                              </div>
                            </div>
                            <div className={styles.hostWordsList}>
                              {([['Ja', row.ja], ['Nein', row.nein], ['Aber', row.aber]] as [string, number][]).map(([label, count]) => (
                                <div key={label} className={styles.hostWordItem}>
                                  <div className={styles.hostWordTextRow}>
                                    <span className={styles.hostWordLabel}>{label}</span>
                                    <span className={styles.hostWordCount}>{count}x</span>
                                  </div>
                                  <div className={styles.hostWordTrack}>
                                    <div className={styles.hostWordFill} style={{ width: `${(count / maxVal) * 100}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Latest / Oldest ── */}
                <div className={styles.statsFoot}>
                  {stats.latestEpisode && (
                    <div className={styles.statsFootItem}>
                      <span className={styles.statsFootLabel}>🆕 Neueste Folge</span>
                      <span className={styles.statsFootValue}>{stats.latestEpisode.title}</span>
                      <span className={styles.statsFootDate}>{formatDate(stats.latestEpisode.pub_date)}</span>
                    </div>
                  )}
                  {stats.oldestEpisode && (
                    <div className={styles.statsFootItem}>
                      <span className={styles.statsFootLabel}>🏛️ Älteste Folge</span>
                      <span className={styles.statsFootValue}>{stats.oldestEpisode.title}</span>
                      <span className={styles.statsFootDate}>{formatDate(stats.oldestEpisode.pub_date)}</span>
                    </div>
                  )}
                </div>

                <button className={styles.refreshBtn} onClick={loadStats}>↻ Statistiken aktualisieren</button>

                {/* ── Admin Area: Search Trends ── */}
                <div className={styles.adminSectionWrapper} style={{ marginTop: '40px', borderTop: '1px dashed rgba(255, 255, 255, 0.08)', paddingTop: '30px' }}>
                  {!isAdminUnlocked ? (
                    <div style={{ textAlign: 'center', padding: '20px' }}>
                      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        🔒 Dieser Bereich ist nur für den Projekt-Administrator einsehbar.
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', maxWidth: '320px', margin: '0 auto' }}>
                        <input
                          type="password"
                          placeholder="Admin-Passwort (admin123)"
                          value={adminPwInput}
                          onChange={(e) => setAdminPwInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleLoadAdminQueries()}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            color: '#fff',
                            fontSize: '0.85rem'
                          }}
                        />
                        <button
                          onClick={() => handleLoadAdminQueries()}
                          className={styles.primaryButton}
                          style={{ padding: '8px 16px', fontSize: '0.85rem', cursor: 'pointer' }}
                        >
                          {adminLoading ? 'Lade...' : 'Freischalten'}
                        </button>
                      </div>
                      {adminError && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '8px' }}>{adminError}</p>}
                    </div>
                  ) : (
                    <div>
                      <h3 className={styles.chartTitle} style={{ fontSize: '1.2rem', marginBottom: '8px' }}>⚙️ Admin-Ansicht: Beliebte Suchanfragen (Top 30)</h3>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '-4px', marginBottom: '20px', lineHeight: '1.4' }}>
                        Diese Liste zeigt anonymisiert und nach Häufigkeit sortiert, nach welchen Begriffen deine Website-Besucher gesucht haben (aus den letzten 2000 Abfragen).
                      </p>
                      {adminQueries.length === 0 ? (
                        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', textAlign: 'center', padding: '20px', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                          Bisher wurden keine Suchanfragen protokolliert.
                        </p>
                      ) : (
                        <div style={{ overflowX: 'auto', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)', padding: '10px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', textAlign: 'left', color: 'var(--text-muted)' }}>
                                <th style={{ padding: '10px' }}>Suchbegriff</th>
                                <th style={{ padding: '10px', textAlign: 'center' }}>Häufigkeit</th>
                                <th style={{ padding: '10px' }}>Suchmodi</th>
                                <th style={{ padding: '10px', textAlign: 'right' }}>Zuletzt gesucht</th>
                              </tr>
                            </thead>
                            <tbody>
                              {adminQueries.map((item, idx) => (
                                <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                                  <td style={{ padding: '10px', fontWeight: 600, color: 'var(--accent-gold)' }}>
                                    "{item.query}"
                                  </td>
                                  <td style={{ padding: '10px', textAlign: 'center' }}>
                                    <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 700 }}>
                                      {item.count}x
                                    </span>
                                  </td>
                                  <td style={{ padding: '10px', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                                    {item.types.join(', ')}
                                  </td>
                                  <td style={{ padding: '10px', textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {new Date(item.last_searched).toLocaleString('de-DE')}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div style={{ textAlign: 'right', marginTop: '12px' }}>
                        <button
                          onClick={() => setIsAdminUnlocked(false)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            textDecoration: 'underline'
                          }}
                        >
                          Statistiken sperren / Abmelden
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>📊</div>
                <h3>Statistiken konnten nicht geladen werden</h3>
              </div>
            )}
          </section>
        )}

        {/* ════════════ ABOUT TAB ════════════ */}
        {activeTab === 'about' && (
          <section className={styles.statsSection}>
            <div className={styles.chartCard}>
              <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Über dieses Projekt</h3>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: '1.7', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p>
                  Das hier ist ein privates Hobbyprojekt — keine offizielle Seite von ZEIT ONLINE oder den Podcast-Machern.
                  Es durchsucht das komplette Archiv von <strong>„Servus. Grüezi. Hallo.“</strong>, dem transalpinen Politikpodcast
                  von Matthias Daum, Florian Gasser und Lenz Jacobsen.
                </p>
                <p>
                  <strong>Wie es funktioniert:</strong> Jede Folge wird automatisch transkribiert (Deepgram), in Gesprächsabschnitte
                  zerlegt und wer spricht per KI-Heuristik geschätzt. Für die Sinnsuche wird jeder Abschnitt in einen Vektor
                  (OpenAI-Embedding) umgewandelt; deine Suchanfrage wird genauso umgewandelt und die ähnlichsten Abschnitte
                  werden gefunden — daher funktioniert die Suche auch, wenn du nicht die exakten Wörter aus der Folge triffst.
                </p>
                <p>
                  <strong>Ein paar ehrliche Einschränkungen:</strong> Die automatische Sprechererkennung ist nicht perfekt —
                  gelegentlich wird ein Satz dem falschen Host zugeordnet, besonders bei schnellen Wortwechseln. Datumsangaben
                  bei älteren Folgen beruhen teils auf Bestmatch-Vergleichen mit Artikeltiteln und können leicht daneben liegen.
                  Die Statistiken auf der Stats-Seite sind zum Spaß gedacht, nicht als wissenschaftliche Auswertung.
                </p>
                <p style={{ marginTop: '6px' }}>
                  <a href="https://github.com/blumleo2004/transalpine-search" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-gold)' }}>
                    GitHub Repository
                  </a>
                  {' · '}
                  <a href="mailto:blumleo2004@gmail.com" style={{ color: 'var(--accent-gold)' }}>
                    blumleo2004@gmail.com
                  </a>
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Context Modal */}
      {activeContext && (
        <div className={styles.modalOverlay} onClick={() => setActiveContext(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.modalMeta}>Transkript-Ausschnitt</span>
                <h3 className={styles.modalTitle}>{activeContext.episodeTitle}</h3>
              </div>
              <button className={styles.closeModal} onClick={() => setActiveContext(null)}>&times;</button>
            </div>
            <div className={styles.modalBody}>
              {activeContext.loading ? (
                <div className={styles.modalLoading}><div className={styles.spinner}></div><p>Lade Kontext-Transkript...</p></div>
              ) : (
                <div className={styles.contextStream}>
                  {activeContext.chunks.map((chunk) => {
                    const active = isChunkActive(chunk, activeContext.episodeId);
                    return (
                      <div key={chunk.id} className={`${styles.contextChunk} ${chunk.is_target ? styles.contextTarget : ''} ${active ? styles.contextActive : ''}`}>
                        <div className={styles.contextChunkMeta}>
                          <span className={`${styles.speakerBadge} ${getSpeakerClass(chunk.speaker)}`}>{getSpeakerDisplayName(chunk.speaker)}</span>
                          <span className={styles.chunkTime}>{formatTime(chunk.start_time)}</span>
                          <button
                            onClick={() => {
                              const origResult = results.find(r => r.episode_id === activeContext.episodeId);
                              if (origResult) playChunk(chunk, origResult.audio_url, activeContext.episodeTitle, activeContext.episodeId);
                            }}
                            className={styles.miniPlay}
                            title="Ab dieser Sekunde abspielen"
                          >▶</button>
                        </div>
                        <p className={styles.contextChunkText}>{chunk.content}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className={styles.modalFooter}>
              <p className={styles.modalHint}>Der Text wird abschnittsweise dargestellt. Der farbige Block markiert die Fundstelle der Suche.</p>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={styles.toast}>
          <span>{toast}</span>
        </div>
      )}

      {/* Hidden audio element */}
      <audio ref={audioRef} preload="metadata" />

      {/* Bottom Audio Player Dock */}
      {currentAudio && (
        <div className={styles.playerDock}>
          <div className={styles.playerContent}>
            <div className={styles.playerEpisodeInfo}>
              <div className={styles.playerPlayingIndicator}>
                <div className={`${styles.playingBar} ${isPlaying ? styles.animPlaying : ''}`}></div>
                <div className={`${styles.playingBar} ${isPlaying ? styles.animPlaying : ''}`}></div>
                <div className={`${styles.playingBar} ${isPlaying ? styles.animPlaying : ''}`}></div>
              </div>
              <div>
                <h4 className={styles.playerEpisodeTitle}>{currentAudio.title}</h4>
                <p className={styles.playerTimeline}>Gesprächsabschnitt ab {formatTime(currentAudio.startTime)}</p>
              </div>
            </div>
            <div className={styles.playerControls}>
              <button onClick={togglePlay} className={styles.playerPlayBtn} aria-label={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? (
                  <svg className={styles.playerPlayIcon} viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                ) : (
                  <svg className={styles.playerPlayIcon} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>
              <div className={styles.playerProgressContainer}>
                <span className={styles.timeLabel}>{formatTime(currentTime)}</span>
                <div className={styles.progressBarWrapper}>
                  <input type="range" min="0" max={duration || 100} value={currentTime} onChange={handleSeek} className={styles.progressBar} />
                  {duration > 0 && currentEpisodeMatches.map((match) => {
                    const percentage = (match.start_time / duration) * 100;
                    return (
                      <div
                        key={match.id}
                        className={styles.playerTimelineMarker}
                        style={{ left: `${percentage}%` }}
                        title={`Treffer bei ${formatTime(match.start_time)}: "${match.content.substring(0, 45)}..."`}
                        onClick={() => {
                          if (audioRef.current) {
                            audioRef.current.currentTime = match.start_time;
                            setCurrentTime(match.start_time);
                          }
                        }}
                      />
                    );
                  })}
                </div>
                <span className={styles.timeLabel}>{formatTime(duration)}</span>
              </div>
            </div>
            <div className={styles.playerMetaActions}>
              <button onClick={cycleSpeed} className={styles.speedBtn} title="Wiedergabegeschwindigkeit ändern">{playSpeed}x</button>
              <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15); }} className={styles.skipButton} title="15s zurückspringen">↩ 15s</button>
              <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 15); }} className={styles.skipButton} title="15s vorspringen">15s ↪</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
