"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import {
  RefreshCw, UtensilsCrossed, Loader2, Clock, Users, Phone, LogIn, LogOut, CheckCircle2, Crown,
} from "lucide-react";
import { type ResRow, fmt12Pos, fmtTsPos } from "./_reservations";

type TableState = "free" | "reserved" | "occupied" | "done";

const TABLE_STATE_STYLES: Record<TableState, { card: string; badge: string; label: string; dot: string; ring: string }> = {
  free:     { card: "bg-slate-800/60 border-slate-700",       badge: "bg-slate-700 text-slate-300",       label: "Free",     dot: "bg-slate-500",  ring: "" },
  reserved: { card: "bg-amber-900/30 border-amber-600/60",    badge: "bg-amber-800/60 text-amber-300",    label: "Reserved", dot: "bg-amber-400",  ring: "ring-1 ring-amber-500/30" },
  occupied: { card: "bg-blue-900/40 border-blue-500/60",      badge: "bg-blue-800/60 text-blue-300",      label: "Occupied", dot: "bg-blue-400",   ring: "ring-1 ring-blue-400/30" },
  done:     { card: "bg-teal-900/30 border-teal-600/50",      badge: "bg-teal-800/50 text-teal-300",      label: "Done",     dot: "bg-teal-400",   ring: "" },
};

