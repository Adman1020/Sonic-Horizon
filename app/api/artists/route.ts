import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const total = await prisma.knownArtist.count({ where: { userId } });
    const artists = await prisma.knownArtist.findMany({
      where: { userId },
      orderBy: { artistName: 'asc' },
      select: { artistName: true },
    });

    return NextResponse.json({ total, artists: artists.map(a => a.artistName) });
  } catch (error) {
    console.error('Artists GET error:', error);
    return NextResponse.json({ error: 'Failed to load artists' }, { status: 500 });
  }
}
