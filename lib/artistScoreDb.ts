// Server-only DB operations for the scored artist pool. Kept out of
// lib/artistScore.ts so client components never import Prisma.
import { prisma } from '@/lib/prisma';
import { parseSignals, serializeSignals, mergeSignalCounts, type SignalMap } from '@/lib/artistScore';

// How long a recently-played stamp remains a live exclusion signal. Plays older
// than this are pruned on each refresh so lastPlayedAt always means "heard
// within the last window" — no runtime cutoff check in isBaselineEligible.
export const RECENTLY_PLAYED_WINDOW_DAYS = 90;

// Merges explicit-likes API signals (followed / saved / liked) into each
// artist's stored signals and marks them seen. Used by the Spotify fetch route.
// `artistSignals` maps artistName → per-source counts.
export async function applySignalsToArtists(
  userId: string,
  artistSignals: Map<string, SignalMap>,
  now: Date = new Date()
): Promise<number> {
  if (artistSignals.size === 0) return 0;

  const names = Array.from(artistSignals.keys());
  const existing = await prisma.knownArtist.findMany({
    where: { userId, artistName: { in: names } },
    select: { artistName: true, signals: true },
  });
  const existingMap = new Map(existing.map(a => [a.artistName, a.signals]));

  let touched = 0;
  for (const name of names) {
    const merged = mergeSignalCounts(parseSignals(existingMap.get(name)), artistSignals.get(name));
    const signals = serializeSignals(merged);
    await prisma.knownArtist.upsert({
      where: { userId_artistName: { userId, artistName: name } },
      update: { signals, lastSeenAt: now },
      create: { userId, artistName: name, signals, lastSeenAt: now, addedAt: now },
    });
    touched++;
  }
  return touched;
}

// Records recently-played listen timestamps as an EXCLUSION-ONLY signal —
// artists heard recently get lastPlayedAt set so isBaselineEligible excludes
// them from recommendations, but they never become seeds (isPoolEligible only
// checks explicit-likes signals). After upserting, prunes any lastPlayedAt
// older than RECENTLY_PLAYED_WINDOW_DAYS so the column stays meaningful.
// `artistPlayedAt` maps artistName → most recent played_at Date.
export async function applyRecentlyPlayedArtists(
  userId: string,
  artistPlayedAt: Map<string, Date>,
  now: Date = new Date(),
): Promise<number> {
  if (artistPlayedAt.size === 0) {
    // Still prune, so a user who stopped listening clears stale stamps.
    await pruneRecentlyPlayed(userId, now);
    return 0;
  }

  let upserted = 0;
  for (const [name, playedAt] of artistPlayedAt) {
    // The caller pre-aggregates the most recent played_at per artist, so a
    // plain set is safe — no risk of an older page clobbering a newer stamp.
    await prisma.knownArtist.upsert({
      where: { userId_artistName: { userId, artistName: name } },
      update: { lastPlayedAt: playedAt },
      create: { userId, artistName: name, addedAt: now, lastPlayedAt: playedAt },
    });
    upserted++;
  }

  await pruneRecentlyPlayed(userId, now);
  return upserted;
}

// Nulls lastPlayedAt for any stamp older than the window. Keeps the column
// meaning "played recently" without a runtime cutoff in eligibility checks.
export async function pruneRecentlyPlayed(userId: string, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - RECENTLY_PLAYED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  await prisma.knownArtist.updateMany({
    where: { userId, lastPlayedAt: { lt: cutoff } },
    data: { lastPlayedAt: null },
  });
}
