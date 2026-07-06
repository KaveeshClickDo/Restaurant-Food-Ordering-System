import { z } from "zod";
import { Email, Phone, PhoneOrEmpty, Pin6, Password, NonEmptyString, Hex, Money } from "./primitives";

const KitchenRole = z.enum(["chef", "head_chef", "kitchen_manager"]);
const PosRole     = z.enum(["admin", "manager", "cashier"]);
const WaiterRole  = z.enum(["waiter", "senior"]);

// ── Drivers ───────────────────────────────────────────────────────────────────
export const DriverCreateSchema = z.object({
  name:        NonEmptyString,
  email:       Email,
  phone:       Phone,
  password:    Password,
  active:      z.boolean().optional(),
  vehicleInfo: z.string().optional(),
  notes:       z.string().optional(),
});

export const DriverUpdateSchema = z.object({
  name:        NonEmptyString.optional(),
  email:       Email.optional(),
  phone:       PhoneOrEmpty.optional(),
  password:    Password.optional(),
  active:      z.boolean().optional(),
  vehicleInfo: z.string().optional(),
  notes:       z.string().optional(),
});

// ── Waiters ───────────────────────────────────────────────────────────────────
export const WaiterCreateSchema = z.object({
  name:        NonEmptyString,
  email:       z.string().email().optional().or(z.literal("")),
  role:        WaiterRole.optional(),
  password:    Password,
  active:      z.boolean().optional(),
  hourlyRate:  Money.optional(),
  avatarColor: Hex.optional(),
});

export const WaiterUpdateSchema = z.object({
  name:        NonEmptyString.optional(),
  email:       z.string().email().optional().or(z.literal("")),
  role:        WaiterRole.optional(),
  password:    Password.optional(),
  active:      z.boolean().optional(),
  hourlyRate:  Money.optional(),
  avatarColor: Hex.optional(),
});

// ── Kitchen staff ─────────────────────────────────────────────────────────────
export const KitchenStaffCreateSchema = z.object({
  name:        NonEmptyString,
  email:       z.string().email().optional().or(z.literal("")),
  role:        KitchenRole.optional(),
  password:    Password,
  active:      z.boolean().optional(),
  avatarColor: Hex.optional(),
});

export const KitchenStaffUpdateSchema = z.object({
  name:        NonEmptyString.optional(),
  email:       z.string().email().optional().or(z.literal("")),
  role:        KitchenRole.optional(),
  password:    Password.optional(),
  active:      z.boolean().optional(),
  avatarColor: Hex.optional(),
});

// ── Collection staff ──────────────────────────────────────────────────────────
// Flat list (no roles/permissions) — they log into /collection to take pickup
// payments and complete handovers.
export const CollectionStaffCreateSchema = z.object({
  name:        NonEmptyString,
  email:       z.string().email().optional().or(z.literal("")),
  password:    Password,
  active:      z.boolean().optional(),
  avatarColor: Hex.optional(),
});

export const CollectionStaffUpdateSchema = z.object({
  name:        NonEmptyString.optional(),
  email:       z.string().email().optional().or(z.literal("")),
  password:    Password.optional(),
  active:      z.boolean().optional(),
  avatarColor: Hex.optional(),
});

// ── POS staff ────────────────────────────────────────────────────────────────
export const PosStaffCreateSchema = z.object({
  name:        NonEmptyString,
  email:       z.string().email().optional().or(z.literal("")),
  role:        PosRole.optional(),
  password:    Password,            // web POS + first tablet login
  pin:         Pin6,                // tablet quick-login — REQUIRED and unique
                                    // across pos_staff (enforced server-side
                                    // via bcrypt compare, see lib/posPin.ts)
  active:      z.boolean().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  hourlyRate:  Money.optional(),
  avatarColor: Hex.optional(),
});

export const PosStaffUpdateSchema = z.object({
  name:        NonEmptyString.optional(),
  email:       z.string().email().optional().or(z.literal("")),
  role:        PosRole.optional(),
  password:    Password.optional(),
  pin:         Pin6.optional(),
  active:      z.boolean().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  hourlyRate:  Money.optional(),
  avatarColor: Hex.optional(),
});

