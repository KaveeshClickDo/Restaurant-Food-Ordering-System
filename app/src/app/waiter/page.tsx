"use client";

/**
 * /waiter — orchestrator only. Owns the session (auth restore, live profile
 * sync, idle logout), the tables config, and the cross-view state (current
 * view, active table, covers, last receipt, live floor data). Everything
 * visual lives in components/waiter/* — TablesView, MenuView, BillView,
 * SuccessView — which own their view-local state and report back through
 * narrow callbacks.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { useIdleLogout } from "@/lib/useIdleLogout";
import type { WaiterStaff, DiningTable } from "@/types";
import type { View, WaiterReceipt } from "@/components/waiter/_types";
import { useFloorState } from "@/components/waiter/useFloorState";
import TablesView from "@/components/waiter/TablesView";
import MenuView from "@/components/waiter/MenuView";
import BillView from "@/components/waiter/BillView";
import SuccessView from "@/components/waiter/SuccessView";

export default function WaiterPage() {
  const router = useRouter();
  const { settings: appSettings } = useApp();

  // ── Auth ────────────────────────────────────────────────────────────────────
  // Login lives on the dedicated /waiter/login page; middleware guarantees a
  // valid waiter session before this page renders. We only restore the signed-in
  // waiter's profile here (from sessionStorage, falling back to /api/auth/waiter/me).
  const [view, setView] = useState<View>("tables");
  const [waiter, setWaiter] = useState<Omit<WaiterStaff, "pin"> | null>(null);

  // ── Cross-view state ────────────────────────────────────────────────────────
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [activeSection, setActiveSection] = useState("All");
  const [activeTable, setActiveTable] = useState<DiningTable | null>(null);
  const [covers, setCovers] = useState(2);
  // Kitchen-status panel fold state — page-level so it survives view switches.
  const [kitchenOpen, setKitchenOpen] = useState(false);
  // Last receipt (order sent / bill settled) — outlives the view it was made in.
  const [receipt, setReceipt] = useState<WaiterReceipt | null>(null);

  // Live floor data (active dine-in orders + today's reservations + derived
  // occupancy / ready sets). Polls only while the tables grid is visible.
  const floor = useFloorState(view === "tables");
  const slotDuration = appSettings.reservationSystem?.slotDurationMinutes ?? 90;

  // ── Initialise: restore signed-in waiter + load tables config ───────────────
  useEffect(() => {
    // Restore the waiter profile for the header. sessionStorage is the fast
    // path; if it's empty (new tab / cleared) we recover it from the session
    // cookie via /api/auth/waiter/me. A 401 there means the cookie is no longer
    // valid (e.g. session_version bumped) — bounce to the dedicated login.
    let restored = false;
    try {
      const stored = sessionStorage.getItem("waiter_session");
      if (stored) { setWaiter(JSON.parse(stored)); restored = true; }
    } catch { /* ignore */ }

    if (!restored) {
      fetch("/api/auth/waiter/me", { cache: "no-store" })
        .then((r) => (r.status === 401 ? null : r.json()))
        .then((d: { ok: boolean; waiter?: Omit<WaiterStaff, "pin"> } | null) => {
          if (d?.ok && d.waiter) {
            setWaiter(d.waiter);
            sessionStorage.setItem("waiter_session", JSON.stringify(d.waiter));
          } else {
            router.replace("/waiter/login");
          }
        })
        .catch(() => { });
    }

    // Load tables
    fetch("/api/waiter/config")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setTables(d.tables); })
      .catch(() => { });
  }, [router]);

  // ── Live sync from admin (Bugs #9 + #12) ────────────────────────────────────
  // Re-fetch the public config every 15 s so admin-side additions (new tables,
  // newly-hired staff) appear without the waiter having to refresh the page.
  // When the waiter is signed in, also refresh their own profile from
  // /api/auth/waiter/me — admin edits to name/hourly rate/avatar previously
  // required a sign-out + sign-in to surface. A 401 here also auto-logs the
  // waiter out (covers the session_version path for deactivation).
  const lastConfigKey = useRef<string>("");
  const lastMeKey = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (document.visibilityState !== "visible") return;

      try {
        const r = await fetch("/api/waiter/config", { cache: "no-store" });
        const d = await r.json();
        if (d.ok && !cancelled) {
          const key = JSON.stringify({ t: d.tables });
          if (key !== lastConfigKey.current) {
            lastConfigKey.current = key;
            setTables(d.tables ?? []);
          }
        }
      } catch { /* network — keep last good values */ }

      if (waiter) {
        try {
          const r = await fetch("/api/auth/waiter/me", { cache: "no-store" });
          if (r.status === 401) {
            if (!cancelled) {
              sessionStorage.removeItem("waiter_session");
              setWaiter(null);
              router.replace("/waiter/login");
            }
            return;
          }
          const d = await r.json() as { ok: boolean; waiter?: Omit<WaiterStaff, "pin"> };
          if (d.ok && d.waiter && !cancelled) {
            const key = JSON.stringify(d.waiter);
            if (key !== lastMeKey.current) {
              lastMeKey.current = key;
              sessionStorage.setItem("waiter_session", JSON.stringify(d.waiter));
              setWaiter(d.waiter);
            }
          }
        } catch { /* ignore */ }
      }
    }
    const id = setInterval(tick, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [waiter, router]);

  // ── Logout ───────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    // Tell the server to drop the cookie before we wipe the local mirror, then
    // hand off to the dedicated login page. Fire-and-forget — even if the
    // request fails (network blip), the redirect + middleware re-gate covers us.
    fetch("/api/waiter/logout", { method: "POST" }).catch(() => { });
    sessionStorage.removeItem("waiter_session");
    setWaiter(null);
    setActiveTable(null);
    router.replace("/waiter/login");
  }, [router]);

  // Auto-logout after 15 minutes of inactivity. Tablets get passed around
  // during a shift — without this, a forgotten tab keeps the waiter PIN
  // valid for the full 30-day server cookie window.
  useIdleLogout({
    enabled: Boolean(waiter),
    timeoutMs: 15 * 60 * 1000,
    onIdle: logout,
  });

  // ── Navigation ───────────────────────────────────────────────────────────────
  // Enter the order flow for a table. coversOverride pre-fills the stepper
  // (e.g. a seated booking's party size). The cart itself lives in MenuView,
  // which mounts fresh per visit.
  function selectTable(table: DiningTable, coversOverride?: number) {
    if (coversOverride) setCovers(coversOverride);
    setActiveTable(table);
    setView("menu");
  }

  function openBill(table: DiningTable) {
    setActiveTable(table);
    setView("bill");
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (view === "success") {
    return (
      <SuccessView
        tableLabel={activeTable?.label}
        receipt={receipt}
        setReceipt={setReceipt}
        onAddMore={() => setView("menu")}
        onNewTable={() => { setActiveTable(null); setView("tables"); }}
      />
    );
  }

  if (view === "bill" && activeTable) {
    return (
      <BillView
        table={activeTable}
        waiter={waiter}
        receipt={receipt}
        setReceipt={setReceipt}
        onCheckoutReservation={floor.checkoutReservationForLabel}
        onExit={(refresh) => {
          setActiveTable(null);
          if (refresh) floor.refreshOrders();
          setView("tables");
        }}
      />
    );
  }

  if (view === "menu" && activeTable) {
    return (
      <MenuView
        table={activeTable}
        covers={covers}
        setCovers={setCovers}
        waiterName={waiter?.name}
        onBack={() => { setActiveTable(null); setView("tables"); }}
        onSent={(r) => { setReceipt(r); setView("success"); floor.refreshOrders(); }}
      />
    );
  }

  // Tables grid — also the fallback for any state without an active table.
  return (
    <TablesView
      waiter={waiter}
      onLogout={logout}
      tables={tables}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      floor={floor}
      slotDuration={slotDuration}
      kitchenOpen={kitchenOpen}
      onKitchenToggle={() => setKitchenOpen((v) => !v)}
      onSelectTable={selectTable}
      onOpenBill={openBill}
      receipt={receipt}
      onCloseReceipt={() => setReceipt(null)}
    />
  );
}
