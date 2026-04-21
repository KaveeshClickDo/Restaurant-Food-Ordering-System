/**
 * PUT    /api/admin/drivers/[id] — update a driver
 * DELETE /api/admin/drivers/[id] — delete a driver
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Driver } from "@/types";

const PUBLIC_COLUMNS = "id, name, email, phone, active, vehicle_info, notes, created_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Driver {
  return {
    id:          row.id,
    name:        row.name,
    email:       row.email,
    phone:       row.phone ?? "",
    active:      row.active,
    vehicleInfo: row.vehicle_info || undefined,
    notes:       row.notes       || undefined,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
  };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: {
    name?: string; email?: string; phone?: string; password?: string;
    active?: boolean; vehicleInfo?: string; notes?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};

  if (body.name  !== undefined) update.name         = body.name.trim();
  if (body.email !== undefined) update.email         = body.email.trim().toLowerCase();
  if (body.phone !== undefined) update.phone         = body.phone.trim();
  if (body.active !== undefined) update.active       = body.active;
  if (body.vehicleInfo !== undefined) update.vehicle_info = body.vehicleInfo?.trim() || null;
  if (body.notes       !== undefined) update.notes        = body.notes?.trim()       || null;

  if (body.password) {
    if (body.password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }
    update.password_hash = await bcrypt.hash(body.password, 12);
  }

  const { data, error } = await supabaseAdmin
    .from("drivers")
    .update(update)
    .eq("id", id)
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ ok: false, error: "Driver not found" }, { status: 404 });
    }
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "A driver with this email already exists." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, driver: mapRow(data) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { error } = await supabaseAdmin
    .from("drivers")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
