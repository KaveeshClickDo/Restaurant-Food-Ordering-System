import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow any external hostname for item images set via URL in admin
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http",  hostname: "**" },
    ],
    // Allow data: URIs (base64 uploads from admin)
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
  },
  // Allow <img> tags with data: and external src (needed for base64 uploads)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "img-src * data: blob:;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
