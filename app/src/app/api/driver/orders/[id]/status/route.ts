/**
 * PUT /api/driver/orders/[id]/status — driver advances delivery status.
 *
 * Guards:
 *   - Requires a valid driver session.
 *   - The order must be assigned to THIS driver (no editing peers' work).
 *   - "picked_up" / "on_the_way" / "delivered" require kitchen status="ready"
 *     (mirrors the gate in /api/admin/orders/[id]/driver).
 *   - "delivered" requires the customer's delivery_code if one exists on the
 *     order.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDriverSession, unauthorizedJson } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";

const DRIVER_STATUSES = ["assigned", "picked_up", "on_the_way", "delivered"] as const;

const Schema = z.object({
  delivery_status: z.enum(DRIVER_STATUSES),
  delivery_code:   z.string().trim().min(1).optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getDriverSession();
  if (!session) return unauthorizedJson();

  const { id } = await params;
  if (!id) return NextResponse.json({ ok: false, error: "Missing order id." }, { status: 400 });

  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { delivery_status, delivery_code } = parsed.data;

  // Fetch the order — must be assigned to this driver.
  const { data: order, error: fetchErr } = await supabaseAdmin
    .from("orders")
    .select("status, fulfillment, delivery_code, driver_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr || !order) {
    return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
  }
  if (order.driver_id !== session.id) {
    return NextResponse.json({ ok: false, error: "Not your order." }, { status: 403 });
  }

  const advancing = ["picked_up", "on_the_way", "delivered"].includes(delivery_status);
  if (advancing && order.status !== "ready" && order.status !== "delivered") {
    return NextResponse.json(
      { ok: false, error: "Order must be marked ready by the kitchen before pickup or delivery." },
      { status: 400 },
    );
  }

  if (
    delivery_status === "delivered" &&
    order.status !== "delivered" &&
    order.fulfillment === "delivery" &&
    order.delivery_code
  ) {
    const submitted = (delivery_code ?? "").trim();
    if (!submitted) {
      return NextResponse.json(
        { ok: false, error: "Delivery code is required to confirm delivery." },
        { status: 400 },
      );
    }
    if (submitted !== order.delivery_code) {
      return NextResponse.json(
        { ok: false, error: "Incorrect delivery code. Ask the customer to read the code from their order confirmation email." },
        { status: 400 },
      );
    }
  }

  const patch: Record<string, unknown> = { delivery_status };
  if (delivery_status === "delivered") patch.status = "delivered";

  const { error: updErr } = await supabaseAdmin
    .from("orders")
    .update(patch)
    .eq("id", id)
    .eq("driver_id", session.id);

  if (updErr) {
    console.error("driver/orders/[id]/status PUT:", updErr.message);
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
