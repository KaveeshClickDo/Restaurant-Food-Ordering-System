/**
 * Browser-tab titles for the staff and in-store screens:
 * "<Screen> - <Restaurant name>", e.g. "POS - The Lion Liverpool", so the
 * till, admin and kitchen tabs can be told apart. Each screen's login page
 * shares its screen's title.
 *
 * The customer website keeps the admin's SEO meta title instead, because that
 * is the title search engines show.
 *
 * Used by each screen's layout (the server-rendered title) and by SeoHead,
 * which must not put the SEO title over these screens on the client.
 */
export const STAFF_SCREENS = {
  "/pos":              "POS",
  "/admin":            "Admin",
  "/kitchen":          "Kitchen",
  "/waiter":           "Waiter",
  "/collection":       "Collection",
  "/driver":           "Driver",
  "/customer-display": "Customer Display",
  "/display":          "Digital Signage",
} as const;

export type StaffScreen = keyof typeof STAFF_SCREENS;

/** The staff screen a path belongs to (login page included), or null for the customer website. */
export function staffScreenOf(pathname: string | null | undefined): StaffScreen | null {
  if (!pathname) return null;
  for (const screen of Object.keys(STAFF_SCREENS) as StaffScreen[]) {
    if (pathname === screen || pathname.startsWith(`${screen}/`)) return screen;
  }
  return null;
}

/** "<Screen> - <Restaurant name>", or just the screen's name when the restaurant name is unknown. */
export function staffScreenTitle(screen: StaffScreen, restaurantName?: string | null): string {
  const label = STAFF_SCREENS[screen];
  const name  = restaurantName?.trim();
  return name ? `${label} - ${name}` : label;
}
