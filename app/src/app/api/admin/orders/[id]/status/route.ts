/**
 * PUT /api/admin/orders/[id]/status — update order status
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { sendOrderStatusEmail }                 from "@/lib/emailServer";
import type { OrderStatus }                     from "@/types";
import { parseBody }                            from "@/lib/apiValidation";
import { OrderStatusUpdateSchema }              from "@/lib/schemas/pos";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, OrderStatusUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  // Refetch the current order so we can decide whether to also flip
  // payment_status to "paid" — cash is collected at the moment of delivery,
  // so the unpaid → paid transition happens here (not at order creation).
  // We do this defensively: only flip if the order is currently unpaid AND
  // the new status is "delivered" AND the payment method is NOT card/stripe.
  // This must never override an already-set payment status (e.g. "paid",
  // "refunded", "partially_refunded") — Stripe flows are untouched.
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("payment_status, payment_method, status")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    console.error("admin/orders/[id]/status PUT (fetch):", fetchErr?.message);
    return NextResponse.json(
      { ok: false, error: fetchErr?.message ?? "Order not found" },
      { status: 500 },
    );
  }

  const method = String(existing.payment_method ?? "").toLowerCase();
  const isCashLike = method !== "stripe" && method !== "card";
  const shouldMarkPaid =
    body.status === "delivered" &&
    existing.payment_status === "unpaid" &&
    existing.status !== "delivered" &&
    isCashLike;

  const updatePayload: Record<string, unknown> = { status: body.status };
  if (shouldMarkPaid) {
    updatePayload.payment_status = "paid";
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update(updatePayload)
    .eq("id", id);

  if (error) {
    console.error("admin/orders/[id]/status PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Fire-and-forget — email failure must never fail the status update response
  sendOrderStatusEmail(id, body.status as OrderStatus).catch((err: unknown) =>
    console.error("[orders] status email:", err instanceof Error ? err.message : err)
  );

  return NextResponse.json({ ok: true });
}
