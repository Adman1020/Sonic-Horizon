"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { GENRE_OPTIONS } from '@/lib/artistScore';
import { DISCOVERY_MODES, DISCOVERY_MODE_DEFAULT, type DiscoveryMode, type DiscoveryModeDef } from '@/lib/discoveryModes';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Recommendation {
  artist: string;
  title: string;
  reasoning: string;
  genre_tags: string[];
  spotifyUri?: string;
  spotifyUris?: string[];
  spotifyAlbumId?: string;
}

interface UserState {
  username: string | null;
  isAdmin: boolean;
  knownArtistCount: number;
  spotifyConnected: boolean;
  nextRun: string | null;
  aiConfig: { provider: string; model: string | null; rpm: number } | null;
  settings: {
    obscurityLevel: number;
    outputFormat: string;
    recommendationLimit: number;
    requestsPerMinute?: number;
    spotifyPlaylistPublic?: boolean;
    genres?: string[];
    discoveryMode?: DiscoveryMode;
    rabbitHoleArtist?: string | null;
    scheduleEnabled?: boolean;
    scheduleInterval?: string;
    scheduleHour?: number;
    scheduleDay?: number;
  };
}

type LogEntry = { time: string; msg: string; type: 'info' | 'success' | 'error' | 'warn' };

const OBSCURITY_LABELS: Record<number, string> = {
  1: 'Mainstream',
  2: 'Popular Indie',
  3: 'Critically Acclaimed',
  4: 'Deep Cut',
  5: 'Underground / Niche',
};

// Genre Dive caps the lane at a few genres — a long list makes the model
// diffuse and the output random again (the exact failure this mode fixes).
const MAX_GENRES = 4;

