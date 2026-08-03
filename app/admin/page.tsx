"use client";

import { useState, useEffect } from 'react';

interface AppUser {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState('');
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [resetStatus, setResetStatus] = useState<Record<string, string>>({});

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateStatus('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCreateStatus(`✓ Created user ${newUsername}`);
      setNewUsername('');
      setNewPassword('');
      loadUsers();
    } catch (e: unknown) {
      setCreateStatus(`Error: ${e instanceof Error ? e.message : 'Failed'}`);
    }
    setCreating(false);
  };

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadUsers();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const handlePasswordReset = async (id: string) => {
    const pass = resetPasswords[id];
    if (!pass || pass.length < 12) {
      setResetStatus(s => ({ ...s, [id]: 'Min 12 characters' }));
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResetStatus(s => ({ ...s, [id]: '✓ Reset — user must change on next login' }));
      setResetPasswords(p => ({ ...p, [id]: '' }));
    } catch (e: unknown) {
      setResetStatus(s => ({ ...s, [id]: `Error: ${e instanceof Error ? e.message : '?'}` }));
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

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
            <a href="/change-password" className="text-xs text-analog-text-muted hover:text-white transition-colors">
              Change password
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

        {/* Create User */}
        <section className="bg-analog-card border border-analog-border rounded-xl overflow-hidden shadow-xl">
          <div className="px-6 py-5 border-b border-analog-border">
            <h2 className="font-semibold text-white">Create User</h2>
            <p className="text-xs text-analog-text-muted mt-0.5">New users log in with this password, then must set their own on first login</p>
          </div>
          <form onSubmit={handleCreate} className="p-6 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-36">
              <label className="block text-xs text-analog-text-muted mb-1.5">Username</label>
              <input
                type="text" required value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                className="w-full bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-analog-accent transition-colors"
              />
            </div>
            <div className="flex-1 min-w-36">
              <label className="block text-xs text-analog-text-muted mb-1.5">Password (min 12)</label>
              <input
                type="password" required minLength={12} value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full bg-analog-bg border border-analog-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-analog-accent transition-colors"
              />
            </div>
            <button
              type="submit" disabled={creating}
              className="px-5 py-2 bg-analog-accent hover:bg-analog-accent-hover disabled:opacity-50 text-analog-bg font-semibold text-sm rounded transition-colors"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            {createStatus && (
              <p className={`w-full text-xs ${createStatus.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{createStatus}</p>
            )}
          </form>
        </section>

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
                      <span className="font-medium text-white">{u.username}</span>
                      {u.isAdmin && (
                        <span className="ml-2 text-xs bg-analog-accent/20 text-analog-accent px-1.5 py-0.5 rounded">Admin</span>
                      )}
                      <p className="text-xs text-analog-text-muted mt-0.5">
                        Created {new Date(u.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {!u.isAdmin && (
                      <button
                        onClick={() => handleDelete(u.id, u.username)}
                        className="text-xs text-red-400 hover:text-red-300 border border-red-400/30 hover:border-red-400/60 px-3 py-1.5 rounded transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {!u.isAdmin && (
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder="New password"
                        value={resetPasswords[u.id] ?? ''}
                        onChange={e => setResetPasswords(p => ({ ...p, [u.id]: e.target.value }))}
                        className="flex-1 bg-analog-bg border border-analog-border rounded px-3 py-1.5 text-xs text-white placeholder-analog-text-muted focus:outline-none focus:border-analog-accent transition-colors"
                      />
                      <button
                        onClick={() => handlePasswordReset(u.id)}
                        className="px-3 py-1.5 border border-analog-border hover:border-analog-accent text-analog-text-muted hover:text-white text-xs rounded transition-colors"
                      >
                        Reset Password
                      </button>
                    </div>
                  )}
                  {resetStatus[u.id] && (
                    <p className={`text-xs ${resetStatus[u.id].startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                      {resetStatus[u.id]}
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
