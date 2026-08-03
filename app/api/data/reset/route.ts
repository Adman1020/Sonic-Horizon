import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { recomputeHistoryForArtists } from '@/lib/artistScoreDb';
import { parseSignals, serializeSignals } from '@/lib/artistScore';

// Signal keys that originate from the Spotify ingestion pipeline. Every other
// key (currently just "lastfmTop") is Last.fm-originated.
const SPOTIFY_SIGNALS = new Set([
  'topArtistsShort',
  'topArtistsMedium',
  'topArtistsLong',
  'topTracks',
  'followedArtists',
  'savedAlbums',
  'likedSongs',
  'playlists',
  'recentTracks',
]);

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { source } = await req.json().catch(() => ({}));
  if (source !== 'spotify' && source !== 'lastfm') {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
  }

  try {
    // 1. Remove all imported plays for this source
    const deletedHistory = await prisma.streamingHistory.deleteMany({ where: { userId, source } });

    // 2. Drop the source's signals from the scored pool
    const all = await prisma.knownArtist.findMany({ where: { userId }, select: { id: true, signals: true } });
    let droppedSignals = 0;
    for (const artist of all) {
      const signals = parseSignals(artist.signals);
      let changed = false;
      for (const key of Object.keys(signals)) {
        if (source === 'spotify' ? SPOTIFY_SIGNALS.has(key) : key === 'lastfmTop') {
          delete signals[key];
          changed = true;
        }
      }
      if (changed) {
        await prisma.knownArtist.update({
          where: { id: artist.id },
          data: { signals: serializeSignals(signals) },
        });
        droppedSignals++;
      }
    }

    // 3. Recompute history scores from whatever history remains
    await recomputeHistoryForArtists(userId);

    // 4. Prune artists that no longer have any history or signals
    const remaining = await prisma.knownArtist.findMany({ where: { userId }, select: { id: true, playCount: true, signals: true } });
    const toDelete = remaining.filter(a => a.playCount === 0 && Object.keys(parseSignals(a.signals)).length === 0);
    for (const artist of toDelete) {
      await prisma.knownArtist.delete({ where: { id: artist.id } });
    }

    const finalCount = await prisma.knownArtist.count({ where: { userId } });

    return NextResponse.json({
      success: true,
      source,
      deletedPlays: deletedHistory.count,
      droppedSignals,
      removedArtists: toDelete.length,
      remainingArtists: finalCount,
      message: source === 'spotify'
        ? `Cleared Spotify artists (${deletedHistory.count} plays, ${droppedSignals} signal records removed)`
        : `Cleared Last.fm artists (${deletedHistory.count} plays, ${droppedSignals} signal records removed)`,
    });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Failed to clear data' }, { status: 500 });
  }
}
