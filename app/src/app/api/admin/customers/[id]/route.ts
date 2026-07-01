/**
 * PUT    /api/admin/customers/[id] — customer update (admin only).
 * DELETE /api/admin/customers/[id] — admin soft-deletes a customer.
 *
 * PUT body is whitelisted via zod — only documented profile / store-credit /
 * POS-shared / lifecycle fields are writable. Password and verification-token
 * columns are reachable only through the dedicated set-password / send-reset
 * routes alongside this one. `restore: true` un-deletes a soft-deleted customer.
 *
 * DELETE is a SOFT delete (stamps deleted_at) — see softDeleteCustomer. It
 * blocks while the customer has non-terminal orders (409 + payload lists them so
 * the UI can route to Delivery). An optional `{ block: true }` body turns the
 * delete into a ban (re-registration refused). The row, its orders, loyalty
 * ledger, and reservation_customers CRM profile are all preserved.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";
import { parseBody }                            from "@/lib/apiValidation";
import { AdminCustomerUpdateSchema, CustomerDeleteSchema } from "@/lib/schemas/customer";
import { setLoyaltyPointsAbsolute }             from "@/lib/loyaltyUtils";
import { softDeleteCustomer, restoreCustomer }  from "@/lib/customerDelete";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  const parsed = await parseBody(req, AdminCustomerUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  // Restore (un-delete) is its own action — clears deleted_at, stamps
  // reactivated_at — and doesn't combine with field edits.
  if (parsed.data.restore) {
    const res = await restoreCustomer(id);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status ?? 500 });
    return NextResponse.json({ ok: true });
  }

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
  if (data.giftCardBalance !== undefined) updates.gift_card_balance = data.giftCardBalance;
  // loyalty_points is NOT written directly — it's the cached sum of the FIFO
  // lot ledger. A manual edit is routed through setLoyaltyPointsAbsolute below.
  const setLoyalty = data.loyaltyPoints !== undefined;

  if (Object.keys(updates).length === 0 && !setLoyalty) {
    return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabaseAdmin.from("customers").update(updates).eq("id", id);
    if (error) {
      console.error("admin/customers/[id] PUT:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  if (setLoyalty) {
    const res = await setLoyaltyPointsAbsolute(id, data.loyaltyPoints as number, "Admin adjustment");
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error ?? "Could not update loyalty points." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await params;

  // Optional { block } body — a DELETE with no body is fine (defaults to false).
  const block = await readBlockFlag(req);

  const res = await softDeleteCustomer(id, { block });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error, ...(res.activeOrders ? { activeOrders: res.activeOrders } : {}) },
      { status: res.status ?? 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

// Tolerantly read the optional { block } flag off a DELETE body. Callers that
// send no body (or invalid JSON) get the safe default of false.
async function readBlockFlag(req: NextRequest): Promise<boolean> {
  try {
    const raw = await req.json();
    const parsed = CustomerDeleteSchema.safeParse(raw);
    return parsed.success ? parsed.data.block ?? false : false;
  } catch {
    return false;
  }
}
