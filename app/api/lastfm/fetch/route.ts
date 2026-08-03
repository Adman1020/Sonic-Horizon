import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { getDecryptedKey } from '@/lib/keys';

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

async function fetchAllTopArtists(username: string, apiKey: string): Promise<{ name: string; playcount: number }[]> {
  const artists: { name: string; playcount: number }[] = [];
  let page = 1;
  const limit = 200;

  while (true) {
    const url = `${LASTFM_BASE}?method=user.gettopartists&user=${encodeURIComponent(username)}&api_key=${apiKey}&format=json&limit=${limit}&page=${page}`;
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
    if (page >= totalPages || page >= 5) break; // cap at 1000 artists max
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
        scheduleMode: 'manual',
        createdAt: now,
        updatedAt: now,
      },
    });

    // Upsert all artists into KnownArtist table (the exclusion list)
    let added = 0;
    for (const artist of artists) {
      try {
        await prisma.knownArtist.upsert({
          where: { userId_artistName: { userId, artistName: artist.name } },
          update: {},
          create: { userId, artistName: artist.name, addedAt: now },
        });

        // Also add to StreamingHistory as a synthetic entry for LLM context
        await prisma.streamingHistory.create({
          data: {
            userId,
            source: 'lastfm',
            artistName: artist.name,
            trackName: '[Top Artist]',
            playedAt: now,
          },
        });
        added++;
      } catch {
        // Skip duplicates
      }
    }

    return NextResponse.json({
      success: true,
      username: username.trim(),
      artistCount: added,
      message: `Imported ${added} artists from Last.fm`,
    });
  } catch (error: unknown) {
    console.error('Last.fm fetch error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to fetch Last.fm data';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
