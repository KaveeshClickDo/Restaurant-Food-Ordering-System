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
// loyaltyPoints/giftCardBalance/notes are POS-shared fields (Bug #11) that the
// customer drawer + POS terminal both write. `active` is the toggle exposed on
// the customer drawer for disabling logins.
export const AdminCustomerUpdateSchema = z.object({
  name:            NonEmptyString.optional(),
  email:           Email.optional(),
  phone:           OptionalPhone.optional(),
  tags:            z.array(z.string()).optional(),
  favourites:      z.array(z.string()).optional(),
  saved_addresses: z.array(z.unknown()).optional(),
  store_credit:    Money.optional(),
  email_verified:  z.boolean().optional(),
  active:          z.boolean().optional(),
  notes:           z.string().optional(),
  loyaltyPoints:   z.number().int().nonnegative().optional(),
  giftCardBalance: Money.optional(),
  // Un-delete a soft-deleted customer (clears deleted_at, stamps reactivated_at).
  restore:         z.boolean().optional(),
});

// Optional body for the customer DELETE routes. `block` = true turns the soft
// delete into a ban: re-registration with this email is refused rather than
// reactivating the old account.
export const CustomerDeleteSchema = z.object({
  block: z.boolean().optional(),
});

// Admin updates on marketing_contacts.
export const ReservationCustomerUpdateSchema = z.object({
  notes:          z.string().optional(),
  tags:           z.array(z.string()).optional(),
  marketingOptIn: z.boolean().optional(),
});

// CSV import into marketing_contacts (Admin → Marketing → Audience → Import).
// The browser parses the file and maps its columns, then posts normalised rows
// in batches. Emails are deliberately NOT validated here: one malformed
// address in a 900-row spreadsheet must not reject the whole batch, so row
// validation happens in importMarketingContacts and comes back as a count of
// skipped rows. `consent` is the admin's PECR confirmation that the list has
// permission to be emailed — the import is refused without it.
export const MarketingContactImportSchema = z.object({
  rows: z
    .array(
      z.object({
        email: z.string().max(320),
        name:  z.string().max(200).optional(),
        phone: z.string().max(40).optional(),
        tags:  z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        optIn: z.boolean().optional(),
      }),
    )
    .min(1, "There are no rows to import.")
    .max(500, "Send the file in batches of 500 rows or fewer."),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  consent: z.literal(true, {
    error: "Confirm that these people agreed to receive marketing email from you.",
  }),
});

// Guest profile upsert (called at checkout).
export const GuestProfileSchema = z.object({
  email:      Email,
  name:       z.string().optional(),
  phone:      OptionalPhone,
  orderTotal: Money.optional(),
});

// ── POS customer mutations (Bug #11) ─────────────────────────────────────────
// The POS terminal calls these. Email is optional because walk-in customers
// might only provide a name. Loyalty + gift card adjustments are clamped
// non-negative server-side. tags/notes are free-form.
export const PosCustomerCreateSchema = z.object({
  name:            NonEmptyString,
  email:           z.string().trim().email().optional().or(z.literal("")),
  phone:           z.string().optional(),
  notes:           z.string().optional(),
  tags:            z.array(z.string()).optional(),
  loyaltyPoints:   z.number().int().nonnegative().optional(),
  giftCardBalance: Money.optional(),
  /** Marketing checkbox on the POS create-customer form (default ticked).
   *  false → the marketing contact is created unsubscribed. */
  marketingOptIn:  z.boolean().optional().default(true),
});

export const PosCustomerUpdateSchema = z.object({
  name:            NonEmptyString.optional(),
  email:           z.string().trim().email().optional().or(z.literal("")),
  phone:           z.string().optional(),
  notes:           z.string().optional(),
  tags:            z.array(z.string()).optional(),
  loyaltyPoints:   z.number().int().nonnegative().optional(),
  giftCardBalance: Money.optional(),
});
