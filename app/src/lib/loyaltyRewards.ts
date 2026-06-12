/**
 * Shared select + row mapper for the loyalty reward catalog. Server-only.
 *
 * The menu item is joined so display data (name, image, real price) always
 * tracks the live menu — a reward never stores its own copy.
 */

import type { LoyaltyReward } from "@/types";

export const REWARD_SELECT =
  "id, menu_item_id, name, description, points_cost, active, sort_order, created_at, " +
  "menu_items ( id, name, image, price, active )";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRewardRow(row: any): LoyaltyReward {
  const mi = row.menu_items ?? null;
  return {
    id:            String(row.id),
    menuItemId:    String(row.menu_item_id),
    name:          String(row.name ?? ""),
    description:   String(row.description ?? ""),
    pointsCost:    Number(row.points_cost),
    active:        row.active !== false,
    sortOrder:     Number(row.sort_order ?? 0),
    menuItemName:  mi?.name != null ? String(mi.name) : undefined,
    menuItemImage: mi?.image ?? null,
    menuItemPrice: mi?.price != null ? Number(mi.price) : undefined,
    menuItemActive: mi ? mi.active !== false : false,
  };
}
