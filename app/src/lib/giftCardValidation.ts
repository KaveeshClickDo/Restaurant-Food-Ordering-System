/**
 * Server-side gift card lookup + apply helpers.
 *
 * Used by:
 *   - /api/gift-cards/lookup           — public balance check (rate-limited)
 *   - /api/orders                      — at order placement, via orderValidation
 *   - /api/pos/sales                   — at POS sale insert
 *   - /api/waiter/settle               — at dine-in settle
 *   - /api/gift-cards/[code]/redeem    — for the post-commit balance decrement
 *
 * NEVER import from client code — uses supabaseAdmin (service-role bypass).
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normaliseGiftCardCode } from "@/lib/giftCardCode";

export type GiftCardLookupError =
  | "invalid_format"
  | "not_found"
  | "inactive"
  | "voided"
  | "expired"
  | "depleted";

export interface GiftCardLookupSuccess {
  ok: true;
  card: {
    id: string;
    code: string;
    initialAmount: number;
    balance: number;
    status: "active" | "redeemed" | "voided" | "expired";
    expiresAt: string | null;
  };
}

export interface GiftCardLookupFailure {
  ok: false;
  error: GiftCardLookupError;
  /** Friendly human-readable text the API route can surface verbatim. */
  message: string;
}

export type GiftCardLookupResult = GiftCardLookupSuccess | GiftCardLookupFailure;

/**
 * Resolve a user-typed gift card code into a live DB row, validating that
 * it's redeemable right now. Callers should treat any non-`ok` result as a
 * 404/400-style response — never reveal whether a code "exists but is
 * voided" vs "doesn't exist" to anonymous callers (timing-safe by virtue of
 * using the same DB query path).
 *
 * Note on the "expired" side-effect: if a card's expiry timestamp has passed
 * we flip its status to 'expired' here (best-effort, fire-and-forget) so it
 * stops showing up as active in the admin list. The check runs again on the
 * next lookup if the flip raced — so worst case is a brief flap, never a
 * security hole.
 */
export async function lookupActiveGiftCard(rawCode: string): Promise<GiftCardLookupResult> {
  const canonical = normaliseGiftCardCode(rawCode);
  if (!canonical) {
    return {
      ok: false,
      error: "invalid_format",
      message: "That doesn't look like a valid gift card code.",
    };
  }

  // Case-insensitive match against the canonical form. The schema has a
  // unique index on lower(code) so this is single-row + indexed.
  const { data, error } = await supabaseAdmin
    .from("gift_cards")
    .select("id, code, initial_amount, balance, status, expires_at")
    .eq("code", canonical)
    .maybeSingle();

  if (error) {
    console.error("[giftCardValidation] DB error:", error.message);
    return {
      ok: false,
      error: "not_found",
      message: "We couldn't look that code up right now. Please try again.",
    };
  }

  if (!data) {
    return {
      ok: false,
      error: "not_found",
      message: "No gift card matches that code.",
    };
  }

  // Status checks. Order matters for UX — show the most specific reason
  // first so the customer knows whether to retry, top up, or contact us.

  // Pre-issued cards carry a balance but are NOT redeemable until an admin
  // activates them at the point of sale. Without this guard a code photographed
  // off a physical card on the counter could be spent the moment a real
  // customer activates it — the whole reason the inactive stage exists.
  if (data.status === "inactive") {
    return {
      ok: false,
      error: "inactive",
      message: "This gift card hasn't been activated yet. Please contact the restaurant.",
    };
  }

  if (data.status === "voided") {
    return {
      ok: false,
      error: "voided",
      message: "This gift card has been voided. Please contact the restaurant.",
    };
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    // Flip the status (best effort — if this update fails, the next lookup
    // will see the expiry and reject again).
    supabaseAdmin
      .from("gift_cards")
      .update({ status: "expired" })
      .eq("id", data.id)
      .eq("status", "active")
      .then(({ error: e }) => {
        if (e) console.error("[giftCardValidation] expiry flip:", e.message);
      });
    return {
      ok: false,
      error: "expired",
      message: "This gift card has expired.",
    };
  }

  if (data.status === "expired") {
    return {
      ok: false,
      error: "expired",
      message: "This gift card has expired.",
    };
  }

  // Status === 'redeemed' means balance is already zero. We return depleted
  // (not 'redeemed') so the caller can render a friendlier message.
  if (Number(data.balance) <= 0 || data.status === "redeemed") {
    return {
      ok: false,
      error: "depleted",
      message: "This gift card has been fully spent.",
    };
  }

  return {
    ok: true,
    card: {
      id: data.id,
      code: data.code,
      initialAmount: Number(data.initial_amount),
      balance: Number(data.balance),
      status: data.status as "active" | "redeemed" | "voided" | "expired",
      expiresAt: data.expires_at,
    },
  };
}

