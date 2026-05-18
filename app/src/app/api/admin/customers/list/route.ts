/**
 * GET /api/admin/customers/list — admin-gated read of every customer + orders.
 *
 * Replaces the public `supabase.from("customers").select(...)` call that
 * AppContext used to make with the browser anon key (which leaked PII to
 * every visitor). Admin pages call this instead.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCustomer(row: any, orders: any[]) {
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
    createdAt:      typeof row.created_at === "string"
                      ? row.created_at
                      : new Date(row.created_at).toISOString(),
    orders:         orders.map(mapOrder),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrder(o: any) {
  return {
    id:              o.id,
    customerId:      o.customer_id,
    date:            typeof o.date === "string" ? o.date : new Date(o.date).toISOString(),
    status:          o.status,
    fulfillment:     o.fulfillment,
    total:           Number(o.total),
    items:           o.items ?? [],
    address:         o.address         || undefined,
    note:            o.note            || undefined,
    paymentMethod:   o.payment_method  || undefined,
    deliveryFee:     o.delivery_fee    ? Number(o.delivery_fee)    : undefined,
    serviceFee:      o.service_fee     ? Number(o.service_fee)     : undefined,
    scheduledTime:   o.scheduled_time  || undefined,
    couponCode:      o.coupon_code     || undefined,
    couponDiscount:  o.coupon_discount ? Number(o.coupon_discount) : undefined,
    vatAmount:       o.vat_amount      ? Number(o.vat_amount)      : undefined,
    vatInclusive:    o.vat_inclusive   ?? undefined,
    driverId:        o.driver_id       || undefined,
    driverName:      o.driver_name     || undefined,
    deliveryStatus:  o.delivery_status || undefined,
    refunds:         o.refunds         ?? [],
    refundedAmount:  o.refunded_amount  ? Number(o.refunded_amount)  : undefined,
    storeCreditUsed: o.store_credit_used ? Number(o.store_credit_used) : undefined,
  };
}

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  // Two queries — same pattern as /api/auth/me so we don't depend on a FK.
  const [{ data: customers, error: errC }, { data: orders, error: errO }] = await Promise.all([
    supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, tags, favourites, saved_addresses, store_credit, created_at, email_verified"),
    supabaseAdmin
      .from("orders")
      .select("*")
      .order("date", { ascending: false }),
  ]);

  if (errC) return NextResponse.json({ ok: false, error: errC.message }, { status: 500 });
  if (errO) return NextResponse.json({ ok: false, error: errO.message }, { status: 500 });

  const ordersByCustomer = new Map<string, unknown[]>();
  for (const o of orders ?? []) {
    const arr = ordersByCustomer.get(o.customer_id) ?? [];
    arr.push(o);
    ordersByCustomer.set(o.customer_id, arr);
  }

  const result = (customers ?? []).map((c) => mapCustomer(c, ordersByCustomer.get(c.id) ?? []));
  return NextResponse.json({ ok: true, customers: result });
}
