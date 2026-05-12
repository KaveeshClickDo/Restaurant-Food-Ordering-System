/**
 * GET /api/auth/waiter/me — returns the current waiter from the session cookie.
 * Used by the waiter UI to validate the cookie on mount so a stale or expired
 * session triggers an immediate re-login instead of failing on the first
 * mutation request.
 *
 * Mirrors /api/auth/driver/me. The PIN is never returned.
 */

import { NextResponse }      from "next/server";
import { supabaseAdmin }     from "@/lib/supabaseAdmin";
import { getWaiterSession }  from "@/lib/auth";
import type { WaiterStaff }  from "@/types";

export async function GET() {
  const session = await getWaiterSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    const { data: row } = await supabaseAdmin
      .from("app_settings").select("data").limit(1).single();

    const waiters: WaiterStaff[] = row?.data?.waiters ?? [];
    const waiter = waiters.find((w) => w.id === session.id && w.active);
    if (!waiter) return NextResponse.json({ ok: false }, { status: 401 });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pin: _p, ...safe } = waiter;
    return NextResponse.json({ ok: true, waiter: safe });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[auth/waiter/me]", message);
    return NextResponse.json({ ok: false, error: "Failed to fetch staff." }, { status: 500 });
  }
}
