/**
 * The effective Dojo feature flag = env master switch AND admin toggle.
 * SERVER-SIDE ONLY (reads env + the settings table).
 *
 *   env (DOJO_MODE)      — the master. off → Dojo is unavailable everywhere.
 *   admin toggle          — app_settings.data.dojoTerminal.enabled, set at
 *                           /admin?tab=integrations. Can turn it OFF, or back ON,
 *                           but CANNOT turn it on when env is off.
 *
 * Every surface (POS / waiter / collection) resolves visibility through this, so
 * turning either off hides the Dojo option everywhere and reverts to the old
 * manual flow.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isDojoEnabled } from "./config";

/**
 * The admin toggle from app_settings. Defaults to true when env is on and no
 * explicit preference has been saved yet — so setting DOJO_MODE alone makes the
 * feature appear, and the admin can then turn it off.
 */
export async function getDojoAdminEnabled(): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("data")
    .eq("id", 1)
    .maybeSingle();
  const blob = (data?.data ?? {}) as { dojoTerminal?: { enabled?: boolean } };
  return blob.dojoTerminal?.enabled ?? true;
}

/** env master AND admin toggle. Env-off can never be overridden by admin. */
export async function isDojoEffectivelyEnabled(): Promise<boolean> {
  if (!isDojoEnabled()) return false;
  return getDojoAdminEnabled();
}
