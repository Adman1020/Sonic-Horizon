import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

// Container-level credentials, injected as env vars (Unraid / Coolify friendly).
// There are no per-user Client ID / Secret overrides anymore.
export function getSpotifyClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? '';
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables are required.');
  }
  return { clientId, clientSecret };
}

export async function refreshSpotifyAccessToken(userId: string): Promise<string | null> {
  try {
    const settings = await prisma.settings.findUnique({ where: { userId } });
    if (!settings?.spotifyRefreshToken) return null;

    const { clientId, clientSecret } = getSpotifyClientCredentials();

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: settings.spotifyRefreshToken,
      }),
    });

    if (!res.ok) {
      console.error('Failed to refresh Spotify token:', await res.text());
      return null;
    }

    const data = await res.json();
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token || settings.spotifyRefreshToken;

    await prisma.settings.update({
      where: { userId },
      data: {
        spotifyAccessToken: newAccessToken,
        spotifyRefreshToken: newRefreshToken,
      },
    });

    return newAccessToken;
  } catch (err) {
    console.error('Spotify token refresh error:', err);
    return null;
  }
}

export async function getValidSpotifyAccessToken(userId: string): Promise<string | null> {
  const settings = await prisma.settings.findUnique({ where: { userId } });
  if (!settings?.spotifyAccessToken) return null;

  // Test if current access token works
  const testRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${settings.spotifyAccessToken}` },
  });

  if (testRes.ok) {
    return settings.spotifyAccessToken;
  }

  // Token expired or invalid — auto refresh!
  return await refreshSpotifyAccessToken(userId);
}

// Spotify Ingestion Service — only explicit-likes signals feed the pool.
export async function fetchSpotifyLikedTracks(accessToken: string, limit: number = 50, offset: number = 0) {
  const response = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch Spotify liked tracks');
  return response.json();
}

export async function fetchSpotifySavedAlbums(accessToken: string, limit: number = 50, offset: number = 0) {
  const response = await fetch(`https://api.spotify.com/v1/me/albums?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch Spotify saved albums');
  return response.json();
}

export async function fetchSpotifyFollowedArtists(accessToken: string, after?: string) {
  const url = `https://api.spotify.com/v1/me/following?type=artist&limit=50${after ? '&after=' + encodeURIComponent(after) : ''}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch Spotify followed artists');
  return response.json();
}

function cleanTitle(title: string) {
  if (!title) return '';
  return title.replace(/\s*\([^)]*\)/g, '').replace(/\s*-[^-]*$/g, '').trim();
}

function normalizeName(name: string): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9&' ]/g, '');
}

// Loose artist-name equivalence: exact match, or a substring match either
// direction ("The Band" ↔ "Band"). Never accepts an unrelated artist.
function artistMatches(actual: string, expected: string): boolean {
  const a = normalizeName(actual);
  const b = normalizeName(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function trackTitleMatches(actual: string, expected: string): boolean {
  const a = normalizeName(actual);
  const b = normalizeName(expected);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// From a list of search hits, keep only tracks by the expected artist, prefer
// an exact title match, then return the most popular of the survivors. Returns
// null when no hit belongs to the artist — NEVER a different artist's track.
function pickBestTrack(items: any[], artist: string, trackTitle: string): any | null {
  if (!items?.length) return null;
  const withArtist = items.filter((t: any) => t.artists?.some((a: any) => artistMatches(a.name, artist)));
  if (withArtist.length === 0) return null;
  const titleMatches = withArtist.filter((t: any) => trackTitleMatches(t.name, trackTitle));
  const pool = titleMatches.length > 0 ? titleMatches : withArtist;
  return [...pool].sort((a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0))[0] ?? null;
}

export async function searchSpotifyTrack(accessToken: string, artistName: string, trackName: string) {
  const cleanedTrack = cleanTitle(trackName);
  const artist = artistName.trim();
  if (!artist || !cleanedTrack) return null;

  // 1. Strict field query — result must belong to the artist.
  const query = encodeURIComponent(`artist:${artist} track:${cleanedTrack}`);
  let response = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=10`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.ok) {
    const data = await response.json();
    const match = pickBestTrack(data.tracks?.items ?? [], artist, cleanedTrack);
    if (match) return match;
  }

  // 2. Simple text fallback query — artist must still be verified.
  const fallbackQuery = encodeURIComponent(`${artist} ${cleanedTrack}`);
  response = await fetch(`https://api.spotify.com/v1/search?q=${fallbackQuery}&type=track&limit=10`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.ok) {
    const data = await response.json();
    const match = pickBestTrack(data.tracks?.items ?? [], artist, cleanedTrack);
    if (match) return match;
  }

  // 3. Track-name-only query. Picks the best artist-verified match, or null.
  // Returning a top hit from a different artist is what made preview samples
  // show a completely different song — that must never happen.
  const trackOnlyQuery = encodeURIComponent(cleanedTrack);
  response = await fetch(`https://api.spotify.com/v1/search?q=${trackOnlyQuery}&type=track&limit=10`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.ok) {
    const data = await response.json();
    const match = pickBestTrack(data.tracks?.items ?? [], artist, cleanedTrack);
    if (match) return match;
  }

  return null;
}

