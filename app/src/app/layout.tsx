import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import { restaurantInfo } from "@/data/restaurant";
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

  return {
    metadataBase: new URL(siteUrl),
    title,
    description,
    keywords,
    ...(faviconUrl && { icons: { icon: faviconUrl } }),
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

// ── Brand color CSS (injected server-side to prevent FOUC) ───────────────────

async function getColorCss(data: Record<string, unknown> | null): Promise<string> {
  const colors = data?.colors as { primaryColor?: string; backgroundColor?: string } | undefined;
  if (colors?.primaryColor) {
    return buildColorCss(
      colors.primaryColor.trim(),
      (colors.backgroundColor ?? "#f9fafb").trim(),
    );
  }
  return "";
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
  const faviconUrl = (data?.seo as Partial<SeoSettings> | undefined)?.faviconUrl?.trim() ?? "";

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
         * Custom favicon — injected server-side so it's present from byte 1.
         * SeoHead will also update it client-side when the admin changes it.
         */}
        {faviconUrl && <link rel="icon" href={faviconUrl} />}

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
