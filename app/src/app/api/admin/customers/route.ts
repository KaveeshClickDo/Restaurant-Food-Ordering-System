/**
 * POST /api/admin/customers — admin creates a customer record directly.
 * Requires a valid admin session cookie.
 */

import { NextRequest, NextResponse }            from "next/server";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { supabaseAdmin }                        from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.id || !body.name || !body.email) {
    return NextResponse.json({ ok: false, error: "id, name, and email are required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("customers").insert(body);
  if (error) {
    console.error("admin/customers POST:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
