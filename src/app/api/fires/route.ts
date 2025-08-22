// app/api/fires/route.ts
import { NextResponse } from "next/server";
import Papa from "papaparse";


export const revalidate = 300; // 5 min


async function tryFetch(url: string) {
try {
const r = await fetch(url, { cache: 'no-store' });
if (!r.ok) throw new Error(`HTTP ${r.status}`);
const text = await r.text();
if (!text.trim().length) throw new Error('empty');
return text;
} catch { return null; }
}


export async function GET() {
// Try a few well-known public 24h CSV endpoints (no auth). We stop at the first that works.
const candidates = [
// MODIS 1km NRT, global 24h
'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv',
// VIIRS 375m NRT, global 24h (several product paths exist; try a couple common ones)
'https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs-snpp-nrt/csv/SUOMI_VIIRS_C2_Global_24h.csv',
'https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs-noaa20-nrt/csv/VIIRS_NOAA20_NRT_Global_24h.csv',
];


let csv: string | null = null;
for (const u of candidates) { csv = await tryFetch(u); if (csv) break; }
if (!csv) return NextResponse.json({ fires: [] });


const parsed = Papa.parse(csv, { header: true, dynamicTyping: true });
const fires = (parsed.data as any[])
.map(r => ({
lat: Number(r.latitude ?? r.Latitude ?? r.lat),
lon: Number(r.longitude ?? r.Longitude ?? r.lon),
conf: Number(r.confidence ?? r.confidence_text ?? r.confidence_level ?? r.conf),
frp: r.frp != null ? Number(r.frp) : undefined,
acq: r.acq_date && r.acq_time ? new Date(`${r.acq_date}T${String(r.acq_time).padStart(4,'0').slice(0,2)}:${String(r.acq_time).padStart(4,'0').slice(2)}:00Z`).getTime()/1000 : undefined,
src: r.instrument ?? r.satellite ?? r.source ?? 'FIRMS'
}))
.filter(f => isFinite(f.lat) && isFinite(f.lon));


return NextResponse.json({ updatedAt: new Date().toISOString(), fires });
}