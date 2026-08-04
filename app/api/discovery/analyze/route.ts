import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { getDecryptedKey } from '@/lib/keys';
import type { ProviderType } from '@/lib/llm';
import { isTasteFocus, TASTE_FOCUS_DEFAULT, isPoolEligible, rankSeeds, type TasteFocus } from '@/lib/artistScore';
import {
  getRecentPlayCounts,
  getRecentlyAddedArtistNames,
  analyzeBranchThemes,
  tagArtistsWithGenres,
} from '@/lib/discovery';

const BRANCH_WINDOW_DAYS = 90;
const BRANCH_MIN_PLAYS = 2;
const LANE_CANDIDATE_LIMIT = 40;

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { provider, model, kind } = await req.json();
    if (!provider) return NextResponse.json({ error: 'Provider required' }, { status: 400 });
    if (!['branch-themes', 'genre-suggest'].includes(kind)) {
      return NextResponse.json({ error: 'Unknown analysis kind' }, { status: 400 });
    }

    const apiKey = await getDecryptedKey(userId, provider);
    if (!apiKey) {
      return NextResponse.json({ error: `No saved API key for ${provider}. Please add one in Step 2.` }, { status: 400 });
    }

    if (kind === 'branch-themes') {
      const recentPlays = await getRecentPlayCounts(userId, BRANCH_WINDOW_DAYS, BRANCH_MIN_PLAYS);
      const recentAdded = await getRecentlyAddedArtistNames(userId, BRANCH_WINDOW_DAYS);

      const recentSet = new Map<string, number>();
      for (const [name, count] of recentPlays) recentSet.set(name, count);
      for (const name of recentAdded) recentSet.set(name, recentSet.get(name) ?? 1);

      const rankedRecent = [...recentSet.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([name, plays]) => ({ name, plays }));

      if (rankedRecent.length === 0) {
        return NextResponse.json({
          themes: [],
          artists: [],
          message: 'Not enough recent activity (last 90 days) to analyse. Listen to or add some music first, or pick another mode.',
        });
      }

      const themes = await analyzeBranchThemes({ provider, apiKey, model, artists: rankedRecent });
      return NextResponse.json({
        themes,
        artists: rankedRecent.map(a => a.name),
        message: themes.length
          ? `Found ${themes.length} themes across your ${rankedRecent.length} recent additions.`
          : 'Could not cluster your recent additions into themes. Pick a theme below, or use another mode.',
      });
    }

    // kind === 'genre-suggest' — tag top artists and aggregate their genres.
    const settings = await prisma.settings.findUnique({ where: { userId } });
    const focus: TasteFocus = isTasteFocus(settings?.tasteFocus ?? '')
      ? (settings!.tasteFocus as TasteFocus)
      : TASTE_FOCUS_DEFAULT;

    const allArtists = await prisma.knownArtist.findMany({
      where: { userId },
      select: { id: true, artistName: true, playCount: true, historyScore: true, signals: true, lastSeenAt: true },
    });
    const poolArtists = allArtists.filter(isPoolEligible);
    if (poolArtists.length === 0) {
      return NextResponse.json({ genres: [], message: 'No qualifying artists yet — connect a source first.' });
    }

    const candidates = rankSeeds(poolArtists as any, focus, LANE_CANDIDATE_LIMIT)
      .map(s => ({ name: s.artistName, weight: s.score }));
    const tagged = await tagArtistsWithGenres({ provider, apiKey, model, artists: candidates });

    const genreScore = new Map<string, number>();
    for (const c of candidates) {
      for (const g of tagged[c.name] ?? []) {
        genreScore.set(g, (genreScore.get(g) ?? 0) + c.weight);
      }
    }
    const genres = [...genreScore.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4) // keep the lane tight — matches the UI cap (page.tsx MAX_GENRES)
      .map(([genre]) => genre);

    return NextResponse.json({
      genres,
      artists: candidates.map(a => a.name),
      message: genres.length ? `Your top genres: ${genres.join(', ')}.` : 'Could not detect genres yet.',
    });
  } catch (error: unknown) {
    console.error('Discovery analysis error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Analysis failed' }, { status: 500 });
  }
}
