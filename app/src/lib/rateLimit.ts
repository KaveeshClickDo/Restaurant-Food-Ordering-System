/**
 * In-memory sliding-window rate limiter.
 * One shared store per process — adequate for a single-server deployment.
 * Each key maps to a list of timestamps (ms) within the current window.
 *
 * Usage:
 *   const { limited } = rateLimit("login:" + ip, 5, 60_000);
 *   if (limited) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 */

interface Entry {
  timestamps: number[];
}

const store = new Map<string, Entry>();

// Prune stale keys every 5 minutes to prevent unbounded growth.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.timestamps.length === 0 || now - entry.timestamps.at(-1)! > 300_000) {
        store.delete(key);
      }
    }
  }, 300_000);
}

/**
 * @param key       Unique string (e.g. "login:<ip>")
 * @param limit     Maximum requests allowed in the window
 * @param windowMs  Rolling window duration in milliseconds
 * @returns         { limited: boolean; remaining: number }
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { limited: boolean; remaining: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  const entry = store.get(key) ?? { timestamps: [] };
  // Drop timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    store.set(key, entry);
    return { limited: true, remaining: 0 };
  }

  entry.timestamps.push(now);
  store.set(key, entry);
  return { limited: false, remaining: limit - entry.timestamps.length };
}
