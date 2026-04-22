/**
 * POST /api/customers/[id]/spend-credit — deduct store credit at checkout.
 * Fetches the current balance server-side so the client cannot set an
 * arbitrary balance. The resulting balance is floored at 0.
 * No admin auth required — this is called during customer checkout.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { amount?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const amount = body.amount;
  if (typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ ok: false, error: "'amount' must be a positive number." }, { status: 400 });
  }

  // Fetch current balance from DB — client cannot influence the resulting value
  const { data, error: fetchErr } = await supabaseAdmin
    .from("customers")
    .select("store_credit")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  }

  const newBalance = Math.max(0, (Number(data.store_credit) || 0) - amount);

  const { error: updateErr } = await supabaseAdmin
    .from("customers")
    .update({ store_credit: newBalance })
    .eq("id", id);

  if (updateErr) {
    console.error("customers/[id]/spend-credit POST:", updateErr.message);
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, newBalance });
}
