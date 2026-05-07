"use client";

import { useState, useEffect } from "react";
import { MenuItem } from "@/types";
import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import {
  Search, ShoppingBag, UtensilsCrossed,
  Plus, Clock, Bike,
  Star, CalendarDays, LogOut, LayoutDashboard, Heart,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import AuthModal from "@/components/AuthModal";
import ScheduleOrderModal from "@/components/ScheduleOrderModal";
import ItemCustomizationModal from "@/components/ItemCustomizationModal";
import ReservationModal from "@/components/ReservationModal";
import SiteFooter from "@/components/SiteFooter";
import { resolveStock } from "@/lib/stockUtils";
import { getNextOpenTime, formatNextOpen } from "@/lib/scheduleUtils";
import MobileBottomNav from "@/components/MobileBottomNav";
import CartPanel from "@/components/CartPanel";
import SiteSidebar from "@/components/SiteSidebar";

// ── Dietary badge map ───────────────────────────────────────────────────────
const DIET_SHORT: Record<string, string> = {
  vegetarian: "V", vegan: "Ve", halal: "H", "gluten-free": "GF",
};

// ── Individual food card (grid layout) ─────────────────────────────────────
function FoodCard({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  const { isOpen, scheduledTime, currentUser, isFavourite, toggleFavourite } = useApp();
  const stockStatus = resolveStock(item);
  const outOfStock = stockStatus === "out_of_stock";
  const canAdd = (isOpen || !!scheduledTime) && !outOfStock;
  const faved = isFavourite(item.id);

  return (
    <div
      onClick={() => canAdd && onOpen()}
      className={`bg-white rounded-2xl border border-zinc-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)] overflow-hidden group transition-transform duration-200 ${canAdd ? "cursor-pointer hover:-translate-y-0.5" : "opacity-60 cursor-not-allowed"
        }`}
    >
      {/* Image */}
      <div className="relative h-[180px] bg-orange-50 overflow-hidden">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${outOfStock ? "grayscale opacity-50" : ""}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <UtensilsCrossed className="w-10 h-10 text-zinc-300" strokeWidth={1.2} />
          </div>
        )}
        {item.popular && !outOfStock && (
          <span className="absolute top-2.5 left-2.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-orange-500/90 text-white backdrop-blur-sm">
            Popular
          </span>
        )}
        {outOfStock && (
          <span className="absolute top-2.5 left-2.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-zinc-100 text-zinc-500">
            Unavailable
          </span>
        )}

        {/* Heart / favourite button — shown for logged-in users */}
        {currentUser && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleFavourite(item.id); }}
            aria-label={faved ? "Remove from favourites" : "Save to favourites"}
            className={`absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-all duration-200 ${faved
                ? "bg-red-500 text-white scale-100"
                : "bg-white/90 text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-500"
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
        <h3 className="font-medium text-[15px] leading-snug text-zinc-900 mb-1">{item.name}</h3>
        <p className="text-[12.5px] text-zinc-500 leading-snug line-clamp-2 mb-3">{item.description}</p>
        {item.dietary.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2.5">
            {item.dietary.slice(0, 3).map((d) => (
              <span key={d} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 uppercase tracking-wide">
                {DIET_SHORT[d] ?? d}
              </span>
            ))}
          </div>
        )}
        <span className="font-semibold text-[17px] text-zinc-900 tracking-tight tabular-nums">
          £{item.price.toFixed(2)}
        </span>
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

  const isDelivery = fulfillment === "delivery";
  const estTime = isDelivery ? restaurant.deliveryTime : restaurant.collectionTime;
  const feeLabel = isDelivery
    ? (restaurant.deliveryFee > 0 ? `£${restaurant.deliveryFee.toFixed(2)} fee` : "Free delivery")
    : "Free · no fee";

  return (
    <>
      <div className="mx-6 mt-6 mb-6 rounded-2xl overflow-hidden bg-white border border-zinc-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]">
        <div className="relative px-8 py-7 flex items-center gap-7 bg-orange-50 overflow-hidden">
          {/* Cover image or dot pattern background */}
          {restaurant.coverImage ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={restaurant.coverImage} alt="" aria-hidden
                className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none select-none" />
              <div className="absolute inset-0 bg-gradient-to-r from-orange-50/90 via-orange-50/60 to-transparent pointer-events-none" />
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
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-zinc-100 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-600 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Open · accepting orders
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-red-100 text-[10.5px] font-semibold uppercase tracking-wider text-red-600 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Closed
              </div>
            )}
            <h1 className="font-semibold tracking-tight text-[28px] md:text-[32px] leading-[1.05] mb-1.5 text-zinc-900">
              {restaurant.name}
            </h1>
            <p className="text-[14px] text-zinc-500 mb-4 max-w-md">{restaurant.tagline}</p>

            {/* ── Delivery / Collection toggle ─────────────────────────── */}
            <div className="inline-flex items-center p-1 rounded-xl bg-white border border-zinc-200/80 shadow-sm mb-4">
              <button
                onClick={() => setFulfillment("delivery")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-200 ${isDelivery
                    ? "bg-orange-500 text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800"
                  }`}
              >
                <Bike className="w-3.5 h-3.5" strokeWidth={1.8} />
                Delivery
              </button>
              <button
                onClick={() => setFulfillment("collection")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-200 ${!isDelivery
                    ? "bg-orange-500 text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800"
                  }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" strokeWidth={1.8} />
                Collection
              </button>
            </div>

            {/* Stats — contextual to selected mode */}
            <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-zinc-600">
              <span className="inline-flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5" strokeWidth={2} fill="currentColor" />
                <span className="font-semibold">{restaurant.hygieneRating}</span>
                <span className="text-zinc-400">· hygiene</span>
              </span>
              <span className="w-1 h-1 rounded-full bg-zinc-300" />
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" strokeWidth={1.8} />
                <span className="font-medium">{estTime} min</span>
              </span>
              <span className="w-1 h-1 rounded-full bg-zinc-300" />
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
          <div className="flex items-center gap-3 px-6 py-3.5 bg-red-50 border-t border-red-100">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" strokeWidth={1.8} />
            <p className="flex-1 text-[12.5px] text-red-700 font-medium min-w-0">
              {nextOpen
                ? <>We&apos;re closed · Opens {formatNextOpen(nextOpen)}</>
                : "We're not accepting orders right now"}
            </p>
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

// ── Main page ────────────────────────────────────────────────────────────────
export default function HomePage() {
  const {
    categories, menuItems, settings,
    isOpen, currentUser, logout
  } = useApp();

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

  // Filtered items
  const items = menuItems.filter((item) => {
    if (activeCat !== "all" && item.categoryId !== activeCat) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!item.name.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const activeCategory = categories.find((c) => c.id === activeCat);

  return (
    <div className="h-full flex overflow-hidden" style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif', backgroundColor: 'var(--brand-bg, #FAFAF9)' }}>

      {/* ── Left sidebar (desktop) ────────────────────────────────────────── */}
      <SiteSidebar
        activeCat={activeCat}
        setCat={setActiveCat}
        onAuth={() => setAuthModal({ open: true, tab: "login" })}
        onReserve={() => setShowReservation(true)}
      />

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full">

        {/* Top search header */}
        <header className="flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-b border-zinc-200/70 bg-white flex-shrink-0">
          {/* Mobile: logo */}
          <div className="lg:hidden flex items-center gap-2 flex-shrink-0">
            {settings.restaurant.logoImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={settings.restaurant.logoImage} alt={settings.restaurant.name}
                className="w-8 h-8 rounded-xl object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[14px] font-bold">
                {settings.restaurant.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-100 max-w-xl">
            <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dishes…"
              className="flex-1 bg-transparent outline-none text-[13.5px] text-zinc-900 placeholder:text-zinc-400"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-[11px] font-medium text-zinc-400 hover:text-zinc-700 transition-colors">
                Clear
              </button>
            )}
          </div>

          {/* Auth / user (desktop) */}
          <div className="hidden lg:flex items-center gap-2">
            {currentUser ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen((o) => !o)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 transition-colors"
                >
                  <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-[11px] font-bold">
                    {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
                  </div>
                  <span className="text-[13px] font-medium text-zinc-700">{currentUser.name?.split(" ")[0]}</span>
                </button>
                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl border border-zinc-200/70 shadow-lg z-20 overflow-hidden py-1">
                      <Link href="/account" onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50 transition-colors">
                        <LayoutDashboard className="w-4 h-4" strokeWidth={1.6} />Account
                      </Link>
                      <button onClick={() => { logout(); setUserMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors">
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
        <div className="lg:hidden flex-shrink-0 bg-white border-b border-zinc-100 shadow-sm">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 py-2.5">
            {/* Everything pill */}
            <button
              onClick={() => setActiveCat("all")}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all active:scale-95 ${activeCat === "all"
                  ? "bg-orange-500 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
            >
              <span className="text-sm leading-none">🍽️</span>
              <span>Everything</span>
            </button>
            {categories.map((cat) => (
              <button key={cat.id}
                onClick={() => setActiveCat(cat.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all active:scale-95 ${activeCat === cat.id
                    ? "bg-orange-500 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
              >
                <span className="text-sm leading-none">{cat.emoji}</span>
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto pb-28 lg:pb-8">
          <Hero isOpen={isOpen} onReserve={() => setShowReservation(true)} />

          {/* Category header */}
          <div className="px-6 mb-5 flex items-center justify-between">
            <h2 className="font-semibold tracking-tight text-[20px] text-zinc-900">
              {activeCat === "all" ? "Everything" : (activeCategory?.name ?? "Menu")}
              <span className="ml-2 text-[13px] font-normal text-zinc-400 tabular-nums">· {items.length}</span>
            </h2>
          </div>

          {/* Grid */}
          <div className="px-6 pb-6 grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {items.length === 0 ? (
              <div className="col-span-full text-center py-20 text-zinc-400">
                {search
                  ? <><p className="text-[15px] font-medium">No dishes found for &ldquo;{search}&rdquo;</p><p className="text-[13px] mt-1">Try a different search term</p></>
                  : <p className="text-[15px] font-medium">No items in this category</p>
                }
              </div>
            ) : (
              items.map((item) => (
                <FoodCard key={item.id} item={item} onOpen={() => setOpenItem(item)} />
              ))
            )}
          </div>

          {/* Render SiteFooter */}
          <div className="mt-8">
            <SiteFooter />
          </div>
        </div>
      </div>

      {/* ── Right cart panel (desktop lg+) ───────────────────────────────── */}
      <aside className="hidden lg:flex w-auto flex-shrink-0 h-full border-l border-zinc-200/70 overflow-hidden">
        <CartPanel onOrderPlaced={() => router.push('/my-orders')} />
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
          <div className="relative bg-white rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
            <CartPanel
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