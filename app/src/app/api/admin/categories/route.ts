/**
 * POST /api/admin/categories  — create a new category
 * PUT  /api/admin/categories  — reorder all categories (bulk upsert)
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { CategoryCreateSchema, CategoryReorderSchema } from "@/lib/schemas/menu";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, CategoryCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const { error } = await supabaseAdmin.from("categories").insert({
    id: body.id, name: body.name, emoji: body.emoji ?? "",
    sort_order: body.sort_order ?? 0,
    parent_id: body.parent_id ?? null,
  });

  if (error) {
    console.error("admin/categories POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, CategoryReorderSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const { error } = await supabaseAdmin.from("categories").upsert(parsed.data.categories);
  if (error) {
    console.error("admin/categories PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
