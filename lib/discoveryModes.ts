// Browser-safe discovery mode metadata — no Prisma / Node-only imports in here
// so client components (app/page.tsx) can render the mode cards + info modal
// directly. The server-side orchestration lives in lib/discovery.ts.

export type DiscoveryMode =
  | 'deep-roots'
  | 'genre-dive'
  | 'album-quest'
  | 'rabbit-hole';

export interface DiscoveryModeDef {
  key: DiscoveryMode;
  label: string;
  tagline: string;
  icon: string;
  logic: string;
  thesis: string;
  bestFor: string;
}

// Single source of truth for the UI (cards + info modal) AND the prompt text
// (lib/discovery.ts substitutes [LANE] / [GENRES] / [ARTIST]).
export const DISCOVERY_MODES: DiscoveryModeDef[] = [
  {
    key: 'deep-roots',
    label: 'Deep Roots',
    tagline: 'All-time taste lane',
    icon: '🌳',
    logic: 'Tags the artists you like, save, or follow most, finds the 2–4 genres that have actually dominated your taste, and restricts the seed pool to that lane. Your real musical identity — built from your full artist pool, not just what you added recently.',
    thesis: 'DEEP ROOTS — All-time taste lane. Your whole liked, saved, and followed history is anchored in [LANE]. Recommend artists deeper in those traditions: canonical figures and critically acclaimed albums you may have missed, overlooked contemporaries, and scene-adjacent cult acts.',
    bestFor: 'Users who want depth, not breadth — go deeper into the genres that defined them, across the full arc of their taste.',
  },
  {
    key: 'genre-dive',
    label: 'Genre Dive',
    tagline: 'Explicit genre picker',
    icon: '🎯',
    logic: 'You pick the genres directly (or auto-suggest them from your artist pool, or type your own). The seed pool stays your top-scored artists, but the model is strictly constrained to stay within or adjacent to your chosen genres. Capped at 4 genres — a longer list makes the model diffuse and the output random again. The most direct, user-controlled mode.',
    thesis: 'GENRE DIVE — User-selected genres: [GENRES]. Every recommendation must fit at least one of these genre buckets or sit directly adjacent to them.',
    bestFor: 'Users who know exactly what lane they want to explore and just want more of it.',
  },
  {
    key: 'album-quest',
    label: 'Album Quest',
    tagline: 'Long-form albums only',
    icon: '💿',
    logic: 'Same targeted seed logic as a normal run, but the model is asked for cohesive full albums instead of tracks, and every result is album-verified on Spotify (with a real-song fallback when a title is hallucinated). For listening in one sitting.',
    thesis: 'ALBUM QUEST — Long-form listening. Recommend full albums only: cohesive, album-length listening experiences with a strong track ordering — not singles or compilations.',
    bestFor: 'Users who want to press play and hear a whole record, not a shuffled list of singles.',
  },
  {
    key: 'rabbit-hole',
    label: 'Rabbit Hole',
    tagline: 'One artist, deep',
    icon: '🕳️',
    logic: 'You pick a single seed artist from your known artists (or "surprise me" with your #1). The model maps that artist\'s family tree — influences, collaborators, shared labels and scenes, contemporaries, and modern carriers of the sound — and every pick must sit naturally on a playlist next to them. The most cohesive, curated output.',
    thesis: 'RABBIT HOLE — Anchored on [ARTIST]. Map their musical family tree: who influenced them, who they collaborated with, who shares their label/scene, and who carries their sound today. Recommend from within that web — every pick should plausibly sit on a playlist next to [ARTIST].',
    bestFor: 'Users who love one artist or band and want the entire ecosystem around it, in one sitting.',
  },
];

export const DISCOVERY_MODE_DEFAULT: DiscoveryMode = 'deep-roots';

export function isDiscoveryMode(value: string): value is DiscoveryMode {
  return DISCOVERY_MODES.some(m => m.key === value);
}

export function discoveryModeDef(mode: DiscoveryMode): DiscoveryModeDef {
  return DISCOVERY_MODES.find(m => m.key === mode) ?? DISCOVERY_MODES[0];
}
