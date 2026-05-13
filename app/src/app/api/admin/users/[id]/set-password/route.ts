/**
 * POST /api/admin/users/[id]/set-password — admin sets a user's password or PIN.
 *
 * Body: { type, password?, pin? }
 * Requires admin authentication.
 */

import { NextRequest, NextResponse }                   from "next/server";
import bcrypt                                          from "bcryptjs";
import { supabaseAdmin }                               from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse }  from "@/lib/adminAuth";

interface SetPasswordBody {
  type?: string;
  password?: string;
  pin?: string;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { id } = await context.params;

  let body: SetPasswordBody;
  try {
    body = await req.json() as SetPasswordBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { type, password, pin } = body;

  if (!type) {
    return NextResponse.json({ ok: false, error: "type is required." }, { status: 400 });
  }

  // ── Customer ──────────────────────────────────────────────────────────────
  if (type === "customer") {
    if (!password || password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 6 characters." },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { error } = await supabaseAdmin
      .from("customers")
      .update({ password_hash: passwordHash })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  // ── Driver ────────────────────────────────────────────────────────────────
  if (type === "driver") {
    if (!password || password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 6 characters." },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { error } = await supabaseAdmin
      .from("drivers")
      .update({ password_hash: passwordHash })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  // ── Staff PINs (waiter / kitchen / pos) ───────────────────────────────────
  // Waiter and kitchen accept 4–6 digits; POS PINs are strictly 4 digits.
  // The PIN is bcrypt-hashed and written to the matching staff table's
  // pin_hash column.
  if (type === "waiter" || type === "kitchen" || type === "pos") {
    const re = type === "pos" ? /^\d{4}$/ : /^\d{4,6}$/;
    if (!pin || !re.test(pin)) {
      return NextResponse.json(
        { ok: false, error: type === "pos" ? "PIN must be exactly 4 digits." : "PIN must be 4–6 digits." },
        { status: 400 },
      );
    }

    const table = type === "waiter" ? "waiters"
                : type === "kitchen" ? "kitchen_staff"
                : "pos_staff";

    const pinHash = await bcrypt.hash(pin, 10);
    const { error } = await supabaseAdmin
      .from(table)
      .update({ pin_hash: pinHash })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  if (type === "admin") {
    return NextResponse.json(
      { ok: false, error: "Admin password is set via ADMIN_PASSWORD env var." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: false, error: `Unknown type: ${type}` }, { status: 400 });
}
