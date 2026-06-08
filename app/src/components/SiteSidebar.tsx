"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UtensilsCrossed, Heart, Receipt, User, CalendarDays, LogOut, ChevronDown, ChevronUp } from "lucide-react";
import { useApp } from "@/context/AppContext";
import type { Category } from "@/types";
import { useMemo, useState } from "react";

// ─── helpers ──────────────────────────────────────────────────────────────────

function getParents(cats: Category[]) {
  return cats
    .filter((c) => !c.parentId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function getChildren(parentId: string, cats: Category[]) {
  return cats
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export default function SiteSidebar({
  activeCat,
  setCat,
  onAuth,
  onReserve,
  categories: categoriesOverride,
}: {
  activeCat: string;
  setCat: (id: string) => void;
  onAuth: () => void;
  onReserve: () => void;
  /** Optional pre-filtered list (e.g. with breakfast hidden outside its window).
   *  Falls back to the full AppContext list when omitted. */
  categories?: Category[];
}) {
  const { settings, categories: allCategories, currentUser, logout } = useApp();
  const categories = categoriesOverride ?? allCategories;
  const { restaurant } = settings;
  const pathname = usePathname();
  const router = useRouter();
  const reservationEnabled = !!settings.reservationSystem?.enabled;

  // Which parent categories are expanded in the sidebar
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
    // Auto-expand the parent of the currently active sub-category on mount
    const active = categories.find((c) => c.id === activeCat);
    return active?.parentId ? new Set([active.parentId]) : new Set();
  });

  const parents = useMemo(() => getParents(categories), [categories]);

  function toggleExpand(parentId: string) {
    setExpandedParents((prev) => {
      // 1. If the clicked parent is already expanded, collapse it by returning an empty Set
      if (prev.has(parentId)) {
        return new Set();
      }

      // 2. Otherwise, return a new Set containing ONLY the clicked parent ID.
      // This automatically collapses any previously open parent.
      return new Set([parentId]);
    });
  }

  const navigateToCategory = (id: string) => {
    // Navigate using session storage instead of url parameters
    if (pathname !== "/") {
      sessionStorage.setItem("pendingCategory", id);
      router.push("/");
    } else {
      setCat(id);
    }
  };

  // When clicking a parent that has children — expand it AND navigate to it
  const handleParentClick = (parent: Category) => {
    const children = getChildren(parent.id, categories);
    if (children.length > 0) {
      toggleExpand(parent.id);
    }
    navigateToCategory(parent.id);
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

  // Is a given cat id "active" — also true when activeCat is a child of it
  const isCatActive = (catId: string) => {
    if (activeCat === catId) return true;
    // Check if activeCat is a child of this parent
    const activeCatObj = categories.find((c) => c.id === activeCat);
    return activeCatObj?.parentId === catId;
  };

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

          {/* Parent → children tree */}
          {parents.map((parent) => {
            const children = getChildren(parent.id, categories);
            const hasKids = children.length > 0;
            const isExpanded = expandedParents.has(parent.id);
            const parentActive = pathname === "/" && isCatActive(parent.id);
            const isDirectSel = pathname === "/" && activeCat === parent.id;

            return (
              <div key={parent.id}>
                {/* Parent row */}
                <button
                  onClick={() => handleParentClick(parent)}
                  className={`w-full flex items-center rounded-xl px-3 py-2 gap-2.5 transition-colors text-left ${parentActive
                    ? "bg-orange-50 text-orange-700 font-medium"
                    : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50"
                    }`}
                >
                  <span className="text-base leading-none flex-shrink-0">{parent.emoji}</span>
                  <span className="flex-1 text-[13.5px] truncate">{parent.name}</span>

                  {/* Visual toggle indicator */}
                  {hasKids && (
                    <div>
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4" strokeWidth={2.5} />
                        : <ChevronDown className="w-4 h-4" strokeWidth={2.5} />}
                    </div>
                  )}

                  {isDirectSel && !hasKids && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
                  )}
                </button>

                {/* Children — shown when expanded */}
                {hasKids && isExpanded && (
                  <div className="ml-4 mt-0.5 mb-1 border-l border-zinc-100 pl-1 space-y-0.5">
                    {children.map((child) => {
                      const childActive = pathname === "/" && activeCat === child.id;
                      return (
                        <button
                          key={child.id}
                          onClick={() => navigateToCategory(child.id)}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors ${childActive
                            ? "bg-orange-50 text-orange-700 font-medium"
                            : "text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"
                            }`}
                        >
                          <span className="text-sm leading-none flex-shrink-0">{child.emoji}</span>
                          <span className="truncate">{child.name}</span>
                          {childActive && (
                            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
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