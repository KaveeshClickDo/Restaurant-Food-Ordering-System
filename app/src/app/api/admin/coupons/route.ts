/**
 * GET  /api/admin/coupons — list every coupon.
 * POST /api/admin/coupons — create one.
 *
 * Replaces the JSONB list at app_settings.data.coupons. Atomic usage_count
 * increments (when a checkout consumes a coupon) live in the orders flow,
 * not here — admin CRUD only.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { CouponCreateSchema } from "@/lib/schemas/coupon";

const COLUMNS = "code, description, discount_type, discount_value, min_order_total, max_uses, usage_count, expires_at, active, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any) {
  return {
    code:           row.code,
    description:    row.description ?? "",
    discountType:   row.discount_type,
    discountValue:  Number(row.discount_value),
    minOrderTotal:  Number(row.min_order_total ?? 0),
    maxUses:        row.max_uses ?? null,
    usageCount:     row.usage_count ?? 0,
    expiresAt:      row.expires_at ?? null,
    active:         row.active,
    createdAt:      typeof row.created_at === "string"
                      ? row.created_at
                      : new Date(row.created_at).toISOString(),
  };
}

export async function GET() {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("coupons")
    .select(COLUMNS)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, coupons: (data ?? []).map(mapRow) });
}

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const parsed = await parseBody(request, CouponCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { code, description = "", discountType, discountValue,
          minOrderTotal = 0, maxUses = null, expiresAt = null, active = true } = parsed.data;

  const { data, error } = await supabaseAdmin
    .from("coupons")
    .insert({
      code:            code.toUpperCase(),
      description,
      discount_type:   discountType,
      discount_value:  discountValue,
      min_order_total: minOrderTotal,
      max_uses:        maxUses,
      expires_at:      expiresAt,
      active,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "A coupon with this code already exists." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, coupon: mapRow(data) }, { status: 201 });
}
