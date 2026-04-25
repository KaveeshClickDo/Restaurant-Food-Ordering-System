"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useApp }   from "@/context/AppContext";
import type { Reservation, ReservationStatus } from "@/types";
import {
  CalendarDays, Clock, Users, UtensilsCrossed, CheckCircle2, XCircle,
  AlertTriangle, Trash2, RefreshCw, MapPin, ChevronDown, Loader2,
  ToggleLeft, ToggleRight, Settings2, Search, Mail, Phone,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${period}`;
}

function fmtDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_CONFIG: Record<ReservationStatus, { label: string; dotClass: string; badgeClass: string }> = {
  pending:   { label: "Pending",   dotClass: "bg-amber-400",  badgeClass: "bg-amber-50  text-amber-700  border-amber-200"  },
  confirmed: { label: "Confirmed", dotClass: "bg-green-500",  badgeClass: "bg-green-50  text-green-700  border-green-200"  },
  cancelled: { label: "Cancelled", dotClass: "bg-red-400",    badgeClass: "bg-red-50    text-red-700    border-red-200"    },
  no_show:   { label: "No show",   dotClass: "bg-gray-400",   badgeClass: "bg-gray-100  text-gray-600   border-gray-300"   },
};

// ─── Settings form ────────────────────────────────────────────────────────────

function ReservationSettings() {
  const { settings, updateSettings } = useApp();
  const rs = settings.reservationSystem;
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  const [form, setForm] = useState({
    slotDurationMinutes: rs.slotDurationMinutes,
    maxAdvanceDays:      rs.maxAdvanceDays,
    openTime:            rs.openTime,
    closeTime:           rs.closeTime,
    slotIntervalMinutes: rs.slotIntervalMinutes,
  });

  async function save() {
    setSaving(true);
    updateSettings({ reservationSystem: { ...rs, ...form } });
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const field = (label: string, node: React.ReactNode) => (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      {node}
    </div>
  );

  const numInput = (key: keyof typeof form, min: number, max: number) => (
    <input
      type="number" min={min} max={max}
      value={form[key] as number}
      onChange={(e) => setForm((p) => ({ ...p, [key]: parseInt(e.target.value, 10) || min }))}
      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
    />
  );

  const timeInput = (key: "openTime" | "closeTime") => (
    <input
      type="time"
      value={form[key]}
      onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
    />
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Settings2 size={15} className="text-orange-500" />
        <h3 className="text-sm font-bold text-gray-800">Booking Settings</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {field("Opening time",           timeInput("openTime"))}
        {field("Closing time",           timeInput("closeTime"))}
        {field("Slot interval (min)",    numInput("slotIntervalMinutes", 15, 120))}
        {field("Slot duration (min)",    numInput("slotDurationMinutes", 30, 360))}
        {field("Max advance (days)",     numInput("maxAdvanceDays", 1, 365))}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-xl transition"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
        </button>
        <p className="text-xs text-gray-400">Changes apply to new bookings immediately.</p>
      </div>
    </div>
  );
}

// ─── Reservation card ─────────────────────────────────────────────────────────

function ReservationCard({
  res,
  onStatusChange,
  onDelete,
}: {
  res: Reservation;
  onStatusChange: (id: string, status: ReservationStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const cfg = STATUS_CONFIG[res.status];
  const [actioning, setActioning] = useState(false);
  const [menuOpen,  setMenuOpen]  = useState(false);

  async function doAction(fn: () => Promise<void>) {
    setActioning(true);
    setMenuOpen(false);
    await fn();
    setActioning(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition">
      <div className="flex items-start justify-between gap-3">
        {/* Left info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.badgeClass}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
              {cfg.label}
            </span>
            <span className="text-xs text-gray-400 font-mono">{res.id.slice(0, 8).toUpperCase()}</span>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700">
            <span className="flex items-center gap-1.5 font-semibold">
              <CalendarDays size={13} className="text-orange-500" />
              {fmtDate(res.date)}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock size={13} className="text-orange-500" />
              {fmt12(res.time)}
            </span>
            <span className="flex items-center gap-1.5">
              <Users size={13} className="text-orange-500" />
              {res.partySize} {res.partySize === 1 ? "guest" : "guests"}
            </span>
            <span className="flex items-center gap-1.5">
              <UtensilsCrossed size={13} className="text-orange-500" />
              {res.tableLabel}
              {res.section ? <span className="text-gray-400">· {res.section}</span> : null}
            </span>
          </div>

          <div className="mt-2 space-y-0.5 text-xs text-gray-500">
            <div className="font-semibold text-gray-700 text-sm">{res.customerName}</div>
            <div className="flex items-center gap-1.5">
              <Mail size={11} />
              <a href={`mailto:${res.customerEmail}`} className="hover:text-orange-600 transition">{res.customerEmail}</a>
            </div>
            {res.customerPhone && (
              <div className="flex items-center gap-1.5">
                <Phone size={11} />
                {res.customerPhone}
              </div>
            )}
            {res.note && (
              <div className="mt-1 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 text-amber-800 text-xs italic">
                "{res.note}"
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {actioning ? (
            <Loader2 size={16} className="animate-spin text-gray-400" />
          ) : (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:border-gray-300 transition"
              >
                Actions <ChevronDown size={12} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-8 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[160px]">
                    {res.status === "pending" && (
                      <button
                        onClick={() => doAction(() => onStatusChange(res.id, "confirmed"))}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-green-700 hover:bg-green-50 transition"
                      >
                        <CheckCircle2 size={14} />
                        Confirm
                      </button>
                    )}
                    {res.status === "confirmed" && (
                      <button
                        onClick={() => doAction(() => onStatusChange(res.id, "no_show"))}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition"
                      >
                        <AlertTriangle size={14} />
                        Mark no-show
                      </button>
                    )}
                    {(res.status === "pending" || res.status === "confirmed") && (
                      <button
                        onClick={() => doAction(() => onStatusChange(res.id, "cancelled"))}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                      >
                        <XCircle size={14} />
                        Cancel
                      </button>
                    )}
                    <div className="border-t border-gray-100 my-1" />
                    <button
                      onClick={() => doAction(() => onDelete(res.id))}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ReservationsPanel() {
  const { settings, updateSettings } = useApp();
  const rs = settings.reservationSystem;

  const [reservations,    setReservations]    = useState<Reservation[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [filterDate,      setFilterDate]      = useState(todayStr());
  const [filterStatus,    setFilterStatus]    = useState<"" | ReservationStatus>("");
  const [search,          setSearch]          = useState("");
  const [showSettings,    setShowSettings]    = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  // ── Fetch reservations ─────────────────────────────────────────────────────
  const fetchReservations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterDate) params.set("from", filterDate);
      if (filterStatus) params.set("status", filterStatus);
      const res  = await fetch(`/api/admin/reservations?${params}`);
      const json = await res.json() as { ok: boolean; reservations?: unknown[]; error?: string };
      if (json.ok) setReservations((json.reservations ?? []) as Reservation[]);
    } catch (err) {
      console.error("ReservationsPanel fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [filterDate, filterStatus]);

  useEffect(() => { fetchReservations(); }, [fetchReservations]);

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("reservations-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, () => {
        fetchReservations();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchReservations]);

  // ── Toggle enabled ─────────────────────────────────────────────────────────
  async function toggleEnabled() {
    setTogglingEnabled(true);
    updateSettings({ reservationSystem: { ...rs, enabled: !rs.enabled } });
    await new Promise((r) => setTimeout(r, 400));
    setTogglingEnabled(false);
  }

  // ── Status change ──────────────────────────────────────────────────────────
  async function handleStatusChange(id: string, status: ReservationStatus) {
    const res = await fetch(`/api/admin/reservations/${id}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      console.error("ReservationsPanel status change:", j.error);
    }
    setReservations((prev) =>
      prev.map((r) => r.id === id ? { ...r, status } : r)
    );
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    if (!confirm("Delete this reservation? This cannot be undone.")) return;
    const res = await fetch(`/api/admin/reservations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      console.error("ReservationsPanel delete:", j.error);
      return;
    }
    setReservations((prev) => prev.filter((r) => r.id !== id));
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = reservations.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.customerName.toLowerCase().includes(q) ||
      r.customerEmail.toLowerCase().includes(q) ||
      r.tableLabel.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q)
    );
  });

  const stats = {
    total:     reservations.length,
    pending:   reservations.filter((r) => r.status === "pending").length,
    confirmed: reservations.filter((r) => r.status === "confirmed").length,
    cancelled: reservations.filter((r) => r.status === "cancelled" || r.status === "no_show").length,
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Enable / disable card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-gray-900">Online Table Reservations</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {rs.enabled
                ? "Reservation button is visible on the customer-facing website."
                : "Disabled — the \"Reserve a Table\" button is hidden from customers."}
            </p>
          </div>
          <button
            onClick={toggleEnabled}
            disabled={togglingEnabled}
            className="flex-shrink-0 flex items-center gap-2 font-semibold text-sm transition"
          >
            {togglingEnabled ? (
              <Loader2 size={22} className="animate-spin text-gray-400" />
            ) : rs.enabled ? (
              <>
                <ToggleRight size={32} className="text-orange-500" />
                <span className="text-orange-600 hidden sm:inline">Enabled</span>
              </>
            ) : (
              <>
                <ToggleLeft size={32} className="text-gray-400" />
                <span className="text-gray-400 hidden sm:inline">Disabled</span>
              </>
            )}
          </button>
        </div>

        <button
          onClick={() => setShowSettings((v) => !v)}
          className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 transition"
        >
          <Settings2 size={13} />
          {showSettings ? "Hide settings" : "Configure booking settings"}
        </button>
      </div>

      {showSettings && <ReservationSettings />}

      {/* Stats row */}
      {[
        { label: "Total today",       value: stats.total,     color: "text-gray-800" },
        { label: "Pending",           value: stats.pending,   color: "text-amber-600" },
        { label: "Confirmed",         value: stats.confirmed, color: "text-green-600" },
        { label: "Cancelled / no-show", value: stats.cancelled, color: "text-red-500" },
      ].map((s) => (
        <div key={s.label} className="hidden" />
      ))}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Shown for date",        value: stats.total,     bg: "bg-gray-50",   border: "border-gray-200",  text: "text-gray-800"  },
          { label: "Pending",               value: stats.pending,   bg: "bg-amber-50",  border: "border-amber-200", text: "text-amber-700" },
          { label: "Confirmed",             value: stats.confirmed, bg: "bg-green-50",  border: "border-green-200", text: "text-green-700" },
          { label: "Cancelled / no-show",   value: stats.cancelled, bg: "bg-red-50",    border: "border-red-200",   text: "text-red-600"   },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3.5`}>
            <div className={`text-2xl font-bold ${s.text}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap gap-3">
        {/* Date */}
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-orange-500 flex-shrink-0" />
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
          />
        </div>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as "" | ReservationStatus)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No show</option>
        </select>

        {/* Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[180px] border border-gray-200 rounded-xl px-3 py-2">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Name, email, table…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm focus:outline-none placeholder-gray-400"
          />
        </div>

        {/* Refresh */}
        <button
          onClick={fetchReservations}
          disabled={loading}
          className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Reservation list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-orange-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 text-center bg-white rounded-2xl border border-gray-200">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
            <MapPin size={22} className="text-gray-400" />
          </div>
          <p className="font-semibold text-gray-700">No reservations found</p>
          <p className="text-sm text-gray-400 max-w-xs">
            {search ? "Try a different search term." : "No reservations match the selected filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((res) => (
            <ReservationCard
              key={res.id}
              res={res}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
