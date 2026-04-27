/**
 * POST /api/waiter/auth
 * Validates a waiter's PIN against app_settings.
 * Sets an httpOnly session cookie on success.
 * Falls back to seed defaults if no waiters are configured yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import type { WaiterStaff }          from "@/types";
import {
  createSessionToken,
  setSessionCookie,
  COOKIE_WAITER,
} from "@/lib/auth";

const SEED_WAITERS: WaiterStaff[] = [
  { id: "w-1", name: "Head Waiter", pin: "1111", role: "senior", active: true, avatarColor: "#7c3aed", createdAt: "" },
  { id: "w-2", name: "Alex",        pin: "2222", role: "waiter",  active: true, avatarColor: "#0891b2", createdAt: "" },
  { id: "w-3", name: "Sophie",      pin: "3333", role: "waiter",  active: true, avatarColor: "#16a34a", createdAt: "" },
];

export async function POST(req: NextRequest) {
  let body: { staffId?: string; pin?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const { staffId, pin } = body;
  if (!staffId || !pin) {
    return NextResponse.json({ ok: false, error: "staffId and pin are required." }, { status: 400 });
  }

  const { data: row } = await supabaseAdmin
    .from("app_settings").select("data").limit(1).single();

  const waiters: WaiterStaff[] = row?.data?.waiters?.length
    ? row.data.waiters
    : SEED_WAITERS;

  const waiter = waiters.find((w) => w.id === staffId && w.active);
  if (!waiter || waiter.pin !== pin) {
    return NextResponse.json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pin: _p, ...safe } = waiter;

  const token = createSessionToken({ id: staffId, role: "waiter" });
  const res = NextResponse.json({ ok: true, waiter: safe });
  setSessionCookie(res, COOKIE_WAITER, token);
  return res;
}
