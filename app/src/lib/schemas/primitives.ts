import { z } from "zod";

export const NonEmptyString = z.string().trim().min(1, "This field is required.");

export const Email = z.email("Please enter a valid email address.").trim();

const phoneShape = (v: string) => {
  if (!/^\+?[\d\s()-]{7,20}$/.test(v)) return false;
  const digits = v.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
};

// Permissive international: keeps +, digits, spaces, parens, dashes.
// Requires 7–15 digits after stripping non-digits — covers UK + international.
export const Phone = z
  .string()
  .trim()
  .min(1, "Phone number is required.")
  .refine(phoneShape, "Please enter a valid phone number.");

export const OptionalPhone = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || phoneShape(v), "Please enter a valid phone number.");

// For *update* paths where the empty string is a valid "clear this field" signal.
export const PhoneOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === "" || phoneShape(v), "Please enter a valid phone number.");

// 4–6 digit PIN — matches existing waiter/kitchen/POS PIN constraints.
export const Pin = z
  .string()
  .regex(/^\d{4,6}$/, "PIN must be 4–6 digits.");

export const Password = z
  .string()
  .min(6, "Password must be at least 6 characters.");

// Non-negative money with ≤ 2 decimal places.
// Uses an epsilon check (not strict equality) because IEEE-754 multiplication
// by 100 can produce float garbage even for clean 2-decimal numbers — e.g.
// `16.67 * 100` is actually `1666.9999999999998` in float, not `1667`. A strict
// `Math.round(n * 100) === n * 100` check would falsely reject `16.67`. The
// epsilon (1e-6, i.e. < 0.000001) tolerates float drift but still catches real
// >2dp values like `0.123` (which produces a drift of ~0.3).
export const Money = z
  .number({ error: "Amount must be a number." })
  .nonnegative("Amount cannot be negative.")
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6,
    "Amount can have at most 2 decimal places.",
  );

export const PositiveMoney = Money.refine((n) => n > 0, "Amount must be greater than zero.");

// CSS hex colour like "#a3f" or "#aabbcc".
export const Hex = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a valid hex colour.");

export const Uuid = z.uuid("Invalid identifier.");

// YYYY-MM-DD
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.");

// HH:MM (24h)
export const IsoTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:MM format.");
