/**
 * Menu display choices for the customer website (Admin → Menu → gear).
 * Client-safe. Staff screens (admin, POS, waiter, kitchen) never use this:
 * they always show the photos.
 */

import type { AdminSettings } from "@/types";

/** Should the customer website show menu item photos? Off hides every one:
 *  the menu list, the item pop-up, the home page, favourites and suggestions
 *  then show names, descriptions and prices only. Missing setting = shown. */
export function showMenuImages(settings: Pick<AdminSettings, "menuDisplay"> | null | undefined): boolean {
  return !settings?.menuDisplay?.hideImagesOnWebsite;
}
