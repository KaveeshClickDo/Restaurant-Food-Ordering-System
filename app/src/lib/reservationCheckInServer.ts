/**
 * Server side of the reservation QR check-in, shared by the POS and admin
 * routes. The rules live in lib/reservationCheckIn.ts; this file applies them
 * against the database.
 *
 * Server-only: imports supabaseAdmin.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { applyReservationStatusChange } from "@/lib/reservations";
import {
  CHECK_IN_FROM_STATUSES,
  checkInBlockMessage,
  checkInEligibility,
  parseCheckInInput,
  type CheckInEligibility,
  type CheckInReservation,
} from "@/lib/reservationCheckIn";

/** What the scan screens show. No cancel_token: staff never need it. */
const COLUMNS = "id,table_id,table_label,section,customer_name,customer_email,customer_phone,date,time,party_size,status,note,source,checked_in_at,checked_out_at,vip_fee,payment_status,payment_method,check_in_code";

type Failure = { ok: false; status: number; error: string; reservation?: CheckInReservation; eligibility?: CheckInEligibility };

export type CheckInLookupResult =
  | { ok: true; reservation: CheckInReservation; eligibility: CheckInEligibility }
  | Failure;

export type CheckInResult = { ok: true; reservation: CheckInReservation } | Failure;

const LOOKUP_FAILED = "Couldn't look up the booking. Please try again.";

function toReservation(row: Record<string, unknown>): CheckInReservation {
  return { ...(row as unknown as CheckInReservation), vip_fee: Number(row.vip_fee ?? 0) };
}

async function getById(id: string): Promise<{ ok: true; reservation: CheckInReservation } | Failure> {
  const { data, error } = await supabaseAdmin.from("reservations").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[reservation check-in] read:", error.message);
    return { ok: false, status: 500, error: LOOKUP_FAILED };
  }
  if (!data) return { ok: false, status: 404, error: "Booking not found." };
  return { ok: true, reservation: toReservation(data as unknown as Record<string, unknown>) };
}

/**
 * Find a booking from whatever was scanned or typed: the QR text, a bare
 * check-in code, or the 8-character booking reference. `today` is the staff
 * device's own date ("YYYY-MM-DD"), so the day rule follows the restaurant's
 * clock rather than the server's time zone.
 */
export async function lookupReservationForCheckIn(raw: string, today: string): Promise<CheckInLookupResult> {
  const input = parseCheckInInput(raw);
  if (!input) {
    return { ok: false, status: 400, error: "That isn't a booking QR code or reference. Scan the QR code again, or type the 8-character reference." };
  }

  let rows: CheckInReservation[];
  if (input.kind === "code") {
    const { data, error } = await supabaseAdmin
      .from("reservations").select(COLUMNS).eq("check_in_code", input.code).limit(1);
    if (error) {
      console.error("[reservation check-in] lookup by code:", error.message);
      return { ok: false, status: 500, error: LOOKUP_FAILED };
    }
    rows = (data ?? []).map((r) => toReservation(r as unknown as Record<string, unknown>));
  } else {
    // The reference is the first 8 characters of the id, which is stored in lower case.
    const { data, error } = await supabaseAdmin
      .from("reservations").select(COLUMNS).like("id", `${input.reference.toLowerCase()}%`).limit(10);
    if (error) {
      console.error("[reservation check-in] lookup by reference:", error.message);
      return { ok: false, status: 500, error: LOOKUP_FAILED };
    }
    rows = (data ?? []).map((r) => toReservation(r as unknown as Record<string, unknown>));
    if (rows.length > 1) {
      // Two bookings sharing the first 8 characters is very unlikely; prefer today's.
      const todays = rows.filter((r) => r.date === today);
      if (todays.length === 1) rows = todays;
    }
    if (rows.length > 1) {
      return { ok: false, status: 409, error: "More than one booking has this reference. Scan the QR code, or search by the guest's name." };
    }
  }

  const reservation = rows[0];
  if (!reservation) {
    return { ok: false, status: 404, error: "Booking not found. Check the reference, or search by the guest's name." };
  }
  return { ok: true, reservation, eligibility: checkInEligibility(reservation, today) };
}

/**
 * Check a guest in after a scan. The rules are checked here and enforced
 * again inside the update itself (status and date guard), so a booking that
 * another device checked in, or that was cancelled a moment ago, is refused
 * rather than overwritten. Side effects (welcome email, visit bookkeeping) are
 * the same as every other check-in: applyReservationStatusChange.
 */
export async function checkInReservationFromScan(id: string, today: string, origin?: string): Promise<CheckInResult> {
  const before = await getById(id);
  if (!before.ok) return before;

  const eligibility = checkInEligibility(before.reservation, today);
  if (!eligibility.canCheckIn) {
    return {
      ok: false, status: 409, reservation: before.reservation, eligibility,
      error: checkInBlockMessage(before.reservation, eligibility.block ?? "other"),
    };
  }

  const change = await applyReservationStatusChange(id, "checked_in", origin, {
    fromStatuses: CHECK_IN_FROM_STATUSES,
    date: today,
  });
  if (!change.ok) {
    return { ok: false, status: change.status ?? 500, error: "Couldn't check the guest in. Please try again." };
  }

  const after = await getById(id);
  if (!after.ok) return after;
  if (change.noop) {
    // The booking changed between the two reads (another device, or a cancellation).
    const now = checkInEligibility(after.reservation, today);
    return {
      ok: false, status: 409, reservation: after.reservation, eligibility: now,
      error: checkInBlockMessage(after.reservation, now.block ?? "other"),
    };
  }
  return { ok: true, reservation: after.reservation };
}
