import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { getAIConfig } from '@/lib/keys';
import { isPoolEligible, rankSeeds } from '@/lib/artistScore';
import { tagArtistsWithGenres } from '@/lib/discovery';

const LANE_CANDIDATE_LIMIT = 40;

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { kind } = await req.json();
    if (kind !== 'genre-suggest') {
      return NextResponse.json({ error: 'Unknown analysis kind' }, { status: 400 });
    }

    // The provider/model/key are the admin-configured ones shared by all users.
    const ai = await getAIConfig();
    if (!ai.configured || !ai.provider) {
      return NextResponse.json({ error: 'No AI provider configured. Ask an admin to set one up in the Admin panel.' }, { status: 400 });
    }
    const provider = ai.provider;
    const model = ai.model ?? undefined;
    const apiKey = ai.apiKey ?? '';
    if (provider !== 'Ollama' && !apiKey) {
      return NextResponse.json({ error: `No API key saved for ${provider}. Ask an admin to add one in the Admin panel.` }, { status: 400 });
    }

    // genre-suggest — tag top artists and aggregate their genres.
    const allArtists = await prisma.knownArtist.findMany({
      where: { userId },
      select: { id: true, artistName: true, signals: true, lastSeenAt: true },
    });
    const poolArtists = allArtists.filter(isPoolEligible);
    if (poolArtists.length === 0) {
      return NextResponse.json({ genres: [], message: 'No qualifying artists yet — connect Spotify first.' });
    }

    const candidates = rankSeeds(poolArtists as any, LANE_CANDIDATE_LIMIT)
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
