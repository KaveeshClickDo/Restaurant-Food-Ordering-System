import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http",  hostname: "**" },
    ],
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
  },
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
};

export default nextConfig;
