/**
 * POST /api/auth/register — public customer self-registration.
 * Validates input server-side and inserts via the service role key,
 * so the anon key never needs INSERT permission on the customers table.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  let body: { id?: string; name?: string; email?: string; phone?: string; password?: string; createdAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { id, name, email, phone, password, createdAt } = body;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!id || !name?.trim() || !email?.trim() || !password) {
    return NextResponse.json({ ok: false, error: "id, name, email, and password are required." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ ok: false, error: "Invalid email address." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ ok: false, error: "Password must be at least 6 characters." }, { status: 400 });
  }

  // ── Duplicate email check ─────────────────────────────────────────────────
  const { data: existing } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: false, error: "An account with this email already exists." }, { status: 409 });
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const { error } = await supabaseAdmin.from("customers").insert({
    id,
    name:       name.trim(),
    email:      email.trim().toLowerCase(),
    phone:      phone?.trim() ?? "",
    password:   password,
    created_at: createdAt ?? new Date().toISOString(),
    tags:       [],
    favourites: [],
    saved_addresses: [],
    store_credit: 0,
  });

  if (error) {
    console.error("auth/register:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
