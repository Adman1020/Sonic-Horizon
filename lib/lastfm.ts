// Last.fm Ingestion Service
export function parseLastFmCsv(csvContent: string) {
  // Simple CSV parser for Last.fm exports
  const lines = csvContent.split('\n');
  const headers = lines[0].toLowerCase().split(',');
  
  const artistIdx = headers.findIndex(h => h.includes('artist'));
  const trackIdx = headers.findIndex(h => h.includes('track'));
  const albumIdx = headers.findIndex(h => h.includes('album'));
  const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('time'));

  if (artistIdx === -1 || trackIdx === -1) {
    throw new Error('Invalid CSV format: Missing artist or track columns');
  }

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    // Basic CSV splitting (does not handle quoted commas robustly in this simple version)
    // A robust implementation would use a library like csv-parse
    const cols = lines[i].split(',');
    
    if (cols[artistIdx] && cols[trackIdx]) {
      results.push({
        artistName: cols[artistIdx].replace(/["']/g, '').trim(),
        trackName: cols[trackIdx].replace(/["']/g, '').trim(),
        albumName: albumIdx !== -1 && cols[albumIdx] ? cols[albumIdx].replace(/["']/g, '').trim() : null,
        playedAt: dateIdx !== -1 && cols[dateIdx] ? new Date(cols[dateIdx].replace(/["']/g, '').trim()) : new Date(),
      });
    }
  }
  
  return results;
}
