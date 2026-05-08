"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UtensilsCrossed, Heart, Receipt, User, CalendarDays, LogOut } from "lucide-react";
import { useApp } from "@/context/AppContext";

export default function SiteSidebar({
  activeCat,
  setCat,
  onAuth,
  onReserve,
}: {
  activeCat: string;
  setCat: (id: string) => void;
  onAuth: () => void;
  onReserve: () => void;
}) {
  const { settings, categories, currentUser, logout } = useApp();
  const { restaurant } = settings;
  const pathname = usePathname();
  const router = useRouter();
  const reservationEnabled = !!settings.reservationSystem?.enabled;

  const navigateToCategory = (id: string) => {
    // Navigate using session storage instead of url parameters
    if (pathname !== "/") {
      sessionStorage.setItem("pendingCategory", id);
      router.push("/");
    } else {
      setCat(id);
    }
  };

  const navItems = [
    { href: "/", label: "Menu", Icon: UtensilsCrossed },
    { href: "/favourites", label: "Favourites", Icon: Heart },
    { href: "/my-orders", label: "My Orders", Icon: Receipt },
    { href: "/account", label: "Profile", Icon: User },
  ];

  const headerLinks = (settings.menuLinks ?? [])
    .filter((l) => l.location === "header" && l.active)
    .sort((a, b) => a.order - b.order);

  return (
    <aside className="hidden lg:flex w-[260px] flex-shrink-0 h-full flex-col bg-white border-r border-zinc-200/70">
      {/* Logo */}
      <div className="p-5 pb-3">
        <Link
          href="/"
          onClick={() => navigateToCategory("all")}
          className="flex items-center gap-2.5 px-1 hover:opacity-80 transition-opacity w-full text-left"
        >
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
          {navItems.map(({ href, label, Icon }) => {
            const active = pathname === href;
            return (
              <Link key={href} href={href}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${active
                    ? "bg-orange-500 text-white"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                  }`}
              >
                <Icon className="w-[17px] h-[17px]" strokeWidth={1.6} />
                <span>{label}</span>
              </Link>
            );
          })}
          {headerLinks.map((link) => (
            <Link key={link.id} href={link.href}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
            >
              <span className="w-[17px] h-[17px] flex items-center justify-center text-[11px] font-bold text-zinc-400">●</span>
              <span>{link.label}</span>
            </Link>
          ))}

          {/* Reserve a Table — shown only when reservation system is enabled */}
          {reservationEnabled && (
            <button
              onClick={onReserve}
              className="w-full flex items-center gap-3 px-3 py-2 mt-1 rounded-xl text-[13.5px] font-semibold transition-all border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white hover:border-orange-500 active:scale-[0.98] group"
            >
              <CalendarDays className="w-[17px] h-[17px]" strokeWidth={1.6} />
              <span>Reserve a Table</span>
            </button>
          )}
        </nav>
      </div>

      {/* Categories */}
      <div className="px-4 pt-3 pb-2 flex-1 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 px-3 mb-2">Categories</p>
        <nav className="space-y-0.5">
          <button
            onClick={() => navigateToCategory("all")}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] transition-colors ${pathname === "/" && activeCat === "all"
                ? "bg-orange-50 text-orange-700 font-medium"
                : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50"
              }`}
          >
            <span className="text-base leading-none">🍽️</span>
            <span>Everything</span>
            {pathname === "/" && activeCat === "all" && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-orange-500" />}
          </button>

          {categories.map((cat) => {
            const active = pathname === "/" && activeCat === cat.id;
            return (
              <button key={cat.id}
                onClick={() => navigateToCategory(cat.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] transition-colors ${active
                    ? "bg-orange-50 text-orange-700 font-medium"
                    : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50"
                  }`}
              >
                <span className="text-base leading-none">{cat.emoji}</span>
                <span>{cat.name}</span>
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-orange-500" />}
              </button>
            );
          })}
        </nav>
      </div>

      {/* User profile */}
      <div className="p-4 border-t border-zinc-100">
        {currentUser ? (
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-[13px] font-semibold text-orange-700 flex-shrink-0">
              {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="text-[13px] font-medium text-zinc-700 truncate">{currentUser.name}</div>
              <Link href="/account" className="text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors">View profile</Link>
            </div>
            <button onClick={logout} title="Sign out" className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors">
              <LogOut className="w-3.5 h-3.5" strokeWidth={1.8} />
            </button>
          </div>
        ) : (
          <button onClick={onAuth}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 transition-colors">
            <User className="w-[17px] h-[17px]" strokeWidth={1.6} />
            <span>Sign in</span>
          </button>
        )}
      </div>
    </aside>
  );
}