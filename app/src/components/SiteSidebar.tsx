"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  UtensilsCrossed, Receipt, User, LogOut, CalendarDays,
  Heart, MapPin,
} from "lucide-react";
import { useApp } from "@/context/AppContext";

// Account sub-items with their corresponding ?tab= values.
// "Account" (tab "orders") is the default/root account view.
const ACCOUNT_ITEMS = [
  { label: "Account",    Icon: Receipt,  href: "/account",               tab: "orders"     },
  { label: "Favourites", Icon: Heart,    href: "/account?tab=favourites", tab: "favourites" },
  { label: "Addresses",  Icon: MapPin,   href: "/account?tab=addresses",  tab: "addresses"  },
  { label: "Profile",    Icon: User,     href: "/account?tab=profile",    tab: "profile"    },
] as const;

export default function SiteSidebar() {
  const { settings, categories, currentUser, logout } = useApp();
  const { restaurant } = settings;
  const pathname            = usePathname();
  const isAccountPage       = pathname.startsWith("/account");
  const reservationsEnabled = settings.reservationSystem?.enabled ?? false;

  // Track the current account tab without useSearchParams (avoids Suspense).
  // Initialised from the URL on mount; updated whenever the account page
  // signals a tab change via the "account-tab-change" custom event.
  const [currentTab, setCurrentTab] = useState<string>("orders");

  useEffect(() => {
    // Read initial tab from URL (runs after hydration).
    const params = new URLSearchParams(window.location.search);
    setCurrentTab(params.get("tab") ?? "orders");

    // React to tab changes dispatched by the account page.
    function onTabChange(e: Event) {
      setCurrentTab((e as CustomEvent<{ tab: string }>).detail.tab);
    }
    window.addEventListener("account-tab-change", onTabChange);
    return () => window.removeEventListener("account-tab-change", onTabChange);
  }, [pathname]); // re-seed when navigating to/from /account

  const headerLinks = (settings.menuLinks ?? [])
    .filter((l) => l.location === "header" && l.active)
    .sort((a, b) => a.order - b.order);

  return (
    <aside className="hidden lg:flex w-[260px] flex-shrink-0 h-full flex-col bg-white border-r border-zinc-200/70">

      {/* Logo */}
      <div className="p-5 pb-3">
        <Link href="/" className="flex items-center gap-2.5 px-1 hover:opacity-80 transition-opacity">
          {restaurant.logoImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={restaurant.logoImage} alt={restaurant.name}
              className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[15px] font-bold flex-shrink-0">
              {restaurant.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="leading-tight min-w-0">
            <div className="text-[14.5px] font-semibold text-zinc-900 tracking-tight truncate">{restaurant.name}</div>
            <div className="text-[11px] text-zinc-500 truncate">{restaurant.tagline || "Restaurant"}</div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <div className="px-4 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 px-3 mb-2">Navigate</p>
        <nav className="space-y-0.5">

          {/* Menu */}
          <Link href="/"
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${
              pathname === "/" ? "bg-orange-500 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
            }`}
          >
            <UtensilsCrossed className="w-[17px] h-[17px]" strokeWidth={1.6} />
            <span>Menu</span>
          </Link>

          {/* Account sub-items */}
          {ACCOUNT_ITEMS.map(({ label, Icon, href, tab }) => {
            const active = isAccountPage && currentTab === tab;
            return (
              <Link key={label} href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${
                  active ? "bg-orange-500 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                }`}
              >
                <Icon className="w-[17px] h-[17px]" strokeWidth={1.6} />
                <span>{label}</span>
              </Link>
            );
          })}

          {/* Book a table */}
          {reservationsEnabled && (
            <Link href="/book"
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${
                pathname.startsWith("/book") ? "bg-orange-500 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <CalendarDays className="w-[17px] h-[17px]" strokeWidth={1.6} />
              <span>Book a table</span>
            </Link>
          )}

          {/* Admin-managed header links */}
          {headerLinks.map((link) => {
            const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
            return (
              <Link key={link.id} href={link.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${
                  active ? "bg-orange-500 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                }`}
              >
                <span className="w-[17px] h-[17px] flex items-center justify-center text-[11px] font-bold opacity-60">●</span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Categories */}
      <div className="px-4 pt-3 pb-2 flex-1 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 px-3 mb-2">Categories</p>
        <nav className="space-y-0.5">
          <Link href="/"
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] transition-colors text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50">
            <span className="text-base leading-none">🍽️</span>
            <span>Everything</span>
          </Link>
          {categories.map((cat) => (
            <Link key={cat.id} href={`/?cat=${cat.id}`}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] transition-colors text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50">
              <span className="text-base leading-none">{cat.emoji}</span>
              <span>{cat.name}</span>
            </Link>
          ))}
        </nav>
      </div>

      {/* User */}
      <div className="p-4 border-t border-zinc-100">
        {currentUser ? (
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-[13px] font-semibold text-orange-700 flex-shrink-0">
              {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="text-[13px] font-medium text-zinc-700 truncate">{currentUser.name}</div>
              <Link href="/account" className="text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors">
                View profile
              </Link>
            </div>
            <button onClick={logout} title="Sign out"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors">
              <LogOut className="w-3.5 h-3.5" strokeWidth={1.8} />
            </button>
          </div>
        ) : (
          <Link href="/login"
            className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 transition-colors">
            <User className="w-[17px] h-[17px]" strokeWidth={1.6} />
            <span>Sign in</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
