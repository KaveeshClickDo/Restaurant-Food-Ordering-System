import type { NextConfig } from "next";

// Capacitor bundled-mode build: produces a static export (`out/`) that the
// Android APK ships so /pos renders with no network. output:"export" is global
// and unsupported alongside rewrites()/headers()/route-handlers, so we strip
// those in this mode and rely on build-time route filtering to leave only the
// POS routes in the graph. See 07-phases.md § 1.5 + 09-decisions.md.
const IS_CAPACITOR_BUILD = process.env.CAPACITOR_BUILD === "1";

const nextConfig: NextConfig = {
  // Static export for the APK bundle. trailingSlash makes routes emit
  // `pos/index.html` (not `pos.html`) so the WebView resolves `/pos/` cleanly
  // from local assets.
  ...(IS_CAPACITOR_BUILD ? { output: "export" as const, trailingSlash: true } : {}),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http",  hostname: "**" },
    ],
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
    // Static export has no Image Optimization server.
    ...(IS_CAPACITOR_BUILD ? { unoptimized: true } : {}),
  },
  // rewrites()/headers() are no-ops under output:"export" (Next errors/warns),
  // so only register them for the normal server build.
  ...(IS_CAPACITOR_BUILD ? {} : {
  async rewrites() {
    return [
      // Apple Pay domain verification — Stripe requires the merchant's domain
      // to serve a specific file at this exact URL. We rewrite to a normal
      // route handler so the content can come from the APPLE_PAY_DOMAIN_ASSOCIATION
      // env var rather than being committed to the repo.
      {
        source: "/.well-known/apple-developer-merchantid-domain-association",
        destination: "/api/apple-pay-domain-verification",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "img-src * data: blob:;" },
          // Allow Capacitor WebView and PWA to register the service worker at root scope
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      // Ensure the SW is never stale-cached — updates deploy immediately
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type",  value: "application/javascript" },
        ],
      },
    ];
  },
  }),
};

export default nextConfig;
