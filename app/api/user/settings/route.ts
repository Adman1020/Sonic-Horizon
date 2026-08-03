import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const settings = await prisma.settings.findUnique({ where: { userId } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, isAdmin: true } });
    
    // Count imported data
    const historyCount = await prisma.streamingHistory.count({ where: { userId } });
    const knownArtistCount = await prisma.knownArtist.count({ where: { userId } });
    const savedKeys = await prisma.providerKey.findMany({ where: { userId }, select: { provider: true } });

    return NextResponse.json({
      username: user?.username,
      isAdmin: user?.isAdmin,
      settings: settings ?? {
        obscurityLevel: 3,
        outputFormat: 'tracks',
        recommendationLimit: 20,
        requestsPerMinute: 0,
        spotifyPlaylistPublic: true,
        scheduleMode: 'manual',
        theme: 'analog-hifi',
        lastFmUsername: null,
        spotifyAccessToken: null,
      },
      historyCount,
      knownArtistCount,
      savedProviders: savedKeys.map(k => k.provider),
      spotifyConnected: !!(settings?.spotifyAccessToken),
      lastFmConnected: !!(settings?.lastFmUsername),
    });
  } catch (error) {
    console.error('Settings GET error:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { obscurityLevel, outputFormat, recommendationLimit, requestsPerMinute, spotifyPlaylistPublic, scheduleMode, lastFmUsername } = body;

    const now = new Date();
    const settings = await prisma.settings.upsert({
      where: { userId },
      update: {
        ...(obscurityLevel !== undefined && { obscurityLevel }),
        ...(outputFormat !== undefined && { outputFormat }),
        ...(recommendationLimit !== undefined && { recommendationLimit }),
        ...(requestsPerMinute !== undefined && { requestsPerMinute }),
        ...(spotifyPlaylistPublic !== undefined && { spotifyPlaylistPublic }),
        ...(scheduleMode !== undefined && { scheduleMode }),
        ...(lastFmUsername !== undefined && { lastFmUsername }),
        updatedAt: now,
      },
      create: {
        userId,
        obscurityLevel: obscurityLevel ?? 3,
        outputFormat: outputFormat ?? 'tracks',
        recommendationLimit: recommendationLimit ?? 20,
        requestsPerMinute: requestsPerMinute ?? 0,
        spotifyPlaylistPublic: spotifyPlaylistPublic ?? true,
        scheduleMode: scheduleMode ?? 'manual',
        lastFmUsername: lastFmUsername ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Settings PUT error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
