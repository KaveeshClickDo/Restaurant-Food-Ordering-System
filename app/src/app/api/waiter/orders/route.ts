/**
 * POST /api/waiter/orders
 * Places a dine-in order from the waiter app into the Supabase orders table.
 * The Kitchen Display System picks it up via Realtime.
 * Uses the service role key — no admin cookie needed (waiter PIN auth is client-side).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { requireWaiterAuth }         from "@/lib/waiterAuth";

const POS_CUSTOMER_ID = "pos-walk-in";

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

  let body: {
    tableLabel?: string;
    covers?: number;
    staffName?: string;
    items?: { name: string; qty: number; price: number }[];
    total?: number;
    kitchenNote?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { tableLabel, covers, staffName, items, total, kitchenNote } = body;

  if (!tableLabel || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ ok: false, error: "tableLabel and items are required." }, { status: 400 });
  }

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
