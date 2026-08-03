import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { parseEndsongJson, type ImportRecord } from '@/lib/spotify';
import { parseLastFmCsv } from '@/lib/lastfm';
import { recomputeHistoryForArtists } from '@/lib/artistScoreDb';
import path from 'path';
import fs from 'fs';

const MAX_FILES = 100;
const MAX_FILE_BYTES = 250 * 1024 * 1024;
const INSERT_CHUNK = 500;

function parseContent(content: string, fileName: string, fileType: string): ImportRecord[] {
  if (fileType === 'endsong' || fileName.endsWith('.json')) {
    return parseEndsongJson(content);
  }
  if (fileType === 'lastfm_csv' || fileName.endsWith('.csv')) {
    return parseLastFmCsv(content);
  }
  throw new Error(`Unsupported file type for "${fileName}". Use endsong_*.json or a Last.fm CSV.`);
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await req.formData();
    const entries = formData.getAll('files') as File[];
    const single = formData.get('file');
    const files = entries.length > 0 ? entries : (single ? [single as File] : []);
    const fileType = (formData.get('type') as string) || '';

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided.' }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Too many files — maximum is ${MAX_FILES}. Select the endsong_*.json files in batches.` }, { status: 400 });
    }
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `"${f.name}" is ${(f.size / 1024 / 1024).toFixed(0)}MB — over the ${MAX_FILE_BYTES / 1024 / 1024}MB per-file limit.` }, { status: 400 });
      }
    }

    const source = fileType === 'endsong' ? 'spotify' : 'lastfm';
    const records: ImportRecord[] = [];
    const skippedFiles: string[] = [];
    // Store uploads next to the database (the appdata folder mounted at
    // /config on Unraid) so everything the app persists lives in one place.
    const dbUrl = process.env.DATABASE_URL ?? 'file:/config/pde.db';
    const dbDir = path.dirname(dbUrl.replace(/^file:/, ''));
    const uploadDir = path.join(dbDir, 'uploads', userId);
    fs.mkdirSync(uploadDir, { recursive: true });

    for (const file of files) {
      try {
        const content = await file.text();
        const parsed = parseContent(content, file.name, fileType);
        if (parsed.length === 0) {
          skippedFiles.push(`${file.name} (no playable records)`);
          continue;
        }
        for (const rec of parsed) records.push(rec);
        fs.writeFileSync(path.join(uploadDir, `${Date.now()}_${file.name}`), content);
      } catch (err: unknown) {
        skippedFiles.push(`${file.name} (${err instanceof Error ? err.message : 'failed to parse'})`);
      }
    }

    if (records.length === 0) {
      return NextResponse.json({
        error: skippedFiles.length > 0
          ? `None of the files could be imported: ${skippedFiles.join('; ')}`
          : 'No valid records found in the selected files.',
      }, { status: 400 });
    }

    // Load existing plays for this user+source so re-uploads are idempotent
    // (dedupe on playedAt + track + artist). groupBy returns distinct combos.
    const existing = new Set<string>();
    const existingRows = await prisma.streamingHistory.groupBy({
      by: ['playedAt', 'artistName', 'trackName'],
      where: { userId, source },
    });
    for (const r of existingRows) {
      existing.add(`${r.playedAt.toISOString()}|${r.artistName}|${r.trackName}`);
    }

    const toInsert: { userId: string; source: string; artistName: string; trackName: string; albumName: string | null; playedAt: Date }[] = [];
    const artists = new Set<string>();
    for (const rec of records) {
      const playedAt = rec.playedAt instanceof Date ? rec.playedAt : new Date(rec.playedAt);
      const key = `${playedAt.toISOString()}|${rec.artistName}|${rec.trackName}`;
      if (existing.has(key)) continue;
      existing.add(key);
      toInsert.push({
        userId,
        source,
        artistName: rec.artistName,
        trackName: rec.trackName,
        albumName: rec.albumName ?? null,
        playedAt,
      });
      artists.add(rec.artistName);
    }

    let imported = 0;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const res = await prisma.streamingHistory.createMany({
        data: toInsert.slice(i, i + INSERT_CHUNK),
      });
      imported += res.count;
    }

    // Re-score every artist touched by this upload from their full real history
    // (log plays × consistency × recency). recomputeHistoryForArtists upserts
    // knownArtist rows, creating any missing ones, so the scored seed pool stays
    // in sync with the exclusion baseline.
    const existingArtists = await prisma.knownArtist.findMany({ where: { userId }, select: { artistName: true } });
    const knownArtists = new Set(existingArtists.map(a => a.artistName));
    const newArtists = [...artists].filter(a => !knownArtists.has(a));
    if (artists.size > 0) {
      await recomputeHistoryForArtists(userId, [...artists]);
    }

    const suffix = skippedFiles.length > 0 ? ` Skipped: ${skippedFiles.join('; ')}` : '';
    return NextResponse.json({
      success: true,
      imported,
      uniqueArtists: newArtists.length,
      files: files.length,
      message: `Imported ${imported} plays from ${newArtists.length} new artists across ${files.length} file(s).${suffix}`,
    });
  } catch (error: unknown) {
    console.error('Upload error:', error);
    const msg = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
