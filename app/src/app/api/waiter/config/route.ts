/**
 * GET /api/waiter/config
 * Returns active waiter staff (for the /waiter login tile picker) and
 * active dining tables. The tile-picker view is public — no payroll fields
 * (`hourly_rate`, `email`, `created_at`) are returned to unauthenticated
 * callers; those are visible only to admin or to the waiter themselves
 * via /api/auth/waiter/me.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated } from "@/lib/adminAuth";

export async function GET() {
  try {
    // F-INS-10: only return payroll PII to authenticated admins.
    const elevated = await isAdminAuthenticated();
    const waiterSelect = elevated
      ? "id, name, email, active, hourly_rate, avatar_color, created_at"
      : "id, name, active, avatar_color";

    const [{ data: waiterRows }, { data: tableRows }] = await Promise.all([
      supabaseAdmin
        .from("waiters")
        .select(waiterSelect)
        .eq("active", true),
      supabaseAdmin
        .from("dining_tables")
        .select("id, label, number, seats, section, active, sort_order")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
    ]);

    return NextResponse.json({
      ok: true,
      waiters: waiterRows ?? [],
      tables:  tableRows  ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/config]", message);
    return NextResponse.json({ ok: false, error: "Failed to load config." }, { status: 500 });
  }
}
