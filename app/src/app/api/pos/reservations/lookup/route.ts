/**
 * POST /api/pos/reservations/lookup — find a booking for check-in from a
 * scanned QR code, a typed check-in code or the 8-character booking reference.
 * Read-only. Requires a POS session. Rules: lib/reservationCheckIn.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { ReservationCheckInLookupSchema } from "@/lib/schemas/reservation";
import { isPlausibleToday } from "@/lib/reservationCheckIn";
import { lookupReservationForCheckIn } from "@/lib/reservationCheckInServer";

export async function POST(req: NextRequest) {
  const pos = await getPosSession();
  if (!pos) return unauthorizedJson();

  const parsed = await parseBody(req, ReservationCheckInLookupSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { code, today } = parsed.data;
  if (!isPlausibleToday(today)) {
    return NextResponse.json({ ok: false, error: "This device's date looks wrong. Check its date and time settings." }, { status: 400 });
  }

  const result = await lookupReservationForCheckIn(code, today);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, reservation: result.reservation, eligibility: result.eligibility });
}
