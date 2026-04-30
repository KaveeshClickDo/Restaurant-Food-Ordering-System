/**
 * GET /api/waiter/config
 * Returns waiter staff (without PINs) and dining tables from app_settings.
 * Falls back to seed defaults when no settings exist yet.
 */

import { NextResponse }   from "next/server";
import { supabaseAdmin }  from "@/lib/supabaseAdmin";
import type { WaiterStaff, DiningTable } from "@/types";

const DEFAULT_WAITERS: Omit<WaiterStaff, "pin">[] = [
  { id: "w-1", name: "Head Waiter", role: "senior", active: true, avatarColor: "#7c3aed", createdAt: "" },
  { id: "w-2", name: "Alex",        role: "waiter",  active: true, avatarColor: "#0891b2", createdAt: "" },
  { id: "w-3", name: "Sophie",      role: "waiter",  active: true, avatarColor: "#16a34a", createdAt: "" },
];

const DEFAULT_TABLES: DiningTable[] = [
  ...Array.from({ length: 6 },  (_, i) => ({ id: `t-${i+1}`,  number: i+1,  label: `T${i+1}`, seats: i < 2 ? 2 : 4, section: "Main Hall", active: true })),
  ...Array.from({ length: 4 },  (_, i) => ({ id: `t-${i+7}`,  number: i+7,  label: `T${i+7}`, seats: 4,             section: "Terrace",   active: true })),
  ...Array.from({ length: 2 },  (_, i) => ({ id: `t-${i+11}`, number: i+11, label: `B${i+1}`, seats: 2,             section: "Bar",       active: true })),
];

export async function GET() {
  try {
    const { data: row } = await supabaseAdmin
      .from("app_settings").select("data").limit(1).single();

    const raw: WaiterStaff[] = row?.data?.waiters ?? [];
    // Strip PINs before returning — the auth endpoint handles PIN validation
    const waiters = (raw.length ? raw : DEFAULT_WAITERS as WaiterStaff[])
      .filter((w) => w.active)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .map(({ pin: _, ...safe }) => safe);

    const tables: DiningTable[] = (row?.data?.diningTables ?? DEFAULT_TABLES).filter((t: DiningTable) => t.active);

    return NextResponse.json({ ok: true, waiters, tables });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/config]", message);
    return NextResponse.json({ ok: true, waiters: DEFAULT_WAITERS, tables: DEFAULT_TABLES });
  }
}
