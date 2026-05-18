/**
 * POST /api/customers/[id]/spend-credit — deduct store credit at checkout.
 * Fetches the current balance server-side so the client cannot set an
 * arbitrary balance. The resulting balance is floored at 0.
 * Requires a customer session matching the [id] in the URL — a customer may
 * only spend their own store credit.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";
import { parseBody }                 from "@/lib/apiValidation";
import { SpendCreditSchema }         from "@/lib/schemas/waiter";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await getCustomerSession();
  if (!session || session.id !== id) return unauthorizedJson();

  const parsed = await parseBody(req, SpendCreditSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { amount } = parsed.data;

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
