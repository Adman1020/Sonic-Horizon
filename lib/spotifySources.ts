export const SPOTIFY_SOURCES = [
  { key: 'topArtists', label: 'Top Artists' },
  { key: 'topTracks', label: 'Top Tracks' },
  { key: 'followedArtists', label: 'Followed Artists' },
  { key: 'savedAlbums', label: 'Saved Albums' },
  { key: 'likedSongs', label: 'Liked Songs' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'recentTracks', label: 'Recently Played' },
] as const;

export type SpotifySourceKey = (typeof SPOTIFY_SOURCES)[number]['key'];

export const DEFAULT_SPOTIFY_SOURCES: string[] = SPOTIFY_SOURCES.map(s => s.key);

export function parseSpotifySources(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) {
    return DEFAULT_SPOTIFY_SOURCES.filter(key => raw.includes(key));
  }
  if (!raw || raw === 'all') return [...DEFAULT_SPOTIFY_SOURCES];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return DEFAULT_SPOTIFY_SOURCES.filter(key => arr.includes(key));
    }
  } catch {
    /* fall through to defaults */
  }
  return [...DEFAULT_SPOTIFY_SOURCES];
}

export function serializeSpotifySources(keys: string[]): string {
  const valid = DEFAULT_SPOTIFY_SOURCES.filter(key => keys.includes(key));
  return valid.length === DEFAULT_SPOTIFY_SOURCES.length ? 'all' : JSON.stringify(valid);
}
