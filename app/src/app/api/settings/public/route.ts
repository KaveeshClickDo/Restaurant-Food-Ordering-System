/**
 * GET /api/settings/public
 * Returns a safe subset of app settings needed by the public booking widget.
 * No auth required — only exposes non-sensitive fields.
 */

import { NextResponse }  from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("data")
    .limit(1)
    .single();

  const d = data?.data ?? {};
  const rs = d.reservationSystem ?? {};

  return NextResponse.json({
    restaurant: {
      name:    d.restaurant?.name    ?? "",
      phone:   d.restaurant?.phone   ?? "",
      address: [d.restaurant?.addressLine1, d.restaurant?.city, d.restaurant?.postcode].filter(Boolean).join(", "),
    },
    reservationSystem: {
      enabled:             rs.enabled             ?? false,
      openTime:            rs.openTime             ?? "12:00",
      closeTime:           rs.closeTime            ?? "22:00",
      slotIntervalMinutes: rs.slotIntervalMinutes  ?? 30,
      slotDurationMinutes: rs.slotDurationMinutes  ?? 90,
      maxAdvanceDays:      rs.maxAdvanceDays        ?? 30,
      maxPartySize:        rs.maxPartySize          ?? 10,
    },
  });
}
