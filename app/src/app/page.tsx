import { cookies } from "next/headers";
import HomePageClient from "./HomePageClient";
import { SiteThemeProvider, THEME_COOKIE_NAME, type ThemeMode } from "@/context/SiteThemeContext";

// The home/menu route lives directly at app/src/app/page.tsx — OUTSIDE the
// (site) route group — so it does NOT inherit app/(site)/layout.tsx's
// SiteThemeProvider. It needs its own, for the same flash-free-on-repeat-
// visit reason.
export default async function HomePage() {
  const cookieStore = await cookies();
  const cookieValue  = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const hadCookie    = cookieValue === "dark" || cookieValue === "light";
  const initialTheme: ThemeMode = cookieValue === "dark" ? "dark" : "light";

  return (
    <SiteThemeProvider initialTheme={initialTheme} hadCookie={hadCookie}>
      <HomePageClient />
    </SiteThemeProvider>
  );
}
