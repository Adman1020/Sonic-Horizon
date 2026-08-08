// Shared discovery pipeline — used by the manual API routes AND the in-process
// scheduler (lib/scheduler.ts) so scheduled refreshes behave exactly like a
// manual run. Extracted from the old app/api/spotify/fetch, app/api/generate and
// app/api/spotify/sync handlers.
//
// A scheduled run is: refresh Spotify explicit-likes signals → generate
// recommendations from saved settings → push to the "Sonic Horizon" playlist
// (which records the picks as known so they are excluded next time).

import { prisma } from '@/lib/prisma';
import { getAIConfig } from '@/lib/keys';
import {
  getValidSpotifyAccessToken,
  fetchSpotifyFollowedArtists,
  fetchSpotifySavedAlbums,
  fetchSpotifyLikedTracks,
  fetchSpotifyRecentlyPlayed,
  searchSpotifyTrack,
  searchSpotifyAlbumTracks,
  searchArtistTopTrack,
  createOrUpdatePlaylist,
  findUserPlaylist,
  getAllPlaylistItemUris,
} from '@/lib/spotify';
import { applySignalsToArtists, applyRecentlyPlayedArtists, RECENTLY_PLAYED_WINDOW_DAYS } from '@/lib/artistScoreDb';
import {
  isPoolEligible,
  isBaselineEligible,
  isGenreLike,
  parseGenres,
  normalizeArtistName,
} from '@/lib/artistScore';
import {
  buildDiscoveryContext,
  isDiscoveryMode,
  DISCOVERY_MODE_DEFAULT,
  type DiscoveryMode,
} from '@/lib/discovery';
import { generateDiscoveryPlaylist, type ProviderType } from '@/lib/llm';
import { SPOTIFY_SOURCES, parseSpotifySources, DEFAULT_SPOTIFY_SOURCES } from '@/lib/spotifySources';

const CURRENT_PLAYLIST = 'Sonic Horizon';
const ARCHIVE_PLAYLIST = 'Sonic Horizon Archive';

// ─── Step 1: Refresh Spotify explicit-likes signals ───────────────────────────

export type RefreshSignalsResult =
  | { ok: true; touched: number; addedArtists: number; totalKnownArtists: number; recentlyPlayedSkipped: boolean; message: string; accessToken: string }
  | { ok: false; status: number; message: string; detail: string };

