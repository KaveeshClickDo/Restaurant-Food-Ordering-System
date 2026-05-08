"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  UtensilsCrossed, Receipt, CalendarDays, User, LogOut,
  Heart, MapPin, Menu as MenuIcon, X,
} from "lucide-react";
import { useApp } from "@/context/AppContext";

const ACCOUNT_ITEMS = [
  { label: "Account",    Icon: Receipt,  href: "/account",               tab: "orders"     },
  { label: "Favourites", Icon: Heart,    href: "/account?tab=favourites", tab: "favourites" },
  { label: "Addresses",  Icon: MapPin,   href: "/account?tab=addresses",  tab: "addresses"  },
  { label: "Profile",    Icon: User,     href: "/account?tab=profile",    tab: "profile"    },
] as const;

export default function SiteMobileHeader() {
  const { settings, categories, currentUser, logout } = useApp();
  const { restaurant } = settings;
  const pathname            = usePathname();
  const isAccountPage       = pathname.startsWith("/account");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState<string>("orders");

  const reservationsEnabled = settings.reservationSystem?.enabled ?? false;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCurrentTab(params.get("tab") ?? "orders");

    function onTabChange(e: Event) {
      setCurrentTab((e as CustomEvent<{ tab: string }>).detail.tab);
    }
    window.addEventListener("account-tab-change", onTabChange);
    return () => window.removeEventListener("account-tab-change", onTabChange);
  }, [pathname]);

  const headerLinks = (settings.menuLinks ?? [])
    .filter((l) => l.location === "header" && l.active)
    .sort((a, b) => a.order - b.order);

  function close() { setDrawerOpen(false); }

  // Which account item is currently active (for top-bar icon)
  const activeAccountItem =
    isAccountPage
      ? (ACCOUNT_ITEMS.find((i) => i.tab === currentTab) ?? ACCOUNT_ITEMS[0])
      : null;

  return (
    <>
      {/* ── Top bar ── */}
      <header className="lg:hidden flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-white border-b border-zinc-200/70 sticky top-0 z-30">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 min-w-0 mr-auto">
          {restaurant.logoImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={restaurant.logoImage} alt={restaurant.name}
              className="w-7 h-7 rounded-lg object-cover flex-shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-orange-500 text-white flex items-center justify-center text-[12px] font-bold flex-shrink-0">
              {restaurant.name.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-[14px] font-semibold text-zinc-900 tracking-tight truncate">
            {restaurant.name}
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-0.5">
          <Link href="/"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
              pathname === "/" ? "bg-orange-500 text-white" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
            }`}
          >
            <UtensilsCrossed size={13} strokeWidth={1.7} />
            <span className="hidden sm:inline">Menu</span>
          </Link>

          {/* Account — shows the active section's icon */}
          {activeAccountItem ? (
            <Link href={activeAccountItem.href}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors bg-orange-500 text-white"
            >
              <activeAccountItem.Icon size={13} strokeWidth={1.7} />
              <span className="hidden sm:inline">{activeAccountItem.label}</span>
            </Link>
          ) : (
            <Link href="/account"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
            >
              <Receipt size={13} strokeWidth={1.7} />
              <span className="hidden sm:inline">Account</span>
            </Link>
          )}

          {reservationsEnabled && (
            <Link href="/book"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
                pathname.startsWith("/book") ? "bg-orange-500 text-white" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
              }`}
            >
              <CalendarDays size={13} strokeWidth={1.7} />
              <span className="hidden sm:inline">Book</span>
            </Link>
          )}

          {headerLinks.map((link) => {
            const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
            return (
              <Link key={link.id} href={link.href}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors ${
                  active ? "bg-orange-500 text-white" : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                }`}
              >
                <span className="hidden sm:inline">{link.label}</span>
                <span className="sm:hidden text-[10px]">•</span>
              </Link>
            );
          })}
        </nav>

        {currentUser ? (
          <Link href="/account"
            className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-[12px] font-semibold text-orange-700 flex-shrink-0 ml-1">
            {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
          </Link>
        ) : (
          <Link href="/login"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors ml-1">
            <User size={13} strokeWidth={1.7} />
            <span className="hidden sm:inline">Sign in</span>
          </Link>
        )}

        <button
          onClick={() => setDrawerOpen(true)}
          className="ml-1 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors flex-shrink-0"
          aria-label="Open menu"
        >
          <MenuIcon size={18} strokeWidth={1.7} />
        </button>
      </header>

      {/* ── Drawer backdrop ── */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/30 z-40 backdrop-blur-[1px]" onClick={close} />
      )}

      {/* ── Drawer panel ── */}
      <aside className={`lg:hidden fixed top-0 left-0 h-full w-72 bg-white z-50 flex flex-col shadow-2xl transition-transform duration-200 ease-in-out ${
        drawerOpen ? "translate-x-0" : "-translate-x-full"
      }`}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
          <Link href="/" onClick={close} className="flex items-center gap-2 min-w-0">
            {restaurant.logoImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={restaurant.logoImage} alt={restaurant.name}
                className="w-8 h-8 rounded-xl object-cover flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[13px] font-bold flex-shrink-0">
                {restaurant.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="leading-tight min-w-0">
              <div className="text-[13.5px] font-semibold text-zinc-900 tracking-tight truncate">{restaurant.name}</div>
              <div className="text-[10.5px] text-zinc-500 truncate">{restaurant.tagline || "Restaurant"}</div>
            </div>
          </Link>
          <button onClick={close} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors">
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        {/* Nav */}
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 px-2 mb-1.5">Navigate</p>
          <nav className="space-y-0.5">
            <Link href="/" onClick={close}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${
                pathname === "/" ? "bg-orange-500 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`}
            >
              <UtensilsCrossed className="w-[17px] h-[17px]" strokeWidth={1.6} />
              <span>Menu</span>
            </Link>

            {ACCOUNT_ITEMS.map(({ label, Icon, href, tab }) => {
              const active = isAccountPage && currentTab === tab;
              return (
                <Link key={label} href={href} onClick={close}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${
                    active ? "bg-orange-500 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                  }`}
                >
                  <Icon className="w-[17px] h-[17px]" strokeWidth={1.6} />
                  <span>{label}</span>
                </Link>
              );
            })}

            {reservationsEnabled && (
              <Link href="/book" onClick={close}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${
                  pathname.startsWith("/book") ? "bg-orange-500 text-white" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                }`}
              >
                <CalendarDays className="w-[17px] h-[17px]" strokeWidth={1.6} />
                <span>Book a table</span>
              </Link>
            )}

            {headerLinks.map((link) => {
              const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
              return (
                <Link key={link.id} href={link.href} onClick={close}
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
        <div className="px-3 pt-3 pb-2 flex-1 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 px-2 mb-1.5">Categories</p>
          <nav className="space-y-0.5">
            <Link href="/" onClick={close}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] transition-colors text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50">
              <span className="text-base leading-none">🍽️</span>
              <span>Everything</span>
            </Link>
            {categories.map((cat) => (
              <Link key={cat.id} href={`/?cat=${cat.id}`} onClick={close}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] transition-colors text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50">
                <span className="text-base leading-none">{cat.emoji}</span>
                <span>{cat.name}</span>
              </Link>
            ))}
          </nav>
        </div>

        {/* User */}
        <div className="p-3 border-t border-zinc-100">
          {currentUser ? (
            <div className="flex items-center gap-3 px-2 py-1.5">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-[12px] font-semibold text-orange-700 flex-shrink-0">
                {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
              </div>
              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-[13px] font-medium text-zinc-700 truncate">{currentUser.name}</div>
                <Link href="/account" onClick={close} className="text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors">
                  View profile
                </Link>
              </div>
              <button onClick={() => { logout(); close(); }} title="Sign out"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors">
                <LogOut className="w-3.5 h-3.5" strokeWidth={1.8} />
              </button>
            </div>
          ) : (
            <Link href="/login" onClick={close}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 transition-colors">
              <User className="w-[17px] h-[17px]" strokeWidth={1.6} />
              <span>Sign in</span>
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
