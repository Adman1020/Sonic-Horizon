import type { ImportRecord } from '@/lib/spotify';

// Splits one CSV line into fields, honoring double-quoted values (RFC-4180).
// This is required because some Last.fm exports (e.g. ghan.nl) put a comma
// inside the timestamp: "01 Nov 2022, 12:45".
function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols.map(c => c.trim());
}

// Last.fm's official GDPR export only contains MusicBrainz IDs, not
// human-readable artist names, so it cannot be used to build an artist list.
function isOfficialLastFmExport(headers: string[]): boolean {
  const h = headers.map(x => x.toLowerCase());
  return (
    h.includes('utc_time') &&
    (h.includes('artist_msid') || h.includes('track_msid')) &&
    !h.some(x => x === 'artist' || x === 'track')
  );
}

// Parses a scrobble timestamp from any of the date formats the common export
// tools produce: unix seconds/ms, ISO dates, "01 Nov 2022, 12:45", etc.
function parseDateValue(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{9,10}$/.test(s)) {
    const d = new Date(Number(s) * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{13}$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;

  // "YYYY-MM-DD, HH:MM..." (ISO date with a comma instead of "T") — produced
  // by lots.of.tools / benjaminbenben exports that quote their timestamps.
  if (/^\d{4}-\d{2}-\d{2},/.test(s)) {
    const d = new Date(s.replace(', ', 'T'));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[m[2].toLowerCase().slice(0, 3)];
    if (month !== undefined) {
      const d = new Date(
        Date.UTC(Number(m[3]), month, Number(m[1]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0)
      );
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// Parses a Last.fm scrobbles CSV. Supports:
// - Header-based exports (ghan.nl, BadHumanX's tool, ...) with flexible
//   artist/track/album/date column detection.
// - Headerless 4-column exports in artist,album,track,date order
//   (benjaminbenben.com/lastfm-to-csv/, lots.of.tools).
// The official Last.fm GDPR export (msids only, no names) is rejected with a
// helpful message.
export function parseLastFmCsv(csvContent: string): ImportRecord[] {
  const cleaned = csvContent.replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error('The CSV file is empty.');

  const first = splitCsvLine(lines[0]);
  if (isOfficialLastFmExport(first)) {
    throw new Error(
      'This looks like Last.fm\u2019s official data export, which only contains MusicBrainz IDs (no artist names) and can\u2019t be used here. Use lastfm.ghan.nl/export instead \u2014 it gives you a CSV with artist names, no login needed.'
    );
  }

  // A header row contains at least two column-name keywords, or one strong
  // keyword. Keywords must anchor at the START of the value: data values like
  // "Ben Artist 0" contain the word "artist" in the middle and must not be
  // mistaken for a header.
  const strong = /^(artist|track|album|utc|uts|scrobbl|played)/i;
  const weak = /^(artist|track|song|title|album|date|time|scrobbl|played|utc|uts)/i;
  const headerHits = first.filter(h => weak.test(h)).length;
  const strongHits = first.filter(h => strong.test(h)).length;
  const hasHeader = strongHits >= 1 || headerHits >= 2;

  let artistIdx = -1;
  let trackIdx = -1;
  let albumIdx = -1;
  let dateIdx = -1;

  if (hasHeader) {
    for (let i = 0; i < first.length; i++) {
      const h = first[i].toLowerCase();
      if (artistIdx === -1 && /artist/.test(h)) artistIdx = i;
      if (trackIdx === -1 && /^(track|title|song)/.test(h)) trackIdx = i;
      if (albumIdx === -1 && /album/.test(h)) albumIdx = i;
      if (dateIdx === -1 && /(date|time|uts|scrobbl|played|listened|utc)/i.test(h)) dateIdx = i;
    }
    if (artistIdx === -1 || trackIdx === -1) {
      throw new Error('Could not find artist and track columns in this CSV.');
    }
  } else {
    // Headerless export — find the date column by scoring how many sample
    // rows parse as a date, then map the rest in artist,album,track order.
    const sample = lines.slice(0, 50);
    let bestIdx = -1;
    let bestHits = 0;
    for (let c = 0; c < first.length; c++) {
      let hits = 0;
      for (const line of sample) {
        const cols = splitCsvLine(line);
        if (parseDateValue(cols[c] ?? '')) hits++;
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestIdx = c;
      }
    }
    if (bestIdx === -1 || bestHits < 2) {
      throw new Error('Could not detect a date column in this CSV. Make sure it is a Last.fm scrobbles export (e.g. from lastfm.ghan.nl/export).');
    }
    dateIdx = bestIdx;
    const rest = [0, 1, 2, 3].filter(i => i !== dateIdx);
    if (rest.length < 3) {
      throw new Error('Unexpected CSV layout — expected 4 columns (artist, album, track, date).');
    }
    artistIdx = rest[0];
    albumIdx = rest[1];
    trackIdx = rest[2];
  }

  const records: ImportRecord[] = [];
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cols = splitCsvLine(line);
    const artist = cols[artistIdx]?.trim();
    const track = cols[trackIdx]?.trim();
    if (!artist || !track) continue;
    const playedAt = dateIdx !== -1 ? parseDateValue(cols[dateIdx] ?? '') : null;
    if (!playedAt) continue;
    records.push({
      artistName: artist,
      trackName: track,
      albumName: albumIdx !== -1 && cols[albumIdx]?.trim() ? cols[albumIdx].trim() : null,
      playedAt,
    });
  }

  return records;
}
