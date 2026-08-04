// Discovery mode logic — server-side. Given a mode and the user's scored artist
// pool, produces the *thesis* (a directive paragraph), a tight coherent seed
// cluster, and a lane-prioritised exclusion sample. All analysis passes (genre
// tagging, branch themes) go through generateLLMJson so every provider works
// the same.
//
// The philosophy: with 10+ years / thousands of artists, "here are my top 50
// artists, don't recommend these 5,000" makes the LLM diffuse and the output
// random. Every mode instead hands the model a *focused lane* — a small, related
// cluster of seeds plus an explicit musical thesis — so results are coherent.

import type { ProviderType } from '@/lib/llm';
import { generateLLMJson } from '@/lib/llm';
import { prisma } from '@/lib/prisma';
import { rankSeeds, normalizeArtistName, type TasteFocus, type SeedArtist } from '@/lib/artistScore';
import {
  DISCOVERY_MODES,
  DISCOVERY_MODE_DEFAULT,
  isDiscoveryMode,
  discoveryModeDef,
  type DiscoveryMode,
  type DiscoveryModeDef,
} from '@/lib/discoveryModes';

export {
  DISCOVERY_MODES,
  DISCOVERY_MODE_DEFAULT,
  isDiscoveryMode,
  discoveryModeDef,
  type DiscoveryMode,
  type DiscoveryModeDef,
};

// ─── Shared constants ────────────────────────────────────────────────────────
// A tight cluster of seeds keeps the model focused; 50 diverse seeds read as
// "recommend anything". Modes that detect a lane use ~15 coherent seeds.
const TIGHT_SEED_LIMIT = 15;
const LANE_CANDIDATE_LIMIT = 40;
const BRANCH_WINDOW_DAYS = 90;
const FRESH_WINDOW_DAYS = 180;
const BRANCH_MIN_PLAYS = 2;
// Keep the FULL baseline in the prompt for the safety net (regressing this
// caused short generations — the model recommended known artists, and the
// server-side filter dropped them). Lane-relevant artists are listed first so
// the model attends to the right names.
const EXCLUSION_LIST_LIMIT = 10000;

// ─── Analysis LLM passes ─────────────────────────────────────────────────────

export interface ArtistGenresMap {
  [artistName: string]: string[];
}

export async function tagArtistsWithGenres(opts: {
  provider: ProviderType;
  apiKey: string;
  model?: string;
  artists: { name: string; weight: number }[];
}): Promise<ArtistGenresMap> {
  const names = opts.artists.map(a => a.name);
  const systemPrompt = `You are a meticulous music librarian. Tag each artist with 1-2 of the most accurate BROAD genres (e.g. "post-punk", "shoegaze", "jazz fusion", "uk garage", "black metal", "ambient", "neo-soul"). Be specific but consistent across similar artists. Never invent artists. Return ONLY a JSON object mapping each artist name exactly as given to an array of genre strings.`;
  const userPrompt = `Tag these ${names.length} artists:\n${names.join('\n')}`;
  const raw = await generateLLMJson({
    provider: opts.provider,
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt,
    userPrompt,
  });
  const map: ArtistGenresMap = {};
  if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw)) {
      const tags = Array.isArray(value)
        ? value.filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
        : [];
      if (tags.length > 0) map[name] = tags;
    }
  }
  return map;
}

export interface BranchTheme {
  id: string;
  label: string;
  description: string;
  artists: string[];
}

export async function analyzeBranchThemes(opts: {
  provider: ProviderType;
  apiKey: string;
  model?: string;
  artists: { name: string; plays: number }[];
}): Promise<BranchTheme[]> {
  const list = opts.artists.map(a => `- ${a.name} (${a.plays} recent plays)`).join('\n');
  const systemPrompt = `You are a music A&R analyst. The user recently added or actively listened to the artists below. Find up to 3 distinct THEMES that connect subsets of them. A theme is a shared lane: similar sound, genre, scene, collaborators, or era. If the artists are wildly diverse, cluster them and give each cluster a theme — never force two unrelated artists together. Every artist should appear in at least one theme. For each theme return: { id: "theme-1", label: a punchy 2-4 word name, description: one sentence on the sound, artists: the names in this theme }. Return ONLY a JSON object: { "themes": [...] }.`;
  const userPrompt = `Recently added / listened artists:\n${list}`;
  const raw = await generateLLMJson({
    provider: opts.provider,
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt,
    userPrompt,
  });
  const themes = Array.isArray(raw?.themes) ? raw.themes : [];
  return themes
    .map((t: any, i: number) => ({
      id: String(t?.id ?? `theme-${i + 1}`),
      label: String(t?.label ?? 'Theme'),
      description: String(t?.description ?? ''),
      artists: Array.isArray(t?.artists) ? t.artists.map((a: any) => String(a)) : [],
    }))
    .filter((t: BranchTheme) => t.label && t.artists.length > 0);
}

// ─── Data helpers (Prisma-backed) ─────────────────────────────────────────────

