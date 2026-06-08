/**
 * GET /api/admin/drivers/cash — per-driver outstanding cash summary.
 *
 * Returns one entry per driver who currently holds unreconciled COD cash:
 *   { driverId, driverName, total, orderCount, orders: [{ id, date, total, customerName }] }
 *
 * "Outstanding" = delivered + payment_status='paid' + cash (no Stripe or
 * PayPal id) + cash_reconciled_at IS NULL. Filtering on the gateway-id columns
 * (instead of parsing payment_method strings) is robust to admin renames.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

type Row = {
  id: string;
  date: string;
  total: number;
  driver_id: string | null;
  driver_name: string | null;
  customer_id: string | null;
};

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, date, total, driver_id, driver_name, customer_id")
    .eq("status", "delivered")
    .eq("payment_status", "paid")
    .is("cash_reconciled_at", null)
    .is("stripe_payment_intent_id", null)
    .is("paypal_order_id", null)
    .not("driver_id", "is", null)
    .order("date", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];

  // Resolve customer names in one query (avoids N+1).
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x)));
  const customerNameById: Record<string, string> = {};
  if (customerIds.length > 0) {
    const { data: custs } = await supabaseAdmin
      .from("customers")
      .select("id, name")
      .in("id", customerIds);
    for (const c of custs ?? []) customerNameById[c.id as string] = (c.name as string) ?? "";
  }

  // Group by driver.
  const byDriver = new Map<
    string,
    { driverId: string; driverName: string; total: number; orderCount: number; orders: Array<{ id: string; date: string; total: number; customerName: string }> }
  >();

  for (const r of rows) {
    if (!r.driver_id) continue;
    const total = Number(r.total) || 0;
    const customerName = (r.customer_id && customerNameById[r.customer_id]) || "Deleted customer";
    const existing = byDriver.get(r.driver_id);
    if (existing) {
      existing.total += total;
      existing.orderCount += 1;
      existing.orders.push({ id: r.id, date: r.date, total, customerName });
    } else {
      byDriver.set(r.driver_id, {
        driverId:   r.driver_id,
        driverName: r.driver_name ?? "Unknown driver",
        total,
        orderCount: 1,
        orders:     [{ id: r.id, date: r.date, total, customerName }],
      });
    }
  }

  const drivers = Array.from(byDriver.values()).sort((a, b) => b.total - a.total);
  return NextResponse.json({ ok: true, drivers });
}
