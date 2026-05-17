import { NextRequest, NextResponse } from "next/server";

interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

const cache = new Map<string, GeocodeResult | null>();
let lastRequestAt = 0;

const MIN_GAP_MS = 1000;
const CACHE_LIMIT = 500;

async function nominatimLookup(query: string): Promise<GeocodeResult | null> {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Single-Restaurant-Food-Ordering-System (admin geocode)",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (!rows.length) return null;
    return {
      lat: parseFloat(rows[0].lat),
      lng: parseFloat(rows[0].lon),
      displayName: rows[0].display_name,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "missing q" }, { status: 400 });

  const key = q.toLowerCase();
  if (cache.has(key)) {
    return NextResponse.json({ result: cache.get(key) });
  }

  const result = await nominatimLookup(q);

  if (cache.size >= CACHE_LIMIT) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, result);

  return NextResponse.json({ result });
}
