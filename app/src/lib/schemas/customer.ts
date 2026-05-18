import { z } from "zod";
import { Email, OptionalPhone, NonEmptyString, Money } from "./primitives";

// Self-service profile update — strict allowlist.
export const CustomerProfileUpdateSchema = z.object({
  name:            NonEmptyString.optional(),
  phone:           z.string().optional(),
  favourites:      z.array(z.unknown()).optional(),
  saved_addresses: z.array(z.unknown()).optional(),
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
