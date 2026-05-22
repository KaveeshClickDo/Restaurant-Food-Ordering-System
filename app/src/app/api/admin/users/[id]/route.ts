/**
 * PATCH  /api/admin/users/[id] — update a user (body.type selects the table)
 * DELETE /api/admin/users/[id] — delete a user (body.type selects the table)
 *
 * Dispatches by `type` to the right table:
 *   customer  → customers
 *   driver    → drivers
 *   waiter    → waiters
 *   kitchen   → kitchen_staff
 *   pos       → pos_staff
 *
 * Admin auth required. PINs are bcrypt-hashed; omitting `pin` keeps the
 * existing hash.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt                         from "bcryptjs";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { ROLE_PERMISSIONS } from "@/types/pos";
import { parseBody } from "@/lib/apiValidation";
import { UserUpdateSchema, UserDeleteSchema } from "@/lib/schemas/staff";

const HASH_ROUNDS = 10;

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await context.params;

  const parsed = await parseBody(req, UserUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;
  const { type } = body;

  // ── Customer ────────────────────────────────────────────────────────────────
  if (type === "customer") {
    const updates: Record<string, unknown> = {};
    if (body.name   !== undefined) updates.name   = body.name;
    if (body.email  !== undefined) updates.email  = body.email.toLowerCase();
    if (body.phone  !== undefined) updates.phone  = body.phone.trim() || null;
    if (body.active !== undefined) updates.active = body.active;
    // Bug #11 — POS-shared fields. Customers table is the single source of
    // truth so both admin (this endpoint) and POS (/api/pos/customers/[id])
    // write to the same columns.
    if (body.notes           !== undefined) updates.notes             = body.notes;
    if (body.tags            !== undefined) updates.tags              = body.tags;
    if (body.loyaltyPoints   !== undefined) updates.loyalty_points    = body.loyaltyPoints;
    if (body.giftCardBalance !== undefined) updates.gift_card_balance = body.giftCardBalance;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("customers").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Driver ──────────────────────────────────────────────────────────────────
  if (type === "driver") {
    const updates: Record<string, unknown> = {};
    if (body.name        !== undefined) updates.name         = body.name;
    if (body.email       !== undefined) updates.email        = body.email.toLowerCase();
    if (body.phone       !== undefined) updates.phone        = body.phone || null;
    if (body.active      !== undefined) updates.active       = body.active;
    if (body.vehicleInfo !== undefined) updates.vehicle_info = body.vehicleInfo.trim() || null;
    if (body.notes       !== undefined) updates.notes        = body.notes.trim() || null;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("drivers").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Waiter ──────────────────────────────────────────────────────────────────
  if (type === "waiter") {
    const updates: Record<string, unknown> = {};
    if (body.name        !== undefined) updates.name         = body.name;
    if (body.email       !== undefined) updates.email        = body.email ? body.email.toLowerCase() : "";
    if (body.active      !== undefined) updates.active       = body.active;
    if (body.avatarColor !== undefined) updates.avatar_color = body.avatarColor;
    if (body.hourlyRate  !== undefined) updates.hourly_rate  = body.hourlyRate;
    if (body.pin) updates.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("waiters").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── Kitchen staff ───────────────────────────────────────────────────────────
  if (type === "kitchen") {
    const updates: Record<string, unknown> = {};
    if (body.name        !== undefined) updates.name         = body.name;
    if (body.email       !== undefined) updates.email        = body.email ? body.email.toLowerCase() : "";
    if (body.active      !== undefined) updates.active       = body.active;
    if (body.avatarColor !== undefined) updates.avatar_color = body.avatarColor;
    if (body.kitchenRole !== undefined) updates.role         = body.kitchenRole;
    if (body.pin) updates.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("kitchen_staff").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── POS staff ───────────────────────────────────────────────────────────────
  if (type === "pos") {
    const updates: Record<string, unknown> = {};
    if (body.name        !== undefined) updates.name         = body.name;
    if (body.email       !== undefined) updates.email        = body.email ? body.email.toLowerCase() : "";
    if (body.active      !== undefined) updates.active       = body.active;
    if (body.avatarColor !== undefined) updates.avatar_color = body.avatarColor;
    if (body.hourlyRate  !== undefined) updates.hourly_rate  = body.hourlyRate;
    if (body.posRole     !== undefined) {
      updates.role        = body.posRole;
      updates.permissions = ROLE_PERMISSIONS[body.posRole];
    }
    if (body.pin) updates.pin_hash = await bcrypt.hash(body.pin, HASH_ROUNDS);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("pos_staff").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: `Unknown type: ${type}` }, { status: 400 });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await context.params;

  const parsed = await parseBody(req, UserDeleteSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { type } = parsed.data;

  const tableForType: Record<string, string | undefined> = {
    customer: "customers",
    driver:   "drivers",
    waiter:   "waiters",
    kitchen:  "kitchen_staff",
    pos:      "pos_staff",
  };

  const table = tableForType[type];
  if (!table) {
    if (type === "admin") {
      return NextResponse.json(
        { ok: false, error: "Admin account cannot be deleted via API." },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, error: `Unknown type: ${type}` }, { status: 400 });
  }

  // Reject the synthetic "__deleted__" id — that pseudo-row exists only in
  // /api/admin/customers/list to surface orphan orders (customer_id set null
  // after a real delete) in the admin UI. It is not backed by a DB row.
  if (id === "__deleted__" || id === "pos-walk-in") {
    return NextResponse.json(
      { ok: false, error: "This is a system-managed row and cannot be deleted." },
      { status: 400 },
    );
  }

  // For customers, look up the email first so we can also purge any
  // matching guest profile (reservation_customers row) after the delete.
  // Without this cleanup the CRM guest-profile table is orphaned by the
  // customers FK cascade (Bug #10).
  let customerEmail: string | null = null;
  if (type === "customer") {
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

    const { data: existing } = await supabaseAdmin
      .from("customers")
      .select("email")
      .eq("id", id)
      .maybeSingle();
    customerEmail = existing?.email?.toLowerCase()?.trim() || null;
  }

  const { error } = await supabaseAdmin.from(table).delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  if (type === "customer" && customerEmail) {
    const { error: rcError } = await supabaseAdmin
      .from("reservation_customers")
      .delete()
      .eq("email", customerEmail);
    if (rcError) {
      // Non-fatal — the customer row is already gone. Log so an admin can
      // clean up manually if it ever fails.
      console.error("admin/users DELETE reservation_customers cleanup:", rcError.message);
    }
  }

  return NextResponse.json({ ok: true });
}
