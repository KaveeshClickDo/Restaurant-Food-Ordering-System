"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import {
  Clock, ShoppingBag, Star, AlertCircle, User, LogOut,
  ChevronDown, LayoutDashboard, Menu as MenuIcon, X as XIcon,
  CalendarDays, CheckCircle2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import AuthModal from "@/components/AuthModal";
import ScheduleOrderModal from "@/components/ScheduleOrderModal";
import ReservationModal from "@/components/ReservationModal";
import { getNextOpenTime, formatNextOpen } from "@/lib/scheduleUtils";

export default function Header() {
  const { settings, fulfillment, setFulfillment, isOpen, currentUser, logout, scheduledTime, setScheduledTime } = useApp();
  const { restaurant } = settings;
  const [authModal,        setAuthModal]        = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
  const [userMenuOpen,     setUserMenuOpen]     = useState(false);
  const [mobileNavOpen,    setMobileNavOpen]    = useState(false);
  const [showSchedule,     setShowSchedule]     = useState(false);
  const [showReservation,  setShowReservation]  = useState(false);

  const nextOpen = !isOpen ? getNextOpenTime(settings.schedule, settings.manualClosed) : null;

  const headerLinks = (settings.menuLinks ?? [])
    .filter((l) => l.location === "header" && l.active)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="relative">
      {/* Cover image */}
      <div className="relative h-44 sm:h-56 md:h-64 w-full overflow-hidden">
        <Image
          src={restaurant.coverImage}
          alt={restaurant.name}
          fill
          className="object-cover"
          priority
          unoptimized
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
      </div>

      {/* Info card */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4">
        <div className="relative -mt-14 sm:-mt-20 bg-white rounded-2xl shadow-xl p-4 sm:p-5 md:p-6">

          {/* ── Top row: logo + name + auth ──────────────────────────────── */}
          <div className="flex items-start gap-3 sm:gap-4">
            {/* Logo */}
            <div className="relative h-16 w-16 sm:h-20 sm:w-20 md:h-24 md:w-24 rounded-xl overflow-hidden border-2 border-white shadow-md flex-shrink-0">
              <Image
                src={restaurant.logoImage}
                alt={`${restaurant.name} logo`}
                fill
                className="object-cover"
                unoptimized
              />
            </div>

            {/* Name + auth area */}
            <div className="flex-1 min-w-0">
              {/* Name row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 leading-tight truncate">
                    {restaurant.name}
                  </h1>
                  <p className="text-gray-500 text-xs sm:text-sm mt-0.5 line-clamp-1">{restaurant.tagline}</p>
                </div>

                {/* Hygiene badge — desktop only in this row */}
                <div className="hidden sm:flex items-center gap-1 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5 flex-shrink-0">
                  <Star size={13} className="text-green-600 fill-green-600" />
                  <span className="text-green-700 font-semibold text-sm whitespace-nowrap">
                    {restaurant.hygieneRating} Hygiene
                  </span>
                </div>
              </div>

              {/* Auth buttons row */}
              <div className="flex items-center gap-2 mt-2">
                {/* Hygiene badge — mobile only (inline with auth) */}
                <div className="flex sm:hidden items-center gap-1 bg-green-50 border border-green-200 rounded-lg px-2 py-1 flex-shrink-0">
                  <Star size={12} className="text-green-600 fill-green-600" />
                  <span className="text-green-700 font-semibold text-xs">{restaurant.hygieneRating}</span>
                </div>

                {currentUser ? (
                  <div className="relative">
                    <button
                      onClick={() => setUserMenuOpen((v) => !v)}
                      className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 rounded-lg px-2.5 sm:px-3 py-1.5 hover:bg-orange-100 transition"
                    >
                      <User size={14} className="text-orange-600" />
                      <span className="text-orange-700 font-semibold text-xs sm:text-sm max-w-[80px] sm:max-w-[120px] truncate">
                        {currentUser.name.split(" ")[0]}
                      </span>
                      <ChevronDown size={12} className="text-orange-500" />
                    </button>
                    {userMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                        <div className="absolute left-0 sm:right-0 sm:left-auto mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20">
                          <div className="px-4 py-2 border-b border-gray-100">
                            <p className="text-xs font-semibold text-gray-800 truncate">{currentUser.name}</p>
                            <p className="text-xs text-gray-400 truncate">{currentUser.email}</p>
                          </div>
                          <Link
                            href="/account"
                            onClick={() => setUserMenuOpen(false)}
                            className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
                          >
                            <LayoutDashboard size={14} />
                            My account
                          </Link>
                          <button
                            onClick={() => { logout(); setUserMenuOpen(false); }}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition"
                          >
                            <LogOut size={14} />
                            Sign out
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setAuthModal({ open: true, tab: "login" })}
                      className="flex items-center gap-1 sm:gap-1.5 border border-gray-200 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold text-gray-600 hover:border-orange-300 hover:text-orange-600 transition"
                    >
                      <User size={13} />
                      <span>Sign in</span>
                    </button>
                    <button
                      onClick={() => setAuthModal({ open: true, tab: "register" })}
                      className="flex items-center gap-1 sm:gap-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold transition"
                    >
                      Register
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Fulfillment toggle ────────────────────────────────────────── */}
          <div className="mt-4 flex gap-2">
            {(["delivery", "collection"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFulfillment(type)}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition-all border ${
                  fulfillment === type
                    ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-orange-300"
                }`}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>

          {/* Reserve a Table */}
          {settings.reservationSystem?.enabled && (
            <div className="mt-3">
              <button
                onClick={() => setShowReservation(true)}
                className="flex items-center gap-2 bg-orange-50 border border-orange-200 hover:bg-orange-100 hover:border-orange-400 active:scale-[0.98] text-orange-700 font-semibold text-sm px-4 py-2 rounded-xl transition-all"
              >
                <CalendarDays size={15} className="text-orange-500" />
                Reserve a Table
              </button>
            </div>
          )}

          {/* ── Stats row ─────────────────────────────────────────────────── */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-gray-600">
            <div className="flex items-center gap-1.5">
              <Clock size={14} className="text-orange-500" />
              <span className="text-xs sm:text-sm">
                {fulfillment === "delivery"
                  ? `${restaurant.deliveryTime} min delivery`
                  : `${restaurant.collectionTime} min collection`}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShoppingBag size={14} className="text-orange-500" />
              <span className="text-xs sm:text-sm">Min order £{restaurant.minOrder.toFixed(2)}</span>
            </div>
            {fulfillment === "delivery" && (
              <span className="text-orange-600 font-medium text-xs sm:text-sm">
                £{restaurant.deliveryFee.toFixed(2)} delivery
              </span>
            )}
          </div>

          {/* ── Closed / scheduled banner ─────────────────────────────────── */}
          {!isOpen && (
            <div className="mt-4">
              {scheduledTime ? (
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <CheckCircle2 size={17} className="text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-green-800 font-semibold text-sm">
                      Ordering for {scheduledTime}
                    </p>
                    <p className="text-green-600 text-xs mt-0.5">
                      Add items and checkout when ready.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setShowSchedule(true)}
                      className="text-xs font-semibold text-green-700 hover:text-green-900 underline underline-offset-2 transition"
                    >
                      Change
                    </button>
                    <button
                      onClick={() => setScheduledTime(null)}
                      className="w-6 h-6 flex items-center justify-center rounded-full text-green-400 hover:bg-green-100 hover:text-green-700 transition"
                    >
                      <XIcon size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start sm:items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <AlertCircle size={17} className="text-red-500 flex-shrink-0 mt-0.5 sm:mt-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-red-800 font-semibold text-sm">We&apos;re currently closed</p>
                    <p className="text-red-600 text-xs mt-0.5">
                      {nextOpen
                        ? <>Opens {formatNextOpen(nextOpen)} — you can schedule your order for later.</>
                        : "We're not accepting orders right now. Check back soon!"}
                    </p>
                  </div>
                  {nextOpen && (
                    <button
                      onClick={() => setShowSchedule(true)}
                      className="flex items-center gap-1.5 flex-shrink-0 bg-red-600 hover:bg-red-700 active:scale-95 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all whitespace-nowrap"
                    >
                      <CalendarDays size={12} />
                      Order for later
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {showSchedule && <ScheduleOrderModal onClose={() => setShowSchedule(false)} />}
        </div>
      </div>

      {/* ── Header nav links ─────────────────────────────────────────────── */}
      {headerLinks.length > 0 && (
        <div className="max-w-7xl mx-auto px-3 sm:px-4 mt-3">
          <nav className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4">
            <div className="hidden sm:flex items-center gap-1 h-11 overflow-x-auto scrollbar-hide">
              {headerLinks.map((link) => (
                <Link
                  key={link.id}
                  href={link.href}
                  className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition"
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="flex sm:hidden items-center justify-between h-11">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pages</span>
              <button
                onClick={() => setMobileNavOpen((v) => !v)}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition"
              >
                {mobileNavOpen ? <XIcon size={16} /> : <MenuIcon size={16} />}
              </button>
            </div>
            {mobileNavOpen && (
              <div className="sm:hidden border-t border-gray-100 py-2 space-y-0.5 pb-3">
                {headerLinks.map((link) => (
                  <Link
                    key={link.id}
                    href={link.href}
                    onClick={() => setMobileNavOpen(false)}
                    className="block px-3 py-2.5 text-sm font-medium text-gray-700 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </nav>
        </div>
      )}

      {authModal.open && (
        <AuthModal
          initialTab={authModal.tab}
          onClose={() => setAuthModal({ open: false, tab: "login" })}
        />
      )}
      {showReservation && (
        <ReservationModal onClose={() => setShowReservation(false)} />
      )}
    </div>
  );
}
