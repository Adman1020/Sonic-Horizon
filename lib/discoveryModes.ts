// Browser-safe discovery mode metadata — no Prisma / Node-only imports in here
// so client components (app/page.tsx) can render the mode cards + info modal
// directly. The server-side orchestration lives in lib/discovery.ts.

export type DiscoveryMode =
  | 'deep-roots'
  | 'fresh-ears'
  | 'branch-out'
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
// (lib/discovery.ts substitutes [LANE] / [GENRES] / [ARTIST] / [THEME]).
export const DISCOVERY_MODES: DiscoveryModeDef[] = [
  {
    key: 'deep-roots',
    label: 'Deep Roots',
    tagline: 'All-time taste lane',
    icon: '🌳',
    logic: 'Tags your most-played artists, finds the 2–4 genres that have actually dominated your lifetime listening, and restricts the seed pool to that lane. With 10+ years of history this is your real musical identity — not what you listened to last month.',
    thesis: 'DEEP ROOTS — All-time taste lane. Your lifetime listening is anchored in [LANE]. Recommend artists deeper in those traditions: canonical figures and critically acclaimed albums you may have missed, overlooked contemporaries, and scene-adjacent cult acts.',
    bestFor: 'Users who want depth, not breadth — go deeper into the genres that defined them, across the full arc of their listening life.',
  },
  {
    key: 'fresh-ears',
    label: 'Fresh Ears',
    tagline: 'Recent-genre lane',
    icon: '🎧',
    logic: 'Same genre analysis, but over the last ~6 months of plays. Your current ear wins over lifetime stats — so a recent techno kick produces techno-adjacent finds even if your lifetime history says indie rock. Stops a 10-year backlog from drowning what you are into right now.',
    thesis: 'FRESH EARS — Current listening lane. Over the last ~6 months your listening has centred on [LANE]. Recommend artists that fit what you are listening to NOW: adjacent acts, newer voices, and recent releases in that lane.',
    bestFor: 'Users whose taste drifts over time and want to feed the current phase of listening, not the average of ten years.',
  },
  {
    key: 'branch-out',
    label: 'Branch Out',
    tagline: 'Recently added artists',
    icon: '🌿',
    logic: 'Seeds from artists you have added or actively listened to in the last ~90 days. Because that set can span wildly different styles, an analysis pass first clusters your recent additions into 2–3 themes; you pick the theme to anchor on, so the output follows one coherent lane instead of a jumble of genres.',
    thesis: 'BRANCH OUT — Recent discoveries. You recently added [ARTISTS]. Anchor on the theme: [THEME]. Recommend artists that share that scene, sound, collaborators, or label — people you clearly have not found yet.',
    bestFor: 'Active collectors who just got into new music and want more of that specific new lane — without dragging in the rest of their back-catalogue.',
  },
  {
    key: 'genre-dive',
    label: 'Genre Dive',
    tagline: 'Explicit genre picker',
    icon: '🎯',
    logic: 'You pick the genres directly (or auto-suggest them from your history, or type your own). The seed pool stays your top-scored artists, but the model is strictly constrained to stay within or adjacent to your chosen genres. Capped at 4 genres — a longer list makes the model diffuse and the output random again. The most direct, user-controlled mode.',
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
