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
    // delivery_code MUST be mapped — /my-orders surfaces the 4-digit PIN to
    // the customer so they can read it to the driver. Same flow as the email
    // confirmation but mirrored in the UI in case the email was missed.
    deliveryCode:          o.delivery_code   || undefined,
    paymentStatus:         o.payment_status  ?? undefined,
    stripePaymentIntentId: o.stripe_payment_intent_id ?? null,
    stripeChargeId:        o.stripe_charge_id ?? null,
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
    refundedAmount:        o.refunded_amount  ? Number(o.refunded_amount)  : undefined,
    storeCreditUsed:       o.store_credit_used ? Number(o.store_credit_used) : undefined,
    giftCardUsed:          o.gift_card_used ? Number(o.gift_card_used) : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCustomer(row: any, orders: any[], posSpend: number) {
  return {
    posSpend: parseFloat(posSpend.toFixed(2)),
    id:             row.id,
    name:           row.name,
    email:          row.email,
    phone:          row.phone ?? "",
    tags:           row.tags ?? [],
    favourites:     row.favourites ?? [],
    savedAddresses: row.saved_addresses ?? [],
    storeCredit:    row.store_credit ? Number(row.store_credit) : undefined,
    emailVerified:  row.email_verified ?? undefined,
    // POS-shared balances (Bug #11). Surfaced on the customer's /account
    // Rewards tab and applied at checkout / at the till.
    loyaltyPoints:   row.loyalty_points    != null ? Number(row.loyalty_points)    : 0,
    giftCardBalance: row.gift_card_balance != null ? Number(row.gift_card_balance) : 0,
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

  // Fetch customer profile. Fresh-deploy schema includes email_verified +
  // active, so a single SELECT is enough.
  const { data: customerRow, error: cusErr } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, tags, favourites, saved_addresses, store_credit, created_at, email_verified, active, loyalty_points, gift_card_balance")
    .eq("id", session.id)
    .single();

  if (cusErr || !customerRow) return unauthorizedJson();

  // Mid-session deactivation: admin flipped this customer to inactive after
  // they signed in. Invalidate the session — they'll be sent back to login,
  // which will reject them with the friendly "account disabled" message.
  if (customerRow.active === false) return unauthorizedJson();

  // Fetch orders + this customer's in-person POS sales in parallel. The POS
  // sales aren't listed on the customer site, but their net total is folded
  // into "Total spent" so the figure matches admin + POS (which already count
  // both channels). Same net rule as those endpoints: a reversed sale that
  // kept no money (voided, no refund) is excluded; everything else is
  // total − refund.
  const [{ data: ordersData }, { data: posSalesData }] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("*")
      .eq("customer_id", session.id)
      .order("date", { ascending: false }),
    supabaseAdmin
      .from("pos_sales")
      .select("total, voided, refund_amount")
      .eq("customer_id", session.id),
  ]);

  const posSpend = (posSalesData ?? []).reduce((sum, s) => {
    const total  = Number(s.total) || 0;
    const refund = Number(s.refund_amount) || 0;
    if (s.voided && refund <= 0) return sum; // reversed, no money kept
    return sum + Math.max(0, total - refund);
  }, 0);

  return NextResponse.json({
    ok:       true,
    customer: buildCustomer(customerRow, ordersData ?? [], posSpend),
  });
}
