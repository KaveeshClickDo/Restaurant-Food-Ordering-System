/**
 * Shared helpers for digital signage / menu boards.
 *
 * One `signage_displays` row = one public TV screen at /display/<slug>, carrying
 * an ordered list of poster images in the `slides` JSONB column. Used by the
 * admin CRUD routes (api/admin/signage), the public read route
 * (api/signage/[slug]), and indirectly by the /display page + admin panel.
 *
 * Server-only — imports supabaseAdmin. Never import from client code.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const SIGNAGE_COLUMNS =
  "id, name, slug, active, slides, interval_ms, transition, fit, background, created_at, updated_at";

export interface SignageSlide {
  id: string;
  imageUrl: string;
  order: number;
  enabled: boolean;
}

export interface SignageDisplay {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  slides: SignageSlide[];
  intervalMs: number;
  transition: "fade" | "none";
  fit: "contain" | "cover";
  background: string;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSlide(s: any, i: number): SignageSlide {
  return {
    id:       String(s?.id ?? crypto.randomUUID()),
    imageUrl: String(s?.imageUrl ?? ""),
    order:    Number.isFinite(s?.order) ? Number(s.order) : i,
    enabled:  s?.enabled !== false,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSignageRow(row: any): SignageDisplay {
  const slides: SignageSlide[] = Array.isArray(row.slides) ? row.slides.map(mapSlide) : [];
  slides.sort((a, b) => a.order - b.order);
  return {
    id:         row.id,
    name:       row.name,
    slug:       row.slug,
    active:     row.active !== false,
    slides,
    intervalMs: Number(row.interval_ms ?? 8000),
    transition: row.transition === "none" ? "none" : "fade",
    fit:        row.fit === "cover" ? "cover" : "contain",
    background: row.background ?? "#000000",
    createdAt:  typeof row.created_at === "string" ? row.created_at : new Date(row.created_at).toISOString(),
    updatedAt:  typeof row.updated_at === "string" ? row.updated_at : new Date(row.updated_at).toISOString(),
  };
}

/** Normalize a free-text name into a URL-safe slug (lowercase, hyphenated). */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "display"
  );
}

/**
 * Returns a slug unique (case-insensitive) within signage_displays, appending
 * -2, -3, … on collision. Pass `excludeId` to ignore the row being renamed.
 */
export async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base);
  const { data } = await supabaseAdmin.from("signage_displays").select("id, slug");
  const taken = new Set(
    (data ?? [])
      .filter((r) => !excludeId || r.id !== excludeId)
      .map((r) => String(r.slug).toLowerCase()),
  );
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
