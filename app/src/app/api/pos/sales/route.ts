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
import { getPosSession }             from "@/lib/auth";

const POS_CUSTOMER_ID = "pos-walk-in";

// ── auth ─────────────────────────────────────────────────────────────────────
// Once any active POS staff member exists we require a valid session cookie.
// Before that (fresh install) we allow through so a chicken-and-egg setup is
// possible. Same pattern as the rest of the POS API routes.
async function requirePosSessionOrFreshInstall(): Promise<NextResponse | null> {
  const session = await getPosSession();
  if (session) return null;
  const { count } = await supabaseAdmin
    .from("pos_staff").select("id", { count: "exact", head: true }).eq("active", true);
  if ((count ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const unauth = await requirePosSessionOrFreshInstall();
  if (unauth) return unauth;

  const { searchParams } = new URL(req.url);
  const from  = searchParams.get("from");
  const to    = searchParams.get("to");
  const limit = Math.min(Number(searchParams.get("limit") ?? 1000), 5000);

  let q = supabaseAdmin
    .from("pos_sales")
    .select("*")
    .order("date", { ascending: false })
    .limit(limit);

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
export async function POST(req: NextRequest) {
  const unauth = await requirePosSessionOrFreshInstall();
  if (unauth) return unauth;

  let body: Partial<POSSale>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  if (!body.id || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ ok: false, error: "Invalid sale payload." }, { status: 400 });
  }

  // Insert into pos_sales. receipt_no is filled by the DB default expression
  // ('R' || nextval('pos_receipt_seq')) so neither client nor server has to
  // touch the counter.
  const row = {
    id:              body.id,
    date:            body.date ?? new Date().toISOString(),
    staff_id:        body.staffId || null,
    staff_name:      body.staffName ?? "",
    customer_id:     body.customerId || null,
    customer_name:   body.customerName ?? null,
    table_number:    body.tableNumber ?? null,
    items:           body.items,
    subtotal:        body.subtotal       ?? 0,
    discount_amount: body.discountAmount ?? 0,
    discount_note:   body.discountNote   ?? null,
    tax_amount:      body.taxAmount      ?? 0,
    tax_rate:        body.taxRate        ?? 0,
    tax_inclusive:   body.taxInclusive   ?? false,
    tip_amount:      body.tipAmount      ?? 0,
    total:           body.total          ?? 0,
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
    // Duplicate id means the outbox re-sent a sale we already persisted —
    // return 409 so the client can treat it as success and dequeue.
    if (error.code === "23505") {
      const { data: existing } = await supabaseAdmin
        .from("pos_sales").select("*").eq("id", body.id).single();
      if (existing) {
        return NextResponse.json({ ok: true, duplicate: true, sale: rowToSale(existing) }, { status: 409 });
      }
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
