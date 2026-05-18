import { z } from "zod";
import { NonEmptyString, Money, IsoTime } from "./primitives";

// Menu items are flexible — schema preserves the existing freeform shape but
// guards the load-bearing fields. Unknown fields pass through (matches the
// existing route which inserts `body` directly into menu_items).
export const MenuCreateSchema = z.object({
  id:          NonEmptyString,
  name:        NonEmptyString,
  category_id: NonEmptyString,
  price:       Money.optional(),
  description: z.string().optional(),
  image:       z.string().optional(),
  dietary:     z.array(z.string()).optional(),
  popular:     z.boolean().optional(),
  variations:  z.array(z.unknown()).optional(),
  add_ons:     z.array(z.unknown()).optional(),
  mealPeriodIds: z.array(z.string()).optional(),
}).passthrough();

export const MenuUpdateSchema = z.object({
  name:        NonEmptyString.optional(),
  category_id: NonEmptyString.optional(),
  price:       Money.optional(),
  description: z.string().optional(),
  image:       z.string().optional(),
  dietary:     z.array(z.string()).optional(),
  popular:     z.boolean().optional(),
  variations:  z.array(z.unknown()).optional(),
  add_ons:     z.array(z.unknown()).optional(),
  mealPeriodIds: z.array(z.string()).optional(),
}).passthrough();

// ── Categories ───────────────────────────────────────────────────────────────
export const CategoryCreateSchema = z.object({
  id:         NonEmptyString,
  name:       NonEmptyString,
  emoji:      z.string().optional(),
  sort_order: z.number().int().nonnegative().optional(),
});

export const CategoryUpdateSchema = z.object({
  name:  z.string().optional(),
  emoji: z.string().optional(),
});

export const CategoryReorderSchema = z.object({
  categories: z.array(z.object({
    id:         NonEmptyString,
    name:       z.string(),
    emoji:      z.string(),
    sort_order: z.number().int(),
  })),
});

// ── Meal periods ─────────────────────────────────────────────────────────────
const DayOfWeek = z.number().int().min(0).max(6);

export const MealPeriodCreateSchema = z.object({
  id:           z.string().optional(),
  name:         NonEmptyString,
  enabled:      z.boolean().optional(),
  start_time:   IsoTime,
  end_time:     IsoTime,
  days_of_week: z.array(DayOfWeek).optional(),
  sort_order:   z.number().int().nonnegative().optional(),
});

export const MealPeriodUpdateSchema = z.object({
  name:         z.string().optional(),
  enabled:      z.boolean().optional(),
  start_time:   IsoTime.optional(),
  end_time:     IsoTime.optional(),
  days_of_week: z.array(DayOfWeek).optional(),
  sort_order:   z.number().int().nonnegative().optional(),
});

// ── Dining tables ────────────────────────────────────────────────────────────
const Seats = z.number().int().min(1, "Seats must be at least 1.").max(50, "Seats too large.");

export const DiningTableCreateSchema = z.object({
  label:     NonEmptyString,
  number:    z.number().int().nullable().optional(),
  seats:     Seats,
  section:   z.string().optional(),
  active:    z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const DiningTableUpdateSchema = z.object({
  label:     NonEmptyString.optional(),
  number:    z.number().int().nullable().optional(),
  seats:     Seats.optional(),
  section:   z.string().optional(),
  active:    z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});
