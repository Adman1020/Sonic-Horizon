"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ChangePassword() {
  const router = useRouter();
  const [forced, setForced] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setForced(new URLSearchParams(window.location.search).get('forced') === '1');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update password');

      setSuccess('Password updated. Redirecting…');
      setTimeout(() => {
        // Full reload so the app picks up the fresh session cookie.
        window.location.href = '/';
      }, 800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-analog-bg text-analog-text flex flex-col items-center justify-center p-6 font-sans selection:bg-analog-accent selection:text-white">
      <div className="w-full max-w-md bg-analog-card border border-analog-border rounded-xl p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-analog-accent opacity-50"></div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-3">
            <img src="/icon.svg" alt="Sonic Horizon" className="w-8 h-8 rounded object-cover border border-analog-border" />
            Sonic Horizon
          </h1>
          <p className="text-analog-text-muted mt-2 text-sm">Set a new password</p>
        </div>

        {forced && (
          <div className="mb-6 p-3 bg-analog-accent/10 border border-analog-accent/40 rounded text-sm text-center text-analog-accent">
            You must set a new password before continuing.
          </div>
        )}

        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/50 rounded text-red-500 text-sm text-center">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-3 bg-green-500/10 border border-green-500/50 rounded text-green-500 text-sm text-center">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-analog-text-muted mb-2">Current password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-analog-bg border border-analog-border rounded p-3 text-white focus:outline-none focus:border-analog-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-analog-text-muted mb-2">New password</label>
            <input
              type="password"
              required
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-analog-bg border border-analog-border rounded p-3 text-white focus:outline-none focus:border-analog-accent transition-colors"
            />
            <p className="text-xs text-analog-text-muted mt-1.5">At least 12 characters.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-analog-text-muted mb-2">Confirm new password</label>
            <input
              type="password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-analog-bg border border-analog-border rounded p-3 text-white focus:outline-none focus:border-analog-accent transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-analog-accent hover:bg-analog-accent-hover text-analog-bg font-bold py-3 rounded transition-colors shadow-lg mt-4 disabled:opacity-50">
            {saving ? 'Updating…' : 'Update password'}
          </button>
        </form>

        <div className="text-center mt-6">
          <button onClick={handleLogout} className="text-xs text-analog-text-muted hover:text-red-400 transition-colors">
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
