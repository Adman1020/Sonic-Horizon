import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { getDecryptedKey } from '@/lib/keys';
import { generateDiscoveryPlaylist, ProviderType } from '@/lib/llm';
import { getValidSpotifyAccessToken, searchSpotifyTrack, searchSpotifyAlbumTracks } from '@/lib/spotify';
import { rankSeeds, normalizeArtistName, isTasteFocus, TASTE_FOCUS_DEFAULT, isPoolEligible, isBaselineEligible, type TasteFocus } from '@/lib/artistScore';

const SEED_LIMIT = 50;
// Send the FULL exclusion baseline to the model. A fixed small cap (500) hid
// thousands of known artists from the prompt, so the model naturally suggested
// artists the user already listens to — and the code-side filter then deleted
// them, returning a fraction of the requested quantity. Artist names are cheap
// tokens; Gemini/OpenAI/Anthropic all have 200K+ contexts, so send everything
// (capped defensively for small local models).
const EXCLUSION_LIST_LIMIT = 10000;

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
      tasteFocus,
    } = body;

    if (!provider) return NextResponse.json({ error: 'Provider required' }, { status: 400 });

    // Get decrypted API key from DB
    const apiKey = await getDecryptedKey(userId, provider);
    if (!apiKey) {
      return NextResponse.json({ error: `No saved API key for ${provider}. Please add one in Step 2.` }, { status: 400 });
    }

    // Resolve taste focus: request body wins, otherwise the saved setting.
    const settings = await prisma.settings.findUnique({ where: { userId } });
    const focus: TasteFocus = isTasteFocus(tasteFocus)
      ? tasteFocus
      : isTasteFocus(settings?.tasteFocus ?? '')
        ? (settings!.tasteFocus as TasteFocus)
        : TASTE_FOCUS_DEFAULT;

    // The whole known-artist table is the hard exclusion baseline...
    const allArtists = await prisma.knownArtist.findMany({
      where: { userId },
      select: { artistName: true, playCount: true, historyScore: true, signals: true, lastSeenAt: true },
    });

    // ...filtered by the noise floor: history-only artists with <3 real plays
    // are neither "known taste" (baseline) nor seed material. API signals always
    // qualify; legacy imports qualify for the baseline but never the seeds.
    const baselineArtists = allArtists.filter(isBaselineEligible);
    const poolArtists = allArtists.filter(isPoolEligible);

    if (baselineArtists.length === 0) {
      return NextResponse.json({
        error: 'No listening profile found. Connect Last.fm or Spotify (Step 1) to build your artist pool.',
      }, { status: 400 });
    }

    if (poolArtists.length === 0) {
      return NextResponse.json({
        error: `Your profile has no qualifying listening data yet (artists need 3+ real plays, or a followed/saved/liked signal). Connect Spotify or Last.fm in Step 1 to build your taste profile.`,
      }, { status: 400 });
    }

    const excludedSet = new Set(baselineArtists.map(a => normalizeArtistName(a.artistName)));

    // ...and the top-scored subset is the seed pool for the prompt.
    const seeds = rankSeeds(poolArtists as any, focus, SEED_LIMIT);
    const topArtists = seeds.map(s => ({ name: s.artistName, weight: s.score }));

    // Capped in-prompt exclusion list (the code-side filter below enforces the
    // full baseline no matter what the model does).
    const exclusionSample = rankSeeds(baselineArtists as any, focus, EXCLUSION_LIST_LIMIT)
      .map(s => s.artistName);
    const excludedCount = baselineArtists.length;

    const systemPrompt = `You are an expert music curator and deep-crate collector. 
Analyze the user's historical listening profile below and recommend NEW music they have never heard.

CRITICAL CONSTRAINTS:
1. DO NOT recommend any artist in the EXCLUDED ARTISTS list below. This is absolute.
2. Ignore recency bias - analyse the full long-term taste profile.
3. Obscurity Target: Level ${obscurity}/5 (1=Mainstream pop/rock, 3=Critically acclaimed indie, 5=Underground/Bandcamp/extremely niche).
4. Output MUST be valid JSON matching exactly the schema below. No markdown, no explanation.
5. QUALITY: Recommend genuinely GOOD music - critically acclaimed, well-reviewed, or respected within its genre/scene. Never pad the list with filler, novelty tracks, low-effort or throwaway releases. At higher obscurity, this matters MORE, not less: an underground pick should still be a great artist with a strong local reputation, solid reviews, or a respected cult following - not a random obscure unknown. If unsure between two candidates, pick the better-reviewed one.

USER'S TOP ARTISTS (scored by taste affinity — higher score = stronger signal):
${topArtists.map(a => `  - ${a.name} (score ${a.weight.toFixed(1)})`).join('\n')}

EXCLUDED ARTISTS — DO NOT RECOMMEND ANY OF THESE:
${exclusionSample.join(', ')}

(${excludedCount} artists total in the exclusion list; ${excludedCount - exclusionSample.length} more are enforced server-side and forbidden just as strictly.)

OUTPUT SCHEMA (return exactly this JSON, no other text):
{
  "recommendations": [
    {
      "artist": "Artist Name",
      "title": "${format === 'tracks' ? 'Track Title' : 'Album Title'}",
      "reasoning": "One sentence connecting this to the user's taste profile and why this artist is high quality (acclaim, reputation, or craft)",
      "genre_tags": ["Tag1", "Tag2"]
    }
  ]
}`;

    const promptQuantity = Math.max(quantity + 10, Math.ceil(quantity * 1.5));
    const userPrompt = `Generate ${promptQuantity} ${format === 'tracks' ? 'track' : 'album'} recommendations. Return ONLY the JSON object, no other text.`;

    console.log(`[generate] request qty=${quantity} promptQty=${promptQuantity} format=${format} obscurity=${obscurity} provider=${provider} model=${model ?? 'default'} baseline=${baselineArtists.length} pool=${poolArtists.length} focus=${focus} exclShown=${exclusionSample.length}/${excludedCount}`);

    const result = await generateDiscoveryPlaylist({
      provider: provider as ProviderType,
      apiKey,
      systemPrompt,
      userPrompt,
      model,
      delayMs,
    });

    if (!result?.recommendations?.length) {
      console.warn(`[generate] LLM returned no recommendations (${provider}/${model})`);
      return NextResponse.json({ error: 'LLM returned no recommendations' }, { status: 500 });
    }

    console.log(`[generate] LLM returned ${result.recommendations.length} raw recs`);

    // Code-side hard exclusion: drop anything that maps to a known artist,
    // regardless of what the prompt said.
    const cleaned = (result.recommendations as any[]).filter((rec: any) => {
      const artist = String(rec.artist || rec.artistName || '').trim();
      if (!artist) return false;
      return !excludedSet.has(normalizeArtistName(artist));
    });

    if (cleaned.length === 0) {
      return NextResponse.json({ error: 'The model only suggested artists already in your listening history. Try again or raise the quantity.' }, { status: 500 });
    }

    console.log(`[generate] after hard exclusion (${excludedSet.size} baseline artists): ${cleaned.length}/${result.recommendations.length} remain`);

    // Pre-verify candidates against Spotify if token is available
    const spotifyToken = await getValidSpotifyAccessToken(userId);
    let finalRecommendations = cleaned;
    let spotifyDropped = 0;

    if (spotifyToken) {
      console.log(`[generate] Spotify verification ON — checking up to ${quantity}`);
      const verified = [];
      for (const rec of cleaned) {
        if (verified.length >= quantity) break;
        const artist = rec.artist || rec.artistName || '';
        const title = rec.title || rec.trackName || rec.album || rec.albumName || '';
        if (!artist || !title) continue;

        if (format === 'albums') {
          const albumResult = await searchSpotifyAlbumTracks(spotifyToken, artist, title);
          if (albumResult.uris.length > 0) {
            verified.push({ ...rec, spotifyUris: albumResult.uris, spotifyAlbumId: albumResult.albumId });
          } else {
            spotifyDropped++;
            console.warn(`[generate] Spotify dropped album: "${artist}" - "${title}"`);
          }
        } else {
          const track = await searchSpotifyTrack(spotifyToken, artist, title);
          if (track?.uri) {
            verified.push({ ...rec, spotifyUri: track.uri });
          } else {
            spotifyDropped++;
            console.warn(`[generate] Spotify dropped track: "${artist}" - "${title}"`);
          }
        }
      }
      console.log(`[generate] Spotify verified ${verified.length}, dropped ${spotifyDropped}`);
      if (verified.length > 0) {
        finalRecommendations = verified;
      } else {
        finalRecommendations = cleaned.slice(0, quantity);
      }
    } else {
      console.log('[generate] No Spotify token — returning unverified recommendations');
      finalRecommendations = cleaned.slice(0, quantity);
    }

    console.log(`[generate] FINAL: ${finalRecommendations.length} recs returned (requested ${quantity})`);
    return NextResponse.json({ recommendations: finalRecommendations });
  } catch (error: unknown) {
    console.error('Generation error:', error);
    const msg = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
