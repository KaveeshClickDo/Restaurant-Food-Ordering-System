/**
 * GET /api/pos/staff/credentials — the CALLING staff member's own credentials,
 * for offline PIN login (Phase 4).
 *
 * Returns the bcrypt `pin_hash` + `session_version` for ONLY the session owner
 * (never another staff member's row), so the Capacitor app can cache it and
 * validate a PIN locally with no network. Security:
 *   - Gated by a valid POS session (the cookie identifies whose row to return).
 *   - Scoped to `where id = session.id` — a stolen cookie can't read other
 *     cashiers' hashes (and the owner already knows their own PIN).
 *   - Rate-limited, so it can't be used as a bulk oracle.
 *
 * Note: the value is a bcrypt HASH, not the PIN. Offline storage of the hash is
 * the plan's model; encrypting the on-device credentials table with a
 * device-bound key (Android Keystore) is a pre-production hardening step
 * (09-decisions / 07-phases § 4.3) — short PINs are brute-forceable against a
 * stolen plaintext-hash DB given enough time.
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
      return NextResponse.json({ ok: false }, { status: 401 });
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
