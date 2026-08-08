import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { parseSpotifySources, serializeSpotifySources, DEFAULT_SPOTIFY_SOURCES } from '@/lib/spotifySources';
import { parseGenres, isGenreLike } from '@/lib/artistScore';
import { isDiscoveryMode, DISCOVERY_MODE_DEFAULT } from '@/lib/discovery';
import { resyncScheduler, computeNextRun } from '@/lib/scheduler';
import { getAIConfig } from '@/lib/keys';

const SCHEDULE_INTERVALS = ['daily', 'weekly', 'monthly'];

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const settings = await prisma.settings.findUnique({ where: { userId } });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { spotifyId: true, spotifyUsername: true, spotifyEmail: true, isAdmin: true },
    });

    // Count only pool-eligible artists (any explicit-likes signal) so the header
    // matches the roster (/api/artists also filters by isPoolEligible). Recently-
    // played-only rows have signals = '{}' and are excluded from this count —
    // they're an invisible exclusion layer, not recommendation-driving seeds.
    const knownArtistCount = await prisma.knownArtist.count({
      where: { userId, signals: { not: '{}' } },
    });
    const ai = await getAIConfig();

    const nextRun = settings?.scheduleEnabled
      ? computeNextRun(
          settings.scheduleInterval ?? 'daily',
          settings.scheduleHour ?? 8,
          settings.scheduleDay ?? 1,
        )?.toISOString() ?? null
      : null;

    return NextResponse.json({
      username: user?.spotifyUsername ?? user?.spotifyEmail ?? null,
      isAdmin: user?.isAdmin,
      settings: settings ? {
        ...settings,
        spotifySources: parseSpotifySources(settings.spotifySources),
        genres: parseGenres(settings.genres),
        discoveryMode: isDiscoveryMode(settings.discoveryMode) ? settings.discoveryMode : DISCOVERY_MODE_DEFAULT,
        rabbitHoleArtist: settings.rabbitHoleArtist ?? null,
      } : {
        obscurityLevel: 3,
        outputFormat: 'tracks',
        recommendationLimit: 20,
        requestsPerMinute: 5,
        spotifyPlaylistPublic: true,
        theme: 'analog-hifi',
        spotifyAccessToken: null,
        spotifySources: [...DEFAULT_SPOTIFY_SOURCES],
        genres: [],
        discoveryMode: DISCOVERY_MODE_DEFAULT,
        rabbitHoleArtist: null,
        scheduleEnabled: false,
        scheduleInterval: 'daily',
        scheduleHour: 8,
        scheduleDay: 1,
      },
      knownArtistCount,
      aiConfig: ai.configured ? { provider: ai.provider, model: ai.model, rpm: ai.rpm } : null,
      spotifyConnected: !!(settings?.spotifyAccessToken),
      nextRun,
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
    const {
      obscurityLevel,
      outputFormat,
      recommendationLimit,
      requestsPerMinute,
      spotifyPlaylistPublic,
      spotifySources,
      genres,
      discoveryMode,
      rabbitHoleArtist,
      scheduleEnabled,
      scheduleInterval,
      scheduleHour,
      scheduleDay,
    } = body;

    const cleanGenres = (g: unknown): string[] | undefined => {
      if (!Array.isArray(g)) return undefined;
      return [...new Set(g.filter((item): item is string => typeof item === 'string' && isGenreLike(item)))];
    };

    const validInterval = (v: unknown): v is string =>
      typeof v === 'string' && SCHEDULE_INTERVALS.includes(v);
    const validHour = (v: unknown): boolean =>
      typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
    const validDay = (v: unknown): boolean =>
      typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 28;

    const now = new Date();
    const settings = await prisma.settings.upsert({
      where: { userId },
      update: {
        ...(obscurityLevel !== undefined && { obscurityLevel }),
        ...(outputFormat !== undefined && { outputFormat }),
        ...(recommendationLimit !== undefined && { recommendationLimit }),
        ...(requestsPerMinute !== undefined && { requestsPerMinute }),
        ...(spotifyPlaylistPublic !== undefined && { spotifyPlaylistPublic }),
        ...(spotifySources !== undefined && { spotifySources: serializeSpotifySources(spotifySources) }),
        ...(cleanGenres(genres) !== undefined && { genres: JSON.stringify(cleanGenres(genres)) }),
        ...(isDiscoveryMode(discoveryMode) && { discoveryMode }),
        ...(rabbitHoleArtist !== undefined && { rabbitHoleArtist }),
        ...(scheduleEnabled !== undefined && { scheduleEnabled: !!scheduleEnabled }),
        ...(validInterval(scheduleInterval) && { scheduleInterval }),
        ...(validHour(scheduleHour) && { scheduleHour }),
        ...(validDay(scheduleDay) && { scheduleDay }),
        updatedAt: now,
      },
      create: {
        userId,
        obscurityLevel: obscurityLevel ?? 3,
        outputFormat: outputFormat ?? 'tracks',
        recommendationLimit: recommendationLimit ?? 20,
        requestsPerMinute: requestsPerMinute ?? 5,
        spotifyPlaylistPublic: spotifyPlaylistPublic ?? true,
        spotifySources: spotifySources !== undefined ? serializeSpotifySources(spotifySources) : 'all',
        genres: cleanGenres(genres) !== undefined ? JSON.stringify(cleanGenres(genres)) : '[]',
        discoveryMode: isDiscoveryMode(discoveryMode) ? discoveryMode : DISCOVERY_MODE_DEFAULT,
        rabbitHoleArtist: rabbitHoleArtist ?? null,
        scheduleEnabled: !!scheduleEnabled,
        scheduleInterval: validInterval(scheduleInterval) ? scheduleInterval : 'daily',
        scheduleHour: validHour(scheduleHour) ? scheduleHour : 8,
        scheduleDay: validDay(scheduleDay) ? scheduleDay : 1,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Keep the in-process cron in sync with the saved schedule (no restart
    // needed when a user toggles Scheduled Refreshes).
    resyncScheduler().catch((error: unknown) => {
      console.error('Settings: scheduler resync failed:', error);
    });

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Settings PUT error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