export async function refreshSpotifySignals(userId: string, requestedSources?: string[]): Promise<RefreshSignalsResult> {
  try {
    const settings = await prisma.settings.findUnique({ where: { userId } });
    if (!settings?.spotifyAccessToken) {
      return { ok: false, status: 400, message: 'Spotify not connected', detail: 'No stored Spotify access token.' };
    }

    const enabledSources = requestedSources
      ? parseSpotifySources(requestedSources)
      : [...DEFAULT_SPOTIFY_SOURCES];
    const activeLabels = SPOTIFY_SOURCES
      .filter(s => enabledSources.includes(s.key))
      .map(s => s.label);

    const accessToken = await getValidSpotifyAccessToken(userId);
    if (!accessToken) {
      return { ok: false, status: 401, message: 'Spotify token refresh failed - please reconnect', detail: 'getValidSpotifyAccessToken returned null.' };
    }

    // Collect per-artist signal counts (source → occurrence count). Weights are
    // applied later in lib/artistScore.ts; the fetch only records provenance.
    const artistSignals = new Map<string, Record<string, number>>();
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

    // 4. Recently Played (EXCLUSION ONLY — never feeds seeds). Page back up to
    // ~500 tracks or until plays are older than the window. A 403 means the
    // token lacks user-read-recently-played (pre-rethink tokens); skip silently
    // and flag it so the caller/UI can prompt re-authorisation.
    let recentlyPlayedSkipped = false;
    const artistPlayedAt = new Map<string, Date>();
    const cutoffMs = Date.now() - RECENTLY_PLAYED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    try {
      const first = await fetchSpotifyRecentlyPlayed(accessToken, 50);
      let items: any[] = first?.items ?? [];
      let beforeCursor: number | undefined = first?.cursors?.before ? Number(first.cursors.before) : undefined;
      let pageCount = 0;
      while (items.length > 0 && pageCount < 10) {
        let oldest = Infinity;
        for (const item of items) {
          const playedAtRaw = item?.played_at;
          const playedAt = playedAtRaw ? new Date(playedAtRaw) : null;
          if (!playedAt || isNaN(playedAt.getTime())) continue;
          if (playedAt.getTime() < oldest) oldest = playedAt.getTime();
          for (const artist of item?.track?.artists ?? []) {
            const name = artist?.name?.trim();
            if (!name) continue;
            const existing = artistPlayedAt.get(name);
            if (!existing || playedAt > existing) artistPlayedAt.set(name, playedAt);
          }
        }
        if (oldest < cutoffMs) break;
        if (beforeCursor === undefined) break;
        const next = await fetchSpotifyRecentlyPlayed(accessToken, 50, beforeCursor);
        items = next?.items ?? [];
        beforeCursor = next?.cursors?.before ? Number(next.cursors.before) : undefined;
        pageCount++;
      }
      await applyRecentlyPlayedArtists(userId, artistPlayedAt, new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/403/.test(msg)) {
        recentlyPlayedSkipped = true;
        console.warn('[spotify:refresh] recently-played scope missing — skipping (re-authorise to enable)');
      } else {
        console.warn('[spotify:refresh] recently-played fetch failed:', msg);
      }
    }

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

    return {
      ok: true,
      touched,
      addedArtists: newArtistNames.length,
      totalKnownArtists,
      recentlyPlayedSkipped,
      message: `Scored ${touched} artists from Spotify (${newArtistNames.length} new) across ${scannedSummary}${recentlyPlayedSkipped ? ' — recently-played filter skipped (re-authorise to enable)' : ''}`,
      accessToken,
    };
  } catch (error: unknown) {
    console.error('Spotify signal refresh error:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 500, message: 'Failed to fetch Spotify data', detail };
  }
}

// ─── Step 2: Generate recommendations ─────────────────────────────────────────

export interface GenerateDiscoveryOpts {
  provider?: string;
  model?: string;
  obscurity?: number;
  format?: string;
  quantity?: number;
  delayMs?: number;
  genres?: string[];
  discoveryMode?: DiscoveryMode;
  rabbitHoleArtist?: string | null;
}

export type GenerateDiscoveryResult =
  | { ok: true; recommendations: any[]; format: string; quantity: number }
  | { ok: false; status: number; error: string };

export async function generateDiscovery(userId: string, opts: GenerateDiscoveryOpts = {}): Promise<GenerateDiscoveryResult> {
  const settings = await prisma.settings.findUnique({ where: { userId } });

  // Resolve provider/model/key from the admin-configured AI setup. Explicit
  // opts still win so a manual call can override, but every scheduled/manual
  // run shares the same admin-provided provider, model and API key.
  const ai = await getAIConfig();
  let provider: ProviderType | undefined = opts.provider as ProviderType | undefined;
  if (!provider && ai.configured) provider = ai.provider as ProviderType;
  if (!provider) {
    return { ok: false, status: 400, error: 'No AI provider configured. Ask an admin to set one up in the Admin panel.' };
  }

  const apiKey = ai.apiKey;
  if (provider !== 'Ollama' && !apiKey) {
    return { ok: false, status: 400, error: `No API key saved for ${provider}. Ask an admin to add one in the Admin panel.` };
  }
  const resolvedApiKey = apiKey ?? '';

  const model = opts.model ?? ai.model ?? undefined;
  const obscurity = opts.obscurity ?? settings?.obscurityLevel ?? 3;
  const format = opts.format ?? settings?.outputFormat ?? 'tracks';
  const quantity = opts.quantity ?? settings?.recommendationLimit ?? 20;
  const delayMs = opts.delayMs ?? (ai.rpm > 0 ? Math.round(60000 / ai.rpm) : 0);

  // Resolve genre focus: request opts win, otherwise the saved setting.
  // Capped at 4 — a long genre list makes the model diffuse (the randomness
  // this mode was built to fix).
  const selectedGenres = (Array.isArray(opts.genres) && opts.genres.length > 0
    ? opts.genres.filter((g: unknown): g is string => typeof g === 'string' && isGenreLike(g))
    : parseGenres(settings?.genres ?? '')).slice(0, 4);

  const mode: DiscoveryMode = typeof opts.discoveryMode === 'string' && isDiscoveryMode(opts.discoveryMode)
    ? opts.discoveryMode
    : isDiscoveryMode(settings?.discoveryMode ?? '')
      ? (settings!.discoveryMode as DiscoveryMode)
      : DISCOVERY_MODE_DEFAULT;

  const rabbitHoleArtist = opts.rabbitHoleArtist ?? settings?.rabbitHoleArtist ?? undefined;

  const allArtists = await prisma.knownArtist.findMany({
    where: { userId },
    select: { id: true, artistName: true, signals: true, lastSeenAt: true, lastPlayedAt: true },
  });

  const baselineArtists = allArtists.filter(isBaselineEligible);
  const poolArtists = allArtists.filter(isPoolEligible);

  if (baselineArtists.length === 0) {
    return { ok: false, status: 400, error: 'No taste profile found. Connect Spotify (Step 1) to build your artist pool.' };
  }

  if (poolArtists.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Your profile has no qualifying data yet (artists need a followed, saved, or liked signal). Connect Spotify in Step 1 to build your taste profile.',
    };
  }

  const excludedSet = new Set(baselineArtists.map(a => normalizeArtistName(a.artistName)));

  const ctx = await buildDiscoveryContext({
    mode,
    pool: poolArtists as any,
    baseline: baselineArtists as any,
    selectedGenres,
    rabbitHoleArtist,
    provider,
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
    provider,
    apiKey: resolvedApiKey,
    systemPrompt,
    userPrompt,
    model,
    delayMs,
  });

  if (!result?.recommendations?.length) {
    console.warn(`[generate] LLM returned no recommendations (${provider}/${model})`);
    return { ok: false, status: 500, error: 'LLM returned no recommendations' };
  }

  console.log(`[generate] LLM returned ${result.recommendations.length} raw recs`);

  const cleaned = (result.recommendations as any[]).filter((rec: any) => {
    const artist = String(rec.artist || rec.artistName || '').trim();
    if (!artist) return false;
    return !excludedSet.has(normalizeArtistName(artist));
  });

  if (cleaned.length === 0) {
    return { ok: false, status: 500, error: 'The model only suggested artists already in your library. Try again or raise the quantity.' };
  }

  const seenArtists = new Set<string>();
  const deduped = cleaned.filter((rec: any) => {
    const artist = String(rec.artist || rec.artistName || '').trim();
    const key = normalizeArtistName(artist);
    if (seenArtists.has(key)) return false;
    seenArtists.add(key);
    return true;
  });

  console.log(`[generate] after hard exclusion (${excludedSet.size} baseline artists): ${cleaned.length}/${result.recommendations.length} remain; ${cleaned.length - deduped.length} duplicate-artist recs dropped`);

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
  return { ok: true, recommendations: finalRecommendations, format, quantity };
}

