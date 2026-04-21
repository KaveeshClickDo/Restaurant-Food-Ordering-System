/**
 * POST /api/admin/categories  — create a new category
 * PUT  /api/admin/categories  — reorder all categories (bulk upsert)
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  let body: { id?: string; name?: string; emoji?: string; sort_order?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  if (!body.id || !body.name) {
    return NextResponse.json({ ok: false, error: "id and name are required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("categories").insert({
    id: body.id, name: body.name, emoji: body.emoji ?? "",
    sort_order: body.sort_order ?? 0,
  });

  if (error) {
    console.error("admin/categories POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  let body: { categories?: { id: string; name: string; emoji: string; sort_order: number }[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  if (!Array.isArray(body.categories)) {
    return NextResponse.json({ ok: false, error: "'categories' array is required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("categories").upsert(body.categories);
  if (error) {
    console.error("admin/categories PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
