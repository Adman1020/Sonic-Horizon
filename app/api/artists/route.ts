import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { parseSignals, computeHistoryScore, SIGNAL_MULTIPLIERS } from '@/lib/artistScore';

// Human-readable source labels shown in the roster. Keys are signal keys stored
// in knownArtist.signals plus synthetic buckets for file history.
const SOURCE_LABELS: Record<string, string> = {
  topArtistsShort: 'Spotify: Top Artists (1mo)',
  topArtistsMedium: 'Spotify: Top Artists (6mo)',
  topArtistsLong: 'Spotify: Top Artists (all-time)',
  topTracks: 'Spotify: Top Tracks',
  followedArtists: 'Spotify: Followed',
  savedAlbums: 'Spotify: Saved Albums',
  likedSongs: 'Spotify: Liked Songs',
  playlists: 'Spotify: Playlists',
  recentTracks: 'Spotify: Recently Played',
  lastfmTop: 'Last.fm: Top Artists',
  spotifyHistory: 'Spotify: File History',
  lastfmHistory: 'Last.fm: Scrobble History',
};

function signalSources(signals: Record<string, number>): string[] {
  return Object.entries(signals)
    .filter(([k, v]) => k !== 'imported' && v > 0)
    .map(([k]) => SOURCE_LABELS[k] ?? k);
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const total = await prisma.knownArtist.count({ where: { userId } });
    const artists = await prisma.knownArtist.findMany({
      where: { userId },
      orderBy: { artistName: 'asc' },
      select: { artistName: true, playCount: true, historyScore: true, signals: true, lastSeenAt: true },
    });

    // Per-artist history source attribution (which upload source contributed plays)
    const historyByArtist = await prisma.streamingHistory.groupBy({
      by: ['source', 'artistName'],
      where: { userId },
      _count: { _all: true },
    });
    const artistHistorySources = new Map<string, Set<string>>();
    for (const row of historyByArtist) {
      const set = artistHistorySources.get(row.artistName) ?? new Set<string>();
      set.add(row.source);
      artistHistorySources.set(row.artistName, set);
    }

    const roster = artists.map(a => {
      const signals = parseSignals(a.signals);
      const signalSourcesList = signalSources(signals);
      const historySources = artistHistorySources.get(a.artistName) ?? new Set<string>();
      const sources: string[] = [...signalSourcesList];
      if (historySources.size > 0) {
        const label = historySources.size > 1
          ? 'History (Spotify + Last.fm)'
          : historySources.has('lastfm') ? 'Last.fm: Scrobble History' : 'Spotify: File History';
        sources.push(label);
      }

      const now = new Date();
      const historyScore = a.historyScore ?? computeHistoryScore(a.playCount ?? 0, 0, a.lastSeenAt, now);
      const signalScore = Object.entries(signals).reduce((sum, [k, v]) => sum + (v * (SIGNAL_MULTIPLIERS[k] ?? 1)), 0);

      return {
        name: a.artistName,
        sources,
        playCount: a.playCount ?? 0,
        lastSeenAt: a.lastSeenAt,
        score: Math.round((historyScore + signalScore) * 100) / 100,
      };
    });

    const spotifySource = (artist: (typeof roster)[number]) =>
      artist.sources.some(s => s.startsWith('Spotify') || s.includes('Spotify'));
    const lastfmSource = (artist: (typeof roster)[number]) =>
      artist.sources.some(s => s.startsWith('Last.fm') || s.includes('Last.fm'));

    const bySource = {
      spotify: roster.filter(spotifySource).length,
      lastfm: roster.filter(lastfmSource).length,
      both: roster.filter(a => spotifySource(a) && lastfmSource(a)).length,
    };

    return NextResponse.json({ total, artists: roster, bySource });
  } catch (error) {
    console.error('Artists GET error:', error);
    return NextResponse.json({ error: 'Failed to load artists' }, { status: 500 });
  }
}
