/**
 * GET  /api/admin/dining-tables — list every dining table.
 * POST /api/admin/dining-tables — create one.
 *
 * Replaces the JSONB list at app_settings.data.diningTables. The booking UI
 * also reads this via supabase realtime (anon-select policy permits SELECT).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

const COLUMNS = "id, label, number, seats, section, active, sort_order, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any) {
  return {
    id:        row.id,
    label:     row.label,
    number:    row.number ?? null,
    seats:     row.seats,
    section:   row.section ?? "",
    active:    row.active,
    sortOrder: row.sort_order ?? 0,
    createdAt: typeof row.created_at === "string"
                 ? row.created_at
                 : new Date(row.created_at).toISOString(),
  };
}

export async function GET() {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("dining_tables")
    .select(COLUMNS)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tables: (data ?? []).map(mapRow) });
}

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  let body: {
    label?: string; number?: number | null; seats?: number;
    section?: string; active?: boolean; sortOrder?: number;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { label, number = null, seats, section = "", active = true, sortOrder = 0 } = body;

  if (!label?.trim() || typeof seats !== "number" || seats < 1) {
    return NextResponse.json(
      { ok: false, error: "Required: label, seats (>=1)" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("dining_tables")
    .insert({
      label:      label.trim(),
      number,
      seats,
      section:    section.trim(),
      active,
      sort_order: sortOrder,
    })
    .select(COLUMNS)
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, table: mapRow(data) }, { status: 201 });
}
