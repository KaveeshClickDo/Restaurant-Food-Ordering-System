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
      ? "id, name, email, role, active, hourly_rate, avatar_color, created_at"
      : "id, name, role, active, avatar_color";

    const [{ data: waiterRows }, { data: tableRows }] = await Promise.all([
      supabaseAdmin
        .from("waiters")
        .select(waiterSelect)
        .eq("active", true),
      supabaseAdmin
        .from("dining_tables")
        .select("id, label, number, seats, section, active, sort_order, is_vip, vip_price")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
    ]);

    // Map DB rows (snake_case) to the camelCase shape the /waiter UI reads —
    // notably `avatarColor`, which the login tiles use for the avatar colour.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const waiters = (waiterRows ?? []).map((w: any) => ({
      id:          w.id,
      name:        w.name,
      role:        w.role ?? "waiter",
      active:      w.active,
      avatarColor: w.avatar_color,
      ...(elevated
        ? { email: w.email, hourlyRate: w.hourly_rate ?? undefined, createdAt: w.created_at }
        : {}),
    }));

    // Map dining_tables snake_case → camelCase so the waiter UI's table.isVip /
    // table.vipPrice checks work (the grid renders the crown + amber styling
    // off these flags).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tables = (tableRows ?? []).map((t: any) => ({
      id:        t.id,
      label:     t.label,
      number:    t.number ?? null,
      seats:     t.seats,
      section:   t.section ?? "",
      active:    t.active,
      sortOrder: t.sort_order ?? 0,
      isVip:     t.is_vip ?? false,
      vipPrice:  Number(t.vip_price ?? 0),
    }));

    return NextResponse.json({
      ok: true,
      waiters,
      tables,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/config]", message);
    return NextResponse.json({ ok: false, error: "Failed to load config." }, { status: 500 });
  }
}
