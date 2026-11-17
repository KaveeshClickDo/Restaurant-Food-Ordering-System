/**
 * Reservation check-in codes.
 *
 * Every reservation has a secret `check_in_code` (32 upper-case hex characters).
 * The guest gets it as a QR code (confirmation email, booking page, booking
 * receipt) and shows it on arrival; staff scan it in POS / admin, or type the
 * short booking reference instead, to find the booking and check the guest in.
 *
 * Kept apart from `cancel_token` on purpose: whoever holds cancel_token can
 * cancel the booking online, while a check-in code does nothing unless a
 * logged-in staff member scans it.
 *
 * Pure and shared by server and client. The API applies these rules for real
 * (lib/reservationCheckInServer.ts); the staff screens use them to word messages.
 */

/** Marks a QR as a DirectDine reservation check-in code (format version 1). */
export const CHECK_IN_QR_PREFIX = "DDR1";

/** Content-ID of the inline QR image in reservation emails. */
export const CHECK_IN_QR_CID = "reservation-checkin-qr";

const CODE_RE = /^[0-9A-F]{32}$/;
const REFERENCE_RE = /^[0-9A-F]{8}$/;
/** The only text a check-in QR may contain (also what the email relay accepts). */
export const CHECK_IN_QR_TEXT_RE = /^DDR1[0-9A-F]{32}$/;

/** A new code, the same shape as the database default. Server-side use. */
export function newCheckInCode(): string {
  return crypto.randomUUID().replace(/-/g, "").toUpperCase();
}

/** What the QR encodes for a booking. Letters and digits only, so a
 *  keyboard-style barcode scanner can't garble it. */
export function checkInQrText(code: string): string {
  return CHECK_IN_QR_PREFIX + code.toUpperCase();
}

/** The short reference guests and staff read out: the first 8 characters of
 *  the booking id, as already shown on emails, receipts and the booking page. */
export function bookingReference(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export type CheckInInput =
  | { kind: "code"; code: string }
  | { kind: "reference"; reference: string };

/**
 * Read whatever was scanned or typed: the QR text (with or without its
 * prefix), a bare code, or a booking reference. Letter case, spaces, "#" and
 * "-" are ignored, so Caps Lock or a scanner's keyboard layout can't break it.
 * Returns null when it is neither.
 */
export function parseCheckInInput(raw: string): CheckInInput | null {
  const s = raw.toUpperCase().replace(/[\s#-]/g, "");
  const code = s.startsWith(CHECK_IN_QR_PREFIX) ? s.slice(CHECK_IN_QR_PREFIX.length) : s;
  if (CODE_RE.test(code)) return { kind: "code", code };
  if (REFERENCE_RE.test(s)) return { kind: "reference", reference: s };
  return null;
}

/** Today's date on this device, "YYYY-MM-DD" (local time, not UTC). */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A date sent by a staff device as "today" must be within a day of the
 *  server's own date (time zones differ by hours, never by days). */
export function isPlausibleToday(today: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const t = Date.parse(`${today}T12:00:00Z`);
  if (Number.isNaN(t)) return false;
  return Math.abs(t - now.getTime()) <= 36 * 60 * 60 * 1000;
}

/** A booking as the check-in screens see it (snake_case, as stored). No
 *  cancel_token: staff never need it. */
export interface CheckInReservation {
  id: string;
  table_id: string;
  table_label: string;
  section: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  date: string;
  time: string;
  party_size: number;
  status: string;
  note: string | null;
  source: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  vip_fee: number;
  payment_status: string | null;
  payment_method: string | null;
  check_in_code: string | null;
}

/** Why a scanned booking can't be checked in. */
export type CheckInBlock = "wrong_day" | "checked_in" | "cancelled" | "no_show" | "checked_out" | "other";

export interface CheckInEligibility {
  canCheckIn: boolean;
  block?: CheckInBlock;
}

/** Statuses a scan may check in from: the booking hasn't started yet. */
export const CHECK_IN_FROM_STATUSES = ["pending", "confirmed"] as const;

/**
 * The scan check-in rules. A pending or confirmed booking can be checked in on
 * its own date, at any time of day. Everything else is refused: another date,
 * already checked in, cancelled, no-show, or a visit that has finished.
 */
export function checkInEligibility(r: { status: string; date: string }, today: string): CheckInEligibility {
  switch (r.status) {
    case "checked_in":  return { canCheckIn: false, block: "checked_in" };
    case "cancelled":   return { canCheckIn: false, block: "cancelled" };
    case "no_show":     return { canCheckIn: false, block: "no_show" };
    case "checked_out": return { canCheckIn: false, block: "checked_out" };
    case "pending":
    case "confirmed":
      return r.date === today ? { canCheckIn: true } : { canCheckIn: false, block: "wrong_day" };
    default:
      return { canCheckIn: false, block: "other" };
  }
}

/** "Sat 22 Nov" for a "YYYY-MM-DD" date. */
export function formatBookingDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** "7:30 pm" for an "HH:MM" time. */
export function formatBookingTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

/** Staff-facing explanation for a booking that can't be checked in. */
export function checkInBlockMessage(
  r: { status: string; date: string; time: string; checked_in_at?: string | null; table_label?: string },
  block: CheckInBlock,
): string {
  switch (block) {
    case "wrong_day":
      return `This booking is for ${formatBookingDay(r.date)}, ${formatBookingTime(r.time)}. It can't be checked in today.`;
    case "checked_in": {
      const at = r.checked_in_at
        ? ` at ${new Date(r.checked_in_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
        : "";
      return `Already checked in${at}${r.table_label ? `, ${r.table_label}` : ""}.`;
    }
    case "cancelled":   return "This booking was cancelled, so it can't be checked in.";
    case "no_show":     return "This booking was marked as a no-show, so it can't be checked in.";
    case "checked_out": return "This visit has already finished.";
    default:            return "This booking can't be checked in.";
  }
}
