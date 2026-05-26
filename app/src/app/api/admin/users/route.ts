/**
 * GET  /api/admin/users  — aggregate all users into a unified list
 * POST /api/admin/users  — create a new user (customer | driver | waiter)
 *
 * Requires admin authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import bcrypt                         from "bcryptjs";
import { supabaseAdmin }              from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { ROLE_PERMISSIONS, type POSRole } from "@/types/pos";
import { parseBody } from "@/lib/apiValidation";
import { UserCreateSchema } from "@/lib/schemas/staff";

// ── Shared type ───────────────────────────────────────────────────────────────

export interface ManagedUser {
  id: string;
  type: "admin" | "customer" | "driver" | "waiter" | "kitchen" | "pos";
  name: string;
  email?: string;
  phone?: string;
  active: boolean;
  createdAt?: string;
  // customer extras
  emailVerified?: boolean;
  // staff extras (waiter / kitchen / pos)
  pin?: string;
  waiterRole?: "senior" | "waiter";
  kitchenRole?: "chef" | "head_chef" | "kitchen_manager";
  posRole?: POSRole;
  avatarColor?: string;
  // driver extras
  vehicleInfo?: string;
  notes?: string;
}

const HASH_ROUNDS = 10;

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const [driversResult, waitersResult, kitchenResult, posResult] = await Promise.all([
    supabaseAdmin
      .from("drivers")
      .select("id, name, email, phone, active, vehicle_info, notes, created_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("waiters")
      .select("id, name, email, role, active, avatar_color, created_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("kitchen_staff")
      .select("id, name, email, role, active, avatar_color, created_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("pos_staff")
      .select("id, name, email, role, active, avatar_color, created_at")
      .order("created_at", { ascending: false }),
  ]);

  if (driversResult.error) {
    return NextResponse.json(
      { ok: false, error: driversResult.error.message },
      { status: 500 },
    );
  }

  // Customers — fresh-deploy schema includes email_verified + active, so a
  // single SELECT is enough. Sentinel "pos-walk-in" is filtered out so it
  // doesn't show up in the admin user list (it's an FK target only).
  const { data: customerData, error: cusErr } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, created_at, email_verified, active")
    .neq("id", "pos-walk-in")
    .order("created_at", { ascending: false });
  if (cusErr) return NextResponse.json({ ok: false, error: cusErr.message }, { status: 500 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerRows: any[] = customerData ?? [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driverRows  = (driversResult.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const waiterRows  = (waitersResult.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kitchenRows = (kitchenResult.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const posRows     = (posResult.data ?? []) as any[];

  const adminEntry: ManagedUser = {
    id:     "admin",
    type:   "admin",
    name:   "Administrator",
    active: true,
  };

  const customerUsers: ManagedUser[] = customerRows.map((row) => ({
    id:            row.id,
    type:          "customer",
    name:          row.name,
    email:         row.email ?? undefined,
    phone:         row.phone ?? undefined,
    active:        row.active ?? true,                // real value from DB now
    createdAt:     typeof row.created_at === "string"
                     ? row.created_at
                     : new Date(row.created_at).toISOString(),
    emailVerified: row.email_verified ?? false,
  }));

  const driverUsers: ManagedUser[] = driverRows.map((row) => ({
    id:          row.id,
    type:        "driver",
    name:        row.name,
    email:       row.email ?? undefined,
    phone:       row.phone ?? undefined,
    active:      row.active,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
    vehicleInfo: row.vehicle_info ?? undefined,
    notes:       row.notes ?? undefined,
  }));

  const waiterUsers: ManagedUser[] = waiterRows.map((row) => ({
    id:          row.id,
    type:        "waiter",
    name:        row.name,
    email:       row.email ?? undefined,
    active:      row.active,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
    pin:         "••••",
    waiterRole:  row.role ?? "waiter",
    avatarColor: row.avatar_color,
  }));

  const kitchenUsers: ManagedUser[] = kitchenRows.map((row) => ({
    id:          row.id,
    type:        "kitchen",
    name:        row.name,
    email:       row.email ?? undefined,
    active:      row.active,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
    pin:         "••••",
    kitchenRole: row.role,
    avatarColor: row.avatar_color,
  }));

  const posUsers: ManagedUser[] = posRows.map((row) => ({
    id:          row.id,
    type:        "pos",
    name:        row.name,
    email:       row.email ?? undefined,
    active:      row.active,
    createdAt:   typeof row.created_at === "string"
                   ? row.created_at
                   : new Date(row.created_at).toISOString(),
    pin:         "••••",
    posRole:     row.role,
    avatarColor: row.avatar_color,
  }));

  const users: ManagedUser[] = [
    adminEntry,
    ...customerUsers,
    ...driverUsers,
    ...waiterUsers,
    ...kitchenUsers,
    ...posUsers,
  ];

  return NextResponse.json({ ok: true, users });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, UserCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;
  const { type, name } = body;

  // ── Customer ──────────────────────────────────────────────────────────────
  if (type === "customer") {
    const { email, phone, password } = body;
    const passwordHash = await bcrypt.hash(password, 10);

    const newCustomerId = crypto.randomUUID();
    const now           = new Date().toISOString();

    const { error: errFull } = await supabaseAdmin
      .from("customers")
      .insert({
        id:              newCustomerId,
        name:            name,
        email:           email.toLowerCase(),
        phone:           phone?.trim() || null,
        password_hash:   passwordHash,
        email_verified:  false,
        active:          true,
        store_credit:    0,
        tags:            [],
        favourites:      [],
        saved_addresses: [],
        created_at:      now,
      });

    if (errFull) {
      if (errFull.code === "23505") {
        return NextResponse.json({ ok: false, error: "A customer with this email already exists." }, { status: 409 });
      }
      return NextResponse.json({ ok: false, error: errFull.message }, { status: 500 });
    }

    const user: ManagedUser = {
      id:            newCustomerId,
      type:          "customer",
      name:          name,
      email:         email.toLowerCase(),
      phone:         phone?.trim() || undefined,
      active:        true,
      createdAt:     now,
      emailVerified: !errFull ? false : undefined,
    };

    return NextResponse.json({ ok: true, user }, { status: 201 });
  }

  // ── Driver ────────────────────────────────────────────────────────────────
  if (type === "driver") {
    const { email, phone, password, vehicleInfo, notes, active = true } = body;
    const passwordHash = await bcrypt.hash(password, 12);

    const { data, error } = await supabaseAdmin
      .from("drivers")
      .insert({
        id:            crypto.randomUUID(),
        name:          name,
        email:         email.toLowerCase(),
        phone:         phone,
        password_hash: passwordHash,
        active,
        vehicle_info:  vehicleInfo?.trim() || null,
        notes:         notes?.trim()       || null,
      })
      .select("id, name, email, phone, active, vehicle_info, notes, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ ok: false, error: "A driver with this email already exists." }, { status: 409 });
      }
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const user: ManagedUser = {
      id:          data.id,
      type:        "driver",
      name:        data.name,
      email:       data.email ?? undefined,
      phone:       data.phone ?? undefined,
      active:      data.active,
      createdAt:   data.created_at,
      vehicleInfo: (data as { vehicle_info?: string }).vehicle_info ?? undefined,
      notes:       (data as { notes?: string }).notes ?? undefined,
    };

    return NextResponse.json({ ok: true, user }, { status: 201 });
  }

  // ── Waiter ────────────────────────────────────────────────────────────────
  if (type === "waiter") {
    const { email, pin, hourlyRate, avatarColor, waiterRole, active = true } = body;
    const pinHash = await bcrypt.hash(pin, HASH_ROUNDS);
    const { data, error } = await supabaseAdmin
      .from("waiters")
      .insert({
        name:         name,
        email:        email ? email.toLowerCase() : "",
        role:         waiterRole ?? "waiter",
        pin_hash:     pinHash,
        active,
        hourly_rate:  hourlyRate ?? null,
        avatar_color: avatarColor ?? "#0891b2",
      })
      .select("id, name, email, role, active, avatar_color, created_at")
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const user: ManagedUser = {
      id:          data.id,
      type:        "waiter",
      name:        data.name,
      email:       data.email ?? undefined,
      active:      data.active,
      createdAt:   data.created_at,
      pin:         "••••",
      waiterRole:  data.role ?? "waiter",
      avatarColor: data.avatar_color,
    };
    return NextResponse.json({ ok: true, user }, { status: 201 });
  }

  // ── Kitchen staff ─────────────────────────────────────────────────────────
  if (type === "kitchen") {
    const { email, pin, kitchenRole, avatarColor, active = true } = body;
    const role = kitchenRole ?? "chef";
    const pinHash = await bcrypt.hash(pin, HASH_ROUNDS);
    const { data, error } = await supabaseAdmin
      .from("kitchen_staff")
      .insert({
        name:         name,
        email:        email ? email.toLowerCase() : "",
        role,
        pin_hash:     pinHash,
        active,
        avatar_color: avatarColor ?? "#dc2626",
      })
      .select("id, name, email, role, active, avatar_color, created_at")
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const user: ManagedUser = {
      id:          data.id,
      type:        "kitchen",
      name:        data.name,
      email:       data.email ?? undefined,
      active:      data.active,
      createdAt:   data.created_at,
      pin:         "••••",
      kitchenRole: data.role,
      avatarColor: data.avatar_color,
    };
    return NextResponse.json({ ok: true, user }, { status: 201 });
  }

  // ── POS staff ─────────────────────────────────────────────────────────────
  if (type === "pos") {
    const { email, pin, posRole, hourlyRate, avatarColor, active = true } = body;
    const role: POSRole = posRole ?? "cashier";
    const pinHash = await bcrypt.hash(pin, HASH_ROUNDS);
    const { data, error } = await supabaseAdmin
      .from("pos_staff")
      .insert({
        name:         name,
        email:        email ? email.toLowerCase() : "",
        role,
        pin_hash:     pinHash,
        active,
        permissions:  ROLE_PERMISSIONS[role],
        hourly_rate:  hourlyRate ?? null,
        avatar_color: avatarColor ?? "#7c3aed",
      })
      .select("id, name, email, role, active, avatar_color, created_at")
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const user: ManagedUser = {
      id:          data.id,
      type:        "pos",
      name:        data.name,
      email:       data.email ?? undefined,
      active:      data.active,
      createdAt:   data.created_at,
      pin:         "••••",
      posRole:     data.role,
      avatarColor: data.avatar_color,
    };
    return NextResponse.json({ ok: true, user }, { status: 201 });
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  if (type === "admin") {
    return NextResponse.json(
      { ok: false, error: "Admin account cannot be created via API." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: false, error: `Unknown type: ${type}` }, { status: 400 });
}
