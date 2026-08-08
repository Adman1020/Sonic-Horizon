import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { parseSignals, serializeSignals } from '@/lib/artistScore';

// Clears all Spotify-sourced pool data (followed / saved / liked signals) and
// prunes artists that end up with no signals at all. Re-fetching via Step 1
// rebuilds the pool from scratch.
export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // 1. Drop all signals from the scored pool
    const all = await prisma.knownArtist.findMany({ where: { userId }, select: { id: true, signals: true } });
    let droppedSignals = 0;
    for (const artist of all) {
      const signals = parseSignals(artist.signals);
      if (Object.keys(signals).length === 0) continue;
      await prisma.knownArtist.update({
        where: { id: artist.id },
        data: { signals: serializeSignals({}) },
      });
      droppedSignals++;
    }

    // 2. Prune artists that no longer have any signals or recency
    const remaining = await prisma.knownArtist.findMany({
      where: { userId },
      select: { id: true, signals: true, lastSeenAt: true },
    });
    const toDelete = remaining.filter(
      a => Object.keys(parseSignals(a.signals)).length === 0 && !a.lastSeenAt
    );
    for (const artist of toDelete) {
      await prisma.knownArtist.delete({ where: { id: artist.id } });
    }

    const finalCount = await prisma.knownArtist.count({ where: { userId } });

    return NextResponse.json({
      success: true,
      droppedSignals,
      removedArtists: toDelete.length,
      remainingArtists: finalCount,
      message: `Cleared Spotify data (${droppedSignals} signal records removed, ${toDelete.length} artists pruned; ${finalCount} artists remain)`,
    });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Failed to clear data' }, { status: 500 });
  }
}
