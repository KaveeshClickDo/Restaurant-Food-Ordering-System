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

const KITCHEN_STATUSES = new Set(["pending", "confirmed", "preparing", "ready"]);

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

  let body: { status?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { status } = body;
  if (!status || !KITCHEN_STATUSES.has(status)) {
    return NextResponse.json(
      { ok: false, error: `status must be one of: ${[...KITCHEN_STATUSES].join(", ")}.` },
      { status: 400 },
    );
  }

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
