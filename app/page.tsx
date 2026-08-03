"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { SPOTIFY_SOURCES, DEFAULT_SPOTIFY_SOURCES } from '@/lib/spotifySources';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Recommendation {
  artist: string;
  title: string;
  reasoning: string;
  genre_tags: string[];
}

interface UserState {
  username: string;
  isAdmin: boolean;
  historyCount: number;
  knownArtistCount: number;
  savedProviders: string[];
  spotifyConnected: boolean;
  lastFmConnected: boolean;
  settings: {
    obscurityLevel: number;
    outputFormat: string;
    recommendationLimit: number;
    requestsPerMinute?: number;
    spotifyPlaylistPublic?: boolean;
    lastFmUsername: string | null;
    spotifySources?: string[];
  };
}

type LogEntry = { time: string; msg: string; type: 'info' | 'success' | 'error' | 'warn' };

// ─── Provider Metadata ────────────────────────────────────────────────────────

interface ModelSuggestion { id: string; label: string; free?: boolean }

interface ProviderMeta {
  setupLink: string;
  setupSteps: string[];
  cheapModels: ModelSuggestion[];
  keyLabel: string;
  keyPlaceholder: string;
  keyNote?: string;
  isUrlField?: boolean;
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  'OpenAI': {
    setupLink: 'https://platform.openai.com/api-keys',
    setupSteps: [
      'Sign in at platform.openai.com',
      'Go to "API keys" in the left nav and click "Create new secret key"',
      'Paste the key below. New accounts receive $5 free credit to get started.',
    ],
    cheapModels: [
      { id: 'gpt-4.1-nano', label: 'gpt-4.1-nano — cheapest (~$0.10/M tokens)' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini — cheap, excellent quality (~$0.15/M tokens)' },
      { id: 'gpt-4o', label: 'gpt-4o — high quality (~$2.50/M tokens)' },
    ],
    keyLabel: 'OpenAI API Key',
    keyPlaceholder: 'sk-proj-...',
    keyNote: 'New accounts receive $5 free credit',
  },
  'Anthropic': {
    setupLink: 'https://console.anthropic.com/',
    setupSteps: [
      'Sign in at console.anthropic.com',
      'Go to Settings → API Keys and create a key',
      'No ongoing free tier — prepay credits to use the API',
    ],
    cheapModels: [
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5 — cheapest (~$1.00/M tokens)' },
      { id: 'claude-sonnet-5', label: 'claude-sonnet-5 — best balance (~$2.00/M tokens)' },
    ],
    keyLabel: 'Anthropic API Key',
    keyPlaceholder: 'sk-ant-...',
  },
  'Google Gemini': {
    setupLink: 'https://aistudio.google.com/app/apikey',
    setupSteps: [
      'Sign in at aistudio.google.com with your Google account',
      'Click "Get API Key" → "Create API key in new project"',
      'Free tier: 15 RPM, 1M tokens/day (not available in EU/UK — use OpenRouter instead)',
    ],
    cheapModels: [
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash — free tier, latest & smartest', free: true },
      { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite — free tier, fastest', free: true },
      { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash — free tier, proven reliable', free: true },
    ],
    keyLabel: 'Google AI Studio API Key',
    keyPlaceholder: 'AIzaSy...',
    keyNote: '✓ Generous free tier — best starting point (outside EU/UK)',
  },
  'OpenRouter': {
    setupLink: 'https://openrouter.ai/keys',
    setupSteps: [
      'Sign in at openrouter.ai and go to "Keys" → "Create Key"',
      'Free models need no credit — check openrouter.ai/models and filter by "Free" for current options',
      'Free tier: 20 req/min, 50 req/day (new accounts). Spend $10 lifetime for 1,000/day.',
    ],
    cheapModels: [
      { id: 'openrouter/free', label: 'Auto (best free model available) — most resilient', free: true },
      { id: 'google/gemini-2.0-flash-exp:free', label: 'gemini-2.0-flash:free — append :free to any free model', free: true },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'llama-3.3-70b:free — powerful open model', free: true },
    ],
    keyLabel: 'OpenRouter API Key',
    keyPlaceholder: 'sk-or-...',
    keyNote: '✓ Use openrouter/free as model for automatic best-free routing',
  },
  'Microsoft Foundry': {
    setupLink: 'https://ai.azure.com/',
    setupSteps: [
      'Sign in at ai.azure.com (Azure AI Foundry)',
      'Create a project, deploy a model, and copy your endpoint URL and API key',
      'Enter as: https://your-resource.openai.azure.com::your-api-key',
    ],
    cheapModels: [
      { id: 'gpt-4.1-nano', label: 'gpt-4.1-nano deployment — cheapest option' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini deployment' },
    ],
    keyLabel: 'Azure Endpoint & Key (format: endpoint::key)',
    keyPlaceholder: 'https://my-resource.openai.azure.com::api-key-here',
  },
  'Ollama': {
    setupLink: 'https://ollama.ai/',
    setupSteps: [
      'Install Ollama from ollama.ai on any machine on your network',
      'Pull a model: ollama pull qwen3:8b (or mistral, llama3.3:70b, deepseek-r1, etc.)',
      'Enter your Ollama URL below. From inside Docker, use host.docker.internal.',
    ],
    cheapModels: [
      { id: 'qwen3:8b', label: 'qwen3:8b — excellent instruction following, recommended' },
      { id: 'mistral:7b-instruct', label: 'mistral:7b-instruct — fast, nuanced taste understanding' },
      { id: 'qwen3:32b', label: 'qwen3:32b — best quality if you have 16GB+ VRAM' },
      { id: 'deepseek-r1', label: 'deepseek-r1 — best reasoning for complex taste profiles' },
    ],
    keyLabel: 'Ollama Base URL',
    keyPlaceholder: 'http://host.docker.internal:11434',
    keyNote: '✓ Completely free — runs on your own hardware',
    isUrlField: true,
  },
};

const PROVIDER_IDS = Object.keys(PROVIDER_META);

const OBSCURITY_LABELS: Record<number, string> = {
  1: 'Mainstream',
  2: 'Popular Indie',
  3: 'Critically Acclaimed',
  4: 'Deep Cut',
  5: 'Underground / Niche',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [user, setUser] = useState<UserState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageOrigin, setPageOrigin] = useState('');

  // Collapsed state — all collapsed by default
  const [collapsed, setCollapsed] = useState({ lastfm: true, spotify: true, provider: true, tuning: true });
  const toggle = (s: keyof typeof collapsed) => setCollapsed(p => ({ ...p, [s]: !p[s] }));

  // ── Last.fm state
  const [lastFmApiKey, setLastFmApiKey] = useState('');
  const [savingLastFmKey, setSavingLastFmKey] = useState(false);
  const [lastFmKeyStatus, setLastFmKeyStatus] = useState('');
  const [lastFmUsername, setLastFmUsername] = useState('');
  const [lastFmFetching, setLastFmFetching] = useState(false);
  const [lastFmStatus, setLastFmStatus] = useState('');
  const [isDragOverLastfm, setIsDragOverLastfm] = useState(false);
  const lastfmFileRef = useRef<HTMLInputElement>(null);

  // ── Spotify state
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('');
  const [spotifyBaseUrl, setSpotifyBaseUrl] = useState('');
  const [savingSpotify, setSavingSpotify] = useState(false);
  const [spotifyCredsStatus, setSpotifyCredsStatus] = useState('');
  const [spotifyFetching, setSpotifyFetching] = useState(false);
  const [isDragOverSpotify, setIsDragOverSpotify] = useState(false);
  const spotifyFileRef = useRef<HTMLInputElement>(null);
  const [spotifySources, setSpotifySources] = useState<string[]>(DEFAULT_SPOTIFY_SOURCES);

  // ── Imported artists list state
  const [artists, setArtists] = useState<string[]>([]);
  const [artistsTotal, setArtistsTotal] = useState(0);
  const [artistsOpen, setArtistsOpen] = useState(false);
  const [artistsLoading, setArtistsLoading] = useState(false);
  const [artistsLoaded, setArtistsLoaded] = useState(false);
  const [artistFilter, setArtistFilter] = useState('');

  // ── Upload state (separate per section)
  const [lastFmUploadStatus, setLastFmUploadStatus] = useState('');
  const [spotifyUploadStatus, setSpotifyUploadStatus] = useState('');

  // ── AI Provider state
  const [selectedProvider, setSelectedProvider] = useState('Google Gemini');
  const [modelInput, setModelInput] = useState('gemini-2.0-flash');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keySaving, setKeySaving] = useState(false);
  const [keyStatus, setKeyStatus] = useState('');
  const [rpm, setRpm] = useState(0); // 0 = unlimited

  // ── Tuning state
  const [obscurity, setObscurity] = useState(3);
  const [outputFormat, setOutputFormat] = useState('tracks');
  const [quantity, setQuantity] = useState(20);
  const [isPlaylistPublic, setIsPlaylistPublic] = useState(true);

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
    setPageOrigin(window.location.origin);
    fetch('/api/user/settings')
      .then(r => r.json())
      .then((data: UserState) => {
        setUser(data);
        setObscurity(data.settings.obscurityLevel ?? 3);
        setOutputFormat(data.settings.outputFormat ?? 'tracks');
        setQuantity(data.settings.recommendationLimit ?? 20);
        if (data.settings.requestsPerMinute !== undefined) setRpm(data.settings.requestsPerMinute);
        if (data.settings.spotifyPlaylistPublic !== undefined) setIsPlaylistPublic(data.settings.spotifyPlaylistPublic);
        if (data.settings.lastFmUsername) setLastFmUsername(data.settings.lastFmUsername);
        if (data.settings.spotifySources) setSpotifySources(data.settings.spotifySources);
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
    }
    const spotErr = params.get('spotify_error');
    if (spotErr) {
      window.history.replaceState({}, '', '/');
      const msgs: Record<string, string> = {
        missing_client_id: 'Missing Spotify Client ID — save it in the Spotify section first.',
        state_mismatch: 'OAuth state mismatch. Try connecting again.',
        token_exchange_failed: 'Token exchange failed — check your Client Secret.',
      };
      addLog(`Spotify: ${msgs[spotErr] ?? spotErr}`, 'error');
    }
  }, [addLog]);