// Scheduled refreshes — daily / weekly / monthly
const SCHEDULE_INTERVALS = ['daily', 'weekly', 'monthly'] as const;
const SCHEDULE_INTERVAL_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [user, setUser] = useState<UserState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  // Collapsed state — all collapsed by default
  const [collapsed, setCollapsed] = useState({ intro: true, spotify: true, tuning: true, schedule: true });
  const toggle = (s: keyof typeof collapsed) => setCollapsed(p => ({ ...p, [s]: !p[s] }));

  // ── Spotify state
  const [spotifyFetching, setSpotifyFetching] = useState(false);
  const [pendingAutoFetch, setPendingAutoFetch] = useState(false); // fires a refresh right after OAuth login
  const [reauthNeeded, setReauthNeeded] = useState(false); // shows the "re-authorise for recently-played" prompt

  // ── Imported artists list state
  const [artists, setArtists] = useState<{ name: string; sources: string[]; lastSeenAt: string | Date | null; score: number }[]>([]);
  const [artistsTotal, setArtistsTotal] = useState(0);
  const [artistsOpen, setArtistsOpen] = useState(false);
  const [artistsLoading, setArtistsLoading] = useState(false);
  const [artistsLoaded, setArtistsLoaded] = useState(false);
  const [artistFilter, setArtistFilter] = useState('');

  // ── Tuning state
  const [obscurity, setObscurity] = useState(3);
  const [outputFormat, setOutputFormat] = useState('tracks');
  const [quantity, setQuantity] = useState(20);
  const [isPlaylistPublic, setIsPlaylistPublic] = useState(true);
  const [genres, setGenres] = useState<string[]>([]);
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>(DISCOVERY_MODE_DEFAULT);
  const [infoModal, setInfoModal] = useState<DiscoveryModeDef | null>(null);
  const [rabbitHoleArtist, setRabbitHoleArtist] = useState<string | null>(null);
  const [rabbitQuery, setRabbitQuery] = useState('');
  const [genreSuggesting, setGenreSuggesting] = useState(false);
  const [genreSuggestStatus, setGenreSuggestStatus] = useState('');
  const [customGenreInput, setCustomGenreInput] = useState('');
  const [genreInputMsg, setGenreInputMsg] = useState('');

  // ── Scheduled refresh state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleInterval, setScheduleInterval] = useState('daily');
  const [scheduleHour, setScheduleHour] = useState(8);
  const [scheduleDay, setScheduleDay] = useState(1);
  const [nextRun, setNextRun] = useState<string | null>(null);
  const [runNowBusy, setRunNowBusy] = useState(false);

  // ── Generation state
  const [generating, setGenerating] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<Recommendation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const [spotifyPlaylistUrl, setSpotifyPlaylistUrl] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setLogs(prev => [...prev, { time, msg, type }]);
  }, []);

  // Initialise
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pending') === '1') setPending(true);
    fetch('/api/user/settings')
      .then(r => r.json())
      .then((data: UserState) => {
        setUser(data);
        setObscurity(data.settings.obscurityLevel ?? 3);
        setOutputFormat(data.settings.outputFormat ?? 'tracks');
        setQuantity(data.settings.recommendationLimit ?? 20);
        if (data.settings.spotifyPlaylistPublic !== undefined) setIsPlaylistPublic(data.settings.spotifyPlaylistPublic);
        if (data.settings.genres) setGenres(data.settings.genres.slice(0, MAX_GENRES));
        if (data.settings.discoveryMode) setDiscoveryMode(data.settings.discoveryMode);
        if (data.settings.rabbitHoleArtist) setRabbitHoleArtist(data.settings.rabbitHoleArtist);
        if (data.settings.scheduleEnabled !== undefined) setScheduleEnabled(data.settings.scheduleEnabled);
        if (data.settings.scheduleInterval) setScheduleInterval(data.settings.scheduleInterval);
        if (data.settings.scheduleHour !== undefined) setScheduleHour(data.settings.scheduleHour);
        if (data.settings.scheduleDay !== undefined) setScheduleDay(data.settings.scheduleDay);
        if (data.nextRun) setNextRun(data.nextRun);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Scroll logs
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  // Spotify callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('spotify_connected') === 'true') {
      window.history.replaceState({}, '', '/');
      setUser(prev => prev ? { ...prev, spotifyConnected: true } : prev);
      addLog('Spotify connected successfully!', 'success');
      setReauthNeeded(false); // fresh auth grants the recently-played scope
      setPendingAutoFetch(true); // auto-import liked/saved/followed so first run has data
    }
    const spotErr = params.get('spotify_error');
    if (spotErr) {
      window.history.replaceState({}, '', '/');
      const msgs: Record<string, string> = {
        missing_client_id: 'Spotify is not configured on this server — ask the operator to set SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.',
        state_mismatch: 'OAuth state mismatch. Try connecting again.',
        token_exchange_failed: 'Token exchange failed — check the server-side Client Secret.',
      };
      addLog(`Spotify: ${msgs[spotErr] ?? spotErr}`, 'error');
    }
  }, [addLog]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleConnectSpotify = () => {
    window.location.href = '/api/spotify/auth';
  };

  const runSpotifyFetch = useCallback(async () => {
    setSpotifyFetching(true);
    try {
      const res = await fetch('/api/spotify/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(prev => prev ? { ...prev, knownArtistCount: data.totalKnownArtists ?? prev.knownArtistCount + data.addedArtists } : prev);
      setArtistsLoaded(false);
      setArtists([]);
      setReauthNeeded(!!data.recentlyPlayedSkipped);
      addLog(`Spotify: ${data.message}`, 'success');
    } catch (e: unknown) { addLog(`Spotify refresh failed: ${e instanceof Error ? e.message : 'Error'}`, 'error'); }
    setSpotifyFetching(false);
  }, []);

  const handleSpotifyFetch = runSpotifyFetch;

  // Auto-fetch on first OAuth login (pendingAutoFetch is set by the callback
  // URL-param effect). Runs once, then clears the flag.
  useEffect(() => {
    if (!pendingAutoFetch) return;
    addLog('Importing your liked songs, saved albums & followed artists…', 'info');
    runSpotifyFetch().finally(() => setPendingAutoFetch(false));
  }, [pendingAutoFetch, runSpotifyFetch]);

  const fetchRoster = useCallback(async () => {
    if (artistsLoaded || artistsLoading) return;
    setArtistsLoading(true);
    try {
      const res = await fetch('/api/artists');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setArtists(data.artists);
      setArtistsTotal(data.total);
      setArtistsLoaded(true);
    } catch (e: unknown) {
      addLog(`Failed to load artists: ${e instanceof Error ? e.message : 'Error'}`, 'error');
    }
    setArtistsLoading(false);
  }, [artistsLoaded, artistsLoading, addLog]);

  // Entering Rabbit Hole → make sure the artist roster is loaded for searching.
  useEffect(() => {
    if (discoveryMode === 'rabbit-hole') fetchRoster();
  }, [discoveryMode, fetchRoster]);

  // Auto-save settings
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obscurityLevel: obscurity, outputFormat, recommendationLimit: quantity, spotifyPlaylistPublic: isPlaylistPublic, genres, discoveryMode, rabbitHoleArtist, scheduleEnabled, scheduleInterval, scheduleHour, scheduleDay }),
      });
    }, 800);
    return () => clearTimeout(t);
  }, [obscurity, outputFormat, quantity, isPlaylistPublic, genres, discoveryMode, rabbitHoleArtist, scheduleEnabled, scheduleInterval, scheduleHour, scheduleDay, user]);

  const handleToggleArtists = () => {
    fetchRoster();
    setArtistsOpen(o => !o);
  };

  const handleClearData = async () => {
    if (!window.confirm(
      'Clear all imported Spotify artists?\n\nThis removes every followed, saved, and liked signal. Your Spotify connection stays — you can refresh to re-import. This cannot be undone.'
    )) return;
    try {
      const res = await fetch('/api/data/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(prev => prev ? {
        ...prev,
        knownArtistCount: data.remainingArtists,
      } : prev);
      setArtistsLoaded(false);
      setArtists([]);
      addLog(data.message, 'success');
    } catch (e: unknown) {
      addLog(`Failed to clear data: ${e instanceof Error ? e.message : 'Error'}`, 'error');
    }
  };

  const handleGenerate = async (override?: { format?: string; quantity?: number; mode?: DiscoveryMode }) => {
    const fmt = override?.format ?? outputFormat;
    const qty = override?.quantity ?? quantity;
    const mode = override?.mode ?? discoveryMode;
    if (override?.format) setOutputFormat(override.format);
    if (override?.quantity) setQuantity(override.quantity);
    if (override?.mode) setDiscoveryMode(override.mode);
    setGenerating(true); setLogs([]); setResults([]); setSyncResult('');
    const modeDef = DISCOVERY_MODES.find(m => m.key === mode);
    addLog(`Generating via ${aiProvider ?? 'admin AI config'}${aiModel ? ` › ${aiModel}` : ''}`, 'info');
    addLog(`Mode: ${modeDef?.label ?? mode} · Obscurity ${obscurity}/5 · ${fmt} · ${qty} results`, 'info');
    if (mode === 'genre-dive' && genres.length) addLog(`Genre focus: ${genres.join(', ')}`, 'info');
    if (mode === 'rabbit-hole') {
      addLog(`Rabbit Hole anchor: ${rabbitHoleArtist ?? 'your #1 artist'}`, 'info');
    }
    try {
      addLog('Loading scored artist pool & exclusion list from DB…', 'info');
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obscurity, format: fmt, quantity: qty, genres, discoveryMode: mode, rabbitHoleArtist }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      addLog(`LLM returned ${data.recommendations.length} recommendations`, 'success');
      setResults(data.recommendations);
    } catch (e: unknown) {
      addLog(`Error: ${e instanceof Error ? e.message : 'Generation failed'}`, 'error');
    }
    setGenerating(false);
  };

  // Genre Dive: auto-suggest your actual top genres from history.
  const handleSuggestGenres = async () => {
    if (!aiConfigured) return;
    setGenreSuggesting(true); setGenreSuggestStatus('');
    try {
      const res = await fetch('/api/discovery/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'genre-suggest' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.genres?.length) {
        setGenres(data.genres.slice(0, MAX_GENRES));
        setGenreSuggestStatus(`✓ Suggested from your history: ${data.genres.slice(0, MAX_GENRES).join(', ')}`);
        setGenreInputMsg('');
        addLog(`Genre Dive: suggested ${Math.min(data.genres.length, MAX_GENRES)} genres from history`, 'success');
      } else {
        setGenreSuggestStatus(data.message ?? 'Could not detect genres yet.');
        addLog(`Genre Dive: ${data.message ?? 'no genres detected'}`, 'warn');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Suggest failed';
      setGenreSuggestStatus(`Error: ${msg}`);
      addLog(`Genre suggest failed: ${msg}`, 'error');
    }
    setGenreSuggesting(false);
  };

  const toggleGenre = (g: string) => {
    if (genres.includes(g)) {
      setGenres(prev => prev.filter(x => x !== g));
      setGenreInputMsg('');
      return;
    }
    if (genres.length >= MAX_GENRES) {
      setGenreInputMsg(`Limit reached — ${MAX_GENRES} genres max. Remove one to add another.`);
      return;
    }
    setGenres(prev => [...prev, g]);
    setGenreInputMsg('');
  };

  const addCustomGenre = () => {
    const v = customGenreInput.trim();
    setGenreInputMsg('');
    if (!v) return;
    if (genres.includes(v)) {
      setGenreInputMsg('Already selected.');
      return;
    }
    if (genres.length >= MAX_GENRES) {
      setGenreInputMsg(`Limit reached — ${MAX_GENRES} genres max. Remove one to add another.`);
      return;
    }
    if (v.length > 40 || /[\n,;]/.test(v)) {
      setGenreInputMsg('One tag only — no commas or line breaks.');
      return;
    }
    setGenres(prev => [...prev, v]);
    setCustomGenreInput('');
  };

  const handleSpotifySync = async () => {
    if (!results.length) return;
    setSyncing(true); setSyncResult(''); setSpotifyPlaylistUrl(null);
    addLog(`Searching ${outputFormat} on Spotify & updating playlists…`, 'info');
    try {
      const res = await fetch('/api/spotify/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendations: results, format: outputFormat, isPublic: isPlaylistPublic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSyncResult(`✓ ${data.message}`);
      if (data.playlistUrl) setSpotifyPlaylistUrl(data.playlistUrl);
      addLog(`Sync complete: ${data.message}`, 'success');
      addLog('Synced artists added to exclusion list — won\'t repeat on future runs', 'success');
      if (data.playlistUrl) addLog(`Spotify Playlist URL: ${data.playlistUrl}`, 'info');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      setSyncResult(`Error: ${msg}`);
      addLog(`Sync failed: ${msg}`, 'error');
    }
    setSyncing(false);
  };

  // Force a full scheduled run now: flush current settings, then run
  // discovery → generate → push to playlist with those exact settings.
  const handleRunNow = async () => {
    setRunNowBusy(true); setSyncResult('');
    try {
      const saveRes = await fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obscurityLevel: obscurity, outputFormat, recommendationLimit: quantity, spotifyPlaylistPublic: isPlaylistPublic, genres, discoveryMode, rabbitHoleArtist, scheduleEnabled, scheduleInterval, scheduleHour, scheduleDay }),
      });
      if (!saveRes.ok) throw new Error((await saveRes.json()).error);
      setLogs([]); setResults([]);
      addLog('Run now: flushing current settings…', 'info');
      const res = await fetch('/api/discovery/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.message) addLog(data.message, 'success');
      if (data.nextRun) setNextRun(data.nextRun);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Run now failed';
      addLog(`Run now failed: ${msg}`, 'error');
      setSyncResult(`Error: ${msg}`);
    }
    setRunNowBusy(false);
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  // ── Derived values ──────────────────────────────────────────────────────────

  const aiConfigured = !!user?.aiConfig;
  const aiProvider = user?.aiConfig?.provider ?? 'Admin config';
  const aiModel = user?.aiConfig?.model ?? null;
  const scheduleLocked = scheduleEnabled;
  const hasHistory = (user?.knownArtistCount ?? 0) > 0;
  const activeModeDef = DISCOVERY_MODES.find(m => m.key === discoveryMode) ?? DISCOVERY_MODES[0];
  const rabbitMatches = rabbitQuery.trim().length > 0
    ? artists.filter(a => a.name.toLowerCase().includes(rabbitQuery.trim().toLowerCase())).slice(0, 8)
    : [];
  const nextRunLabel = nextRun
    ? new Date(nextRun).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null;
  const scheduleSummary = scheduleInterval === 'daily'
    ? `Daily @ ${String(scheduleHour).padStart(2, '0')}:00`
    : scheduleInterval === 'weekly'
      ? `Weekly · ${WEEKDAY_LABELS[scheduleDay - 1] ?? 'Mon'} @ ${String(scheduleHour).padStart(2, '0')}:00`
      : `Monthly · ${scheduleDay} @ ${String(scheduleHour).padStart(2, '0')}:00`;

  // System prompt preview
  const promptPreview = `You are an expert music curator. Analyse your taste profile and recommend NEW music.
━━━━━━━━━━━━━━━━━━━━━━━━━
OBSCURITY TARGET: ${obscurity}/5 — ${OBSCURITY_LABELS[obscurity]}
DISCOVERY MODE: ${activeModeDef.label} — ${activeModeDef.tagline}${discoveryMode === 'rabbit-hole' ? ` — anchor: ${rabbitHoleArtist ?? 'your #1 artist'}` : ''}
${discoveryMode === 'genre-dive' ? `GENRE FOCUS: ${genres.length === 0 ? 'All genres (no constraint)' : genres.join(', ')}\n` : ''}OUTPUT: ${quantity} ${outputFormat === 'tracks' ? 'track' : 'album'} recommendations
━━━━━━━━━━━━━━━━━━━━━━━━━
USER'S TOP ARTISTS (scored by taste affinity):
  [ top ${Math.min(50, user?.knownArtistCount ?? 0)} of ${user?.knownArtistCount ?? 0} artists in your pool ]

EXCLUDED ARTISTS (never recommend these — enforced server-side):
  [ all ${user?.knownArtistCount ?? 0} artists ]
━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT JSON SCHEMA:
{
  "recommendations": [{
    "artist": "string",
    "title": "${outputFormat === 'tracks' ? 'track title' : 'album title'}",
    "reasoning": "one sentence connecting to taste profile",
    "genre_tags": ["Tag1", "Tag2"]
  }]
}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-analog-bg flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-analog-accent animate-pulse" style={{ boxShadow: '0 0 15px #FF006E' }} />
          <span className="text-analog-text-muted text-sm font-mono">Initialising…</span>
        </div>
      </div>
    );
  }

  // Unknown Spotify IDs awaiting admin approval land here (proxy allows / with ?pending=1).
  if (pending) {
    return (
      <div className="min-h-screen bg-analog-bg text-analog-text font-sans flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-analog-card border border-analog-border rounded-xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-12 h-12 rounded-full border border-amber-500/60 flex items-center justify-center mx-auto text-2xl">⏳</div>
          <div>
            <h1 className="text-xl font-bold text-white">Waiting for approval</h1>
            <p className="text-sm text-analog-text-muted mt-2">
              Your Spotify account is new to this server. An admin needs to approve it before you can
              connect music data and run discoveries.
            </p>
          </div>
          <button onClick={handleLogout}
            className="w-full py-2.5 border border-analog-border text-analog-text-muted hover:text-white text-sm rounded transition-colors">
            Logout
          </button>
        </div>
      </div>
    );
  }

  // ─── Main UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-analog-bg text-analog-text font-sans">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-analog-bg/90 backdrop-blur border-b border-analog-border">
        {/* Gradient top bar */}
        <div className="h-0.5 gradient-bar w-full" />
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="Sonic Horizon" className="w-7 h-7 rounded object-cover border border-analog-border" />
            <h1 className="font-bold text-lg tracking-tight gradient-text">Sonic Horizon</h1>
            <span className="text-analog-text-muted text-xs hidden sm:block">Deep Music Discovery</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-xs">
              <button onClick={handleToggleArtists} className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: hasHistory ? '#00E5FF' : '#27245A', boxShadow: hasHistory ? '0 0 6px #00E5FF' : 'none' }} />
                <span className="text-analog-text-muted">{user?.knownArtistCount ?? 0} artists{artistsOpen ? ' ▲' : ' ▼'}</span>
              </button>
              {user?.isAdmin && (
                <a href="/admin" className="ml-2 hover:text-white transition-colors">Admin</a>
              )}
            </div>
            <span className="text-xs text-analog-text-muted">{user?.username}</span>
            <button onClick={handleLogout} className="text-xs text-analog-text-muted hover:text-red-400 transition-colors">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">

        {/* ═══ How it works ══════════════════════════════════════════════════ */}
        <div className="bg-analog-card border border-analog-border rounded-xl overflow-hidden" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
          <button onClick={() => toggle('intro')}
            className="w-full flex items-center gap-3 px-6 py-5 hover:bg-analog-bg/30 transition-colors text-left">
            <span className="text-xl shrink-0">🎧</span>
            <span className="font-semibold text-white">How Sonic Horizon works</span>
            <div className="flex-1" />
            <ChevronIcon collapsed={collapsed.intro} />
          </button>
          {!collapsed.intro && (
            <div className="px-6 pb-7 pt-6 border-t border-analog-border space-y-5">
              <p className="text-sm text-analog-text-muted leading-relaxed">
                Sonic Horizon reads your <span className="text-white">Spotify taste profile</span> — liked songs, saved albums
                and followed artists — and uses an AI curator to surface{' '}
                <span className="text-white">new music that actually fits you</span>, then pushes it straight into a
                Spotify playlist. Four quick steps:
              </p>
              <ol className="space-y-4">
                <li className="flex gap-3.5">
                  <span className="font-mono text-sm font-bold shrink-0 w-6 text-center pt-0.5" style={{ color: '#FF006E' }}>01</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">Connect Spotify</p>
                    <p className="text-xs text-analog-text-muted mt-0.5">
                      Authorise with OAuth so the app can read your listening history and build playlists on your account.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3.5">
                  <span className="font-mono text-sm font-bold shrink-0 w-6 text-center pt-0.5" style={{ color: '#FF006E' }}>02</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">Tune your discovery</p>
                    <p className="text-xs text-analog-text-muted mt-0.5">
                      Choose how obscure (1–5), pick a discovery mode, and set tracks vs albums and quantity.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3.5">
                  <span className="font-mono text-sm font-bold shrink-0 w-6 text-center pt-0.5" style={{ color: '#FF006E' }}>03</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">Generate</p>
                    <p className="text-xs text-analog-text-muted mt-0.5">
                      The AI studies your taste and recommends fresh music, with a reason why each pick fits. Preview each
                      track or album right here.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3.5">
                  <span className="font-mono text-sm font-bold shrink-0 w-6 text-center pt-0.5" style={{ color: '#FF006E' }}>04</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">Listen &amp; keep it fresh</p>
                    <p className="text-xs text-analog-text-muted mt-0.5">
                      Push your picks to a Spotify playlist, or schedule automatic refreshes so you always have a fresh
                      discovery playlist waiting.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* ═══ Imported Artists list ══════════════════════════════════════════ */}
        {artistsOpen && (
          <div className="bg-analog-card border border-analog-border rounded-xl overflow-hidden" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
            <div className="px-6 py-3.5 flex flex-wrap items-center gap-3 border-b border-analog-border">
              <span className="font-semibold text-white">Imported Artists</span>
              <span className="text-xs text-analog-text-muted font-mono">
                {artistsLoading ? 'Loading…' : `${artistsTotal} artists`}
              </span>
              <input type="text" value={artistFilter} onChange={e => setArtistFilter(e.target.value)}
                placeholder="Filter…"
                className="flex-1 min-w-[140px] bg-analog-bg border border-analog-border rounded px-3 py-1.5 text-xs text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
              <button onClick={() => setArtistsOpen(false)}
                className="text-xs text-analog-text-muted hover:text-white transition-colors">Close</button>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-analog-border">
              {(artistsLoading && artists.length === 0)
                ? <div className="px-6 py-6 text-center text-xs text-analog-text-muted">Loading…</div>
                : artists
                    .filter(a => a.name.toLowerCase().includes(artistFilter.trim().toLowerCase()))
                    .map(a => (
                      <div key={a.name} className="px-6 py-2.5 text-sm text-analog-text hover:bg-analog-bg/40 transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="w-1 h-1 rounded-full shrink-0" style={{ background: '#FF006E', boxShadow: '0 0 4px #FF006E' }} />
                          <span className="font-medium">{a.name}</span>
                          <span className="ml-auto shrink-0 font-mono text-xs text-analog-text-muted">
                            w {a.score.toFixed(1)}
                          </span>
                        </div>
                        {a.sources.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1 pl-4">
                            {a.sources.map(s => (
                              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(0,229,255,0.12)', color: '#00E5FF' }}>
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
              {!artistsLoading && artists.length === 0 && (
                <div className="px-6 py-6 text-center text-xs text-analog-text-muted">No artists imported yet</div>
              )}
            </div>
          </div>
        )}

        {/* ═══ STEP 1: Spotify ══════════════════════════════════════════════════ */}
        <Section
          num="01"
          title="Spotify"
          collapsed={collapsed.spotify}
          onToggle={() => toggle('spotify')}
          statusBadge={
            user?.spotifyConnected
              ? <Badge color="cyan">Connected</Badge>
              : <Badge color="dim">Not connected</Badge>
          }
        >
          {/* Re-auth prompt: shown only when the user's token lacks the recently-played scope */}
          {reauthNeeded && (
            <div className="rounded-lg p-3 text-xs leading-relaxed flex items-center justify-between gap-3" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
              <span style={{ color: '#FBB724' }}>
                Re-authorise Spotify to enable the recently-played filter (so we don't recommend things you just heard).
              </span>
              <a href="/api/spotify/auth"
                className="px-3 py-1.5 text-xs font-semibold rounded border whitespace-nowrap shrink-0"
                style={{ borderColor: '#FBB724', color: '#FBB724', background: 'rgba(251,191,36,0.08)' }}>
                Re-authorise →
              </a>
            </div>
          )}

          {/* Connect / Refresh buttons */}
          <div className="flex flex-wrap gap-3 pt-1">
            {!user?.spotifyConnected ? (
              <button onClick={handleConnectSpotify}
                className="inline-flex items-center gap-2 px-4 py-2.5 font-semibold text-sm rounded transition-colors text-black disabled:opacity-50"
                style={{ background: '#1DB954', boxShadow: '0 0 15px rgba(29,185,84,0.2)' }}>
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z"/></svg>
                Connect Spotify via OAuth
              </button>
            ) : (
              <button onClick={handleSpotifyFetch} disabled={spotifyFetching || pendingAutoFetch}
                className="inline-flex items-center gap-2 px-4 py-2.5 font-semibold text-sm rounded transition-colors text-black disabled:opacity-50"
                style={{ background: '#1DB954', boxShadow: '0 0 15px rgba(29,185,84,0.2)' }}>
                {spotifyFetching || pendingAutoFetch ? 'Refreshing…' : 'Refresh from Spotify'}
              </button>
            )}
          </div>

          {/* Clear artists */}
          <div className="flex items-center justify-between rounded-lg px-4 py-3 border" style={{ borderColor: 'rgba(255,61,61,0.3)', background: 'rgba(255,61,61,0.05)' }}>
            <span className="text-xs text-analog-text-muted">
              <strong className="text-red-400">Clear all imported Spotify artists</strong> (followed / saved / liked signals). Your connection stays — just refresh to re-import.
            </span>
            <button onClick={handleClearData}
              className="px-3 py-1.5 text-xs font-semibold rounded border transition-colors whitespace-nowrap ml-3"
              style={{ borderColor: '#FF3D3D', color: '#FF3D3D' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,61,61,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              Clear Spotify artists
            </button>
          </div>
        </Section>

        {/* ═══ STEP 2: Tuning ═══════════════════════════════════════════════════ */}
        <Section
          num="02"
          title="Discovery Tuning"
          collapsed={collapsed.tuning}
          onToggle={() => toggle('tuning')}
          statusBadge={
            <Badge color="cyan">
              {activeModeDef.label} · {OBSCURITY_LABELS[obscurity]} · {outputFormat} · {quantity}
            </Badge>
          }
        >
          <div className="space-y-5">
            {scheduleLocked && (
              <div className="rounded-lg p-3 text-xs leading-relaxed" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
                <p className="font-semibold" style={{ color: '#FBB724' }}>🔒 Tuning is locked</p>
                <p className="text-analog-text-muted mt-1">
                  Automatic refreshes are on, so these controls reflect the settings saved when the schedule was
                  enabled. Turn the schedule off in the panel below to adjust them again.
                </p>
              </div>
            )}
            <div className={`space-y-5 ${scheduleLocked ? 'opacity-60 pointer-events-none select-none' : ''}`}>
          {/* Obscurity */}
          <div>
            <div className="flex justify-between items-baseline mb-2">
              <label className="text-sm font-medium text-white">Obscurity</label>
              <span className="text-sm font-mono" style={{ color: '#FF006E' }}>{obscurity}/5 — {OBSCURITY_LABELS[obscurity]}</span>
            </div>
            <input type="range" min={1} max={5} value={obscurity} onChange={e => setObscurity(Number(e.target.value))}
              className="w-full" style={{ accentColor: '#FF006E' }} />
            <div className="flex justify-between text-xs text-analog-text-muted mt-1 font-mono">
              <span>Mainstream</span><span>Underground</span>
            </div>
          </div>

          {/* Discovery Mode */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-sm font-medium text-white">Discovery Mode</label>
              <span className="text-xs font-mono" style={{ color: '#00E5FF' }}>
                {activeModeDef.label} — {activeModeDef.tagline}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DISCOVERY_MODES.map(m => {
                const on = discoveryMode === m.key;
                return (
                  <div key={m.key} onClick={() => setDiscoveryMode(m.key)} role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setDiscoveryMode(m.key); }}
                    className={`relative px-3 py-2.5 text-xs rounded-lg border transition-all text-left cursor-pointer ${
                      on ? 'border-analog-accent text-white' : 'border-analog-border text-analog-text-muted hover:border-analog-accent hover:text-white'
                    }`}
                    style={on ? { background: 'rgba(255,0,110,0.12)', boxShadow: '0 0 0 1px rgba(255,0,110,0.4)' } : {}}>
                    <span className="block font-semibold pr-6">{m.icon} {m.label}</span>
                    <span className="block text-[10px] mt-0.5 opacity-70">{m.tagline}</span>
                    <button onClick={e => { e.stopPropagation(); setInfoModal(m); }} aria-label={`About ${m.label}`}
                      className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center text-[10px] rounded hover:bg-analog-border/60 transition-colors cursor-pointer">
                      ℹ
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Mode-specific controls */}
            {discoveryMode === 'rabbit-hole' && (
              <div className="mt-2 rounded-lg p-3 border" style={{ borderColor: 'rgba(0,229,255,0.25)', background: 'rgba(0,229,255,0.04)' }}>
                <p className="text-xs text-analog-text-muted mb-2">
                  Pick one seed artist — the model maps their whole family tree (influences, collaborators, label/scene, modern carriers).
                </p>
                <div className="flex gap-2">
                  <input type="text" value={rabbitQuery} onChange={e => setRabbitQuery(e.target.value)}
                    placeholder="Search your artists…"
                    className="flex-1 min-w-0 bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
                  <button onClick={() => { setRabbitHoleArtist(null); setRabbitQuery(''); }}
                    className="px-3 py-2 text-xs font-semibold rounded border transition-colors whitespace-nowrap"
                    style={{ borderColor: '#00E5FF', color: '#00E5FF', background: 'rgba(0,229,255,0.06)' }}>
                    🎲 Surprise me
                  </button>
                </div>
                {rabbitMatches.length > 0 && (
                  <div className="mt-2 max-h-44 overflow-y-auto divide-y divide-analog-border rounded-lg border border-analog-border bg-analog-bg">
                    {rabbitMatches.map(a => (
                      <button key={a.name} onClick={() => { setRabbitHoleArtist(a.name); setRabbitQuery(''); }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer ${
                          rabbitHoleArtist === a.name ? 'bg-analog-border/50' : 'hover:bg-analog-border/30'
                        }`}>
                        <span className="text-white">{a.name}</span>
                        <span className="ml-2 font-mono text-analog-text-muted">w {a.score.toFixed(1)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {rabbitQuery.trim().length > 0 && rabbitMatches.length === 0 && (
                  <p className="text-xs mt-2 text-analog-text-muted">No matching artists. Try a different name.</p>
                )}
                <p className="text-xs mt-2" style={{ color: rabbitHoleArtist ? '#00E5FF' : '#6B5E9B' }}>
                  {rabbitHoleArtist
                    ? <>✓ Anchor: <strong className="text-white">{rabbitHoleArtist}</strong></>
                    : 'Anchor: your #1 artist (or pick one above).'}
                </p>
              </div>
            )}

            {discoveryMode === 'deep-roots' && (
              <p className="text-xs text-analog-text-muted mt-2">
                Lane is detected automatically from your <strong className="text-white">all-time</strong> pool of liked, saved, and followed artists.
              </p>
            )}
            {discoveryMode === 'album-quest' && (
              <p className="text-xs text-analog-text-muted mt-2">
                Full-album recommendations, each verified on Spotify. Lower the quantity (even to 1) for a quick single-album dive.
              </p>
            )}
            {discoveryMode === 'genre-dive' && (
              <p className="text-xs text-analog-text-muted mt-2">
                Pick up to {MAX_GENRES} genres below (or auto-suggest them, or type your own) — every pick must fit at least one selected genre.
              </p>
            )}
            <p className="text-xs text-analog-text-muted mt-2">
              ℹ Tap the <span className="text-white">ℹ</span> on a card for the full explanation and what the model is told.
            </p>
          </div>

          {/* Genre focus — only relevant to Genre Dive; every other mode picks
              its own lane (auto-detected or single-artist). */}
          {discoveryMode === 'genre-dive' && (
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-sm font-medium text-white">Genre focus</label>
              <span className="text-xs font-mono" style={{ color: genres.length >= MAX_GENRES ? '#FBB724' : '#00E5FF' }}>
                {genres.length === 0 ? 'All genres' : `${genres.length} / ${MAX_GENRES}`}
              </span>
            </div>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={handleSuggestGenres} disabled={genreSuggesting || !aiConfigured}
                  className="px-3 py-1.5 text-xs font-semibold rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  style={{ borderColor: '#00E5FF', color: '#00E5FF', background: 'rgba(0,229,255,0.08)' }}>
                  {genreSuggesting ? 'Detecting…' : '✨ Auto-suggest my genres'}
                </button>
                {genres.length > 0 && (
                  <button onClick={() => { setGenres([]); setGenreInputMsg(''); }}
                    className="px-2.5 py-1.5 text-xs rounded border transition-colors whitespace-nowrap text-analog-text-muted hover:text-white hover:border-analog-accent"
                    style={{ borderColor: 'rgba(107,94,155,0.4)' }}>
                    Clear
                  </button>
                )}
              </div>
            <StatusMsg text={genreSuggestStatus} />

            {/* Free-text genre */}
            <div className="flex gap-2">
              <input type="text" value={customGenreInput} onChange={e => setCustomGenreInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomGenre(); } }}
                placeholder="Add your own genre, e.g. post-punk, uk garage, bossa nova…"
                className="flex-1 min-w-0 bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
              <button onClick={addCustomGenre} disabled={!customGenreInput.trim() || genres.length >= MAX_GENRES}
                className="px-3 py-2 text-xs font-semibold rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                style={{ borderColor: '#FF006E', color: '#FF006E', background: 'rgba(255,0,110,0.08)' }}>
                Add
              </button>
            </div>
            <p className="text-xs text-analog-text-muted mt-1">
              Pick up to <strong className="text-white">{MAX_GENRES}</strong> — a tight lane keeps the output coherent, not random.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {GENRE_OPTIONS.map(g => {
                const on = genres.includes(g.key);
                const atLimit = !on && genres.length >= MAX_GENRES;
                return (
                  <button key={g.key} onClick={() => toggleGenre(g.key)}
                    disabled={atLimit}
                    className={`px-3 py-2 text-xs rounded-lg border transition-all text-left ${
                      on ? 'border-analog-accent text-white' : atLimit
                        ? 'border-analog-border text-analog-text-muted opacity-40 cursor-not-allowed'
                        : 'border-analog-border text-analog-text-muted hover:text-white'
                    }`}
                    style={on ? { background: 'rgba(255,0,110,0.12)', boxShadow: '0 0 0 1px rgba(255,0,110,0.4)' } : {}}>
                    <span className="block font-semibold">{on ? '✓ ' : ''}{g.label}</span>
                    <span className="block text-[10px] mt-0.5 opacity-70">{g.hint}</span>
                  </button>
                );
              })}
            </div>
            {genres.filter(g => !GENRE_OPTIONS.some(o => o.key === g)).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {genres.filter(g => !GENRE_OPTIONS.some(o => o.key === g)).map(g => (
                  <span key={g} onClick={() => toggleGenre(g)}
                    className="text-xs px-2 py-1 rounded border cursor-pointer hover:line-through"
                    style={{ borderColor: 'rgba(255,0,110,0.4)', color: '#FF006E', background: 'rgba(255,0,110,0.08)' }}>
                    {g} ✕
                  </span>
                ))}
              </div>
            )}
            {genreInputMsg && (
              <p className="text-xs mt-1.5" style={{ color: '#FBB724' }}>{genreInputMsg}</p>
            )}
            <p className="text-xs text-analog-text-muted mt-1.5">
              Narrows the discovery to specific scenes. Leave empty to roam your full taste profile.
            </p>
          </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Format */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">Format</label>
              <div className="flex bg-analog-bg border border-analog-border rounded-lg p-1">
                {['tracks', 'albums'].map(f => (
                  <button key={f} onClick={() => setOutputFormat(f)}
                    className={`flex-1 py-2 text-sm rounded transition-colors capitalize ${
                      outputFormat === f ? 'text-white' : 'text-analog-text-muted hover:text-white'
                    }`}
                    style={outputFormat === f ? { background: 'rgba(255,0,110,0.15)', boxShadow: '0 0 0 1px rgba(255,0,110,0.4)' } : {}}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Quantity: <span style={{ color: '#FF006E' }}>{quantity}</span>
              </label>
              <input type="range" min={1} max={outputFormat === 'tracks' ? 50 : 20}
                step={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))}
                className="w-full mt-2" style={{ accentColor: '#FF006E' }} />
              <div className="flex justify-between text-xs text-analog-text-muted mt-1 font-mono">
                <span>1</span><span>{outputFormat === 'tracks' ? 50 : 20}</span>
              </div>
            </div>
          </div>

          {/* Spotify Playlist Privacy */}
          <div className="pt-2">
            <label className="block text-sm font-medium text-white mb-2">Spotify Playlist Visibility</label>
            <div className="flex bg-analog-bg border border-analog-border rounded-lg p-1 max-w-xs">
              <button onClick={() => setIsPlaylistPublic(true)}
                className={`flex-1 py-1.5 text-xs rounded font-semibold transition-colors ${
                  isPlaylistPublic ? 'text-white' : 'text-analog-text-muted hover:text-white'
                }`}
                style={isPlaylistPublic ? { background: 'rgba(0,229,255,0.18)', boxShadow: '0 0 0 1px rgba(0,229,255,0.4)', color: '#00E5FF' } : {}}>
                🌐 Public
              </button>
              <button onClick={() => setIsPlaylistPublic(false)}
                className={`flex-1 py-1.5 text-xs rounded font-semibold transition-colors ${
                  !isPlaylistPublic ? 'text-white' : 'text-analog-text-muted hover:text-white'
                }`}
                style={!isPlaylistPublic ? { background: 'rgba(255,0,110,0.18)', boxShadow: '0 0 0 1px rgba(255,0,110,0.4)', color: '#FF006E' } : {}}>
                🔒 Private
              </button>
            </div>
            <p className="text-xs text-analog-text-muted mt-1.5">
              {isPlaylistPublic
                ? '✓ Public playlists appear in your Spotify Library immediately & can be shared.'
                : '🔒 Private playlists are unlisted and hidden from search & profile.'}
            </p>
          </div>
            </div>
          </div>
        </Section>

        {/* ═══ STEP 3: Scheduled Refreshes ═══════════════════════════════════ */}
        <Section
          num="03"
          title="Scheduled Refreshes"
          collapsed={collapsed.schedule}
          onToggle={() => toggle('schedule')}
          statusBadge={
            scheduleEnabled
              ? <Badge color="cyan">{scheduleSummary}</Badge>
              : <Badge color="dim">Off</Badge>
          }
        >
          <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Automatic refreshes</p>
                <p className="text-xs text-analog-text-muted mt-0.5">
                  {scheduleEnabled
                    ? 'On — each run refreshes your Spotify signals, generates fresh discoveries and updates your playlist.'
                    : 'Off — generate manually whenever you like. Enabling locks the tuning + Generate controls to the settings saved right now.'}
                </p>
              </div>
              <button onClick={() => setScheduleEnabled(e => !e)} role="switch" aria-checked={scheduleEnabled}
                className="relative w-12 h-6 rounded-full transition-colors shrink-0 cursor-pointer"
                style={{ background: scheduleEnabled ? '#00E5FF' : '#27245A' }}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${scheduleEnabled ? 'left-6' : 'left-0.5'}`} />
              </button>
            </div>

              {/* Frequency */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="text-sm font-medium text-white">Frequency</label>
                  <span className="text-xs font-mono" style={{ color: '#00E5FF' }}>
                    {scheduleInterval === 'daily' ? 'Every day' : scheduleInterval === 'weekly' ? 'Every week' : 'Every month'}
                  </span>
                </div>
                <div className="flex bg-analog-bg border border-analog-border rounded-lg p-1 max-w-sm">
                  {SCHEDULE_INTERVALS.map(iv => (
                    <button key={iv} onClick={() => setScheduleInterval(iv)}
                      className={`flex-1 py-2 text-sm rounded transition-colors capitalize ${
                        scheduleInterval === iv ? 'text-white' : 'text-analog-text-muted hover:text-white'
                      }`}
                      style={scheduleInterval === iv ? { background: 'rgba(255,0,110,0.15)', boxShadow: '0 0 0 1px rgba(255,0,110,0.4)' } : {}}>
                      {iv}
                    </button>
                  ))}
                </div>
              </div>

              {/* Day of week / day of month */}
              {scheduleInterval !== 'daily' && (
                <div>
                  <div className="flex items-baseline justify-between mb-2">
                    <label className="text-sm font-medium text-white">
                      {scheduleInterval === 'weekly' ? 'Day of week' : 'Day of month'}
                    </label>
                    <span className="text-xs font-mono" style={{ color: '#FF006E' }}>
                      {scheduleInterval === 'weekly'
                        ? (WEEKDAY_LABELS[scheduleDay - 1] ?? 'Monday')
                        : `The ${scheduleDay}${scheduleDay === 1 ? 'st' : scheduleDay === 2 ? 'nd' : scheduleDay === 3 ? 'rd' : 'th'}`}
                    </span>
                  </div>
                  {scheduleInterval === 'weekly' ? (
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAY_LABELS.map((day, i) => {
                        const d = i + 1;
                        const on = scheduleDay === d;
                        return (
                          <button key={d} onClick={() => setScheduleDay(d)}
                            className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                              on ? 'border-analog-accent text-white' : 'border-analog-border text-analog-text-muted hover:border-analog-accent hover:text-white'
                            }`}
                            style={on ? { background: 'rgba(255,0,110,0.1)' } : {}}>
                            {day.slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => {
                        const on = scheduleDay === d;
                        return (
                          <button key={d} onClick={() => setScheduleDay(d)}
                            className={`text-xs w-8 py-1 rounded border transition-colors text-center ${
                              on ? 'border-analog-accent text-white' : 'border-analog-border text-analog-text-muted hover:border-analog-accent hover:text-white'
                            }`}
                            style={on ? { background: 'rgba(255,0,110,0.1)' } : {}}>
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-analog-text-muted mt-1.5">
                    {scheduleInterval === 'monthly' ? 'Runs on the 28th of every month — avoids months that are too short.' : 'Every selected weekday.'}
                  </p>
                </div>
              )}

              {/* Time of day */}
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <label className="text-sm font-medium text-white">Time of day</label>
                  <span className="text-sm font-mono" style={{ color: '#FF006E' }}>{String(scheduleHour).padStart(2, '0')}:00</span>
                </div>
                <input type="range" min={0} max={23} value={scheduleHour} onChange={e => setScheduleHour(Number(e.target.value))}
                  className="w-full" style={{ accentColor: '#FF006E' }} />
                <div className="flex flex-wrap gap-2 mt-2">
                  {[0, 6, 9, 12, 18, 22].map(h => (
                    <button key={h} onClick={() => setScheduleHour(h)}
                      className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                        scheduleHour === h ? 'border-analog-accent text-white' : 'border-analog-border text-analog-text-muted hover:border-analog-accent hover:text-white'
                      }`}
                      style={scheduleHour === h ? { background: 'rgba(255,0,110,0.1)' } : {}}>
                      {String(h).padStart(2, '0')}:00
                    </button>
                  ))}
                </div>
              </div>

              {/* Next run + Run now */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg px-4 py-3 border" style={{ borderColor: 'rgba(0,229,255,0.25)', background: 'rgba(0,229,255,0.04)' }}>
                <div>
                  <p className="text-sm font-medium text-white">Next automatic run</p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: scheduleEnabled ? '#00E5FF' : '#6B5E9B' }}>
                    {scheduleEnabled
                      ? (nextRunLabel ?? '…')
                      : 'Schedule is off'}
                  </p>
                </div>
                <button onClick={handleRunNow} disabled={runNowBusy || !hasHistory || !aiConfigured}
                  className="px-4 py-2 text-sm font-semibold rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  style={{ borderColor: '#00E5FF', color: '#00E5FF', background: 'rgba(0,229,255,0.08)' }}>
                  {runNowBusy ? 'Running…' : '▶ Run now'}
                </button>
              </div>
              <p className="text-xs text-analog-text-muted">
                Run now forces a full run with the current settings — refresh signals → generate → push to Spotify playlist.
                The server must stay running for scheduled runs to fire.
              </p>
          </Section>

        {/* ═══ STEP 4: Generate ════════════════════════════════════════════════ */}
        <div className="space-y-5">
          {!hasHistory && (
            <div className="text-center py-3 px-4 rounded-lg text-sm" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#FBB724' }}>
              ⚠ Connect Spotify (Step 1) to build your taste profile first
            </div>
          )}
          {!aiConfigured && (
            <div className="text-center py-3 px-4 rounded-lg text-sm" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#FBB724' }}>
              ⚠ No AI provider configured — an admin needs to set it up in the Admin panel before generating
            </div>
          )}
          {scheduleLocked && (
            <div className="text-center py-3 px-4 rounded-lg text-sm" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#FBB724' }}>
              🔒 Automatic refreshes are on — Generate is locked to the saved settings. Use &quot;Run now&quot; above to force a run.
            </div>
          )}
          <button onClick={() => handleGenerate()} disabled={generating || !hasHistory || !aiConfigured || scheduleLocked}
            className={`w-full py-5 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3 group relative overflow-hidden ${
              generating || !hasHistory || !aiConfigured || scheduleLocked ? 'opacity-40 cursor-not-allowed' : ''
            }`}
            style={(!generating && hasHistory && aiConfigured && !scheduleLocked) ? {
              background: 'linear-gradient(90deg, #FF006E, #9945FF)',
              boxShadow: '0 0 30px rgba(255,0,110,0.35), 0 0 60px rgba(153,69,255,0.15)',
              color: 'white',
            } : { background: '#27245A', color: '#6B5E9B' }}>
            <svg className={`w-5 h-5 ${generating ? 'animate-spin' : 'group-hover:scale-110 transition-transform'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {generating
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />}
            </svg>
            {generating ? 'GENERATING…' : 'GENERATE DISCOVERY PLAYLIST'}
          </button>

          {/* Prompt preview toggle */}
          {hasHistory && aiConfigured && !scheduleLocked && (
            <button onClick={() => setShowPrompt(p => !p)}
              className="w-full text-xs text-analog-text-muted hover:text-analog-text transition-colors py-1 flex items-center justify-center gap-1">
              <span>{showPrompt ? '▲' : '▼'}</span>
              {showPrompt ? 'Hide' : 'Preview'} LLM prompt
            </button>
          )}

          {showPrompt && (
            <div className="bg-analog-card border border-analog-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-analog-border flex items-center gap-2">
                <span className="text-xs font-mono text-analog-text-muted">Prompt Preview</span>
                <span className="text-xs text-analog-text-muted">— exact prompt sent to model</span>
              </div>
              <pre className="p-4 font-mono text-xs text-analog-text-muted whitespace-pre-wrap overflow-x-auto leading-relaxed">{promptPreview}</pre>
            </div>
          )}
        </div>

        {/* ═══ STEP 5: Results + Log ════════════════════════════════════════════ */}
        {(logs.length > 0 || results.length > 0) && (
          <section className="space-y-4">
            {/* Results (First) */}
            {results.length > 0 && (
              <div className="bg-analog-card rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,0,110,0.25)', boxShadow: '0 0 28px rgba(255,0,110,0.06)' }}>
                <div className="px-6 py-5 border-b border-analog-border flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#00E5FF', boxShadow: '0 0 8px #00E5FF' }} />
                  <span className="font-semibold text-white">{results.length} Discovery Results</span>
                  <span className="text-xs text-analog-text-muted">— all added to exclusion list</span>
                </div>

                <div className="divide-y divide-analog-border">
                  {results.map((item, i) => {
                    const trackId = outputFormat === 'tracks' ? (item.spotifyUri?.split(':').pop() ?? '') : '';
                    const embedTrackId = trackId || item.spotifyUris?.[0]?.split(':').pop() || '';
                    return (
                      <div key={i} className="px-6 py-5 hover:bg-analog-bg/40 transition-colors flex gap-4">
                        <span className="text-analog-text-muted font-mono text-sm pt-0.5 w-6 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-semibold">
                            {item.title}
                            <span className="text-analog-text-muted font-normal text-sm"> — </span>
                            <span style={{ color: '#FF006E' }}>{item.artist}</span>
                          </p>
                          <p className="text-sm text-analog-text-muted mt-1 italic">{item.reasoning}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {item.genre_tags?.map((tag, j) => (
                              <span key={j} className="text-xs bg-analog-border px-2 py-0.5 rounded text-analog-text-muted">{tag}</span>
                            ))}
                          </div>
                          {embedTrackId ? (
                            <div className="mt-3.5">
                              <iframe
                                title={`${item.artist} — ${item.title}`}
                                src={`https://open.spotify.com/embed/track/${embedTrackId}`}
                                width="100%" height="80" frameBorder="0"
                                allow="autoplay; encrypted-media; clipboard-write; fullscreen"
                                loading="lazy"
                                style={{ borderRadius: 8, background: 'transparent' }}
                              />
                            </div>
                          ) : item.spotifyAlbumId ? (
                            <div className="mt-3.5">
                              <iframe
                                title={`${item.artist} — ${item.title}`}
                                src={`https://open.spotify.com/embed/album/${item.spotifyAlbumId}`}
                                width="100%" height="352" frameBorder="0"
                                allow="autoplay; encrypted-media; clipboard-write; fullscreen"
                                loading="lazy"
                                style={{ borderRadius: 8, background: 'transparent' }}
                              />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="px-6 py-3.5 border-t border-analog-border">
                  <p className="text-xs text-analog-text-muted">
                    Each result has its Spotify player embedded inline — just press play. Requires Spotify to be connected (Step 1).
                  </p>
                </div>

                <div className="px-6 py-5 border-t border-analog-border flex flex-wrap gap-3 items-center justify-between">
                  <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                    {syncResult && <p className={`text-sm ${syncResult.startsWith('✓') ? '' : 'text-red-400'}`} style={syncResult.startsWith('✓') ? { color: '#00E5FF' } : {}}>{syncResult}</p>}
                    {spotifyPlaylistUrl && (
                      <a href={spotifyPlaylistUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 font-bold text-xs rounded-lg text-black transition-transform hover:scale-105"
                        style={{ background: '#1DB954', boxShadow: '0 0 15px rgba(29,185,84,0.35)' }}>
                        <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z"/></svg>
                        Open &quot;Sonic Horizon&quot; Playlist ↗
                      </a>
                    )}
                  </div>
                  <div className="flex gap-3">
                    {user?.spotifyConnected && (
                      <button onClick={handleSpotifySync} disabled={syncing}
                        className="flex items-center gap-2 px-5 py-2.5 font-bold text-sm rounded-lg transition-colors disabled:opacity-50 text-black"
                        style={{ background: '#1DB954', boxShadow: '0 0 15px rgba(29,185,84,0.25)' }}>
                        {syncing ? 'Syncing…' : '↑ Push to Spotify'}
                      </button>
                    )}
                    <button onClick={() => handleGenerate()} disabled={generating || scheduleLocked}
                      className="px-5 py-2.5 border border-analog-border hover:border-analog-accent text-analog-text-muted hover:text-white text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      {scheduleLocked ? '🔒 Regenerate' : 'Regenerate'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Log (Second - Bottom) */}
            {logs.length > 0 && (
              <div className="bg-analog-card border border-analog-border rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-analog-border flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{
                    background: generating ? '#FF006E' : results.length > 0 ? '#00E5FF' : '#FF3D3D',
                    boxShadow: generating ? '0 0 8px #FF006E' : results.length > 0 ? '0 0 8px #00E5FF' : 'none',
                    animation: generating ? 'pulse 1s infinite' : 'none',
                  }} />
                  <span className="text-xs font-mono text-analog-text-muted">Generation Log</span>
                </div>
                <div className="p-5 font-mono text-xs space-y-1 max-h-44 overflow-y-auto">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-3" style={{
                      color: log.type === 'success' ? '#00E5FF' : log.type === 'error' ? '#FF3D3D' : log.type === 'warn' ? '#FBB724' : '#6B5E9B',
                    }}>
                      <span className="text-analog-text-muted shrink-0">{log.time}</span>
                      <span>{log.msg}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="max-w-3xl mx-auto px-6 pb-10 pt-6 border-t border-analog-border text-center text-analog-text-muted text-xs">
        <p><span className="gradient-text font-semibold">Sonic Horizon</span> · Self-hosted · All data stays local</p>
        <p className="mt-2 flex items-center justify-center gap-3">
          <a href="https://github.com/Adman1020/Sonic-Horizon" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition-colors">
            Source code ↗
          </a>
          <span className="opacity-50">·</span>
          <a href="https://github.com/Adman1020/Sonic-Horizon/issues" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition-colors">
            Report an issue ↗
          </a>
        </p>
      </footer>

      {/* ═══ Discovery Mode info modal ═══════════════════════════════════════ */}
      {infoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0" style={{ background: 'rgba(7,7,26,0.75)' }} onClick={() => setInfoModal(null)} />
          <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto bg-analog-card border border-analog-border rounded-xl p-6 space-y-4"
            style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.6)' }}>
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0">{infoModal.icon}</span>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-white">{infoModal.label}</h3>
                <p className="text-xs mt-0.5" style={{ color: '#00E5FF' }}>{infoModal.tagline}</p>
              </div>
              <button onClick={() => setInfoModal(null)} aria-label="Close"
                className="text-analog-text-muted hover:text-white transition-colors text-lg leading-none cursor-pointer">✕</button>
            </div>
            <div className="space-y-3.5 text-xs text-analog-text-muted leading-relaxed">
              <div>
                <p className="font-semibold text-white mb-1">How it works</p>
                <p>{infoModal.logic}</p>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">What the model is told</p>
                <p className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap" style={{ background: '#0E0E28', border: '1px solid rgba(107,94,155,0.3)', borderRadius: 8, padding: '10px 12px' }}>
                  {infoModal.thesis}
                </p>
                <p className="text-[10px] mt-1 opacity-60">Placeholders like [LANE] / [GENRES] / [ARTIST] are filled with your real data at generate time.</p>
              </div>
              <div>
                <p className="font-semibold text-white mb-1">Best for</p>
                <p>{infoModal.bestFor}</p>
              </div>
            </div>
            <button onClick={() => setInfoModal(null)}
              className="w-full py-2.5 rounded-lg font-semibold text-xs transition-colors cursor-pointer"
              style={{ background: 'rgba(255,0,110,0.15)', border: '1px solid rgba(255,0,110,0.4)', color: '#FF006E' }}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small shared components ───────────────────────────────────────────────────

function Section({ num, title, collapsed, onToggle, statusBadge, children }: {
  num: string; title: string; collapsed: boolean;
  onToggle: () => void; statusBadge?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-analog-card border border-analog-border rounded-xl overflow-hidden" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-6 py-5 hover:bg-analog-bg/30 transition-colors text-left">
        <span className="font-mono text-sm font-bold shrink-0" style={{ color: '#FF006E' }}>{num}</span>
        <span className="font-semibold text-white">{title}</span>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {collapsed && statusBadge}
        </div>
        <ChevronIcon collapsed={collapsed} />
      </button>
      {!collapsed && <div className="px-6 pb-7 space-y-5 border-t border-analog-border pt-6">{children}</div>}
    </div>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className={`w-4 h-4 text-analog-text-muted shrink-0 transition-transform ${collapsed ? '' : 'rotate-180'}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function Badge({ color, children }: { color: 'cyan' | 'pink' | 'dim' | 'amber'; children: React.ReactNode }) {
  const styles: Record<string, React.CSSProperties> = {
    cyan:  { color: '#00E5FF', background: 'rgba(0,229,255,0.1)',  border: '1px solid rgba(0,229,255,0.25)' },
    pink:  { color: '#FF006E', background: 'rgba(255,0,110,0.1)',  border: '1px solid rgba(255,0,110,0.25)' },
    dim:   { color: '#6B5E9B', background: 'rgba(107,94,155,0.1)', border: '1px solid rgba(107,94,155,0.2)' },
    amber: { color: '#FBB724', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)' },
  };
  return <span className="text-xs px-2 py-0.5 rounded-full font-mono whitespace-nowrap" style={styles[color]}>{children}</span>;
}

function StatusMsg({ text, inline }: { text: string; inline?: boolean }) {
  if (!text) return null;
  const ok = text.startsWith('✓');
  const el = (
    <p className={`text-xs ${inline ? 'inline' : ''}`}
      style={{ color: ok ? '#00E5FF' : '#FF3D3D' }}>
      {text}
    </p>
  );
  return inline ? <span>{el}</span> : el;
}
