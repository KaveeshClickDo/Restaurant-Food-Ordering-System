import { z } from "zod";
import { NonEmptyString, Money } from "./primitives";

const DiscountType = z.enum(["percent", "fixed"]);
const PositiveOrZero = z.number().nonnegative();

export const CouponCreateSchema = z.object({
  code:          NonEmptyString,
  description:   z.string().optional(),
  discountType:  DiscountType,
  discountValue: z.number().positive("Discount value must be greater than zero."),
  minOrderTotal: PositiveOrZero.optional(),
  maxUses:       z.number().int().positive().nullable().optional(),
  expiresAt:     z.string().nullable().optional(),
  active:        z.boolean().optional(),
});

export const CouponUpdateSchema = z.object({
  description:   z.string().optional(),
  discountType:  DiscountType.optional(),
  discountValue: z.number().positive().optional(),
  minOrderTotal: PositiveOrZero.optional(),
  maxUses:       z.number().int().positive().nullable().optional(),
  expiresAt:     z.string().nullable().optional(),
  active:        z.boolean().optional(),
  usageCount:    z.number().int().nonnegative().optional(),
});
// Money is unused here but kept imported for consistency with money primitives.
void Money;
