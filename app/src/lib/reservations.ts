/**
 * Shared reservation creation.
 *
 * Three surfaces create reservations: the online booking webhook (after a VIP
 * fee is captured via Stripe/PayPal), the POS Reservations tab, and the admin
 * Reservations panel. They all need the same side effects — conflict re-check,
 * insert (with the cancel_token / source column fallback for un-migrated DBs),
 * guest-profile upsert, and the confirmation email (which doubles as the VIP
 * booking-fee bill). This helper is the single place that does all of it so the
 * three paths can't drift apart.
 *
 * Server-only: pulls supabaseAdmin + the email sender. Never import from a
 * client component.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendReservationEmailServer } from "@/lib/emailServer";
import { getOrderOccupiedTableIds, getActiveDineInTableIds } from "@/lib/tableOccupancy";
import { upsertMarketingContact } from "@/lib/marketingContacts";
import type { AdminSettings, EmailTemplateEvent } from "@/types";

function toMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export interface CreateReservationInput {
  /** Reservation id. Optional — generated when omitted. The online webhook
   *  supplies the id it stashed in the payment session so retries stay idempotent. */
  id?: string;
  cancelToken?: string;

  tableId: string;
  tableLabel: string;
  tableSeats: number;
  section: string;

  customerName: string;
  customerEmail?: string;   // may be empty for walk-ins
  customerPhone?: string;

  date: string;             // "YYYY-MM-DD"
  time: string;             // "HH:MM"
  partySize: number;
  status: "pending" | "checked_in";
  note?: string | null;
  source: string;           // "online" | "walk-in" | "phone"

  // VIP booking fee. Defaults to a free (vipFee 0, paymentStatus 'none') booking.
  vipFee?: number;
  paymentStatus?: "none" | "paid";
  paymentMethod?: string | null;  // "stripe" | "paypal" | "cash" | "card"
  paymentRef?: string | null;

  /** Re-check for a double-booking before inserting. Defaults true. */
  checkConflict?: boolean;
  slotDurationMinutes?: number;
}

export interface CreateReservationResult {
  ok: boolean;
  reservationId?: string;
  error?: string;
  status?: number;       // suggested HTTP status for the caller
  conflict?: boolean;    // true when the slot was taken
}

/**
 * Insert a reservation + run its side effects. Returns a structured result the
 * caller can translate into an HTTP response; never throws.
 */
