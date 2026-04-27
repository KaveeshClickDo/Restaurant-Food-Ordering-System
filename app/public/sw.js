/**
 * Service Worker — Restaurant POS offline shell cache
 *
 * Strategy:
 *  - Static assets (JS/CSS bundles, fonts): Cache-first, updated in background
 *  - API routes (/api/*): Network-first, no cache (handled by outbox in POSContext)
 *  - HTML pages: Network-first with offline fallback to cached version
 *
 * This SW is registered by /pos/page.tsx on mount.
 * It enables the POS UI to load even with no internet after the first visit.
 */

const CACHE_NAME = "pos-shell-v1";

// Assets to pre-cache on install (Next.js injects build hashes at build time).
// We cache-bust by incrementing CACHE_NAME when deploying a new version.
const PRECACHE_URLS = ["/pos", "/"];

// ─── Install: pre-cache shell ────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ─── Activate: delete old caches ─────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch: routing strategy ──────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API routes — always network, never cache (outbox handles offline)
  if (url.pathname.startsWith("/api/")) return;

  // Next.js static chunks (_next/static) — cache-first
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            return res;
          })
      )
    );
    return;
  }

  // HTML pages — network-first, cache fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }
});
