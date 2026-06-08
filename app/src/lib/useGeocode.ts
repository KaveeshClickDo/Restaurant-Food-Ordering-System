"use client";

import { useEffect, useState } from "react";

export interface Geo {
  lat: number;
  lng: number;
}

const memCache = new Map<string, Geo | null>();
const inflight = new Map<string, Promise<Geo | null>>();

export async function geocode(query: string): Promise<Geo | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (memCache.has(key)) return memCache.get(key) ?? null;
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`, {
        cache: "force-cache",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { result: Geo | null };
      const result = json.result;
      memCache.set(key, result);
      return result;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** Reactive hook — returns lat/lng for an address (null while loading or if not found). */
export function useGeocode(query: string | undefined | null): Geo | null {
  const [geo, setGeo] = useState<Geo | null>(() => {
    if (!query) return null;
    return memCache.get(query.trim().toLowerCase()) ?? null;
  });

  useEffect(() => {
    let cancelled = false;
    if (!query?.trim()) {
      setGeo(null);
      return;
    }
    geocode(query).then((g) => {
      if (!cancelled) setGeo(g);
    });
    return () => { cancelled = true; };
  }, [query]);

  return geo;
}
