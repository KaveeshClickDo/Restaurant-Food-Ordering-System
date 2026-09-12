"use client";

/**
 * Dark/light theme for the customer ordering site ONLY — kept separate from
 * AppContext (shared by admin/waiter/kitchen/driver/collection) so theme
 * state stays out of reach of those portals.
 *
 * Persisted via a `sg_theme` cookie, not localStorage, so the server can
 * read it (see app/(site)/layout.tsx) and render the right class on first
 * paint — no flash. First-ever visit (no cookie) falls back to OS
 * preference via the useLayoutEffect below, before paint.
 */

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark";

export const THEME_COOKIE_NAME = "sg_theme";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function writeThemeCookie(theme: ThemeMode) {
  try {
    document.cookie = `${THEME_COOKIE_NAME}=${theme}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  } catch {
    // Private browsing / cookies disabled 
  }
}

interface SiteThemeValue {
  theme: ThemeMode;
  toggleTheme: () => void;
}

const SiteThemeContext = createContext<SiteThemeValue | null>(null);

export function SiteThemeProvider({
  initialTheme,
  hadCookie,
  children,
}: {
  initialTheme: ThemeMode;
  hadCookie: boolean;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useLayoutEffect(() => {
    if (hadCookie) return;
    try {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setTheme("dark");
        writeThemeCookie("dark");
      }
    } catch {
      // matchMedia unavailable — keep the server-rendered light default.
    }
    // Only ever relevant on mount, for a first-ever visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleTheme() {
    setTheme((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      writeThemeCookie(next);
      return next;
    });
  }

  return (
    <SiteThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </SiteThemeContext.Provider>
  );
}

export function useSiteTheme(): SiteThemeValue {
  const ctx = useContext(SiteThemeContext);
  if (!ctx) throw new Error("useSiteTheme must be used within SiteThemeProvider");
  return ctx;
}
