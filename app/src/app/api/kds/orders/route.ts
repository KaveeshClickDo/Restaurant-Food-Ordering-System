/**
 * GET /api/kds/orders — active orders for the Kitchen Display System.
 *
 * Replaces the prior direct `supabase.from("orders")` read in the
 * kitchen client. Accepts a kitchen session OR an admin session
 * (matches the middleware path-protection rule for /kitchen).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getKitchenSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing", "ready"];

export async function GET() {
  const [kitchen, admin] = await Promise.all([
    getKitchenSession(),
    isAdminAuthenticated(),
  ]);
  if (!kitchen && !admin) return unauthorizedJson();

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, items, total, note, status, fulfillment, date, address, scheduled_time, customer:customers(name)")
    .in("status", ACTIVE_STATUSES)
    .order("date", { ascending: true });

  if (error) {
    console.error("kds/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orders: data ?? [] });
}
