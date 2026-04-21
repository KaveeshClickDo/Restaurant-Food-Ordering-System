/**
 * POST /api/admin/orders/[id]/refund — record a refund on an order
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  let body: {
    newStatus: string;
    refunds: unknown[];
    refundedAmount: number;
    // Optional: store credit update
    customerId?: string;
    newStoreCredit?: number;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  // Update the order atomically
  const { error: orderErr } = await supabaseAdmin
    .from("orders")
    .update({
      status:          body.newStatus,
      refunds:         body.refunds,
      refunded_amount: body.refundedAmount,
    })
    .eq("id", id);

  if (orderErr) {
    console.error("admin/orders/[id]/refund POST (order):", orderErr.message);
    return NextResponse.json({ ok: false, error: orderErr.message }, { status: 500 });
  }

  // Optionally update customer store credit
  if (body.customerId !== undefined && body.newStoreCredit !== undefined) {
    const { error: custErr } = await supabaseAdmin
      .from("customers")
      .update({ store_credit: body.newStoreCredit })
      .eq("id", body.customerId);
    if (custErr) {
      console.error("admin/orders/[id]/refund POST (store_credit):", custErr.message);
      // Non-fatal — order was already updated; log but don't fail the response
    }
  }

  return NextResponse.json({ ok: true });
}
