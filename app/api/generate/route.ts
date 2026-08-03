import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { getDecryptedKey } from '@/lib/keys';
import { generateDiscoveryPlaylist, ProviderType } from '@/lib/llm';
import { getValidSpotifyAccessToken, searchSpotifyTrack, searchSpotifyAlbumTracks } from '@/lib/spotify';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      provider,
      model,
      obscurity = 3,
      format = 'tracks',
      quantity = 20,
      delayMs = 0,
    } = body;

    if (!provider) return NextResponse.json({ error: 'Provider required' }, { status: 400 });

    // Get decrypted API key from DB
    const apiKey = await getDecryptedKey(userId, provider);
    if (!apiKey) {
      return NextResponse.json({ error: `No saved API key for ${provider}. Please add one in Step 2.` }, { status: 400 });
    }

    // Load user's top artists weighted by play frequency
    const artistCounts = await prisma.streamingHistory.groupBy({
      by: ['artistName'],
      where: { userId },
      _count: { artistName: true },
      orderBy: { _count: { artistName: 'desc' } },
      take: 100,
    });

    if (artistCounts.length === 0) {
      return NextResponse.json({
        error: 'No listening history found. Connect Last.fm or Spotify first (Step 1).',
      }, { status: 400 });
    }

    // Load exclusion list (all known artists)
    const knownArtists = await prisma.knownArtist.findMany({
      where: { userId },
      select: { artistName: true },
    });
    const exclusionList = knownArtists.map(a => a.artistName);

    // Build weighted artist list for the prompt
    const topArtists = artistCounts.map(a => ({
      name: a.artistName,
      weight: a._count.artistName,
    }));

    const systemPrompt = `You are an expert music curator and deep-crate collector. 
Analyze the user's historical listening profile below and recommend NEW music they have never heard.

CRITICAL CONSTRAINTS:
1. DO NOT recommend any artist in the EXCLUDED ARTISTS list below. This is absolute.
2. Ignore recency bias - analyse the full long-term taste profile.
3. Obscurity Target: Level ${obscurity}/5 (1=Mainstream pop/rock, 3=Critically acclaimed indie, 5=Underground/Bandcamp/extremely niche).
4. Output MUST be valid JSON matching exactly the schema below. No markdown, no explanation.

USER'S TOP ARTISTS (weighted by play count):
${topArtists.slice(0, 50).map(a => `  - ${a.name} (${a.weight} plays)`).join('\n')}

EXCLUDED ARTISTS — DO NOT RECOMMEND ANY OF THESE:
${exclusionList.join(', ')}

OUTPUT SCHEMA (return exactly this JSON, no other text):
{
  "recommendations": [
    {
      "artist": "Artist Name",
      "title": "${format === 'tracks' ? 'Track Title' : 'Album Title'}",
      "reasoning": "One sentence connecting this to the user's taste profile",
      "genre_tags": ["Tag1", "Tag2"]
    }
  ]
}`;

    const promptQuantity = Math.max(quantity + 10, Math.ceil(quantity * 1.5));
    const userPrompt = `Generate ${promptQuantity} ${format === 'tracks' ? 'track' : 'album'} recommendations. Return ONLY the JSON object, no other text.`;

    const result = await generateDiscoveryPlaylist({
      provider: provider as ProviderType,
      apiKey,
      systemPrompt,
      userPrompt,
      model,
      delayMs,
    });

    if (!result?.recommendations?.length) {
      return NextResponse.json({ error: 'LLM returned no recommendations' }, { status: 500 });
    }

    // Pre-verify candidates against Spotify if token is available
    const spotifyToken = await getValidSpotifyAccessToken(userId);
    let finalRecommendations = result.recommendations;

    if (spotifyToken) {
      const verified = [];
      for (const rec of (result.recommendations as any[])) {
        if (verified.length >= quantity) break;
        const artist = rec.artist || rec.artistName || '';
        const title = rec.title || rec.trackName || rec.album || rec.albumName || '';
        if (!artist || !title) continue;

        if (format === 'albums') {
          const albumUris = await searchSpotifyAlbumTracks(spotifyToken, artist, title);
          if (albumUris.length > 0) {
            verified.push({ ...rec, spotifyUris: albumUris });
          }
        } else {
          const track = await searchSpotifyTrack(spotifyToken, artist, title);
          if (track?.uri) {
            verified.push({ ...rec, spotifyUri: track.uri });
          }
        }
      }
      if (verified.length > 0) {
        finalRecommendations = verified;
      } else {
        finalRecommendations = result.recommendations.slice(0, quantity);
      }
    } else {
      finalRecommendations = result.recommendations.slice(0, quantity);
    }

    return NextResponse.json({ recommendations: finalRecommendations });
  } catch (error: unknown) {
    console.error('Generation error:', error);
    const msg = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
