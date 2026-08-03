import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { getValidSpotifyAccessToken, searchSpotifyTrack, searchSpotifyAlbumTracks, createOrUpdatePlaylist, findUserPlaylist, getAllPlaylistItemUris } from '@/lib/spotify';

const CURRENT_PLAYLIST = 'Sonic Horizon';
const ARCHIVE_PLAYLIST = 'Sonic Horizon Archive';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { recommendations, format: requestFormat, isPublic: requestIsPublic } = await req.json();
    if (!recommendations?.length) {
      return NextResponse.json({ error: 'No recommendations provided' }, { status: 400 });
    }

    const accessToken = await getValidSpotifyAccessToken(userId);
    if (!accessToken) {
      return NextResponse.json({ error: 'Spotify not connected or access token expired. Please click "Connect Spotify via OAuth".' }, { status: 400 });
    }

    const settings = await prisma.settings.findUnique({ where: { userId } });
    const format = requestFormat || settings?.outputFormat || 'tracks';
    const isPublic = requestIsPublic !== undefined ? Boolean(requestIsPublic) : (settings?.spotifyPlaylistPublic ?? true);

    // Get Spotify user ID
    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      throw new Error(`Spotify Profile API failed: ${await profileRes.text()}`);
    }
    const profile = await profileRes.json();
    const spotifyUserId = profile.id;

    // Step 1: Read all tracks currently in "Current" playlist (paginated)
    const currentPlaylist = await findUserPlaylist(accessToken, CURRENT_PLAYLIST);
    const currentTrackUris = currentPlaylist
      ? await getAllPlaylistItemUris(accessToken, currentPlaylist.id)
      : [];
    if (currentTrackUris.length > 0) {
      console.log(`Found ${currentTrackUris.length} existing tracks in "${CURRENT_PLAYLIST}" to archive.`);
    }

    // Step 2: Archive current tracks (deduped against existing archive contents)
    if (currentTrackUris.length > 0) {
      await createOrUpdatePlaylist(accessToken, spotifyUserId, ARCHIVE_PLAYLIST, currentTrackUris, true, isPublic);
    }

    // Step 3: Resolve recommendations to Spotify URIs
    const resolvedUris: string[] = [];
    let resolvedCount = 0;

    for (const rec of recommendations) {
      // 1. Check if pre-resolved URIs exist on recommendation item
      if (format === 'tracks' && rec.spotifyUri) {
        resolvedUris.push(rec.spotifyUri);
        resolvedCount++;
        continue;
      }
      if (format === 'albums' && rec.spotifyUris && Array.isArray(rec.spotifyUris) && rec.spotifyUris.length > 0) {
        resolvedUris.push(...rec.spotifyUris);
        resolvedCount++;
        continue;
      }

      // 2. Fallback: Search Spotify API dynamically
      const artist = rec.artist || rec.artistName || '';
      const title = rec.title || rec.trackName || rec.album || rec.albumName || '';
      if (!artist || !title) continue;

      try {
        if (format === 'albums') {
          const albumUris = await searchSpotifyAlbumTracks(accessToken, artist, title);
          if (albumUris.length > 0) {
            resolvedUris.push(...albumUris);
            resolvedCount++;
          } else {
            console.warn(`Sync: Could not find album on Spotify: "${artist} - ${title}"`);
          }
        } else {
          const track = await searchSpotifyTrack(accessToken, artist, title);
          if (track?.uri) {
            resolvedUris.push(track.uri);
            resolvedCount++;
          } else {
            console.warn(`Sync: Could not find track on Spotify: "${artist} - ${title}"`);
          }
        }
      } catch (err) {
        console.error(`Sync: Error searching Spotify for "${artist} - ${title}":`, err);
      }
    }

    // Step 4: Always create/update "Current" playlist and obtain playlistUrl
    const uniqueResolvedUris = [...new Set(resolvedUris)];
    if (uniqueResolvedUris.length !== resolvedUris.length) {
      console.log(`Removed ${resolvedUris.length - uniqueResolvedUris.length} duplicate resolved URIs.`);
    }
    const playlistObj = await createOrUpdatePlaylist(accessToken, spotifyUserId, CURRENT_PLAYLIST, uniqueResolvedUris, false, isPublic);

    // Step 5: Save pushed artists to KnownArtist exclusions database
    const now = new Date();
    for (const rec of recommendations) {
      const artist = rec.artist || rec.artistName || '';
      if (!artist) continue;
      try {
        await prisma.knownArtist.upsert({
          where: { userId_artistName: { userId, artistName: artist } },
          update: {},
          create: { userId, artistName: artist, addedAt: now },
        });
      } catch { /* skip */ }
    }

    const playlistUrl = playlistObj?.external_urls?.spotify || (playlistObj?.id ? `https://open.spotify.com/playlist/${playlistObj.id}` : null);

    const message = format === 'albums'
      ? `Synced ${resolvedCount}/${recommendations.length} albums (${uniqueResolvedUris.length} tracks total) to "Sonic Horizon"`
      : `Synced ${resolvedCount}/${recommendations.length} tracks to "Sonic Horizon"`;

    return NextResponse.json({
      success: true,
      resolved: resolvedCount,
      total: recommendations.length,
      trackCount: uniqueResolvedUris.length,
      playlistUrl,
      playlistId: playlistObj?.id,
      format,
      message,
    });
  } catch (error: unknown) {
    console.error('Spotify sync error:', error);
    return NextResponse.json({ error: 'Failed to sync with Spotify' }, { status: 500 });
  }
}
