/**
 * /api/pos/sales — the source-of-truth endpoint for POS sales.
 *
 *   GET  /api/pos/sales?from=ISO&to=ISO   list sales in a date range
 *   POST /api/pos/sales                   create a sale (atomic receipt_no)
 *
 * The POST handler does two writes:
 *   1. INSERT into pos_sales with a DB-allocated receipt_no (pos_receipt_seq).
 *   2. INSERT a summary row into orders so the Kitchen Display System picks
 *      up the ticket in real-time.
 *
 * Failure of step 2 does NOT fail the request — the audit/tax record (step 1)
 * is the legal source of truth. KDS sync failures are logged and surface in
 * the response so the client can decide whether to retry the KDS push only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { cartLineTotal }             from "@/types/pos";
import type { POSSale, POSCartItem } from "@/types/pos";
import { parseBody }                 from "@/lib/apiValidation";
import { PosSaleCreateSchema }       from "@/lib/schemas/pos";
import { requirePosSession, requirePosPermission } from "@/lib/posPermissions";
import { decrementStock, restoreStock, type StockItem } from "@/lib/stockMutation";
import { lookupActiveGiftCard, clampGiftCardAmount, redeemGiftCardForRow } from "@/lib/giftCardValidation";
import { rewardLoyaltyPoints } from "@/lib/loyaltyUtils";
import { rowToSale } from "@/lib/posSaleMap";

const POS_CUSTOMER_ID = "pos-walk-in";

// ── GET ──────────────────────────────────────────────────────────────────────
// POS-side sales feed, scoped by the POS session:
//   • POS admin / manager (canAccessDashboard) → all sales for end-of-shift reports.
//   • POS cashier → only their own sales.
// The website admin no longer reads this endpoint — the admin POS Reports panel
// uses the dedicated /api/admin/pos-sales route (admin session only), so there
// is no cross-surface bypass here.
export async function GET(req: NextRequest) {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;
  const cashierScope: string | null = gate.staff.permissions?.canAccessDashboard
    ? null
    : gate.staff.id;

  const { searchParams } = new URL(req.url);
  const from  = searchParams.get("from");
  const to    = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit") ?? 1000), 5000);

  let q = supabaseAdmin
    .from("pos_sales")
    .select("*")
    .order("date", { ascending: false })
    .limit(limit);

  if (cashierScope) q = q.eq("staff_id", cashierScope);
  if (from)         q = q.gte("date", from);
  if (to)           q = q.lte("date", to);

  const { data, error } = await q;
  if (error) {
    console.error("GET /api/pos/sales:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sales: (data ?? []).map(rowToSale) });
}

// ── POST ─────────────────────────────────────────────────────────────────────
// Inserts a sale ATTRIBUTED to the calling staff session — body.staffId /
// body.staffName are ignored. Totals are recomputed from items and rejected
// if the body's numbers diverge by more than a small rounding tolerance.
export async function POST(req: NextRequest) {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;
  const session = gate.staff;

  const parsed = await parseBody(req, PosSaleCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  // kitchenNote isn't on POSSale (it's a transient create-only field that
  // lands in the KDS ticket header but is never persisted on pos_sales).
  const body = parsed.data as unknown as Partial<POSSale> & { kitchenNote?: string };

  // Discount + refund permission gates: only operators with the flag can
  // commit a sale that carries a non-zero discount.
  if ((body.discountAmount ?? 0) > 0) {
    const discountGate = await requirePosPermission("canApplyDiscount");
    if (!discountGate.ok) return discountGate.response;
  }

  // ─── Server-side totals recompute (F-INS-3b) ────────────────────────────────
  // Subtotal is derived from items via cartLineTotal — clients cannot under-
  // declare it. Total is then derived from subtotal − discount + tax (when
  // tax is exclusive) + tip + service-fee, and compared to the body's claimed total. A
  // divergence beyond a few pence is rejected outright; up to that tolerance
  // we accept the body figure (clients format with 2dp rounding which can
  // introduce sub-cent drift after multi-item discounts).
  const items = (body.items ?? []) as POSCartItem[];
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "Cart cannot be empty." }, { status: 400 });
  }
  const subtotalServer = parseFloat(
    items.reduce((s, it) => s + cartLineTotal(it), 0).toFixed(2),
  );

  const discountAmount = Number(body.discountAmount ?? 0);
  const taxAmount      = Number(body.taxAmount      ?? 0);
  const tipAmount      = Number(body.tipAmount      ?? 0);
  const serviceFeeAmount = Number(body.serviceFeeAmount ?? 0);
  const taxInclusive   = Boolean(body.taxInclusive  ?? false);

  // Hard cap on discount: it can never exceed the pre-tax subtotal. Anything
  // larger would imply paying the customer to take the food. The client UI
  // already clamps to ≤100% but a malicious or buggy client could still POST
  // a larger discountAmount, so we defend here too (Bug #30).
  if (discountAmount < 0 || discountAmount > subtotalServer + 0.01) {
    return NextResponse.json(
      { ok: false, error: "Discount cannot exceed the order subtotal." },
      { status: 400 },
    );
  }

  // When tax is inclusive the tax is already inside subtotalServer; when
  // exclusive we add it. Discounts always reduce the pre-tax base.
  const totalServer = parseFloat((
    subtotalServer - discountAmount + tipAmount + serviceFeeAmount + (taxInclusive ? 0 : taxAmount)
  ).toFixed(2));

  const SUBTOTAL_TOLERANCE = 0.05; // 5p — guards against per-line rounding drift
  const TOTAL_TOLERANCE    = 0.05;

  if (Math.abs(subtotalServer - Number(body.subtotal ?? 0)) > SUBTOTAL_TOLERANCE) {
    return NextResponse.json(
      { ok: false, error: "Subtotal does not match items.", subtotalServer },
      { status: 400 },
    );
  }
  if (Math.abs(totalServer - Number(body.total ?? 0)) > TOTAL_TOLERANCE) {
    return NextResponse.json(
      { ok: false, error: "Total does not match items + tax + tip + service fee − discount.", totalServer },
      { status: 400 },
    );
  }

  // ── Idempotency pre-check ─────────────────────────────────────────────────
  // The POS outbox replays sales after transient failures. If a previous
  // attempt successfully inserted the sale, returning early here avoids a
  // double stock decrement (the old duplicate-id branch still handles the
  // race where two concurrent attempts run interleaved).
  if (body.id) {
    const { data: existing } = await supabaseAdmin
      .from("pos_sales").select("*").eq("id", body.id).maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, duplicate: true, sale: rowToSale(existing) }, { status: 200 });
    }
  }

  // ── Missing-row + active-flag + channel + manual-OOS check ──────────────
  // Defence-in-depth: the SaleView grid already hides inactive / online-only
  // / out-of-stock items, but a stale tab could still submit one. Reject
  // before commit. Manual Status "out_of_stock" is the admin's explicit
  // "don't sell" — honoured on POS too, since the user's rule is "if you
  // want to override the limit, take the item off track-quantity and use
  // Manual Status — but Manual Status = out_of_stock still means no sale."
  //
  // The missing-row check is the asymmetry fix with the online path: when
  // admin hard-deletes a menu item, its row disappears from menu_items, the
  // active/channel/OOS .find() calls below all miss, AND decrement_stock_atomic
  // silently skips missing rows (schema.sql: "if not found then continue").
  // Without an explicit reject, a stale POS tab could ring up a sale for an
  // item that no longer exists on the menu.
  const productIds = items
    .map((it) => it.productId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (productIds.length > 0) {
    const { data: menuRows } = await supabaseAdmin
      .from("menu_items")
      .select("id, name, active, channels, stock_status, track_stock")
      .in("id", productIds);
    const foundIds = new Set((menuRows ?? []).map((r) => r.id as string));
    const missing = items.find(
      (it) => typeof it.productId === "string" && it.productId.length > 0 && !foundIds.has(it.productId),
    );
    if (missing) {
      return NextResponse.json(
        { ok: false, error: `'${missing.name || "An item"}' is no longer available on the menu.` },
        { status: 400 },
      );
    }
    const inactive = (menuRows ?? []).find((r) => r.active === false);
    if (inactive) {
      return NextResponse.json(
        { ok: false, error: `'${inactive.name}' is no longer available on the menu.` },
        { status: 400 },
      );
    }
    const onlineOnly = (menuRows ?? []).find((r) => {
      const ch = r.channels as string[] | null;
      return Array.isArray(ch) && ch.length > 0 && !ch.includes("in_store");
    });
    if (onlineOnly) {
      return NextResponse.json(
        { ok: false, error: `'${onlineOnly.name}' is online-only and cannot be sold at the till.` },
        { status: 400 },
      );
    }
    // Manual OOS only applies when track_stock is off — once tracked, the
    // qty column is the single source of truth and a stale stock_status
    // (carried over from when the item was in manual mode) must not block.
    const manualOos = (menuRows ?? []).find(
      (r) => r.track_stock !== true && r.stock_status === "out_of_stock",
    );
    if (manualOos) {
      return NextResponse.json(
        { ok: false, error: `'${manualOos.name}' is out of stock.` },
        { status: 400 },
      );
    }
  }

  // ── Stock decrement (hard reject) ─────────────────────────────────────────
  // Track Quantity is a hard limit on every channel, including POS — if
  // counter staff want to oversell because the shelf has stock the counter
  // doesn't know about, admin must take the item off track-quantity (use
  // Manual Status instead). This is the user's stated rule.
  const stockItems: StockItem[] = items
    .map((it) => ({ id: it.productId, qty: it.quantity }))
    .filter((i) => i.id);
  const stock = await decrementStock(stockItems);
  if (!stock.ok) {
    return NextResponse.json({ ok: false, error: stock.message }, { status: 409 });
  }

  // Insert into pos_sales. receipt_no is filled by the DB default expression
  // ('R' || nextval('pos_receipt_seq')) so neither client nor server has to
  // touch the counter. staff_id and staff_name are SET FROM SESSION — body
  // attribution is intentionally discarded (F-INS-3).
  // ── Gift card tender (optional) ───────────────────────────────────────────
  // The gift card is a PAYMENT instrument, not a discount — it does NOT change
  // the sale total (value of goods), it covers part/all of what's owed. We
  // look up the card server-side, clamp the claimed amount to its balance AND
  // the sale total, and stamp the row. Redemption (balance decrement) happens
  // after the row is committed, via redeemGiftCardForRow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const giftCardCode = typeof (body as any).giftCardCode === "string" ? (body as any).giftCardCode.trim() : "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const giftCardClaim = typeof (body as any).giftCardUsed === "number" ? Number((body as any).giftCardUsed) : 0;
  let giftCardId: string | null = null;
  let giftCardUsed = 0;
  if (giftCardCode && giftCardClaim > 0) {
    const lookup = await lookupActiveGiftCard(giftCardCode);
    if (!lookup.ok) {
      return NextResponse.json({ ok: false, error: lookup.message }, { status: 400 });
    }
    giftCardId   = lookup.card.id;
    giftCardUsed = clampGiftCardAmount({
      cardBalance:  lookup.card.balance,
      runningTotal: totalServer,
      requested:    giftCardClaim,
    });
  }

  // Net total = real money collected = gross bill − gift card. We STORE the net
  // (mirroring online orders) so every reader/report uses `total` directly and
  // never has to subtract the gift card again. The gross goods value stays
  // recoverable as total + gift_card_used (used by receipts).
  const netTotal = Math.max(0, Math.round((totalServer - giftCardUsed) * 100) / 100);

  const row = {
    id:              body.id,
    date:            body.date ?? new Date().toISOString(),
    staff_id:        session.id,
    staff_name:      session.name,
    customer_id:     body.customerId || null,
    customer_name:   body.customerName ?? null,
    table_number:    body.tableNumber ?? null,
    items,
    subtotal:        subtotalServer,
    discount_amount: discountAmount,
    discount_note:   body.discountNote   ?? null,
    tax_amount:      taxAmount,
    tax_rate:        Number(body.taxRate ?? 0),
    tax_inclusive:   taxInclusive,
    tip_amount:      tipAmount,
    service_fee_amount: serviceFeeAmount,
    total:           netTotal,
    payment_method:  body.paymentMethod  ?? "cash",
    payments:        body.payments       ?? [],
    cash_tendered:   body.cashTendered   ?? null,
    change_given:    body.changeGiven    ?? null,
    voided:          false,
    gift_card_id:    giftCardId,
    gift_card_used:  giftCardUsed,
  };

  const { data: inserted, error } = await supabaseAdmin
    .from("pos_sales")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    // Stock is guaranteed decremented at this point (we hard-reject above on
    // !stock.ok), so any insert failure here means we owe units back.
    // Duplicate id means another request raced us between the pre-check above
    // and this insert. The other path won — restore our (now-extra) decrement
    // and return success so the outbox dequeues.
    if (error.code === "23505") {
      restoreStock(stockItems).catch((err) =>
        console.error("[pos/sales] restore after dup-insert:", err instanceof Error ? err.message : err),
      );
      const { data: existing } = await supabaseAdmin
        .from("pos_sales").select("*").eq("id", body.id).single();
      if (existing) {
        return NextResponse.json({ ok: true, duplicate: true, sale: rowToSale(existing) }, { status: 409 });
      }
    }
    // Any other error: undo the decrement before bubbling.
    restoreStock(stockItems).catch((err) =>
      console.error("[pos/sales] restore after insert error:", err instanceof Error ? err.message : err),
    );
    console.error("POST /api/pos/sales (pos_sales insert):", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const sale = rowToSale(inserted);

  // Gift card redemption AS A GATE — before KDS sync / the orders mirror.
  // The sale row carries the gift_card_id + gift_card_used stamp; the helper
  // debits the balance with an atomic compare-and-swap, keyed on the sale id
  // (so the POS outbox replaying a sale won't double-debit). If the debit
  // fails (a concurrent sale on a second terminal drained the card), the sale
  // must not stand with a gift-card discount the card can't back — roll it
  // back: delete the just-inserted row and restore stock. A failed CAS leaves
  // the balance untouched, so there's nothing to compensate on the card side.
  if (giftCardId && giftCardUsed > 0) {
    const redeem = await redeemGiftCardForRow({
      giftCardId,
      amount:      giftCardUsed,
      posSaleId:   String(body.id),
      performedBy: `pos:${session.id}`,
    });
    if (!redeem.ok) {
      console.error("[pos/sales] gift card redeem failed, rolling back sale:", redeem.reason, redeem.error);
      await supabaseAdmin.from("pos_sales").delete().eq("id", body.id);
      restoreStock(stockItems).catch((err) =>
        console.error("[pos/sales] stock restore after redeem rollback:", err instanceof Error ? err.message : err),
      );
      return NextResponse.json(
        { ok: false, error: "Gift card balance changed. Please re-check the card and try again." },
        { status: 409 },
      );
    }
  }

  // Loyalty earn — server-side and atomic (used to be a fire-and-forget
  // absolute-value PATCH from the POS browser, which lost points to races
  // and network failures). Points accrue on real money paid only: the
  // gift-card-covered portion is prepaid money and earns nothing. Idempotent
  // per sale id, so outbox replays can't double-award.
  const saleCustomerId = row.customer_id as string | null;
  if (saleCustomerId && saleCustomerId !== POS_CUSTOMER_ID) {
    const moneyPaid = Math.max(0, parseFloat((totalServer - giftCardUsed).toFixed(2)));
    await rewardLoyaltyPoints(saleCustomerId, moneyPaid, { posSaleId: String(body.id) });
  }

  // KDS sync — fire-and-await so the client knows whether the kitchen has
  // the ticket. Failure here doesn't roll back the sale. kitchenNote is
  // passed separately because it's only on the create body, not persisted
  // on pos_sales and therefore not on POSSale.
  const kdsResult = await pushToKDS(sale, typeof body.kitchenNote === "string" ? body.kitchenNote : undefined);

  return NextResponse.json({ ok: true, sale, kds: kdsResult });
}

// ── KDS sync helper ──────────────────────────────────────────────────────────
async function pushToKDS(sale: POSSale, kitchenNote?: string): Promise<{ ok: boolean; error?: string }> {
  // The kitchen display reads from the orders table. POS sales are recorded
  // there as collection orders with a "[POS]" marker in the note so KDS can
  // distinguish them.
  await supabaseAdmin.from("customers").upsert(
    {
      id:           POS_CUSTOMER_ID,
      name:         "POS Walk-in",
      email:        "pos-walkin@internal",
      phone:        "",
      tags:         [],
      favourites:   [],
      store_credit: 0,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  const items = (sale.items as POSCartItem[]).map((item) => {
    const modLabel = item.modifiers?.length
      ? ` (${item.modifiers.map((m) => m.optionLabel).join(", ")})`
      : "";
    // Per-line special note from the POS modifier modal — appended so it shows
    // alongside the item name on the KDS ticket and printed kitchen copy.
    const noteLabel = item.note ? ` — Note: ${item.note}` : "";
    const lineTotal = cartLineTotal(item);
    return {
      name:  item.name + modLabel + noteLabel,
      qty:   item.quantity,
      price: parseFloat((lineTotal / item.quantity).toFixed(2)),
    };
  });

  const noteParts: string[] = ["[POS]"];
  if (sale.customerName)  noteParts.push(`Customer: ${sale.customerName}`);
  noteParts.push(`Staff: ${sale.staffName || "Unknown"}`);
  noteParts.push(`Receipt: ${sale.receiptNo}`);
  if (sale.discountNote)  noteParts.push(`Discount: ${sale.discountNote}`);
  // Cart-wide kitchen note (mirrors the waiter's per-order kitchenNote). Lives
  // only on the create body, never persisted on pos_sales — so it's passed in
  // as a separate parameter rather than read from the POSSale.
  if (kitchenNote && kitchenNote.trim()) {
    noteParts.push(`Note: ${kitchenNote.trim()}`);
  }

  const orderRow = {
    id:             sale.id,
    customer_id:    POS_CUSTOMER_ID,
    date:           sale.date,
    status:         "pending",
    fulfillment:    "collection",
    total:          sale.total,
    items,
    note:           noteParts.join(" | "),
    payment_method: sale.paymentMethod,
    service_fee:    sale.serviceFeeAmount,
    vat_amount:     sale.taxAmount,
    vat_inclusive:  sale.taxInclusive,
    tip_amount:     sale.tipAmount,
    discount_amount: sale.discountAmount,
    discount_note:  sale.discountNote,
    // Carry the gift-card-covered amount onto the mirror so the admin Finance
    // Reports (which read `orders`, not `pos_sales`) can net it out of POS
    // revenue. pos_sales stays the source of truth for the redemption itself.
    gift_card_used: sale.giftCardUsed ?? 0,
  };

  const { error } = await supabaseAdmin.from("orders").insert(orderRow);
  if (error) {
    // Duplicate id is fine — the outbox may have re-driven a sale whose KDS
    // row already exists. Anything else logs but doesn't propagate.
    if (error.code !== "23505") {
      console.error("POST /api/pos/sales (orders insert):", error.message);
      return { ok: false, error: error.message };
    }
  }
  return { ok: true };
}

