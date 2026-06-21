/**
 * PATCH  /api/pos/customers/[id] — update editable fields.
 * DELETE /api/pos/customers/[id] — delete the customer row.
 *
 * Bug #11 — POS and admin share the customers table. POS staff edit/delete
 * via this endpoint; admin equivalents (PATCH on /api/admin/users/[id] with
 * type=customer and the same DELETE) write to the same row.
 *
 * Auth: requires a valid pos_staff_session cookie.
 *
 * The `pos-walk-in` sentinel row is rejected outright — it's an FK target
 * for POS-without-customer sales, not a real customer.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosSession } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { PosCustomerUpdateSchema } from "@/lib/schemas/customer";
import { setLoyaltyPointsAbsolute } from "@/lib/loyaltyUtils";

const POS_WALK_IN_ID = "pos-walk-in";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (id === POS_WALK_IN_ID) {
    return NextResponse.json(
      { ok: false, error: "The walk-in sentinel cannot be edited." },
      { status: 400 },
    );
  }

  const parsed = await parseBody(req, PosCustomerUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const updates: Record<string, unknown> = {};
  if (body.name            !== undefined) updates.name              = body.name.trim();
  if (body.email           !== undefined) updates.email             = body.email.trim().toLowerCase() || null;
  if (body.phone           !== undefined) updates.phone             = body.phone.trim();
  if (body.notes           !== undefined) updates.notes             = body.notes;
  if (body.tags            !== undefined) updates.tags              = body.tags;
  if (body.giftCardBalance !== undefined) updates.gift_card_balance = body.giftCardBalance;
  // loyalty_points is the cached sum of the FIFO lot ledger — route manual edits
  // through setLoyaltyPointsAbsolute instead of overwriting the column.
  const setLoyalty = body.loyaltyPoints !== undefined;

  if (Object.keys(updates).length === 0 && !setLoyalty) {
    return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
  }

  // If the caller cleared the email, swap in a synthetic one so the UNIQUE
  // constraint on customers.email never fires on multiple no-email walk-ins.
  if (updates.email === null) updates.email = `pos-${id}@internal.local`;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabaseAdmin
      .from("customers")
      .update(updates)
      .eq("id", id);

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { ok: false, error: "A customer with that email already exists." },
          { status: 409 },
        );
      }
      console.error("PATCH /api/pos/customers/[id]:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  if (setLoyalty) {
    const res = await setLoyaltyPointsAbsolute(id, body.loyaltyPoints as number, "POS adjustment");
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error ?? "Could not update loyalty points." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (id === POS_WALK_IN_ID) {
    return NextResponse.json(
      { ok: false, error: "The walk-in sentinel cannot be deleted." },
      { status: 400 },
    );
  }

  // Block deletion while the customer has any non-terminal order. The order
  // row would survive via ON DELETE SET NULL, but kitchen/delivery flows
  // still depend on the customer link being live.
  const { data: activeOrders, error: activeErr } = await supabaseAdmin
    .from("orders")
    .select("id, status")
    .eq("customer_id", id)
    .in("status", ["pending", "confirmed", "preparing", "ready"]);
  if (activeErr) {
    return NextResponse.json({ ok: false, error: activeErr.message }, { status: 500 });
  }
  if (activeOrders && activeOrders.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "This customer has active orders. Cancel or complete them before deleting.",
        activeOrders,
      },
      { status: 409 },
    );
  }

  // Mirror the admin DELETE behaviour: also clean up the linked
  // reservation_customers profile so the CRM table isn't orphaned by the
  // customers FK cascade (Bug #10).
  const { data: existing } = await supabaseAdmin
    .from("customers")
    .select("email")
    .eq("id", id)
    .maybeSingle();
  const email = existing?.email?.toLowerCase()?.trim() || null;

  const { error } = await supabaseAdmin.from("customers").delete().eq("id", id);
  if (error) {
    console.error("DELETE /api/pos/customers/[id]:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (email) {
    const { error: rcError } = await supabaseAdmin
      .from("reservation_customers")
      .delete()
      .eq("email", email);
    if (rcError) {
      console.error("DELETE /api/pos/customers/[id] reservation_customers cleanup:", rcError.message);
    }
  }

  return NextResponse.json({ ok: true });
}
