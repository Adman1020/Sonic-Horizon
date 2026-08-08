"use client";

import { useState, useEffect } from 'react';

interface AppUser {
  id: string;
  spotifyId: string | null;
  spotifyUsername: string | null;
  spotifyEmail: string | null;
  isAdmin: boolean;
  approved: boolean;
  createdAt: string;
}

const AI_PROVIDERS = [
  'OpenAI',
  'Anthropic',
  'Google Gemini',
  'OpenRouter',
  'Microsoft Foundry',
  'Ollama',
];

function displayName(u: AppUser): string {
  return u.spotifyUsername || u.spotifyEmail || u.spotifyId || 'Unknown';
}

export default function AdminPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Record<string, string>>({});

  // ── AI configuration state
  const [aiLoading, setAiLoading] = useState(true);
  const [aiProvider, setAiProvider] = useState('Google Gemini');
  const [aiModel, setAiModel] = useState('');
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [aiRpm, setAiRpm] = useState(5);
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiStatus, setAiStatus] = useState('');

  const loadAIConfig = async () => {
    try {
      const res = await fetch('/api/admin/config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const c = data.ai;
      setAiConfigured(c.configured);
      setAiProvider(c.provider ?? 'Google Gemini');
      setAiModel(c.model ?? '');
      setAiRpm(c.rpm ?? 5);
      setAiHasKey(c.hasKey);
    } catch (e: unknown) {
      setAiStatus(`Error: ${e instanceof Error ? e.message : 'Failed to load AI config'}`);
    }
    setAiLoading(false);
  };

  const saveAIConfig = async () => {
    setAiStatus('');
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          model: aiModel.trim(),
          apiKey: aiKeyInput,
          rpm: aiRpm,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAiKeyInput('');
      setAiStatus('✓ AI configuration saved');
      setAiConfigured(true);
      await loadAIConfig();
    } catch (e: unknown) {
      setAiStatus(`Error: ${e instanceof Error ? e.message : 'Failed to save AI config'}`);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers(data.users);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    }
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, []);
  useEffect(() => { loadAIConfig(); }, []);

  const updateUser = async (id: string, body: Record<string, unknown>, successMsg: string) => {
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatus(s => ({ ...s, [id]: successMsg }));
      loadUsers();
    } catch (e: unknown) {
      setStatus(s => ({ ...s, [id]: `Error: ${e instanceof Error ? e.message : '?'}` }));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadUsers();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const pending = users.filter(u => !u.approved);

  return (
    <div className="min-h-screen bg-analog-bg text-analog-text font-sans">
      <header className="sticky top-0 z-50 bg-analog-bg/95 backdrop-blur border-b border-analog-border">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-analog-accent" />
            <span className="font-bold text-white">Sonic Horizon</span>
            <span className="text-analog-text-muted text-xs">Admin Panel</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/" className="text-xs text-analog-text-muted hover:text-white transition-colors">
              Back to app
            </a>
            <button
              onClick={handleLogout}
              className="text-xs text-analog-text-muted hover:text-red-400 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">

        {/* AI Configuration */}
        <section className="bg-analog-card border border-analog-border rounded-xl overflow-hidden shadow-xl">
          <div className="px-6 py-5 border-b border-analog-border flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white">AI Configuration</h2>
              <p className="text-xs text-analog-text-muted mt-0.5">
                One provider, model and API key shared by every user. Set once here — no per-user keys needed.
              </p>
            </div>
            {aiConfigured ? (
              <span className="text-xs px-2 py-0.5 rounded-full font-mono whitespace-nowrap"
                style={{ color: '#00E5FF', background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.25)' }}>
                Configured
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full font-mono whitespace-nowrap"
                style={{ color: '#FBB724', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)' }}>
                Not configured
              </span>
            )}
          </div>

          {aiLoading ? (
            <div className="p-6 text-center text-analog-text-muted text-sm">Loading…</div>
          ) : (
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs text-analog-text-muted mb-1.5">Provider</label>
                <select
                  value={aiProvider}
                  onChange={e => setAiProvider(e.target.value)}
                  className="w-full bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-analog-accent transition-colors"
                >
                  {AI_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs text-analog-text-muted mb-1.5">Model</label>
                <input
                  type="text"
                  value={aiModel}
                  onChange={e => setAiModel(e.target.value)}
                  placeholder={aiProvider === 'OpenAI' ? 'gpt-4.1-nano' : aiProvider === 'Anthropic' ? 'claude-haiku-4-5' : aiProvider === 'Google Gemini' ? 'gemini-3.6-flash' : aiProvider === 'OpenRouter' ? 'openrouter/free' : aiProvider === 'Microsoft Foundry' ? 'gpt-4o-mini' : 'llama3.2'}
                  className="w-full bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs text-analog-text-muted mb-1.5">
                  {aiProvider === 'Ollama' ? 'Ollama Base URL (optional — defaults to host.docker.internal:11434)' : `API Key${aiHasKey ? ' (saved — leave blank to keep it)' : ''}`}
                </label>
                <input
                  type="password"
                  value={aiKeyInput}
                  onChange={e => setAiKeyInput(e.target.value)}
                  placeholder={aiHasKey ? '•••••••••••• (saved)' : aiProvider === 'Ollama' ? 'http://host.docker.internal:11434' : 'Paste API key'}
                  className="w-full bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors"
                />
                {aiProvider === 'Microsoft Foundry' && (
                  <p className="text-xs text-analog-text-muted mt-1">Format: https://your-resource.openai.azure.com::your-api-key</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-analog-text-muted mb-1.5">Rate limit (requests/min, 0 = unlimited)</label>
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={aiRpm === 0 ? '' : aiRpm}
                  onChange={e => setAiRpm(e.target.value === '' ? 0 : Math.max(0, Math.min(600, parseInt(e.target.value) || 0)))}
                  placeholder="∞"
                  className="w-32 bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors"
                />
                <p className="text-xs text-analog-text-muted mt-1">
                  Inserts a small delay between LLM calls to protect your quota. 5/min is a safe default.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={saveAIConfig}
                  className="px-4 py-2 border border-analog-border hover:border-analog-accent text-white font-medium text-sm rounded transition-colors"
                  style={{ background: 'rgba(255,0,110,0.08)' }}
                >
                  Save AI configuration
                </button>
                {aiStatus && (
                  <p className={`text-xs ${aiStatus.startsWith('✓') ? '' : 'text-red-400'}`}
                    style={aiStatus.startsWith('✓') ? { color: '#00E5FF' } : {}}>
                    {aiStatus}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Pending approvals notice */}
        {pending.length > 0 && (
          <section className="bg-amber-500/10 border border-amber-500/40 rounded-xl px-6 py-4">
            <h2 className="font-semibold text-amber-400">Pending approvals ({pending.length})</h2>
            <p className="text-xs text-analog-text-muted mt-1">
              New Spotify sign-ins land here until you approve them. Until then they only see a
              &quot;waiting for approval&quot; screen.
            </p>
          </section>
        )}

        {/* Users list */}
        <section className="bg-analog-card border border-analog-border rounded-xl overflow-hidden shadow-xl">
          <div className="px-6 py-5 border-b border-analog-border">
            <h2 className="font-semibold text-white">Users ({users.length})</h2>
          </div>

          {loading ? (
            <div className="p-6 text-center text-analog-text-muted text-sm">Loading…</div>
          ) : error ? (
            <div className="p-6 text-center text-red-400 text-sm">{error}</div>
          ) : (
            <div className="divide-y divide-analog-border">
              {users.map(u => (
                <div key={u.id} className="p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-white">{displayName(u)}</span>
                      {u.isAdmin && (
                        <span className="ml-2 text-xs bg-analog-accent/20 text-analog-accent px-1.5 py-0.5 rounded">Admin</span>
                      )}
                      {!u.approved && (
                        <span className="ml-2 text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">Pending</span>
                      )}
                      <p className="text-xs text-analog-text-muted mt-0.5">
                        {u.spotifyEmail || u.spotifyId || 'No Spotify identity'}
                        <span className="mx-1">·</span>
                        Signed up {new Date(u.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(u.id, displayName(u))}
                      className="text-xs text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/60 px-3 py-1.5 rounded transition-colors"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!u.approved ? (
                      <button
                        onClick={() => updateUser(u.id, { approved: true }, '✓ Approved')}
                        className="px-3 py-1.5 bg-green-600/20 text-green-400 hover:bg-green-600/40 border border-green-500/40 text-xs rounded transition-colors"
                      >
                        Approve
                      </button>
                    ) : (
                      <button
                        onClick={() => updateUser(u.id, { approved: false }, '✓ Unapproved')}
                        className="px-3 py-1.5 border border-analog-border hover:border-red-400/60 text-analog-text-muted hover:text-red-400 text-xs rounded transition-colors"
                      >
                        Unapprove
                      </button>
                    )}

                    {u.isAdmin ? (
                      <button
                        onClick={() => updateUser(u.id, { isAdmin: false }, '✓ Demoted')}
                        className="px-3 py-1.5 border border-analog-border hover:border-analog-accent text-analog-text-muted hover:text-white text-xs rounded transition-colors"
                      >
                        Remove admin
                      </button>
                    ) : (
                      <button
                        onClick={() => updateUser(u.id, { isAdmin: true }, '✓ Made admin')}
                        className="px-3 py-1.5 border border-analog-border hover:border-analog-accent text-analog-text-muted hover:text-white text-xs rounded transition-colors"
                      >
                        Make admin
                      </button>
                    )}
                  </div>

                  {status[u.id] && (
                    <p className={`text-xs ${status[u.id].startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                      {status[u.id]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
