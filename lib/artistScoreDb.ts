// Server-only DB operations for the scored artist pool. Kept out of
// lib/artistScore.ts so client components never import Prisma.
import { prisma } from '@/lib/prisma';
import { parseSignals, serializeSignals, mergeSignalCounts, type SignalMap } from '@/lib/artistScore';

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