// A real, verified song by the artist (used when a specific track or album
// can't be resolved). Prefers the artist's most popular track.
export async function searchArtistTopTrack(accessToken: string, artistName: string) {
  const artist = artistName.trim();
  if (!artist) return null;
  const query = encodeURIComponent(`artist:${artist}`);
  const response = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=10`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const items = (data.tracks?.items ?? []).filter((t: any) =>
    t.artists?.some((a: any) => artistMatches(a.name, artist))
  );
  if (items.length === 0) return null;
  return [...items].sort((a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0))[0];
}

export async function searchSpotifyAlbumTracks(accessToken: string, artistName: string, albumName: string): Promise<{ albumId: string | null; uris: string[] }> {
  const cleanedAlbum = cleanTitle(albumName);
  const artist = artistName.trim();
  if (!artist || !cleanedAlbum) return { albumId: null, uris: [] };

  const albumBelongsToArtist = (a: any): boolean =>
    !!a?.artists?.some((ar: any) => artistMatches(ar.name, artist));

  // 1. Strict album query, verified against the artist.
  const query = encodeURIComponent(`artist:${artist} album:${cleanedAlbum}`);
  let albumRes = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=album&limit=10`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let album = null;
  if (albumRes.ok) {
    const data = await albumRes.json();
    album = (data.albums?.items ?? []).find(albumBelongsToArtist) ?? null;
  }

  // 2. Simple fallback album query, verified against the artist.
  if (!album) {
    const fallbackQuery = encodeURIComponent(`${artist} ${cleanedAlbum}`);
    albumRes = await fetch(`https://api.spotify.com/v1/search?q=${fallbackQuery}&type=album&limit=10`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (albumRes.ok) {
      const data = await albumRes.json();
      album = (data.albums?.items ?? []).find(albumBelongsToArtist) ?? null;
    }
  }

  // 3. Album-name-only query, verified against the artist. LLMs frequently
  // hallucinate album titles (wrong word order, extra/missing words), so search
  // the raw title and pick the first result whose primary artist matches.
  if (!album && cleanedAlbum) {
    const nameOnlyQuery = encodeURIComponent(cleanedAlbum);
    albumRes = await fetch(`https://api.spotify.com/v1/search?q=${nameOnlyQuery}&type=album&limit=10`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (albumRes.ok) {
      const data = await albumRes.json();
      album = (data.albums?.items ?? []).find(albumBelongsToArtist) ?? null;
    }
  }

  if (!album?.id) return { albumId: null, uris: [] };

  // Fetch all tracks from the album
  const tracksRes = await fetch(`https://api.spotify.com/v1/albums/${album.id}/tracks?limit=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!tracksRes.ok) return { albumId: album.id, uris: [] };
  const tracksData = await tracksRes.json();
  return {
    albumId: album.id,
    uris: (tracksData.items ?? []).map((t: { uri: string }) => t.uri).filter(Boolean),
  };
}

export async function uploadPlaylistCover(accessToken: string, playlistId: string, imageFileName: string) {
  try {
    const publicPath = path.join(process.cwd(), 'public', imageFileName);
    if (!fs.existsSync(publicPath)) {
      console.warn(`Cover file not found: ${publicPath}`);
      return;
    }
    const imageBuffer = fs.readFileSync(publicPath);
    console.log(`Uploading ${imageFileName} (${imageBuffer.length} bytes) to Spotify playlist ${playlistId}...`);
    const base64Image = imageBuffer.toString('base64');

    const uploadRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/images`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'image/jpeg',
      },
      body: base64Image,
    });
    if (uploadRes.status === 403) {
      console.warn(`Spotify cover upload failed (403): Insufficient client scope. Re-connect Spotify via OAuth in Step 1 to grant image upload permissions.`);
    } else if (!uploadRes.ok && uploadRes.status !== 202) {
      console.error(`Spotify cover upload failed (${uploadRes.status}):`, await uploadRes.text());
    } else {
      console.log(`Successfully uploaded ${imageFileName} to Spotify playlist ${playlistId}!`);
    }
  } catch (err) {
    console.error(`Failed to upload playlist cover (${imageFileName}):`, err);
  }
}

