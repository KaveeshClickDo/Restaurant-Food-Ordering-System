/**
 * GET /api/kitchen/config
 * Returns active kitchen staff (PINs never returned).
 * No auth required — the staff list drives the login page tile picker.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from("kitchen_staff")
      .select("id, name, email, role, active, created_at")
      .eq("active", true);

    return NextResponse.json({ ok: true, staff: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[kitchen/config]", message);
    return NextResponse.json({ ok: false, error: "Failed to load config." }, { status: 500 });
  }
}
