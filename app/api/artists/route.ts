import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { parseSignals, signalsScore, isPoolEligible } from '@/lib/artistScore';

// Human-readable source labels shown in the roster. Keys are signal keys stored
// in knownArtist.signals.
const SOURCE_LABELS: Record<string, string> = {
  followedArtists: 'Spotify: Followed',
  savedAlbums: 'Spotify: Saved Albums',
  likedSongs: 'Spotify: Liked Songs',
};

function signalSources(signals: Record<string, number>): string[] {
  return Object.entries(signals)
    .filter(([, v]) => v > 0)
    .map(([k]) => SOURCE_LABELS[k] ?? k);
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // The roster shows only artists that DRIVE recommendations (liked / saved /
    // followed signals — isPoolEligible). Recently-played-only artists are an
    // invisible exclusion layer and intentionally excluded from this view.
    const all = await prisma.knownArtist.findMany({
      where: { userId },
      orderBy: { artistName: 'asc' },
      select: { artistName: true, signals: true, lastSeenAt: true },
    });
    const poolArtists = all.filter(isPoolEligible);

    const roster = poolArtists.map(a => {
      const signals = parseSignals(a.signals);
      return {
        name: a.artistName,
        sources: signalSources(signals),
        lastSeenAt: a.lastSeenAt,
        score: Math.round(signalsScore(signals) * 100) / 100,
      };
    });

    return NextResponse.json({ total: poolArtists.length, artists: roster });
  } catch (error) {
    console.error('Artists GET error:', error);
    return NextResponse.json({ error: 'Failed to load artists' }, { status: 500 });
  }
}
