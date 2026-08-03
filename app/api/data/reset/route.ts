import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { source } = await req.json().catch(() => ({}));
  if (source !== 'spotify' && source !== 'lastfm') {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
  }

  try {
    const now = new Date();

    // 1. Remove all imported plays for this source
    const deletedHistory = await prisma.streamingHistory.deleteMany({ where: { userId, source } });

    // 2. Rebuild the known-artist set from whatever history remains (the two are kept in sync)
    const remaining = await prisma.streamingHistory.groupBy({
      by: ['artistName'],
      where: { userId },
      _count: { artistName: true },
    });
    await prisma.knownArtist.deleteMany({ where: { userId } });
    if (remaining.length > 0) {
      await prisma.knownArtist.createMany({
        data: remaining.map(a => ({ userId, artistName: a.artistName, addedAt: now })),
      });
    }

    return NextResponse.json({
      success: true,
      source,
      deletedPlays: deletedHistory.count,
      remainingArtists: remaining.length,
      message: source === 'spotify'
        ? `Cleared Spotify artists (${deletedHistory.count} plays removed)`
        : `Cleared Last.fm artists (${deletedHistory.count} plays removed)`,
    });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Failed to clear data' }, { status: 500 });
  }
}
