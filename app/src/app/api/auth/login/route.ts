/**
 * POST /api/auth/login — customer login.
 * Verifies the supplied password against the bcrypt-hashed `password_hash`
 * column. The legacy plaintext `password` column was dropped in the latest
 * schema migration. Sets an httpOnly session cookie on success.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt                        from "bcryptjs";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import {
  createSessionToken,
  setSessionCookie,
  COOKIE_CUSTOMER,
  unauthorizedJson,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/apiValidation";
import { LoginSchema } from "@/lib/schemas/auth";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`login:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many login attempts. Please wait a minute." }, { status: 429 });
  }

  const parsed = await parseBody(req, LoginSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { email, password } = parsed.data;

  const { data, error: fetchErr } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, password_hash, email_verified, active, tags, favourites, saved_addresses, store_credit, created_at")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (fetchErr || !data) return unauthorizedJson();
  if (!data.password_hash) return unauthorizedJson();

  const valid = await bcrypt.compare(password, data.password_hash);
  if (!valid) return unauthorizedJson();

  // ── Account disabled gate ─────────────────────────────────────────────────
  // Admin can deactivate customer accounts from User Management. We still
  // verify the password first so an attacker can't enumerate "is this email
  // deactivated?" — the wrong-password path returns 401 the same as inactive.
  if (data.active === false) {
    return NextResponse.json({
      ok: false,
      error: "This account has been disabled. Please contact the restaurant if you believe this is a mistake.",
    }, { status: 403 });
  }

  // ── Email verification gate ───────────────────────────────────────────────
  // Only block when email_verified is explicitly false. Accounts created
  // before the auth migration have a null/undefined value and are grandfathered
  // in — only post-migration registrations must verify before logging in.
  if (data.email_verified === false) {
    return NextResponse.json({
      ok: false,
      error: "Please verify your email before signing in. Check your inbox for the confirmation link.",
      needsVerification: true,
      email: data.email,
    }, { status: 403 });
  }

  // Fetch the customer's orders so the account page can render them immediately
  // without a second round-trip. An error here is non-fatal — orders: [] is
  // fine because the account page will refresh them after mount anyway.
  const { data: ordersData } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("customer_id", data.id)
    .order("date", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapOrder = (o: any) => ({
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
  });

  const token = createSessionToken({ id: data.id, role: "customer" });
  const res = NextResponse.json({
    ok: true,
    customer: {
      id:             data.id,
      name:           data.name,
      email:          data.email,
      phone:          data.phone ?? "",
      tags:           data.tags ?? [],
      favourites:     data.favourites ?? [],
      savedAddresses: data.saved_addresses ?? [],
      storeCredit:    data.store_credit ? Number(data.store_credit) : undefined,
      createdAt:      typeof data.created_at === "string"
                        ? data.created_at
                        : new Date(data.created_at).toISOString(),
      orders:         (ordersData ?? []).map(mapOrder),
    },
  });
  setSessionCookie(res, COOKIE_CUSTOMER, token);
  return res;
}
