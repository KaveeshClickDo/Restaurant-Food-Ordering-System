"use client";

import { useEffect, useRef, useState } from "react";
import { MenuItem } from "@/types";
import { useApp } from "@/context/AppContext";
import {
  Search, MapPin, Bell, ShoppingBag, UtensilsCrossed,
  Receipt, User, Plus, Minus, Trash2, Clock, Bike,
  ChevronRight, X, Star, CalendarDays, PackageX,
  LogOut, LayoutDashboard, CheckCircle2, AlertCircle,
  Mail, Phone, CreditCard, Heart, Home,
} from "lucide-react";
import Link from "next/link";
import AuthModal from "@/components/AuthModal";
import CheckoutModal from "@/components/CheckoutModal";
import ScheduleOrderModal from "@/components/ScheduleOrderModal";
import ItemCustomizationModal from "@/components/ItemCustomizationModal";
import ReservationModal from "@/components/ReservationModal";
import { resolveStock } from "@/lib/stockUtils";
import { computeTax, taxSurcharge } from "@/lib/taxUtils";
import { getNextOpenTime, formatNextOpen } from "@/lib/scheduleUtils";

// ── Dietary badge map ───────────────────────────────────────────────────────
const DIET_SHORT: Record<string, string> = {
  vegetarian: "V", vegan: "Ve", halal: "H", "gluten-free": "GF",
};

