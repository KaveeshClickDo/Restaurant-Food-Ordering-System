import { cookies } from "next/headers";
import SiteLayoutClient from "./SiteLayoutClient";
import { THEME_COOKIE_NAME, type ThemeMode } from "@/context/SiteThemeContext";

// Server component so it can read the sg_theme cookie synchronously and hand
// down the correct theme before first paint
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieValue  = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const hadCookie    = cookieValue === "dark" || cookieValue === "light";
  const initialTheme: ThemeMode = cookieValue === "dark" ? "dark" : "light";

  return (
    <SiteLayoutClient initialTheme={initialTheme} hadCookie={hadCookie}>
      {children}
    </SiteLayoutClient>
  );
}