/**
 * Compute how much of a gift card balance can be applied to a running order
 * total. Capped at both the card's balance AND the remaining order total
 * (after coupon + store credit have already been subtracted).
 *
 * Used by the order/POS/waiter validation paths to recompute serverTotal
 * authoritatively — we never trust the browser's claim of "I want to use
 * £X of this card".
 */
export function clampGiftCardAmount(args: {
  cardBalance: number;
  runningTotal: number;
  requested: number;
}): number {
  const cap = Math.max(0, Math.min(args.cardBalance, args.runningTotal));
  const claimed = Math.max(0, args.requested);
  // Round to 2dp to avoid float drift propagating into the order total.
  return Math.round(Math.min(cap, claimed) * 100) / 100;
}

/**
 * Server-side helper to apply a redemption directly (without going through
 * the /api/gift-cards/[code]/redeem HTTP route). Used by the webhook + the
 * cash-order route after they've inserted an order row that carries a
 * gift_card_id stamp.
 *
 * Same idempotency model as the HTTP route — checks for an existing
 * gift_card_transactions row with this order/sale id, returns silent ok if
 * found. CAS guards the balance decrement against concurrent redemptions.
 *
 * Fire-and-forget from the caller's perspective: returns { ok, ... } but
 * we never throw because the order row is already committed; a transient
 * DB failure here just leaves the ledger temporarily inconsistent and an
 * admin can patch it from the audit log.
 */
export type RedeemFailureReason = "insufficient" | "not_found" | "db_error" | "bad_args";

