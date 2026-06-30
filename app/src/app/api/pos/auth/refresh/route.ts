/**
 * POST /api/pos/auth/refresh — exchange a device token for a fresh POS session.
 *
 * B2 tablet flow: after the cashier unlocks locally with their PIN, the app
 * sends the stored device token here to mint a new session cookie WITHOUT the
 * password. The PIN is validated on the device and never reaches the server —
 * this endpoint only ever trusts a valid (unrevoked, unexpired) device token.
 *
 * Reads only the session owner's pos_staff row. The token's validity already
 * proves enrollment; we still re-check the staff is active and bake the current
 * session_version into the cookie so an admin reset/deactivation takes effect.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSessionToken, setSessionCookie, COOKIE_POS } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";
import { parseBody } from "@/lib/apiValidation";
import { PosDeviceRefreshSchema } from "@/lib/schemas/auth";
import { validateDeviceToken } from "@/lib/posDeviceToken";

const POS_SESSION_HOURS = 8;
const PUBLIC_COLUMNS = "id, name, email, role, active, permissions, hourly_rate, avatar_color, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStaff(row: any) {
  return {
    id:          row.id,
    name:        row.name,
    email:       row.email ?? "",
    role:        row.role,
    active:      row.active,
    permissions: row.permissions ?? {},
    hourlyRate:  row.hourly_rate ?? undefined,
    avatarColor: row.avatar_color,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
  };
}

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, PosDeviceRefreshSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { staffId, deviceId, deviceToken } = parsed.data;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const { limited } = rateLimit(`pos-refresh:${ip}:${staffId}`, 20, 60_000);
  if (limited) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  try {
    const valid = await validateDeviceToken(staffId, deviceId, deviceToken);
    if (!valid) {
      // Expired / revoked / unknown token → the tablet must fall back to password.
      return NextResponse.json({ ok: false, error: "device_token_invalid" }, { status: 401 });
    }

    const { data: member } = await supabaseAdmin
      .from("pos_staff")
      .select(`${PUBLIC_COLUMNS}, session_version`)
      .eq("id", staffId)
      .eq("active", true)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ ok: false, error: "device_token_invalid" }, { status: 401 });
    }

    const token = createSessionToken(
      {
        id:             staffId,
        role:           "pos",
        sessionVersion: Number(member.session_version ?? 1),
      },
      POS_SESSION_HOURS * 60 * 60 * 1000,
    );

    const res = NextResponse.json({ ok: true, staff: mapStaff(member) });
    setSessionCookie(res, COOKIE_POS, token);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[pos/auth/refresh POST]", message);
    return NextResponse.json({ ok: false, error: "Refresh failed. Please try again." }, { status: 500 });
  }
}
