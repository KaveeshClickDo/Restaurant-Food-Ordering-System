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
      .select("id, name, email, active, avatar_color, created_at")
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

  // Customers: try with email_verified; fall back if migration hasn't run yet.
  // Note: customers do NOT have an `active` column — only drivers do.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let customerRows: any[] = [];
  const { data: cusWithVerified, error: cusErr } = await supabaseAdmin
    .from("customers")
    .select("id, name, email, phone, created_at, email_verified")
    .order("created_at", { ascending: false });

  if (cusErr?.code === "PGRST204" && cusErr.message.includes("email_verified")) {
    // Migration not yet run — select without email_verified
    const { data: cusBasic, error: cusErrBasic } = await supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, created_at")
      .order("created_at", { ascending: false });
    if (cusErrBasic) {
      return NextResponse.json({ ok: false, error: cusErrBasic.message }, { status: 500 });
    }
    customerRows = cusBasic ?? [];
  } else if (cusErr) {
    return NextResponse.json({ ok: false, error: cusErr.message }, { status: 500 });
  } else {
    customerRows = cusWithVerified ?? [];
  }

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
    active:        row.active ?? true,
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

interface CreateUserBody {
  type?: string;
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  pin?: string;
  waiterRole?: "senior" | "waiter";
  kitchenRole?: "chef" | "head_chef" | "kitchen_manager";
  posRole?: POSRole;
  hourlyRate?: number;
  avatarColor?: string;
  vehicleInfo?: string;
  notes?: string;
  active?: boolean;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  let body: CreateUserBody;
  try {
    body = await req.json() as CreateUserBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const {
    type, name, email, phone, password, pin,
    waiterRole, kitchenRole, posRole, hourlyRate,
    avatarColor, vehicleInfo, notes, active = true,
  } = body;

  if (!type) {
    return NextResponse.json({ ok: false, error: "type is required." }, { status: 400 });
  }
  if (!name?.trim()) {
    return NextResponse.json({ ok: false, error: "name is required." }, { status: 400 });
  }

  // ── Customer ──────────────────────────────────────────────────────────────
  if (type === "customer") {
    if (!email?.trim()) {
      return NextResponse.json({ ok: false, error: "email is required for customer." }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ ok: false, error: "Password must be at least 6 characters." }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newCustomerId = crypto.randomUUID();
    const now           = new Date().toISOString();

    // Try inserting with auth columns; fall back if migration hasn't run yet
    const { error: errFull } = await supabaseAdmin
      .from("customers")
      .insert({
        id:              newCustomerId,
        name:            name.trim(),
        email:           email.trim().toLowerCase(),
        phone:           phone?.trim() || null,
        password_hash:   passwordHash,
        email_verified:  false,
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
      if (errFull.code === "PGRST204") {
        // Migration not run — insert without auth columns
        const { error: errFallback } = await supabaseAdmin
          .from("customers")
          .insert({
            id:              newCustomerId,
            name:            name.trim(),
            email:           email.trim().toLowerCase(),
            phone:           phone?.trim() || null,
            password:        passwordHash,
            store_credit:    0,
            tags:            [],
            favourites:      [],
            saved_addresses: [],
            created_at:      now,
          });
        if (errFallback) {
          if (errFallback.code === "23505") {
            return NextResponse.json({ ok: false, error: "A customer with this email already exists." }, { status: 409 });
          }
          return NextResponse.json({ ok: false, error: errFallback.message }, { status: 500 });
        }
      } else {
        return NextResponse.json({ ok: false, error: errFull.message }, { status: 500 });
      }
    }

    const user: ManagedUser = {
      id:            newCustomerId,
      type:          "customer",
      name:          name.trim(),
      email:         email.trim().toLowerCase(),
      phone:         phone?.trim() || undefined,
      active:        true,
      createdAt:     now,
      emailVerified: !errFull ? false : undefined,
    };

    return NextResponse.json({ ok: true, user }, { status: 201 });
  }

  // ── Driver ────────────────────────────────────────────────────────────────
  if (type === "driver") {
    if (!email?.trim()) {
      return NextResponse.json({ ok: false, error: "email is required for driver." }, { status: 400 });
    }
    if (!phone?.trim()) {
      return NextResponse.json({ ok: false, error: "phone is required for driver." }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ ok: false, error: "Password must be at least 6 characters." }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { data, error } = await supabaseAdmin
      .from("drivers")
      .insert({
        id:            crypto.randomUUID(),
        name:          name.trim(),
        email:         email.trim().toLowerCase(),
        phone:         phone.trim(),
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
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ ok: false, error: "PIN must be 4–6 digits." }, { status: 400 });
    }
    const pinHash = await bcrypt.hash(pin, HASH_ROUNDS);
    const { data, error } = await supabaseAdmin
      .from("waiters")
      .insert({
        name:         name.trim(),
        email:        email?.trim().toLowerCase() ?? "",
        pin_hash:     pinHash,
        active,
        hourly_rate:  hourlyRate ?? null,
        avatar_color: avatarColor ?? "#0891b2",
      })
      .select("id, name, email, active, avatar_color, created_at")
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
      waiterRole:  waiterRole ?? "waiter",
      avatarColor: data.avatar_color,
    };
    return NextResponse.json({ ok: true, user }, { status: 201 });
  }

  // ── Kitchen staff ─────────────────────────────────────────────────────────
  if (type === "kitchen") {
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ ok: false, error: "PIN must be 4–6 digits." }, { status: 400 });
    }
    const role = kitchenRole ?? "chef";
    if (!["chef", "head_chef", "kitchen_manager"].includes(role)) {
      return NextResponse.json({ ok: false, error: "Invalid kitchen role." }, { status: 400 });
    }
    const pinHash = await bcrypt.hash(pin, HASH_ROUNDS);
    const { data, error } = await supabaseAdmin
      .from("kitchen_staff")
      .insert({
        name:         name.trim(),
        email:        email?.trim().toLowerCase() ?? "",
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
    if (!pin || !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ ok: false, error: "POS PIN must be exactly 4 digits." }, { status: 400 });
    }
    const role: POSRole = posRole ?? "cashier";
    if (!["admin", "manager", "cashier"].includes(role)) {
      return NextResponse.json({ ok: false, error: "Invalid POS role." }, { status: 400 });
    }
    const pinHash = await bcrypt.hash(pin, HASH_ROUNDS);
    const { data, error } = await supabaseAdmin
      .from("pos_staff")
      .insert({
        name:         name.trim(),
        email:        email?.trim().toLowerCase() ?? "",
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
