"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Category, MenuItem } from "@/types";
import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import {
  Search, ShoppingBag, UtensilsCrossed,
  Plus, Clock, Bike,
  Star, CalendarDays, LogOut, LayoutDashboard, Heart,
  AlertCircle, Sun, Moon,
} from "lucide-react";
import Link from "next/link";
import AuthModal from "@/components/AuthModal";
import ScheduleOrderModal from "@/components/ScheduleOrderModal";
import ItemCustomizationModal from "@/components/ItemCustomizationModal";
import ReservationModal from "@/components/ReservationModal";
import SiteFooter from "@/components/SiteFooter";
import MealPeriodSection from "@/components/MealPeriodSection";
import { isMealPeriodActive } from "@/lib/scheduleUtils";
import { resolveStock } from "@/lib/stockUtils";
import { showMenuImages } from "@/lib/menuDisplay";
import { isOfferActive, getOfferUnitPrice, offerBadgeLabel, effectiveMenuPrice, isOnChannel } from "@/lib/menuOfferUtils";
import { getNextOpenTime, formatNextOpen } from "@/lib/scheduleUtils";
import MobileBottomNav from "@/components/MobileBottomNav";
import Cart from "@/components/Cart";
import SiteSidebar from "@/components/SiteSidebar";
import { useSiteTheme } from "@/context/SiteThemeContext";

// ── Dietary badge map ───────────────────────────────────────────────────────
const DIET_SHORT: Record<string, string> = {
  vegetarian: "V", vegan: "Ve", halal: "H", "gluten-free": "GF",
};

