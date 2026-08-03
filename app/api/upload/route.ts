import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { parseEndsongJson } from '@/lib/spotify';
import { parseLastFmCsv } from '@/lib/lastfm';
import path from 'path';
import fs from 'fs';

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const fileType = formData.get('type') as string; // 'endsong' or 'lastfm_csv'

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const content = await file.text();
    let records: { artistName: string; trackName: string; albumName?: string | null; playedAt: Date }[] = [];

    if (fileType === 'endsong' || file.name.endsWith('.json')) {
      records = parseEndsongJson(content);
    } else if (fileType === 'lastfm_csv' || file.name.endsWith('.csv')) {
      records = parseLastFmCsv(content);
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Use endsong.json or Last.fm CSV.' }, { status: 400 });
    }

    if (records.length === 0) {
      return NextResponse.json({ error: 'No valid records found in file' }, { status: 400 });
    }

    // Save to upload directory
    const uploadDir = path.join('/data/uploads', userId);
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, `${Date.now()}_${file.name}`), content);

    const now = new Date();
    let imported = 0;
    const uniqueArtists = new Set<string>();

    // Batch insert streaming history
    for (const record of records) {
      try {
        await prisma.streamingHistory.create({
          data: {
            userId,
            source: fileType === 'endsong' ? 'spotify' : 'lastfm',
            artistName: record.artistName,
            trackName: record.trackName,
            albumName: record.albumName ?? null,
            playedAt: record.playedAt instanceof Date ? record.playedAt : new Date(record.playedAt),
          },
        });
        uniqueArtists.add(record.artistName.toLowerCase());
        imported++;
      } catch {
        // Skip invalid records
      }
    }

    // Add all artists to KnownArtist exclusion set
    let newArtists = 0;
    for (const artistName of uniqueArtists) {
      const originalName = records.find(r => r.artistName.toLowerCase() === artistName)?.artistName ?? artistName;
      try {
        await prisma.knownArtist.upsert({
          where: { userId_artistName: { userId, artistName: originalName } },
          update: {},
          create: { userId, artistName: originalName, addedAt: now },
        });
        newArtists++;
      } catch {
        // Skip duplicates
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      uniqueArtists: newArtists,
      message: `Imported ${imported} plays from ${newArtists} unique artists`,
    });
  } catch (error: unknown) {
    console.error('Upload error:', error);
    const msg = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