// ── Individual food card (grid layout) ─────────────────────────────────────
function FoodCard({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  const { isOpen, scheduledTime } = useApp();
  const stockStatus = resolveStock(item);
  const outOfStock = stockStatus === "out_of_stock";
  const canAdd = (isOpen || !!scheduledTime) && !outOfStock;

  return (
    <div
      onClick={() => canAdd && onOpen()}
      className={`bg-white rounded-2xl border border-zinc-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)] overflow-hidden group transition-transform duration-200 ${
        canAdd ? "cursor-pointer hover:-translate-y-0.5" : "opacity-60 cursor-not-allowed"
      }`}
    >
      {/* Image */}
      <div className="relative h-[180px] bg-orange-50 overflow-hidden">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${outOfStock ? "grayscale opacity-50" : ""}`}
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

// ── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({
  activeCat,
  setCat,
  screen,
  setScreen,
  onAuth,
}: {
  activeCat: string;
  setCat: (id: string) => void;
  screen: string;
  setScreen: (s: string) => void;
  onAuth: () => void;
}) {
  const { settings, categories, currentUser, logout } = useApp();
  const { restaurant } = settings;

  const navItems = [
    { id: "menu",     label: "Menu",          Icon: UtensilsCrossed },
    { id: "orders",   label: "My Orders",     Icon: Receipt },
    { id: "profile",  label: "Profile",       Icon: User },
  ];

  return (
    <aside className="hidden lg:flex w-[260px] flex-shrink-0 h-full flex-col bg-white border-r border-zinc-200/70">
      {/* Logo */}
      <div className="p-5 pb-3">
        <div className="flex items-center gap-2.5 px-1">
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
        </div>
      </div>

      {/* Nav */}
      <div className="px-4 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 px-3 mb-2">Navigate</p>
        <nav className="space-y-0.5">
          {navItems.map(({ id, label, Icon }) => {
            const active = screen === id;
            return (
              <button key={id} onClick={() => setScreen(id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors ${
                  active
                    ? "bg-orange-500 text-white"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                }`}
              >
                <Icon className="w-[17px] h-[17px]" strokeWidth={1.6} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Categories */}
      <div className="px-4 pt-3 pb-2 flex-1 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 px-3 mb-2">Categories</p>
        <nav className="space-y-0.5">
          {categories.map((cat) => {
            const active = activeCat === cat.id && screen === "menu";
            return (
              <button key={cat.id}
                onClick={() => { setCat(cat.id); setScreen("menu"); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] transition-colors ${
                  active
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

// ── Right cart panel ─────────────────────────────────────────────────────────
function CartPanel({ onMobileClose }: { onMobileClose?: () => void }) {
  const { cart, updateQty, clearCart, cartTotal, settings, fulfillment, isOpen, scheduledTime, setScheduledTime } = useApp();
  const [showCheckout, setShowCheckout] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const { minOrder, deliveryFee, serviceFee } = settings.restaurant;
  const delivery   = fulfillment === "delivery" ? deliveryFee : 0;
  const service    = cartTotal * (serviceFee / 100);
  const tax        = computeTax(cartTotal, settings);
  const grandTotal = cartTotal + delivery + service + taxSurcharge(tax);
  const shortfall  = minOrder - cartTotal;
  const canCheckout = cartTotal >= minOrder && cart.length > 0 && (isOpen || !!scheduledTime);

  return (
    <>
      <div className="flex flex-col h-full bg-white">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-[17px] h-[17px] text-zinc-700" strokeWidth={1.6} />
            <h2 className="font-semibold text-[14.5px] text-zinc-900 tracking-tight">Your order</h2>
            {cart.length > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {cart.length > 0 && (
              <button onClick={clearCart} className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Clear cart">
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
              </button>
            )}
            {onMobileClose && (
              <button onClick={onMobileClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors">
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-14 px-5 text-center">
              <ShoppingBag className="w-10 h-10 text-zinc-200 mb-3" strokeWidth={1.2} />
              <p className="text-[13.5px] font-medium text-zinc-400">Your basket is empty</p>
              <p className="text-[12px] text-zinc-300 mt-1">Add items to get started</p>
              {!isOpen && !scheduledTime && (
                <button
                  onClick={() => setShowSchedule(true)}
                  className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-50 border border-orange-200 hover:bg-orange-100 text-orange-700 text-[12.5px] font-semibold transition-all"
                >
                  <CalendarDays className="w-3.5 h-3.5" strokeWidth={1.8} />
                  Order for later
                </button>
              )}
            </div>
          ) : (
            <ul>
              {cart.map((item) => (
                <li key={item.id} className="px-5 py-3.5 flex items-start gap-3 border-b border-zinc-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-zinc-900 leading-snug">{item.name}</p>
                    {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                      <p className="text-[11.5px] text-zinc-400 mt-0.5">+ {item.selectedAddOns.map((a) => a.name).join(", ")}</p>
                    )}
                    {item.specialInstructions && (
                      <p className="text-[11.5px] text-zinc-500 mt-0.5 italic">&ldquo;{item.specialInstructions}&rdquo;</p>
                    )}
                    <p className="text-[12px] text-zinc-400 mt-1">£{item.price.toFixed(2)} each</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => updateQty(item.id, item.quantity - 1)}
                      className="w-7 h-7 rounded-full border border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 transition-colors">
                      <Minus className="w-3 h-3" strokeWidth={2} />
                    </button>
                    <span className="text-[13px] font-bold text-zinc-900 w-4 text-center tabular-nums">{item.quantity}</span>
                    <button onClick={() => updateQty(item.id, item.quantity + 1)}
                      className="w-7 h-7 rounded-full border border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-orange-500 hover:bg-orange-500 hover:text-white transition-colors">
                      <Plus className="w-3 h-3" strokeWidth={2} />
                    </button>
                  </div>
                  <span className="text-[13px] font-bold text-zinc-900 flex-shrink-0 w-12 text-right tabular-nums">
                    £{(item.price * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Totals + actions */}
        {cart.length > 0 && (
          <div className="flex-shrink-0 border-t border-zinc-100">
            <div className="px-5 py-4 space-y-2">
              <div className="flex justify-between text-[13px] text-zinc-500">
                <span>Subtotal</span><span className="tabular-nums">£{cartTotal.toFixed(2)}</span>
              </div>
              {fulfillment === "delivery" && (
                <div className="flex justify-between text-[13px] text-zinc-500">
                  <span>Delivery fee</span><span className="tabular-nums">£{delivery.toFixed(2)}</span>
                </div>
              )}
              {serviceFee > 0 && (
                <div className="flex justify-between text-[13px] text-zinc-500">
                  <span>Service fee ({serviceFee}%)</span><span className="tabular-nums">£{service.toFixed(2)}</span>
                </div>
              )}
              {tax.enabled && tax.showBreakdown && tax.vatAmount > 0 && (
                <div className="flex justify-between text-[12px] font-semibold text-zinc-400">
                  <span>{tax.label}</span>
                  <span className="tabular-nums">{tax.inclusive ? "" : "+"} £{tax.vatAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-[14px] text-zinc-900 pt-2 border-t border-zinc-100">
                <span>Total</span><span className="tabular-nums">£{grandTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Min order warning */}
            {cartTotal < minOrder && (
              <div className="px-5 pb-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11.5px] text-amber-700 font-medium">
                  Add £{shortfall.toFixed(2)} more to reach the £{minOrder.toFixed(2)} minimum
                </div>
              </div>
            )}

            {/* Scheduled time strip */}
            {scheduledTime && (
              <div className="px-5 pb-3">
                <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                  <CalendarDays className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" strokeWidth={1.8} />
                  <p className="text-[11.5px] text-zinc-700 font-medium flex-1 min-w-0 truncate">{scheduledTime}</p>
                  <button onClick={() => setScheduledTime(null)} className="text-zinc-400 hover:text-zinc-700 transition-colors">
                    <X className="w-3 h-3" strokeWidth={2} />
                  </button>
                </div>
              </div>
            )}

            {/* Schedule for later when closed */}
            {!isOpen && !scheduledTime && (
              <div className="px-5 pb-3">
                <button onClick={() => setShowSchedule(true)}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-zinc-300 hover:border-zinc-500 text-zinc-500 hover:text-zinc-800 rounded-xl py-2.5 text-[12px] font-semibold transition-all">
                  <CalendarDays className="w-3.5 h-3.5" strokeWidth={1.8} />
                  Schedule for later
                </button>
              </div>
            )}

            {/* Checkout button */}
            <div className="px-5 pb-5">
              <button
                disabled={!canCheckout}
                onClick={() => setShowCheckout(true)}
                className={`w-full py-3.5 rounded-xl font-semibold text-[14px] flex items-center justify-between px-5 transition-all ${
                  canCheckout
                    ? "bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white"
                    : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                }`}
              >
                <span>{scheduledTime ? "Schedule order" : "Go to checkout"}</span>
                {canCheckout && (
                  <span className="flex items-center gap-1 tabular-nums">
                    £{grandTotal.toFixed(2)} <ChevronRight className="w-4 h-4" strokeWidth={2} />
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {showCheckout && <CheckoutModal onClose={() => setShowCheckout(false)} />}
      {showSchedule && <ScheduleOrderModal onClose={() => setShowSchedule(false)} />}
    </>
  );
}

// ── Hero banner ──────────────────────────────────────────────────────────────
function Hero({ isOpen, onReserve }: { isOpen: boolean; onReserve: () => void }) {
  const { settings } = useApp();
  const { restaurant } = settings;
  const [showSchedule, setShowSchedule] = useState(false);

  const nextOpen = !isOpen
    ? getNextOpenTime(settings.schedule, settings.manualClosed)
    : null;

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
            <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-zinc-600">
              <span className="inline-flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5" strokeWidth={2} fill="currentColor" />
                <span className="font-semibold">{restaurant.hygieneRating}</span>
                <span className="text-zinc-400">· hygiene</span>
              </span>
              <span className="w-1 h-1 rounded-full bg-zinc-300" />
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" strokeWidth={1.8} />
                <span className="font-medium">{restaurant.deliveryTime} min</span>
              </span>
              <span className="w-1 h-1 rounded-full bg-zinc-300" />
              <span className="inline-flex items-center gap-1.5">
                <Bike className="w-3.5 h-3.5" strokeWidth={1.8} />
                <span className="font-medium">£{restaurant.deliveryFee.toFixed(2)} delivery</span>
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
    categories, menuItems, settings, cartCount, cartTotal,
    isOpen, currentUser, logout,
  } = useApp();

  const [activeCat,        setActiveCat]        = useState(categories[0]?.id ?? "all");
  const [search,           setSearch]           = useState("");
  const [screen,           setScreen]           = useState("menu");
  const [openItem,         setOpenItem]         = useState<MenuItem | null>(null);
  const [showMobileCart,   setShowMobileCart]   = useState(false);
  const [authModal,        setAuthModal]        = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
  const [userMenuOpen,     setUserMenuOpen]     = useState(false);
  const [showReservation,  setShowReservation]  = useState(false);

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
  const totalInCart    = cartCount;

  return (
    <div className="h-screen flex overflow-hidden" style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif', backgroundColor: 'var(--brand-bg, #FAFAF9)' }}>

      {/* ── Left sidebar (desktop) ────────────────────────────────────────── */}
      <Sidebar
        activeCat={activeCat}
        setCat={setActiveCat}
        screen={screen}
        setScreen={setScreen}
        onAuth={() => setAuthModal({ open: true, tab: "login" })}
      />

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full">

        {/* Top search header */}
        <header className="flex items-center gap-3 px-4 md:px-6 py-3.5 border-b border-zinc-200/70 bg-white flex-shrink-0">
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

          {/* Mobile: cart button */}
          <button onClick={() => setShowMobileCart(true)}
            className="lg:hidden relative w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-700 flex-shrink-0">
            <ShoppingBag className="w-[18px] h-[18px]" strokeWidth={1.6} />
            {totalInCart > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                {totalInCart}
              </span>
            )}
          </button>
        </header>

        {/* Mobile sticky category strip */}
        <div className="lg:hidden flex-shrink-0 bg-white border-b border-zinc-100 shadow-sm">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 py-2.5">
            {categories.map((cat) => (
              <button key={cat.id}
                onClick={() => { setActiveCat(cat.id); setScreen("menu"); }}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all active:scale-95 ${
                  activeCat === cat.id && screen === "menu"
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
        <div className="flex-1 overflow-y-auto pb-24 lg:pb-8">
          {screen === "menu" && (
            <>
              <Hero isOpen={isOpen} onReserve={() => setShowReservation(true)} />

              {/* Category header */}
              <div className="px-6 mb-5 flex items-center justify-between">
                <h2 className="font-semibold tracking-tight text-[20px] text-zinc-900">
                  {activeCategory?.name ?? "Menu"}
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

              {/* Footer */}
              <footer className="mt-4 border-t border-zinc-200/70 bg-white">
                <FooterContent />
              </footer>
            </>
          )}

          {screen === "orders" && (
            <div className="px-4 sm:px-6 py-6">
              <h2 className="font-semibold text-[22px] text-zinc-900 tracking-tight mb-1">My Orders</h2>
              <p className="text-[13px] text-zinc-500 mb-5">Your recent orders from us.</p>
              {!currentUser ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
                    <Receipt className="w-7 h-7 text-zinc-400" strokeWidth={1.4} />
                  </div>
                  <p className="text-[13.5px] text-zinc-500">Sign in to see your order history</p>
                  <button onClick={() => setAuthModal({ open: true, tab: "login" })}
                    className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-[13.5px] font-semibold transition-colors">
                    Sign in
                  </button>
                </div>
              ) : currentUser.orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
                    <PackageX className="w-7 h-7 text-zinc-400" strokeWidth={1.4} />
                  </div>
                  <p className="text-[13.5px] text-zinc-500">No orders yet — your order history will appear here.</p>
                </div>
              ) : (
                <div className="space-y-3 max-w-lg">
                  {[...currentUser.orders].reverse().map((order) => {
                    const statusColors: Record<string, string> = {
                      pending:            "bg-yellow-100 text-yellow-700",
                      confirmed:          "bg-blue-100 text-blue-700",
                      preparing:          "bg-orange-100 text-orange-700",
                      ready:              "bg-green-100 text-green-700",
                      delivered:          "bg-zinc-100 text-zinc-500",
                      cancelled:          "bg-red-100 text-red-600",
                      refunded:           "bg-purple-100 text-purple-600",
                      partially_refunded: "bg-purple-100 text-purple-600",
                    };
                    const statusLabel: Record<string, string> = {
                      pending: "Pending", confirmed: "Confirmed", preparing: "Preparing",
                      ready: "Ready", delivered: "Delivered", cancelled: "Cancelled",
                      refunded: "Refunded", partially_refunded: "Part refunded",
                    };
                    const fulfillmentIcon = order.fulfillment === "delivery"
                      ? <Bike className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.8} />
                      : order.fulfillment === "dine-in"
                        ? <UtensilsCrossed className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.8} />
                        : <ShoppingBag className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.8} />;
                    const dateStr = new Date(order.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                    const itemSummary = order.items.slice(0, 2).map(i => i.name).join(", ") + (order.items.length > 2 ? ` +${order.items.length - 2} more` : "");
                    return (
                      <div key={order.id} className="bg-white border border-zinc-200/80 rounded-2xl p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${statusColors[order.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                              {statusLabel[order.status] ?? order.status}
                            </span>
                            <span className="flex items-center gap-1 text-[11.5px] text-zinc-400 capitalize">
                              {fulfillmentIcon}
                              {order.fulfillment}
                            </span>
                          </div>
                          <span className="text-[13px] font-bold text-zinc-900 tabular-nums flex-shrink-0">£{order.total.toFixed(2)}</span>
                        </div>
                        <p className="text-[12.5px] text-zinc-600 leading-snug mb-1 line-clamp-1">{itemSummary}</p>
                        <p className="text-[11.5px] text-zinc-400">{dateStr}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {screen === "profile" && (
            <div className="px-4 sm:px-6 py-6 overflow-y-auto">
              <h2 className="font-semibold text-[22px] text-zinc-900 tracking-tight mb-5">Profile</h2>
              {!currentUser ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
                    <User className="w-7 h-7 text-zinc-400" strokeWidth={1.4} />
                  </div>
                  <p className="text-[13.5px] text-zinc-500">Sign in to view your profile</p>
                  <div className="flex gap-2">
                    <button onClick={() => setAuthModal({ open: true, tab: "login" })}
                      className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-[13.5px] font-semibold transition-colors">
                      Sign in
                    </button>
                    <button onClick={() => setAuthModal({ open: true, tab: "register" })}
                      className="px-5 py-2.5 rounded-xl border border-zinc-200 text-zinc-700 text-[13.5px] font-semibold hover:bg-zinc-50 transition-colors">
                      Register
                    </button>
                  </div>
                </div>
              ) : (
                <div className="max-w-sm space-y-3 pb-6">
                  {/* Avatar + name */}
                  <div className="flex items-center gap-4 bg-white border border-zinc-200/80 rounded-2xl p-4 shadow-sm">
                    <div className="w-16 h-16 rounded-2xl bg-orange-500 flex items-center justify-center text-white font-bold text-2xl flex-shrink-0">
                      {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-[16px] text-zinc-900 truncate">{currentUser.name}</p>
                      <p className="text-[12px] text-zinc-400 mt-0.5 truncate">{currentUser.email}</p>
                      {currentUser.tags && currentUser.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {currentUser.tags.map((tag) => (
                            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Contact details */}
                  <div className="bg-white border border-zinc-200/80 rounded-2xl shadow-sm divide-y divide-zinc-100">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Mail className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-zinc-400 leading-none mb-0.5">Email</p>
                        <p className="text-[13px] font-medium text-zinc-800 truncate">{currentUser.email}</p>
                      </div>
                      {currentUser.emailVerified && (
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" strokeWidth={2} />
                      )}
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Phone className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-zinc-400 leading-none mb-0.5">Phone</p>
                        <p className={`text-[13px] font-medium truncate ${currentUser.phone ? "text-zinc-800" : "text-zinc-400 italic"}`}>
                          {currentUser.phone || "Not set"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Account stats */}
                  <div className="bg-white border border-zinc-200/80 rounded-2xl shadow-sm divide-y divide-zinc-100">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <CreditCard className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
                      <div className="flex-1">
                        <p className="text-[11px] text-zinc-400 leading-none mb-0.5">Store credit</p>
                        <p className={`text-[13px] font-semibold ${(currentUser.storeCredit ?? 0) > 0 ? "text-green-600" : "text-zinc-400"}`}>
                          £{(currentUser.storeCredit ?? 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Receipt className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
                      <div className="flex-1">
                        <p className="text-[11px] text-zinc-400 leading-none mb-0.5">Orders placed</p>
                        <p className="text-[13px] font-medium text-zinc-800">{currentUser.orders.length}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Heart className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
                      <div className="flex-1">
                        <p className="text-[11px] text-zinc-400 leading-none mb-0.5">Saved favourites</p>
                        <p className="text-[13px] font-medium text-zinc-800">{currentUser.favourites?.length ?? 0}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Star className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
                      <div className="flex-1">
                        <p className="text-[11px] text-zinc-400 leading-none mb-0.5">Member since</p>
                        <p className="text-[13px] font-medium text-zinc-800">
                          {new Date(currentUser.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Saved addresses */}
                  {(currentUser.savedAddresses?.length ?? 0) > 0 && (
                    <div className="bg-white border border-zinc-200/80 rounded-2xl shadow-sm">
                      <div className="px-4 py-3 border-b border-zinc-100">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">Saved addresses</p>
                      </div>
                      <div className="divide-y divide-zinc-100">
                        {currentUser.savedAddresses!.map((addr) => (
                          <div key={addr.id} className="flex items-start gap-3 px-4 py-3">
                            <Home className="w-4 h-4 text-zinc-400 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <p className="text-[12.5px] font-semibold text-zinc-800">{addr.label}</p>
                                {addr.isDefault && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium">Default</span>
                                )}
                              </div>
                              <p className="text-[12px] text-zinc-500 truncate">{addr.address}</p>
                              {addr.postcode && <p className="text-[11.5px] text-zinc-400">{addr.postcode}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <Link href="/account"
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-[13.5px] font-semibold transition-colors">
                    <User className="w-4 h-4" strokeWidth={1.8} />
                    Manage account
                  </Link>
                  <button
                    onClick={() => { logout(); setScreen("menu"); }}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-zinc-200 text-zinc-500 text-[13.5px] font-medium hover:bg-zinc-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" strokeWidth={1.8} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right cart panel (desktop lg+) ───────────────────────────────── */}
      <aside className="hidden lg:flex w-[340px] flex-shrink-0 h-full border-l border-zinc-200/70 overflow-hidden">
        <CartPanel />
      </aside>

      {/* ── Docked mobile cart bar ────────────────────────────────────────── */}
      <div className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 transition-all duration-300 ${
        totalInCart > 0 ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
      }`}>
        <div className="bg-white border-t border-zinc-100 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] px-4 pt-3 pb-5">
          <button onClick={() => setShowMobileCart(true)}
            className="w-full flex items-center justify-between bg-orange-500 hover:bg-orange-600 active:scale-[0.99] text-white px-5 py-3.5 rounded-2xl shadow-lg transition-all">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-7 h-7 bg-white/20 rounded-xl text-sm font-bold tabular-nums">
                {totalInCart}
              </span>
              <span className="font-semibold text-base">{totalInCart === 1 ? "1 item" : `${totalInCart} items`}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tabular-nums">£{cartTotal.toFixed(2)}</span>
              <ShoppingBag className="w-[18px] h-[18px]" strokeWidth={1.6} />
            </div>
          </button>
        </div>
      </div>

      {/* ── Mobile cart drawer ────────────────────────────────────────────── */}
      {showMobileCart && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileCart(false)} />
          <div className="relative bg-white rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
            <CartPanel onMobileClose={() => setShowMobileCart(false)} />
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

// ── Footer content ───────────────────────────────────────────────────────────
function FooterContent() {
  const { settings } = useApp();
  const { restaurant } = settings;

  const managedLinks = (settings.menuLinks ?? [])
    .filter((l) => l.location === "footer" && l.active)
    .sort((a, b) => a.order - b.order);

  const legacyLinks = (settings.footerPages ?? [])
    .filter((p) => p.enabled)
    .map((p) => ({ id: p.slug, label: p.title, href: `/${p.slug}` }));

  const navLinks = managedLinks.length > 0 ? managedLinks : legacyLinks;

  return (
    <div className="px-6 py-10 max-w-5xl">
      <div className="flex items-start gap-3 mb-6">
        {restaurant.logoImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={restaurant.logoImage} alt={restaurant.name}
            className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[15px] font-bold flex-shrink-0">
            {restaurant.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-zinc-900 tracking-tight">{restaurant.name}</div>
          <div className="text-[12.5px] text-zinc-500 mt-0.5">{restaurant.tagline}</div>
        </div>
      </div>

      {navLinks.length > 0 && (
        <nav className="flex flex-wrap gap-x-6 gap-y-2 mb-7">
          {navLinks.map((link) => (
            <Link key={link.id} href={link.href}
              className="text-[12.5px] text-zinc-600 hover:text-zinc-900 transition-colors">
              {link.label}
            </Link>
          ))}
        </nav>
      )}

      {/* Footer logos */}
      {(() => {
        const activeLogos = (settings.footerLogos ?? [])
          .filter((l) => l.enabled)
          .sort((a, b) => a.order - b.order);
        if (activeLogos.length === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-5 mb-7">
            {activeLogos.map((logo) =>
              logo.href ? (
                <a
                  key={logo.id}
                  href={logo.href}
                  target="_blank"
                  rel="noreferrer"
                  title={logo.label}
                  className="opacity-50 hover:opacity-80 transition-opacity"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logo.imageUrl}
                    alt={logo.label}
                    className="max-h-8 max-w-[100px] object-contain"
                  />
                </a>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={logo.id}
                  src={logo.imageUrl}
                  alt={logo.label}
                  title={logo.label}
                  className="max-h-8 max-w-[100px] object-contain opacity-50"
                />
              )
            )}
          </div>
        );
      })()}

      <div className="pt-5 border-t border-zinc-200/70 text-[11.5px] text-zinc-400">
        {settings.footerCopyright || `© ${new Date().getFullYear()} ${restaurant.name}. All rights reserved.`}
      </div>
    </div>
  );
}
