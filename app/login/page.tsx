"use client";

import Link from 'next/link';

export default function Login() {
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
            Sign in with your Spotify account
          </p>
        </div>

        <a
          href="/api/spotify/auth"
          className="block w-full bg-[#1DB954] hover:bg-[#1ed760] text-analog-bg font-bold py-3 rounded transition-colors shadow-lg text-center"
        >
          Continue with Spotify
        </a>

        <p className="text-analog-text-muted text-xs text-center mt-6 leading-relaxed">
          Discovery is driven only by artists you explicitly follow, save, or like
          on Spotify — we never read your listening history. New accounts require
          admin approval.
        </p>
      </div>
    </div>
  );
}
