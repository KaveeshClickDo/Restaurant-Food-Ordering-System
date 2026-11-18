import type { Metadata } from "next";
import { staffScreenTitle, type StaffScreen } from "@/lib/windowTitle";

// ── Supabase settings fetch (server side) ────────────────────────────────────
// Shared by the root layout (metadata, brand colours, AppProvider's first
// settings) and the staff screens' layouts (tab titles). Next.js dedupes the
// identical fetch within one render, so a page still makes a single request.
//
// Uses native fetch() — deliberately avoids importing supabaseAdmin (which pulls
// in next/server's NextResponse) so the root layout stays free of next/server
// dependencies that confuse the Turbopack module graph.

export async function getDbSettings(): Promise<Record<string, unknown> | null> {
  // Capacitor build only: skip this fetch. The Capacitor app is a STATIC EXPORT,
  // so this server fetch would be frozen into the bundle at build time — a stale
  // settings snapshot that also bakes ONE restaurant's config (printer/branding)
  // into what should be a shared APK. The app instead loads settings at runtime
  // (server fetch when online + on-device SQLite cache when offline), so there's
  // nothing to gain by baking them. Returning null → AppProvider starts from
  // clean defaults. The website build (CAPACITOR_BUILD unset) keeps the
  // per-request fetch below for flash-free first paint — unchanged.
  if (process.env.CAPACITOR_BUILD === "1") return null;
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

/**
 * Metadata for a staff screen's layout: the tab title
 * "<Screen> - <Restaurant name>" (see lib/windowTitle.ts). Without a restaurant
 * name (database unreachable, or the Capacitor build) the title is just the
 * screen's name, never another restaurant's default name.
 */
export async function staffScreenMetadata(screen: StaffScreen): Promise<Metadata> {
  const data = await getDbSettings();
  const name = (data?.restaurant as { name?: string } | undefined)?.name;
  return { title: staffScreenTitle(screen, name) };
}
