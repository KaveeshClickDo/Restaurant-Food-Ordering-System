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
 * Admin auth required. passwords are bcrypt-hashed; omitting `password` keeps the
 * existing hash.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt                         from "bcryptjs";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { ROLE_PERMISSIONS } from "@/types/pos";
import { parseBody } from "@/lib/apiValidation";
import { UserUpdateSchema, UserDeleteSchema } from "@/lib/schemas/staff";
import { setLoyaltyPointsAbsolute } from "@/lib/loyaltyUtils";
import { revokeDeviceTokens } from "@/lib/posDeviceToken";
import { softDeleteCustomer } from "@/lib/customerDelete";

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
    if (body.giftCardBalance !== undefined) updates.gift_card_balance = body.giftCardBalance;
    // loyalty_points is the cached sum of the FIFO lot ledger — route manual
    // edits through setLoyaltyPointsAbsolute instead of writing the column.
    const setLoyalty = body.loyaltyPoints !== undefined;
    if (Object.keys(updates).length === 0 && !setLoyalty) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin.from("customers").update(updates).eq("id", id);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (setLoyalty) {
      const res = await setLoyaltyPointsAbsolute(id, body.loyaltyPoints as number, "Admin adjustment");
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error ?? "Could not update loyalty points." }, { status: 500 });
    }
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
    if (body.waiterRole  !== undefined) updates.role         = body.waiterRole;
    if (body.active      !== undefined) updates.active       = body.active;
    if (body.avatarColor !== undefined) updates.avatar_color = body.avatarColor;
    if (body.hourlyRate  !== undefined) updates.hourly_rate  = body.hourlyRate;
    if (body.password) updates.password_hash = await bcrypt.hash(body.password, HASH_ROUNDS);
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
    if (body.password) updates.password_hash = await bcrypt.hash(body.password, HASH_ROUNDS);
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
    if (body.password) updates.password_hash = await bcrypt.hash(body.password, HASH_ROUNDS);
    if (body.pin)      updates.pin_hash      = await bcrypt.hash(body.pin, HASH_ROUNDS);
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("pos_staff").update(updates).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    // B2: kill tablet device tokens on a credential change / deactivation.
    if (body.password !== undefined || body.pin !== undefined || body.active === false) {
      await revokeDeviceTokens(id);
    }
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
  const { type, block } = parsed.data;

  // Customers are SOFT-deleted (stamp deleted_at) so orders, loyalty, and the
  // CRM profile survive and the customer can rejoin — see softDeleteCustomer.
  // `block` turns it into a ban. Staff types below are still hard-deleted.
  if (type === "customer") {
    const res = await softDeleteCustomer(id, { block });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: res.error, ...(res.activeOrders ? { activeOrders: res.activeOrders } : {}) },
        { status: res.status ?? 500 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  // Staff types are hard-deleted (they have no order/loyalty history to preserve).
  const tableForType: Record<string, string | undefined> = {
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

  const { error } = await supabaseAdmin.from(table).delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
