/**
 * POST /api/admin/reservations/check-in — check a guest in after a QR or
 * reference lookup. Only a pending or confirmed booking, and only on its own
 * date; everything else is refused with a message staff can read out.
 * Requires an admin session. Rules: lib/reservationCheckIn.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { ReservationCheckInSchema } from "@/lib/schemas/reservation";
import { isPlausibleToday } from "@/lib/reservationCheckIn";
import { checkInReservationFromScan } from "@/lib/reservationCheckInServer";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, ReservationCheckInSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { id, today } = parsed.data;
  if (!isPlausibleToday(today)) {
    return NextResponse.json({ ok: false, error: "This device's date looks wrong. Check its date and time settings." }, { status: 400 });
  }

  const result = await checkInReservationFromScan(id, today, req.headers.get("origin") ?? req.nextUrl.origin);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, reservation: result.reservation, eligibility: result.eligibility },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, reservation: result.reservation });
}