export async function redeemGiftCardForRow(args: {
  giftCardId: string;
  amount: number;
  orderId?: string;
  posSaleId?: string;
  performedBy?: string;
}): Promise<{ ok: true; newBalance: number } | { ok: false; reason: RedeemFailureReason; error: string }> {
  const { giftCardId, amount, orderId, posSaleId } = args;
  if ((!orderId && !posSaleId) || amount <= 0) {
    return { ok: false, reason: "bad_args", error: "Nothing to redeem." };
  }

  // Replay guard.
  const txnFilter = orderId
    ? supabaseAdmin.from("gift_card_transactions").select("balance_after").eq("type", "redeem").eq("order_id", orderId).eq("gift_card_id", giftCardId).maybeSingle()
    : supabaseAdmin.from("gift_card_transactions").select("balance_after").eq("type", "redeem").eq("pos_sale_id", posSaleId!).eq("gift_card_id", giftCardId).maybeSingle();
  const { data: existing } = await txnFilter;
  if (existing) {
    return { ok: true, newBalance: Number(existing.balance_after) };
  }

  // Read current balance + status.
  const { data: card, error: cardErr } = await supabaseAdmin
    .from("gift_cards")
    .select("balance, status")
    .eq("id", giftCardId)
    .maybeSingle();
  if (cardErr) {
    return { ok: false, reason: "db_error", error: cardErr.message };
  }
  if (!card) {
    return { ok: false, reason: "not_found", error: "Gift card row not found." };
  }
  const current = Number(card.balance);
  if (current < amount) {
    return { ok: false, reason: "insufficient", error: "Gift card balance insufficient." };
  }

  const newBalance = parseFloat((current - amount).toFixed(2));
  const becomeRedeemed = newBalance <= 0;

  // CAS decrement.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("gift_cards")
    .update({
      balance: newBalance,
      status:  becomeRedeemed ? "redeemed" : card.status,
    })
    .eq("id", giftCardId)
    .eq("balance", current)
    .select("id")
    .maybeSingle();
  if (updErr) return { ok: false, reason: "db_error", error: updErr.message };
  if (!updated) {
    // Lost the compare-and-swap race against a concurrent redemption — the
    // balance is now lower than we read, so treat it as a shortfall (a retry
    // would re-read the reduced balance and fail the same way).
    return { ok: false, reason: "insufficient", error: "Gift card balance changed during redemption." };
  }

  // Append the audit row.
  const { error: txnErr } = await supabaseAdmin
    .from("gift_card_transactions")
    .insert({
      id:              crypto.randomUUID(),
      gift_card_id:    giftCardId,
      type:            "redeem",
      amount:          -amount,
      balance_after:   newBalance,
      order_id:        orderId ?? null,
      pos_sale_id:     posSaleId ?? null,
      performed_by:    args.performedBy ?? "system",
      notes:           orderId ? `Applied to order ${orderId}` : `Applied to POS sale ${posSaleId}`,
    });
  if (txnErr) {
    console.error(
      `[giftCardValidation] LEDGER GAP — card ${giftCardId} debited £${amount} but txn row failed: ${txnErr.message}`,
    );
  }

  return { ok: true, newBalance };
}

/**
 * Reverse of redeemGiftCardForRow — used by the admin refund route when a
 * refund's method is "gift_card". Credits the balance back, appends a refund
 * txn. No CAS needed (refunds are idempotent at the refund-row level via
 * the existing refunds[] array audit).
 */
export async function refundGiftCardForRow(args: {
  giftCardId: string;
  amount: number;
  orderId?: string;
  posSaleId?: string;
  performedBy: string;
  notes?: string;
}): Promise<{ ok: boolean; newBalance?: number; error?: string }> {
  const { giftCardId, amount, orderId, posSaleId } = args;
  if (amount <= 0) return { ok: false, error: "Refund amount must be positive." };

  const { data: card, error: cardErr } = await supabaseAdmin
    .from("gift_cards")
    .select("balance, status, expires_at")
    .eq("id", giftCardId)
    .maybeSingle();
  if (cardErr || !card) return { ok: false, error: cardErr?.message ?? "Gift card row not found." };

  const newBalance = parseFloat((Number(card.balance) + amount).toFixed(2));

  // Re-activate the card if a previous redemption had zeroed it out.
  // (Voided / expired cards stay in their state — admin can manually
  // reactivate from the panel.)
  const nextStatus = card.status === "redeemed" ? "active" : card.status;

  const { error: updErr } = await supabaseAdmin
    .from("gift_cards")
    .update({ balance: newBalance, status: nextStatus })
    .eq("id", giftCardId);
  if (updErr) return { ok: false, error: updErr.message };

  const { error: txnErr } = await supabaseAdmin
    .from("gift_card_transactions")
    .insert({
      id:              crypto.randomUUID(),
      gift_card_id:    giftCardId,
      type:            "refund",
      amount:          amount,
      balance_after:   newBalance,
      order_id:        orderId ?? null,
      pos_sale_id:     posSaleId ?? null,
      performed_by:    args.performedBy,
      notes:           args.notes ?? null,
    });
  if (txnErr) {
    console.error(
      `[giftCardValidation] REFUND LEDGER GAP — card ${giftCardId} credited £${amount} but txn row failed: ${txnErr.message}`,
    );
  }
  return { ok: true, newBalance };
}
