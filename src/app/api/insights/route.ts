// src/app/api/insights/route.ts
import { NextResponse } from "next/server";
import { haversineKm } from "@/lib/geo";

export const revalidate = 60;
export const runtime = "nodejs"; // ensure Node runtime on Vercel

function getBaseUrl(req: Request) {
  // 1) Prefer explicit env if you later set it
  const env = process.env.NEXT_PUBLIC_BASE_URL;
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/+$/, "");
  // 2) Vercel-provided host
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // 3) Fallback to the request origin (works locally)
  return new URL(req.url).origin;
}

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const base = getBaseUrl(req);

  const [balloons, fires] = await Promise.all([
    getJSON<{ tracks: { id: string; points: { lat: number; lon: number; ts: number }[] }[] }>(
      `${base}/api/balloons`
    ),
    getJSON<{ fires: { lat: number; lon: number }[] }>(`${base}/api/fires`),
  ]);

  const PROX_KM = 100;
  const tracks = balloons?.tracks ?? [];
  const firePts = fires?.fires ?? [];

  const stats = tracks
    .map((t) => {
      let minKm = Infinity;
      let minWhen: number | undefined;
      let nearCount = 0;
      for (const p of t.points) {
        for (const f of firePts) {
          const km = haversineKm({ lat: p.lat, lon: p.lon }, { lat: f.lat, lon: f.lon });
          if (km < minKm) {
            minKm = km;
            minWhen = p.ts;
          }
          if (km <= PROX_KM) nearCount++;
        }
      }
      return { id: t.id, closest_km: Math.round(minKm * 10) / 10, near_count: nearCount, closest_ts: minWhen };
    })
    .sort((a, b) => a.closest_km - b.closest_km);

  return NextResponse.json({ updatedAt: new Date().toISOString(), stats, threshold_km: PROX_KM });
}