export async function createReservation(
  input: CreateReservationInput,
  settingsData: AdminSettings | Record<string, unknown> | null | undefined,
  origin?: string,
): Promise<CreateReservationResult> {
  const id           = input.id ?? crypto.randomUUID();
  const cancel_token = input.cancelToken ?? crypto.randomUUID();
  const now          = new Date().toISOString();
  const email        = input.customerEmail?.trim().toLowerCase() ?? "";
  const vipFee       = Number(input.vipFee ?? 0);
  const paymentStatus = input.paymentStatus ?? "none";

  // ── Conflict re-check (race protection) ──────────────────────────────────
  if (input.checkConflict !== false) {
    const rs = (settingsData as AdminSettings | undefined)?.reservationSystem;
    const slotDuration = input.slotDurationMinutes
      ?? rs?.slotDurationMinutes
      ?? 90;
    const { data: conflicts, error: conflictErr } = await supabaseAdmin
      .from("reservations")
      .select("id, time, status")
      .eq("date", input.date)
      .eq("table_id", input.tableId)
      .in("status", ["pending", "confirmed", "checked_in"]);

    // Only treat as fatal when it's not the "table not migrated yet" case.
    if (conflictErr && !conflictErr.message?.includes("schema cache") && !conflictErr.message?.includes("not found")) {
      return { ok: false, error: conflictErr.message, status: 500 };
    }
    const requestedMins = toMins(input.time);
    // A walk-in is seated now, so it's only blocked by a table that's PHYSICALLY
    // occupied this moment (another checked-in guest or an active order) — an
    // upcoming booking is a warning the staff already overrode in the UI, not a
    // hard block. Every other booking blocks on its sitting window.
    const isWalkIn = input.source === "walk-in";
    const reservationConflict = isWalkIn
      ? (conflicts ?? []).some((r) => r.status === "checked_in")
      : (conflicts ?? []).some((r) => Math.abs(toMins(r.time as string) - requestedMins) < slotDuration);

    // Also block if an active dine-in order physically occupies this table.
    // Walk-ins judge that live (any active order); future bookings use the
    // order's sitting window. Best-effort — degrades to the check above on error.
    let orderConflict = false;
    if (!reservationConflict && isWalkIn) {
      const live = await getActiveDineInTableIds();
      orderConflict = live.has(input.tableId);
    } else if (!reservationConflict) {
      const occ = await getOrderOccupiedTableIds({
        date: input.date, requestedMins, slotDurationMinutes: slotDuration,
        slotIntervalMinutes: rs?.slotIntervalMinutes, openTime: rs?.openTime,
        tablesByLabel: new Map([[input.tableLabel, input.tableId]]),
      });
      orderConflict = occ.ids.has(input.tableId);
    }

    if (reservationConflict || orderConflict) {
      return {
        ok: false, conflict: true, status: 409,
        error: "This table is no longer available at the selected time. Please choose another slot.",
      };
    }
  }

  // ── Build + insert ────────────────────────────────────────────────────────
  const row: Record<string, unknown> = {
    id,
    table_id:       input.tableId,
    table_label:    input.tableLabel,
    table_seats:    input.tableSeats ?? 0,
    section:        input.section ?? "",
    customer_name:  input.customerName.trim(),
    customer_email: email,
    customer_phone: input.customerPhone?.trim() ?? "",
    date:           input.date,
    time:           input.time,
    party_size:     input.partySize,
    status:         input.status,
    note:           input.note?.trim?.() ?? input.note ?? null,
    source:         input.source,
    vip_fee:        vipFee,
    payment_status: paymentStatus,
    payment_method: input.paymentMethod ?? null,
    payment_ref:    input.paymentRef ?? null,
    created_at:     now,
  };
  if (input.status === "checked_in") row.checked_in_at = now;

  // Insert with cancel_token; fall back without the newer columns if the DB
  // predates the migration (mirrors the existing route behaviour).
  let { error } = await supabaseAdmin.from("reservations").insert({ ...row, cancel_token });
  if (error && (
    error.message?.includes("cancel_token") ||
    error.message?.includes("source") ||
    error.message?.includes("vip_fee") ||
    error.message?.includes("payment_status") ||
    error.message?.includes("payment_method") ||
    error.message?.includes("payment_ref")
  )) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { vip_fee, payment_status, payment_method, payment_ref, source, ...baseRow } = row;
    const { error: retry } = await supabaseAdmin.from("reservations").insert(baseRow);
    error = retry ?? null;
  }
  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }

  // ── Marketing contact upsert (when an email was supplied) ─────────────────
  // Best-effort by contract — never blocks the booking.
  if (email) {
    await upsertMarketingContact({
      email,
      source: "reservation",
      name:  input.customerName,
      phone: input.customerPhone,
    });
  }

  // ── Confirmation email / booking-fee bill ─────────────────────────────────
  // Sent when there's an email AND the guest isn't already physically present
  // (walk-in) — unless a fee was paid, in which case a walk-in still gets the
  // receipt. Online + phone bookings always email.
  const shouldEmail = !!email && settingsData && (input.source !== "walk-in" || vipFee > 0);
  if (shouldEmail) {
    sendReservationEmailServer("reservation_confirmation", {
      id,
      customer_name:  input.customerName.trim(),
      customer_email: email,
      customer_phone: input.customerPhone?.trim() ?? "",
      date:           input.date,
      time:           input.time,
      table_label:    input.tableLabel,
      party_size:     input.partySize,
      status:         input.status,
      note:           input.note ?? null,
      section:        input.section ?? "",
      cancel_token:   cancel_token,
      vip_fee:        vipFee,
      payment_status: paymentStatus,
      payment_method: input.paymentMethod ?? undefined,
    }, settingsData as AdminSettings, origin).catch(() => { /* logged inside sender */ });
  }

  return { ok: true, reservationId: id };
}

// ── Webhook completion ────────────────────────────────────────────────────────

interface ReservationSessionRow {
  id: string;
  status: string;
  completed_order_id?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reservation_payload: any;
}

/**
 * Turn a captured VIP booking-fee payment session into a reservation. Called by
 * both the Stripe and PayPal webhooks on the payment-succeeded event. Idempotent:
 * a webhook retry that finds the reservation already inserted just re-marks the
 * session and returns.
 *
 * Availability is intentionally NOT re-checked here — the money has already been
 * captured and the fee is non-refundable, so we always honour the booking. The
 * slot was validated at intent time (seconds-to-minutes earlier); the vanishingly
 * rare double-book is left for admin to reconcile, the same way oversold paid
 * orders are handled.
 */
