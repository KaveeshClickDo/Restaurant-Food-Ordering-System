"use client";

import { useState, useEffect, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";
import {
  AlertTriangle, Calendar, CalendarDays, CheckCircle2, Clock, Loader2,
  LogIn, LogOut, RefreshCw, Search, UserPlus, Users, UtensilsCrossed, X,
} from "lucide-react";
import { type ResRow, fmt12Pos, fmtTsPos } from "./_reservations";

// ─── Reservations View (POS) ──────────────────────────────────────────────────

const RES_STATUS_CFG: Record<string, { label: string; dot: string; badge: string }> = {
  pending:     { label: "Pending",     dot: "bg-amber-400",  badge: "bg-amber-900/50 text-amber-300 border-amber-600/50"  },
  confirmed:   { label: "Confirmed",   dot: "bg-green-400",  badge: "bg-green-900/50 text-green-300 border-green-600/50"  },
  checked_in:  { label: "Dining",      dot: "bg-blue-400",   badge: "bg-blue-900/50  text-blue-300  border-blue-600/50"   },
  checked_out: { label: "Done",        dot: "bg-teal-400",   badge: "bg-teal-900/50  text-teal-300  border-teal-600/50"   },
  cancelled:   { label: "Cancelled",   dot: "bg-red-400",    badge: "bg-red-900/50   text-red-300   border-red-600/50"    },
  no_show:     { label: "No show",     dot: "bg-slate-500",  badge: "bg-slate-700    text-slate-400 border-slate-600"     },
};

const SOURCE_CFG: Record<string, { label: string; cls: string }> = {
  online:    { label: "Online",   cls: "bg-blue-900/50 text-blue-300 border-blue-700/50"     },
  "walk-in": { label: "Walk-in",  cls: "bg-green-900/50 text-green-300 border-green-700/50"  },
  phone:     { label: "Phone",    cls: "bg-purple-900/50 text-purple-300 border-purple-700/50"},
  other:     { label: "Other",    cls: "bg-slate-700 text-slate-400 border-slate-600"         },
};

// Local-date helpers (not UTC-based)
function localTodayStrRes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localMaxDateStrRes(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nowLocalMinsRes(): number { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
function toMinsRes(t: string): number { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function isSlotPastRes(slot: string, date: string): boolean {
  return date === localTodayStrRes() && toMinsRes(slot) <= nowLocalMinsRes();
}
function generateSlotsRes(open: string, close: string, interval: number): string[] {
  const slots: string[] = [];
  for (let t = toMinsRes(open); t < toMinsRes(close); t += interval) {
    slots.push(`${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`);
  }
  return slots;
}
function isNoShowCandidate(r: ResRow & { source?: string }): boolean {
  if (r.status !== "confirmed") return false;
  return new Date(`${r.date}T${r.time}`).getTime() < Date.now() - 30 * 60 * 1000;
}

type ResRowEx = ResRow & { source?: string };

interface AvailTablePos { id: string; label: string; seats: number; section: string; }

export default function ReservationsView() {
  const { settings: appSettings } = useApp();
  const rs = appSettings.reservationSystem ?? {};
  const allSlots = generateSlotsRes(rs.openTime ?? "12:00", rs.closeTime ?? "22:00", rs.slotIntervalMinutes ?? 30);
  const activeTables = (appSettings.diningTables ?? []).filter((t) => t.active);

  const [rows,         setRows]         = useState<ResRowEx[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [actioning,    setActioning]    = useState<string | null>(null);
  const [filterDate,   setFilterDate]   = useState(localTodayStrRes);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [search,       setSearch]       = useState("");

  // ── Add walk-in/phone modal state ─────────────────────────────────────────
  const [showAdd,        setShowAdd]        = useState(false);
  const [addSource,      setAddSource]      = useState<"walk-in" | "phone">("walk-in");
  const [addDate,        setAddDate]        = useState(localTodayStrRes);
  const [addParty,       setAddParty]       = useState(2);
  const [addTime,        setAddTime]        = useState(() => {
    const first = generateSlotsRes(rs.openTime ?? "12:00", rs.closeTime ?? "22:00", rs.slotIntervalMinutes ?? 30)
      .find((s) => !isSlotPastRes(s, localTodayStrRes()));
    return first ?? "";
  });
  const [addTableId,     setAddTableId]     = useState("");
  const [addTableMeta,   setAddTableMeta]   = useState<AvailTablePos | null>(null);
  const [addAvailTables, setAddAvailTables] = useState<AvailTablePos[]>([]);
  const [addBookedIds,   setAddBookedIds]   = useState<Set<string>>(new Set());
  const [addLoadingTbl,  setAddLoadingTbl]  = useState(false);
  const [addName,        setAddName]        = useState("");
  const [addEmail,       setAddEmail]       = useState("");
  const [addPhone,       setAddPhone]       = useState("");
  const [addNote,        setAddNote]        = useState("");
  const [addSaving,      setAddSaving]      = useState(false);
  const [addError,       setAddError]       = useState("");

  // Fetch available tables + currently-booked table IDs for the add modal.
  // Phone bookings only see availableTables; walk-ins use bookedTableIds to
  // grey out occupied tables while still showing every active table.
  const fetchAddTables = useCallback(async (date: string, time: string, party: number) => {
    if (!date || !time || !party) return;
    setAddLoadingTbl(true);
    try {
      const res  = await fetch(`/api/reservations/availability?date=${date}&time=${time}&partySize=${party}`);
      const json = await res.json() as { ok: boolean; availableTables?: AvailTablePos[]; bookedTableIds?: string[] };
      setAddAvailTables(json.ok ? (json.availableTables ?? []) : []);
      setAddBookedIds(new Set(json.ok ? (json.bookedTableIds ?? []) : []));
    } catch {
      setAddAvailTables([]);
      setAddBookedIds(new Set());
    } finally { setAddLoadingTbl(false); }
  }, []);

  // Re-fetch tables when date/time/party changes in modal
  useEffect(() => {
    if (!showAdd) return;
    setAddTableId(""); setAddTableMeta(null);
    setAddBookedIds(new Set());
    if (addTime && !isSlotPastRes(addTime, addDate)) fetchAddTables(addDate, addTime, addParty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addDate, addTime, addParty, showAdd]);

  // Auto-advance time when date changes to today
  useEffect(() => {
    if (isSlotPastRes(addTime, addDate)) {
      const first = allSlots.find((s) => !isSlotPastRes(s, addDate));
      if (first) setAddTime(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addDate]);

  function openAddModal() {
    const today = localTodayStrRes();
    const firstSlot = allSlots.find((s) => !isSlotPastRes(s, today)) ?? allSlots[0] ?? "";
    setAddSource("walk-in"); setAddDate(today); setAddTime(firstSlot);
    setAddParty(2); setAddTableId(""); setAddTableMeta(null); setAddAvailTables([]);
    setAddBookedIds(new Set());
    setAddName(""); setAddEmail(""); setAddPhone(""); setAddNote("");
    setAddError(""); setAddSaving(false); setShowAdd(true);
  }

  async function handleAddBooking() {
    if (!addTableMeta || !addName.trim()) return;
    // Soft-warn: party exceeds table capacity. Staff often pulls extra chairs
    // or merges tables, so we allow override after explicit confirmation.
    if (addTableMeta.seats < addParty) {
      const ok = window.confirm(
        `Table ${addTableMeta.label} seats ${addTableMeta.seats}, but the party is ${addParty}. ` +
        `You'll need extra chairs or a combined table. Continue?`
      );
      if (!ok) return;
    }
    setAddSaving(true); setAddError("");
    try {
      const res  = await fetch("/api/pos/reservations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: addTableMeta.id, tableLabel: addTableMeta.label,
          tableSeats: addTableMeta.seats, section: addTableMeta.section,
          date: addDate, time: addTime, partySize: addParty,
          customerName: addName.trim(), customerEmail: addEmail.trim(),
          customerPhone: addPhone.trim(), note: addNote.trim(), source: addSource,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) { setShowAdd(false); fetchRows(); }
      else setAddError(json.error ?? "Failed to create booking.");
    } catch { setAddError("Network error — please try again."); }
    finally { setAddSaving(false); }
  }

  // ── Main list ──────────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      // Column sets in descending order of preference.
      // Each entry is tried in turn; we fall back if a column doesn't exist yet.
      const COLUMN_SETS = [
        "id,table_id,table_label,section,customer_name,customer_email,customer_phone,date,time,party_size,status,note,source,checked_in_at,checked_out_at",
        "id,table_id,table_label,section,customer_name,customer_email,customer_phone,date,time,party_size,status,note,checked_in_at,checked_out_at",
        "id,table_id,table_label,section,customer_name,customer_email,customer_phone,date,time,party_size,status,note",
      ];

      let data = null;
      for (const cols of COLUMN_SETS) {
        let q = supabase
          .from("reservations")
          .select(cols)
          .eq("date", filterDate)
          .order("time", { ascending: true });
        if (filterStatus) q = q.eq("status", filterStatus);
        // Only filter by source when the column set includes it
        if (filterSource && cols.includes("source")) q = q.eq("source", filterSource);

        const { data: d, error: e } = await q;
        if (!e) { data = d; break; }
        // Any error other than a missing-column schema error is terminal
        if (!e.message?.includes("does not exist") && !e.message?.includes("schema cache")) {
          console.error("ReservationsView fetch:", e.message);
          break;
        }
      }

      setRows((data ?? []) as unknown as ResRowEx[]);
    } catch (err) {
      console.error("ReservationsView fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [filterDate, filterStatus, filterSource]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    const ch = supabase
      .channel("pos-reservations-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, fetchRows)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchRows]);

  async function doStatus(resId: string, status: string) {
    setActioning(resId);
    await fetch(`/api/pos/reservations/${resId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const now = new Date().toISOString();
    setRows((prev) => prev.map((r) => r.id !== resId ? r : {
      ...r, status,
      ...(status === "checked_in"  ? { checked_in_at:  now } : {}),
      ...(status === "checked_out" ? { checked_out_at: now } : {}),
    }));
    setActioning(null);
  }

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.customer_name.toLowerCase().includes(q) ||
           r.customer_email.toLowerCase().includes(q) ||
           r.table_label.toLowerCase().includes(q);
  });

  const stats = {
    total:     rows.length,
    pending:   rows.filter((r) => r.status === "pending").length,
    confirmed: rows.filter((r) => r.status === "confirmed").length,
    dining:    rows.filter((r) => r.status === "checked_in").length,
    done:      rows.filter((r) => r.status === "checked_out").length,
    cancelled: rows.filter((r) => r.status === "cancelled" || r.status === "no_show").length,
  };

  const fmtDateShort = (d: string) => {
    const [y, mo, day] = d.split("-").map(Number);
    return new Date(y, mo - 1, day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };

  // Tables grouped by section for the add modal selector
  const tablesBySection = activeTables.reduce<Record<string, typeof activeTables>>((acc, t) => {
    (acc[t.section || "Other"] = acc[t.section || "Other"] ?? []).push(t); return acc;
  }, {});

  const addSlotsForDate = allSlots; // full list; UI disables past ones

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-white font-bold text-lg">Reservations</h2>
          <p className="text-slate-400 text-xs mt-0.5">{fmtDateShort(filterDate)} · {rows.length} booking{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
          >
            <UserPlus size={13} /> Add Walk-in
          </button>
          <button
            onClick={fetchRows}
            disabled={loading}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl px-3 py-2 text-slate-300 text-xs font-medium transition"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { label: "Total",     value: stats.total,     cls: "text-slate-300" },
          { label: "Pending",   value: stats.pending,   cls: "text-amber-400" },
          { label: "Confirmed", value: stats.confirmed, cls: "text-green-400" },
          { label: "Dining",    value: stats.dining,    cls: "text-blue-400"  },
          { label: "Done",      value: stats.done,      cls: "text-teal-400"  },
          { label: "Cancelled", value: stats.cancelled, cls: "text-red-400"   },
        ].map((s) => (
          <div key={s.label} className="bg-slate-800/60 border border-slate-700 rounded-xl p-3">
            <div className={`text-xl font-bold ${s.cls}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2">
          <Calendar size={13} className="text-orange-400 flex-shrink-0" />
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="bg-transparent text-slate-200 text-sm focus:outline-none"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="checked_in">Dining</option>
          <option value="checked_out">Done</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No show</option>
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none"
        >
          <option value="">All sources</option>
          <option value="online">Online</option>
          <option value="walk-in">Walk-in</option>
          <option value="phone">Phone</option>
          <option value="other">Other</option>
        </select>
        <div className="flex items-center gap-2 flex-1 min-w-[160px] bg-slate-800 border border-slate-700 rounded-xl px-3 py-2">
          <Search size={13} className="text-slate-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Name, email, table…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-slate-200 text-sm focus:outline-none placeholder-slate-500"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-orange-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 bg-slate-800/40 rounded-2xl border border-slate-700">
          <CalendarDays size={32} className="text-slate-600" />
          <p className="text-slate-400 font-semibold">No reservations found</p>
          <p className="text-slate-500 text-sm">{search ? "Try a different search." : "No bookings for this date / filter."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const cfg    = RES_STATUS_CFG[r.status] ?? RES_STATUS_CFG.pending;
            const srcCfg = SOURCE_CFG[r.source ?? "online"] ?? SOURCE_CFG.other;
            const busy   = actioning === r.id;
            const noShow = isNoShowCandidate(r);
            return (
              <div
                key={r.id}
                className={`border rounded-xl p-4 transition ${
                  noShow        ? "bg-amber-950/40 border-amber-500/50" :
                  r.status === "checked_in" ? "bg-slate-800/70 border-blue-500/50" :
                  "bg-slate-800/70 border-slate-700"
                }`}
              >
                {/* No-show warning */}
                {noShow && (
                  <div className="flex items-center gap-2 bg-amber-900/40 border border-amber-600/50 rounded-lg px-3 py-2 mb-3 text-amber-300 text-xs font-semibold">
                    <AlertTriangle size={13} className="flex-shrink-0" />
                    Guest may not have shown — reservation time has passed
                  </div>
                )}

                <div className="flex items-start justify-between gap-3 flex-wrap">
                  {/* Left */}
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Status + source + ref + timestamps */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                      {r.source && (
                        <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border ${srcCfg.cls}`}>
                          {srcCfg.label}
                        </span>
                      )}
                      <span className="text-slate-500 text-xs font-mono">{r.id.slice(0, 8).toUpperCase()}</span>
                      {r.checked_in_at && (
                        <span className="text-blue-400 text-xs flex items-center gap-1">
                          <LogIn size={11} /> {fmtTsPos(r.checked_in_at)}
                        </span>
                      )}
                      {r.checked_out_at && (
                        <span className="text-teal-400 text-xs flex items-center gap-1">
                          <LogOut size={11} /> {fmtTsPos(r.checked_out_at)}
                        </span>
                      )}
                    </div>
                    {/* Time / party / table */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
                      <span className="flex items-center gap-1.5"><Clock size={13} className="text-orange-400" />{fmt12Pos(r.time)}</span>
                      <span className="flex items-center gap-1.5"><Users size={13} className="text-orange-400" />{r.party_size} {r.party_size === 1 ? "guest" : "guests"}</span>
                      <span className="flex items-center gap-1.5"><UtensilsCrossed size={13} className="text-orange-400" />{r.table_label}{r.section ? <span className="text-slate-500"> · {r.section}</span> : null}</span>
                    </div>
                    {/* Customer */}
                    <div className="space-y-0.5">
                      <div className="text-white font-semibold text-sm">{r.customer_name}</div>
                      {r.customer_email && <div className="text-slate-400 text-xs">{r.customer_email}</div>}
                      {r.customer_phone && <div className="text-slate-400 text-xs">{r.customer_phone}</div>}
                    </div>
                    {r.note && (
                      <div className="bg-amber-900/30 border border-amber-700/40 rounded-lg px-2.5 py-1.5 text-amber-300 text-xs italic">
                        &ldquo;{r.note}&rdquo;
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {busy ? (
                      <Loader2 size={16} className="animate-spin text-slate-400 mx-auto" />
                    ) : (
                      <>
                        {r.status === "pending" && (
                          <button
                            onClick={() => doStatus(r.id, "confirmed")}
                            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <CheckCircle2 size={13} /> Confirm
                          </button>
                        )}
                        {(r.status === "confirmed" || noShow) && r.status !== "checked_in" && (
                          <button
                            onClick={() => doStatus(r.id, "checked_in")}
                            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <LogIn size={13} /> Check In
                          </button>
                        )}
                        {r.status === "checked_in" && (
                          <button
                            onClick={() => doStatus(r.id, "checked_out")}
                            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <LogOut size={13} /> Check Out
                          </button>
                        )}
                        {noShow && r.status === "confirmed" && (
                          <button
                            onClick={() => doStatus(r.id, "no_show")}
                            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 active:scale-95 text-slate-400 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <AlertTriangle size={13} /> No Show
                          </button>
                        )}
                        {(r.status === "pending" || r.status === "confirmed" || r.status === "checked_in") && (
                          <button
                            onClick={() => doStatus(r.id, "cancelled")}
                            className="flex items-center gap-1.5 bg-slate-700 hover:bg-red-900/60 border border-slate-600 hover:border-red-700/60 active:scale-95 text-slate-400 hover:text-red-400 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <X size={13} /> Cancel
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Walk-in / Phone Booking Modal ─────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative w-full sm:max-w-lg bg-slate-900 border border-slate-700 sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
              <div>
                <h3 className="text-white font-bold text-base">Add Booking</h3>
                <p className="text-slate-400 text-xs mt-0.5">Walk-in or phone reservation</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-700 hover:text-white transition">
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-5">

              {/* Source toggle */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Source</p>
                <div className="flex gap-2">
                  {(["walk-in", "phone"] as const).map((src) => (
                    <button key={src} type="button" onClick={() => setAddSource(src)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                        addSource === src
                          ? "bg-orange-500 border-orange-500 text-white"
                          : "bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500"
                      }`}>
                      {src === "walk-in" ? "Walk-in" : "Phone booking"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date + party */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Date</label>
                  <input type="date" value={addDate} min={localTodayStrRes()} max={localMaxDateStrRes(rs.maxAdvanceDays ?? 30)}
                    onChange={(e) => setAddDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Guests</label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setAddParty((p) => Math.max(1, p - 1))}
                      className="w-9 h-9 rounded-full border border-slate-600 text-slate-400 hover:border-orange-500 hover:text-orange-400 font-bold transition flex items-center justify-center">−</button>
                    <span className="text-white font-bold text-lg w-6 text-center">{addParty}</span>
                    <button type="button" onClick={() => setAddParty((p) => Math.min(20, p + 1))}
                      className="w-9 h-9 rounded-full border border-slate-600 text-slate-400 hover:border-orange-500 hover:text-orange-400 font-bold transition flex items-center justify-center">+</button>
                  </div>
                </div>
              </div>

              {/* Time slots */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Time</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {addSlotsForDate.map((slot) => {
                    const past     = isSlotPastRes(slot, addDate);
                    const selected = addTime === slot;
                    return (
                      <button key={slot} type="button" disabled={past}
                        onClick={() => !past && setAddTime(slot)}
                        title={past ? "Time has passed" : undefined}
                        className={`py-2 rounded-lg text-xs font-semibold border transition-all ${
                          past
                            ? "bg-slate-900 text-slate-700 border-slate-800 cursor-not-allowed line-through"
                            : selected
                              ? "bg-orange-500 text-white border-orange-500"
                              : "bg-slate-800 text-slate-300 border-slate-700 hover:border-orange-500 hover:text-orange-300"
                        }`}>{fmt12Pos(slot)}</button>
                    );
                  })}
                </div>
                {addSlotsForDate.every((s) => isSlotPastRes(s, addDate)) && (
                  <p className="text-xs text-amber-400 mt-2">All slots for today have passed — select a future date.</p>
                )}
              </div>

              {/* Table selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Table
                  {addSource === "walk-in" && <span className="text-slate-500 font-normal normal-case ml-1">(select from all active tables)</span>}
                </label>
                {addSource === "walk-in" ? (
                  /* Walk-ins: pick any active table, but disable already-reserved
                     ones (hard block) and warn on undersized ones (soft block —
                     staff can still pick if they're combining tables / adding chairs). */
                  addLoadingTbl ? (
                    <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                      <Loader2 size={14} className="animate-spin text-orange-500" /> Checking table status…
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(tablesBySection).map(([sec, tbls]) => (
                        <div key={sec}>
                          {sec && <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{sec}</p>}
                          <div className="grid grid-cols-4 gap-1.5">
                            {tbls.map((t) => {
                              const sel          = addTableId === t.id;
                              const isBooked     = addBookedIds.has(t.id);
                              const isUndersized = t.seats < addParty;
                              const baseCls      = "py-2 rounded-lg text-[11px] font-semibold border transition-all flex flex-col items-center leading-tight";
                              const cls = isBooked
                                ? `${baseCls} bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed line-through`
                                : sel
                                  ? isUndersized
                                    ? `${baseCls} bg-amber-500 text-white border-amber-400`
                                    : `${baseCls} bg-orange-500 text-white border-orange-500`
                                  : isUndersized
                                    ? `${baseCls} bg-amber-900/30 text-amber-300 border-amber-700/50 hover:border-amber-500`
                                    : `${baseCls} bg-slate-800 text-slate-300 border-slate-700 hover:border-orange-500 hover:text-orange-300`;
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  disabled={isBooked}
                                  title={
                                    isBooked     ? "Already reserved at this time" :
                                    isUndersized ? `Seats ${t.seats} — party of ${addParty} (will need extra chairs)` :
                                    `Seats ${t.seats}`
                                  }
                                  onClick={() => { setAddTableId(t.id); setAddTableMeta({ id: t.id, label: t.label, seats: t.seats, section: t.section }); }}
                                  className={cls}
                                >
                                  <span>{t.label}</span>
                                  <span className="text-[9px] font-normal opacity-75">
                                    {isBooked ? "reserved" : `seats ${t.seats}`}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {/* Legend */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[10px] text-slate-500">
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-slate-800 border border-slate-700" /> free
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-amber-900/40 border border-amber-700/50" /> too small (warn)
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-slate-900 border border-slate-800" /> reserved (blocked)
                        </span>
                      </div>
                    </div>
                  )
                ) : addLoadingTbl ? (
                  <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                    <Loader2 size={14} className="animate-spin text-orange-500" /> Checking availability…
                  </div>
                ) : addAvailTables.length === 0 ? (
                  <p className="text-slate-500 text-sm py-2">No available tables for this slot — try a different time.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {addAvailTables.map((t) => {
                      const sel = addTableId === t.id;
                      return (
                        <button key={t.id} type="button"
                          onClick={() => { setAddTableId(t.id); setAddTableMeta(t); }}
                          className={`py-2 rounded-lg text-xs font-semibold border transition-all ${
                            sel ? "bg-orange-500 text-white border-orange-500" : "bg-slate-800 text-slate-300 border-slate-700 hover:border-orange-500 hover:text-orange-300"
                          }`}>{t.label}</button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Guest details */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Guest details</p>
                <input type="text" placeholder="Full name *" value={addName} onChange={(e) => setAddName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500 transition" />
                <input type="email" placeholder="Email (optional)" value={addEmail} onChange={(e) => setAddEmail(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500 transition" />
                <input type="tel" placeholder="Phone (optional)" value={addPhone} onChange={(e) => setAddPhone(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500 transition" />
                <textarea rows={2} placeholder="Notes (optional)" value={addNote} onChange={(e) => setAddNote(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-200 text-sm placeholder-slate-500 resize-none focus:outline-none focus:border-orange-500 transition" />
              </div>

              {addError && (
                <div className="flex items-start gap-2 bg-red-900/40 border border-red-700/50 rounded-xl p-3 text-sm text-red-300">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />{addError}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-700 flex-shrink-0">
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-200 text-sm font-semibold transition">Cancel</button>
              <button
                onClick={handleAddBooking}
                disabled={addSaving || !addName.trim() || !addTableMeta || isSlotPastRes(addTime, addDate)}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              >
                {addSaving ? <><Loader2 size={14} className="animate-spin" />Saving…</> :
                 addSource === "walk-in" ? <><LogIn size={14} />Check In Now</> : <><CheckCircle2 size={14} />Create Booking</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
