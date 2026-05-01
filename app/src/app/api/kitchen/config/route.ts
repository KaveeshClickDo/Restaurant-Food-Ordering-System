/**
 * GET /api/kitchen/config
 * Returns kitchen staff without PINs (used by the login page staff selector).
 * No auth required — PINs are never sent to the browser.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { KitchenStaff } from "@/types";

const DEFAULT_STAFF: Omit<KitchenStaff, "pin">[] = [
  { id: "k-1", name: "Head Chef",       role: "head_chef",       active: true, avatarColor: "#dc2626", createdAt: "" },
  { id: "k-2", name: "Sous Chef",       role: "chef",            active: true, avatarColor: "#ea580c", createdAt: "" },
  { id: "k-3", name: "Kitchen Manager", role: "kitchen_manager", active: true, avatarColor: "#7c3aed", createdAt: "" },
];

export async function GET() {
  try {
    const { data: row } = await supabaseAdmin
      .from("app_settings").select("data").limit(1).single();

    const raw: KitchenStaff[] = row?.data?.kitchenStaff ?? [];
    const staff = (raw.length ? raw : DEFAULT_STAFF as KitchenStaff[])
      .filter((s) => s.active)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .map(({ pin: _, ...safe }) => safe);

    return NextResponse.json({ ok: true, staff });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[kitchen/config]", message);
    return NextResponse.json({ ok: true, staff: DEFAULT_STAFF });
  }
}
