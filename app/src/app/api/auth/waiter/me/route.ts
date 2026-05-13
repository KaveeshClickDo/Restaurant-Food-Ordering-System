/**
 * GET /api/auth/waiter/me — returns the current waiter from the session cookie.
 * Used by the waiter UI to validate the cookie on mount so a stale or expired
 * session triggers an immediate re-login instead of failing on the first
 * mutation request.
 *
 * Reads from the waiters table; pin_hash is never returned.
 */

import { NextResponse }      from "next/server";
import { supabaseAdmin }     from "@/lib/supabaseAdmin";
import { getWaiterSession }  from "@/lib/auth";

export async function GET() {
  const session = await getWaiterSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  try {
    const { data: waiter } = await supabaseAdmin
      .from("waiters")
      .select("id, name, email, active, hourly_rate, avatar_color, created_at")
      .eq("id", session.id)
      .eq("active", true)
      .maybeSingle();

    if (!waiter) return NextResponse.json({ ok: false }, { status: 401 });
    return NextResponse.json({ ok: true, waiter });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[auth/waiter/me]", message);
    return NextResponse.json({ ok: false, error: "Failed to fetch staff." }, { status: 500 });
  }
}
