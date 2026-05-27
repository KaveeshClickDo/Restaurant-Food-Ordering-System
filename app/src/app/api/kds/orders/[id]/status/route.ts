/**
 * PUT /api/kds/orders/[id]/status
 * Advances an order through kitchen workflow stages.
 * Requires a valid kitchen_session OR admin_session cookie.
 * Only kitchen-valid transitions are permitted; admin-only statuses
 * (delivered, cancelled, refunded) are blocked here.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { getKitchenSession }         from "@/lib/auth";
import { isAdminAuthenticated }      from "@/lib/adminAuth";
import { parseBody }                 from "@/lib/apiValidation";
import { KdsOrderStatusSchema }      from "@/lib/schemas/pos";
import { sendOrderStatusEmail }      from "@/lib/emailServer";
import type { OrderStatus }          from "@/types";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [kitchenSession, adminAuthed] = await Promise.all([
    getKitchenSession(),
    isAdminAuthenticated(),
  ]);

  if (!kitchenSession && !adminAuthed) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const parsed = await parseBody(req, KdsOrderStatusSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { status } = parsed.data;

  const { error } = await supabaseAdmin
    .from("orders")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.error("kds/orders/[id]/status PUT:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Notify the customer of the status change — mirrors the admin Online Orders
  // path (/api/admin/orders/[id]/status). Fire-and-forget; an email failure must
  // never fail the status update. sendOrderStatusEmail is a no-op for statuses
  // with no template (e.g. "pending") and for guest / POS walk-in orders.
  sendOrderStatusEmail(id, status as OrderStatus).catch((err: unknown) =>
    console.error("[kds] status email:", err instanceof Error ? err.message : err)
  );

  return NextResponse.json({ ok: true });
}
