/**
 * Zod schemas for the loyalty rewards program.
 *
 * Rewards are point-priced menu items managed from Admin → Operations →
 * Loyalty Program. Redemption rides the normal order flow: the cart carries a
 * loyalty_reward_id, orderValidation re-verifies it, and the points debit is
 * an atomic apply_loyalty_points() gate next to store credit / gift cards.
 */

import { z } from "zod";

export const LoyaltyRewardCreateSchema = z.object({
  menuItemId:  z.string().min(1, "A menu item is required."),
  name:        z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  pointsCost:  z.number().int().positive("Points cost must be a positive whole number."),
  active:      z.boolean().optional(),
  sortOrder:   z.number().int().optional(),
});

export const LoyaltyRewardUpdateSchema = z.object({
  menuItemId:  z.string().min(1).optional(),
  name:        z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  pointsCost:  z.number().int().positive().optional(),
  active:      z.boolean().optional(),
  sortOrder:   z.number().int().optional(),
});
