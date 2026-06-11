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
import { parseBody } from "@/lib/apiValidation";
import { DiningTableCreateSchema } from "@/lib/schemas/menu";

const COLUMNS = "id, label, number, seats, section, active, sort_order, is_vip, vip_price, pos_x, pos_y, floor_plan_id, created_at";

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
    isVip:     row.is_vip ?? false,
    vipPrice:  Number(row.vip_price ?? 0),
    posX:      row.pos_x ?? null,
    posY:      row.pos_y ?? null,
    floorId:   row.floor_plan_id ?? null,
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

  const parsed = await parseBody(request, DiningTableCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { label, number = null, seats, section = "", active = true, sortOrder = 0, isVip = false, vipPrice = 0, posX = null, posY = null, floorId = null } = parsed.data;
  // Normal tables never carry a fee, even if a stale client sent one.
  const vipPriceFinal = isVip ? vipPrice : 0;

  // Block duplicate labels (case-insensitive). Defense-in-depth — the client
  // also checks, but a stale form or direct API call can still slip through.
  const trimmedLabel = label;
  const { data: existing } = await supabaseAdmin
    .from("dining_tables")
    .select("id")
    .ilike("label", trimmedLabel)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `A table labeled "${trimmedLabel}" already exists. Use a different label.` },
      { status: 409 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("dining_tables")
    .insert({
      label:      trimmedLabel,
      number,
      seats,
      section:    section.trim(),
      active,
      sort_order: sortOrder,
      is_vip:     isVip,
      vip_price:  vipPriceFinal,
      pos_x:      posX,
      pos_y:      posY,
      floor_plan_id: floorId,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    // 23505 = unique_violation. The DB-level constraint catches anything that
    // slipped past the app-level check (concurrent POSTs, direct API hits).
    if (error.code === "23505" || error.message?.includes("dining_tables_label_unique")) {
      return NextResponse.json(
        { ok: false, error: `A table labeled "${trimmedLabel}" already exists. Use a different label.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, table: mapRow(data) }, { status: 201 });
}
