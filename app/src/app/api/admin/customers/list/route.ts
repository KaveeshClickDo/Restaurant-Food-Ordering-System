/**
 * GET /api/admin/customers/list — admin-gated read of every customer + orders.
 *
 * Replaces the public `supabase.from("customers").select(...)` call that
 * AppContext used to make with the browser anon key (which leaked PII to
 * every visitor). Admin pages call this instead.
 *
 * Bug #11 — unifies POS + admin customer data. The response now includes the
 * shared POS fields (loyalty_points, gift_card_balance, notes) and three
 * computed aggregates (totalSpend, visitCount, lastVisit) built from BOTH
 * `orders.total` (online orders) AND `pos_sales.total` (in-person sales).
 * Cancellations on which money actually flowed (paid then cancelled) still
 * contribute to spend at net (total − refunded); unpaid cancellations and
 * voided POS sales are ignored. See spendContribution() below. Aggregation
 * runs in TS after a single batched fetch to avoid an N+1 query per customer.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

interface AggregateBucket {
  spend: number;
  visits: number;
  lastVisit: string | null;   // ISO
}

// What this order should contribute to lifetime spend.
// "Total spent" means NET — what the customer paid and we kept — so refunds
// reduce spend on EVERY order, regardless of channel or fulfillment status
// (Bug #6: previously only cancelled orders netted out refunds, so a
// delivered-then-refunded online order kept counting its full gross while a
// refunded POS sale dropped entirely — two opposite behaviours).
//   • Cancelled-and-unpaid → no money ever moved, excluded from spend & visits.
//   • Everything else → net = total - refunded (a fully-refunded order is £0
//     but still counts as a visit; a partial refund counts the retained part).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spendContribution(o: any): { amount: number; counts: boolean } {
  const total    = Number(o.total) || 0;
  const refunded = Number(o.refunded_amount) || 0;
  if (o.status === "cancelled") {
    const moneyBearing = o.payment_status === "paid"
                      || o.payment_status === "partially_refunded"
                      || o.payment_status === "refunded";
    if (!moneyBearing) return { amount: 0, counts: false };
  }
  return { amount: Math.max(0, total - refunded), counts: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCustomer(row: any, orders: any[], agg: AggregateBucket) {
  return {
    id:             row.id,
    name:           row.name,
    email:          row.email,
    phone:          row.phone ?? "",
    tags:           row.tags ?? [],
    favourites:     row.favourites ?? [],
    savedAddresses: row.saved_addresses ?? [],
    storeCredit:    row.store_credit != null ? Number(row.store_credit) : undefined,
    emailVerified:  row.email_verified ?? undefined,
    active:         row.active ?? true,
    // POS-shared fields — null/undefined-safe for legacy rows pre-dating Bug #11.
    loyaltyPoints:   row.loyalty_points     != null ? Number(row.loyalty_points)     : 0,
    giftCardBalance: row.gift_card_balance  != null ? Number(row.gift_card_balance)  : 0,
    notes:           row.notes ?? "",
    // Computed aggregates (orders + POS sales, excluding voided/cancelled).
    totalSpend: parseFloat(agg.spend.toFixed(2)),
    visitCount: agg.visits,
    lastVisit:  agg.lastVisit ?? undefined,
    createdAt:      typeof row.created_at === "string"
                      ? row.created_at
                      : new Date(row.created_at).toISOString(),
    orders:         orders.map(mapOrder),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrder(o: any) {
  return {
    id:                    o.id,
    customerId:            o.customer_id ?? null,
    date:                  typeof o.date === "string" ? o.date : new Date(o.date).toISOString(),
    status:                o.status,
    fulfillment:           o.fulfillment,
    total:                 Number(o.total),
    items:                 o.items ?? [],
    address:               o.address         || undefined,
    note:                  o.note            || undefined,
    paymentMethod:         o.payment_method  || undefined,
    // payment_status / stripe_* / delivery_code are required by the admin
    // Refunds panel (eligibility check + StripeIntentLink) and the
    // PaymentStatusBadge — missing them caused every order to render as
    // "Pending" and hid all paid Stripe orders from refunds.
    paymentStatus:         o.payment_status  ?? undefined,
    stripePaymentIntentId: o.stripe_payment_intent_id ?? null,
    stripeChargeId:        o.stripe_charge_id ?? null,
    deliveryCode:          o.delivery_code   || undefined,
    deliveryFee:           o.delivery_fee    ? Number(o.delivery_fee)    : undefined,
    serviceFee:            o.service_fee     ? Number(o.service_fee)     : undefined,
    scheduledTime:         o.scheduled_time  || undefined,
    couponCode:            o.coupon_code     || undefined,
    couponDiscount:        o.coupon_discount ? Number(o.coupon_discount) : undefined,
    vatAmount:             o.vat_amount      ? Number(o.vat_amount)      : undefined,
    vatInclusive:          o.vat_inclusive   ?? undefined,
    driverId:              o.driver_id       || undefined,
    driverName:            o.driver_name     || undefined,
    deliveryStatus:        o.delivery_status || undefined,
    refunds:               o.refunds         ?? [],
    refundedAmount:        o.refunded_amount   ? Number(o.refunded_amount)   : undefined,
    storeCreditUsed:       o.store_credit_used ? Number(o.store_credit_used) : undefined,
    // Gift card stamp — without these the admin Refunds panel can't offer the
    // "Gift card" refund method (it gates on order.giftCardUsed > 0).
    giftCardId:            o.gift_card_id ?? undefined,
    giftCardUsed:          o.gift_card_used ? Number(o.gift_card_used) : undefined,
  };
}

// The 'pos-walk-in' row is an FK-only sentinel for POS / waiter orders
// (see supabase/schema.sql section 7). It is NOT a real customer and must
// never appear in the admin customer list / search / exports. Filtered at
// the query level so it can't leak through any downstream rendering.
const POS_WALK_IN_ID = "pos-walk-in";

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  // Three queries in parallel — customers, online orders, and POS sales.
  // Aggregation happens in TS after the fetch so we never run N queries per
  // customer. The 'date' values on each are normalised to ISO strings before
  // comparison.
  const [
    { data: customers, error: errC },
    { data: orders,    error: errO },
    { data: posSales,  error: errP },
  ] = await Promise.all([
    supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, tags, favourites, saved_addresses, store_credit, created_at, email_verified, loyalty_points, gift_card_balance, notes, active")
      .neq("id", POS_WALK_IN_ID),
    supabaseAdmin
      .from("orders")
      .select("*")
      .order("date", { ascending: false }),
    supabaseAdmin
      .from("pos_sales")
      .select("customer_id, total, voided, refund_amount, date")
      .not("customer_id", "is", null),
  ]);

  if (errC) return NextResponse.json({ ok: false, error: errC.message }, { status: 500 });
  if (errO) return NextResponse.json({ ok: false, error: errO.message }, { status: 500 });
  if (errP) return NextResponse.json({ ok: false, error: errP.message }, { status: 500 });

  // Group orders by customer so the map step is O(1) per customer instead of
  // O(N) — same pattern the endpoint already used for orders.
  const ordersByCustomer = new Map<string, unknown[]>();
  for (const o of orders ?? []) {
    const arr = ordersByCustomer.get(o.customer_id) ?? [];
    arr.push(o);
    ordersByCustomer.set(o.customer_id, arr);
  }

  // Build the spend / visit / lastVisit aggregate. Both channels are netted of
  // refunds — see spendContribution() above. POS sales mirror the same rule:
  // a refunded sale contributes total-refund (£0 when fully refunded, but still
  // a visit); a voided sale with no refund was reversed before money was kept,
  // so it's skipped entirely (Bug #6 — previously ALL voided POS sales were
  // dropped, overcounting the reduction for partial refunds).
  const agg = new Map<string, AggregateBucket>();
  const bumpAgg = (cid: string, amount: number, when: string) => {
    const bucket = agg.get(cid) ?? { spend: 0, visits: 0, lastVisit: null };
    bucket.spend  += amount;
    bucket.visits += 1;
    const iso = typeof when === "string" ? when : new Date(when).toISOString();
    if (!bucket.lastVisit || iso > bucket.lastVisit) bucket.lastVisit = iso;
    agg.set(cid, bucket);
  };

  for (const o of orders ?? []) {
    if (!o.customer_id) continue;
    const { amount, counts } = spendContribution(o);
    if (!counts) continue;
    bumpAgg(o.customer_id, amount, o.date);
  }
  for (const s of posSales ?? []) {
    if (!s.customer_id) continue;
    const total  = Number(s.total) || 0;
    const refund = Number(s.refund_amount) || 0;
    if (s.voided && refund <= 0) continue; // reversed, no money kept
    bumpAgg(s.customer_id, Math.max(0, total - refund), s.date);
  }

  // Belt-and-braces: also skip the sentinel during the map step in case any
  // future query change drops the .neq filter. The sentinel must never reach
  // CustomersPanel.tsx or any other admin renderer.
  const result = (customers ?? [])
    .filter((c) => c.id !== POS_WALK_IN_ID)
    .map((c) =>
      mapCustomer(
        c,
        ordersByCustomer.get(c.id) ?? [],
        agg.get(c.id) ?? { spend: 0, visits: 0, lastVisit: null },
      ),
    );

  // Orphan orders — customer_id was set null when admin deleted the account
  // (FK on delete set null). The order rows themselves are preserved for
  // financial audit; we surface them under a synthetic "Deleted customer"
  // pseudo-row so admin reports / delivery / refunds keep showing them.
  const orphanOrders = (orders ?? []).filter((o) => !o.customer_id);
  if (orphanOrders.length > 0) {
    const orphanContribs = orphanOrders.map(spendContribution);
    const orphanSpend = orphanContribs.reduce((sum, c) => sum + c.amount, 0);
    const orphanVisits = orphanContribs.filter((c) => c.counts).length;
    const orphanLastVisit = orphanOrders
      .map((o) => (typeof o.date === "string" ? o.date : new Date(o.date).toISOString()))
      .sort()
      .pop() ?? null;
    result.push({
      id:              "__deleted__",
      name:            "Deleted customer",
      email:           "",
      phone:           "",
      tags:            ["deleted"],
      favourites:      [],
      savedAddresses: [],
      storeCredit:    undefined,
      emailVerified:  undefined,
      active:         false,
      loyaltyPoints:   0,
      giftCardBalance: 0,
      notes:           "Orders from accounts the admin has deleted. Preserved for audit.",
      totalSpend:      parseFloat(orphanSpend.toFixed(2)),
      visitCount:      orphanVisits,
      lastVisit:       orphanLastVisit ?? undefined,
      createdAt:       orphanOrders[0]?.date
                         ? (typeof orphanOrders[0].date === "string"
                              ? orphanOrders[0].date
                              : new Date(orphanOrders[0].date).toISOString())
                         : new Date().toISOString(),
      orders:          orphanOrders.map(mapOrder),
    });
  }

  return NextResponse.json({ ok: true, customers: result });
}
