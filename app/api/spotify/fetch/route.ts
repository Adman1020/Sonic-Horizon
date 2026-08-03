import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { fetchSpotifyTopArtists, fetchSpotifyTopTracks, fetchSpotifyFollowedArtists, fetchSpotifySavedAlbums, fetchSpotifyLikedTracks, fetchSpotifyUserPlaylists, fetchSpotifyPlaylistTracks, fetchSpotifyRecentTracks } from '@/lib/spotify';
import { getDecryptedKey } from '@/lib/keys';
import { parseSpotifySources, SPOTIFY_SOURCES, DEFAULT_SPOTIFY_SOURCES } from '@/lib/spotifySources';
import { applySignalsToArtists } from '@/lib/artistScoreDb';
import type { SignalMap } from '@/lib/artistScore';

async function refreshSpotifyToken(userId: string, refreshToken: string): Promise<string | null> {
  const userClientId = await getDecryptedKey(userId, 'spotify_client_id');
  const userClientSecret = await getDecryptedKey(userId, 'spotify_client_secret');
  const clientId = userClientId || process.env.SPOTIFY_CLIENT_ID || '';
  const clientSecret = userClientSecret || process.env.SPOTIFY_CLIENT_SECRET || '';

  const bodyParams = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (clientId && clientSecret) {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers,
    body: bodyParams,
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token ?? null;
}

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

    let accessToken = settings.spotifyAccessToken;

    // Try fetching; if 401, refresh token
    const testRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (testRes.status === 401 && settings.spotifyRefreshToken) {
      const newToken = await refreshSpotifyToken(userId, settings.spotifyRefreshToken);
      if (!newToken) return NextResponse.json({ error: 'Spotify token refresh failed - please reconnect' }, { status: 401 });
      accessToken = newToken;
      await prisma.settings.update({
        where: { userId },
        data: { spotifyAccessToken: newToken, updatedAt: new Date() },
      });
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

    // 1. Top Artists (short_term ×4, medium_term ×3, long_term ×2)
    if (enabledSources.includes('topArtists')) {
      const signalKeyByRange: Record<string, string> = {
        short_term: 'topArtistsShort',
        medium_term: 'topArtistsMedium',
        long_term: 'topArtistsLong',
      };
      for (const timeRange of ['short_term', 'medium_term', 'long_term'] as const) {
        try {
          const data = await fetchSpotifyTopArtists(accessToken, timeRange);
          for (const artist of data.items ?? []) bump(artist.name, signalKeyByRange[timeRange]);
        } catch (e) {
          console.error(`Failed to fetch ${timeRange} top artists:`, e);
        }
      }
    }

    // 2. Top Tracks (short_term, medium_term, long_term)
    if (enabledSources.includes('topTracks')) {
      for (const timeRange of ['short_term', 'medium_term', 'long_term'] as const) {
        try {
          const data = await fetchSpotifyTopTracks(accessToken, timeRange);
          for (const track of data.items ?? []) {
            for (const artist of track.artists ?? []) bump(artist.name, 'topTracks');
          }
        } catch (e) {
          console.error(`Failed to fetch ${timeRange} top tracks:`, e);
        }
      }
    }

    // 3. Followed Artists (cursor-based pagination up to 1,000 artists)
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

    // 4. Saved Albums (up to 500 albums)
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

    // 5. Liked Songs (up to 2,000 tracks)
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

    // 6. User Playlists & Tracks (up to 30 playlists, 100 tracks each)
    if (enabledSources.includes('playlists')) {
      try {
        const playlistData = await fetchSpotifyUserPlaylists(accessToken, 30, 0);
        for (const pl of playlistData.items ?? []) {
          try {
            const trackData = await fetchSpotifyPlaylistTracks(accessToken, pl.id, 100, 0);
            for (const item of trackData.items ?? []) {
              for (const artist of item.item?.artists ?? []) bump(artist.name, 'playlists');
            }
          } catch { /* skip playlist if fails */ }
        }
      } catch (e) {
        console.error('Failed to fetch user playlists:', e);
      }
    }

    // 7. Recently Played Tracks
    if (enabledSources.includes('recentTracks')) {
      try {
        const recentData = await fetchSpotifyRecentTracks(accessToken);
        for (const item of recentData.items ?? []) {
          for (const artist of item.track?.artists ?? []) bump(artist.name, 'recentTracks');
        }
      } catch (e) {
        console.error('Failed to fetch recent tracks:', e);
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
