import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { fetchSpotifyFollowedArtists, fetchSpotifySavedAlbums, fetchSpotifyLikedTracks, getValidSpotifyAccessToken } from '@/lib/spotify';
import { parseSpotifySources, SPOTIFY_SOURCES, DEFAULT_SPOTIFY_SOURCES } from '@/lib/spotifySources';
import { applySignalsToArtists } from '@/lib/artistScoreDb';
import type { SignalMap } from '@/lib/artistScore';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const requestedSources = Array.isArray(body?.sources) ? body.sources : null;

    const settings = await prisma.settings.findUnique({ where: { userId } });
    if (!settings?.spotifyAccessToken) {
      return NextResponse.json({ error: 'Spotify not connected' }, { status: 400 });
    }

    const enabledSources = requestedSources
      ? parseSpotifySources(requestedSources)
      : [...DEFAULT_SPOTIFY_SOURCES];
    const activeLabels = SPOTIFY_SOURCES
      .filter(s => enabledSources.includes(s.key))
      .map(s => s.label);

    const accessToken = await getValidSpotifyAccessToken(userId);
    if (!accessToken) {
      return NextResponse.json({ error: 'Spotify token refresh failed - please reconnect' }, { status: 401 });
    }

    // Collect per-artist signal counts (source → occurrence count). Weights are
    // applied later in lib/artistScore.ts; the fetch only records provenance.
    const artistSignals = new Map<string, SignalMap>();
    const bump = (name: string | undefined, signalKey: string) => {
      const trimmed = name?.trim();
      if (!trimmed) return;
      const counts = artistSignals.get(trimmed) ?? {};
      counts[signalKey] = (counts[signalKey] ?? 0) + 1;
      artistSignals.set(trimmed, counts);
    };

    // 1. Followed Artists (cursor-based pagination up to 1,000 artists)
    if (enabledSources.includes('followedArtists')) {
      let lastArtistId: string | undefined = undefined;
      for (let page = 0; page < 20; page++) {
        try {
          const data = await fetchSpotifyFollowedArtists(accessToken, lastArtistId);
          const artists = data.artists?.items ?? [];
          if (artists.length === 0) break;

          for (const artist of artists) bump(artist.name, 'followedArtists');
          lastArtistId = artists[artists.length - 1]?.id;
          if (!data.artists?.cursors?.after) break;
        } catch {
          break;
        }
      }
    }

    // 2. Saved Albums (up to 500 albums)
    if (enabledSources.includes('savedAlbums')) {
      for (let offset = 0; offset < 500; offset += 50) {
        try {
          const data = await fetchSpotifySavedAlbums(accessToken, 50, offset);
          const items = data.items ?? [];
          if (items.length === 0) break;
          for (const item of items) {
            for (const artist of item.album?.artists ?? []) bump(artist.name, 'savedAlbums');
          }
        } catch {
          break;
        }
      }
    }

    // 3. Liked Songs (up to 2,000 tracks)
    if (enabledSources.includes('likedSongs')) {
      for (let offset = 0; offset < 2000; offset += 50) {
        try {
          const data = await fetchSpotifyLikedTracks(accessToken, 50, offset);
          const items = data.items ?? [];
          if (items.length === 0) break;

          for (const item of items) {
            for (const artist of item.track?.artists ?? []) bump(artist.name, 'likedSongs');
          }
        } catch {
          break;
        }
      }
    }

    // Write signals into the known-artist pool (merging into existing rows).
    const existingNames = await prisma.knownArtist.findMany({
      where: { userId },
      select: { artistName: true },
    });
    const existingSet = new Set(existingNames.map(k => k.artistName));
    const newArtistNames = Array.from(artistSignals.keys()).filter(name => !existingSet.has(name));

    const touched = await applySignalsToArtists(userId, artistSignals, new Date());
    const totalKnownArtists = await prisma.knownArtist.count({ where: { userId } });

    const scannedSummary = activeLabels.length === 0
      ? 'no sources selected'
      : activeLabels.length === SPOTIFY_SOURCES.length
        ? 'all sources'
        : activeLabels.join(', ');

    return NextResponse.json({
      success: true,
      addedArtists: newArtistNames.length,
      totalKnownArtists,
      message: `Scored ${touched} artists from Spotify (${newArtistNames.length} new) across ${scannedSummary}`,
    });
  } catch (error: unknown) {
    console.error('Spotify fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch Spotify data' }, { status: 500 });
  }
}
