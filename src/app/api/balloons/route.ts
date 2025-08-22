import { NextResponse } from "next/server";
import { safeParseJSON } from "../../lib/safe-json";
import { TrackPoint, dedupeAndSort, haversineKm } from "../../lib/geo";

export const revalidate = 60;

async function fetchText(url: string, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

function toEpochSecondsFromHourIdx(hourIdx: number) {
  return Math.floor(Date.now() / 1000) - hourIdx * 3600;
}

function toEpochSeconds(x: unknown): number | null {
  if (x == null) return null;
  if (typeof x === "number") return x > 1e11 ? Math.round(x / 1000) : Math.round(x);
  if (typeof x === "string") {
    const n = Number(x);
    if (!Number.isNaN(n)) return toEpochSeconds(n);
    const d = Date.parse(x);
    if (!Number.isNaN(d)) return Math.round(d / 1000);
  }
  return null;
}

/** Extract points from lots of possible formats */
function extractHourPoints(payload: any, hourIdx: number): Omit<TrackPoint, "id">[] {
  const ts = toEpochSecondsFromHourIdx(hourIdx);
  const out: Omit<TrackPoint, "id">[] = [];

  // Case A: array of [lat, lon, alt?]
  if (Array.isArray(payload) && payload.length && Array.isArray(payload[0])) {
    for (const row of payload as any[]) {
      if (Array.isArray(row) && row.length >= 2) {
        const lat = Number(row[0]);
        const lon = Number(row[1]);
        const alt = row.length >= 3 ? Number(row[2]) : undefined;
        if (isFinite(lat) && isFinite(lon)) out.push({ ts, lat, lon, alt });
      }
    }
    return out;
  }

  // Case B: array of objects (no ids/timestamps)
  if (Array.isArray(payload) && payload.length && typeof payload[0] === "object") {
    for (const obj of payload) {
      const lat = obj.lat ?? obj.latitude ?? obj.y ?? obj.Lat ?? obj.Y;
      const lon = obj.lon ?? obj.lng ?? obj.longitude ?? obj.x ?? obj.Lon ?? obj.X;
      const alt = obj.alt ?? obj.altitude ?? obj.Alt;
      if (lat != null && lon != null) {
        const latN = Number(lat), lonN = Number(lon);
        if (isFinite(latN) && isFinite(lonN)) out.push({ ts, lat: latN, lon: lonN, alt: alt != null ? Number(alt) : undefined });
      }
    }
    return out;
  }

  // Case C: nested junk → walk and try to find lat/lon/time
  const pushIfValid = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    const lat = obj.lat ?? obj.latitude ?? obj.Lat ?? obj.y ?? obj.Y;
    const lon = obj.lon ?? obj.lng ?? obj.long ?? obj.longitude ?? obj.Lon ?? obj.x ?? obj.X;
    const alt = obj.alt ?? obj.altitude ?? obj.Alt;
    const tsRaw = obj.ts ?? obj.time ?? obj.timestamp ?? obj.t ?? obj.epoch ?? obj.updated_at ?? obj.date;
    const t = toEpochSeconds(tsRaw) ?? ts;
    if (lat != null && lon != null) {
      const latN = Number(lat), lonN = Number(lon);
      if (isFinite(latN) && isFinite(lonN)) out.push({ ts: t, lat: latN, lon: lonN, alt: alt != null ? Number(alt) : undefined });
    }
  };
  const walk = (node: any) => {
    if (Array.isArray(node)) { for (const it of node) walk(it); return; }
    if (node && typeof node === "object") {
      pushIfValid(node);
      for (const v of Object.values(node)) walk(v);
    }
  };
  walk(payload);
  return out;
}

/** Link hourly snapshots into tracks by nearest-neighbor across hours */
function linkTracks(hourly: Omit<TrackPoint, "id">[][]): { id: string; points: TrackPoint[] }[] {
  // max plausible drift per hour (stratospheric): tighten to ~200 km/h
  const MAX_LINK_KM_PER_H = 200;
  let nextId = 1;
  const tracks: { id: string; points: TrackPoint[] }[] = [];

  // oldest → newest (hour 23 ago down to 0 = now)
  for (let h = hourly.length - 1; h >= 0; h--) {
    const pts = hourly[h];
    if (!pts.length) continue;

    if (tracks.length === 0) {
      for (const p of pts) {
        const id = `T${nextId++}`;
        tracks.push({ id, points: [{ ...p, id }] });
      }
      continue;
    }

    const usedTrack = new Set<string>();
    const usedPoint = new Set<number>();

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];

      let bestIdx = -1;
      let bestKm = Infinity;

      for (let t = 0; t < tracks.length; t++) {
        const tr = tracks[t];
        if (usedTrack.has(tr.id)) continue;

        const last = tr.points[tr.points.length - 1];

        // must be roughly one hour newer (±30 min)
        const dt = p.ts - last.ts;
        if (dt < 1800 || dt > 5400) continue;

        const km = haversineKm({ lat: last.lat, lon: last.lon }, { lat: p.lat, lon: p.lon });

        // scale allowed distance by actual dt fraction
        const hours = dt / 3600;
        const allowed = MAX_LINK_KM_PER_H * hours;
        if (km > allowed) continue;

        if (km < bestKm) {
          bestKm = km;
          bestIdx = t;
        }
      }

      if (bestIdx >= 0) {
        const tr = tracks[bestIdx];
        tr.points.push({ ...p, id: tr.id });
        usedTrack.add(tr.id);
        usedPoint.add(i);
      }
    }

    // leftover points start new tracks
    for (let i = 0; i < pts.length; i++) {
      if (usedPoint.has(i)) continue;
      const id = `T${nextId++}`;
      tracks.push({ id, points: [{ ...pts[i], id }] });
    }
  }

  for (const tr of tracks) tr.points = dedupeAndSort(tr.points);
  return tracks.filter((t) => t.points.length >= 2);
}


export async function GET() {
  const base = "https://a.windbornesystems.com/treasure";
  const tasks = Array.from({ length: 24 }, (_, i) => {
    const hh = String(i).padStart(2, "0");
    const url = `${base}/${hh}.json`;
    return fetchText(url).then(txt => safeParseJSON<any>(txt)).catch(() => null);
  });

  const results = await Promise.allSettled(tasks);

  // Collect per-hour point lists
  const hourly: Omit<TrackPoint, "id">[][] = [];
  results.forEach((r, idx) => {
    if (r.status === "fulfilled" && r.value) {
      try { hourly[idx] = extractHourPoints(r.value, idx); } catch { hourly[idx] = []; }
    } else {
      hourly[idx] = [];
    }
  });

  const tracks = linkTracks(hourly);
  return NextResponse.json({ updatedAt: new Date().toISOString(), tracks });
}
