import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { getDecryptedKey } from '@/lib/keys';

export async function refreshSpotifyAccessToken(userId: string): Promise<string | null> {
  try {
    const settings = await prisma.settings.findUnique({ where: { userId } });
    if (!settings?.spotifyRefreshToken) return null;

    const userClientId = await getDecryptedKey(userId, 'spotify_client_id');
    const userClientSecret = await getDecryptedKey(userId, 'spotify_client_secret');
    const clientId = userClientId || process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = userClientSecret || process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) return null;

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

// Spotify Ingestion Service
export async function fetchSpotifyTopArtists(accessToken: string, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'long_term') {
  const response = await fetch(`https://api.spotify.com/v1/me/top/artists?time_range=${timeRange}&limit=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch Spotify top artists');
  return response.json();
}

export async function fetchSpotifyRecentTracks(accessToken: string) {
  const response = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch Spotify recent tracks');
  return response.json();
}

export async function fetchSpotifyLikedTracks(accessToken: string, limit: number = 50, offset: number = 0) {
  const response = await fetch(`https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch Spotify liked tracks');
  return response.json();
}

export async function fetchSpotifyTopTracks(accessToken: string, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'long_term') {
  const response = await fetch(`https://api.spotify.com/v1/me/top/tracks?time_range=${timeRange}&limit=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch Spotify top tracks');
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

export async function fetchSpotifyUserPlaylists(accessToken: string, limit: number = 50, offset: number = 0) {
  const response = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch Spotify user playlists');
  return response.json();
}

export async function fetchSpotifyPlaylistTracks(accessToken: string, playlistId: string, limit: number = 100, offset: number = 0) {
  const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Failed to fetch Spotify playlist tracks');
  return response.json();
}

function cleanTitle(title: string) {
  if (!title) return '';
  return title.replace(/\s*\([^)]*\)/g, '').replace(/\s*-[^-]*$/g, '').trim();
}

export async function searchSpotifyTrack(accessToken: string, artistName: string, trackName: string) {
  const cleanedTrack = cleanTitle(trackName);
  const artist = artistName.trim();

  // 1. Strict field query
  const query = encodeURIComponent(`artist:${artist} track:${cleanedTrack}`);
  let response = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.ok) {
    const data = await response.json();
    if (data.tracks?.items?.[0]) return data.tracks.items[0];
  }

  // 2. Simple text fallback query
  const fallbackQuery = encodeURIComponent(`${artist} ${cleanedTrack}`);
  response = await fetch(`https://api.spotify.com/v1/search?q=${fallbackQuery}&type=track&limit=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.ok) {
    const data = await response.json();
    if (data.tracks?.items?.[0]) return data.tracks.items[0];
  }

  // 3. Track name only fallback
  const trackOnlyQuery = encodeURIComponent(cleanedTrack);
  response = await fetch(`https://api.spotify.com/v1/search?q=${trackOnlyQuery}&type=track&limit=5`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.ok) {
    const data = await response.json();
    const match = data.tracks?.items?.find((t: any) =>
      t.artists?.some((a: any) => a.name.toLowerCase().includes(artist.toLowerCase()))
    );
    if (match) return match;
    return data.tracks?.items?.[0] || null;
  }

  return null;
}

export async function searchSpotifyAlbumTracks(accessToken: string, artistName: string, albumName: string): Promise<{ albumId: string | null; uris: string[] }> {
  const cleanedAlbum = cleanTitle(albumName);
  const artist = artistName.trim();

  // 1. Strict album query
  const query = encodeURIComponent(`artist:${artist} album:${cleanedAlbum}`);
  let albumRes = await fetch(`https://api.spotify.com/v1/search?q=${query}&type=album&limit=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let album = null;
  if (albumRes.ok) {
    const data = await albumRes.json();
    album = data.albums?.items?.[0];
  }

  // 2. Simple fallback album query
  if (!album) {
    const fallbackQuery = encodeURIComponent(`${artist} ${cleanedAlbum}`);
    albumRes = await fetch(`https://api.spotify.com/v1/search?q=${fallbackQuery}&type=album&limit=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (albumRes.ok) {
      const data = await albumRes.json();
      album = data.albums?.items?.[0];
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

export async function findUserPlaylist(accessToken: string, playlistName: string): Promise<{ id: string; name: string; external_urls?: { spotify?: string } } | null> {
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

export interface ImportRecord {
  artistName: string;
  trackName: string;
  albumName?: string | null;
  playedAt: Date;
}

// Parses a Spotify streaming-history JSON file. Handles both export formats:
// - Extended history (endsong_*.json / Streaming_History_Audio_*.json):
//   { ts, master_metadata_track_name, master_metadata_album_artist_name,
//     master_metadata_album_album_name, ... }
// - Basic history (StreamingHistory*.json):
//   { endTime, artistName, trackName, msPlayed }
// Each file is an array of play events. Podcast episodes and rows missing a
// track or artist are skipped.
export function parseEndsongJson(fileContent: string): ImportRecord[] {
  let data: unknown;
  try {
    data = JSON.parse(fileContent);
  } catch {
    throw new Error('Invalid JSON — this does not look like a Spotify streaming history file.');
  }

  const items = Array.isArray(data) ? data : [data];
  const records: ImportRecord[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    let track = rec.master_metadata_track_name;
    let artist = rec.master_metadata_album_artist_name;
    let album = rec.master_metadata_album_album_name;
    let ts = rec.ts;

    // Basic export uses endTime/artistName/trackName and has no album column.
    if (typeof rec.trackName === 'string' && typeof rec.artistName === 'string') {
      if (track == null || typeof track !== 'string') track = rec.trackName;
      if (artist == null || typeof artist !== 'string') artist = rec.artistName;
      if (ts == null) ts = rec.endTime;
    }

    if (typeof track !== 'string' || !track.trim()) continue;
    if (typeof artist !== 'string' || !artist.trim()) continue;

    const playedAt = typeof ts === 'string' ? new Date(ts) : new Date(NaN);
    if (Number.isNaN(playedAt.getTime())) continue;

    records.push({
      artistName: artist.trim(),
      trackName: track.trim(),
      albumName: typeof album === 'string' && album.trim() ? album.trim() : null,
      playedAt,
    });
  }

  return records;
}

export function resolveSpotifyRedirectUri(req: { headers: { get(name: string): string | null }; nextUrl: { host: string; protocol: string } }, userBaseUrl: string | null): string {
  let baseUrl = userBaseUrl?.trim();

  if (!baseUrl) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
    const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http';
    baseUrl = `${proto}://${host}`;
  }

  // Force localhost -> 127.0.0.1 since Spotify rejects literal "localhost" in HTTP callback URLs
  if (baseUrl.includes('localhost')) {
    baseUrl = baseUrl.replace('localhost', '127.0.0.1');
  }

  return `${baseUrl.replace(/\/$/, '')}/api/spotify/callback`;
}

export function safeRedirectUrl(req: { headers: { get(name: string): string | null }; nextUrl: { host: string; protocol: string } }, targetPath: string, userBaseUrl?: string | null): string {
  let baseUrl = userBaseUrl?.trim();

  if (!baseUrl) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
    const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '') || 'http';
    baseUrl = `${proto}://${host}`;
  }

  if (baseUrl.includes('localhost')) {
    baseUrl = baseUrl.replace('localhost', '127.0.0.1');
  }

  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  return `${cleanBase}${cleanPath}`;
}

