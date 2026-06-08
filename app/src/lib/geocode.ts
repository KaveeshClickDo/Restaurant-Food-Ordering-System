/**
 * Server-side geocoding helpers.
 *
 * Wraps a single Nominatim (OpenStreetMap) lookup and provides a haversine
 * distance helper + delivery-zone lookup used by the order validator to
 * compute an authoritative delivery fee from the customer's address.
 *
 * - The geocode call is rate-limited (Nominatim asks for ≤ 1 req/sec) and
 *   memoised in-process so we don't re-query the same address twice during
 *   a server's lifetime.
 * - On network error or no result, `geocodeAddress` returns `null`. The
 *   caller decides how to handle that (fall back to a default fee vs reject).
 */
export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

export interface DeliveryZoneShape {
  id: string;
  name: string;
  minRadiusKm: number;
  maxRadiusKm: number;
  fee: number;
  enabled: boolean;
}

const geocodeCache = new Map<string, GeocodeResult | null>();
let lastRequestAt = 0;

const MIN_GAP_MS = 1000;
const CACHE_LIMIT = 500;

/**
 * Forward-geocode an address string via Nominatim. Returns null on any
 * failure (no result, non-OK response, network error). Caller is
 * responsible for deciding the failure semantics.
 */
export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;

  const key = q.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  // Respect Nominatim usage policy: at most one request per second from a
  // single source. We track the last request time across the whole process.
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  let result: GeocodeResult | null = null;
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Single-Restaurant-Food-Ordering-System (server geocode)",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (res.ok) {
      const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (rows.length) {
        result = {
          lat: parseFloat(rows[0].lat),
          lng: parseFloat(rows[0].lon),
          displayName: rows[0].display_name,
        };
      }
    }
  } catch {
    result = null;
  }

  if (geocodeCache.size >= CACHE_LIMIT) {
    const firstKey = geocodeCache.keys().next().value;
    if (firstKey !== undefined) geocodeCache.delete(firstKey);
  }
  geocodeCache.set(key, result);
  return result;
}

/** Great-circle distance between two lat/lng points, in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the smallest enabled zone whose [minRadiusKm, maxRadiusKm] band
 * contains `distKm`. Returns null if no zone matches (out-of-range).
 *
 * Zones are sorted by `maxRadiusKm` so the innermost matching zone wins
 * when an admin has accidentally configured overlapping bands.
 */
export function findZoneForDistance(
  distKm: number,
  zones: DeliveryZoneShape[],
): DeliveryZoneShape | null {
  return (
    zones
      .filter((z) => z.enabled && distKm >= z.minRadiusKm && distKm <= z.maxRadiusKm)
      .sort((a, b) => a.maxRadiusKm - b.maxRadiusKm)[0] ?? null
  );
}

/**
 * High-level helper: given a customer address and the restaurant's
 * coordinates, return the zone fee that should be charged.
 *
 * Returns:
 *   - { kind: "zone",     fee, zone, distKm } — matching enabled zone
 *   - { kind: "outside",  distKm }            — geocoded OK, no zone matched
 *   - { kind: "unknown" }                     — geocode failed (address not
 *                                               found / network error). Caller
 *                                               should fall back to default.
 */
export type ZoneLookup =
  | { kind: "zone"; fee: number; zone: DeliveryZoneShape; distKm: number }
  | { kind: "outside"; distKm: number }
  | { kind: "unknown" };

export async function resolveDeliveryZoneFee(
  address: string,
  restaurantLat: number,
  restaurantLng: number,
  zones: DeliveryZoneShape[],
): Promise<ZoneLookup> {
  if (!Number.isFinite(restaurantLat) || !Number.isFinite(restaurantLng)) {
    return { kind: "unknown" };
  }
  const geo = await geocodeAddress(address);
  if (!geo) return { kind: "unknown" };

  const distKm = haversineKm(restaurantLat, restaurantLng, geo.lat, geo.lng);
  const zone = findZoneForDistance(distKm, zones);
  if (!zone) return { kind: "outside", distKm };
  return { kind: "zone", fee: zone.fee, zone, distKm };
}