// Artists with N+ plays inside a recency window, ranked by recent play count.
export async function getRecentPlayCounts(
  userId: string,
  days: number,
  minPlays: number,
): Promise<Map<string, number>> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const groups = await prisma.streamingHistory.groupBy({
    by: ['artistName'],
    where: { userId, playedAt: { gte: cutoff } },
    _count: { _all: true },
  });
  const map = new Map<string, number>();
  for (const g of groups) {
    const count = g._count._all;
    if (count >= minPlays) map.set(g.artistName, count);
  }
  return map;
}

// Artists whose known-artist row was created recently (genuinely new to the
// library even with little recent play activity).
export async function getRecentlyAddedArtistNames(userId: string, days: number): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.knownArtist.findMany({
    where: { userId, addedAt: { gte: cutoff } },
    select: { artistName: true },
  });
  return new Set(rows.map(r => r.artistName));
}

// ─── Lane / seed helpers ─────────────────────────────────────────────────────

function tagLookup(tagged: ArtistGenresMap): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [name, tags] of Object.entries(tagged)) {
    map.set(normalizeArtistName(name), tags);
  }
  return map;
}

function artistTags(name: string, lookup: Map<string, string[]>): string[] {
  return lookup.get(normalizeArtistName(name)) ?? [];
}

// Pool artists whose tags intersect the lane (case-insensitive).
function filterByLane(pool: SeedArtist[], tagged: ArtistGenresMap, laneGenres: string[]): SeedArtist[] {
  if (laneGenres.length === 0) return pool;
  const lane = new Set(laneGenres.map(g => g.toLowerCase()));
  const lookup = tagLookup(tagged);
  return pool.filter(a => artistTags(a.artistName, lookup).some(t => lane.has(t.toLowerCase())));
}

async function detectLane(
  candidates: { name: string; weight: number }[],
  provider: ProviderType,
  apiKey: string,
  model: string | undefined,
): Promise<{ tagged: ArtistGenresMap; laneGenres: string[] }> {
  const tagged = await tagArtistsWithGenres({ provider, apiKey, model, artists: candidates });
  const genreScore = new Map<string, number>();
  for (const c of candidates) {
    const tags = tagged[c.name] ?? [];
    for (const g of tags) genreScore.set(g, (genreScore.get(g) ?? 0) + c.weight);
  }
  const ranked = [...genreScore.entries()].sort((a, b) => b[1] - a[1]);
  const laneGenres = ranked.slice(0, 3).map(([g]) => g);
  return { tagged, laneGenres };
}

// ─── Mode orchestration ──────────────────────────────────────────────────────

export interface DiscoveryContext {
  mode: DiscoveryMode;
  seeds: { name: string; weight: number }[];
  thesisLines: string[];
  exclusionSample: string[];
  excludedCount: number;
  laneLabel: string;
  laneGenres: string[];
  analysis: {
    tagged: ArtistGenresMap;
    branchThemes?: BranchTheme[];
  };
}

export interface BuildDiscoveryOpts {
  userId: string;
  mode: DiscoveryMode;
  pool: SeedArtist[];
  baseline: SeedArtist[];
  focus: TasteFocus;
  selectedGenres: string[];
  branchTheme?: string;
  rabbitHoleArtist?: string;
  provider: ProviderType;
  apiKey: string;
  model?: string;
}