export async function findUserPlaylist(accessToken: string, playlistName: string): Promise<{ id: string; name: string; public?: boolean | null; external_urls?: { spotify?: string } } | null> {
  let nextUrl: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';

  while (nextUrl) {
    try {
      const res: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) break;
      const data = await res.json();
      const found = data.items?.find((p: { name: string }) => p.name === playlistName);
      if (found) return found;
      nextUrl = data.next || null;
    } catch {
      break;
    }
  }

  return null;
}

export async function getAllPlaylistItemUris(accessToken: string, playlistId: string): Promise<string[]> {
  const uris: string[] = [];
  const limit = 50;
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    const items: { item?: { uri: string } }[] = data.items ?? [];
    uris.push(...items.map(e => e.item?.uri).filter((u): u is string => Boolean(u)));
    if (items.length < limit || !data.next) break;
    offset += limit;
  }

  return uris;
}

export async function createOrUpdatePlaylist(accessToken: string, userId: string, playlistName: string, trackUris: string[], append: boolean = false, isPublic: boolean = true) {
  // Check if playlist exists (with pagination)
  let playlist = await findUserPlaylist(accessToken, playlistName);

  // Create playlist if it doesn't exist
  if (!playlist) {
    console.log(`Creating new Spotify playlist "${playlistName}"...`);
    const createRes = await fetch('https://api.spotify.com/v1/me/playlists', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: playlistName, description: 'Generated by Sonic Horizon', public: isPublic })
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`Failed to create Spotify playlist "${playlistName}" (HTTP ${createRes.status}):`, errText);
      throw new Error(`Spotify API error creating playlist (HTTP ${createRes.status}): ${errText}`);
    }
    playlist = await createRes.json();
  }

  if (!playlist?.id) {
    throw new Error(`Could not obtain valid playlist object for "${playlistName}"`);
  }

  // Keep playlist visibility in sync with the current setting on every push.
  // A playlist created public (e.g. before the user flipped the toggle) stays
  // public on Spotify otherwise — the toggle must win on the next push. This
  // runs for both the main and the archive playlist (both call this function).
  if (playlist.public !== isPublic) {
    const visRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: isPublic }),
    });
    if (!visRes.ok) {
      console.error(`Failed to update visibility for "${playlistName}" (HTTP ${visRes.status}):`, await visRes.text());
    } else {
      console.log(`Updated "${playlistName}" visibility → ${isPublic ? 'public' : 'private'}`);
    }
  }

  // Upload custom cover artwork
  const coverFileName = playlistName.includes('Archive') ? 'cover_archive.jpg' : 'cover_current.jpg';
  await uploadPlaylistCover(accessToken, playlist.id, coverFileName);

  // Sync tracks if provided
  console.log(`Updating playlist "${playlistName}" (${playlist.id}) with ${trackUris.length} track URIs...`);
  if (trackUris.length > 0) {
    const chunkSize = 100;
    if (!append) {
      const firstChunk = trackUris.slice(0, chunkSize);
      const putRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/items`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: firstChunk })
      });
      if (!putRes.ok) {
        const errText = await putRes.text();
        console.error(`Failed to replace tracks in playlist ${playlist.id} (HTTP ${putRes.status}):`, errText);
        if (putRes.status === 403) {
          throw new Error(`Spotify permission denied (HTTP 403). Please click 'Reconnect Spotify via OAuth' in Section 01 to refresh permissions.`);
        }
        throw new Error(`Spotify API error replacing tracks (HTTP ${putRes.status}): ${errText}`);
      } else {
        console.log(`Successfully replaced ${firstChunk.length} tracks in playlist ${playlist.id}`);
      }

      for (let i = chunkSize; i < trackUris.length; i += chunkSize) {
        const chunk = trackUris.slice(i, i + chunkSize);
        const postRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: chunk })
        });
        if (!postRes.ok) {
          const errText = await postRes.text();
          console.error(`Failed to append track chunk (HTTP ${postRes.status}):`, errText);
        }
      }
    } else {
      // Append with dedupe — never re-add tracks already in the archive
      const existing = await getAllPlaylistItemUris(accessToken, playlist.id);
      const existingSet = new Set(existing);
      const toAdd = trackUris.filter((uri) => !existingSet.has(uri));
      if (toAdd.length === 0) {
        console.log(`No new items to append to "${playlistName}" — all ${trackUris.length} already present`);
        return playlist;
      }
      console.log(`Appending ${toAdd.length} new items to "${playlistName}" (skipped ${trackUris.length - toAdd.length} duplicates)`);
      for (let i = 0; i < toAdd.length; i += chunkSize) {
        const chunk = toAdd.slice(i, i + chunkSize);
        const postRes = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/items`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: chunk })
        });
        if (!postRes.ok) {
          const errText = await postRes.text();
          console.error(`Failed to append archive tracks (HTTP ${postRes.status}):`, errText);
        }
      }
    }
  } else {
    console.warn(`createOrUpdatePlaylist called for "${playlistName}" but trackUris array is EMPTY (0 tracks resolved).`);
  }

  return playlist;
}

