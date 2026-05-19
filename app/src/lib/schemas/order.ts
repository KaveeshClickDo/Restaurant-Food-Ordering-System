import { z } from "zod";
import { Email, Phone, NonEmptyString } from "./primitives";

/**
 * Client-side checkout form fields the user fills in directly.
 * The cart, fees, totals etc. come from app state and are re-verified server-side
 * by validateAndNormaliseOrder — no zod schema needed for those here.
 */
export function checkoutFormSchema(opts: { isDelivery: boolean }) {
  return z.object({
    name:    NonEmptyString,
    email:   Email,
    phone:   Phone,
    address: opts.isDelivery ? NonEmptyString : z.string().optional(),
  });
}
