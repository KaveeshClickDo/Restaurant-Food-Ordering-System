/**
 * /api/pos/customers/[id]/marketing — a POS customer's marketing preference.
 *
 *   GET  → { ok, optedIn: boolean | null }  null = customer has no usable
 *          email (synthetic walk-in address), so there's nothing to subscribe.
 *   POST → { optedIn: boolean }             explicit toggle from the POS
 *          Customers tab — staff flipping it ON genuinely re-subscribes
 *          (customer asked at the till), unlike the pre-ticked capture boxes.
 *
 * Auth: POS staff session (same gate as the other /api/pos/customers routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosSession } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import {
  getMarketingOptInByEmail, setMarketingOptInByEmail, isMarketableEmail,
} from "@/lib/marketingContacts";

const BodySchema = z.object({ optedIn: z.boolean() });

async function loadCustomer(id: string): Promise<{ email: string; name: string } | null> {
  const { data } = await supabaseAdmin
    .from("customers")
    .select("email, name")
    .eq("id", id)
    .maybeSingle();
  if (!data?.email) return null;
  return { email: data.email as string, name: (data.name as string) ?? "" };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const cust = await loadCustomer(id);
  if (!cust) return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  if (!isMarketableEmail(cust.email)) {
    return NextResponse.json({ ok: true, optedIn: null }); // no real email on file
  }
  const state = await getMarketingOptInByEmail(cust.email);
  return NextResponse.json({ ok: true, optedIn: state ?? true });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const cust = await loadCustomer(id);
  if (!cust) return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  if (!isMarketableEmail(cust.email)) {
    return NextResponse.json({ ok: false, error: "This customer has no email on file." }, { status: 400 });
  }

  const ok = await setMarketingOptInByEmail({
    email:      cust.email,
    optIn:      parsed.data.optedIn,
    source:     "pos",
    name:       cust.name,
    customerId: id,
  });
  if (!ok) return NextResponse.json({ ok: false, error: "Could not update the preference." }, { status: 500 });
  return NextResponse.json({ ok: true, optedIn: parsed.data.optedIn });
}
