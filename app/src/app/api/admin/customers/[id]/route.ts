/**
 * PUT    /api/admin/customers/[id] — customer update (admin only).
 * DELETE /api/admin/customers/[id] — admin deletes a customer.
 *
 * PUT body is whitelisted via zod — only documented profile / store-credit /
 * POS-shared / lifecycle fields are writable. Password and verification-token
 * columns are reachable only through the dedicated set-password / send-reset
 * routes alongside this one.
 *
 * DELETE blocks while the customer has non-terminal orders (409 + payload
 * lists them so the UI can route to Delivery). On success it also purges the
 * matching reservation_customers row so the CRM guest profile doesn't outlive
 * the customers FK cascade (Bug #10).
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { AdminCustomerUpdateSchema }            from "@/lib/schemas/customer";

// Synthetic ids the customer drawer / list endpoint surfaces — never backed
// by a real DB row, so destructive ops against them must be rejected.
const PROTECTED_IDS = new Set(["__deleted__", "pos-walk-in"]);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, AdminCustomerUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  // Map the schema's camelCase POS-shared fields to their snake_case DB
  // columns. Everything else is already named correctly.
  const data = parsed.data;
  const updates: Record<string, unknown> = {};
  if (data.name            !== undefined) updates.name              = data.name;
  if (data.email           !== undefined) updates.email             = data.email;
  if (data.phone           !== undefined) updates.phone             = data.phone;
  if (data.tags            !== undefined) updates.tags              = data.tags;
  if (data.favourites      !== undefined) updates.favourites        = data.favourites;
  if (data.saved_addresses !== undefined) updates.saved_addresses   = data.saved_addresses;
  if (data.store_credit    !== undefined) updates.store_credit      = data.store_credit;
  if (data.email_verified  !== undefined) updates.email_verified    = data.email_verified;
  if (data.active          !== undefined) updates.active            = data.active;
  if (data.notes           !== undefined) updates.notes             = data.notes;
  if (data.loyaltyPoints   !== undefined) updates.loyalty_points    = data.loyaltyPoints;
  if (data.giftCardBalance !== undefined) updates.gift_card_balance = data.giftCardBalance;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("customers").update(updates).eq("id", id);
  if (error) {
    console.error("admin/customers/[id] PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  if (PROTECTED_IDS.has(id)) {
    return NextResponse.json(
      { ok: false, error: "This is a system-managed row and cannot be deleted." },
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

  // Look up the email first so we can also purge any matching guest profile
  // (reservation_customers row) after the delete — without this cleanup the
  // CRM guest-profile table is orphaned by the customers FK cascade (Bug #10).
  const { data: existing } = await supabaseAdmin
    .from("customers")
    .select("email")
    .eq("id", id)
    .maybeSingle();
  const customerEmail = existing?.email?.toLowerCase()?.trim() || null;

  const { error } = await supabaseAdmin.from("customers").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  if (customerEmail) {
    const { error: rcError } = await supabaseAdmin
      .from("reservation_customers")
      .delete()
      .eq("email", customerEmail);
    if (rcError) {
      // Non-fatal — the customer row is already gone. Log so an admin can
      // clean up manually if it ever fails.
      console.error("admin/customers/[id] DELETE reservation_customers cleanup:", rcError.message);
    }
  }

  return NextResponse.json({ ok: true });
}
