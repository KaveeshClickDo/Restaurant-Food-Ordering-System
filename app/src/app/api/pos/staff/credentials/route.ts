/**
 * GET /api/pos/staff/credentials — the CALLING staff member's own PIN hash,
 * for the tablet's local PIN unlock (B2) + offline login.
 *
 * Returns the bcrypt `pin_hash` + `session_version` for ONLY the session owner
 * (never another staff member's row), so the Capacitor app can cache it and
 * validate the 6-digit PIN locally with no network. The PIN itself never reaches
 * the server; sessions are minted from the password or a device token. Security:
 *   - Gated by a valid POS session (the cookie identifies whose row to return).
 *   - Scoped to `where id = session.id` — a stolen cookie can't read other
 *     cashiers' hashes (and the owner sets their own PIN with the admin).
 *   - Rate-limited, so it can't be used as a bulk oracle.
 *
 * Note: the value is a bcrypt HASH, not the PIN. The on-device credentials table
 * is encrypted (SQLCipher); a 6-digit PIN is otherwise brute-forceable against a
 * stolen plaintext-hash DB. Returns ok:false when no PIN is set yet (the tablet
 * then keeps using password login).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosSession } from "@/lib/posPermissions";
import { rateLimit } from "@/lib/rateLimit";

export async function GET() {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;
  const session = gate.staff;

  const { limited } = rateLimit(`pos-cred:${session.id}`, 5, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  try {
    const { data } = await supabaseAdmin
      .from("pos_staff")
      .select("id, pin_hash, session_version")
      .eq("id", session.id)
      .eq("active", true)
      .maybeSingle();

    if (!data || !data.pin_hash) {
      // No PIN set for this staff yet → tablet keeps using password login.
      return NextResponse.json({ ok: false, error: "no_pin_set" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      credentials: {
        staffId:        data.id,
        pinHash:        data.pin_hash,
        sessionVersion: Number(data.session_version ?? 1),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[pos/staff/credentials GET]", message);
    return NextResponse.json({ ok: false, error: "Failed to load credentials." }, { status: 500 });
  }
}
