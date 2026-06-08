/**
 * Server-side helper for POS authorisation.
 *
 * `getPosSession()` only proves a POS session cookie is valid — it does NOT
 * say which sub-role / permission flags the caller has. This module looks up
 * the `pos_staff` row keyed by `session.id` and exposes:
 *
 *   - loadPosStaffRow(sessionId)        — full row + permissions
 *   - requirePosPermission(flag)        — returns NextResponse on fail
 *
 * Used by the POS routes that exercise specific capabilities (void / refund /
 * menu writes / cross-staff reads).
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import type { POSPermissions, POSRole } from "@/types/pos";

export interface PosStaffRow {
  id:          string;
  name:        string;
  email:       string;
  role:        POSRole;
  active:      boolean;
  permissions: POSPermissions;
}

/**
 * Load the pos_staff row for the current POS session, or null when there is
 * no session / the staff member is inactive / the row was deleted.
 */
export async function loadPosStaffRow(sessionId: string): Promise<PosStaffRow | null> {
  const { data } = await supabaseAdmin
    .from("pos_staff")
    .select("id, name, email, role, active, permissions")
    .eq("id", sessionId)
    .maybeSingle();
  if (!data || data.active !== true) return null;
  return {
    id:          data.id,
    name:        data.name,
    email:       data.email ?? "",
    role:        data.role as POSRole,
    active:      data.active,
    permissions: (data.permissions ?? {}) as POSPermissions,
  };
}

/**
 * Require a POS session whose `permissions[flag]` is true, OR an admin session.
 * Returns either:
 *   - { ok: true, staff }            — proceed; `staff` is the POS row (null when admin)
 *   - { ok: false, response }        — short-circuit with this 401/403 response
 *
 * Always check `ok` before reading `staff`.
 */
export async function requirePosPermission(
  flag: keyof POSPermissions,
): Promise<
  | { ok: true; staff: PosStaffRow | null }
  | { ok: false; response: NextResponse }
> {
  // Admin override — admins can do anything the POS can.
  if (await isAdminAuthenticated()) {
    return { ok: true, staff: null };
  }

  const session = await getPosSession();
  if (!session) return { ok: false, response: unauthorizedJson() };

  const staff = await loadPosStaffRow(session.id);
  if (!staff) {
    return { ok: false, response: unauthorizedJson() };
  }
  if (!staff.permissions?.[flag]) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Forbidden — insufficient permissions." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, staff };
}

/**
 * Loose variant — accepts any valid POS session and returns the row, or null
 * when no session. Useful for handlers that need the staff's name/role but
 * don't gate on a specific permission flag.
 */
export async function requirePosSession(): Promise<
  | { ok: true; staff: PosStaffRow }
  | { ok: false; response: NextResponse }
> {
  const session = await getPosSession();
  if (!session) return { ok: false, response: unauthorizedJson() };
  const staff = await loadPosStaffRow(session.id);
  if (!staff) return { ok: false, response: unauthorizedJson() };
  return { ok: true, staff };
}
