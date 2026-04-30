import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import { restaurantInfo } from "@/data/restaurant";
import { buildColorCss } from "@/lib/colorUtils";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://demo.directdine.tech";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${restaurantInfo.name} — Order Online`,
  description: `Order online from ${restaurantInfo.name}. Fast delivery and easy collection.`,
  keywords: `food delivery, online order, ${restaurantInfo.name}`,
  openGraph: {
    title: `${restaurantInfo.name} — Order Online`,
    description: `Fast delivery and easy collection from ${restaurantInfo.name}.`,
    url: SITE_URL,
    siteName: restaurantInfo.name,
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: `${restaurantInfo.name} — Order Online`,
    description: `Fast delivery and easy collection from ${restaurantInfo.name}.`,
  },
};

// ── Server-side brand color fetch ─────────────────────────────────────────────
// Uses the Supabase REST API via native fetch() — deliberately avoids importing
// supabaseAdmin (which pulls in next/server's NextResponse) so the root layout
// stays free of next/server dependencies that confuse the Turbopack module graph
// and can break React context propagation to child components.

async function getColorCss(): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return "";

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/app_settings?id=eq.1&select=data`,
      {
        headers: {
          apikey:        serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept:        "application/json",
        },
        // Always fetch fresh — brand colors change when the admin edits them.
        cache: "no-store",
      },
    );
    if (!res.ok) return "";

    const rows = (await res.json()) as Array<{ data: Record<string, unknown> }>;
    const colors = rows[0]?.data?.colors as
      | { primaryColor?: string; backgroundColor?: string }
      | undefined;

    if (colors?.primaryColor) {
      return buildColorCss(
        colors.primaryColor.trim(),
        (colors.backgroundColor ?? "#f9fafb").trim(),
      );
    }
  } catch {
    // DB unreachable — AppContext + localStorage fallback will apply colors
  }
  return "";
}

// ── Inline fallback script ────────────────────────────────────────────────────
// Runs synchronously in <head> before the first paint.
// Only applies the localStorage cache when the server did NOT inject the
// <style id="color-theme-vars"> (i.e. getColorCss() returned "").
// This prevents stale localStorage from overriding fresh server-rendered CSS.

const FOUC_FALLBACK_SCRIPT = `(function(){try{var el=document.getElementById('color-theme-vars');if(!el||!el.textContent.trim()){var c=localStorage.getItem('sg_color_theme');if(c){if(!el){el=document.createElement('style');el.id='color-theme-vars';document.head.appendChild(el);}el.textContent=c;}}}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const colorCss = await getColorCss();

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
         * Primary: server-rendered brand CSS injected directly into the HTML.
         * Colors are correct from byte 1 — no flash on any load, any browser.
         * AppContext updates this element imperatively when the admin changes
         * colors, so suppressHydrationWarning silences the expected mismatch.
         */}
        {colorCss && (
          <style
            id="color-theme-vars"
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: colorCss }}
          />
        )}
        {/*
         * Fallback: only active when getColorCss() returned "" (DB unreachable).
         * Restores the last-good theme from localStorage before React hydrates.
         */}
        <script dangerouslySetInnerHTML={{ __html: FOUC_FALLBACK_SCRIPT }} />
      </head>
      <body className="font-sans antialiased text-zinc-900" suppressHydrationWarning>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
