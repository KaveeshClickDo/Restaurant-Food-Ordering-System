/**
 * PATCH /api/customers/[id] — customer self-service profile update.
 * Only a strict allowlist of fields can be written: favourites, saved_addresses,
 * name, and phone. Sensitive fields (store_credit, tags, password, email) are
 * explicitly blocked so a caller can never escalate their own privileges.
 * No admin auth required — this is the customer-facing update path.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";

const ALLOWED_FIELDS = new Set(["favourites", "saved_addresses", "name", "phone"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  // Strip any field not in the allowlist
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(key)) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No allowed fields provided." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("customers").update(patch).eq("id", id);
  if (error) {
    console.error("customers/[id] PATCH:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