export async function buildDiscoveryContext(opts: BuildDiscoveryOpts): Promise<DiscoveryContext> {
  const { userId, mode, pool, baseline, focus, selectedGenres, provider, apiKey, model } = opts;
  const def = discoveryModeDef(mode);
  const scoredBaseline = rankSeeds(baseline as any, focus, baseline.length);
  const excludedCount = scoredBaseline.length;

  let seeds: { name: string; weight: number }[] = [];
  let thesisLines: string[] = [];
  let laneLabel = '';
  let laneGenres: string[] = [];
  let tagged: ArtistGenresMap = {};
  let branchThemes: BranchTheme[] | undefined;

  const tighten = (inLane: SeedArtist[]): { name: string; weight: number }[] =>
    rankSeeds((inLane.length >= 5 ? inLane : pool) as any, focus, TIGHT_SEED_LIMIT)
      .map(s => ({ name: s.artistName, weight: s.score }));

  switch (mode) {
    case 'deep-roots': {
      const candidates = rankSeeds(pool as any, focus, LANE_CANDIDATE_LIMIT)
        .map(s => ({ name: s.artistName, weight: s.score }));
      ({ tagged, laneGenres } = await detectLane(candidates, provider, apiKey, model));
      seeds = tighten(filterByLane(pool, tagged, laneGenres));
      laneLabel = laneGenres.join(', ');
      thesisLines = [def.thesis.replace('[LANE]', laneLabel || 'your dominant genres')];
      break;
    }

    case 'fresh-ears': {
      // Weight candidates by recent activity so the detected lane reflects the
      // last ~6 months, not the lifetime average.
      const recent = await getRecentPlayCounts(userId, FRESH_WINDOW_DAYS, 1);
      const candidates = rankSeeds(pool as any, focus, LANE_CANDIDATE_LIMIT)
        .map(s => ({ name: s.artistName, weight: s.score + (recent.get(s.artistName) ?? 0) * 0.5 }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, LANE_CANDIDATE_LIMIT);
      ({ tagged, laneGenres } = await detectLane(candidates, provider, apiKey, model));
      seeds = tighten(filterByLane(pool, tagged, laneGenres));
      laneLabel = laneGenres.join(', ');
      thesisLines = [def.thesis.replace('[LANE]', laneLabel || 'your recent genres')];
      break;
    }

    case 'branch-out': {
      const recentPlays = await getRecentPlayCounts(userId, BRANCH_WINDOW_DAYS, BRANCH_MIN_PLAYS);
      const recentAdded = await getRecentlyAddedArtistNames(userId, BRANCH_WINDOW_DAYS);
      const poolByName = new Map(pool.map(a => [normalizeArtistName(a.artistName), a]));

      const recentSet = new Map<string, number>();
      for (const [name, count] of recentPlays) {
        const canonical = poolByName.get(normalizeArtistName(name))?.artistName ?? name;
        recentSet.set(canonical, Math.max(recentSet.get(canonical) ?? 0, count));
      }
      for (const name of recentAdded) {
        const canonical = poolByName.get(normalizeArtistName(name))?.artistName ?? name;
        recentSet.set(canonical, recentSet.get(canonical) ?? 1);
      }

      const rankedRecent = [...recentSet.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([name, plays]) => ({ name, plays }));

      let anchorNames: string[] = [];
      if (rankedRecent.length > 0) {
        branchThemes = await analyzeBranchThemes({ provider, apiKey, model, artists: rankedRecent });
        const chosen = opts.branchTheme
          ? branchThemes.find(t => t.id === opts.branchTheme)
          : branchThemes[0];
        anchorNames = chosen?.artists?.length
          ? chosen.artists
          : rankedRecent.map(a => a.name);
        thesisLines = [
          def.thesis
            .replace('[ARTISTS]', rankedRecent.slice(0, 8).map(a => a.name).join(', '))
            .replace('[THEME]', chosen ? `"${chosen.label}" — ${chosen.description}` : 'the common thread of your recent additions'),
        ];
      } else {
        thesisLines = [
          'BRANCH OUT — Not enough recent activity was detected (few plays in the last 90 days). Falling back to a normal targeted run.',
        ];
      }

      const anchorKey = new Set(anchorNames.map(normalizeArtistName));
      const anchored = pool.filter(a => anchorKey.has(normalizeArtistName(a.artistName)));
      const fallback = [...recentSet.entries()].map(([name]) => poolByName.get(normalizeArtistName(name))).filter(Boolean) as SeedArtist[];
      const seedPool = anchored.length >= 3 ? anchored : (fallback.length >= 3 ? fallback : pool);
      seeds = tighten(seedPool);
      laneLabel = branchThemes?.[0]?.label ?? 'Recent additions';
      break;
    }

    case 'genre-dive': {
      seeds = tighten(pool);
      laneLabel = selectedGenres.join(', ');
      thesisLines = selectedGenres.length > 0
        ? [def.thesis.replace('[GENRES]', selectedGenres.join(', '))]
        : ['GENRE DIVE — no genres selected: roam freely across the taste profile, but keep the output internally coherent (one strong musical lane, not a grab-bag).'];
      break;
    }

    case 'album-quest': {
      seeds = tighten(pool);
      laneLabel = 'Full albums';
      thesisLines = [def.thesis];
      break;
    }

    case 'rabbit-hole': {
      const anchorName = opts.rabbitHoleArtist?.trim() ?? '';
      const byName = new Map(pool.map(a => [normalizeArtistName(a.artistName), a]));
      const anchor = byName.get(normalizeArtistName(anchorName));
      if (anchorName && !anchor) {
        throw new Error(`"${anchorName}" is not in your known artists. Pick one from the Rabbit Hole list.`);
      }
      seeds = anchor
        ? [{ name: anchor.artistName, weight: anchor.score }]
        : rankSeeds(pool as any, focus, 1).map(s => ({ name: s.artistName, weight: s.score }));
      laneLabel = anchor?.artistName ?? 'Your #1 artist';
      thesisLines = [def.thesis.replace('[ARTIST]', laneLabel)];
      break;
    }
  }

  // Exclusion sample: lane-relevant names first, then the rest — keeps the
  // model's attention on the right names while the full list stays a safety net.
  const lane = new Set(laneGenres.map(g => g.toLowerCase()));
  const lookup = tagLookup(tagged);
  const laneFirst: string[] = [];
  const rest: string[] = [];
  for (const a of scoredBaseline) {
    const inLane = lane.size > 0 && artistTags(a.artistName, lookup).some(t => lane.has(t.toLowerCase()));
    (inLane ? laneFirst : rest).push(a.artistName);
  }
  const exclusionSample = [...laneFirst, ...rest].slice(0, EXCLUSION_LIST_LIMIT);

  return {
    mode,
    seeds,
    thesisLines,
    exclusionSample,
    excludedCount,
    laneLabel,
    laneGenres,
    analysis: { tagged, branchThemes },
  };
}
