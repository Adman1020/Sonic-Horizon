import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser?.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        spotifyId: true,
        spotifyUsername: true,
        spotifyEmail: true,
        isAdmin: true,
        approved: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }
}
