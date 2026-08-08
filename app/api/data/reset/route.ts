import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';

// Clears ALL of the user's Spotify-sourced pool data: liked / saved / followed
// signals AND recently-played exclusion stamps. The known-artist table is
// emptied for this user, so the count drops to zero and the roster collapses.
// Re-fetching via Step 1 rebuilds the pool from scratch.
export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const deleted = await prisma.knownArtist.deleteMany({ where: { userId } });
    const remaining = await prisma.knownArtist.count({ where: { userId } });

    return NextResponse.json({
      success: true,
      removedArtists: deleted.count,
      remainingArtists: remaining,
      message: `Cleared ${deleted.count} artists — your Spotify pool is now empty. Refresh to rebuild from scratch.`,
    });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Failed to clear data' }, { status: 500 });
  }
}
