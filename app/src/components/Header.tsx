"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { Clock, ShoppingBag, Star, AlertCircle, User, LogOut, ChevronDown, LayoutDashboard, Menu as MenuIcon, X as XIcon, CalendarDays, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import AuthModal from "@/components/AuthModal";
import ScheduleOrderModal from "@/components/ScheduleOrderModal";
import { getNextOpenTime, formatNextOpen } from "@/lib/scheduleUtils";

export default function Header() {
  const { settings, fulfillment, setFulfillment, isOpen, currentUser, logout, scheduledTime, setScheduledTime } = useApp();
  const { restaurant } = settings;
  const [authModal, setAuthModal] = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const nextOpen = !isOpen ? getNextOpenTime(settings.schedule, settings.manualClosed) : null;

  const headerLinks = (settings.menuLinks ?? [])
    .filter((l) => l.location === "header" && l.active)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="relative">
      {/* Cover image */}
      <div className="relative h-52 md:h-64 w-full overflow-hidden">
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
      <div className="max-w-7xl mx-auto px-4">
        <div className="relative -mt-16 md:-mt-20 bg-white rounded-2xl shadow-xl p-5 md:p-6">
          <div className="flex items-start gap-4">
            {/* Logo */}
            <div className="relative h-20 w-20 md:h-24 md:w-24 rounded-xl overflow-hidden border-2 border-white shadow-md flex-shrink-0">
              <Image
                src={restaurant.logoImage}
                alt={`${restaurant.name} logo`}
                fill
                className="object-cover"
                unoptimized
              />
            </div>

            {/* Name & meta */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight">
                    {restaurant.name}
                  </h1>
                  <p className="text-gray-500 text-sm mt-0.5">{restaurant.tagline}</p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Hygiene rating */}
                  <div className="flex items-center gap-1 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                    <Star size={14} className="text-green-600 fill-green-600" />
                    <span className="text-green-700 font-semibold text-sm">
                      {restaurant.hygieneRating} Hygiene
                    </span>
                  </div>

                  {/* Account */}
                  {currentUser ? (
                    <div className="relative">
                      <button
                        onClick={() => setUserMenuOpen((v) => !v)}
                        className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 hover:bg-orange-100 transition"
                      >
                        <User size={14} className="text-orange-600" />
                        <span className="text-orange-700 font-semibold text-sm max-w-[120px] truncate">
                          {currentUser.name.split(" ")[0]}
                        </span>
                        <ChevronDown size={13} className="text-orange-500" />
                      </button>
                      {userMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                          <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20">
                            <div className="px-4 py-2 border-b border-gray-100">
                              <p className="text-xs font-semibold text-gray-800 truncate">{currentUser.name}</p>
                              <p className="text-xs text-gray-400 truncate">{currentUser.email}</p>
                            </div>
                            <Link
                              href="/account"
                              onClick={() => setUserMenuOpen(false)}
                              className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                            >
                              <LayoutDashboard size={14} />
                              My account
                            </Link>
                            <button
                              onClick={() => { logout(); setUserMenuOpen(false); }}
                              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition"
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
                        className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-600 hover:border-orange-300 hover:text-orange-600 transition"
                      >
                        <User size={14} />
                        Sign in
                      </button>
                      <button
                        onClick={() => setAuthModal({ open: true, tab: "register" })}
                        className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg px-3 py-1.5 text-sm font-semibold transition"
                      >
                        Register
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Delivery / Collection toggle */}
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

              {/* Stats row */}
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600">
                <div className="flex items-center gap-1.5">
                  <Clock size={15} className="text-orange-500" />
                  <span>
                    {fulfillment === "delivery"
                      ? `${restaurant.deliveryTime} min delivery`
                      : `${restaurant.collectionTime} min collection`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShoppingBag size={15} className="text-orange-500" />
                  <span>Min order £{restaurant.minOrder.toFixed(2)}</span>
                </div>
                {fulfillment === "delivery" && (
                  <div className="text-orange-600 font-medium">
                    £{restaurant.deliveryFee.toFixed(2)} delivery
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Closed / Scheduled banner */}
          {!isOpen && (
            <div className="mt-4">
              {scheduledTime ? (
                /* ── Scheduled state ── */
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-green-800 font-semibold text-sm">
                      Ordering for {scheduledTime}
                    </p>
                    <p className="text-green-600 text-xs mt-0.5">
                      We&apos;ll have your order ready in time — add items and checkout when ready.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setShowSchedule(true)}
                      className="text-xs font-semibold text-green-700 hover:text-green-900 underline underline-offset-2 transition"
                    >
                      Change
                    </button>
                    <button
                      onClick={() => setScheduledTime(null)}
                      className="w-6 h-6 flex items-center justify-center rounded-full text-green-400 hover:bg-green-100 hover:text-green-700 transition"
                      title="Cancel scheduled order"
                    >
                      <XIcon size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Closed / unscheduled state ── */
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <AlertCircle size={18} className="text-red-500 flex-shrink-0 hidden sm:block" />
                  <div className="flex-1 min-w-0">
                    <p className="text-red-800 font-semibold text-sm">
                      We&apos;re currently closed
                    </p>
                    <p className="text-red-600 text-xs mt-0.5">
                      {nextOpen
                        ? <>Opens {formatNextOpen(nextOpen)} &mdash; you can schedule your order for later.</>
                        : "We're not accepting orders right now. Check back soon!"}
                    </p>
                  </div>
                  {nextOpen && (
                    <button
                      onClick={() => setShowSchedule(true)}
                      className="flex items-center gap-1.5 flex-shrink-0 bg-red-600 hover:bg-red-700 active:scale-95 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all"
                    >
                      <CalendarDays size={13} />
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

      {/* Header navigation bar — only rendered when links are configured */}
      {headerLinks.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 mt-3">
          <nav className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4">
            {/* Desktop */}
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

            {/* Mobile — hamburger */}
            <div className="flex sm:hidden items-center justify-between h-11">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pages</span>
              <button
                onClick={() => setMobileNavOpen((v) => !v)}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition"
              >
                {mobileNavOpen ? <XIcon size={16} /> : <MenuIcon size={16} />}
              </button>
            </div>

            {/* Mobile expanded */}
            {mobileNavOpen && (
              <div className="sm:hidden border-t border-gray-100 py-2 space-y-0.5 pb-3">
                {headerLinks.map((link) => (
                  <Link
                    key={link.id}
                    href={link.href}
                    onClick={() => setMobileNavOpen(false)}
                    className="block px-3 py-2 text-sm font-medium text-gray-700 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition"
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
    </div>
  );
}
