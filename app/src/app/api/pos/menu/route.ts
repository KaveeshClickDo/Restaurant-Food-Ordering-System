/**
 * GET  /api/pos/menu — fetch current menu (categories + items) from Supabase
 * POST /api/pos/menu — upsert POS categories + products into Supabase
 *
 * Acts as the bridge between the POS localStorage model and Supabase so that
 * the waiter app (which reads from Supabase via AppContext) always stays in sync.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosPermission } from "@/lib/posPermissions";

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const [{ data: cats, error: catErr }, { data: items, error: itemErr }] =
      await Promise.all([
        supabaseAdmin.from("categories").select("*").order("sort_order"),
        supabaseAdmin.from("menu_items").select("*").order("name"),
      ]);

    if (catErr || itemErr) {
      return NextResponse.json({ ok: false, error: catErr?.message ?? itemErr?.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, categories: cats ?? [], items: items ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    console.error("GET /api/pos/menu:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

// Whitelisted columns — the POS UI is allowed to write these, nothing else.
// Anything outside the whitelist (active flags, audit fields, server-managed
// timestamps, etc.) is silently dropped before the upsert.
const CATEGORY_COLS = new Set([
  "id", "name", "emoji", "sort_order",
]);
const MENU_ITEM_COLS = new Set([
  "id", "category_id", "name", "description", "price", "image",
  "dietary", "popular", "variations", "add_ons", "stock_qty",
  "stock_status", "sort_order",
]);

function pick(row: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (allowed.has(key)) out[key] = row[key];
  }
  return out;
}

export async function POST(req: NextRequest) {
  // F-INS-4 fix: require `canManageMenu` (admin or POS-admin/manager with
  // the explicit flag) — was previously open to any POS session and the
  // "no active staff yet" bypass was wide open on a fresh install. The
  // bootstrap bypass is gone; a fresh install seeds menu via the admin panel
  // or seed script, not via this route.
  const gate = await requirePosPermission("canManageMenu");
  if (!gate.ok) return gate.response;

  let body: {
    categories?: Record<string, unknown>[];
    products?: Record<string, unknown>[];
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const rawCategories = Array.isArray(body.categories) ? body.categories : [];
  const rawProducts   = Array.isArray(body.products)   ? body.products   : [];
  const categories = rawCategories.map((c) => pick(c, CATEGORY_COLS));
  const products   = rawProducts.map((p) => pick(p, MENU_ITEM_COLS));

  // Upsert categories
  if (categories.length > 0) {
    const { error } = await supabaseAdmin
      .from("categories")
      .upsert(categories, { onConflict: "id" });
    if (error) {
      console.error("pos/menu categories upsert:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  // Upsert products (active only — inactive are hidden from waiter/online)
  if (products.length > 0) {
    const { error } = await supabaseAdmin
      .from("menu_items")
      .upsert(products, { onConflict: "id" });
    if (error) {
      console.error("pos/menu items upsert:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
