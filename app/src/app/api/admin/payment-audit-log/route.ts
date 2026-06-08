/**
 * GET /api/admin/payment-audit-log — return the most recent N audit entries.
 *
 * Replaces the growing JSONB array at app_settings.data.paymentAuditLog.
 * Read-only here: new entries are appended by the order/admin flows that
 * actually mutate payment settings, not by this route.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

const MAX_LIMIT     = 500;
const DEFAULT_LIMIT = 100;

export async function GET(req: NextRequest) {
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const raw   = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(Math.max(1, Number.isFinite(raw) ? raw : DEFAULT_LIMIT), MAX_LIMIT);

  const { data, error } = await supabaseAdmin
    .from("payment_audit_log")
    .select("id, timestamp, actor, action, details")
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entries: data ?? [] });
}
