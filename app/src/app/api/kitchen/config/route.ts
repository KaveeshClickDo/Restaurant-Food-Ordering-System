/**
 * GET /api/kitchen/config
 * Returns active kitchen staff (PINs never returned).
 * No auth required — the staff list drives the login page tile picker.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    // `avatar_color` was previously omitted, which is why the kitchen login
    // tiles rendered with no background colour (the page reads `s.avatarColor`,
    // and without it the inline style became `backgroundColor: undefined`).
    // Rows are also mapped snake_case → camelCase to match the KitchenStaff
    // type the login page consumes (mirrors the waiter config route).
    const { data } = await supabaseAdmin
      .from("kitchen_staff")
      .select("id, name, email, role, active, avatar_color, created_at")
      .eq("active", true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const staff = (data ?? []).map((r: any) => ({
      id:          r.id,
      name:        r.name,
      email:       r.email,
      role:        r.role,
      active:      r.active,
      avatarColor: r.avatar_color,
      createdAt:   typeof r.created_at === "string"
                     ? r.created_at
                     : new Date(r.created_at).toISOString(),
    }));

    return NextResponse.json({ ok: true, staff });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[kitchen/config]", message);
    return NextResponse.json({ ok: false, error: "Failed to load config." }, { status: 500 });
  }
}
