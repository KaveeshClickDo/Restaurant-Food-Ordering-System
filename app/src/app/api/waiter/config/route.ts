/**
 * GET /api/waiter/config
 * Returns active waiter staff (PINs stripped) and active dining tables.
 * Reads from the waiters and dining_tables tables directly.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const [{ data: waiterRows }, { data: tableRows }] = await Promise.all([
      supabaseAdmin
        .from("waiters")
        .select("id, name, email, active, hourly_rate, avatar_color, created_at")
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
