// Only explicitly liked/followed Spotify content drives the discovery pool.
// Simply listening is not enough to assert liking, so ambient signals (top
// artists/tracks, recently played, playlists) are gone — as are Last.fm and
// file uploads.
export const SPOTIFY_SOURCES = [
  { key: 'followedArtists', label: 'Followed Artists' },
  { key: 'savedAlbums', label: 'Saved Albums' },
  { key: 'likedSongs', label: 'Liked Songs' },
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
