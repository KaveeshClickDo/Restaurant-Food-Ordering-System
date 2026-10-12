/**
 * Plain (non "use client") constant + type shared between SiteThemeContext
 * (a client module) and the Server Components that read the theme cookie.
 */

export type ThemeMode = "light" | "dark";

export const THEME_COOKIE_NAME = "sg_theme";
