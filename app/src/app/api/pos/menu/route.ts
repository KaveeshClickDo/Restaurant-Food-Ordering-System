/**
 * GET  /api/pos/menu — fetch current menu (categories + items) from Supabase
 * POST /api/pos/menu — upsert POS categories + products into Supabase
 *
 * Acts as the bridge between the POS localStorage model and Supabase so that
 * the waiter app (which reads from Supabase via AppContext) always stays in sync.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPosSession } from "@/lib/auth";

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

export async function POST(req: NextRequest) {
  // Auth guard: require a valid POS session. Same graceful fallback as pos/orders.
  const session = await getPosSession();
  if (!session) {
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings").select("data").eq("id", 1).single();
    const posStaffConfigured = (settingsRow?.data?.pos_staff ?? []).length > 0;
    if (posStaffConfigured) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: {
    categories?: Record<string, unknown>[];
    products?: Record<string, unknown>[];
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { categories = [], products = [] } = body;

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
