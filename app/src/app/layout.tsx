import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import { restaurantInfo } from "@/data/restaurant";
import { DEFAULT_COLORS } from "@/data/defaultSettings";
import { buildColorCss } from "@/lib/colorUtils";
import type { SeoSettings } from "@/types";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://demo.directdine.tech";

// ── Supabase settings fetch (shared by generateMetadata + layout) ─────────────
// Uses native fetch() — deliberately avoids importing supabaseAdmin (which pulls
// in next/server's NextResponse) so the root layout stays free of next/server
// dependencies that confuse the Turbopack module graph.

async function getDbSettings(): Promise<Record<string, unknown> | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/app_settings?id=eq.1&select=data`,
      {
        headers: {
          apikey:        serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept:        "application/json",
        },
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ data: Record<string, unknown> }>;
    return rows[0]?.data ?? null;
  } catch {
    return null;
  }
}

// ── Dynamic metadata (reads DB on every request) ─────────────────────────────

export async function generateMetadata(): Promise<Metadata> {
  const data         = await getDbSettings();
  const seo          = data?.seo as Partial<SeoSettings> | undefined;
  const restaurantName =
    (data?.restaurant as { name?: string } | undefined)?.name ?? restaurantInfo.name;

  const title       = seo?.metaTitle?.trim()       || `${restaurantName} — Order Online`;
  const description = seo?.metaDescription?.trim() || `Order online from ${restaurantName}. Fast delivery and easy collection.`;
  const keywords    = seo?.metaKeywords?.trim()    || `food delivery, online order, ${restaurantName}`;
  const ogImage     = seo?.ogImage?.trim()         || "";
  const siteUrl     = seo?.siteUrl?.trim()         || SITE_URL;
  const faviconUrl  = seo?.faviconUrl?.trim()      || "";
  const faviconVer  = seo?.faviconVersion?.trim()  || "";
  const isDataUrl   = faviconUrl.startsWith("data:");
  const versionedFavicon = faviconUrl && faviconVer
    ? (isDataUrl
        ? `${faviconUrl}#v=${encodeURIComponent(faviconVer)}`
        : `${faviconUrl}${faviconUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(faviconVer)}`)
    : faviconUrl;

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    keywords,
    ...(versionedFavicon && { icons: { icon: versionedFavicon } }),
    alternates: {
      canonical: siteUrl,
    },
    openGraph: {
      title,
      description,
      url:      siteUrl,
      siteName: restaurantName,
      type:     "website",
      locale:   "en_GB",
      ...(ogImage && { images: [{ url: ogImage, width: 1200, height: 630, alt: restaurantName }] }),
    },
    twitter: {
      card:  ogImage ? "summary_large_image" : "summary",
      title,
      description,
      ...(ogImage && { images: [ogImage] }),
    },
  };
}

// ── Viewport — Capacitor-aware ───────────────────────────────────────────────
// Web visitors (any browser, including a mobile browser hitting /pos directly)
// get the default `width=device-width` so the page is responsive normally.
// The Capacitor Android shell appends "RestaurantPOS" to its User-Agent (set
// in capacitor.config.ts → appendUserAgent), and that token is what we
// detect here to serve a wider viewport so the POS layout has the CSS-pixel
// height it needs on high-DPI phone screens. Set in the INITIAL HTML so the
// Android WebView applies it before computing layout — overriding viewport
// after page load is unreliable on Android WebViews.

export async function generateViewport(): Promise<Viewport> {
  const ua = (await headers()).get("user-agent") ?? "";
  const isCapacitor = ua.includes("RestaurantPOS");
  if (isCapacitor) {
    // ONLY `initial-scale`, NO `width`. Why:
    //   • With `width=1920` + `initial-scale=0.6`, the page renders at 1920
    //     CSS pixels wide and is then scaled to 60% visually = 1152
    //     physical pixels. The device is 854 wide — page is wider than
    //     screen, so the user has to pan horizontally. Bad.
    //   • With ONLY `initial-scale=0.6`, the WebView auto-computes the
    //     viewport width to fill the screen at the given scale:
    //         viewport_width = device_width / initial-scale
    //         854 / 0.6 = 1423 CSS pixels wide
    //         384 / 0.6 = 640 CSS pixels tall
    //     The page is exactly the device's physical width, no scrolling.
    //
    // initial-scale=0.6 gives the phone a 1423x640 canvas (plenty for the
    // POS layout) with content at 60% physical size. On a 10" tablet the
    // canvas is larger (~2133x1333) — content looks smaller but no cut-off.
    // Requires `useWideViewPort = true` in MainActivity.kt; without that
    // flag the WebView ignores `initial-scale` too.
    return {
      initialScale: 0.6,
      userScalable: false,
      viewportFit: "cover",
    };
  }
  return {
    width: "device-width",
    initialScale: 1,
  };
}

// ── Brand color CSS (injected server-side to prevent FOUC) ───────────────────

async function getColorCss(data: Record<string, unknown> | null): Promise<string> {
  const colors = data?.colors as { primaryColor?: string; backgroundColor?: string } | undefined;
  return buildColorCss(
    (colors?.primaryColor ?? DEFAULT_COLORS.primaryColor).trim(),
    (colors?.backgroundColor ?? DEFAULT_COLORS.backgroundColor).trim(),
  );
}

// ── Inline fallback script ────────────────────────────────────────────────────
// Runs synchronously in <head> before the first paint.
// Only applies localStorage cache when the server did NOT inject color-theme-vars.

const FOUC_FALLBACK_SCRIPT = `(function(){try{var el=document.getElementById('color-theme-vars');if(!el||!el.textContent.trim()){var c=localStorage.getItem('sg_color_theme');if(c){if(!el){el=document.createElement('style');el.id='color-theme-vars';document.head.appendChild(el);}el.textContent=c;}}}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const data     = await getDbSettings();
  const colorCss = await getColorCss(data);
  const seoData    = data?.seo as Partial<SeoSettings> | undefined;
  const faviconUrl = seoData?.faviconUrl?.trim() ?? "";
  const faviconVer = seoData?.faviconVersion?.trim() ?? "";
  const isDataUrl  = faviconUrl.startsWith("data:");
  const faviconHref = faviconUrl && faviconVer
    ? (isDataUrl
        ? `${faviconUrl}#v=${encodeURIComponent(faviconVer)}`
        : `${faviconUrl}${faviconUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(faviconVer)}`)
    : faviconUrl;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
         * Custom favicon — injected server-side so it's present from byte 1.
         * SeoHead will also update it client-side when the admin changes it.
         * The id lets SeoHead find/replace the server-rendered tag deterministically.
         */}
        {faviconUrl && <link id="sg-favicon" rel="icon" href={faviconHref} />}

        {/*
         * Primary: server-rendered brand CSS injected directly into the HTML.
         * Colors are correct from byte 1 — no flash on any load, any browser.
         */}
        {colorCss && (
          <style
            id="color-theme-vars"
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: colorCss }}
          />
        )}
        {/*
         * Fallback: only active when getDbSettings() returned null (DB unreachable).
         * Restores the last-good theme from localStorage before React hydrates.
         */}
        <script dangerouslySetInnerHTML={{ __html: FOUC_FALLBACK_SCRIPT }} />
      </head>
      <body className="antialiased text-zinc-900" suppressHydrationWarning>
        <AppProvider initialData={data}>{children}</AppProvider>
      </body>
    </html>
  );
}
