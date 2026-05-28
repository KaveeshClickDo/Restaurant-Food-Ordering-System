/**
 * PUT    /api/admin/drivers/[id] — update a driver
 * DELETE /api/admin/drivers/[id] — delete a driver
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import type { Driver } from "@/types";
import { parseBody } from "@/lib/apiValidation";
import { DriverUpdateSchema } from "@/lib/schemas/staff";

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
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

  const { id } = await params;
  const parsed = await parseBody(request, DriverUpdateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};

  if (body.name  !== undefined) update.name         = body.name;
  if (body.email !== undefined) update.email         = body.email.toLowerCase();
  if (body.phone !== undefined) update.phone         = body.phone;
  if (body.active !== undefined) update.active       = body.active;
  if (body.vehicleInfo !== undefined) update.vehicle_info = body.vehicleInfo?.trim() || null;
  if (body.notes       !== undefined) update.notes        = body.notes?.trim()       || null;

  if (body.password) {
    update.password_hash = await bcrypt.hash(body.password, 12);
  }

  // Bump session_version ONLY when a real credential change happens — not just
  // when the form re-submits the field with its existing value. Otherwise every
  // harmless edit (name / phone / notes) signs the driver out, because the form
  // always sends the whole driver row whether or not anything changed.
  const { data: current } = await supabaseAdmin
    .from("drivers")
    .select("email, active, session_version")
    .eq("id", id)
    .maybeSingle();

  const currentEmail  = String(current?.email ?? "").toLowerCase();
  const currentActive = current?.active !== false;        // null/undefined ≈ active

  const newEmail        = body.email?.toLowerCase();
  const emailChanged    = newEmail !== undefined && newEmail !== currentEmail;
  // body.password is only present when the admin typed a new one (the form
  // strips a blank password before sending — see DriversPanel.handleEdit).
  const passwordChanged = body.password !== undefined;
  // Transition active → inactive locks the driver out; flipping inactive → active
  // doesn't need a bump (they couldn't have been logged in while disabled).
  const deactivating    = body.active === false && currentActive === true;

  if (emailChanged || passwordChanged || deactivating) {
    update.session_version = Number(current?.session_version ?? 1) + 1;
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
  if (!await isAdminAuthenticated()) return unauthorizedResponse();

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