// Normalize APP_BASE_URL: tolerate users pasting the full callback URL
// (…/api/spotify/callback) instead of the bare origin — the trailing callback
// path is always appended by the caller, never part of the base itself.
function normalizeAppBaseUrl(baseUrl: string): string {
  return baseUrl
    .replace(/\/api\/spotify\/callback$/i, '')
    .replace(/\/+$/, '');
}

export function resolveSpotifyRedirectUri(req: { headers: { get(name: string): string | null }; nextUrl: { host: string; protocol: string } }): string {
  // APP_BASE_URL (Unraid / Coolify friendly) wins when set, otherwise derive
  // from the request. Force localhost -> 127.0.0.1 since Spotify rejects
  // literal "localhost" in HTTP callback URLs.
  let baseUrl = process.env.APP_BASE_URL?.trim();

  if (!baseUrl) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
    const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http';
    baseUrl = `${proto}://${host}`;
  }

  if (baseUrl.includes('localhost')) {
    baseUrl = baseUrl.replace('localhost', '127.0.0.1');
  }

  return `${normalizeAppBaseUrl(baseUrl)}/api/spotify/callback`;
}

export function safeRedirectUrl(req: { headers: { get(name: string): string | null }; nextUrl: { host: string; protocol: string } }, targetPath: string): string {
  let baseUrl = process.env.APP_BASE_URL?.trim();

  if (!baseUrl) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
    const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http';
    baseUrl = `${proto}://${host}`;
  }

  if (baseUrl.includes('localhost')) {
    baseUrl = baseUrl.replace('localhost', '127.0.0.1');
  }

  const cleanBase = normalizeAppBaseUrl(baseUrl);
  const cleanPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  return `${cleanBase}${cleanPath}`;
}