export default function TableStatusView() {
  const { settings: appSettings, refreshDiningTables } = useApp();
  const currencySymbol = appSettings.currency?.symbol ?? "£";
  const tables = (appSettings.diningTables ?? []).filter((t) => t.active);

  const [reservations,   setReservations]   = useState<ResRow[]>([]);
  // initialLoading drives the user-visible spinner — it flips to false after
  // the first fetch resolves. Background 5 s polls do NOT toggle it, so the
  // page never thrashes back to a spinner mid-shift.
  const [initialLoading, setInitialLoading] = useState(true);
  // refreshing drives the manual Refresh button's spinner only — kept separate
  // from initialLoading so a manual refresh never blanks the table grid.
  const [refreshing,     setRefreshing]     = useState(false);
  const [actioning,      setActioning]      = useState<string | null>(null);
  const [filterSection,  setFilterSection]  = useState("");

  const sections = [...new Set(tables.map((t) => t.section).filter(Boolean))];

  const fetchToday = useCallback(async (isInitial = false) => {
    try {
      const today = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })();

      const r = await fetch(`/api/pos/reservations?date=${encodeURIComponent(today)}`, { cache: "no-store" });
      if (!r.ok) {
        if (r.status !== 401) console.error("TableStatusView fetch:", r.status);
        return;
      }
      const json = await r.json() as { ok: boolean; reservations?: ResRow[] };
      if (!json.ok || !json.reservations) return;

      const active = json.reservations.filter((row) =>
        ["pending", "confirmed", "checked_in", "checked_out"].includes(String(row.status)),
      );
      setReservations(active);
    } catch (err) {
      console.error("TableStatusView fetch:", err);
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, []);

  useEffect(() => { fetchToday(true); }, [fetchToday]);

  // Poll every 5 s — anon supabase realtime no longer fires after RLS revoke.
  // Polls run silently (isInitial=false) so they don't toggle the spinner.
  useEffect(() => {
    const id = setInterval(() => fetchToday(false), 5_000);
    return () => clearInterval(id);
  }, [fetchToday]);

  // Manual refresh — re-pulls tables + today's reservations and spins the button
  // icon for the duration, without flipping initialLoading (which would blank the grid).
  async function manualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([Promise.resolve(refreshDiningTables()), fetchToday(false)]);
    } finally {
      setRefreshing(false);
    }
  }

  const actionInFlight = useRef<Set<string>>(new Set());

  async function doAction(resId: string, status: "checked_in" | "checked_out") {
    if (actionInFlight.current.has(resId)) return;
    actionInFlight.current.add(resId);
    setActioning(resId);
    try {
      const now = new Date().toISOString();
      await fetch(`/api/pos/reservations/${resId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setReservations((prev) =>
        prev.map((r) => r.id !== resId ? r : {
          ...r, status,
          ...(status === "checked_in"  ? { checked_in_at:  now } : {}),
          ...(status === "checked_out" ? { checked_out_at: now } : {}),
        })
      );
    } finally {
      actionInFlight.current.delete(resId);
      setActioning(null);
    }
  }

  function resolveState(tableId: string): { state: TableState; res?: ResRow } {
    const occupied = reservations.find((r) => r.table_id === tableId && r.status === "checked_in");
    if (occupied) return { state: "occupied", res: occupied };
    const reserved = reservations.find((r) => r.table_id === tableId && (r.status === "pending" || r.status === "confirmed"));
    if (reserved) return { state: "reserved", res: reserved };
    const done = reservations.find((r) => r.table_id === tableId && r.status === "checked_out");
    if (done) return { state: "done", res: done };
    return { state: "free" };
  }

  const visibleTables = tables.filter((t) => !filterSection || t.section === filterSection);

  const counts = { free: 0, reserved: 0, occupied: 0, done: 0 };
  for (const t of visibleTables) counts[resolveState(t.id).state]++;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 space-y-4">

      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-white font-bold text-lg">Table Status</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            {counts.occupied} occupied · {counts.reserved} reserved · {counts.free} free
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sections.length > 1 && (
            <select
              value={filterSection}
              onChange={(e) => setFilterSection(e.target.value)}
              className="bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-xl px-3 py-1.5 focus:outline-none focus:border-orange-500"
            >
              <option value="">All sections</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button
            onClick={manualRefresh}
            disabled={initialLoading || refreshing}
            className="flex items-center gap-1.5 bg-slate-800 border border-slate-600 text-slate-300 hover:text-white text-sm px-3 py-1.5 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={initialLoading || refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {([
          { key: "free",     label: "Free",     dot: "bg-slate-500" },
          { key: "reserved", label: "Reserved", dot: "bg-amber-400" },
          { key: "occupied", label: "Occupied", dot: "bg-blue-400"  },
          { key: "done",     label: "Done",     dot: "bg-teal-400"  },
        ] as { key: TableState; label: string; dot: string }[]).map(({ key, label, dot }) => (
          <div key={key} className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full ${dot}`} />
              <span className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide">{label}</span>
            </div>
            <span className="text-white font-bold text-xl">{counts[key]}</span>
          </div>
        ))}
      </div>

      {/* Table grid */}
      {initialLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={28} className="animate-spin text-orange-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {visibleTables.map((t) => {
            const { state, res } = resolveState(t.id);
            const s = TABLE_STATE_STYLES[state];
            const busy = actioning === res?.id;

            return (
              <div key={t.id} className={`rounded-2xl border-2 p-3.5 flex flex-col gap-3 transition ${s.card} ${s.ring} ${t.isVip ? "ring-1 ring-amber-400/40" : ""}`}>

                {/* Table header */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      {t.isVip
                        ? <Crown size={13} className="text-amber-400" />
                        : <UtensilsCrossed size={13} className="text-orange-400" />}
                      <span className="font-bold text-white text-sm">{t.label}</span>
                      {t.isVip && (
                        <span className="text-[9px] font-bold uppercase tracking-wide text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded">VIP</span>
                      )}
                    </div>
                    <div className="text-slate-400 text-[11px] mt-0.5 flex items-center gap-2">
                      <span>{t.seats} seats</span>
                      {t.section && <span>· {t.section}</span>}
                      {t.isVip && <span className="text-amber-300">· {currencySymbol}{(t.vipPrice ?? 0).toFixed(2)}</span>}
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${s.badge}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${s.dot}`} />
                    {s.label}
                  </span>
                </div>

                {/* Reservation detail */}
                {res && (
                  <div className="bg-slate-900/60 rounded-xl px-3 py-2 space-y-0.5">
                    <p className="font-semibold text-white text-sm truncate">{res.customer_name}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1"><Clock size={10} /> {fmt12Pos(res.time)}</span>
                      <span className="flex items-center gap-1"><Users size={10} /> {res.party_size} guests</span>
                      {res.customer_phone && (
                        <span className="flex items-center gap-1"><Phone size={10} /> {res.customer_phone}</span>
                      )}
                    </div>
                    {res.checked_in_at && (
                      <p className="text-[11px] text-blue-400 flex items-center gap-1">
                        <LogIn size={10} /> In {fmtTsPos(res.checked_in_at)}
                      </p>
                    )}
                    {res.checked_out_at && (
                      <p className="text-[11px] text-teal-400 flex items-center gap-1">
                        <LogOut size={10} /> Out {fmtTsPos(res.checked_out_at)}
                      </p>
                    )}
                    {res.note && (
                      <p className="text-[11px] text-amber-400 italic truncate">&ldquo;{res.note}&rdquo;</p>
                    )}
                  </div>
                )}

                {/* Action button */}
                <div className="mt-auto">
                  {busy ? (
                    <div className="flex justify-center py-1">
                      <Loader2 size={16} className="animate-spin text-slate-400" />
                    </div>
                  ) : state === "reserved" && res ? (
                    <button
                      onClick={() => doAction(res.id, "checked_in")}
                      className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold py-2.5 rounded-xl transition-all"
                    >
                      <LogIn size={13} /> Check In
                    </button>
                  ) : state === "occupied" && res ? (
                    <button
                      onClick={() => doAction(res.id, "checked_out")}
                      className="w-full flex items-center justify-center gap-1.5 bg-teal-600 hover:bg-teal-500 active:scale-95 text-white text-xs font-bold py-2.5 rounded-xl transition-all"
                    >
                      <LogOut size={13} /> Check Out
                    </button>
                  ) : state === "free" ? (
                    <div className="flex items-center justify-center gap-1 text-slate-500 text-xs py-2">
                      <CheckCircle2 size={13} /> Available
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-1 text-teal-500 text-xs py-2">
                      <CheckCircle2 size={13} /> Freed
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {visibleTables.length === 0 && !initialLoading && (
        <div className="flex flex-col items-center py-20 gap-3 text-center">
          <UtensilsCrossed size={32} className="text-slate-600" />
          <p className="text-slate-400 font-semibold">No active tables configured</p>
          <p className="text-slate-500 text-sm">Add tables in Admin → Staff &amp; Tables.</p>
        </div>
      )}
    </div>
  );
}
