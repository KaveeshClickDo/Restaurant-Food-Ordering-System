/**
 * posDeviceToken.ts — POS tablet "device refresh tokens" (B2).
 *
 * After a successful PASSWORD login on the Android POS, the server issues a
 * long-lived, opaque token to that device. The tablet stores it (encrypted) and
 * — once the cashier unlocks with their local PIN — exchanges it at
 * /api/pos/auth/refresh for a fresh session cookie, WITHOUT re-entering the
 * password. The PIN never reaches the server; the token does the refreshing.
 *
 * Security:
 *  - The raw token is 256 bits of randomness, returned to the device ONCE.
 *  - Only its sha256 hash is stored (`pos_device_tokens.token_hash`).
 *  - Tokens are revoked on password/PIN change or deactivation, and expire after
 *    30 days (forcing a periodic password re-auth — the "hygiene" rule).
 *  - One row per (staff_id, device_id); re-enrolling a device replaces its token.
 */

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TOKEN_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function hashDeviceToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Issue (or replace) the device token for a (staff, device) pair.
 * Returns the RAW token — the only time it leaves the server.
 */
export async function issueDeviceToken(
  staffId: string,
  deviceId: string,
  deviceLabel?: string | null,
): Promise<string | null> {
  const raw = crypto.randomBytes(32).toString("hex");
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("pos_device_tokens")
    .upsert(
      {
        staff_id:     staffId,
        device_id:    deviceId,
        token_hash:   hashDeviceToken(raw),
        device_label: deviceLabel ?? null,
        created_at:   nowIso,
        last_used_at: null,
        expires_at:   new Date(Date.now() + TOKEN_TTL_DAYS * DAY_MS).toISOString(),
        revoked:      false,
      },
      { onConflict: "staff_id,device_id" },
    );
  if (error) {
    console.error("[posDeviceToken issue]", error.message);
    return null;
  }
  return raw;
}

/**
 * Validate a raw token for a (staff, device). Returns true only if the hash
 * matches and the row is neither revoked nor expired. On success, best-effort
 * bumps last_used_at.
 */
export async function validateDeviceToken(
  staffId: string,
  deviceId: string,
  raw: string,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("pos_device_tokens")
    .select("token_hash, revoked, expires_at")
    .eq("staff_id", staffId)
    .eq("device_id", deviceId)
    .maybeSingle();

  if (!data || data.revoked) return false;
  if (new Date(data.expires_at).getTime() <= Date.now()) return false;

  const expected = data.token_hash as string;
  const actual = hashDeviceToken(raw);
  if (expected.length !== actual.length) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  if (!ok) return false;

  void supabaseAdmin
    .from("pos_device_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("staff_id", staffId)
    .eq("device_id", deviceId);

  return true;
}

/**
 * Revoke ALL device tokens for a staff member — called whenever their password
 * or PIN changes, or they're deactivated, so no tablet can keep refreshing with
 * a stale credential. The cashier must re-enter the (new) password next time.
 */
export async function revokeDeviceTokens(staffId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("pos_device_tokens")
    .update({ revoked: true })
    .eq("staff_id", staffId);
  if (error) console.error("[posDeviceToken revoke]", error.message);
}