  // Auto-save settings
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obscurityLevel: obscurity, outputFormat, recommendationLimit: quantity, requestsPerMinute: rpm, spotifyPlaylistPublic: isPlaylistPublic, spotifySources }),
      });
    }, 800);
    return () => clearTimeout(t);
  }, [obscurity, outputFormat, quantity, rpm, isPlaylistPublic, spotifySources, user]);

  // Update default model when provider changes
  useEffect(() => {
    const meta = PROVIDER_META[selectedProvider];
    if (meta?.cheapModels[0]) setModelInput(meta.cheapModels[0].id);
  }, [selectedProvider]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const saveKey = async (provider: string, value: string, onDone?: () => void) => {
    const res = await fetch('/api/user/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey: value }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    setUser(prev => prev ? { ...prev, savedProviders: [...new Set([...prev.savedProviders, provider])] } : prev);
    onDone?.();
  };

  const handleSaveLastFmKey = async () => {
    if (!lastFmApiKey.trim()) return;
    setSavingLastFmKey(true); setLastFmKeyStatus('');
    try {
      await saveKey('lastfm_api_key', lastFmApiKey.trim());
      setLastFmKeyStatus('✓ Last.fm API Key saved');
      setLastFmApiKey('');
    } catch (e: unknown) { setLastFmKeyStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`); }
    setSavingLastFmKey(false);
  };

  const handleLastFmFetch = async () => {
    if (!lastFmUsername.trim()) return;
    setLastFmFetching(true); setLastFmStatus('');
    try {
      const res = await fetch('/api/lastfm/fetch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: lastFmUsername.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLastFmStatus(`✓ ${data.message}`);
      setUser(prev => prev ? {
        ...prev, lastFmConnected: true,
        knownArtistCount: prev.knownArtistCount + data.artistCount,
        settings: { ...prev.settings, lastFmUsername: lastFmUsername.trim() },
      } : prev);
    } catch (e: unknown) { setLastFmStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`); }
    setLastFmFetching(false);
  };

  const handleSaveSpotify = async () => {
    setSavingSpotify(true); setSpotifyCredsStatus('');
    try {
      if (spotifyClientId.trim()) await saveKey('spotify_client_id', spotifyClientId.trim());
      if (spotifyClientSecret.trim()) await saveKey('spotify_client_secret', spotifyClientSecret.trim());
      if (spotifyBaseUrl.trim()) await saveKey('spotify_redirect_base_url', spotifyBaseUrl.trim());
      setSpotifyCredsStatus('✓ Spotify credentials saved');
      setSpotifyClientId(''); setSpotifyClientSecret(''); setSpotifyBaseUrl('');
    } catch (e: unknown) { setSpotifyCredsStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`); }
    setSavingSpotify(false);
  };

  const handleConnectSpotify = async () => {
    if (spotifyClientId.trim() || spotifyClientSecret.trim() || spotifyBaseUrl.trim()) {
      setSavingSpotify(true);
      try {
        if (spotifyClientId.trim()) await saveKey('spotify_client_id', spotifyClientId.trim());
        if (spotifyClientSecret.trim()) await saveKey('spotify_client_secret', spotifyClientSecret.trim());
        if (spotifyBaseUrl.trim()) await saveKey('spotify_redirect_base_url', spotifyBaseUrl.trim());
      } catch (e: unknown) {
        setSpotifyCredsStatus(`Error: ${e instanceof Error ? e.message : 'Failed to save credentials'}`);
        setSavingSpotify(false);
        return;
      }
      setSavingSpotify(false);
    }
    window.location.href = '/api/spotify/auth';
  };

  const handleSpotifyFetch = async () => {
    setSpotifyFetching(true);
    try {
      const res = await fetch('/api/spotify/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: spotifySources }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(prev => prev ? { ...prev, knownArtistCount: prev.knownArtistCount + data.addedArtists } : prev);
      addLog(`Spotify: ${data.message}`, 'success');
    } catch (e: unknown) { addLog(`Spotify fetch failed: ${e instanceof Error ? e.message : 'Error'}`, 'error'); }
    setSpotifyFetching(false);
  };

  const toggleSpotifySource = (key: string) => {
    setSpotifySources(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleToggleArtists = async () => {
    if (!artistsOpen && !artistsLoaded) {
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
    }
    setArtistsOpen(o => !o);
  };

  const handleFileUpload = async (file: File, type: 'endsong' | 'lastfm_csv') => {
    const isLastFm = type === 'lastfm_csv';
    const setStatus = isLastFm ? setLastFmUploadStatus : setSpotifyUploadStatus;
    setStatus('Uploading…');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatus(`✓ ${data.message}`);
      setUser(prev => prev ? {
        ...prev,
        knownArtistCount: prev.knownArtistCount + data.uniqueArtists,
        // Mark the relevant service as "connected" via file so the badge updates
        lastFmConnected: isLastFm ? true : prev.lastFmConnected,
        spotifyConnected: !isLastFm ? true : prev.spotifyConnected,
      } : prev);
    } catch (e: unknown) { setStatus(`Error: ${e instanceof Error ? e.message : 'Upload failed'}`); }
  };

  const handleSaveProviderKey = async () => {
    if (!apiKeyInput.trim()) return;
    setKeySaving(true); setKeyStatus('');
    try {
      await saveKey(selectedProvider, apiKeyInput.trim());
      setKeyStatus(`✓ Key saved for ${selectedProvider}`);
      setApiKeyInput('');
    } catch (e: unknown) { setKeyStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`); }
    setKeySaving(false);
  };

  const handleGenerate = async () => {
    setGenerating(true); setLogs([]); setResults([]); setSyncResult('');
    const delayMs = rpm > 0 ? Math.round(60000 / rpm) : 0;
    addLog(`Generating with ${selectedProvider} › ${modelInput}`, 'info');
    addLog(`Obscurity ${obscurity}/5 · ${outputFormat} · ${quantity} results${delayMs ? ` · ${rpm} RPM` : ''}`, 'info');
    try {
      addLog('Loading listening history & exclusion list from DB…', 'info');
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider, model: modelInput, obscurity, format: outputFormat, quantity, delayMs }),
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

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  // ── Derived values ──────────────────────────────────────────────────────────

  const hasKey = user?.savedProviders?.includes(selectedProvider);
  const hasHistory = (user?.knownArtistCount ?? 0) > 0;
  const hasLastFmKey = user?.savedProviders?.includes('lastfm_api_key');
  const hasSpotifyClientId = user?.savedProviders?.includes('spotify_client_id');
  const hasSpotifyBaseUrl = user?.savedProviders?.includes('spotify_redirect_base_url');
  const meta = PROVIDER_META[selectedProvider];
  const rpmLabel = rpm > 0 ? `${rpm} req/min` : 'Unlimited';
  const delayMsDisplay = rpm > 0 ? `${Math.round(60000 / rpm)}ms between calls` : 'No delay';

  // System prompt preview
  const promptPreview = `You are an expert music curator. Analyse listening history and recommend NEW music.
━━━━━━━━━━━━━━━━━━━━━━━━━
OBSCURITY TARGET: ${obscurity}/5 — ${OBSCURITY_LABELS[obscurity]}
OUTPUT: ${quantity} ${outputFormat === 'tracks' ? 'track' : 'album'} recommendations
━━━━━━━━━━━━━━━━━━━━━━━━━
USER'S TOP ARTISTS (weighted by play count):
  [ ${user?.knownArtistCount ?? 0} artists from your listening history ]

EXCLUDED ARTISTS (never recommend these):
  [ same ${user?.knownArtistCount ?? 0} artists — full list sent to model ]
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

  // Admin accounts are redirected at middleware level but handle gracefully here too
  if (user?.isAdmin) {
    return (
      <div className="min-h-screen bg-analog-bg text-analog-text font-sans flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-analog-card border border-analog-border rounded-xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-12 h-12 rounded-full border border-analog-accent flex items-center justify-center mx-auto text-analog-accent text-xl" style={{ boxShadow: '0 0 20px rgba(255,0,110,0.3)' }}>⚙</div>
          <div>
            <h1 className="text-xl font-bold text-white">Admin Account</h1>
            <p className="text-sm text-analog-text-muted mt-2">Admin accounts manage users only. Use a regular user account to run discoveries.</p>
          </div>
          <a href="/admin" className="block w-full py-3 bg-analog-accent hover:bg-analog-accent-hover text-white font-bold rounded transition-colors">
            User Management Portal
          </a>
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
        <div className="max-w-3xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="Sonic Horizon" className="w-7 h-7 rounded object-cover border border-analog-border" />
            <h1 className="font-bold text-lg tracking-tight gradient-text">Sonic Horizon</h1>
            <span className="text-analog-text-muted text-xs hidden sm:block">Deep Music Discovery</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 text-xs">
              <button onClick={handleToggleArtists} className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: hasHistory ? '#00E5FF' : '#27245A', boxShadow: hasHistory ? '0 0 6px #00E5FF' : 'none' }} />
                <span className="text-analog-text-muted">{user?.knownArtistCount ?? 0} artists{artistsOpen ? ' ▲' : ' ▼'}</span>
              </button>
            </div>
            <span className="text-xs text-analog-text-muted">{user?.username}</span>
            <button onClick={handleLogout} className="text-xs text-analog-text-muted hover:text-red-400 transition-colors">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-4">

        {/* ═══ Imported Artists list ══════════════════════════════════════════ */}
        {artistsOpen && (
          <div className="bg-analog-card border border-analog-border rounded-xl overflow-hidden" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
            <div className="px-6 py-3 flex flex-wrap items-center gap-3 border-b border-analog-border">
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
                    .filter(name => name.toLowerCase().includes(artistFilter.trim().toLowerCase()))
                    .map(name => (
                      <div key={name} className="px-6 py-2.5 text-sm text-analog-text hover:bg-analog-bg/40 transition-colors flex items-center gap-3">
                        <span className="w-1 h-1 rounded-full shrink-0" style={{ background: '#FF006E', boxShadow: '0 0 4px #FF006E' }} />
                        {name}
                      </div>
                    ))}
              {!artistsLoading && artists.length === 0 && (
                <div className="px-6 py-6 text-center text-xs text-analog-text-muted">No artists imported yet</div>
              )}
            </div>
          </div>
        )}

        {/* ═══ STEP 1: Last.fm ══════════════════════════════════════════════════ */}
        <Section
          num="01"
          title="Last.fm"
          collapsed={collapsed.lastfm}
          onToggle={() => toggle('lastfm')}
          statusBadge={
            user?.lastFmConnected
              ? <Badge color="cyan">{user.settings.lastFmUsername} · {user.knownArtistCount} artists</Badge>
              : <Badge color="dim">Not connected</Badge>
          }
        >
          {/* ── Option A: Connect via API ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,0,110,0.15)', color: '#FF006E' }}>Option A</span>
              <SectionLabel text="Connect live to your Last.fm account" />
            </div>
            <InstructionCard color="red" steps={[
              <>Open the <ExtLink href="https://www.last.fm/api/account/create">Last.fm API Account Creation page ↗</ExtLink></>,
              <>Set <strong>Application Name</strong> to <code className="text-analog-text bg-analog-bg px-1.5 py-0.5 rounded text-xs">Sonic Horizon</code> and submit</>,
              <>Copy your <strong>API Key</strong> and save it below, then enter your username and hit Fetch</>,
            ]} />
            <div className="flex gap-2">
              <input type="password" value={lastFmApiKey} onChange={e => setLastFmApiKey(e.target.value)}
                placeholder={hasLastFmKey ? '•••••••••••••••• (saved)' : 'Enter Last.fm API Key'}
                className="flex-1 bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
              <SaveBtn onClick={handleSaveLastFmKey} saving={savingLastFmKey} disabled={!lastFmApiKey.trim()}>Save Key</SaveBtn>
            </div>
            <StatusMsg text={lastFmKeyStatus} />

            <div className="flex gap-2">
              <input type="text" value={lastFmUsername} onChange={e => setLastFmUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLastFmFetch()}
                placeholder="your-lastfm-username"
                className="flex-1 bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
              <button onClick={handleLastFmFetch} disabled={lastFmFetching || !lastFmUsername.trim()}
                className="px-4 py-2 bg-analog-accent hover:bg-analog-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm rounded transition-colors">
                {lastFmFetching ? 'Fetching…' : 'Fetch Artists'}
              </button>
            </div>
            <StatusMsg text={lastFmStatus} />
          </div>

          {/* Divider */}
          <div className="relative flex items-center gap-3">
            <div className="flex-1 border-t border-analog-border" />
            <span className="text-xs text-analog-text-muted font-semibold shrink-0">OR</span>
            <div className="flex-1 border-t border-analog-border" />
          </div>

          {/* ── Option B: Upload a file ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(0,229,255,0.1)', color: '#00E5FF' }}>Option B</span>
              <SectionLabel text="Import from a CSV export — no API key needed" />
            </div>
            <DropZone
              active={isDragOverLastfm}
              onDragOver={() => setIsDragOverLastfm(true)}
              onDragLeave={() => setIsDragOverLastfm(false)}
              onDrop={f => { setIsDragOverLastfm(false); handleFileUpload(f, 'lastfm_csv'); }}
              onClick={() => lastfmFileRef.current?.click()}
            >
              <p className="text-xs text-analog-text-muted text-center">
                Drop or click to upload your <strong className="text-analog-text">Last.fm CSV file</strong>
              </p>
              <input ref={lastfmFileRef} type="file" accept=".csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, 'lastfm_csv'); }} />
            </DropZone>
            <p className="text-xs text-analog-text-muted mt-1.5">
              💡 Export your scrobbles free at <ExtLink href="https://lastfm.ghan.nl/export/">lastfm.ghan.nl/export ↗</ExtLink> — no login needed, just your username.
            </p>
            <StatusMsg text={lastFmUploadStatus} />
          </div>
        </Section>

        {/* ═══ STEP 2: Spotify ══════════════════════════════════════════════════ */}
        <Section
          num="02"
          title="Spotify"
          collapsed={collapsed.spotify}
          onToggle={() => toggle('spotify')}
          statusBadge={
            user?.spotifyConnected
              ? <Badge color="cyan">{spotifyUploadStatus ? 'Imported via file' : 'Connected via OAuth'}</Badge>
              : <Badge color="dim">Not connected</Badge>
          }
        >
          {/* ── Option A: OAuth ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,0,110,0.15)', color: '#FF006E' }}>Option A</span>
              <SectionLabel text="Connect your Spotify account via OAuth" />
            </div>
            <InstructionCard color="green" steps={[
              <>Open the <ExtLink href="https://developer.spotify.com/dashboard">Spotify Developer Dashboard ↗</ExtLink> and log in</>,
              <>Click <strong>Create App</strong>. Name it <code className="text-analog-text bg-analog-bg px-1.5 py-0.5 rounded text-xs">Sonic Horizon</code></>,
              <>
                Set <strong>Redirect URI</strong> to{' '}
                <code className="text-sh-cyan bg-analog-bg px-1.5 py-0.5 rounded text-xs font-mono select-all">
                  {pageOrigin
                    ? (pageOrigin.includes('localhost')
                        ? `${pageOrigin.replace('localhost', '127.0.0.1')}/api/spotify/callback`
                        : `${pageOrigin}/api/spotify/callback`)
                    : 'http://127.0.0.1:8080/api/spotify/callback'}
                </code>
              </>,
              <>Save your <strong>Client ID</strong> and <strong>Client Secret</strong> below, then click Connect</>,
            ]} />

            {/* Spotify API Scope & Limitation Notice */}
            <div className="rounded-lg p-3 text-xs leading-relaxed" style={{ background: 'rgba(153,69,255,0.06)', border: '1px solid rgba(153,69,255,0.25)' }}>
              <p style={{ color: '#00E5FF' }} className="font-semibold mb-1">ℹ Note on Live API vs Full Export:</p>
              <p className="text-analog-text-muted">
                Spotify&apos;s live API limits access to your <strong>recent tracks, liked songs, and top ~150 artists</strong>.
                If you want your <em>complete, 100% lifetime listening history</em> (all-time scrobbles), use <strong className="text-white">Option B</strong> below to upload your Spotify data export instead.
              </p>
            </div>

            {/* Dynamic Spotify Callback URL Helper / Warning */}
            {(() => {
              const isHttps = pageOrigin.startsWith('https://');
              const isLocalhost = pageOrigin.includes('localhost');
              const isLoopback = pageOrigin.startsWith('http://127.0.0.1') || pageOrigin.startsWith('http://[::1]');

              if (isHttps) {
                return (
                  <div className="rounded-lg p-3.5 space-y-1 text-xs" style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.3)' }}>
                    <p className="font-semibold text-sh-cyan">✓ Valid HTTPS Connection Detected</p>
                    <p className="text-analog-text-muted leading-relaxed">
                      Spotify fully supports HTTPS redirect URIs. Register <code className="text-white font-mono bg-analog-bg px-1 py-0.5 rounded">{pageOrigin}/api/spotify/callback</code> in your Spotify Dashboard.
                    </p>
                  </div>
                );
              }

              if (isLoopback) {
                return (
                  <div className="rounded-lg p-3.5 space-y-1 text-xs" style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.3)' }}>
                    <p className="font-semibold text-sh-cyan">✓ Valid Local Loopback Address (127.0.0.1)</p>
                    <p className="text-analog-text-muted leading-relaxed">
                      Spotify permits HTTP for local loopback testing. Register <code className="text-white font-mono bg-analog-bg px-1 py-0.5 rounded">{pageOrigin}/api/spotify/callback</code> in your Spotify Dashboard.
                    </p>
                  </div>
                );
              }

              if (isLocalhost) {
                return (
                  <div className="rounded-lg p-3.5 space-y-1.5 text-xs" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.3)' }}>
                    <p className="font-semibold" style={{ color: '#FBB724' }}>⚠ Prohibited Origin: <code>localhost</code></p>
                    <p className="text-analog-text-muted leading-relaxed">
                      Spotify prohibits using <code className="text-white">localhost</code> in HTTP redirect URIs.
                    </p>
                    <p className="text-analog-text-muted">
                      👉 <strong>Action required:</strong> Open this app at{' '}
                      <a href={pageOrigin.replace('localhost', '127.0.0.1')} className="underline font-semibold" style={{ color: '#FF006E' }}>
                        {pageOrigin.replace('localhost', '127.0.0.1')}
                      </a>{' '}
                      instead, and set <code className="text-white font-mono bg-analog-bg px-1 py-0.5 rounded">{pageOrigin.replace('localhost', '127.0.0.1')}/api/spotify/callback</code> as your Redirect URI in Spotify Dashboard.
                    </p>
                  </div>
                );
              }

              // HTTP over LAN IP or non-loopback domain
              return (
                <div className="rounded-lg p-3.5 space-y-1.5 text-xs" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.3)' }}>
                  <p className="font-semibold" style={{ color: '#FBB724' }}>⚠ HTTP over Local Network Detected ({pageOrigin})</p>
                  <p className="text-analog-text-muted leading-relaxed">
                    Spotify requires <strong className="text-white">HTTPS</strong> for non-loopback callback URLs (HTTP is only permitted on <code className="text-white">127.0.0.1</code>).
                  </p>
                  <p className="text-analog-text-muted">
                    If self-hosting across your network, use an HTTPS reverse proxy (e.g. Nginx, Traefik, Caddy, or Cloudflare Tunnel) or connect locally at <code className="text-white font-mono bg-analog-bg px-1 py-0.5 rounded">http://127.0.0.1:8080</code>.
                  </p>
                </div>
              );
            })()}

            {/* Client credentials */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-analog-text-muted mb-1">
                  Spotify Client ID {hasSpotifyClientId && <span className="text-sh-cyan font-normal">✓ saved</span>}
                </label>
                <input type="password" value={spotifyClientId} onChange={e => setSpotifyClientId(e.target.value)}
                  placeholder={hasSpotifyClientId ? '•••••••••••••••• (saved)' : 'Client ID'}
                  className="w-full bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
              </div>
              <div>
                <label className="block text-xs text-analog-text-muted mb-1">Spotify Client Secret</label>
                <input type="password" value={spotifyClientSecret} onChange={e => setSpotifyClientSecret(e.target.value)}
                  placeholder="Client Secret"
                  className="w-full bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
              </div>
            </div>

            {/* Base URL override */}
            <div>
              <label className="block text-xs text-analog-text-muted mb-1">
                App Base URL (Redirect URI base)
                {hasSpotifyBaseUrl && <span className="ml-2 text-sh-cyan">✓ saved</span>}
              </label>
              <input type="text" value={spotifyBaseUrl} onChange={e => setSpotifyBaseUrl(e.target.value)}
                placeholder="http://192.168.1.100:8080 — required if accessing via IP"
                className="w-full bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
              <p className="text-xs text-analog-text-muted mt-1">
                Register exactly{' '}
                <code className="text-sh-cyan font-mono bg-analog-bg px-1.5 py-0.5 rounded text-xs select-all">
                  {(spotifyBaseUrl.trim() || (pageOrigin.includes('localhost') ? pageOrigin.replace('localhost', '127.0.0.1') : pageOrigin) || 'http://127.0.0.1:8080').replace(/\/$/, '')}/api/spotify/callback
                </code>{' '}
                in your Spotify Dashboard.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <SaveBtn onClick={handleSaveSpotify} saving={savingSpotify}
                disabled={!spotifyClientId.trim() && !spotifyClientSecret.trim() && !spotifyBaseUrl.trim()}>
                Save Spotify Credentials
              </SaveBtn>
              <StatusMsg text={spotifyCredsStatus} inline />
            </div>

            {/* Connect / Sync buttons */}
            <div className="flex flex-wrap gap-3 pt-1">
              {!user?.spotifyConnected ? (
                <button onClick={handleConnectSpotify} disabled={savingSpotify}
                  className="inline-flex items-center gap-2 px-4 py-2.5 font-semibold text-sm rounded transition-colors text-black disabled:opacity-50"
                  style={{ background: '#1DB954', boxShadow: '0 0 15px rgba(29,185,84,0.2)' }}>
                  {savingSpotify ? 'Saving & Connecting…' : 'Connect Spotify via OAuth'}
                </button>
              ) : (
                <>
                  <button onClick={handleConnectSpotify} disabled={savingSpotify}
                    className="inline-flex items-center gap-2 px-4 py-2.5 font-semibold text-sm rounded transition-colors text-black disabled:opacity-50"
                    style={{ background: '#1DB954', boxShadow: '0 0 15px rgba(29,185,84,0.2)' }}>
                    {savingSpotify ? 'Saving & Connecting…' : 'Reconnect Spotify via OAuth'}
                  </button>
                  <button onClick={handleSpotifyFetch} disabled={spotifyFetching}
                    className="px-4 py-2 border rounded text-sm font-medium transition-colors disabled:opacity-40"
                    style={{ borderColor: '#1DB954', color: '#1DB954' }}>
                    {spotifyFetching ? 'Syncing…' : 'Refresh Top Artists from Spotify'}
                  </button>
                </>
              )}
            </div>

            {/* Which Spotify data sources to import */}
            <div className="pt-2">
              <label className="block text-xs text-analog-text-muted mb-2">
                Spotify data sources to import
                <span className="ml-1 text-sh-cyan font-normal">({spotifySources.length}/{SPOTIFY_SOURCES.length} on)</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SPOTIFY_SOURCES.map(s => {
                  const on = spotifySources.includes(s.key);
                  return (
                    <button key={s.key} onClick={() => toggleSpotifySource(s.key)}
                      className={`px-3 py-2 text-xs rounded-lg border transition-all text-left flex items-center gap-2 cursor-pointer ${
                        on ? 'border-analog-accent text-white' : 'border-analog-border text-analog-text-muted hover:text-white'
                      }`}
                      style={on ? { background: 'rgba(255,0,110,0.1)', boxShadow: '0 0 0 1px rgba(255,0,110,0.3)' } : {}}>
                      <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[9px] shrink-0 ${
                        on ? 'bg-analog-accent border-analog-accent text-white' : 'border-analog-border'
                      }`}>
                        {on ? '✓' : ''}
                      </span>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-analog-text-muted mt-1.5">
                All on by default. Unticked sources are skipped on the next refresh.
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="relative flex items-center gap-3">
            <div className="flex-1 border-t border-analog-border" />
            <span className="text-xs text-analog-text-muted font-semibold shrink-0">OR</span>
            <div className="flex-1 border-t border-analog-border" />
          </div>

          {/* ── Option B: File Upload ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(0,229,255,0.1)', color: '#00E5FF' }}>Option B</span>
              <SectionLabel text="Import lifetime history from Spotify data export — no app setup needed" />
            </div>
            <DropZone
              active={isDragOverSpotify}
              onDragOver={() => setIsDragOverSpotify(true)}
              onDragLeave={() => setIsDragOverSpotify(false)}
              onDrop={f => { setIsDragOverSpotify(false); handleFileUpload(f, 'endsong'); }}
              onClick={() => spotifyFileRef.current?.click()}
            >
              <p className="text-xs text-analog-text-muted text-center">
                Drop or click to upload <strong className="text-analog-text">endsong_*.json</strong> from your Spotify data export
              </p>
              <input ref={spotifyFileRef} type="file" accept=".json" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f, 'endsong'); }} />
            </DropZone>
            <p className="text-xs text-analog-text-muted mt-1.5">
              💡 Request your export at <ExtLink href="https://www.spotify.com/account/privacy">spotify.com/account/privacy ↗</ExtLink> → Extended Streaming History (takes ~30 days via email).
            </p>
            <StatusMsg text={spotifyUploadStatus} />
          </div>
        </Section>

        {/* ═══ STEP 3: AI Provider ══════════════════════════════════════════════ */}
        <Section
          num="03"
          title="AI Provider"
          collapsed={collapsed.provider}
          onToggle={() => toggle('provider')}
          statusBadge={
            hasKey
              ? <Badge color="cyan">{selectedProvider} · key saved</Badge>
              : <Badge color="dim">{selectedProvider} · no key</Badge>
          }
        >
          {/* Provider selector */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PROVIDER_IDS.map(p => {
              const saved = user?.savedProviders?.includes(p);
              const isFree = PROVIDER_META[p].cheapModels.some(m => m.free);
              return (
                <button key={p} onClick={() => setSelectedProvider(p)}
                  className={`px-3 py-2.5 border rounded-lg text-xs text-left transition-all relative ${
                    selectedProvider === p
                      ? 'border-analog-accent text-white font-semibold'
                      : 'bg-analog-bg border-analog-border hover:border-analog-accent text-analog-text-muted hover:text-white'
                  }`}
                  style={selectedProvider === p ? { background: 'rgba(255,0,110,0.12)', boxShadow: '0 0 15px rgba(255,0,110,0.15)' } : {}}>
                  {p}
                  {isFree && <span className="ml-1 text-[9px] text-sh-cyan">(free)</span>}
                  {saved && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: '#00E5FF', boxShadow: '0 0 4px #00E5FF' }} />}
                </button>
              );
            })}
          </div>

          {/* Provider setup instructions */}
          <InstructionCard color="pink" steps={meta.setupSteps.map((s, i) => <span key={i}>{s}</span>)}>
            <a href={meta.setupLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-analog-accent hover:underline text-xs font-semibold mt-1">
              Open {selectedProvider} Console ↗
            </a>
            {meta.keyNote && <p className="text-xs mt-1" style={{ color: '#00E5FF' }}>{meta.keyNote}</p>}
          </InstructionCard>

          {/* Model — free text with suggestions */}
          <div>
            <label className="block text-xs text-analog-text-muted mb-1.5">Model</label>
            <input type="text" value={modelInput} onChange={e => setModelInput(e.target.value)}
              placeholder="Enter model name"
              className="w-full bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
            {/* Model suggestion chips */}
            <div className="flex flex-wrap gap-2 mt-2">
              {meta.cheapModels.map(m => (
                <button key={m.id} onClick={() => setModelInput(m.id)}
                  className={`text-xs px-2.5 py-1 rounded border transition-colors text-left ${
                    modelInput === m.id
                      ? 'border-analog-accent text-white'
                      : 'border-analog-border text-analog-text-muted hover:border-analog-accent hover:text-white'
                  }`}
                  style={modelInput === m.id ? { background: 'rgba(255,0,110,0.1)' } : {}}>
                  {m.free && <span className="mr-1" style={{ color: '#00E5FF' }}>★</span>}
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-analog-text-muted mt-1.5">
              <span style={{ color: '#00E5FF' }}>★</span> = free tier available
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-analog-text-muted mb-1.5">
              {meta.keyLabel}
              {hasKey && <span className="ml-2 font-normal" style={{ color: '#00E5FF' }}>✓ Saved</span>}
            </label>
            <div className="flex gap-2">
              <input type={meta.isUrlField ? 'text' : 'password'} value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder={hasKey ? '•••••••••••• (saved — enter new value to update)' : meta.keyPlaceholder}
                className="flex-1 bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
              <SaveBtn onClick={handleSaveProviderKey} saving={keySaving} disabled={!apiKeyInput.trim()}>Save</SaveBtn>
            </div>
            <StatusMsg text={keyStatus} />
          </div>

          {/* RPM */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-analog-text-muted">Rate Limit</label>
              <span className="text-xs font-mono text-white">{rpmLabel} <span className="text-analog-text-muted">({delayMsDisplay})</span></span>
            </div>
            <div className="flex items-center gap-3">
              <input type="number" min={0} max={600} value={rpm === 0 ? '' : rpm}
                onChange={e => setRpm(e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value) || 0))}
                placeholder="∞"
                className="w-28 bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors" />
              <span className="text-xs text-analog-text-muted">requests/min (leave blank for unlimited)</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {[[0, 'Unlimited'], [15, '15 RPM (Gemini free)'], [60, '60 RPM (OpenAI free)'], [20, '20 RPM (OpenRouter free)']].map(([val, label]) => (
                <button key={val} onClick={() => setRpm(val as number)}
                  className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                    rpm === val ? 'border-analog-accent text-white' : 'border-analog-border text-analog-text-muted hover:border-analog-accent hover:text-white'
                  }`}
                  style={rpm === val ? { background: 'rgba(255,0,110,0.1)' } : {}}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* ═══ STEP 4: Tuning ═══════════════════════════════════════════════════ */}
        <Section
          num="04"
          title="Discovery Tuning"
          collapsed={collapsed.tuning}
          onToggle={() => toggle('tuning')}
          statusBadge={
            <Badge color="cyan">
              {OBSCURITY_LABELS[obscurity]} · {outputFormat} · {quantity}
            </Badge>
          }
        >
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
              <input type="range" min={outputFormat === 'tracks' ? 10 : 5} max={outputFormat === 'tracks' ? 50 : 20}
                step={5} value={quantity} onChange={e => setQuantity(Number(e.target.value))}
                className="w-full mt-2" style={{ accentColor: '#FF006E' }} />
              <div className="flex justify-between text-xs text-analog-text-muted mt-1 font-mono">
                <span>{outputFormat === 'tracks' ? 10 : 5}</span><span>{outputFormat === 'tracks' ? 50 : 20}</span>
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
        </Section>

        {/* ═══ STEP 5: Schedule (Coming Soon) ══════════════════════════════════ */}
        <div className="relative" aria-disabled="true">
          {/* Overlay */}
          <div className="absolute inset-0 z-10 rounded-xl" style={{ background: 'rgba(7,7,26,0.6)', backdropFilter: 'blur(1px)' }} />
          <div className="bg-analog-card border border-analog-border rounded-xl overflow-hidden opacity-50">
            <div className="px-6 py-4 flex items-center gap-3">
              <span className="font-mono text-sm font-bold shrink-0" style={{ color: '#6B5E9B' }}>05</span>
              <span className="font-semibold text-analog-text-muted">Scheduled Refreshes</span>
              <div className="flex-1" />
              <span className="text-xs px-2.5 py-1 rounded-full font-mono border"
                style={{ color: '#6B5E9B', borderColor: '#27245A', background: 'rgba(39,36,90,0.4)' }}>
                Coming Soon
              </span>
            </div>
            <div className="px-6 pb-5 pt-2 space-y-3 border-t border-analog-border">
              <p className="text-xs text-analog-text-muted">
                Automatically re-run your discovery on a schedule. Will refresh Last.fm / Spotify data first,
                then generate new recommendations — never suggesting anything you&apos;ve already received.
              </p>
              <div className="grid grid-cols-3 gap-3 opacity-60">
                {['Daily', 'Weekly', 'Monthly'].map(label => (
                  <button key={label} disabled
                    className="py-2.5 text-sm border border-analog-border rounded-lg text-analog-text-muted cursor-not-allowed">
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ═══ STEP 6: Generate ════════════════════════════════════════════════ */}
        <div className="space-y-4">
          {!hasHistory && (
            <div className="text-center py-3 px-4 rounded-lg text-sm" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#FBB724' }}>
              ⚠ Connect Last.fm or Spotify (Steps 1–2) to build your listening profile first
            </div>
          )}
          {!hasKey && (
            <div className="text-center py-3 px-4 rounded-lg text-sm" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#FBB724' }}>
              ⚠ Save an API key in Step 3 before generating
            </div>
          )}

          <button onClick={handleGenerate} disabled={generating || !hasHistory || !hasKey}
            className={`w-full py-5 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3 group relative overflow-hidden ${
              generating || !hasHistory || !hasKey ? 'opacity-40 cursor-not-allowed' : ''
            }`}
            style={(!generating && hasHistory && hasKey) ? {
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
          {hasHistory && hasKey && (
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

        {/* ═══ STEP 6: Results + Log ════════════════════════════════════════════ */}
        {(logs.length > 0 || results.length > 0) && (
          <section className="space-y-4">
            {/* Results (First) */}
            {results.length > 0 && (
              <div className="bg-analog-card rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,0,110,0.3)', boxShadow: '0 0 40px rgba(255,0,110,0.08)' }}>
                <div className="px-6 py-4 border-b border-analog-border flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#00E5FF', boxShadow: '0 0 8px #00E5FF' }} />
                  <span className="font-semibold text-white">{results.length} Discovery Results</span>
                  <span className="text-xs text-analog-text-muted">— all added to exclusion list</span>
                </div>

                <div className="divide-y divide-analog-border">
                  {results.map((item, i) => (
                    <div key={i} className="px-6 py-4 hover:bg-analog-bg/40 transition-colors flex gap-4">
                      <span className="text-analog-text-muted font-mono text-sm pt-0.5 w-6 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
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
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-6 py-4 border-t border-analog-border flex flex-wrap gap-3 items-center justify-between">
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
                    <button onClick={handleGenerate} disabled={generating}
                      className="px-5 py-2.5 border border-analog-border hover:border-analog-accent text-analog-text-muted hover:text-white text-sm rounded-lg transition-colors">
                      Regenerate
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Log (Second - Bottom) */}
            {logs.length > 0 && (
              <div className="bg-analog-card border border-analog-border rounded-xl overflow-hidden">
                <div className="px-4 py-2 border-b border-analog-border flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{
                    background: generating ? '#FF006E' : results.length > 0 ? '#00E5FF' : '#FF3D3D',
                    boxShadow: generating ? '0 0 8px #FF006E' : results.length > 0 ? '0 0 8px #00E5FF' : 'none',
                    animation: generating ? 'pulse 1s infinite' : 'none',
                  }} />
                  <span className="text-xs font-mono text-analog-text-muted">Generation Log</span>
                </div>
                <div className="p-4 font-mono text-xs space-y-1 max-h-44 overflow-y-auto">
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
        <span className="gradient-text font-semibold">Sonic Horizon</span> · Self-hosted · All data stays local
      </footer>
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
        className="w-full flex items-center gap-3 px-6 py-4 hover:bg-analog-bg/30 transition-colors text-left">
        <span className="font-mono text-sm font-bold shrink-0" style={{ color: '#FF006E' }}>{num}</span>
        <span className="font-semibold text-white">{title}</span>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {collapsed && statusBadge}
        </div>
        <ChevronIcon collapsed={collapsed} />
      </button>
      {!collapsed && <div className="px-6 pb-6 space-y-4 border-t border-analog-border pt-5">{children}</div>}
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

function Badge({ color, children }: { color: 'cyan' | 'pink' | 'dim'; children: React.ReactNode }) {
  const styles: Record<string, React.CSSProperties> = {
    cyan:  { color: '#00E5FF', background: 'rgba(0,229,255,0.1)',  border: '1px solid rgba(0,229,255,0.25)' },
    pink:  { color: '#FF006E', background: 'rgba(255,0,110,0.1)',  border: '1px solid rgba(255,0,110,0.25)' },
    dim:   { color: '#6B5E9B', background: 'rgba(107,94,155,0.1)', border: '1px solid rgba(107,94,155,0.2)' },
  };
  return <span className="text-xs px-2 py-0.5 rounded-full font-mono whitespace-nowrap" style={styles[color]}>{children}</span>;
}

function InstructionCard({ color, steps, children }: {
  color: 'red' | 'green' | 'pink'; steps: React.ReactNode[]; children?: React.ReactNode;
}) {
  const accent = color === 'red' ? '#D51007' : color === 'green' ? '#1DB954' : '#FF006E';
  return (
    <div className="rounded-lg p-4 text-xs space-y-2"
      style={{ background: '#0E0E28', border: `1px solid rgba(107,94,155,0.3)`, borderLeft: `3px solid ${accent}` }}>
      <ol className="list-none space-y-1.5 text-analog-text-muted">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 font-mono" style={{ color: accent }}>{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {children}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <p className="text-xs font-semibold text-analog-text-muted uppercase tracking-wide">{text}</p>;
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="font-semibold hover:underline" style={{ color: '#FF006E' }}>
      {children}
    </a>
  );
}

function SaveBtn({ onClick, saving, disabled, children }: {
  onClick: () => void; saving: boolean; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={saving || disabled}
      className="px-4 py-2 border border-analog-border hover:border-analog-accent disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm rounded transition-colors whitespace-nowrap"
      style={(!disabled && !saving) ? { background: 'rgba(255,0,110,0.08)' } : {}}>
      {saving ? 'Saving…' : children}
    </button>
  );
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

function DropZone({ active, onDragOver, onDragLeave, onDrop, onClick, children }: {
  active: boolean; onDragOver: () => void; onDragLeave: () => void;
  onDrop: (f: File) => void; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <div
      onDragOver={e => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onDrop(f); }}
      onClick={onClick}
      className="border border-dashed rounded-lg p-4 cursor-pointer transition-all"
      style={{
        borderColor: active ? '#FF006E' : 'rgba(107,94,155,0.4)',
        background: active ? 'rgba(255,0,110,0.05)' : 'transparent',
      }}>
      {children}
    </div>
  );
}
