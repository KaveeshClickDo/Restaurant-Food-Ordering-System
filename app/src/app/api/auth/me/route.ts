/**
 * GET /api/auth/me — returns the currently logged-in customer with their orders.
 * Reads the httpOnly session cookie, verifies the HMAC token,
 * and returns safe customer fields (no password_hash).
 *
 * Orders are fetched in a separate query (not via PostgREST join) so this
 * route works even when the orders.customer_id → customers.id FK constraint
 * is absent from the schema.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCustomer(row: any, orders: any[]) {
  return {
    id:             row.id,
    name:           row.name,
    email:          row.email,
    phone:          row.phone ?? "",
    tags:           row.tags ?? [],
    favourites:     row.favourites ?? [],
    savedAddresses: row.saved_addresses ?? [],
    storeCredit:    row.store_credit ? Number(row.store_credit) : undefined,
    emailVerified:  row.email_verified ?? undefined,
    createdAt:      typeof row.created_at === "string"
                      ? row.created_at
                      : new Date(row.created_at).toISOString(),
    orders: orders
      .map(mapOrder)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
  };
}

export async function GET() {
  const session = await getCustomerSession();
  if (!session) return unauthorizedJson();

  // Fetch customer profile — try with email_verified, fall back if column missing
  let customerRow: Record<string, unknown> | null = null;

  const { data: withVerified, error: errWithVerified } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, tags, favourites, saved_addresses, store_credit, created_at, email_verified")
    .eq("id", session.id)
    .single();

  if (!errWithVerified && withVerified) {
    customerRow = withVerified;
  } else if (errWithVerified?.code === "PGRST204" && errWithVerified.message.includes("email_verified")) {
    // email_verified column not yet added — retry without it
    const { data: basic, error: errBasic } = await supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, tags, favourites, saved_addresses, store_credit, created_at")
      .eq("id", session.id)
      .single();

    if (errBasic || !basic) return unauthorizedJson();
    customerRow = basic;
  } else {
    return unauthorizedJson();
  }

  // Fetch orders in a separate query — avoids dependency on FK constraint
  const { data: ordersData } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("customer_id", session.id)
    .order("date", { ascending: false });

  return NextResponse.json({
    ok:       true,
    customer: buildCustomer(customerRow, ordersData ?? []),
  });
}
