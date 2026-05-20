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

const POS_CUSTOMER_ID = "pos-walk-in";

// ── GET ──────────────────────────────────────────────────────────────────────
// Returns sales for the calling staff member. Managers/admins (who hold the
// `canAccessDashboard` permission) get the full fleet view.
export async function GET(req: NextRequest) {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;
  const session = gate.staff;

  const { searchParams } = new URL(req.url);
  const from  = searchParams.get("from");
  const to    = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit") ?? 1000), 5000);

  let q = supabaseAdmin
    .from("pos_sales")
    .select("*")
    .order("date", { ascending: false })
    .limit(limit);

  // Cashiers see only their own sales. Managers/admins (canAccessDashboard)
  // see everything for end-of-shift reports.
  if (!session.permissions?.canAccessDashboard) {
    q = q.eq("staff_id", session.id);
  }

  if (from) q = q.gte("date", from);
  if (to)   q = q.lte("date", to);

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
  const body = parsed.data as unknown as Partial<POSSale>;

  // Discount + refund permission gates: only operators with the flag can
  // commit a sale that carries a non-zero discount.
  if ((body.discountAmount ?? 0) > 0) {
    const discountGate = await requirePosPermission("canApplyDiscount");
    if (!discountGate.ok) return discountGate.response;
  }

  // ─── Server-side totals recompute (F-INS-3b) ────────────────────────────────
  // Subtotal is derived from items via cartLineTotal — clients cannot under-
  // declare it. Total is then derived from subtotal − discount + tax (when
  // tax is exclusive) + tip, and compared to the body's claimed total. A
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
  const taxInclusive   = Boolean(body.taxInclusive  ?? false);

  // When tax is inclusive the tax is already inside subtotalServer; when
  // exclusive we add it. Discounts always reduce the pre-tax base.
  const totalServer = parseFloat((
    subtotalServer - discountAmount + tipAmount + (taxInclusive ? 0 : taxAmount)
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
      { ok: false, error: "Total does not match items + tax + tip − discount.", totalServer },
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

  // ── Active-flag + channel check ───────────────────────────────────────────
  // Defence-in-depth: the SaleView grid already hides inactive / online-only
  // items, but a stale tab could still submit one. Reject before commit.
  const productIds = items.map((it) => it.productId).filter((id): id is string => !!id);
  if (productIds.length > 0) {
    const { data: menuRows } = await supabaseAdmin
      .from("menu_items")
      .select("id, name, active, channels")
      .in("id", productIds);
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
  }

  // ── Stock decrement (warn-but-allow) ──────────────────────────────────────
  // POS staff has the goods in front of them — if the counter says zero but
  // the shelf says otherwise, the sale still completes and we just log so
  // admin can reconcile. Stock counter is left untouched in that case.
  const stockItems: StockItem[] = items
    .map((it) => ({ id: it.productId, qty: it.quantity }))
    .filter((i) => i.id);
  const stock = await decrementStock(stockItems);
  if (!stock.ok) {
    console.warn(`[pos/sales] OVERSOLD on POS sale ${body.id}: ${stock.message}. Continuing — admin to reconcile.`);
  }

  // Insert into pos_sales. receipt_no is filled by the DB default expression
  // ('R' || nextval('pos_receipt_seq')) so neither client nor server has to
  // touch the counter. staff_id and staff_name are SET FROM SESSION — body
  // attribution is intentionally discarded (F-INS-3).
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
    total:           totalServer,
    payment_method:  body.paymentMethod  ?? "cash",
    payments:        body.payments       ?? [],
    cash_tendered:   body.cashTendered   ?? null,
    change_given:    body.changeGiven    ?? null,
    voided:          false,
  };

  const { data: inserted, error } = await supabaseAdmin
    .from("pos_sales")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    // Duplicate id means another request raced us between the pre-check above
    // and this insert. The other path won — restore our (now-extra) decrement
    // and return success so the outbox dequeues.
    if (error.code === "23505") {
      if (stock.ok) {
        restoreStock(stockItems).catch((err) =>
          console.error("[pos/sales] restore after dup-insert:", err instanceof Error ? err.message : err),
        );
      }
      const { data: existing } = await supabaseAdmin
        .from("pos_sales").select("*").eq("id", body.id).single();
      if (existing) {
        return NextResponse.json({ ok: true, duplicate: true, sale: rowToSale(existing) }, { status: 409 });
      }
    }
    // Any other error: undo the decrement before bubbling.
    if (stock.ok) {
      restoreStock(stockItems).catch((err) =>
        console.error("[pos/sales] restore after insert error:", err instanceof Error ? err.message : err),
      );
    }
    console.error("POST /api/pos/sales (pos_sales insert):", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const sale = rowToSale(inserted);

  // KDS sync — fire-and-await so the client knows whether the kitchen has
  // the ticket. Failure here doesn't roll back the sale.
  const kdsResult = await pushToKDS(sale);

  return NextResponse.json({ ok: true, sale, kds: kdsResult });
}

// ── KDS sync helper ──────────────────────────────────────────────────────────
async function pushToKDS(sale: POSSale): Promise<{ ok: boolean; error?: string }> {
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
    const lineTotal = cartLineTotal(item);
    return {
      name:  item.name + modLabel,
      qty:   item.quantity,
      price: parseFloat((lineTotal / item.quantity).toFixed(2)),
    };
  });

  const noteParts: string[] = ["[POS]"];
  if (sale.customerName)  noteParts.push(`Customer: ${sale.customerName}`);
  noteParts.push(`Staff: ${sale.staffName || "Unknown"}`);
  noteParts.push(`Receipt: ${sale.receiptNo}`);
  if (sale.discountNote)  noteParts.push(`Discount: ${sale.discountNote}`);

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
    vat_amount:     sale.taxAmount,
    vat_inclusive:  sale.taxInclusive,
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

// ── snake_case row → camelCase POSSale ───────────────────────────────────────
type PosSaleRow = {
  id: string;
  receipt_no: string;
  date: string;
  staff_id: string | null;
  staff_name: string;
  customer_id: string | null;
  customer_name: string | null;
  table_number: number | null;
  items: POSCartItem[];
  subtotal: number;
  discount_amount: number;
  discount_note: string | null;
  tax_amount: number;
  tax_rate: number;
  tax_inclusive: boolean;
  tip_amount: number;
  total: number;
  payment_method: "cash" | "card" | "split";
  payments: { method: "cash" | "card"; amount: number }[];
  cash_tendered: number | null;
  change_given: number | null;
  voided: boolean;
  void_reason: string | null;
  refund_method: "cash" | "card" | "none" | null;
  refund_amount: number | null;
};

function rowToSale(r: PosSaleRow): POSSale {
  return {
    id:             r.id,
    receiptNo:      r.receipt_no,
    date:           r.date,
    staffId:        r.staff_id ?? "",
    staffName:      r.staff_name,
    customerId:     r.customer_id ?? undefined,
    customerName:   r.customer_name ?? undefined,
    tableNumber:    r.table_number ?? undefined,
    items:          r.items,
    subtotal:       Number(r.subtotal),
    discountAmount: Number(r.discount_amount),
    discountNote:   r.discount_note ?? undefined,
    taxAmount:      Number(r.tax_amount),
    taxRate:        Number(r.tax_rate),
    taxInclusive:   r.tax_inclusive,
    tipAmount:      Number(r.tip_amount),
    total:          Number(r.total),
    paymentMethod:  r.payment_method,
    payments:       r.payments ?? [],
    cashTendered:   r.cash_tendered  != null ? Number(r.cash_tendered)  : undefined,
    changeGiven:    r.change_given   != null ? Number(r.change_given)   : undefined,
    voided:         r.voided,
    voidReason:     r.void_reason  ?? undefined,
    refundMethod:   r.refund_method ?? undefined,
    refundAmount:   r.refund_amount != null ? Number(r.refund_amount) : undefined,
  };
}
