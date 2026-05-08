/**
 * GET /api/auth/driver/me — returns the current driver from the session cookie.
 * Used by AppContext on init when no localStorage driver session exists,
 * so the dashboard loads even after localStorage is cleared.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDriverSession } from "@/lib/auth";

export async function GET() {
  const session = await getDriverSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("drivers")
    .select("id, name, email, phone, active, vehicle_info, notes, created_at")
    .eq("id", session.id)
    .single();

  if (error || !data || !data.active) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    driver: {
      id:          data.id,
      name:        data.name,
      email:       data.email,
      phone:       data.phone ?? "",
      active:      data.active,
      vehicleInfo: data.vehicle_info  || undefined,
      notes:       data.notes         || undefined,
      createdAt:   typeof data.created_at === "string"
                     ? data.created_at
                     : new Date(data.created_at).toISOString(),
    },
  });
}
