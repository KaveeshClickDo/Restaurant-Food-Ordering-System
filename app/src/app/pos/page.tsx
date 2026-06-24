"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePOS } from "@/context/POSContext";
import { useApp } from "@/context/AppContext";
import { useConnectivity } from "@/lib/connectivity";
import { isCapacitorAndroid } from "@/lib/capacitorBridge";
import { onPendingChange, pendingCount, drainOutbox } from "@/lib/posOutbox";
import {
  ChefHat, LogOut, WifiOff, RefreshCw, Cloud,
  ShoppingCart, LayoutDashboard, Users, UserCog, Settings2,
  UtensilsCrossed, CalendarDays, PackageCheck, History,
} from "lucide-react";
import { getInitials } from "@/components/pos/_utils";
import type { View } from "@/components/pos/_types";
import SaleView from "@/components/pos/SaleView";
import CollectionView from "@/components/pos/CollectionView";
import DashboardView from "@/components/pos/DashboardView";
import CustomersView from "@/components/pos/CustomersView";
import StaffView from "@/components/pos/StaffView";
import SettingsView from "@/components/pos/SettingsView";
import TableStatusView from "@/components/pos/TableStatusView";
import ReservationsView from "@/components/pos/ReservationsView";
import CollectionFooter from "@/components/collection/CollectionFooter";

// Top-level POS views that are deep-linkable via ?tab=<view> so a page refresh
// or shared link keeps the same tab open — mirrors /admin?tab=<id>.
const TAB_VIEWS: View[] = ["sale", "collection", "dashboard", "customers", "tables", "reservations", "staff", "settings"];

// Tabs that are useless offline (live server data only) — greyed out + not
// tappable when offline, and we bounce off them to Sale if connectivity drops.
// (Dashboard/Customers/Staff/Settings stay usable offline: cached/read-only.)
const OFFLINE_BLOCKED_VIEWS = new Set<View>(["collection", "tables", "reservations"]);

// Show the "menu may be outdated" banner only after the cached menu is older
// than this (4h) — short outages shouldn't nag the cashier.
const MENU_STALE_MS = 4 * 60 * 60 * 1000;
function formatAge(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export default function POSPage() {
  // useSearchParams() must be read inside a Suspense boundary (Next.js app router).
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <POSPageContent />
    </Suspense>
  );
}

function POSPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentStaff, sessionLoading, logout, settings, menuCachedAt } = usePOS();
  const { settings: appSettings, refreshDiningTables } = useApp();

  // Honor ?tab=<view> on first paint so a refresh / shared link lands on the
  // same tab instead of always snapping back to Sale.
  const rawTab = searchParams.get("tab");
  const initialView = (rawTab && TAB_VIEWS.includes(rawTab as View) ? rawTab : "sale") as View;
  const [view, setView] = useState<View>(initialView);
  const [time, setTime] = useState(""); // empty string on SSR, filled after mount
  const [mounted, setMounted] = useState(false);

  // Keep the dining-table list live so the Table Service / Reservations tabs
  // appear/disappear when an admin adds or removes tables — without needing a
  // full reload (Bug #34/#40). dining_tables has no realtime, so we poll.
  useEffect(() => {
    refreshDiningTables();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refreshDiningTables();
    }, 15_000);
    return () => clearInterval(id);
  }, [refreshDiningTables]);

  // ── Connectivity ──────────────────────────────────────────────────────────
  // On web, sales hard-fail when offline — the banner below tells the cashier
  // to wait. On Capacitor Android, the cashier can keep ringing up cash sales
  // and they queue to the local SQLite outbox (lib/posOutbox.ts); the drain
  // effect immediately below pushes them to the server when connectivity
  // restores.
  const { isOnline, recheck } = useConnectivity();
  const onAndroid = isCapacitorAndroid();

  // ── Outbox pending-count subscription ─────────────────────────────────────
  // The outbox lives in on-device SQLite. We subscribe to its change events
  // (fired by enqueue / drain) and also hydrate the initial value on mount so
  // a queue that survives a page refresh is reflected immediately.
  const [outboxCount, setOutboxCount] = useState(0);
  useEffect(() => {
    if (!onAndroid) return;
    pendingCount().then(setOutboxCount).catch(() => {});
    return onPendingChange(setOutboxCount);
  }, [onAndroid]);

  // ── Drain on connectivity ─────────────────────────────────────────────────
  // Every time isOnline becomes true we kick a drain. drainOutbox latches
  // against itself so a rapid sequence of online events collapses into a
  // single in-flight pass — no manual prev-state tracking needed.
  useEffect(() => {
    if (!onAndroid || !isOnline) return;
    drainOutbox().catch(() => {});
  }, [onAndroid, isOnline]);

  // ── Sync on app open / resume ─────────────────────────────────────────────
  // We deliberately don't run a closed-app background worker (the outbox lives
  // in encrypted SQLite a native worker can't read — see docs/pos-offline).
  // Instead, queued sales upload whenever the cashier opens or returns to the
  // app: the cold-open drain is covered by the effect above (isOnline starts
  // true); this covers a WARM RESUME from the background, where isOnline never
  // transitions so that effect wouldn't refire. We re-probe connectivity, and
  // only drain when we currently believe we're online — draining while offline
  // would burn the per-entry retry budget for nothing.
  useEffect(() => {
    if (!onAndroid) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      recheck();                                    // refresh connectivity now
      if (isOnline) drainOutbox().catch(() => {});  // drain queued sales if reachable
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [onAndroid, isOnline, recheck]);

  // If connectivity drops while on a tab that can't work offline, bounce to Sale.
  useEffect(() => {
    if (!isOnline && OFFLINE_BLOCKED_VIEWS.has(view)) setView("sale");
  }, [isOnline, view]);

  // Mount guard: prevents SSR/hydration mismatch from localStorage state
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    // Wait for the cookie session to hydrate before deciding "logged out" —
    // otherwise a refresh bounces to /pos/login and loses the ?tab= param.
    if (sessionLoading) return;
    if (!currentStaff) { router.replace("/pos/login"); return; }
    // Redirect to sale if current view is no longer permitted
    const p = currentStaff.permissions;
    const allowed: Record<View, boolean> = {
      sale: true,
      collection: true,
      dashboard: p.canAccessDashboard,
      customers: p.canManageCustomers,
      staff: p.canManageStaff,
      settings: p.canAccessSettings,
      tables: true,
      reservations: true,
    };
    if (!allowed[view]) setView("sale");
  }, [mounted, sessionLoading, currentStaff, router, view]);

  useEffect(() => {
    // Only run clock on client after mount
    setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })), 30000);
    return () => clearInterval(id);
  }, []);

  // Keep `view` in sync if ?tab=<view> changes after mount (browser back/forward
  // or an in-app deep link).
  useEffect(() => {
    const raw = searchParams.get("tab");
    if (raw && TAB_VIEWS.includes(raw as View)) setView(raw as View);
  }, [searchParams]);

  // Select a tab AND reflect it in the URL. `replace` keeps history flat (paging
  // through tabs shouldn't fill the back stack) and `scroll: false` stops the
  // page jumping to top — same pattern as the admin panel.
  function selectView(next: View) {
    setView(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/pos?${params.toString()}`, { scroll: false });
  }

  // Show nothing until client has hydrated (avoids mismatch between SSR null and client session)
  if (!mounted || !currentStaff) return <div className="min-h-screen bg-slate-950" />;

  const perms = currentStaff.permissions;

  // Table Service and Reservations are always visible on POS — POS staff
  // need to seat walk-ins and manage reservations regardless of whether any
  // tables have been configured yet or how the admin has set the online
  // reservation toggle (Admin → Reservations). That toggle controls the
  // public booking page only; POS access is unconditional.
  const NAV = [
    { id: "sale"         as View, label: "Sale",          icon: ShoppingCart,    show: true },
    { id: "collection"   as View, label: "Collection",    icon: PackageCheck,    show: true },
    { id: "dashboard"    as View, label: "Dashboard",     icon: LayoutDashboard, show: perms.canAccessDashboard },
    { id: "customers"    as View, label: "Customers",     icon: Users,           show: perms.canManageCustomers },
    { id: "tables"       as View, label: "Table Service", icon: UtensilsCrossed, show: true },
    { id: "reservations" as View, label: "Reservations",  icon: CalendarDays,    show: true },
    { id: "staff"        as View, label: "Staff",         icon: UserCog,         show: perms.canManageStaff },
    { id: "settings"     as View, label: "Settings",      icon: Settings2,       show: perms.canAccessSettings },
  ].filter((n) => n.show);

  const viewLabels: Record<View, string> = {
    sale: "Point of Sale",
    collection: "Collection Pickups",
    dashboard: "Sales Dashboard",
    customers: "Customers",
    staff: "Staff & Attendance",
    settings: "Settings",
    tables: "Table Service",
    reservations: "Reservations",
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 h-14 bg-slate-900 border-b border-slate-700/50 flex items-center px-4 gap-2 sm:gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center">
            <ChefHat size={14} className="text-white" />
          </div>
          <span className="text-white font-bold text-sm hidden sm:block">{appSettings.restaurant?.name || settings.businessName || "POS"}</span>
        </div>

        <div className="h-6 w-px bg-slate-700 flex-shrink-0" />

        {/* Breadcrumb */}
        <p className="text-slate-300 text-sm font-medium">{viewLabels[view]}</p>

        <div className="flex-1" />

        {/* Clock */}
        <p className="text-slate-400 text-sm font-mono hidden sm:block">{time}</p>

        <div className="h-6 w-px bg-slate-700 flex-shrink-0 hidden sm:block" />

        {/* Staff */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: currentStaff.avatarColor }}>
            {getInitials(currentStaff.name)}
          </div>
          <div className="hidden sm:block">
            <p className="text-white text-xs font-semibold leading-none">{currentStaff.name}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${
              currentStaff.role === "admin"   ? "bg-purple-500/20 text-purple-400" :
              currentStaff.role === "manager" ? "bg-blue-500/20   text-blue-400"   :
                                                "bg-slate-600     text-slate-400"
            }`}>
              {currentStaff.role}
            </span>
          </div>
        </div>

        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-slate-400 hover:text-red-400 text-xs font-medium transition-colors px-2 sm:px-3 py-2 rounded-lg hover:bg-red-500/10"
        >
          <LogOut size={14} />
          <span className="hidden sm:block">Logout</span>
        </button>
      </header>

      {/* Offline banner. On web the cashier cannot complete a sale offline.
          On Capacitor Android the outbox catches cash sales and the message
          changes to reflect that — see lib/posOutbox.ts. */}
      {!isOnline && (
        <div className="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-3">
          <WifiOff size={14} className="text-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-xs font-medium flex-1">
            {onAndroid
              ? "No internet connection — cash and card sales will queue and sync when you reconnect. Confirm card on terminal before completing. Gift cards unavailable."
              : "No internet connection — sales cannot be completed until you reconnect."}
          </p>
          <button
            onClick={recheck}
            className="text-amber-400 hover:text-amber-300 transition-colors flex-shrink-0"
            title="Retry connection"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      )}

      {/* Pending-sync banner — shown whenever the local SQLite outbox is
          non-empty, regardless of connectivity. Online + non-zero means a
          drain is in progress; offline + non-zero means the queue is waiting
          for reconnection. */}
      {onAndroid && outboxCount > 0 && (
        <div className="flex-shrink-0 bg-blue-500/10 border-b border-blue-500/30 px-4 py-2 flex items-center gap-3">
          <Cloud size={14} className={`text-blue-400 flex-shrink-0 ${isOnline ? "animate-pulse" : ""}`} />
          <p className="text-blue-300 text-xs font-medium flex-1">
            {isOnline
              ? `Syncing ${outboxCount} offline sale${outboxCount > 1 ? "s" : ""}…`
              : `${outboxCount} sale${outboxCount > 1 ? "s" : ""} pending sync — will upload when reconnected.`}
          </p>
        </div>
      )}

      {/* Stale-cache banner — when offline and the cached menu is old, warn the
          cashier that prices/items may be out of date (1.6). Self-clears once
          back online (menuCachedAt → null on a live load). */}
      {!isOnline && menuCachedAt !== null && (Date.now() - menuCachedAt > MENU_STALE_MS) && (
        <div className="flex-shrink-0 bg-orange-500/10 border-b border-orange-500/30 px-4 py-2 flex items-center gap-3">
          <History size={14} className="text-orange-400 flex-shrink-0" />
          <p className="text-orange-300 text-xs font-medium flex-1">
            Menu last updated {formatAge(Date.now() - menuCachedAt)} ago — items/prices may be outdated. Reconnect to refresh.
          </p>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {view === "sale" && <SaleView isOffline={!isOnline} />}
        {view === "collection" && <CollectionView />}
        {view === "dashboard" && perms.canAccessDashboard && <DashboardView />}
        {view === "customers" && perms.canManageCustomers && <CustomersView />}
        {view === "staff" && perms.canManageStaff && <StaffView />}
        {view === "settings" && perms.canAccessSettings && <SettingsView />}
        {view === "tables" && <TableStatusView />}
        {view === "reservations" && <ReservationsView />}
      </div>

      {/* Bottom nav */}
      <nav className="flex-shrink-0 h-16 bg-slate-900 border-t border-slate-700/50 flex items-stretch">
        {NAV.map((item) => {
          const active = view === item.id;
          // Fully-offline-blocked tabs: grey out + not tappable when offline.
          const blocked = !isOnline && OFFLINE_BLOCKED_VIEWS.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => { if (!blocked) selectView(item.id); }}
              disabled={blocked}
              title={blocked ? "Needs internet" : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all ${blocked ? "" : "active:scale-95"} ${
                active
                  ? "text-orange-400 bg-orange-500/10 border-t-2 border-orange-500"
                  : blocked
                    ? "text-slate-700 cursor-not-allowed border-t-2 border-transparent"
                    : "text-slate-500 hover:text-slate-300 border-t-2 border-transparent"
              }`}
            >
              <item.icon size={20} />
              <span className="hidden sm:block text-[10px] font-semibold">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <CollectionFooter />
    </div>
  );
}
