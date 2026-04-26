/**
 * POST /api/guest-profile
 * Upserts a guest profile in reservation_customers when an online order is placed.
 * No auth required — called client-side from CheckoutModal (anon user flow).
 * Email is the unique key. Increments order_count and total_spend atomically.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  let body: { name?: string; email?: string; phone?: string; orderTotal?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { name, email, phone, orderTotal } = body;

  // Email is the primary key for deduplication
  if (!email?.trim()) {
    return NextResponse.json({ ok: false, error: "email is required." }, { status: 400 });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName  = name?.trim()  ?? "";
  const cleanPhone = phone?.trim() ?? "";
  const spend      = typeof orderTotal === "number" && orderTotal > 0 ? orderTotal : 0;
  const now        = new Date().toISOString();

  // Fetch existing profile
  const { data: existing } = await supabaseAdmin
    .from("reservation_customers")
    .select("id, name, phone, order_count, total_spend, first_visit_at")
    .eq("email", cleanEmail)
    .single();

  if (existing) {
    // Update: increment counters, keep most-recent name/phone if provided
    const { error } = await supabaseAdmin
      .from("reservation_customers")
      .update({
        // Only overwrite name/phone if the caller provided a non-empty value
        ...(cleanName  ? { name: cleanName }   : {}),
        ...(cleanPhone ? { phone: cleanPhone }  : {}),
        order_count:   (existing.order_count  ?? 0) + 1,
        total_spend:   parseFloat(((existing.total_spend  ?? 0) + spend).toFixed(2)),
        last_order_at: now,
        updated_at:    now,
        // Only set first_visit_at if it was never set (reservation or previous order)
        ...(existing.first_visit_at ? {} : { first_visit_at: now }),
      })
      .eq("email", cleanEmail);

    if (error) {
      console.error("guest-profile PATCH:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  } else {
    // Insert new profile
    const { error } = await supabaseAdmin
      .from("reservation_customers")
      .insert({
        email:         cleanEmail,
        name:          cleanName,
        phone:         cleanPhone,
        visit_count:   0,
        order_count:   1,
        total_spend:   spend,
        first_visit_at: now,
        last_order_at: now,
        tags:          [],
        notes:         "",
        marketing_opt_in: false,
        created_at:    now,
        updated_at:    now,
      });

    if (error) {
      console.error("guest-profile INSERT:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
