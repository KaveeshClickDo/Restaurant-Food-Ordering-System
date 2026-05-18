import { z } from "zod";
import { Email, OptionalPhone, NonEmptyString, Money } from "./primitives";

// Self-service profile update — strict allowlist.
export const CustomerProfileUpdateSchema = z.object({
  name:            NonEmptyString.optional(),
  phone:           z.string().optional(),
  favourites:      z.array(z.unknown()).optional(),
  saved_addresses: z.array(z.unknown()).optional(),
});

// Admin customer create — strict allowlist. password_hash, reset_token,
// email_verification_token, etc. are NOT writable here; if an admin needs
// to set a password they go through the dedicated /admin/users routes.
export const AdminCustomerCreateSchema = z.object({
  id:              NonEmptyString,
  name:            NonEmptyString,
  email:           Email,
  phone:           OptionalPhone.optional(),
  tags:            z.array(z.string()).optional(),
  favourites:      z.array(z.string()).optional(),
  saved_addresses: z.array(z.unknown()).optional(),
  store_credit:    Money.optional(),
  email_verified:  z.boolean().optional(),
});

// Admin customer update — same allowlist minus the required id/email.
export const AdminCustomerUpdateSchema = z.object({
  name:            NonEmptyString.optional(),
  email:           Email.optional(),
  phone:           OptionalPhone.optional(),
  tags:            z.array(z.string()).optional(),
  favourites:      z.array(z.string()).optional(),
  saved_addresses: z.array(z.unknown()).optional(),
  store_credit:    Money.optional(),
  email_verified:  z.boolean().optional(),
});

// Admin updates on reservation_customers.
export const ReservationCustomerUpdateSchema = z.object({
  notes:          z.string().optional(),
  tags:           z.array(z.string()).optional(),
  marketingOptIn: z.boolean().optional(),
});

// Guest profile upsert (called at checkout).
export const GuestProfileSchema = z.object({
  email:      Email,
  name:       z.string().optional(),
  phone:      OptionalPhone,
  orderTotal: Money.optional(),
});
