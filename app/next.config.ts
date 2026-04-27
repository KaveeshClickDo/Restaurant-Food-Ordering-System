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
