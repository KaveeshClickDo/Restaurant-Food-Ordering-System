/**
 * PATCH /api/pos/settings — scoped settings writer for the POS app.
 *
 * The POS Settings screen needs to persist a SMALL slice of the global
 * AdminSettings blob — tax (rate/inclusive) and the receipt-printer config —
 * from a POS-only device that has no admin session.
 *
 * The full writer (POST /api/admin/settings) replaces the entire settings
 * document and is admin-only: letting a POS session call it would mean a till
 * could overwrite payment keys, delivery zones, schedule, etc. So this route
 * accepts a POS session with `canAccessSettings` (admin override built in) and
 * merges ONLY the whitelisted `taxSettings` / `printer` keys into app_settings.
 *
 * Field-scoping mirrors /api/admin/menu/[id]/stock — the established pattern in
 * this codebase for "let POS write a narrow, well-defined slice that the broad
 * admin route is too powerful to share."
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosPermission } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { PosSettingsPatchSchema } from "@/lib/schemas/pos";

export async function PATCH(req: NextRequest) {
  // POS admin / manager (canAccessSettings) OR any admin session.
  const gate = await requirePosPermission("canAccessSettings");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, PosSettingsPatchSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const patch = parsed.data;

  // Read the current blob, then shallow-merge ONLY the whitelisted sub-objects
  // back in. Merging at the sub-object level preserves sibling fields the POS
  // client didn't send (e.g. taxSettings.showBreakdown when POS changes only
  // rate/inclusive), and guarantees no other settings key can be touched here.
  const { data: row, error: readErr } = await supabaseAdmin
    .from("app_settings")
    .select("data")
    .eq("id", 1)
    .maybeSingle();
  if (readErr) {
    console.error("pos/settings read:", readErr.message);
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }

  const data = (row?.data ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...data };
  if (patch.taxSettings) {
    next.taxSettings = { ...((data.taxSettings as object) ?? {}), ...patch.taxSettings };
  }
  if (patch.printer) {
    next.printer = { ...((data.printer as object) ?? {}), ...patch.printer };
  }

  const { error: writeErr } = await supabaseAdmin
    .from("app_settings")
    .upsert({ id: 1, data: next, updated_at: new Date().toISOString() });
  if (writeErr) {
    console.error("pos/settings write:", writeErr.message);
    return NextResponse.json({ ok: false, error: writeErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
