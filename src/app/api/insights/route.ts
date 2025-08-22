// app/api/insights/route.ts
import { NextResponse } from "next/server";
import { haversineKm } from "../../lib/geo";

export const revalidate = 60;

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  return r.json();
}

export async function GET() {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const [balloons, fires] = await Promise.all([
    getJSON<{ tracks: { id: string; points: { lat: number; lon: number; ts: number }[] }[] }>(`${base}/api/balloons`),
    getJSON<{ fires: { lat: number; lon: number }[] }>(`${base}/api/fires`),
  ]);

  const PROX_KM = 100;
  const stats = (balloons.tracks ?? []).map((t) => {
    let minKm = Infinity, minWhen: number | undefined;
    let nearCount = 0;
    for (const p of t.points) {
      for (const f of fires.fires ?? []) {
        const km = haversineKm({ lat: p.lat, lon: p.lon }, { lat: f.lat, lon: f.lon });
        if (km < minKm) { minKm = km; minWhen = p.ts; }
        if (km <= PROX_KM) nearCount++;
      }
    }
    return { id: t.id, closest_km: Math.round(minKm * 10) / 10, near_count: nearCount, closest_ts: minWhen };
  }).sort((a, b) => a.closest_km - b.closest_km);

  return NextResponse.json({ updatedAt: new Date().toISOString(), stats, threshold_km: PROX_KM });
}