export async function completeReservationFromSession(
  session: ReservationSessionRow,
  paymentMethod: "stripe" | "paypal",
  paymentRef: string,
): Promise<void> {
  const payload = session.reservation_payload;
  if (!payload || !payload.id) {
    console.error(`[reservations] session ${session.id} missing reservation_payload — cannot create booking`);
    return;
  }

  // Idempotency probe — a previous retry may already have inserted the row.
  const { data: existing } = await supabaseAdmin
    .from("reservations").select("id").eq("id", payload.id).maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from("payment_sessions")
      .update({ status: "succeeded", completed_order_id: payload.id })
      .eq("id", session.id);
    return;
  }

  const { data: settingsRow } = await supabaseAdmin
    .from("app_settings").select("data").limit(1).single();

  const result = await createReservation(
    {
      id:            payload.id,
      cancelToken:   payload.cancelToken,
      tableId:       payload.tableId,
      tableLabel:    payload.tableLabel,
      tableSeats:    payload.tableSeats,
      section:       payload.section,
      customerName:  payload.customerName,
      customerEmail: payload.customerEmail,
      customerPhone: payload.customerPhone,
      date:          payload.date,
      time:          payload.time,
      partySize:     payload.partySize,
      status:        "pending",
      note:          payload.note ?? null,
      source:        payload.source ?? "online",
      vipFee:        Number(payload.vipFee ?? 0),
      paymentStatus: "paid",
      paymentMethod,
      paymentRef,
      checkConflict: false,  // payment captured — always honour the booking
    },
    settingsRow?.data ?? null,
  );

  if (!result.ok) {
    // Bubble up so the webhook returns 5xx and the gateway retries — the probe
    // above keeps the retry idempotent.
    throw new Error(`reservation insert failed: ${result.error}`);
  }

  await supabaseAdmin
    .from("payment_sessions")
    .update({ status: "succeeded", completed_order_id: result.reservationId })
    .eq("id", session.id);
}

// ── Status change (check-in / check-out / confirm / cancel / no-show) ───────────

// Keep in lockstep with /api/pos/reservations/[id] and /api/admin/reservations/[id].
// Any status with a mapped event emails the guest after the row is updated.
const STATUS_EMAIL_MAP: Partial<Record<string, EmailTemplateEvent>> = {
  confirmed:   "reservation_update",
  cancelled:   "reservation_cancellation",
  checked_in:  "reservation_check_in",
  checked_out: "reservation_review_request",
};

export type ReservationStatusChange =
  | "checked_in" | "checked_out" | "confirmed" | "cancelled" | "no_show";

export interface StatusChangeResult {
  ok: boolean;
  error?: string;
  status?: number;   // suggested HTTP status for the caller
  noop?: boolean;    // reservation was already in the target status (nothing done)
}

/**
 * Move a reservation to a new status and run the matching side effects
 * (checked_in_at / checked_out_at timestamps, reservation_customers profile
 * upsert + visit_count, status-change email). Extracted from the POS/admin
 * [id] routes so the waiter surface reuses the exact same behaviour instead of
 * keeping a third copy.
 *
 * Idempotent: the UPDATE is filtered with `.neq("status", target)`, so a
 * re-tap (or a transition another device already made) matches zero rows and
 * returns `{ ok: true, noop: true }` WITHOUT re-sending the email or
 * re-incrementing visit_count. Best-effort throughout — never throws.
 *
 * Server-only.
 */
export async function applyReservationStatusChange(
  id: string,
  status: ReservationStatusChange,
  origin?: string,
): Promise<StatusChangeResult> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (status === "checked_in")  patch.checked_in_at  = now;
  if (status === "checked_out") patch.checked_out_at = now;

  // Conditional update = atomic idempotency guard. Zero rows back means the
  // reservation is already in this status (or doesn't exist) — either way,
  // there's nothing to do and no email to send.
  const { data: resRow, error: updateErr } = await supabaseAdmin
    .from("reservations")
    .update(patch)
    .eq("id", id)
    .neq("status", status)
    .select("id,customer_name,customer_email,customer_phone,date,time,table_label,party_size,status,note,section,cancel_token")
    .maybeSingle();

  if (updateErr) {
    console.error("applyReservationStatusChange:", updateErr.message);
    return { ok: false, error: updateErr.message, status: 500 };
  }
  if (!resRow) return { ok: true, noop: true };

  const email = (resRow.customer_email as string)?.trim().toLowerCase();

  // Customer profile bookkeeping — check-in creates/refreshes the contact,
  // check-out increments visit_count. Best-effort; never blocks the status.
  if (email && (status === "checked_in" || status === "checked_out")) {
    await upsertMarketingContact({
      email,
      source: "reservation",
      name:  (resRow.customer_name as string)  ?? "",
      phone: (resRow.customer_phone as string) ?? "",
      visit: status === "checked_out",
    });
  }

  // Status-change email (fire-and-forget) — same map as POS/admin.
  const emailEvent = STATUS_EMAIL_MAP[status];
  if (emailEvent && email) {
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings").select("data").limit(1).single();
    if (settingsRow?.data) {
      sendReservationEmailServer(emailEvent, {
        id:             resRow.id,
        customer_name:  resRow.customer_name,
        customer_email: resRow.customer_email,
        customer_phone: resRow.customer_phone ?? "",
        date:           resRow.date,
        time:           resRow.time,
        table_label:    resRow.table_label,
        party_size:     resRow.party_size,
        status:         resRow.status,
        note:           resRow.note,
        section:        resRow.section ?? "",
        cancel_token:   resRow.cancel_token as string | undefined,
      }, settingsRow.data, origin).catch(console.error);
    }
  }

  return { ok: true };
}
