/**
 * PIN uniqueness for pos_staff (tablet quick-login).
 *
 * PINs are stored bcrypt-hashed (salted), so uniqueness cannot be a DB unique
 * index — the same PIN produces a different hash every time. Instead every
 * create/update that sets a PIN calls pinTakenByOther() to compare the
 * candidate against all stored hashes. Staff counts are till-sized (tens),
 * so the bcrypt-compare loop is cheap.
 *
 * Inactive staff are included on purpose: reactivating someone must not
 * surface a PIN collision that was invisible while they were deactivated.
 *
 * Server-only — uses supabaseAdmin.
 */

import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const PIN_TAKEN_ERROR =
  "This PIN is already used by another staff member. Choose a different one.";

/** True when a pos_staff row other than `excludeId` already uses this PIN. */
export async function pinTakenByOther(pin: string, excludeId?: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("pos_staff")
    .select("id, pin_hash")
    .not("pin_hash", "is", null);
  if (error) throw new Error(`pin uniqueness check failed: ${error.message}`);

  for (const row of data ?? []) {
    if (excludeId && row.id === excludeId) continue;
    if (row.pin_hash && await bcrypt.compare(pin, row.pin_hash)) return true;
  }
  return false;
}
