"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePOS } from "@/context/POSContext";
import { useApp } from "@/context/AppContext";
import { useConnectivity } from "@/lib/connectivity";
import { drainOutbox, pendingCount, retryFailed } from "@/lib/posOutbox";
import {
  ChefHat, LogOut, WifiOff, RefreshCw, Wifi,
  ShoppingCart, LayoutDashboard, Users, UserCog, Settings2,
  UtensilsCrossed, CalendarDays,
} from "lucide-react";
import { getInitials } from "@/components/pos/_utils";
import type { View } from "@/components/pos/_types";
import SaleView from "@/components/pos/SaleView";
import DashboardView from "@/components/pos/DashboardView";
import CustomersView from "@/components/pos/CustomersView";
import StaffView from "@/components/pos/StaffView";
import SettingsView from "@/components/pos/SettingsView";
import TableStatusView from "@/components/pos/TableStatusView";
import ReservationsView from "@/components/pos/ReservationsView";

export default function POSPage() {
  const router = useRouter();
  const { currentStaff, logout, settings } = usePOS();
  const { settings: appSettings } = useApp();
  const [view, setView] = useState<View>("sale");
  const [time, setTime] = useState(""); // empty string on SSR, filled after mount
  const [mounted, setMounted] = useState(false);

  // ── Connectivity & offline outbox ─────────────────────────────────────────
  const { isOnline, recheck } = useConnectivity();
  const [outboxCount, setOutboxCount] = useState(0);
  const prevOnline = useRef(true);

  // Mount guard: prevents SSR/hydration mismatch from localStorage state
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!currentStaff) { router.replace("/pos/login"); return; }
    // Redirect to sale if current view is no longer permitted
    const p = currentStaff.permissions;
    const allowed: Record<View, boolean> = {
      sale: true,
      dashboard: p.canAccessDashboard,
      customers: p.canManageCustomers,
      staff: p.canManageStaff,
      settings: p.canAccessSettings,
      tables: true,
      reservations: true,
    };
    if (!allowed[view]) setView("sale");
  }, [mounted, currentStaff, router, view]);

  useEffect(() => {
    // Only run clock on client after mount
    setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })), 30000);
    return () => clearInterval(id);
  }, []);

  // Drain outbox when we come back online
  useEffect(() => {
    if (isOnline && !prevOnline.current) {
      retryFailed();
      drainOutbox().then(() => setOutboxCount(pendingCount()));
    }
    prevOnline.current = isOnline;
  }, [isOnline]);

  // Keep outbox badge count fresh (poll every 5 s)
  useEffect(() => {
    setOutboxCount(pendingCount());
    const id = setInterval(() => setOutboxCount(pendingCount()), 5000);
    return () => clearInterval(id);
  }, []);

  // Warn before tab close when there are unsynced sales
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (pendingCount() > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Show nothing until client has hydrated (avoids mismatch between SSR null and client session)
  if (!mounted || !currentStaff) return <div className="min-h-screen bg-slate-950" />;

  const perms = currentStaff.permissions;

  // hasTables: any dining tables exist (active or not) — shows Table Service tab
  const hasTables      = (appSettings.diningTables?.length ?? 0) > 0;
  // hasReservations: reservation system is explicitly enabled — shows Reservations tab
  // Use || hasTables so it also appears alongside Table Service when tables are configured.
  const hasReservations = (appSettings.reservationSystem?.enabled === true) || hasTables;

  const NAV = [
    { id: "sale"         as View, label: "Sale",          icon: ShoppingCart,    show: true },
    { id: "dashboard"    as View, label: "Dashboard",     icon: LayoutDashboard, show: perms.canAccessDashboard },
    { id: "customers"    as View, label: "Customers",     icon: Users,           show: perms.canManageCustomers },
    { id: "tables"       as View, label: "Table Service", icon: UtensilsCrossed, show: hasTables },
    { id: "reservations" as View, label: "Reservations",  icon: CalendarDays,    show: hasReservations },
    { id: "staff"        as View, label: "Staff",         icon: UserCog,         show: perms.canManageStaff },
    { id: "settings"     as View, label: "Settings",      icon: Settings2,       show: perms.canAccessSettings },
  ].filter((n) => n.show);

  const viewLabels: Record<View, string> = {
    sale: "Point of Sale",
    dashboard: "Sales Dashboard",
    customers: "Customers",
    staff: "Staff & Attendance",
    settings: "Settings",
    tables: "Table Service",
    reservations: "Reservations",
  };

  return (
    <div className="h-screen flex flex-col bg-slate-950 overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 h-14 bg-slate-900 border-b border-slate-700/50 flex items-center px-4 gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center">
            <ChefHat size={14} className="text-white" />
          </div>
          <span className="text-white font-bold text-sm hidden sm:block">{appSettings.restaurant?.name || settings.businessName || "POS"}</span>
        </div>

        <div className="h-6 w-px bg-slate-700 flex-shrink-0" />

        {/* Breadcrumb */}
        <p className="text-slate-300 text-sm font-medium hidden sm:block">{viewLabels[view]}</p>

        <div className="flex-1" />

        {/* Clock */}
        <p className="text-slate-400 text-sm font-mono hidden md:block">{time}</p>

        <div className="h-6 w-px bg-slate-700 flex-shrink-0 hidden md:block" />

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
          className="flex items-center gap-1.5 text-slate-400 hover:text-red-400 text-xs font-medium transition-colors ml-2 px-3 py-2 rounded-lg hover:bg-red-500/10"
        >
          <LogOut size={14} />
          <span className="hidden sm:block">Logout</span>
        </button>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-3">
          <WifiOff size={14} className="text-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-xs font-medium flex-1">
            No internet connection — cash payments only. Sales are saved locally.
            {outboxCount > 0 && ` ${outboxCount} sale${outboxCount > 1 ? "s" : ""} pending sync.`}
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

      {/* Online + pending sync indicator */}
      {isOnline && outboxCount > 0 && (
        <div className="flex-shrink-0 bg-blue-500/10 border-b border-blue-500/20 px-4 py-1.5 flex items-center gap-2">
          <Wifi size={12} className="text-blue-400 flex-shrink-0" />
          <p className="text-blue-300 text-xs flex-1">
            Syncing {outboxCount} offline sale{outboxCount > 1 ? "s" : ""} to server…
          </p>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {view === "sale" && <SaleView isOffline={!isOnline} />}
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
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
                active
                  ? "text-orange-400 bg-orange-500/10 border-t-2 border-orange-500"
                  : "text-slate-500 hover:text-slate-300 border-t-2 border-transparent"
              }`}
            >
              <item.icon size={20} />
              <span className="text-[10px] font-semibold">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
