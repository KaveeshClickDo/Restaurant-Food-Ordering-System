/**
 * PATCH  /api/admin/coupons/[code] — update a coupon.
 * DELETE /api/admin/coupons/[code] — remove a coupon.
 *
 * Note: usage_count is bumped atomically inside the checkout flow, not here.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { CouponUpdateSchema } from "@/lib/schemas/coupon";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { code } = await params;

  const parsed = await parseBody(req, CouponUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (body.description    !== undefined) patch.description     = body.description;
  if (body.discountType   !== undefined) patch.discount_type   = body.discountType;
  if (body.discountValue  !== undefined) patch.discount_value  = body.discountValue;
  if (body.minOrderTotal  !== undefined) patch.min_order_total = body.minOrderTotal;
  if (body.maxUses        !== undefined) patch.max_uses        = body.maxUses;
  if (body.expiresAt      !== undefined) patch.expires_at      = body.expiresAt;
  if (body.active         !== undefined) patch.active          = body.active;
  if (body.usageCount     !== undefined) patch.usage_count     = body.usageCount;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("coupons")
    .update(patch)
    .eq("code", code.toUpperCase());

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();
  const { code } = await params;

  const { error } = await supabaseAdmin
    .from("coupons")
    .delete()
    .eq("code", code.toUpperCase());

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
