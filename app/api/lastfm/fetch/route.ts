import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { getDecryptedKey } from '@/lib/keys';
import { applySignalsToArtists } from '@/lib/artistScoreDb';

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
// The Last.fm API caps `limit` at 1000 per page but does NOT cap the total —
// you can page through the whole chart. We import up to MAX_ARTISTS so the
// baseline covers deep library artists while the seed pool still picks the
// top ~50 by score (Last.fm returns artists ranked by scrobbles).
const LASTFM_PAGE_LIMIT = 1000;
const LASTFM_MAX_ARTISTS = 5000;

async function fetchAllTopArtists(username: string, apiKey: string): Promise<{ name: string; playcount: number }[]> {
  const artists: { name: string; playcount: number }[] = [];
  let page = 1;

  while (true) {
    const url = `${LASTFM_BASE}?method=user.gettopartists&user=${encodeURIComponent(username)}&api_key=${apiKey}&format=json&limit=${LASTFM_PAGE_LIMIT}&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Last.fm API error: ${res.status}`);
    const data = await res.json();

    if (data.error) throw new Error(`Last.fm: ${data.message}`);

    const items = data.topartists?.artist ?? [];
    if (items.length === 0) break;

    for (const a of items) {
      artists.push({ name: a.name, playcount: parseInt(a.playcount, 10) || 1 });
    }

    const totalPages = parseInt(data.topartists['@attr']?.totalPages ?? '1', 10);
    if (page >= totalPages || artists.length >= LASTFM_MAX_ARTISTS) break;
    page++;
  }

  return artists;
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { username } = await req.json();
    if (!username?.trim()) {
      return NextResponse.json({ error: 'Username required' }, { status: 400 });
    }

    // Retrieve per-user saved Last.fm API Key, falling back to process.env if available
    const userApiKey = await getDecryptedKey(userId, 'lastfm_api_key');
    const apiKey = userApiKey || process.env.LASTFM_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        error: 'Last.fm API Key is required. Please save your Last.fm API key above first.',
      }, { status: 400 });
    }

    const artists = await fetchAllTopArtists(username.trim(), apiKey);
    if (artists.length === 0) {
      return NextResponse.json({ error: 'No artists found for this username' }, { status: 404 });
    }

    const now = new Date();

    // Save username to settings
    await prisma.settings.upsert({
      where: { userId },
      update: { lastFmUsername: username.trim(), updatedAt: now },
      create: {
        userId,
        lastFmUsername: username.trim(),
        obscurityLevel: 3,
        outputFormat: 'tracks',
        recommendationLimit: 20,
        requestsPerMinute: 5,
        scheduleMode: 'manual',
        createdAt: now,
        updatedAt: now,
      },
    });

    // Record every artist as a strong "lastfmTop" signal in the scored pool.
    // No synthetic StreamingHistory rows are created — that history is what
    // the scoring pipeline uses for real plays, so top-artist imports must not
    // pollute it.
    const artistSignals = new Map<string, Record<string, number>>();
    for (const artist of artists) {
      artistSignals.set(artist.name, { lastfmTop: (artistSignals.get(artist.name)?.lastfmTop ?? 0) + 1 });
    }
    const touched = await applySignalsToArtists(userId, artistSignals, now);
    const totalKnown = await prisma.knownArtist.count({ where: { userId } });

    return NextResponse.json({
      success: true,
      username: username.trim(),
      artistCount: touched,
      totalKnownArtists: totalKnown,
      message: `Imported ${touched} artists from Last.fm into the recommendation pool`,
    });
  } catch (error: unknown) {
    console.error('Last.fm fetch error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to fetch Last.fm data';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
