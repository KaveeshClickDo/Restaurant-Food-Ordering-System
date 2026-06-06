import { z } from "zod";
import { NonEmptyString, Money, IsoTime } from "./primitives";

// Stock state — must match the enum used by stockUtils.ts and the customer/
// POS/waiter UIs. Anything else in the column is a data-quality bug.
const StockStatusEnum = z.enum(["in_stock", "low_stock", "out_of_stock"]);
const StockQtyValue = z.number().int().min(0, "Stock quantity cannot be negative.");

// Variation groups: each has an id + display name, an optional `required`
// flag (defaults to true when absent — see ItemCustomizationModal), and a
// list of options the customer can pick. The `required` field is what the
// customer site and orderValidation.ts both key off of, so the schema has
// to admit it through unchanged.
const variationSchema = z.object({
  id:       z.string(),
  name:     z.string(),
  required: z.boolean().optional(),
  options:  z.array(z.object({
    id:    z.string(),
    label: z.string(),
    price: z.number(),
  })),
});

// Channels surface filter. POS+waiter both = 'in_store'; customer site = 'online'.
// Defaults applied at the DB level (`{in_store,online}`) for legacy rows.
const ChannelArray = z.array(z.enum(["in_store", "online"])).min(1, "At least one channel is required.").optional();

// Offers (Bug #2 — POS / admin field parity). Shape mirrors MenuItemOffer
// in src/types/index.ts; kept loose because it's stored as JSONB.
const offerSchema = z.object({
  type:      z.enum(["percent","fixed","price","bogo","multibuy","qty_discount"]),
  value:     z.number(),
  label:     z.string().optional(),
  active:    z.boolean(),
  startDate: z.string().optional(),
  endDate:   z.string().optional(),
  buyQty:    z.number().int().optional(),
  freeQty:   z.number().int().optional(),
  minQty:    z.number().int().optional(),
  // Per-channel restriction for the offer itself. Undefined = applies on
  // every channel the item is on (legacy / "global" offer).
  channels:  ChannelArray,
}).passthrough();

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
  variations:  z.array(variationSchema).optional(),
  add_ons:     z.array(z.unknown()).optional(),
  mealPeriodIds: z.array(z.string()).optional(),
  // POS / admin parity fields.
  cost:        z.number().nullable().optional(),
  sku:         z.string().nullable().optional(),
  emoji:       z.string().nullable().optional(),
  color:       z.string().nullable().optional(),
  active:      z.boolean().optional(),
  // Stock fields — validated against the enum so admin can't accidentally
  // store an arbitrary string (which would silently turn into "available" via
  // the resolveStock fallback in stockUtils.ts).
  stock_qty:   StockQtyValue.nullable().optional(),
  stock_status: StockStatusEnum.nullable().optional(),
  track_stock: z.boolean().optional(),
  offer:       offerSchema.nullable().optional(),
  // Channel split + online price override.
  channels:     ChannelArray,
  price_online: Money.nullable().optional(),
}).passthrough();

export const MenuUpdateSchema = z.object({
  name:        NonEmptyString.optional(),
  category_id: NonEmptyString.optional(),
  price:       Money.optional(),
  description: z.string().optional(),
  image:       z.string().optional(),
  dietary:     z.array(z.string()).optional(),
  popular:     z.boolean().optional(),
  variations:  z.array(variationSchema).optional(),
  add_ons:     z.array(z.unknown()).optional(),
  mealPeriodIds: z.array(z.string()).optional(),
  // POS / admin parity fields.
  cost:        z.number().nullable().optional(),
  sku:         z.string().nullable().optional(),
  emoji:       z.string().nullable().optional(),
  color:       z.string().nullable().optional(),
  active:      z.boolean().optional(),
  // Stock fields — validated but stripped server-side in
  // /api/admin/menu/[id] (see STOCK_FIELDS there). Listed here so a bad value
  // is rejected with a clear error rather than silently passed through to the
  // strip step. Live stock writes must go through /api/admin/menu/[id]/stock.
  stock_qty:   StockQtyValue.nullable().optional(),
  stock_status: StockStatusEnum.nullable().optional(),
  track_stock: z.boolean().optional(),
  offer:       offerSchema.nullable().optional(),
  // Channel split + online price override.
  channels:     ChannelArray,
  price_online: Money.nullable().optional(),
}).passthrough();

// ── Categories ───────────────────────────────────────────────────────────────
export const CategoryCreateSchema = z.object({
  id:         NonEmptyString,
  name:       NonEmptyString,
  emoji:      z.string().optional(),
  sort_order: z.number().int().nonnegative().optional(),
  parent_id:  z.string().nullable().optional(),
});

export const CategoryUpdateSchema = z.object({
  name:  z.string().optional(),
  emoji: z.string().optional(),
  parent_id:  z.string().nullable().optional(),
});

export const CategoryReorderSchema = z.object({
  categories: z.array(z.object({
    id:         NonEmptyString,
    name:       z.string(),
    emoji:      z.string(),
    sort_order: z.number().int(),
    parent_id: z.string().nullable().optional(),
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
  theme_color:  z.string().nullable().optional(),
});

export const MealPeriodUpdateSchema = z.object({
  name:         z.string().optional(),
  enabled:      z.boolean().optional(),
  start_time:   IsoTime.optional(),
  end_time:     IsoTime.optional(),
  days_of_week: z.array(DayOfWeek).optional(),
  sort_order:   z.number().int().nonnegative().optional(),
  theme_color:  z.string().nullable().optional(),
});

// ── Dining tables ────────────────────────────────────────────────────────────
const Seats = z.number().int().min(1, "Seats must be at least 1.").max(50, "Seats too large.");

// A VIP table must carry a positive booking fee. Applied as a refine so the
// validation error points at the vipPrice field.
const VipPrice = z.number().nonnegative("Price cannot be negative.").max(100000, "Price too large.");
const requireVipPrice = (data: { isVip?: boolean; vipPrice?: number }) =>
  !data.isVip || (typeof data.vipPrice === "number" && data.vipPrice > 0);
const vipPriceError = { message: "A VIP table needs a booking fee greater than 0.", path: ["vipPrice"] };

// Floor-plan map position: a 0..1 fraction of the plan image, or null to unplace.
const MapCoord = z.number().min(0).max(1).nullable().optional();

export const DiningTableCreateSchema = z.object({
  label:     NonEmptyString,
  number:    z.number().int().nullable().optional(),
  seats:     Seats,
  section:   z.string().optional(),
  active:    z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isVip:     z.boolean().optional(),
  vipPrice:  VipPrice.optional(),
  posX:      MapCoord,
  posY:      MapCoord,
}).refine(requireVipPrice, vipPriceError);

export const DiningTableUpdateSchema = z.object({
  label:     NonEmptyString.optional(),
  number:    z.number().int().nullable().optional(),
  seats:     Seats.optional(),
  section:   z.string().optional(),
  active:    z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isVip:     z.boolean().optional(),
  vipPrice:  VipPrice.optional(),
  posX:      MapCoord,
  posY:      MapCoord,
}).refine(requireVipPrice, vipPriceError);
