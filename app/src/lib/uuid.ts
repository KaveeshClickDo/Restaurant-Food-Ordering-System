/**
 * Safe UUID generator for both browser and server contexts.
 *
 * `crypto.randomUUID()` is only available in:
 *  - Node.js (server side — always fine for API routes)
 *  - Browsers with a SECURE CONTEXT (HTTPS pages OR http://localhost)
 *
 * It is NOT available when a page is served over plain HTTP from a non-
 * localhost host. That bites in two situations:
 *  1. Local dev over LAN IP (http://192.168.x.x:3000 from a phone) — the
 *     page loads but `crypto.randomUUID` is undefined, and any call throws
 *     "crypto.randomUUID is not a function."
 *  2. Capacitor WebView in dev mode pointing at an HTTP server.
 *
 * The fallback below produces an RFC 4122-shaped v4 UUID using Math.random.
 * It is NOT cryptographically strong — do not use for tokens or secrets.
 * Our use case (primary keys, idempotency keys, optimistic IDs) doesn't
 * require cryptographic randomness; we just need globally unique strings.
 */

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Math.random fallback. RFC 4122 v4 layout: 8-4-4-4-12 hex chars, with the
  // 13th nibble fixed to 4 and the 17th nibble's top two bits fixed to 10.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
