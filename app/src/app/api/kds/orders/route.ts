/**
 * GET /api/kds/orders — active orders for the Kitchen Display System.
 *
 * Replaces the prior direct `supabase.from("orders")` read in the
 * kitchen client. Requires a kitchen session — the admin dashboard reads
 * online orders via /api/admin/orders, not this kitchen route.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getKitchenSession, unauthorizedJson } from "@/lib/auth";

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready"];

export async function GET() {
  const kitchen = await getKitchenSession();
  if (!kitchen) return unauthorizedJson();

  // Online + POS counter orders live in `orders`. EXCLUDE dine-in: its kitchen
  // units are the per-round tickets below, NOT the single bill order (which
  // would otherwise show up as one ever-growing ticket).
  const { data: orderRows, error } = await supabaseAdmin
    .from("orders")
    .select("id, items, total, note, status, fulfillment, delivery_status, date, address, scheduled_time, customer:customers(name)")
    .in("status", ACTIVE_STATUSES)
    .neq("fulfillment", "dine-in")
    .order("date", { ascending: true });

  if (error) {
    console.error("kds/orders GET (orders):", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Dine-in kitchen tickets (one row per round). Shaped like an order row so the
  // kitchen client renders them unchanged; `fulfillment: "dine-in"` drives the
  // table-label display. The ticket id is what the status route advances.
  const { data: ticketRows, error: ticketErr } = await supabaseAdmin
    .from("dine_in_tickets")
    .select("id, items, note, status, date")
    .in("status", ACTIVE_STATUSES)
    .order("date", { ascending: true });

  if (ticketErr) {
    console.error("kds/orders GET (tickets):", ticketErr.message);
    return NextResponse.json({ ok: false, error: ticketErr.message }, { status: 500 });
  }

  const ticketsAsOrders = (ticketRows ?? []).map((t) => ({
    id:              t.id,
    items:           t.items,
    total:           null,
    note:            t.note,
    status:          t.status,
    fulfillment:     "dine-in",
    delivery_status: null,
    date:            t.date,
    address:         null,
    scheduled_time:  null,
    customer:        null,
  }));

  // Merge both sources, oldest-first — the kitchen works one queue regardless of
  // channel.
  const merged = [...(orderRows ?? []), ...ticketsAsOrders].sort(
    (a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime(),
  );

  return NextResponse.json({ ok: true, orders: merged });
}
