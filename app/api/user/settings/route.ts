import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { parseSpotifySources, serializeSpotifySources, DEFAULT_SPOTIFY_SOURCES } from '@/lib/spotifySources';
import { isTasteFocus, TASTE_FOCUS_DEFAULT, parseGenres, isGenreLike } from '@/lib/artistScore';
import { isDiscoveryMode, DISCOVERY_MODE_DEFAULT } from '@/lib/discovery';

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
      settings: settings ? {
        ...settings,
        spotifySources: parseSpotifySources(settings.spotifySources),
        tasteFocus: isTasteFocus(settings.tasteFocus) ? settings.tasteFocus : TASTE_FOCUS_DEFAULT,
        genres: parseGenres(settings.genres),
        discoveryMode: isDiscoveryMode(settings.discoveryMode) ? settings.discoveryMode : DISCOVERY_MODE_DEFAULT,
        branchTheme: settings.branchTheme ?? null,
        rabbitHoleArtist: settings.rabbitHoleArtist ?? null,
      } : {
        obscurityLevel: 3,
        outputFormat: 'tracks',
        recommendationLimit: 20,
        requestsPerMinute: 5,
        spotifyPlaylistPublic: true,
        scheduleMode: 'manual',
        theme: 'analog-hifi',
        lastFmUsername: null,
        spotifyAccessToken: null,
        spotifySources: [...DEFAULT_SPOTIFY_SOURCES],
        tasteFocus: TASTE_FOCUS_DEFAULT,
        genres: [],
        discoveryMode: DISCOVERY_MODE_DEFAULT,
        branchTheme: null,
        rabbitHoleArtist: null,
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
    const { obscurityLevel, outputFormat, recommendationLimit, requestsPerMinute, spotifyPlaylistPublic, scheduleMode, lastFmUsername, spotifySources, tasteFocus, genres, discoveryMode, branchTheme, rabbitHoleArtist } = body;

    const cleanGenres = (g: unknown): string[] | undefined => {
      if (!Array.isArray(g)) return undefined;
      return [...new Set(g.filter((item): item is string => typeof item === 'string' && isGenreLike(item)))];
    };

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
        ...(spotifySources !== undefined && { spotifySources: serializeSpotifySources(spotifySources) }),
        ...(tasteFocus !== undefined && isTasteFocus(tasteFocus) && { tasteFocus }),
        ...(cleanGenres(genres) !== undefined && { genres: JSON.stringify(cleanGenres(genres)) }),
        ...(isDiscoveryMode(discoveryMode) && { discoveryMode }),
        ...(branchTheme !== undefined && { branchTheme }),
        ...(rabbitHoleArtist !== undefined && { rabbitHoleArtist }),
        updatedAt: now,
      },
      create: {
        userId,
        obscurityLevel: obscurityLevel ?? 3,
        outputFormat: outputFormat ?? 'tracks',
        recommendationLimit: recommendationLimit ?? 20,
        requestsPerMinute: requestsPerMinute ?? 5,
        spotifyPlaylistPublic: spotifyPlaylistPublic ?? true,
        scheduleMode: scheduleMode ?? 'manual',
        lastFmUsername: lastFmUsername ?? null,
        spotifySources: spotifySources !== undefined ? serializeSpotifySources(spotifySources) : 'all',
        tasteFocus: tasteFocus !== undefined && isTasteFocus(tasteFocus) ? tasteFocus : TASTE_FOCUS_DEFAULT,
        genres: cleanGenres(genres) !== undefined ? JSON.stringify(cleanGenres(genres)) : '[]',
        discoveryMode: isDiscoveryMode(discoveryMode) ? discoveryMode : DISCOVERY_MODE_DEFAULT,
        branchTheme: branchTheme ?? null,
        rabbitHoleArtist: rabbitHoleArtist ?? null,
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
