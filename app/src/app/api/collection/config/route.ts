/**
 * GET /api/collection/config
 * Returns active collection staff (PINs never returned).
 * No auth required — the staff list drives the /collection/login tile picker.
 * Mirrors /api/kitchen/config.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from("collection_staff")
      .select("id, name, email, active, avatar_color, created_at")
      .eq("active", true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const staff = (data ?? []).map((r: any) => ({
      id:          r.id,
      name:        r.name,
      email:       r.email,
      active:      r.active,
      avatarColor: r.avatar_color,
      createdAt:   typeof r.created_at === "string"
                     ? r.created_at
                     : new Date(r.created_at).toISOString(),
    }));

    return NextResponse.json({ ok: true, staff });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[collection/config]", message);
    return NextResponse.json({ ok: false, error: "Failed to load config." }, { status: 500 });
  }
}
