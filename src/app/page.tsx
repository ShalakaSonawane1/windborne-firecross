// src/app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

// Client-only react-leaflet components
const MapContainer = dynamic(() => import("react-leaflet").then(m => m.MapContainer), { ssr: false });
const TileLayer     = dynamic(() => import("react-leaflet").then(m => m.TileLayer),     { ssr: false });
const Polyline      = dynamic(() => import("react-leaflet").then(m => m.Polyline),      { ssr: false });
const Tooltip       = dynamic(() => import("react-leaflet").then(m => m.Tooltip),       { ssr: false });
const CircleMarker  = dynamic(() => import("react-leaflet").then(m => m.CircleMarker),  { ssr: false });

type TrackPoint = { ts: number; lat: number; lon: number; alt?: number };
type Track = { id: string; points: TrackPoint[] };
type FirePoint = { lat: number; lon: number; src?: string; conf?: number; frp?: number };
type InsightStat = { id: string; closest_km: number; near_count: number; closest_ts?: number };
type Insights = { threshold_km: number; stats: InsightStat[] };

function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [url]);
  return { data, err };
}

// Haversine distance (km) for hop filtering
function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Split a single track into polyline segments:
// - filter by time cutoff
// - break on anti-meridian crossings (|Δlon| > 180°)
// - break on huge hops (> maxHopKm)
function splitByDatelineAndHops(
  pts: TrackPoint[],
  cutoffTs: number,
  maxHopKm = 1000
): [number, number][][] {
  const filtered = pts.filter(p => p.ts >= cutoffTs);
  if (filtered.length < 2) return [];

  const segs: [number, number][][] = [];
  let cur: [number, number][] = [[filtered[0].lat, filtered[0].lon]];

  for (let i = 1; i < filtered.length; i++) {
    const a = filtered[i - 1];
    const b = filtered[i];

    const crossesDateline = Math.abs(b.lon - a.lon) > 180;
    const hopKm = haversineKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
    const bigHop = hopKm > maxHopKm;

    if (crossesDateline || bigHop) {
      if (cur.length >= 2) segs.push(cur);
      cur = [[b.lat, b.lon]];
    } else {
      cur.push([b.lat, b.lon]);
    }
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

export default function Page() {
  // fetch API data
  const { data: balloons } = useFetch<{ tracks: Track[]; updatedAt: string }>("/api/balloons");
  const { data: fires }    = useFetch<{ fires: FirePoint[]; updatedAt: string }>("/api/fires");
  const { data: insights } = useFetch<Insights>("/api/insights");

  const [hour, setHour] = useState(24);

  // Slider: show last N hours (e.g., 24 => now - 24h)
  const hourCutoffTs = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return now - hour * 3600;
  }, [hour]);

  const tracks  = balloons?.tracks ?? [];
  const firePts = fires?.fires ?? [];

  // Build dateline-safe segments
  const segments = useMemo(() => {
    const out: { id: string; pts: [number, number][] }[] = [];
    for (const t of tracks) {
      const segs = splitByDatelineAndHops(t.points, hourCutoffTs, 800); // 800 km hop cap is stricter
      segs.forEach((seg, idx) => out.push({ id: `${t.id}:${idx}`, pts: seg }));
    }
    return out;
  }, [tracks, hourCutoffTs]);

  return (
    <div className="flex flex-col h-screen">
      <header className="p-4 border-b flex items-center justify-between">
        <h1 className="text-xl font-semibold">FireCross — WindBorne × NASA FIRMS (last 24h)</h1>
        <div className="text-sm opacity-70">Auto-updates every minute • Slider filters to recent hours</div>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-4">
        <div className="md:col-span-3">
          <MapContainer center={[20, 0]} zoom={2} style={{ height: "100%", width: "100%" }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
            {segments.map(seg => (
              <Polyline key={seg.id} positions={seg.pts} pathOptions={{ weight: 2, opacity: 0.75 }}>
                <Tooltip>{seg.id.split(":")[0]}</Tooltip>
              </Polyline>
            ))}
            {firePts.slice(0, 3000).map((f, i) => (
              <CircleMarker key={i} center={[f.lat, f.lon]} radius={3} opacity={0.7}>
                <Tooltip>
                  <div>
                    <div><b>FIRMS</b> {f.src ?? ""}</div>
                    {f.conf != null && <div>confidence: {String(f.conf)}</div>}
                    {f.frp  != null && <div>FRP: {f.frp}</div>}
                  </div>
                </Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>

        <aside className="p-4 space-y-4 border-l">
            <div>
              <label className="text-sm font-medium">Show last hours: {hour}</label>
              <input
                className="w-full"
                type="range"
                min={1}
                max={24}
                value={hour}
                onChange={e => setHour(Number(e.target.value))}
              />
            </div>

            <div className="text-sm">
              <div>Tracks loaded: <b>{tracks.length}</b></div>
              <div>Fires loaded: <b>{firePts.length}</b></div>
            </div>

            <div className="space-y-2">
              <h2 className="font-semibold">Closest approaches (≤ {insights?.threshold_km ?? 100} km)</h2>
              <ul className="text-sm max-h-[40vh] overflow-auto">
                {insights?.stats?.slice(0, 30).map(s => (
                  <li key={s.id} className="py-1 border-b">
                    <div className="font-mono text-xs">{s.id}</div>
                    <div>closest: {s.closest_km} km • near-count: {s.near_count}</div>
                  </li>
                ))}
                {!insights?.stats?.length && <li className="text-xs opacity-70">Loading stats…</li>}
              </ul>
            </div>

            <div className="text-xs opacity-70">
              Data: WindBorne treasure 00..23.json &amp; NASA FIRMS 24h CSV.<br />
              Built with Next.js + Leaflet.
            </div>
        </aside>
      </div>
    </div>
  );
}
