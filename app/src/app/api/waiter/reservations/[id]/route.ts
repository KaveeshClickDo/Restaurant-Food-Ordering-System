/**
 * PUT /api/waiter/reservations/[id]
 * Lets a waiter move a reservation through the part of its lifecycle that
 * happens on the floor:
 *   → checked_in  : guest seated (waiter starts their order)
 *   → checked_out : table settled / cleared
 *
 * Waiters deliberately CANNOT confirm, cancel or no-show from here — those stay
 * with POS/admin. The shared helper runs the same side effects (timestamps,
 * reservation_customers profile, status email) as the POS/admin routes and is
 * idempotent, so a double-tap or a transition another device already made is a
 * no-op (no duplicate email, no double visit_count).
 *
 * Requires a waiter session.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWaiterAuth }         from "@/lib/waiterAuth";
import { parseBody }                 from "@/lib/apiValidation";
import { applyReservationStatusChange } from "@/lib/reservations";
import { z }                         from "zod";

const WaiterReservationStatusSchema = z.object({
  status: z.enum(["checked_in", "checked_out"]),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireWaiterAuth();
  if (authError) return authError;

  const { id } = await params;

  const parsed = await parseBody(req, WaiterReservationStatusSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const result = await applyReservationStatusChange(
    id,
    parsed.data.status,
    req.headers.get("origin") ?? req.nextUrl.origin,
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json({ ok: true, noop: result.noop ?? false });
}
