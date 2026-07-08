/**
 * /api/account/marketing — the signed-in customer's own marketing preference.
 *
 *   GET  → { ok, optedIn }   current state (contact row looked up by the
 *                            account email; no row yet counts as opted-in,
 *                            matching the capture default)
 *   POST → { optedIn: bool } explicit opt-in/opt-out from the /account page.
 *          Unlike the capture-form checkboxes, optIn=true here DOES
 *          re-subscribe — the customer deliberately flipped their own switch.
 *
 * Requires a customer session; always operates on the session account's email
 * (the browser never picks whose preference to change).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCustomerSession, unauthorizedJson } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { getMarketingOptInByEmail, setMarketingOptInByEmail } from "@/lib/marketingContacts";

const BodySchema = z.object({ optedIn: z.boolean() });

async function sessionCustomer(): Promise<{ id: string; email: string; name: string } | null> {
  const session = await getCustomerSession();
  if (!session) return null;
  const { data } = await supabaseAdmin
    .from("customers")
    .select("id, email, name")
    .eq("id", session.id)
    .maybeSingle();
  if (!data?.email) return null;
  return { id: data.id as string, email: data.email as string, name: (data.name as string) ?? "" };
}

export async function GET() {
  const cust = await sessionCustomer();
  if (!cust) return unauthorizedJson();

  const state = await getMarketingOptInByEmail(cust.email);
  // No contact row yet → they'd be created opted-in on their next capture.
  return NextResponse.json({ ok: true, optedIn: state ?? true });
}

export async function POST(req: NextRequest) {
  const cust = await sessionCustomer();
  if (!cust) return unauthorizedJson();

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const ok = await setMarketingOptInByEmail({
    email:      cust.email,
    optIn:      parsed.data.optedIn,
    source:     "account",
    name:       cust.name,
    customerId: cust.id,
  });
  if (!ok) return NextResponse.json({ ok: false, error: "Could not update your preference." }, { status: 500 });
  return NextResponse.json({ ok: true, optedIn: parsed.data.optedIn });
}
