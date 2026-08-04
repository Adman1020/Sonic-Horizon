// Pure scoring logic — browser-safe. No Prisma / Node-only imports in here so
// client components (app/page.tsx) can use the constants and helpers directly.
// DB-backed operations live in lib/artistScoreDb.ts.

// ─── Signal weights ──────────────────────────────────────────────────────────
// Spotify API sources contribute a fixed weight per occurrence. History
// (uploaded files / Last.fm scrobbles) is scored separately with
// log(1+plays) × consistency × recency (see computeHistoryScore).
export const SIGNAL_MULTIPLIERS: Record<string, number> = {
  topArtistsShort: 4,
  topArtistsMedium: 3,
  topArtistsLong: 2,
  topTracks: 2,
  followedArtists: 5,
  savedAlbums: 3,
  likedSongs: 3,
  playlists: 2,
  recentTracks: 2,
  lastfmTop: 3,
};

// ─── Taste focus ─────────────────────────────────────────────────────────────
// A single user-facing skew control. "Automatic" uses every signal evenly; the
// other modes multiply one family of signals so that family dominates the seed
// pool for the next generation. The same underlying data is always used — only
// the weights change.
export type TasteFocus = 'automatic' | 'followed' | 'saved' | 'recent';

export const TASTE_FOCUS_OPTIONS: { key: TasteFocus; label: string; hint: string }[] = [
  { key: 'automatic', label: 'Automatic (balanced)', hint: 'Blend every signal evenly.' },
  { key: 'followed', label: 'Followed artists', hint: 'Bias towards artists you follow.' },
  { key: 'saved', label: 'Saved & liked', hint: 'Bias towards saved albums and liked songs.' },
  { key: 'recent', label: 'Recent listening', hint: 'Bias towards recently played artists.' },
];

export const TASTE_FOCUS_DEFAULT: TasteFocus = 'automatic';

const TASTE_FOCUS_BOOST = 3;

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

export function isTasteFocus(value: string): value is TasteFocus {
  return TASTE_FOCUS_OPTIONS.some(o => o.key === value);
}

export function tasteFocusBoost(signalKey: string, focus: TasteFocus): number {
  if (focus === 'followed') {
    return signalKey === 'followedArtists' || signalKey === 'lastfmTop' ? TASTE_FOCUS_BOOST : 1;
  }
  if (focus === 'saved') {
    return signalKey === 'savedAlbums' || signalKey === 'likedSongs' || signalKey === 'playlists' ? TASTE_FOCUS_BOOST : 1;
  }
  if (focus === 'recent') {
    return signalKey === 'recentTracks' ? TASTE_FOCUS_BOOST : 1;
  }
  return 1;
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

export function signalsScore(signals: SignalMap, focus: TasteFocus): number {
  let score = 0;
  for (const [key, count] of Object.entries(signals)) {
    const mult = SIGNAL_MULTIPLIERS[key] ?? 1;
    score += count * mult * tasteFocusBoost(key, focus);
  }
  return score;
}

// ─── History scoring ─────────────────────────────────────────────────────────
// log(1 + plays) grows sub-linearly so a couple of thousand plays of one artist
// doesn't drown out everything else; consistency (distinct months of listening)
// rewards long-term favourites over binge phases; recency decay means artists
// that haven't been played in years recede naturally.
export function computeHistoryScore(plays: number, months: number, lastSeenAt: Date | null, now: Date): number {
  if (plays <= 0) return 0;
  const logFactor = Math.log(1 + plays);
  const consistency = 1 + 0.25 * Math.min(months, 12);
  let recency = 1;
  if (lastSeenAt && !Number.isNaN(lastSeenAt.getTime())) {
    const monthsSince = Math.max(0, (now.getTime() - lastSeenAt.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
    recency = Math.pow(0.92, monthsSince);
  }
  return Math.round(logFactor * consistency * recency * 10000) / 10000;
}

// ─── Pool eligibility ────────────────────────────────────────────────────────
// Low listen counts are noise: a 1–2 play artist is indistinguishable from a
// skip, a shuffle one-off, or a misclick, so history-only artists below the
// floor are dropped from the seed pool AND the exclusion baseline. Explicit API
// signals (followed / saved / liked / playlists / recent / top) are always
// strong — those are conscious choices, so they qualify regardless of plays.
export const HISTORY_PLAY_FLOOR = 3;

// The legacy "imported" marker means the artist came from a pre-scoring import:
// deliberate (it's real library data, so it must stay in the novelty baseline —
// never recommend what they already know) but unscored (no play/provenance
// detail, so it must never steer the seed pool).
export function hasStrongSignal(signals: SignalMap | null | undefined): boolean {
  return !!signals && Object.entries(signals).some(([key, count]) => key !== 'imported' && count > 0);
}

// Qualified to steer recommendations (seed pool): 3+ real plays, or any strong
// API provenance signal.
export function isPoolEligible(a: { playCount?: number | null; signals?: string | null }): boolean {
  return (a.playCount ?? 0) >= HISTORY_PLAY_FLOOR || hasStrongSignal(parseSignals(a.signals));
}

// Qualified to be remembered as known taste (novelty baseline): 3+ real plays,
// any strong API signal, or legacy import provenance.
export function isBaselineEligible(a: { playCount?: number | null; signals?: string | null }): boolean {
  const signals = parseSignals(a.signals);
  return (a.playCount ?? 0) >= HISTORY_PLAY_FLOOR || Object.keys(signals).length > 0;
}

// ─── Seed pool ranking ───────────────────────────────────────────────────────
// total score = historyScore + Σ(signal count × multiplier × taste-focus boost).
// Callers must pass pool-eligible artists (see isPoolEligible).
export interface SeedArtist {
  id: string;
  artistName: string;
  playCount: number;
  historyScore: number;
  signals: string;
  lastSeenAt: Date | null;
  score: number;
}

export function rankSeeds(artists: SeedArtist[], focus: TasteFocus, limit: number): SeedArtist[] {
  const scored = artists.map(a => {
    const signals = parseSignals(a.signals);
    const sig = signalsScore(signals, focus);
    return { ...a, score: (a.historyScore ?? 0) + sig };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Normalised comparison key used for the code-side hard exclusion filter.
export function normalizeArtistName(name: string): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
