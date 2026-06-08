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

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, items, total, note, status, fulfillment, delivery_status, date, address, scheduled_time, customer:customers(name)")
    .in("status", ACTIVE_STATUSES)
    .order("date", { ascending: true });

  if (error) {
    console.error("kds/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orders: data ?? [] });
}
