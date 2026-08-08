// Pure scoring logic — browser-safe. No Prisma / Node-only imports in here so
// client components (app/page.tsx) can use the constants and helpers directly.
// DB-backed operations live in lib/artistScoreDb.ts.

// ─── Signal weights ──────────────────────────────────────────────────────────
// Only explicitly liked/followed Spotify content drives the pool — simply
// listening is not enough to assert liking. Each source contributes a fixed
// weight per occurrence.
export const SIGNAL_MULTIPLIERS: Record<string, number> = {
  followedArtists: 5,
  savedAlbums: 3,
  likedSongs: 3,
};

// ─── Genre focus ─────────────────────────────────────────────────────────────
// Optional user-selected genres that narrow the discovery prompt. Selecting none
// leaves the model free to roam the user's full taste profile. The model also
// returns genre_tags per recommendation, so the LLM can always label results
// even when no explicit genre focus is set.
export const GENRE_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'rock', label: 'Rock', hint: 'Classic, alternative, indie rock' },
  { key: 'metal', label: 'Metal', hint: 'Heavy, extreme, progressive metal' },
  { key: 'electronic', label: 'Electronic', hint: 'House, techno, IDM, synth' },
  { key: 'hiphop', label: 'Hip-hop', hint: 'Rap, trap, boom-bap, experimental' },
  { key: 'jazz', label: 'Jazz', hint: 'Bebop, fusion, modal, free jazz' },
  { key: 'rnb', label: 'R&B / Soul', hint: 'Neo-soul, funk, classic soul' },
  { key: 'folk', label: 'Folk / Acoustic', hint: 'Singer-songwriter, traditional' },
  { key: 'punk', label: 'Punk / Hardcore', hint: 'Punk, post-hardcore, DIY' },
  { key: 'pop', label: 'Pop', hint: 'Art pop, synth-pop, indie pop' },
  { key: 'ambient', label: 'Ambient / Drone', hint: 'Textural, meditative, minimal' },
  { key: 'experimental', label: 'Experimental', hint: 'Avant-garde, noise, outsider' },
  { key: 'world', label: 'World / Global', hint: 'African, Latin, Asian traditions' },
];

export const GENRE_DEFAULT: string[] = [];

export function isGenre(value: string): boolean {
  return GENRE_OPTIONS.some(g => g.key === value);
}

// Freeform genre for Genre Dive — broader than the fixed GENRE_OPTIONS chips
// (auto-suggest returns tags like "post-punk" or "uk garage") but still a
// sane single-tag string.
export function isGenreLike(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= 40 && !/[\n,;]/.test(v);
}

export function parseGenres(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((g): g is string => typeof g === 'string' && isGenreLike(g));
    }
  } catch { /* malformed — treat as empty */ }
  return [];
}

// ─── Signals helpers ─────────────────────────────────────────────────────────

export type SignalMap = Record<string, number>;

export function parseSignals(raw: string | null | undefined): SignalMap {
  if (!raw || raw === '{}') return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const result: SignalMap = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && value > 0) result[key] = value;
      }
      return result;
    }
  } catch { /* malformed — treat as empty */ }
  return {};
}

export function serializeSignals(signals: SignalMap): string {
  const cleaned = Object.fromEntries(
    Object.entries(signals).filter(([, v]) => typeof v === 'number' && v > 0)
  );
  return Object.keys(cleaned).length === 0 ? '{}' : JSON.stringify(cleaned);
}

export function mergeSignalCounts(...maps: (SignalMap | undefined)[]): SignalMap {
  const merged: SignalMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, count] of Object.entries(map)) {
      merged[key] = (merged[key] ?? 0) + count;
    }
  }
  return merged;
}

export function signalsScore(signals: SignalMap): number {
  let score = 0;
  for (const [key, count] of Object.entries(signals)) {
    const mult = SIGNAL_MULTIPLIERS[key] ?? 1;
    score += count * mult;
  }
  return score;
}

// ─── Pool eligibility ────────────────────────────────────────────────────────
// Any of the explicit-likes signals (followed / saved / liked) qualifies an
// artist to steer recommendations and be remembered as known taste. There is
// no play-count floor anymore — provenance IS the qualification.
export function hasStrongSignal(signals: SignalMap | null | undefined): boolean {
  return !!signals && Object.keys(signals).some(key => signals[key] > 0);
}

// Qualified to steer recommendations (seed pool): any explicit-likes signal.
export function isPoolEligible(a: { signals?: string | null }): boolean {
  return hasStrongSignal(parseSignals(a.signals));
}

// Qualified to be remembered as known taste (novelty baseline): any recorded
// signal, or an artist seen in a fetch (lastSeenAt set).
export function isBaselineEligible(a: { signals?: string | null; lastSeenAt?: Date | null }): boolean {
  return Object.keys(parseSignals(a.signals)).length > 0 || !!a.lastSeenAt;
}

// ─── Seed pool ranking ───────────────────────────────────────────────────────
// total score = Σ(signal count × multiplier). Callers must pass pool-eligible
// artists (see isPoolEligible).
export interface SeedArtist {
  id: string;
  artistName: string;
  signals: string;
  lastSeenAt: Date | null;
  score: number;
}

export function rankSeeds(artists: Omit<SeedArtist, 'score'>[], limit: number): SeedArtist[] {
  const scored = artists.map(a => ({ ...a, score: signalsScore(parseSignals(a.signals)) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Normalised comparison key used for the code-side hard exclusion filter.
export function normalizeArtistName(name: string): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