// ─── Step 3: Push recommendations to the Spotify playlist ─────────────────────

export type PushToPlaylistResult = {
  ok: true;
  resolved: number;
  total: number;
  trackCount: number;
  playlistUrl: string | null;
  playlistId: string | null;
  format: string;
  message: string;
} | {
  ok: false;
  status: number;
  message: string;
  detail: string;
};

export async function pushRecommendationsToSpotify(
  userId: string,
  recommendations: any[],
  requestFormat?: string,
  requestIsPublic?: boolean,
): Promise<PushToPlaylistResult> {
  try {
    if (!recommendations?.length) {
      return { ok: false, status: 400, message: 'No recommendations provided', detail: 'recommendations array is empty.' };
    }

    const accessToken = await getValidSpotifyAccessToken(userId);
    if (!accessToken) {
      return { ok: false, status: 400, message: 'Spotify not connected or access token expired. Please click "Connect Spotify via OAuth".', detail: 'getValidSpotifyAccessToken returned null.' };
    }

    const settings = await prisma.settings.findUnique({ where: { userId } });
    const format = requestFormat || settings?.outputFormat || 'tracks';
    const isPublic = requestIsPublic !== undefined ? Boolean(requestIsPublic) : (settings?.spotifyPlaylistPublic ?? true);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { spotifyId: true } });
    const spotifyUserId = user?.spotifyId;
    if (!spotifyUserId) {
      throw new Error('Spotify identity missing — reconnect Spotify via OAuth.');
    }

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

      const artist = rec.artist || rec.artistName || '';
      const title = rec.title || rec.trackName || rec.album || rec.albumName || '';
      if (!artist || !title) continue;

      try {
        if (format === 'albums') {
          const albumResult = await searchSpotifyAlbumTracks(accessToken, artist, title);
          if (albumResult.uris.length > 0) {
            resolvedUris.push(...albumResult.uris);
            resolvedCount++;
          } else {
            const track = await searchSpotifyTrack(accessToken, artist, title);
            const fallbackTrack = track?.uri ? track : await searchArtistTopTrack(accessToken, artist);
            if (fallbackTrack?.uri) {
              resolvedUris.push(fallbackTrack.uri);
              resolvedCount++;
              console.warn(`Sync: Album not found, fell back to track for: "${artist} - ${title}"`);
            } else {
              console.warn(`Sync: Could not find album or track on Spotify: "${artist} - ${title}"`);
            }
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

    // Step 5: Save pushed artists as known so future runs exclude them.
    // lastSeenAt marks them baseline-eligible (known = excluded) even though
    // they have no explicit-likes signals.
    const now = new Date();
    for (const rec of recommendations) {
      const artist = rec.artist || rec.artistName || '';
      if (!artist) continue;
      try {
        await prisma.knownArtist.upsert({
          where: { userId_artistName: { userId, artistName: artist } },
          update: { lastSeenAt: now },
          create: { userId, artistName: artist, addedAt: now, lastSeenAt: now },
        });
      } catch { /* skip */ }
    }

    const playlistUrl = playlistObj?.external_urls?.spotify || (playlistObj?.id ? `https://open.spotify.com/playlist/${playlistObj.id}` : null);

    const message = format === 'albums'
      ? `Synced ${resolvedCount}/${recommendations.length} albums (${uniqueResolvedUris.length} tracks total) to "Sonic Horizon"`
      : `Synced ${resolvedCount}/${recommendations.length} tracks to "Sonic Horizon"`;

    return {
      ok: true,
      resolved: resolvedCount,
      total: recommendations.length,
      trackCount: uniqueResolvedUris.length,
      playlistUrl,
      playlistId: playlistObj?.id ?? null,
      format,
      message,
    };
  } catch (error: unknown) {
    console.error('Spotify sync error:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 500, message: 'Failed to sync with Spotify', detail };
  }
}

// ─── Orchestrator: the full scheduled pipeline ────────────────────────────────

// Per-user guard so a cron tick and a manual trigger (or two overlapping ticks
// if node-cron's noOverlap ever gets bypassed) can't run the pipeline twice.
const runningDiscoveries = new Set<string>();

export async function runScheduledDiscovery(userId: string, opts: { force?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  if (runningDiscoveries.has(userId)) {
    return { ok: false, message: 'A discovery for this user is already running.' };
  }

  const settings = await prisma.settings.findUnique({ where: { userId } });
  if (!opts.force && !settings?.scheduleEnabled) {
    return { ok: false, message: 'Scheduled refreshes are disabled for this user.' };
  }

  runningDiscoveries.add(userId);
  try {
    // 1. Refresh Spotify signals (liked / saved / followed).
    const refreshed = await refreshSpotifySignals(userId);
    if (!refreshed.ok) {
      console.warn(`[run] user ${userId} refresh failed: ${refreshed.message} (${refreshed.detail})`);
      return { ok: false, message: `Refresh skipped (${refreshed.message})` };
    }

    // 2. Generate recommendations from saved settings.
    let gen: GenerateDiscoveryResult;
    try {
      gen = await generateDiscovery(userId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[run] user ${userId} generation failed:`, error);
      return { ok: false, message: `Generation failed: ${msg}` };
    }
    if (!gen.ok) {
      console.warn(`[run] user ${userId} generation error: ${gen.error}`);
      return { ok: false, message: `Generation failed: ${gen.error}` };
    }
    if (gen.recommendations.length === 0) {
      return { ok: false, message: 'No recommendations were generated.' };
    }

    // 3. Push to the Spotify playlist (also records the picks as known/excluded).
    const push = await pushRecommendationsToSpotify(userId, gen.recommendations, gen.format, settings?.spotifyPlaylistPublic);
    if (!push.ok) {
      console.warn(`[run] user ${userId} push failed: ${push.message} (${push.detail})`);
      return { ok: false, message: `Generated ${gen.recommendations.length} recommendations but push failed: ${push.message}` };
    }

    return { ok: true, message: `${push.message} (${refreshed.message})` };
  } finally {
    runningDiscoveries.delete(userId);
  }
}
