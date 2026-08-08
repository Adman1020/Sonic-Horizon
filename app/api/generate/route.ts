import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { getAIConfig } from '@/lib/keys';
import { generateDiscoveryPlaylist, ProviderType } from '@/lib/llm';
import { getValidSpotifyAccessToken, searchSpotifyTrack, searchSpotifyAlbumTracks, searchArtistTopTrack } from '@/lib/spotify';
import { normalizeArtistName, isPoolEligible, isBaselineEligible, isGenreLike, parseGenres } from '@/lib/artistScore';
import { buildDiscoveryContext, isDiscoveryMode, DISCOVERY_MODE_DEFAULT, type DiscoveryMode } from '@/lib/discovery';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      provider: requestedProvider,
      model: requestedModel,
      obscurity = 3,
      format = 'tracks',
      quantity = 20,
      delayMs,
      genres,
      discoveryMode,
      rabbitHoleArtist,
    } = body;

    // AI setup is admin-configured and shared by all users. The request may
    // still override provider/model for advanced calls, but the key always
    // comes from the admin config.
    const ai = await getAIConfig();
    const provider = requestedProvider ?? (ai.configured ? ai.provider : null);
    if (!provider) {
      return NextResponse.json({ error: 'No AI provider configured. Ask an admin to set one up in the Admin panel.' }, { status: 400 });
    }
    const apiKey = ai.apiKey;
    if (provider !== 'Ollama' && !apiKey) {
      return NextResponse.json({ error: `No API key saved for ${provider}. Ask an admin to add one in the Admin panel.` }, { status: 400 });
    }
    const resolvedApiKey = apiKey ?? '';
    const model = requestedModel ?? ai.model ?? undefined;
    const resolvedDelayMs = delayMs ?? (ai.rpm > 0 ? Math.round(60000 / ai.rpm) : 0);

    const settings = await prisma.settings.findUnique({ where: { userId } });

    // Resolve genre focus: request body wins, otherwise the saved setting.
    // Capped at 4 — a long genre list makes the model diffuse (the randomness
    // this mode was built to fix).
    const selectedGenres = (Array.isArray(genres) && genres.length > 0
      ? genres.filter((g: unknown): g is string => typeof g === 'string' && isGenreLike(g))
      : parseGenres(settings?.genres ?? '')).slice(0, 4);

    // Resolve discovery mode: request body wins, otherwise the saved setting.
    const mode: DiscoveryMode = isDiscoveryMode(discoveryMode)
      ? discoveryMode
      : isDiscoveryMode(settings?.discoveryMode ?? '')
        ? (settings!.discoveryMode as DiscoveryMode)
        : DISCOVERY_MODE_DEFAULT;

    // The whole known-artist table is the hard exclusion baseline...
    const allArtists = await prisma.knownArtist.findMany({
      where: { userId },
      select: { id: true, artistName: true, signals: true, lastSeenAt: true },
    });

    // ...filtered by provenance: explicit-likes signals always qualify; artists
    // seen in a fetch (lastSeenAt) but with no signals still count as known.
    const baselineArtists = allArtists.filter(isBaselineEligible);
    const poolArtists = allArtists.filter(isPoolEligible);

    if (baselineArtists.length === 0) {
      return NextResponse.json({
        error: 'No taste profile found. Connect Spotify (Step 1) to build your artist pool.',
      }, { status: 400 });
    }

    if (poolArtists.length === 0) {
      return NextResponse.json({
        error: `Your profile has no qualifying data yet (artists need a followed, saved, or liked signal). Connect Spotify in Step 1 to build your taste profile.`,
      }, { status: 400 });
    }

    const excludedSet = new Set(baselineArtists.map(a => normalizeArtistName(a.artistName)));

    // Build the mode's thesis + tight seed cluster + lane-prioritised exclusion.
    const ctx = await buildDiscoveryContext({
      mode,
      pool: poolArtists as any,
      baseline: baselineArtists as any,
      selectedGenres,
      rabbitHoleArtist,
      provider: provider as ProviderType,
      apiKey: resolvedApiKey,
      model,
    });
    const topArtists = ctx.seeds;

    const systemPrompt = `You are an expert music curator and deep-crate collector. 
Analyze the user's taste profile below and recommend NEW music they have never heard.

CRITICAL CONSTRAINTS:
1. DO NOT recommend any artist in the EXCLUDED ARTISTS list below. This is absolute.
2. Ignore recency bias - analyse the full long-term taste profile.
3. Obscurity Target: Level ${obscurity}/5 (1=Mainstream pop/rock, 3=Critically acclaimed indie, 5=Underground/Bandcamp/extremely niche).
4. Output MUST be valid JSON matching exactly the schema below. No markdown, no explanation.
5. QUALITY: Recommend genuinely GOOD music - critically acclaimed, well-reviewed, or respected within its genre/scene. Never pad the list with filler, novelty tracks, low-effort or throwaway releases. At higher obscurity, this matters MORE, not less: an underground pick should still be a great artist with a strong local reputation, solid reviews, or a respected cult following - not a random obscure unknown. If unsure between two candidates, pick the better-reviewed one.

THE DISCOVERY DIRECTIVE — follow this exactly. It is the single most important instruction:
${ctx.thesisLines.join('\n')}

USER'S TOP ARTISTS (scored by taste affinity — higher score = stronger signal). The directive above tells you which of these to anchor on:
${topArtists.map(a => `  - ${a.name} (score ${a.weight.toFixed(1)})`).join('\n')}

EXCLUDED ARTISTS — DO NOT RECOMMEND ANY OF THESE:
${ctx.exclusionSample.join(', ')}

(${ctx.excludedCount} artists total in the exclusion list; ${ctx.excludedCount - ctx.exclusionSample.length} more are enforced server-side and forbidden just as strictly.)

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
    const userPrompt = `Generate ${promptQuantity} ${format === 'tracks' ? 'track' : 'album'} recommendations, all following the DISCOVERY DIRECTIVE. Return ONLY the JSON object, no other text.`;

    console.log(`[generate] mode=${mode} lane="${ctx.laneLabel}" qty=${quantity} promptQty=${promptQuantity} format=${format} obscurity=${obscurity} provider=${provider} model=${model ?? 'default'} baseline=${baselineArtists.length} pool=${poolArtists.length} seeds=${topArtists.length} genres=${selectedGenres.length ? selectedGenres.join(',') : 'none'} exclShown=${ctx.exclusionSample.length}/${ctx.excludedCount}`);

    const result = await generateDiscoveryPlaylist({
      provider: provider as ProviderType,
      apiKey: resolvedApiKey,
      systemPrompt,
      userPrompt,
      model,
      delayMs: resolvedDelayMs,
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
      return NextResponse.json({ error: 'The model only suggested artists already in your library. Try again or raise the quantity.' }, { status: 500 });
    }

    // Deduplicate by artist so a batch never contains two recs for the same
    // artist (tracks) or two albums from the same artist. Keep the first
    // occurrence in model order.
    const seenArtists = new Set<string>();
    const deduped = cleaned.filter((rec: any) => {
      const artist = String(rec.artist || rec.artistName || '').trim();
      const key = normalizeArtistName(artist);
      if (seenArtists.has(key)) return false;
      seenArtists.add(key);
      return true;
    });

    console.log(`[generate] after hard exclusion (${excludedSet.size} baseline artists): ${cleaned.length}/${result.recommendations.length} remain; ${cleaned.length - deduped.length} duplicate-artist recs dropped`);

    // Pre-verify candidates against Spotify if token is available
    const spotifyToken = await getValidSpotifyAccessToken(userId);
    let finalRecommendations = deduped;
    let spotifyDropped = 0;

    if (spotifyToken) {
      console.log(`[generate] Spotify verification ON — checking up to ${quantity}`);
      const verified = [];
      for (const rec of deduped) {
        if (verified.length >= quantity) break;
        const artist = rec.artist || rec.artistName || '';
        const title = rec.title || rec.trackName || rec.album || rec.albumName || '';
        if (!artist || !title) continue;

        if (format === 'albums') {
          const albumResult = await searchSpotifyAlbumTracks(spotifyToken, artist, title);
          if (albumResult.uris.length > 0) {
            verified.push({ ...rec, spotifyUris: albumResult.uris, spotifyAlbumId: albumResult.albumId });
          } else {
            // Album couldn't be resolved (likely a hallucinated title). Fall
            // back to a real, artist-verified song so the rec still lands in
            // the playlist instead of being silently dropped — and so the
            // embedded sample never plays a different artist.
            const track = await searchSpotifyTrack(spotifyToken, artist, title);
            const fallbackTrack = track?.uri ? track : await searchArtistTopTrack(spotifyToken, artist);
            if (fallbackTrack?.uri) {
              verified.push({ ...rec, spotifyUris: [fallbackTrack.uri], spotifyAlbumId: null });
              console.warn(`[generate] Album not found, fell back to track for: "${artist}" - "${title}"`);
            } else {
              spotifyDropped++;
              console.warn(`[generate] Spotify dropped album (no album or track match): "${artist}" - "${title}"`);
            }
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
        finalRecommendations = deduped.slice(0, quantity);
      }
    } else {
      console.log('[generate] No Spotify token — returning unverified recommendations');
      finalRecommendations = deduped.slice(0, quantity);
    }

    console.log(`[generate] FINAL: ${finalRecommendations.length} recs returned (requested ${quantity})`);
    return NextResponse.json({ recommendations: finalRecommendations });
  } catch (error: unknown) {
    console.error('Generation error:', error);
    const msg = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
