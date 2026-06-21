/**
 * GET  /api/pos/terminals — list registered POS terminals.
 *                           Any active POS session (or admin) can read.
 *                           Cashiers get the picker view (id + label + prefix
 *                           for active terminals only); managers/admins get
 *                           the full row including inactive terminals.
 *
 * POST /api/pos/terminals — register a new terminal. Requires website admin
 *                           OR a POS session with permissions.canManageStaff.
 *                           Validates prefix uniqueness; 409 on conflict.
 *
 * Terminals namespace offline receipt numbers (e.g. T1-1042). Online web POS
 * does not use this table — pos_sales.terminal_id stays NULL for those rows.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getPosSession, unauthorizedJson } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { PosTerminalCreateSchema } from "@/lib/schemas/pos";

const FULL_COLUMNS   = "id, label, prefix, next_seq_no, device_fingerprint, last_seen_at, last_sync_at, active, created_at";
const PICKER_COLUMNS = "id, label, prefix, active";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any) {
  return {
    id:                row.id,
    label:             row.label,
    prefix:            row.prefix,
    nextSeqNo:         row.next_seq_no,
    deviceFingerprint: row.device_fingerprint ?? "",
    lastSeenAt:        row.last_seen_at ?? null,
    lastSyncAt:        row.last_sync_at ?? null,
    active:            row.active,
    createdAt:         typeof row.created_at === "string"
                          ? row.created_at
                          : new Date(row.created_at).toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPickerRow(row: any) {
  return {
    id:     row.id,
    label:  row.label,
    prefix: row.prefix,
    active: row.active,
  };
}

/**
 * Returns true when the caller can manage terminals — either a website admin
 * session, or a POS session with permissions.canManageStaff. (Reusing the
 * staff-management flag here keeps the permission surface small; a future
 * dedicated `canManageTerminals` flag is a one-line change if needed.)
 */
async function canManageTerminals(): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const session = await getPosSession();
  if (!session) return false;
  const { data } = await supabaseAdmin
    .from("pos_staff").select("permissions, active").eq("id", session.id).maybeSingle();
  return Boolean(data?.active && data?.permissions?.canManageStaff);
}

export async function GET() {
  // Authn gate: any active POS session OR admin can read. The picker view
  // shown to a cashier choosing which terminal this device is uses the
  // narrower column list, and only sees active terminals.
  const isAdmin   = await isAdminAuthenticated();
  const posSession = isAdmin ? null : await getPosSession();
  if (!isAdmin && !posSession) return unauthorizedJson();

  const elevated = isAdmin || await canManageTerminals();

  let q = supabaseAdmin
    .from("pos_terminals")
    .select(elevated ? FULL_COLUMNS : PICKER_COLUMNS)
    .order("created_at", { ascending: true });
  if (!elevated) q = q.eq("active", true);

  const { data, error } = await q;
  if (error) {
    console.error("[pos/terminals GET]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const mapped = (data ?? []).map(elevated ? mapRow : mapPickerRow);
  return NextResponse.json({ ok: true, terminals: mapped });
}

export async function POST(request: Request) {
  if (!await canManageTerminals()) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseBody(request, PosTerminalCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const { label, prefix, deviceFingerprint } = parsed.data;

  const { data, error } = await supabaseAdmin
    .from("pos_terminals")
    .insert({
      label,
      prefix,
      device_fingerprint: deviceFingerprint ?? "",
    })
    .select(FULL_COLUMNS)
    .single();

  if (error) {
    // 23505 = unique_violation on the partial unique index over (prefix where active).
    // Surface as 409 with a friendlier message so the admin UI can show it inline.
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: `Prefix '${prefix}' is already used by another active terminal.` },
        { status: 409 },
      );
    }
    console.error("[pos/terminals POST]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, terminal: mapRow(data) }, { status: 201 });
}
