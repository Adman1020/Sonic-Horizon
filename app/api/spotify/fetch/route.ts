import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { fetchSpotifyTopArtists, fetchSpotifyTopTracks, fetchSpotifyFollowedArtists, fetchSpotifySavedAlbums, fetchSpotifyLikedTracks, fetchSpotifyUserPlaylists, fetchSpotifyPlaylistTracks, fetchSpotifyRecentTracks } from '@/lib/spotify';
import { getDecryptedKey } from '@/lib/keys';

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

async function addArtistToDb(userId: string, artistName: string, now: Date): Promise<boolean> {
  if (!artistName) return false;
  try {
    const existing = await prisma.knownArtist.findUnique({
      where: { userId_artistName: { userId, artistName } },
    });
    if (!existing) {
      await prisma.knownArtist.create({
        data: { userId, artistName, addedAt: now },
      });
      await prisma.streamingHistory.create({
        data: { userId, source: 'spotify', artistName, trackName: '[Imported Artist]', playedAt: now },
      });
      return true;
    }
  } catch { /* skip */ }
  return false;
}

export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const settings = await prisma.settings.findUnique({ where: { userId } });
    if (!settings?.spotifyAccessToken) {
      return NextResponse.json({ error: 'Spotify not connected' }, { status: 400 });
    }

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

    const now = new Date();
    const artistNamesSet = new Set<string>();

    // 1. Top Artists (short_term, medium_term, long_term)
    for (const timeRange of ['short_term', 'medium_term', 'long_term'] as const) {
      try {
        const data = await fetchSpotifyTopArtists(accessToken, timeRange);
        for (const artist of data.items ?? []) {
          if (artist.name) artistNamesSet.add(artist.name.trim());
        }
      } catch (e) {
        console.error(`Failed to fetch ${timeRange} top artists:`, e);
      }
    }

    // 2. Top Tracks (short_term, medium_term, long_term)
    for (const timeRange of ['short_term', 'medium_term', 'long_term'] as const) {
      try {
        const data = await fetchSpotifyTopTracks(accessToken, timeRange);
        for (const track of data.items ?? []) {
          for (const artist of track.artists ?? []) {
            if (artist.name) artistNamesSet.add(artist.name.trim());
          }
        }
      } catch (e) {
        console.error(`Failed to fetch ${timeRange} top tracks:`, e);
      }
    }

    // 3. Followed Artists (cursor-based pagination up to 1,000 artists)
    let lastArtistId: string | undefined = undefined;
    for (let page = 0; page < 20; page++) {
      try {
        const data = await fetchSpotifyFollowedArtists(accessToken, lastArtistId);
        const artists = data.artists?.items ?? [];
        if (artists.length === 0) break;

        for (const artist of artists) {
          if (artist.name) artistNamesSet.add(artist.name.trim());
        }
        lastArtistId = artists[artists.length - 1]?.id;
        if (!data.artists?.cursors?.after) break;
      } catch {
        break;
      }
    }

    // 4. Saved Albums (up to 500 albums)
    for (let offset = 0; offset < 500; offset += 50) {
      try {
        const data = await fetchSpotifySavedAlbums(accessToken, 50, offset);
        const items = data.items ?? [];
        if (items.length === 0) break;
        for (const item of items) {
          for (const artist of item.album?.artists ?? []) {
            if (artist.name) artistNamesSet.add(artist.name.trim());
          }
        }
      } catch {
        break;
      }
    }

    // 5. Liked Songs (up to 2,000 tracks)
    for (let offset = 0; offset < 2000; offset += 50) {
      try {
        const data = await fetchSpotifyLikedTracks(accessToken, 50, offset);
        const items = data.items ?? [];
        if (items.length === 0) break;

        for (const item of items) {
          for (const artist of item.track?.artists ?? []) {
            if (artist.name) artistNamesSet.add(artist.name.trim());
          }
        }
      } catch {
        break;
      }
    }

    // 6. User Playlists & Tracks (up to 30 playlists, 100 tracks each)
    try {
      const playlistData = await fetchSpotifyUserPlaylists(accessToken, 30, 0);
      for (const pl of playlistData.items ?? []) {
        try {
          const trackData = await fetchSpotifyPlaylistTracks(accessToken, pl.id, 100, 0);
          for (const item of trackData.items ?? []) {
            for (const artist of item.item?.artists ?? []) {
              if (artist.name) artistNamesSet.add(artist.name.trim());
            }
          }
        } catch { /* skip playlist if fails */ }
      }
    } catch (e) {
      console.error('Failed to fetch user playlists:', e);
    }

    // 7. Recently Played Tracks
    try {
      const recentData = await fetchSpotifyRecentTracks(accessToken);
      for (const item of recentData.items ?? []) {
        for (const artist of item.track?.artists ?? []) {
          if (artist.name) artistNamesSet.add(artist.name.trim());
        }
      }
    } catch (e) {
      console.error('Failed to fetch recent tracks:', e);
    }

    // Batch insert into DB
    const allCollected = Array.from(artistNamesSet);
    const existingKnown = await prisma.knownArtist.findMany({
      where: { userId, artistName: { in: allCollected } },
      select: { artistName: true },
    });
    const existingSet = new Set(existingKnown.map(k => k.artistName));
    const newArtistNames = allCollected.filter(name => !existingSet.has(name));

    if (newArtistNames.length > 0) {
      await prisma.knownArtist.createMany({
        data: newArtistNames.map(artistName => ({ userId, artistName, addedAt: now })),
      });
      await prisma.streamingHistory.createMany({
        data: newArtistNames.map(artistName => ({ userId, source: 'spotify', artistName, trackName: '[Imported Artist]', playedAt: now })),
      });
    }

    return NextResponse.json({
      success: true,
      addedArtists: newArtistNames.length,
      totalKnownArtists: existingKnown.length + newArtistNames.length,
      message: `Deep imported ${newArtistNames.length} new artists from Spotify (${allCollected.length} total Spotify artists scanned across Top Artists, Top Tracks, Followed Artists, Saved Albums, Liked Songs, & Playlists)`,
    });
  } catch (error: unknown) {
    console.error('Spotify fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch Spotify data' }, { status: 500 });
  }
}
