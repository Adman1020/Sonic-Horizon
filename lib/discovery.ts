// Discovery mode logic — server-side. Given a mode and the user's scored artist
// pool, produces the *thesis* (a directive paragraph), a tight coherent seed
// cluster, and a lane-prioritised exclusion sample. All analysis passes (genre
// tagging) go through generateLLMJson so every provider works the same.
//
// The philosophy: with a large artist pool, "here are my top 50 artists, don't
// recommend these 5,000" makes the LLM diffuse and the output random. Every mode
// instead hands the model a *focused lane* — a small, related cluster of seeds
// plus an explicit musical thesis — so results are coherent.

import type { ProviderType } from '@/lib/llm';
import { generateLLMJson } from '@/lib/llm';
import { prisma } from '@/lib/prisma';
import { rankSeeds, normalizeArtistName, type SeedArtist } from '@/lib/artistScore';
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
  };
}

export interface BuildDiscoveryOpts {
  mode: DiscoveryMode;
  pool: SeedArtist[];
  baseline: SeedArtist[];
  selectedGenres: string[];
  rabbitHoleArtist?: string;
  provider: ProviderType;
  apiKey: string;
  model?: string;
}

export async function buildDiscoveryContext(opts: BuildDiscoveryOpts): Promise<DiscoveryContext> {
  const { mode, pool, baseline, selectedGenres, provider, apiKey, model } = opts;
  const def = discoveryModeDef(mode);
  const scoredBaseline = rankSeeds(baseline as any, baseline.length);
  const excludedCount = scoredBaseline.length;

  let seeds: { name: string; weight: number }[] = [];
  let thesisLines: string[] = [];
  let laneLabel = '';
  let laneGenres: string[] = [];
  let tagged: ArtistGenresMap = {};

  const tighten = (inLane: SeedArtist[]): { name: string; weight: number }[] =>
    rankSeeds((inLane.length >= 5 ? inLane : pool) as any, TIGHT_SEED_LIMIT)
      .map(s => ({ name: s.artistName, weight: s.score }));

  switch (mode) {
    case 'deep-roots': {
      const candidates = rankSeeds(pool as any, LANE_CANDIDATE_LIMIT)
        .map(s => ({ name: s.artistName, weight: s.score }));
      ({ tagged, laneGenres } = await detectLane(candidates, provider, apiKey, model));
      seeds = tighten(filterByLane(pool, tagged, laneGenres));
      laneLabel = laneGenres.join(', ');
      thesisLines = [def.thesis.replace('[LANE]', laneLabel || 'your dominant genres')];
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
        : rankSeeds(pool as any, 1).map(s => ({ name: s.artistName, weight: s.score }));
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
    analysis: { tagged },
  };
}
