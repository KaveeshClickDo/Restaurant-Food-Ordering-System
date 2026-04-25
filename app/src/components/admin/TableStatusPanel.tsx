"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useApp }   from "@/context/AppContext";
import type { Reservation, ReservationStatus } from "@/types";
import {
  UtensilsCrossed, Users, Clock, LogIn, LogOut,
  Loader2, RefreshCw, CheckCircle2, CalendarDays,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type TableState = "free" | "reserved" | "occupied" | "done";

interface TableInfo {
  id: string;
  label: string;
  seats: number;
  section: string;
  state: TableState;
  reservation?: Reservation;  // current or next relevant reservation
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmt12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

function fmtTs(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const STATE_STYLES: Record<TableState, {
  card: string;
  badge: string;
  label: string;
  dot: string;
}> = {
  free:     { card: "bg-white border-gray-200",        badge: "bg-gray-100 text-gray-500",          label: "Free",     dot: "bg-gray-300"  },
  reserved: { card: "bg-amber-50 border-amber-300",    badge: "bg-amber-100 text-amber-700",        label: "Reserved", dot: "bg-amber-400" },
  occupied: { card: "bg-blue-50 border-blue-400",      badge: "bg-blue-100 text-blue-700",          label: "Occupied", dot: "bg-blue-500"  },
  done:     { card: "bg-teal-50 border-teal-300",      badge: "bg-teal-100 text-teal-700",          label: "Done",     dot: "bg-teal-500"  },
};

// ─── Table card ───────────────────────────────────────────────────────────────

function TableCard({
  table,
  onCheckIn,
  onCheckOut,
}: {
  table: TableInfo;
  onCheckIn:  (resId: string) => Promise<void>;
  onCheckOut: (resId: string) => Promise<void>;
}) {
  const [actioning, setActioning] = useState(false);
  const s = STATE_STYLES[table.state];
  const res = table.reservation;

  async function act(fn: () => Promise<void>) {
    setActioning(true);
    await fn();
    setActioning(false);
  }

  return (
    <div className={`rounded-2xl border-2 p-4 flex flex-col gap-3 transition ${s.card}`}>
      {/* Table header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <UtensilsCrossed size={14} className="text-orange-500" />
            <span className="font-bold text-gray-900 text-base">{table.label}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Users size={11} /> {table.seats} seats</span>
            {table.section && <span>{table.section}</span>}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${s.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>

      {/* Reservation detail */}
      {res && (
        <div className="bg-white/70 rounded-xl px-3 py-2 space-y-1">
          <p className="font-semibold text-gray-800 text-sm truncate">{res.customerName}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Clock size={10} /> {fmt12(res.time)}</span>
            <span className="flex items-center gap-1"><Users size={10} /> {res.partySize} guests</span>
            {res.checkedInAt && (
              <span className="flex items-center gap-1 text-blue-600">
                <LogIn size={10} /> in {fmtTs(res.checkedInAt)}
              </span>
            )}
            {res.checkedOutAt && (
              <span className="flex items-center gap-1 text-teal-600">
                <LogOut size={10} /> out {fmtTs(res.checkedOutAt)}
              </span>
            )}
          </div>
          {res.note && (
            <p className="text-xs text-amber-700 italic truncate">&ldquo;{res.note}&rdquo;</p>
          )}
        </div>
      )}

      {/* Quick actions */}
      {actioning ? (
        <div className="flex justify-center py-1">
          <Loader2 size={16} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="flex gap-2">
          {table.state === "reserved" && res && (
            <button
              onClick={() => act(() => onCheckIn(res.id))}
              className="flex-1 flex items-center justify-center gap-1.5 bg-blue-500 hover:bg-blue-600 active:scale-95 text-white text-xs font-semibold py-2 rounded-xl transition-all"
            >
              <LogIn size={13} /> Check In
            </button>
          )}
          {table.state === "occupied" && res && (
            <button
              onClick={() => act(() => onCheckOut(res.id))}
              className="flex-1 flex items-center justify-center gap-1.5 bg-teal-500 hover:bg-teal-600 active:scale-95 text-white text-xs font-semibold py-2 rounded-xl transition-all"
            >
              <LogOut size={13} /> Check Out
            </button>
          )}
          {table.state === "free" && (
            <div className="flex-1 flex items-center justify-center gap-1.5 text-gray-400 text-xs py-2">
              <CheckCircle2 size={13} /> Available
            </div>
          )}
          {table.state === "done" && (
            <div className="flex-1 flex items-center justify-center gap-1.5 text-teal-600 text-xs py-2">
              <CheckCircle2 size={13} /> Freed
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function TableStatusPanel() {
  const { settings } = useApp();
  const tables = (settings.diningTables ?? []).filter((t) => t.active);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [filterSection,setFilterSection]= useState("");

  const sections = [...new Set(tables.map((t) => t.section).filter(Boolean))];

  const fetchToday = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: todayStr(), to: todayStr() });
      const res  = await fetch(`/api/admin/reservations?${params}`);
      const json = await res.json() as { ok: boolean; reservations?: Reservation[] };
      if (json.ok) setReservations(json.reservations ?? []);
    } catch (err) {
      console.error("TableStatusPanel fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  useEffect(() => {
    const ch = supabase
      .channel("table-status-panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, fetchToday)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchToday]);

  async function handleCheckIn(resId: string) {
    await fetch(`/api/admin/reservations/${resId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "checked_in" }),
    });
    setReservations((prev) =>
      prev.map((r) => r.id === resId ? { ...r, status: "checked_in", checkedInAt: new Date().toISOString() } : r)
    );
  }

  async function handleCheckOut(resId: string) {
    await fetch(`/api/admin/reservations/${resId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "checked_out" }),
    });
    setReservations((prev) =>
      prev.map((r) => r.id === resId ? { ...r, status: "checked_out", checkedOutAt: new Date().toISOString() } : r)
    );
  }

  // Build table state from today's reservations
  function resolveTableInfo(tableId: string): Pick<TableInfo, "state" | "reservation"> {
    // Priority: occupied > reserved > done > free
    const occupied = reservations.find((r) => r.tableId === tableId && r.status === "checked_in");
    if (occupied) return { state: "occupied", reservation: occupied };

    const reserved = reservations.find(
      (r) => r.tableId === tableId && (r.status === "pending" || r.status === "confirmed")
    );
    if (reserved) return { state: "reserved", reservation: reserved };

    const done = reservations.find((r) => r.tableId === tableId && r.status === "checked_out");
    if (done) return { state: "done", reservation: done };

    return { state: "free" };
  }

  const tableInfoList: TableInfo[] = tables
    .filter((t) => !filterSection || t.section === filterSection)
    .map((t) => ({
      id:      t.id,
      label:   t.label,
      seats:   t.seats,
      section: t.section,
      ...resolveTableInfo(t.id),
    }));

  const counts = {
    free:     tableInfoList.filter((t) => t.state === "free").length,
    reserved: tableInfoList.filter((t) => t.state === "reserved").length,
    occupied: tableInfoList.filter((t) => t.state === "occupied").length,
    done:     tableInfoList.filter((t) => t.state === "done").length,
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-4 flex items-center gap-4">
        <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <UtensilsCrossed size={20} className="text-orange-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-gray-900">Table Status</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Live occupancy for today · {counts.occupied} occupied · {counts.reserved} reserved · {counts.free} free
          </p>
        </div>
        <button
          onClick={fetchToday}
          disabled={loading}
          className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Free",     value: counts.free,     bg: "bg-gray-50",   border: "border-gray-200",  text: "text-gray-800"  },
          { label: "Reserved", value: counts.reserved, bg: "bg-amber-50",  border: "border-amber-200", text: "text-amber-700" },
          { label: "Occupied", value: counts.occupied, bg: "bg-blue-50",   border: "border-blue-200",  text: "text-blue-700"  },
          { label: "Done",     value: counts.done,     bg: "bg-teal-50",   border: "border-teal-200",  text: "text-teal-700"  },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3.5`}>
            <div className={`text-2xl font-bold ${s.text}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Legend + section filter */}
      <div className="flex items-center gap-3 flex-wrap">
        {(["free", "reserved", "occupied", "done"] as TableState[]).map((st) => (
          <span key={st} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`w-2 h-2 rounded-full ${STATE_STYLES[st].dot}`} />
            {STATE_STYLES[st].label}
          </span>
        ))}
        {sections.length > 1 && (
          <select
            value={filterSection}
            onChange={(e) => setFilterSection(e.target.value)}
            className="ml-auto border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-orange-400 transition"
          >
            <option value="">All sections</option>
            {sections.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* Table grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-orange-500" />
        </div>
      ) : tableInfoList.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 bg-white rounded-2xl border border-gray-200">
          <CalendarDays size={32} className="text-gray-300" />
          <p className="font-semibold text-gray-600">No active tables configured</p>
          <p className="text-sm text-gray-400">Add tables in Staff &amp; Tables → Dining Tables.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {tableInfoList.map((t) => (
            <TableCard
              key={t.id}
              table={t}
              onCheckIn={handleCheckIn}
              onCheckOut={handleCheckOut}
            />
          ))}
        </div>
      )}
    </div>
  );
}
