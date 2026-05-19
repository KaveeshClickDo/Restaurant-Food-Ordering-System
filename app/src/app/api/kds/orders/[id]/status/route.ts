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

  return NextResponse.json({ ok: true });
}
