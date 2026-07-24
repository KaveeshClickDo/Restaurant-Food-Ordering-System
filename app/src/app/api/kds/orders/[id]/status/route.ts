/**
 * PUT /api/kds/orders/[id]/status
 * Advances an order through kitchen workflow stages.
 * Requires a valid kitchen_session cookie.
 * Only kitchen-valid transitions are permitted; admin-only statuses
 * (delivered, cancelled) are blocked here.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { getKitchenSession }         from "@/lib/auth";
import { parseBody }                 from "@/lib/apiValidation";
import { KdsOrderStatusSchema }      from "@/lib/schemas/pos";
import { sendOrderStatusEmail }      from "@/lib/emailServer";
import type { OrderStatus }          from "@/types";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const kitchenSession = await getKitchenSession();
  if (!kitchenSession) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const parsed = await parseBody(req, KdsOrderStatusSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { status } = parsed.data;

  // The id is either an online / POS order or a dine-in kitchen ticket. Advance
  // the order first; if nothing matched, advance the matching dine-in ticket.
  const { data: updatedOrders, error } = await supabaseAdmin
    .from("orders")
    .update({ status })
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("kds/orders/[id]/status PUT (order):", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!updatedOrders || updatedOrders.length === 0) {
    // Dine-in kitchen ticket — advance it. No customer email (walk-in bill).
    const { error: ticketErr } = await supabaseAdmin
      .from("dine_in_tickets")
      .update({ status })
      .eq("id", id);
    if (ticketErr) {
      console.error("kds/orders/[id]/status PUT (ticket):", ticketErr.message);
      return NextResponse.json({ ok: false, error: ticketErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Notify the customer of the status change — mirrors the admin Online Orders
  // path (/api/admin/orders/[id]/status). Fire-and-forget; an email failure must
  // never fail the status update. sendOrderStatusEmail is a no-op for statuses
  // with no template (e.g. "pending") and for guest / POS walk-in orders.
  sendOrderStatusEmail(id, status as OrderStatus).catch((err: unknown) =>
    console.error("[kds] status email:", err instanceof Error ? err.message : err)
  );

  // No admin "order cancelled" alert here: this route only accepts the kitchen
  // workflow statuses (pending → confirmed → preparing → ready). Cancellation is
  // admin-only and notifies from /api/admin/orders/[id]/status and .../refund.

  return NextResponse.json({ ok: true });
}