// ── Unified admin /api/admin/users body — discriminated by `type` ────────────
export const UserCreateSchema = z.discriminatedUnion("type", [
  z.object({
    type:     z.literal("customer"),
    name:     NonEmptyString,
    email:    Email,
    phone:    z.string().optional(),
    password: Password,
  }),
  z.object({
    type:        z.literal("driver"),
    name:        NonEmptyString,
    email:       Email,
    phone:       Phone,
    password:    Password,
    active:      z.boolean().optional(),
    vehicleInfo: z.string().optional(),
    notes:       z.string().optional(),
  }),
  z.object({
    type:        z.literal("waiter"),
    name:        NonEmptyString,
    email:       z.string().email().optional().or(z.literal("")),
    password:    Password,
    active:      z.boolean().optional(),
    waiterRole:  z.enum(["senior", "waiter"]).optional(),
    hourlyRate:  Money.optional(),
    avatarColor: Hex.optional(),
  }),
  z.object({
    type:        z.literal("kitchen"),
    name:        NonEmptyString,
    email:       z.string().email().optional().or(z.literal("")),
    kitchenRole: KitchenRole.optional(),
    password:    Password,
    active:      z.boolean().optional(),
    avatarColor: Hex.optional(),
  }),
  z.object({
    type:        z.literal("pos"),
    name:        NonEmptyString,
    email:       z.string().email().optional().or(z.literal("")),
    posRole:     PosRole.optional(),
    password:    Password,
    pin:         Pin6,               // required + unique — see lib/posPin.ts
    active:      z.boolean().optional(),
    permissions: z.record(z.string(), z.boolean()).optional(),
    hourlyRate:  Money.optional(),
    avatarColor: Hex.optional(),
  }),
]);

export const UserUpdateSchema = z.discriminatedUnion("type", [
  z.object({
    type:            z.literal("customer"),
    name:            NonEmptyString.optional(),
    email:           Email.optional(),
    phone:           z.string().optional(),
    active:          z.boolean().optional(),
    // ── POS-shared fields (Bug #11) — admin can adjust these too. The
    // customers table is the single source of truth shared between admin
    // and POS, so the same columns surface here and in /api/pos/customers.
    notes:           z.string().optional(),
    tags:            z.array(z.string()).optional(),
    loyaltyPoints:   z.number().int().nonnegative().optional(),
    giftCardBalance: Money.optional(),
  }),
  z.object({
    type:        z.literal("driver"),
    name:        NonEmptyString.optional(),
    email:       Email.optional(),
    phone:       PhoneOrEmpty.optional(),
    active:      z.boolean().optional(),
    vehicleInfo: z.string().optional(),
    notes:       z.string().optional(),
  }),
  z.object({
    type:        z.literal("waiter"),
    name:        NonEmptyString.optional(),
    email:       z.string().email().optional().or(z.literal("")),
    waiterRole:  WaiterRole.optional(),
    password:    Password.optional(),
    active:      z.boolean().optional(),
    hourlyRate:  Money.optional(),
    avatarColor: Hex.optional(),
  }),
  z.object({
    type:        z.literal("kitchen"),
    name:        NonEmptyString.optional(),
    email:       z.string().email().optional().or(z.literal("")),
    kitchenRole: KitchenRole.optional(),
    password:    Password.optional(),
    active:      z.boolean().optional(),
    avatarColor: Hex.optional(),
  }),
  z.object({
    type:        z.literal("pos"),
    name:        NonEmptyString.optional(),
    email:       z.string().email().optional().or(z.literal("")),
    posRole:     PosRole.optional(),
    password:    Password.optional(),
    pin:         Pin6.optional(),
    active:      z.boolean().optional(),
    permissions: z.record(z.string(), z.boolean()).optional(),
    hourlyRate:  Money.optional(),
    avatarColor: Hex.optional(),
  }),
]);

export const UserDeleteSchema = z.object({
  type: z.enum(["customer", "driver", "waiter", "kitchen", "pos", "admin"]),
  // Customer only: soft-delete as a ban (re-registration refused). Ignored for
  // staff types, which are still hard-deleted.
  block: z.boolean().optional(),
});

// Staff now use passwords too (same as customers/drivers), so a single
// `password` field covers every type.
export const SetPasswordOrPinSchema = z.object({
  type:     z.enum(["customer", "driver", "waiter", "kitchen", "pos", "admin"]),
  password: Password,
});

export const SendResetSchema = z.object({
  type:  z.enum(["customer", "driver", "waiter", "kitchen", "pos", "admin"]),
  email: Email,
});

export const SetPasswordSchema = z.object({
  password: Password,
});
