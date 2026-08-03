// Server-only DB operations for the scored artist pool. Kept out of
// lib/artistScore.ts so client components never import Prisma.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseSignals, serializeSignals, mergeSignalCounts, computeHistoryScore, type SignalMap } from '@/lib/artistScore';

interface HistoryAggRow {
  artistName: string;
  plays: bigint | number;
  months: bigint | number;
  lastSeen: Date | string | null;
}

// Recomputes playCount / historyScore / lastSeenAt for the given user's known
// artists from their real streaming history. Synthetic "[Imported Artist]" /
// "[Top Artist]" rows are excluded. Pass artistNames to only refresh a subset
// (e.g. the artists touched by one upload). Returns the number of artists upserted.
export async function recomputeHistoryForArtists(userId: string, artistNames?: string[]): Promise<number> {
  const nameFilter = artistNames && artistNames.length > 0
    ? Prisma.sql`AND "artistName" IN (${Prisma.join(artistNames)})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<HistoryAggRow[]>`
    SELECT "artistName",
           COUNT(*) AS plays,
           COUNT(DISTINCT strftime('%Y-%m', "playedAt")) AS months,
           MAX("playedAt") AS lastSeen
    FROM "StreamingHistory"
    WHERE "userId" = ${userId}
      AND "trackName" NOT IN ('[Imported Artist]', '[Top Artist]')
      ${nameFilter}
    GROUP BY "artistName"
  `;

  const now = new Date();
  let updated = 0;
  for (const row of rows) {
    const plays = Number(row.plays);
    const months = Number(row.months);
    const lastSeen = row.lastSeen ? new Date(row.lastSeen as string) : null;
    const score = computeHistoryScore(plays, months, lastSeen, now);
    await prisma.knownArtist.upsert({
      where: { userId_artistName: { userId, artistName: row.artistName } },
      update: { playCount: plays, historyScore: score, lastSeenAt: lastSeen },
      create: { userId, artistName: row.artistName, playCount: plays, historyScore: score, lastSeenAt: lastSeen, addedAt: now },
    });
    updated++;
  }
  return updated;
}

// Merges explicit API signals (Spotify sources, Last.fm top artists) into each
// artist's stored signals and marks them seen. Used by the Spotify fetch and
// Last.fm top-artists routes. `artistSignals` maps artistName → per-source counts.
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
