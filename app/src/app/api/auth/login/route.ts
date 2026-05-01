/**
 * POST /api/auth/login — customer login.
 * Works with or without the auth_migration.sql having been run:
 *   - If password_hash column exists: verifies bcrypt hash there.
 *   - If not (or if password_hash is empty): tries bcrypt against the password
 *     column (set by the register fallback path), then plaintext comparison
 *     for accounts that pre-date bcrypt.
 * Sets an httpOnly session cookie on success.
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

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`login:${ip}`, 10, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many login attempts. Please wait a minute." }, { status: 429 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { email, password } = body;
  if (!email?.trim() || !password) {
    return NextResponse.json(
      { ok: false, error: "Email and password are required." },
      { status: 400 },
    );
  }

  // ── Fetch customer — try with password_hash, fall back if column missing ──
  let data: {
    id: string; name: string; email: string; phone: string | null;
    password: string | null; password_hash?: string | null;
    tags: string[] | null; favourites: string[] | null;
    saved_addresses: unknown[] | null; store_credit: number | null;
    created_at: string;
  } | null = null;

  const { data: withHash, error: errWithHash } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, password, password_hash, tags, favourites, saved_addresses, store_credit, created_at")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (errWithHash?.code === "PGRST204" && errWithHash.message.includes("password_hash")) {
    // Column doesn't exist yet — select without it
    const { data: withoutHash, error: errWithout } = await supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, password, tags, favourites, saved_addresses, store_credit, created_at")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (errWithout || !withoutHash) return unauthorizedJson();
    data = { ...withoutHash, password_hash: null };
  } else if (errWithHash || !withHash) {
    return unauthorizedJson();
  } else {
    data = withHash;
  }

  if (!data) return unauthorizedJson();

  // ── Password verification ─────────────────────────────────────────────────
  let valid = false;

  if (data.password_hash) {
    // Migration has been run — verify against dedicated hash column
    valid = await bcrypt.compare(password, data.password_hash);
  } else if (data.password) {
    // No password_hash column or it's empty — check the password column.
    // It may contain either a bcrypt hash (register fallback) or legacy plaintext.
    const isBcrypt = data.password.startsWith("$2");
    if (isBcrypt) {
      valid = await bcrypt.compare(password, data.password);
    } else {
      // Legacy plaintext — verify then migrate in-place
      valid = data.password === password;
      if (valid) {
        const hash = await bcrypt.hash(password, 10);
        // Try to write to password_hash; fall back to password column
        const { error: upErr } = await supabaseAdmin
          .from("customers")
          .update({ password_hash: hash, password: "" })
          .eq("id", data.id);
        if (upErr?.code === "PGRST204") {
          await supabaseAdmin
            .from("customers")
            .update({ password: hash })
            .eq("id", data.id);
        }
      }
    }
  }

  if (!valid) return unauthorizedJson();

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
