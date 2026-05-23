/**
 * POST /api/admin/drivers/[id]/reconcile-cash — mark COD cash as handed in.
 *
 * Body:
 *   { all: true }                       — reconcile every outstanding order
 *                                         currently held by this driver
 *   { orderIds: ["o1", "o2", ...] }     — reconcile a specific subset
 *
 * Only updates rows that are still outstanding (cash_reconciled_at IS NULL)
 * AND cash (no stripe/paypal id) AND delivered + paid — so the endpoint is
 * idempotent: re-running it is a no-op once everything is reconciled.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse, getAdminSession } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";

const Schema = z.union([
  z.object({ all: z.literal(true), orderIds: z.undefined().optional() }),
  z.object({ orderIds: z.array(z.string().min(1)).min(1), all: z.undefined().optional() }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const session = await getAdminSession();

  const { id: driverId } = await params;
  if (!driverId) {
    return NextResponse.json({ ok: false, error: "Missing driver id." }, { status: 400 });
  }

  const parsed = await parseBody(request, Schema);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  }

  let query = supabaseAdmin
    .from("orders")
    .update({
      cash_reconciled_at: new Date().toISOString(),
      cash_reconciled_by: session?.id ?? "admin",
    })
    .eq("driver_id", driverId)
    .eq("status", "delivered")
    .eq("payment_status", "paid")
    .is("cash_reconciled_at", null)
    .is("stripe_payment_intent_id", null)
    .is("paypal_order_id", null);

  if ("orderIds" in parsed.data && parsed.data.orderIds) {
    query = query.in("id", parsed.data.orderIds);
  }

  const { data, error } = await query.select("id");
  if (error) {
    console.error("admin/drivers/[id]/reconcile-cash POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reconciledCount: data?.length ?? 0 });
}
