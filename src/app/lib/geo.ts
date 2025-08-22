export type TrackPoint = { id: string; ts: number; lat: number; lon: number; alt?: number };
export type Track = { id: string; points: TrackPoint[] };

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371; // km
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function dedupeAndSort(points: TrackPoint[]): TrackPoint[] {
  const seen = new Set<string>();
  const out: TrackPoint[] = [];
  for (const p of points) {
    const key = `${p.id}|${p.ts}|${p.lat.toFixed(5)}|${p.lon.toFixed(5)}`;
    if (!seen.has(key) && isFinite(p.lat) && isFinite(p.lon) && isFinite(p.ts)) {
      seen.add(key);
      out.push(p);
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
