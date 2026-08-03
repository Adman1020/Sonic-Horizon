"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const router = useRouter();
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/auth/status')
      .then(res => res.json())
      .then(data => {
        setIsSetupMode(!data.initialized);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to connect to database.');
        setLoading(false);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    const endpoint = isSetupMode ? '/api/auth/setup' : '/api/auth/login';
    
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }
      
      if (data.mustChangePassword) {
        router.push('/change-password');
      } else if (isSetupMode || data.isAdmin) {
        router.push('/admin');
      } else {
        router.push('/');
      }
      router.refresh();
      
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-analog-bg flex items-center justify-center">
        <div className="w-6 h-6 rounded-full bg-analog-accent animate-pulse shadow-[0_0_15px_rgba(217,119,6,0.6)]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-analog-bg text-analog-text flex flex-col items-center justify-center p-6 font-sans selection:bg-analog-accent selection:text-white">
      <div className="w-full max-w-md bg-analog-card border border-analog-border rounded-xl p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-analog-accent opacity-50"></div>
        
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-3">
             <img src="/icon.svg" alt="Sonic Horizon" className="w-8 h-8 rounded object-cover border border-analog-border" />
             Sonic Horizon
          </h1>
          <p className="text-analog-text-muted mt-2 text-sm">
            {isSetupMode ? 'Admin Initialization Setup' : 'Portal Authentication'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/50 rounded text-red-500 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-analog-text-muted mb-2">Username</label>
            <input 
              type="text" 
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-analog-bg border border-analog-border rounded p-3 text-white focus:outline-none focus:border-analog-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-analog-text-muted mb-2">Password</label>
            <input 
              type="password" 
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-analog-bg border border-analog-border rounded p-3 text-white focus:outline-none focus:border-analog-accent transition-colors"
            />
          </div>
          
          <button 
            type="submit"
            className="w-full bg-analog-border hover:bg-analog-accent hover:text-analog-bg text-white font-bold py-3 rounded transition-colors shadow-lg mt-4">
            {isSetupMode ? 'Initialize Admin Account' : 'Authenticate'}
          </button>
        </form>
      </div>
    </div>
  );
}