// ── Individual food card (grid layout) ─────────────────────────────────────
function FoodCard({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  const { isOpen, scheduledTime, currentUser, isFavourite, toggleFavourite, settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  // Admin → Menu → gear can hide every photo on the website. The band at the
  // top of the card stays (it carries the badges, heart and quick-add) but
  // shrinks, so the card keeps its design without a photo.
  const photo = showMenuImages(settings) ? item.image : undefined;
  const stockStatus = resolveStock(item);
  const outOfStock = stockStatus === "out_of_stock";
  const lowStock = stockStatus === "low_stock";
  const canAdd = (isOpen || !!scheduledTime) && !outOfStock;
  const faved = isFavourite(item.id);

  // Offer pricing — per-unit discounted price for badge + strikethrough.
  // Cart-level offers (bogo/multibuy/qty_discount) don't change the per-unit
  // shelf price, but we still show the badge so customers know there's a
  // deal in the cart.
  const offerOn = isOfferActive(item);
  const discountedBase = getOfferUnitPrice(item);
  const offerLabel = offerBadgeLabel(item);

  return (
    <div
      onClick={() => canAdd && onOpen()}
      className={`bg-white dark:bg-[var(--brand-surface-dark)] rounded-2xl border border-zinc-200/70 dark:border-[var(--brand-border-dark)] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)] overflow-hidden group transition-transform duration-200 ${canAdd ? "cursor-pointer hover:-translate-y-0.5" : "opacity-60 cursor-not-allowed"
        }`}
    >
      {/* Image */}
      <div className={`relative ${showMenuImages(settings) ? "h-[180px]" : "h-[96px]"} bg-orange-50 overflow-hidden`}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded URLs from arbitrary hosts; next/image can't pre-register remotePatterns
          <img
            src={photo}
            alt={item.name}
            className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${outOfStock ? "grayscale opacity-50" : ""}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <UtensilsCrossed className="w-10 h-10 text-zinc-300 dark:text-zinc-700" strokeWidth={1.2} />
          </div>
        )}
        {/* Popular + offer badges sit side by side in a flex row so an item
            that is both popular and on offer shows both, without overlapping. */}
        {!outOfStock && (item.popular || (offerOn && offerLabel)) && (
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1">
            {item.popular && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-orange-500/90 text-white backdrop-blur-sm">
                Popular
              </span>
            )}
            {offerOn && offerLabel && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-orange-500/95 text-white backdrop-blur-sm shadow-sm">
                {offerLabel}
              </span>
            )}
          </div>
        )}
        {outOfStock && (
          <span className="absolute top-2.5 left-2.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
            Unavailable
          </span>
        )}
        {/* Low-stock urgency — only when running low (qty ≤ threshold). Bottom-left
            so it never collides with the popular/offer (top-left) or heart (top-right). */}
        {lowStock && !outOfStock && (
          <span className="absolute bottom-2.5 left-2.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-500/95 text-white backdrop-blur-sm shadow-sm">
            {typeof item.stockQty === "number" ? `Only ${item.stockQty} left` : "Low stock"}
          </span>
        )}

        {/* Heart / favourite button — shown for logged-in users */}
        {currentUser && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleFavourite(item.id); }}
            aria-label={faved ? "Remove from favourites" : "Save to favourites"}
            className={`absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-all duration-0 ${faved
              ? "bg-red-500 text-white scale-100"
              : "bg-white/90 dark:bg-black/50 text-zinc-400 hover:text-red-500"
              }`}
          >
            <Heart className="w-3.5 h-3.5" strokeWidth={2} fill={faved ? "currentColor" : "none"} />
          </button>
        )}

        {canAdd && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            aria-label="Quick add"
            className="absolute bottom-2.5 right-2.5 w-9 h-9 rounded-xl bg-orange-500 text-white hover:bg-orange-600 flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-200"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        <h3 className="font-medium text-[15px] leading-snug text-zinc-900 dark:text-[var(--brand-text-dark)] mb-1">{item.name}</h3>
        <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400 leading-snug line-clamp-2 mb-3">{item.description}</p>
        {item.dietary.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2.5">
            {item.dietary.slice(0, 3).map((d) => (
              <span key={d} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">
                {DIET_SHORT[d] ?? d}
              </span>
            ))}
          </div>
        )}
        {discountedBase !== null ? (
          <span className="inline-flex items-baseline gap-1.5 tabular-nums">
            <span className="font-semibold text-[17px] text-orange-600 tracking-tight">
              {sym}{discountedBase.toFixed(2)}
            </span>
            <span className="text-[12px] text-zinc-400 dark:text-zinc-500 line-through">
              {sym}{effectiveMenuPrice(item).toFixed(2)}
            </span>
          </span>
        ) : (
          <span className="font-semibold text-[17px] text-zinc-900 dark:text-[var(--brand-text-dark)] tracking-tight tabular-nums">
            {sym}{effectiveMenuPrice(item).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Grid placeholder while the initial menu fetch is in flight ─────────────
// Shown instead of FoodCard so the first paint never reads as "no items in
// this category" before the menu has even loaded (see menuItemsLoaded).
function FoodCardSkeleton() {
  return (
    <div className="bg-white dark:bg-[var(--brand-surface-dark)] rounded-2xl border border-zinc-200/70 dark:border-[var(--brand-border-dark)] overflow-hidden animate-pulse">
      <div className="h-[180px] bg-zinc-200/70 dark:bg-white/5" />
      <div className="p-4 space-y-2.5">
        <div className="h-4 bg-zinc-200/90 dark:bg-white/10 rounded w-3/4" />
        <div className="h-3 bg-zinc-200/90 dark:bg-white/10 rounded w-full" />
        <div className="h-3 bg-zinc-200/90 dark:bg-white/10 rounded w-5/6" />
        <div className="h-5 bg-zinc-200/90 dark:bg-white/10 rounded w-1/3 mt-1" />
      </div>
    </div>
  );
}

// ── Hero banner ──────────────────────────────────────────────────────────────
function Hero({ isOpen, onReserve }: { isOpen: boolean; onReserve: () => void }) {
  const { settings, fulfillment, setFulfillment } = useApp();
  const { restaurant } = settings;
  const [showSchedule, setShowSchedule] = useState(false);

  const nextOpen = !isOpen
    ? getNextOpenTime(settings.schedule, settings.manualClosed)
    : null;

  // ── Logic for available modes ──
  const hasDelivery = restaurant.deliveryEnabled !== false; // defaults to true
  const hasCollection = restaurant.collectionEnabled !== false; // defaults to true
  const bothEnabled = hasDelivery && hasCollection;

  // Auto-correct fulfillment if current selection is disabled by admin
  useEffect(() => {
    if (!hasDelivery && fulfillment === "delivery") setFulfillment("collection");
    if (!hasCollection && fulfillment === "collection") setFulfillment("delivery");
  }, [hasDelivery, hasCollection, fulfillment, setFulfillment]);

  const isDelivery = fulfillment === "delivery";
  const sym = settings.currency?.symbol ?? "£";
  const estTime = isDelivery ? restaurant.deliveryTime : restaurant.collectionTime;
  const feeLabel = isDelivery
    ? (restaurant.deliveryFee > 0 ? `From ${sym}${restaurant.deliveryFee.toFixed(2)} fee` : "Free delivery")
    : "Free · no fee";

  return (
    <>
      <div className="mx-5 md:mx-6 mt-6 mb-6 rounded-2xl overflow-hidden bg-white dark:bg-[var(--brand-surface-dark)] border border-zinc-200/70 dark:border-[var(--brand-border-dark)] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]">
        <div className="relative px-6 md:px-8 py-7 flex items-center gap-7 bg-orange-50 dark:bg-[var(--brand-bg-dark)] overflow-hidden">
          {/* Cover image or dot pattern background */}
          {restaurant.coverImage ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={restaurant.coverImage} alt="" aria-hidden
                className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none select-none" />
              <div className="absolute inset-0 bg-gradient-to-r from-orange-50/90 via-orange-50/60 to-transparent dark:from-orange-50 dark:via-orange-50/70 dark:to-transparent pointer-events-none" />
            </>
          ) : (
            <div className="absolute right-0 top-0 bottom-0 w-2/5 pointer-events-none opacity-40">
              <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="xMaxYMid slice">
                <defs>
                  <pattern id="hero-dots" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="1.2" fill="#71717a" opacity="0.4" />
                  </pattern>
                </defs>
                <rect width="400" height="200" fill="url(#hero-dots)" />
              </svg>
            </div>
          )}
          <div className="relative flex-1 min-w-0">
            {isOpen ? (
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-white/5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Open · accepting orders
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-950/40 text-[10.5px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Closed
              </div>
            )}
            <h1 className="font-semibold tracking-tight text-[28px] md:text-[32px] leading-[1.05] mb-1.5 text-zinc-900 dark:text-[var(--brand-text-dark)]">
              {restaurant.name}
            </h1>
            <p className="text-[14px] text-zinc-500 dark:text-zinc-400 mb-4 max-w-md">{restaurant.tagline}</p>

            {/* ── Delivery / Collection toggle ─────────────────────────── */}
            {bothEnabled ? (
              /* Toggle only shows if both are active */
              <div className="inline-flex items-center p-1 rounded-xl bg-white dark:bg-white/5 border border-zinc-200/80 dark:border-[var(--brand-border-dark)] shadow-sm mb-5">
                <button
                  onClick={() => setFulfillment("delivery")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold ${isDelivery ? "bg-orange-500 text-white shadow-sm" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white"
                    }`}
                >
                  <Bike className="w-3.5 h-3.5" strokeWidth={1.8} />
                  Delivery
                </button>
                <button
                  onClick={() => setFulfillment("collection")}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold ${!isDelivery ? "bg-orange-500 text-white shadow-sm" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white"
                    }`}
                >
                  <ShoppingBag className="w-3.5 h-3.5" strokeWidth={1.8} />
                  Collection
                </button>
              </div>
            ) : (
              /* Single mode UI: Shows a button-like indicator + text */
              <div className="flex items-center gap-3 mb-5">
                <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-orange-500 text-white shadow-sm">
                  {isDelivery ? <Bike className="w-3.5 h-3.5" /> : <ShoppingBag className="w-3.5 h-3.5" />}
                  {isDelivery ? "Delivery Only" : "Collection Only"}
                </div>
              </div>
              // <div className="flex items-center gap-2 mb-5">
              //   <div className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold flex items-center gap-2">
              //     {isDelivery ? <Bike size={14} /> : <ShoppingBag size={14} />}
              //     Available for {isDelivery ? "Delivery" : "Collection"} only
              //   </div>
              // </div>
            )}


            {/* Stats — contextual to selected mode */}
            <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-zinc-600 dark:text-zinc-400">
              {restaurant.hygieneRatingVisible !== false && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5" strokeWidth={2} fill="currentColor" />
                    <span className="font-semibold">{restaurant.hygieneRating}</span>
                    <span className="text-zinc-400">· hygiene</span>
                  </span>
                  <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                </>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" strokeWidth={1.8} />
                <span className="font-medium">{estTime} min</span>
              </span>
              <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              <span className="inline-flex items-center gap-1.5">
                {isDelivery
                  ? <Bike className="w-3.5 h-3.5" strokeWidth={1.8} />
                  : <ShoppingBag className="w-3.5 h-3.5" strokeWidth={1.8} />}
                <span className="font-medium">{feeLabel}</span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-4">
              {settings.reservationSystem?.enabled && (
                <button
                  onClick={onReserve}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white text-[13px] font-semibold transition-all"
                >
                  <CalendarDays className="w-3.5 h-3.5" strokeWidth={1.8} />
                  Reserve a Table
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Closed banner — only when store is shut */}
        {!isOpen && (
          <div className="flex flex-wrap justify-between items-center gap-3 px-6 py-3.5 bg-red-50 dark:bg-red-950/40 border-t border-red-100 dark:border-red-900">
            <div className="flex gap-2 ">
              <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 flex-shrink-0" strokeWidth={1.8} />
              <p className="flex-1 text-[12.5px] text-red-700 dark:text-red-400 font-medium min-w-0">
                {nextOpen
                  ? <>We&apos;re closed · Opens {formatNextOpen(nextOpen)}</>
                  : "We're not accepting orders right now"}
              </p>
            </div>
            {nextOpen && (
              <button
                onClick={() => setShowSchedule(true)}
                className="flex-shrink-0 flex items-center gap-1.5 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white text-[12px] font-bold px-3 py-1.5 rounded-lg transition-all whitespace-nowrap"
              >
                <CalendarDays className="w-3 h-3" strokeWidth={2} />
                Order for later
              </button>
            )}
          </div>
        )}
      </div>

      {showSchedule && <ScheduleOrderModal onClose={() => setShowSchedule(false)} />}
    </>
  );
}

/** All category ids that should show when `activeCat` is selected.
 *  If a parent is selected → include its children too.
 *  If a child is selected → just that child. */
function effectiveCatIds(activeCat: string, cats: Category[]): string[] | null {
  if (activeCat === "all") return null;
  const childIds = cats.filter((c) => c.parentId === activeCat).map((c) => c.id);
  return [activeCat, ...childIds];
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function HomePageClient() {
  const {
    categories, categoriesLoaded, menuItems: allMenuItems, menuItemsLoaded, mealPeriods, settings,
    isOpen, currentUser, logout, cart
  } = useApp();
  const cartHasItems = cart.length > 0;
  const { theme, toggleTheme } = useSiteTheme();

  const router = useRouter();
  const [activeCat, setActiveCat] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const pendingCat = sessionStorage.getItem("pendingCategory");
    if (pendingCat) {
      setActiveCat(pendingCat);
      sessionStorage.removeItem("pendingCategory");
    }
  }, []);

  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [authModal, setAuthModal] = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showReservation, setShowReservation] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Open a dish from a search suggestion. Blur the input first so the mobile
  // keyboard dismisses before the customization modal slides up.
  const openSuggestion = (item: MenuItem) => {
    searchInputRef.current?.blur();
    setSearchFocused(false);
    setOpenItem(item);
  };

  // ── Meal-period awareness ────────────────────────────────────────────────
  // Tick re-renders the page every 30s so meal-period sections appear/disappear
  // as windows open and close while the tab stays open.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Customer site = `online` channel. Hide items admin marked in-store-only.
  // Legacy items (no channels field set) default to both channels in the
  // mapper, so they stay visible.
  const menuItems = allMenuItems.filter((m) => isOnChannel(m, "online"));

  // Open a dish handed off from another page's search dropdown (account,
  // favourites, my-orders). Don't clear the pending id until it's actually 
  // found, in case this runs before menuItems has loaded.
  useEffect(() => {
    const pendingItemId = sessionStorage.getItem("pendingOpenItem");
    if (!pendingItemId) return;
    const found = menuItems.find((m) => m.id === pendingItemId);
    if (found) {
      sessionStorage.removeItem("pendingOpenItem");
      setOpenItem(found);
    }
  }, [menuItems]);

  const activeMealPeriods = mealPeriods.filter((p) => isMealPeriodActive(p));
  const activeMealPeriodIds = new Set(activeMealPeriods.map((p) => p.id));

  /** True iff this item is orderable right now. Anytime items (no tags) always
   *  orderable; tagged items need at least one of their periods currently active. */
  const isItemOrderable = (item: MenuItem) => {
    const tags = item.mealPeriodIds ?? [];
    if (tags.length === 0) return true;
    return tags.some((id) => activeMealPeriodIds.has(id));
  };

  // Categories visible to the customer — hide any category whose only items
  // are currently non-orderable (e.g. a category full of dinner-only items
  // during breakfast). Empty categories stay visible.

  const visibleCategories = categories.filter((cat) => {
    // For a parent: visible if it itself has orderable items OR any child does
    if (!cat.parentId) {
      const ownItems = menuItems.filter((i) => i.categoryId === cat.id);
      const childIds = categories.filter((c) => c.parentId === cat.id).map((c) => c.id);
      const childItems = menuItems.filter((i) => childIds.includes(i.categoryId));
      const allItems = [...ownItems, ...childItems];
      if (allItems.length === 0) return true;           // empty categories stay visible
      return allItems.some(isItemOrderable);
    }
    // For a sub-category: same logic as before
    const catItems = menuItems.filter((i) => i.categoryId === cat.id);
    if (catItems.length === 0) return true;
    return catItems.some(isItemOrderable);
  });

  // If the customer was on a category that just became hidden (window closed
  // or admin disabled), snap them back to "all".
  useEffect(() => {
    if (activeCat === "all") return;
    if (!visibleCategories.some((c) => c.id === activeCat)) setActiveCat("all");
  }, [activeCat, visibleCategories]);

  // Filtered items (search + category). Apply meal-period orderability after.

  const activeCatIds = effectiveCatIds(activeCat, categories);

  const filteredItems = menuItems
    .filter((item) => {
      if (activeCatIds && !activeCatIds.includes(item.categoryId)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!item.name.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .filter(isItemOrderable);

  // Show dedicated meal-period sections only on the default "Everything" view
  // with no search/filter active. Otherwise the customer is drilling into
  // something specific and we keep the layout flat.
  const isBrowsingAll = activeCat === "all" && !search;
  const sectionsToShow = isBrowsingAll
    ? activeMealPeriods
      .map((p) => ({
        period: p,
        items: filteredItems.filter((i) => (i.mealPeriodIds ?? []).includes(p.id)),
      }))
      .filter(({ items }) => items.length > 0)
    : [];

  const itemsInAnySection = new Set(sectionsToShow.flatMap((s) => s.items.map((i) => i.id)));

  // Main grid: anytime items + tagged items not currently shown in a section.
  // When sectionsToShow is empty (search/filter view), the grid is everything
  // orderable; when sections exist, those items move into them.
  const items = filteredItems.filter((i) => !itemsInAnySection.has(i.id));

  const visibleTotal = filteredItems.length;
  // We reference nowTick in render so re-renders keep the section state in
  // sync with wall-clock time (eslint also stops complaining about an unused var).
  void nowTick;

  const activeCategory = categories.find((c) => c.id === activeCat);


  // --- Hierarchical Category Logic for Mobile ---
  // Filtered lists for the sliders
  const parentCategories = visibleCategories.filter(c => !c.parentId);

  // Determine which parent is currently "active" to show its children
  const currentActiveObj = categories.find(c => c.id === activeCat);
  const activeParentId = currentActiveObj?.parentId || (currentActiveObj && !currentActiveObj.parentId ? currentActiveObj.id : null);

  // Get subcategories belonging to the active parent
  const subCategoriesOfActive = activeParentId
    ? visibleCategories.filter(c => c.parentId === activeParentId)
    : [];

  // Helper to check if a parent pill should be highlighted
  // (true if parent itself is selected OR one of its children is)
  const isParentPillActive = (parentId: string) => {
    if (activeCat === parentId) return true;
    return categories.find(c => c.id === activeCat)?.parentId === parentId;
  };

  // --- Grouping Logic for Parent View ---
  const groupedCategorySections = useMemo(() => {
    if (activeCat === "all" || search) return null;

    // Only group if the currently selected category is a Parent
    const isParent = activeCategory && !activeCategory.parentId;
    if (!isParent) return null;

    const sections: Array<{ id: string; name: string; emoji: string; items: MenuItem[] }> = [];

    // 1. Get items belonging directly to the parent
    const parentItems = items.filter(i => i.categoryId === activeCat);
    if (parentItems.length > 0) {
      sections.push({
        id: activeCat,
        name: activeCategory.name,
        emoji: activeCategory.emoji,
        items: parentItems
      });
    }

    // 2. Get children of this parent and their items
    const children = categories.filter(c => c.parentId === activeCat);
    children.forEach(child => {
      const childItems = items.filter(i => i.categoryId === child.id);
      if (childItems.length > 0) {
        sections.push({
          id: child.id,
          name: child.name,
          emoji: child.emoji,
          items: childItems
        });
      }
    });

    return sections;
  }, [activeCat, activeCategory, categories, items, search]);

  // ── Infinite-scroll pagination (flat grid only) ────────────────────────────
  // Mounts 9 cards at a time instead of the whole filtered list, so the
  // browser only requests that many images at once. Grouped parent-category
  // sections and meal-period sections stay fully rendered.
  const ITEMS_PER_PAGE = 9;
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);

  // Reset to the first page and scroll back to top whenever the category or
  // search query changes — otherwise a deeply-scrolled count would carry
  // into the new filter and reveal a burst of items/images at once.
  useEffect(() => {
    setVisibleCount(ITEMS_PER_PAGE);
    contentScrollRef.current?.scrollTo({ top: 0 });
  }, [activeCat, search]);

  // Grow the visible count as the sentinel (rendered after the flat grid)
  // scrolls into view. rootMargin starts loading the next batch before the
  // user hits the true bottom, so it feels seamless rather than a popcorn
  // "load more" jump. The sentinel always renders in the flat-grid branch —
  // the guard below just no-ops once everything is already visible.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = contentScrollRef.current;
    if (!sentinel || !root || groupedCategorySections) return;
    // No IntersectionObserver support (very old/unusual browser) — show
    // everything rather than leaving the page stuck on the first batch.
    if (typeof IntersectionObserver === "undefined") {
      setVisibleCount(items.length);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisibleCount((prev) => Math.min(prev + ITEMS_PER_PAGE, items.length));
      },
      { root, rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, groupedCategorySections]);

  // Search-bar autocomplete: dish suggestions shown in a dropdown as the
  // customer types. Searches every orderable online dish by name/description
  // (independent of the active category) and surfaces name matches first.
  const searchSuggestions = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return menuItems
      .filter(isItemOrderable)
      .filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
      .sort((a, b) => {
        const an = a.name.toLowerCase().includes(q) ? 0 : 1;
        const bn = b.name.toLowerCase().includes(q) ? 0 : 1;
        return an - bn;
      })
      .slice(0, 6);
  })();

  return (
    <div
      className={`h-full flex overflow-hidden site-theme ${theme === "dark" ? "dark" : ""}`}
      style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif', backgroundColor: 'var(--brand-bg, #FAFAF9)' }}
    >

      {/* ── Left sidebar (desktop) ────────────────────────────────────────── */}
      <SiteSidebar
        activeCat={activeCat}
        setCat={setActiveCat}
        onAuth={() => setAuthModal({ open: true, tab: "login" })}
        onReserve={() => setShowReservation(true)}
        categories={visibleCategories}
      />

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full">

        {/* Top search header */}
        <header className="flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-b border-zinc-200/70 dark:border-[var(--brand-border-dark)] bg-white dark:bg-[var(--brand-surface-dark)] flex-shrink-0">
          {/* Mobile: logo */}
          <div className="lg:hidden flex items-center gap-2 min-w-0">
            {settings.restaurant.logoImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={settings.restaurant.logoImage} alt={settings.restaurant.name}
                className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[14px] font-bold">
                {settings.restaurant.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="hidden sm:block text-[14px] font-semibold text-zinc-900 dark:text-[var(--brand-text-dark)] tracking-tight truncate">
            {settings.restaurant.name}
          </span>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xl min-w-0">
            <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/5">
              <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search dishes…"
                className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] text-zinc-900 dark:text-[var(--brand-text-dark)] placeholder:text-zinc-400"
              />
              {search && (
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => setSearch("")} className="text-[11px] font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors flex-shrink-0">
                  Clear
                </button>
              )}
            </div>

            {/* Suggestions dropdown — appears while typing; clicking a row opens
                the item exactly like tapping its card in the grid. */}
            {searchFocused && search.trim() && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-[var(--brand-surface-dark)] rounded-xl border border-zinc-200/70 dark:border-[var(--brand-border-dark)] shadow-lg z-30 py-1 max-h-[55vh] overflow-y-auto overscroll-contain">
                {searchSuggestions.length > 0 ? (
                  searchSuggestions.map((item) => {
                    const sym = settings.currency?.symbol ?? "£";
                    const price = effectiveMenuPrice(item, "online");
                    return (
                      <button
                        key={item.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => openSuggestion(item)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition-colors text-left"
                      >
                        <div className="w-11 h-11 rounded-lg bg-orange-50 overflow-hidden flex-shrink-0 flex items-center justify-center">
                          {showMenuImages(settings) && item.image ? (
                            // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded URLs from arbitrary hosts
                            <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                          ) : (
                            <UtensilsCrossed className="w-5 h-5 text-zinc-300 dark:text-zinc-700" strokeWidth={1.4} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13.5px] font-medium text-zinc-900 dark:text-[var(--brand-text-dark)] truncate">{item.name}</div>
                          {item.description && (
                            <div className="text-[11.5px] text-zinc-400 truncate">{item.description}</div>
                          )}
                        </div>
                        <span className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300 flex-shrink-0">{sym}{price.toFixed(2)}</span>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3.5 py-4 text-[13px] text-zinc-400 text-center">No dishes found</div>
                )}
              </div>
            )}
          </div>

          {/* Auth / user (desktop) */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" strokeWidth={1.8} /> : <Moon className="w-5 h-5" strokeWidth={1.8} />}
            </button>
            {currentUser ? (
              <div className="hidden sm:block relative">
                <button
                  onClick={() => setUserMenuOpen((o) => !o)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10"
                >
                  <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-[11px] font-bold">
                    {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
                  </div>
                  <span className="hidden md:block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{currentUser.name?.split(" ")[0]}</span>
                </button>
                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-44 bg-white dark:bg-[var(--brand-surface-dark)] rounded-xl border border-zinc-200/70 dark:border-[var(--brand-border-dark)] shadow-lg z-20 overflow-hidden py-1">
                      <Link href="/account" onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                        <LayoutDashboard className="w-4 h-4" strokeWidth={1.6} />Account
                      </Link>
                      <button onClick={() => { logout(); setUserMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors">
                        <LogOut className="w-4 h-4" strokeWidth={1.6} />Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button onClick={() => setAuthModal({ open: true, tab: "login" })}
                className="px-4 py-2 rounded-xl bg-orange-500 text-white text-[13px] font-medium hover:bg-orange-600 transition-colors">
                Sign in
              </button>
            )}
          </div>

        </header>

        {/* Mobile sticky category strip — only shown on the menu screen */}
        <div className="lg:hidden flex-shrink-0 bg-white dark:bg-[var(--brand-surface-dark)] border-b border-zinc-100 dark:border-[var(--brand-border-dark)] shadow-sm flex flex-col">

          {/* Row 1: Everything + Parent Categories */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 py-2.5">
            {/* Everything pill */}
            <button
              onClick={() => setActiveCat("all")}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium active:scale-95 ${activeCat === "all"
                ? "bg-orange-500 text-white"
                : "bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/15"
                }`}
            >
              <span className="text-sm leading-none">🍽️</span>
              <span>Everything</span>
            </button>

            {!categoriesLoaded ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex-shrink-0 w-24 h-8 rounded-full bg-zinc-200/60 dark:bg-white/10 animate-pulse" />
              ))
            ) : parentCategories.map((cat) => {
              const active = isParentPillActive(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCat(cat.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium active:scale-95 ${active
                    ? "bg-orange-500 text-white"
                    : "bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/15"
                    }`}
                >
                  <span className="text-sm leading-none">{cat.emoji}</span>
                  <span>{cat.name}</span>
                </button>
              );
            })}
          </div>

          {/* Row 2: Sub-categories (Only shown if a parent with children is active) */}
          {subCategoriesOfActive.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 pb-2.5 -mt-0.5 border-t border-zinc-50 dark:border-white/5 pt-2 animate-in slide-in-from-top-1">
              {subCategoriesOfActive.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setActiveCat(sub.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border ${activeCat === sub.id
                    ? "bg-orange-500 text-white dark:border-orange-500"
                    : "bg-white dark:bg-white/5 border-zinc-200 dark:border-[var(--brand-border-dark)] text-zinc-500 dark:text-zinc-400"
                    }`}
                >
                  <span className="text-xs leading-none">{sub.emoji}</span>
                  <span>{sub.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div ref={contentScrollRef} className="flex-1 flex flex-col overflow-y-auto pb-15 lg:pb-0 h-full">
          <div className="flex-1">

            <Hero isOpen={isOpen} onReserve={() => setShowReservation(true)} />

            {/* Meal-period sections — one per currently-active period, only
                on the default "Everything" view (no search, no category filter). */}
            {sectionsToShow.length > 0 && (
              <div className="px-6 mb-5 space-y-4">
                {sectionsToShow.map(({ period, items: sectionItems }) => (
                  <MealPeriodSection
                    key={period.id}
                    period={period}
                    categories={categories}
                    items={sectionItems}
                  />
                ))}
              </div>
            )}

            {/* Category header */}
            <div className="px-6 mb-5 flex items-center justify-between">
              <h2 className="font-semibold tracking-tight text-[20px] text-zinc-900 dark:text-[var(--brand-text-dark)]">
                {activeCat === "all" ? "Everything" : (activeCategory?.name ?? "Menu")}
                {menuItemsLoaded && (
                  <span className="ml-2 text-[13px] font-normal text-zinc-400 tabular-nums">· {visibleTotal}</span>
                )}
              </h2>
            </div>

            {/* Grid */}
            <div className="px-6 pb-6">
              {!menuItemsLoaded ? (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                    <FoodCardSkeleton key={i} />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="col-span-full text-center py-20 text-zinc-400">
                  {search
                    ? <><p className="text-[15px] font-medium">No dishes found for &ldquo;{search}&rdquo;</p><p className="text-[13px] mt-1">Try a different search term</p></>
                    : <p className="text-[15px] font-medium">No items in this category</p>
                  }
                </div>
              ) : groupedCategorySections ? (
                /* Grouped View for Parent Category Selection */
                <div className="space-y-12">
                  {groupedCategorySections.map((group) => (
                    <div key={group.id} className="space-y-5">
                      {group.id !== activeCat && (
                        <div className="flex items-center gap-2 pb-2">
                          <span className="text-lg leading-none">{group.emoji}</span>
                          <h3 className="font-bold text-zinc-800 dark:text-zinc-200 tracking-tight underline underline-offset-2">{group.name}</h3>
                          {/* <span className="text-[12px] text-zinc-400 font-medium">
                          · {group.items.length}
                        </span> */}
                        </div>
                      )}

                      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                        {group.items.map((item) => (
                          <FoodCard key={item.id} item={item} onOpen={() => setOpenItem(item)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                    {items.slice(0, visibleCount).map((item) => (
                      <FoodCard key={item.id} item={item} onOpen={() => setOpenItem(item)} />
                    ))}
                  </div>
                  {/* Infinite-scroll trigger — invisible, grows visibleCount as it
                      comes into view. See the pagination effects above. */}
                  <div ref={sentinelRef} aria-hidden className="h-px" />
                </>
              )}
            </div>
          </div>


          {/* Render SiteFooter */}
          <div className="mt-8">
            <SiteFooter />
          </div>
        </div>
      </div>

      {/* ── Right cart panel (desktop lg+) ───────────────────────────────────
          Collapsed while the basket is empty; slides open when the first item
          lands. Width is animated (NOT transform — a transform would become
          the containing block for the fixed-position CheckoutModal rendered
          inside <Cart>). Mirrors the identical panel in (site)/layout.tsx. */}
      <aside
        className={`hidden lg:flex flex-shrink-0 h-full overflow-hidden transition-[width] duration-500 ease-in-out ${
          cartHasItems ? "w-[310px] xl:w-[350px] border-l border-zinc-200/70 dark:border-[var(--brand-border-dark)]" : "w-0"
        }`}
        aria-hidden={!cartHasItems}
      >
        <div className="w-[310px] xl:w-[350px] flex-shrink-0 h-full flex">
          <Cart onOrderPlaced={() => router.push('/my-orders')} />
        </div>
      </aside>

      {/* ── Mobile bottom nav ─────────────────────────────────────────────── */}
      <MobileBottomNav
        onCartOpen={() => setShowMobileCart(true)}
        onAuth={() => setAuthModal({ open: true, tab: "login" })}
      />

      {/* ── Mobile cart drawer ────────────────────────────────────────────── */}
      {showMobileCart && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileCart(false)} />
          <div className="relative bg-white dark:bg-[var(--brand-surface-dark)] rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
            <Cart
              onMobileClose={() => setShowMobileCart(false)}
              onOrderPlaced={() => { setShowMobileCart(false); router.push('/my-orders'); }}
            />
          </div>
        </div>
      )}

      {/* ── Item detail modal ─────────────────────────────────────────────── */}
      {openItem && (
        <ItemCustomizationModal item={openItem} onClose={() => setOpenItem(null)} />
      )}

      {/* ── Auth modal ────────────────────────────────────────────────────── */}
      {authModal.open && (
        <AuthModal
          initialTab={authModal.tab}
          onClose={() => setAuthModal({ open: false, tab: "login" })}
        />
      )}

      {/* ── Reservation modal ─────────────────────────────────────────────── */}
      {showReservation && (
        <ReservationModal onClose={() => setShowReservation(false)} />
      )}
    </div>
  );
}
