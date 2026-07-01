/**
 * PATCH /api/pos/terminals/[id] — rename, change prefix, toggle active, or
 *                                  bind a device fingerprint. Caller must be
 *                                  a website admin OR a POS session with
 *                                  permissions.canManageStaff (same gate as
 *                                  the collection POST).
 *
 * No DELETE: removing a terminal would cascade to its `pos_sales` rows via
 * SET NULL (audit history preserved) but admins should toggle `active` instead
 * to keep the receipt-prefix history intact. If a hard delete is truly needed
 * an admin can do it via the Supabase SQL editor.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { getPosSession } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { PosTerminalUpdateSchema } from "@/lib/schemas/pos";

const FULL_COLUMNS = "id, label, prefix, next_seq_no, device_fingerprint, last_seen_at, last_sync_at, active, created_at";

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

async function canManageTerminals(): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const session = await getPosSession();
  if (!session) return false;
  const { data } = await supabaseAdmin
    .from("pos_staff").select("permissions, active").eq("id", session.id).maybeSingle();
  return Boolean(data?.active && data?.permissions?.canManageStaff);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await canManageTerminals()) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const parsed = await parseBody(req, PosTerminalUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (body.label             !== undefined) patch.label              = body.label;
  if (body.prefix            !== undefined) patch.prefix             = body.prefix;
  if (body.active            !== undefined) patch.active             = body.active;
  if (body.deviceFingerprint !== undefined) patch.device_fingerprint = body.deviceFingerprint;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("pos_terminals")
    .update(patch)
    .eq("id", id)
    .select(FULL_COLUMNS)
    .maybeSingle();

  if (error) {
    // Partial unique index on (prefix where active = true). Either:
    //   • prefix was changed to one already in use by another active terminal, or
    //   • active was flipped back to true while another terminal held the prefix.
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: `Prefix '${body.prefix ?? "(unchanged)"}' is already used by another active terminal.` },
        { status: 409 },
      );
    }
    console.error("[pos/terminals PATCH]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: "Terminal not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, terminal: mapRow(data) });
}
