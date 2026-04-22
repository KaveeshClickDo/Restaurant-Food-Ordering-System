/**
 * POST /api/admin/seed — seed initial categories and menu items if the tables are empty.
 * This route uses the service role key so it works even with RLS enabled.
 * It is safe to call repeatedly — it's a no-op if data already exists.
 * No admin auth required (seeding is only additive and idempotent).
 */

import { NextResponse }                from "next/server";
import { supabaseAdmin }               from "@/lib/supabaseAdmin";
import { categories as defaultCategories, menuItems as defaultMenuItems } from "@/data/menu";
import { mockCustomers }               from "@/data/customers";

function categoryToRow(c: { id: string; name: string; emoji: string }, order: number) {
  return { id: c.id, name: c.name, emoji: c.emoji, sort_order: order };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function menuItemToRow(m: any) {
  return {
    id: m.id, category_id: m.categoryId,
    name: m.name, description: m.description ?? "",
    price: m.price, image: m.image ?? "",
    dietary: m.dietary ?? [], popular: m.popular ?? false,
    variations: m.variations ?? [], add_ons: m.addOns ?? [],
    stock_qty: m.stockQty ?? null, stock_status: m.stockStatus ?? "in_stock",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function customerToRow(c: any) {
  return {
    id: c.id, name: c.name, email: c.email,
    phone: c.phone ?? "", password: c.password ?? "",
    created_at: c.createdAt,
    tags: c.tags ?? [], favourites: c.favourites ?? [],
    saved_addresses: c.savedAddresses ?? [],
    store_credit: c.storeCredit ?? 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orderToRow(o: any) {
  return {
    id: o.id, customer_id: o.customerId, date: o.date,
    status: o.status, fulfillment: o.fulfillment, total: o.total,
    items: o.items,
    address: o.address ?? "", note: o.note ?? "",
    payment_method: o.paymentMethod ?? "",
    delivery_fee: o.deliveryFee ?? 0, service_fee: o.serviceFee ?? 0,
    scheduled_time: o.scheduledTime ?? "", coupon_code: o.couponCode ?? "",
    coupon_discount: o.couponDiscount ?? 0,
    vat_amount: o.vatAmount ?? 0, vat_inclusive: o.vatInclusive ?? true,
    driver_id: o.driverId ?? "", driver_name: o.driverName ?? "",
    delivery_status: o.deliveryStatus ?? "",
    refunds: o.refunds ?? [],
    refunded_amount: o.refundedAmount ?? 0,
    store_credit_used: o.storeCreditUsed ?? 0,
  };
}

export async function POST() {
  const results: string[] = [];

  // ── Categories ──────────────────────────────────────────────────────────────
  const { data: existingCats } = await supabaseAdmin
    .from("categories").select("id").limit(1);

  if (!existingCats || existingCats.length === 0) {
    const rows = defaultCategories.map((c, i) => categoryToRow(c, i));
    const { error } = await supabaseAdmin.from("categories").insert(rows);
    if (error) results.push(`categories: ${error.message}`);
    else results.push("categories: seeded");
  } else {
    results.push("categories: already populated, skipped");
  }

  // ── Menu items ──────────────────────────────────────────────────────────────
  const { data: existingItems } = await supabaseAdmin
    .from("menu_items").select("id").limit(1);

  if (!existingItems || existingItems.length === 0) {
    const rows = defaultMenuItems.map(menuItemToRow);
    const { error } = await supabaseAdmin.from("menu_items").insert(rows);
    if (error) results.push(`menu_items: ${error.message}`);
    else results.push("menu_items: seeded");
  } else {
    results.push("menu_items: already populated, skipped");
  }

  // ── Mock customers + orders ─────────────────────────────────────────────────
  const { data: existingCusts } = await supabaseAdmin
    .from("customers").select("id").limit(1);

  if (!existingCusts || existingCusts.length === 0) {
    for (const c of mockCustomers) {
      const { error: custErr } = await supabaseAdmin
        .from("customers").insert(customerToRow(c));
      if (custErr) { results.push(`customer ${c.id}: ${custErr.message}`); continue; }
      if (c.orders.length > 0) {
        const { error: ordErr } = await supabaseAdmin
          .from("orders").insert(c.orders.map(orderToRow));
        if (ordErr) results.push(`orders for ${c.id}: ${ordErr.message}`);
      }
    }
    results.push("customers: seeded");
  } else {
    results.push("customers: already populated, skipped");
  }

  // ── POS walk-in sentinel customer ──────────────────────────────────────────
  // Always ensure this record exists so POS → KDS order routing works,
  // even on a fresh installation before any real customers are registered.
  const { error: walkInErr } = await supabaseAdmin.from("customers").upsert(
    {
      id:             "pos-walk-in",
      name:           "POS Walk-in",
      email:          "pos-walkin@internal",
      phone:          "",
      password:       "",
      tags:           [],
      favourites:     [],
      saved_addresses: [],
      store_credit:   0,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (walkInErr) results.push(`pos-walk-in: ${walkInErr.message}`);
  else           results.push("pos-walk-in: ensured");

  return NextResponse.json({ ok: true, results });
}
