/**
 * GET /api/auth/me — returns the currently logged-in customer.
 * Reads the httpOnly session cookie, verifies the HMAC token,
 * and returns safe customer fields (no password_hash).
 */

import { NextResponse }   from "next/server";
import { supabaseAdmin }  from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCustomer(row: any) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orders: (row.orders as any[] ?? []).map((o: any) => ({
      id:              o.id,
      customerId:      o.customer_id,
      date:            typeof o.date === "string" ? o.date : new Date(o.date).toISOString(),
      status:          o.status,
      fulfillment:     o.fulfillment,
      total:           Number(o.total),
      items:           o.items ?? [],
      address:         o.address   || undefined,
      note:            o.note      || undefined,
      paymentMethod:   o.payment_method  || undefined,
      deliveryFee:     o.delivery_fee    ? Number(o.delivery_fee)    : undefined,
      couponCode:      o.coupon_code     || undefined,
      couponDiscount:  o.coupon_discount ? Number(o.coupon_discount) : undefined,
      refunds:         o.refunds ?? [],
      refundedAmount:  o.refunded_amount  ? Number(o.refunded_amount)  : undefined,
      storeCreditUsed: o.store_credit_used ? Number(o.store_credit_used) : undefined,
    })).sort((a: { date: string }, b: { date: string }) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    ),
  };
}

export async function GET() {
  const session = await getCustomerSession();
  if (!session) return unauthorizedJson();

  // Try with email_verified first
  const { data: full, error: errFull } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, tags, favourites, saved_addresses, store_credit, created_at, email_verified, orders(*)")
    .eq("id", session.id)
    .single();

  if (!errFull && full) {
    return NextResponse.json({ ok: true, customer: buildCustomer(full) });
  }

  // email_verified column not yet in DB — retry without it
  if (errFull?.code === "PGRST204" && errFull.message.includes("email_verified")) {
    const { data: basic, error: errBasic } = await supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, tags, favourites, saved_addresses, store_credit, created_at, orders(*)")
      .eq("id", session.id)
      .single();

    if (errBasic || !basic) return unauthorizedJson();
    return NextResponse.json({ ok: true, customer: buildCustomer(basic) });
  }

  return unauthorizedJson();
}
