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
import type { AdminSettings, WaiterStaff }             from "@/types";

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
      .update({ password_hash: passwordHash, password: "" })
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

  // ── Waiter ────────────────────────────────────────────────────────────────
  if (type === "waiter") {
    if (!pin || !/^\d{4}$/.test(pin)) {
      return NextResponse.json(
        { ok: false, error: "PIN must be exactly 4 digits." },
        { status: 400 },
      );
    }

    const { data: settingsRow, error: settingsError } = await supabaseAdmin
      .from("app_settings")
      .select("data")
      .limit(1)
      .single();

    if (settingsError) {
      return NextResponse.json({ ok: false, error: settingsError.message }, { status: 500 });
    }

    const settings = (settingsRow?.data ?? {}) as AdminSettings;
    const waiters  = settings.waiters ?? [];
    const idx      = waiters.findIndex((w: WaiterStaff) => w.id === id);

    if (idx === -1) {
      return NextResponse.json({ ok: false, error: "Waiter not found." }, { status: 404 });
    }

    const newWaiters = [...waiters];
    newWaiters[idx]  = { ...newWaiters[idx], pin };

    const { error: upsertError } = await supabaseAdmin
      .from("app_settings")
      .upsert({ data: { ...settings, waiters: newWaiters } });

    if (upsertError) {
      return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 });
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
