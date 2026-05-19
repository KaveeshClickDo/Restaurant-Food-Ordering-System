/**
 * GET  /api/waiter/orders — list active dine-in orders (replaces direct supabase read).
 * POST /api/waiter/orders — place a new dine-in order.
 *
 * Both require a waiter session cookie. Uses the service role key — no admin
 * cookie needed (waiter PIN auth is client-side).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { requireWaiterAuth }         from "@/lib/waiterAuth";
import { parseBody }                 from "@/lib/apiValidation";
import { WaiterOrderCreateSchema }   from "@/lib/schemas/pos";

const POS_CUSTOMER_ID = "pos-walk-in";
const ACTIVE_DINE_IN_STATUSES = ["pending", "confirmed", "preparing", "ready", "delivered"];

export async function GET() {
  const authError = await requireWaiterAuth();
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("fulfillment", "dine-in")
    .in("status", ACTIVE_DINE_IN_STATUSES)
    .order("date", { ascending: false })
    .limit(500);

  if (error) {
    console.error("waiter/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, orders: data ?? [] });
}

async function ensureWalkInCustomer() {
  await supabaseAdmin.from("customers").upsert(
    { id: POS_CUSTOMER_ID, name: "POS Walk-in", email: "pos-walkin@internal",
      phone: "", tags: [], favourites: [], store_credit: 0 },
    { onConflict: "id", ignoreDuplicates: true },
  );
}

export async function POST(req: NextRequest) {
  const authError = await requireWaiterAuth();
  if (authError) return authError;

  const parsed = await parseBody(req, WaiterOrderCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { tableLabel, covers, staffName, items, total, kitchenNote } = parsed.data;

  try {
    await ensureWalkInCustomer();

    // Build kitchen note — visible in the KDS "Special Note" amber box
    const noteParts = [`[WAITER] Table ${tableLabel}`];
    if (covers) noteParts.push(`${covers} cover${covers !== 1 ? "s" : ""}`);
    if (staffName) noteParts.push(`Staff: ${staffName}`);
    if (kitchenNote) noteParts.push(kitchenNote);
    const note = noteParts.join(" · ");

    const row = {
      id:             crypto.randomUUID(),
      customer_id:    POS_CUSTOMER_ID,
      date:           new Date().toISOString(),
      status:         "pending",
      fulfillment:    "dine-in",
      total:          total ?? items.reduce((s, i) => s + i.price * i.qty, 0),
      items,
      note,
      payment_method: "table-service",
    };

    const { error } = await supabaseAdmin.from("orders").insert(row);
    if (error) {
      console.error("waiter/orders POST:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, orderId: row.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/orders]", message);
    return NextResponse.json({ ok: false, error: "Failed to place order. Please try again." }, { status: 500 });
  }
}
