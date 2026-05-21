"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import type { Reservation, ReservationStatus } from "@/types";
import {
  CalendarDays, Clock, Users, UtensilsCrossed, CheckCircle2, XCircle,
  AlertTriangle, Trash2, RefreshCw, MapPin, ChevronDown, Loader2,
  ToggleLeft, ToggleRight, Settings2, Search, Mail, Phone,
  LogIn, LogOut, UserPlus, Ban, Star, Link, ExternalLink,
} from "lucide-react";
import { cleanPhone } from "@/lib/inputUtils";

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

function fmtTs(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Local-date helpers (not UTC) so users east of UTC don't see yesterday
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function maxDateStr(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nowLocalMins(): number { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
function toMins(t: string): number { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function isSlotPast(slot: string, date: string): boolean {
  return date === todayStr() && toMins(slot) <= nowLocalMins();
}
function generateSlots(open: string, close: string, interval: number): string[] {
  const out: string[] = [];
  for (let t = toMins(open); t < toMins(close); t += interval) {
    out.push(`${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`);
  }
  return out;
}

const STATUS_CONFIG: Record<ReservationStatus, { label: string; dotClass: string; badgeClass: string }> = {
  pending: { label: "Pending", dotClass: "bg-amber-400", badgeClass: "bg-amber-50   text-amber-700  border-amber-200" },
  confirmed: { label: "Confirmed", dotClass: "bg-green-500", badgeClass: "bg-green-50   text-green-700  border-green-200" },
  checked_in: { label: "Checked in", dotClass: "bg-blue-500", badgeClass: "bg-blue-50    text-blue-700   border-blue-200" },
  checked_out: { label: "Checked out", dotClass: "bg-teal-500", badgeClass: "bg-teal-50    text-teal-700   border-teal-200" },
  cancelled: { label: "Cancelled", dotClass: "bg-red-400", badgeClass: "bg-red-50     text-red-700    border-red-200" },
  no_show: { label: "No show", dotClass: "bg-gray-400", badgeClass: "bg-gray-100   text-gray-600   border-gray-300" },
};

// ─── Settings form ────────────────────────────────────────────────────────────

function ReservationSettings() {
  const { settings, updateSettings } = useApp();
  const rs = settings.reservationSystem;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newBlackout, setNewBlackout] = useState("");
  const [embedCopied, setEmbedCopied] = useState(false);

  const [form, setForm] = useState({
    slotDurationMinutes: rs.slotDurationMinutes,
    maxAdvanceDays: rs.maxAdvanceDays,
    openTime: rs.openTime,
    closeTime: rs.closeTime,
    slotIntervalMinutes: rs.slotIntervalMinutes,
    maxPartySize: rs.maxPartySize ?? 10,
    reviewUrl: rs.reviewUrl ?? "",
  });

  async function save() {
    setSaving(true);
    updateSettings({ reservationSystem: { ...rs, ...form } });
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function addBlackout() {
    if (!newBlackout) return;
    const dates = [...new Set([...(rs.blackoutDates ?? []), newBlackout])].sort();
    updateSettings({ reservationSystem: { ...rs, blackoutDates: dates } });
    setNewBlackout("");
  }

  function removeBlackout(d: string) {
    updateSettings({ reservationSystem: { ...rs, blackoutDates: (rs.blackoutDates ?? []).filter((x) => x !== d) } });
  }

  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  const embedCode = `<iframe src="${siteUrl}/book" width="100%" height="700" style="border:none;border-radius:12px" title="Reserve a Table"></iframe>`;

  function copyEmbed() {
    navigator.clipboard.writeText(embedCode).then(() => { setEmbedCopied(true); setTimeout(() => setEmbedCopied(false), 2000); });
  }

  const field = (label: string, node: React.ReactNode) => (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      {node}
    </div>
  );

  const numInput = (key: "slotDurationMinutes" | "maxAdvanceDays" | "slotIntervalMinutes" | "maxPartySize", min: number, max: number) => (
    <input type="number" min={min} max={max} value={form[key] as number}
      onChange={(e) => setForm((p) => ({ ...p, [key]: parseInt(e.target.value, 10) || min }))}
      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] sm:text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition" />
  );

  const timeInput = (key: "openTime" | "closeTime") => (
    <input type="time" value={form[key]}
      onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] sm:text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition" />
  );

  return (
    <div className="space-y-4">
      {/* Booking config */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Settings2 size={15} className="text-orange-500" />
          <h3 className="text-sm font-bold text-gray-800">Booking Settings</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {field("Opening time", timeInput("openTime"))}
          {field("Closing time", timeInput("closeTime"))}
          {field("Slot interval (min)", numInput("slotIntervalMinutes", 15, 120))}
          {field("Slot duration (min)", numInput("slotDurationMinutes", 30, 360))}
          {field("Max advance (days)", numInput("maxAdvanceDays", 1, 365))}
          {field("Max party size", numInput("maxPartySize", 1, 50))}
        </div>
        {/* Review URL */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
            <Star size={11} className="text-yellow-500" /> Review link (Google / TripAdvisor)
          </label>
          <div className="flex gap-2">
            <input type="url" value={form.reviewUrl} placeholder="https://g.page/r/…/review"
              onChange={(e) => setForm((p) => ({ ...p, reviewUrl: e.target.value }))}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition" />
            {form.reviewUrl && (
              <a href={form.reviewUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-orange-600 border border-orange-200 rounded-xl px-3 py-2 hover:bg-orange-50 transition">
                <ExternalLink size={12} /> Test
              </a>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">Used in the post-visit review request email (&#123;&#123;review_url&#125;&#125;).</p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-xl transition">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
          </button>
          <p className="text-xs text-gray-400">Changes apply to new bookings immediately.</p>
        </div>
      </div>

      {/* Blackout dates */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Ban size={15} className="text-red-500" />
          <h3 className="text-sm font-bold text-gray-800">Blackout Dates</h3>
          <span className="text-xs text-gray-400 ml-1">Dates the restaurant is closed — no online bookings accepted.</span>
        </div>
        <div className="flex gap-2">
          <input type="date" value={newBlackout} onChange={(e) => setNewBlackout(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition" />
          <button onClick={addBlackout} disabled={!newBlackout}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold text-sm px-3 py-2 rounded-xl transition">
            Add date
          </button>
        </div>
        {(rs.blackoutDates ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {(rs.blackoutDates ?? []).map((d) => (
              <span key={d} className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                <CalendarDays size={11} />
                {new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                <button onClick={() => removeBlackout(d)} className="ml-0.5 text-red-400 hover:text-red-700 transition">×</button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">No blackout dates set.</p>
        )}
      </div>

      {/* Embed widget */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Link size={15} className="text-blue-500" />
          <h3 className="text-sm font-bold text-gray-800">Embeddable Booking Widget</h3>
        </div>
        <p className="text-xs text-gray-500">Paste this iframe code into any website to embed your booking form.</p>
        <div className="relative">
          <pre className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap break-all">{embedCode}</pre>
          <button onClick={copyEmbed}
            className="absolute top-2 right-2 text-xs bg-white border border-gray-200 rounded-lg px-2 py-1 text-gray-600 hover:bg-gray-100 transition">
            {embedCopied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <a href="/book" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-blue-600 font-semibold hover:text-blue-800 transition">
          <ExternalLink size={12} /> Preview booking widget
        </a>
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

  const isActive    = res.status === "pending" || res.status === "confirmed";
  const isCheckedIn = res.status === "checked_in";

  // No-show flag: confirmed booking whose date+time is 30+ min in the past
  const isNoShowCandidate = res.status === "confirmed" && (() => {
    const [y, mo, d] = res.date.split("-").map(Number);
    const [h, m]     = res.time.split(":").map(Number);
    const bookingMs  = new Date(y, mo - 1, d, h, m).getTime();
    return Date.now() - bookingMs > 30 * 60 * 1000;
  })();

  const SOURCE_LABELS: Record<string, { label: string; cls: string }> = {
    "online":  { label: "Online",   cls: "bg-teal-50 text-teal-700 border-teal-200"   },
    "walk-in": { label: "Walk-in",  cls: "bg-purple-50 text-purple-700 border-purple-200" },
    "phone":   { label: "Phone",    cls: "bg-blue-50 text-blue-700 border-blue-200"   },
    "other":   { label: "Other",    cls: "bg-gray-100 text-gray-600 border-gray-300"  },
  };
  const srcInfo = res.source ? (SOURCE_LABELS[res.source] ?? SOURCE_LABELS.other) : null;

  return (
    <div className={`bg-white rounded-xl border p-4 transition ${
      isNoShowCandidate ? "border-amber-300 bg-amber-50/30" :
      isCheckedIn       ? "border-blue-300 bg-blue-50/30"   : "border-gray-200 hover:border-gray-300"
    }`}>
      {isNoShowCandidate && (
        <div className="flex items-center gap-1.5 text-xs text-amber-700 font-semibold mb-2">
          <AlertTriangle size={12} /> Possible no-show — booking time has passed
        </div>
      )}
      
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-3">
        {/* Left info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.badgeClass}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
              {cfg.label}
            </span>
            {srcInfo && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${srcInfo.cls}`}
              >
                {res.source === "walk-in" ? (
                  <UserPlus size={10} />
                ) : res.source === "phone" ? (
                  <Phone size={10} />
                ) : null}
                {srcInfo.label}
              </span>
            )}
            <span className="text-xs text-gray-400 font-mono">
              {res.id.slice(0, 8).toUpperCase()}
            </span>
            {res.checkedInAt && (
              <span className="text-xs text-blue-600 font-medium flex items-center gap-1">
                <LogIn size={11} /> {fmtTs(res.checkedInAt)}
              </span>
            )}
            {res.checkedOutAt && (
              <span className="text-xs text-teal-600 font-medium flex items-center gap-1">
                <LogOut size={11} /> {fmtTs(res.checkedOutAt)}
              </span>
            )}
          </div>

          <div className="mt-3 sm:mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-700">
            <span className="flex items-center gap-1.5 font-semibold whitespace-nowrap">
              <CalendarDays size={13} className="text-orange-500" />
              {fmtDate(res.date)}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Clock size={13} className="text-orange-500" />
              {fmt12(res.time)}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <Users size={13} className="text-orange-500" />
              {res.partySize} {res.partySize === 1 ? "guest" : "guests"}
            </span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <UtensilsCrossed size={13} className="text-orange-500" />
              {res.tableLabel}
              {res.section ? (
                <span className="text-gray-400">· {res.section}</span>
              ) : null}
            </span>
          </div>

          <div className="mt-3 sm:mt-2 space-y-1 sm:space-y-0.5 text-xs text-gray-500">
            <div className="font-semibold text-gray-700 text-sm">
              {res.customerName}
            </div>
            {res.customerEmail && (
              <div className="flex items-center gap-1.5">
                <Mail size={11} />
                <a
                  href={`mailto:${res.customerEmail}`}
                  className="hover:text-orange-600 transition"
                >
                  {res.customerEmail}
                </a>
              </div>
            )}
            {res.customerPhone && (
              <div className="flex items-center gap-1.5">
                <Phone size={11} />
                {res.customerPhone}
              </div>
            )}
            {res.note && (
              <div className="mt-1 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 text-amber-800 text-xs italic">
                &ldquo;{res.note}&rdquo;
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:flex-shrink-0 mt-3 sm:mt-0 pt-3 sm:pt-0 border-t border-gray-100 sm:border-0">
          {actioning ? (
            <Loader2 size={16} className="animate-spin text-gray-400" />
          ) : (
            <>
              {/* Prominent check-in / check-out buttons */}
              {res.status === "confirmed" && (
                <button
                  onClick={() => doAction(() => onStatusChange(res.id, "checked_in"))}
                  className="flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                  title="Mark customer as arrived"
                >
                  <LogIn size={13} /> Check In
                </button>
              )}
              {res.status === "checked_in" && (
                <button
                  onClick={() => doAction(() => onStatusChange(res.id, "checked_out"))}
                  className="flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                  title="Mark customer as done, free the table"
                >
                  <LogOut size={13} /> Check Out
                </button>
              )}

              {/* Actions dropdown */}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:border-gray-300 transition"
                >
                  Actions <ChevronDown size={12} />
                </button>
                {menuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="absolute left-0 sm:left-auto sm:right-0 top-10 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[170px]">
                      {res.status === "pending" && (
                        <button
                          onClick={() => doAction(() => onStatusChange(res.id, "confirmed"))}
                          className="flex items-center gap-2 w-full px-4 py-2 text-sm text-green-700 hover:bg-green-50 transition"
                        >
                          <CheckCircle2 size={14} /> Confirm
                        </button>
                      )}
                      {res.status === "confirmed" && (
                        <button
                          onClick={() => doAction(() => onStatusChange(res.id, "no_show"))}
                          className="flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition"
                        >
                          <AlertTriangle size={14} /> Mark no-show
                        </button>
                      )}
                      {(isActive || isCheckedIn) && (
                        <button
                          onClick={() => doAction(() => onStatusChange(res.id, "cancelled"))}
                          className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                        >
                          <XCircle size={14} /> Cancel
                        </button>
                      )}
                      <div className="border-t border-gray-100 my-1" />
                      <button
                        onClick={() => doAction(() => onDelete(res.id))}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
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
  const [filterSource,    setFilterSource]    = useState("");
  const [search,          setSearch]          = useState("");
  const [showSettings,    setShowSettings]    = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  // Walk-in / phone booking modal
  const allSlots   = generateSlots(rs.openTime ?? "12:00", rs.closeTime ?? "22:00", rs.slotIntervalMinutes ?? 30);
  const firstSlot  = allSlots.find((s) => !isSlotPast(s, todayStr())) ?? allSlots[0] ?? "12:00";

  const [showAddModal,  setShowAddModal]  = useState(false);
  const [addSource,     setAddSource]     = useState<"walk-in" | "phone">("walk-in");
  const [addName,       setAddName]       = useState("");
  const [addEmail,      setAddEmail]      = useState("");
  const [addPhone,      setAddPhone]      = useState("");
  const [addParty,      setAddParty]      = useState(2);
  const [addTableId,    setAddTableId]    = useState("");
  const [addDate,       setAddDate]       = useState(todayStr());
  const [addTime,       setAddTime]       = useState(firstSlot);
  const [addNote,       setAddNote]       = useState("");
  const [addSaving,     setAddSaving]     = useState(false);
  const [addError,      setAddError]      = useState("");
  const [addBookedIds,  setAddBookedIds]  = useState<Set<string>>(new Set());
  const [addLoadingTbl, setAddLoadingTbl] = useState(false);

  // Fetch which tables are already booked at the chosen date/time. Reuses the
  // public availability endpoint (no auth required) — same data the customer
  // and POS flows use, so admin sees the same conflicts.
  const fetchAddTables = useCallback(async (date: string, time: string, party: number) => {
    if (!date || !time || !party) return;
    setAddLoadingTbl(true);
    try {
      const res  = await fetch(`/api/reservations/availability?date=${date}&time=${time}&partySize=${party}`);
      const json = await res.json() as { ok: boolean; bookedTableIds?: string[] };
      setAddBookedIds(new Set(json.ok ? (json.bookedTableIds ?? []) : []));
    } catch {
      setAddBookedIds(new Set());
    } finally { setAddLoadingTbl(false); }
  }, []);

  // Re-fetch booked-IDs whenever date/time/party changes while the modal is open
  useEffect(() => {
    if (!showAddModal) return;
    setAddTableId("");
    setAddBookedIds(new Set());
    if (addTime && !isSlotPast(addTime, addDate)) fetchAddTables(addDate, addTime, addParty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addDate, addTime, addParty, showAddModal]);

  // Auto-advance time when date changes to today and current slot is past
  useEffect(() => {
    if (isSlotPast(addTime, addDate)) {
      const next = allSlots.find((s) => !isSlotPast(s, addDate));
      if (next) setAddTime(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addDate]);

  // Walk-ins are seated right now — force date to today and time to the
  // current slot whenever the source toggle is set to walk-in.
  useEffect(() => {
    if (!showAddModal || addSource !== "walk-in") return;
    const today   = todayStr();
    const nowSlot = allSlots.find((s) => !isSlotPast(s, today)) ?? allSlots[0] ?? "12:00";
    setAddDate(today);
    setAddTime(nowSlot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSource, showAddModal]);

  function openAddModal() {
    const today = todayStr();
    const slot = allSlots.find((s) => !isSlotPast(s, today)) ?? allSlots[0] ?? "12:00";
    setAddSource("walk-in"); setAddDate(today); setAddTime(slot);
    setAddParty(2); setAddTableId("");
    setAddName(""); setAddEmail(""); setAddPhone(""); setAddNote("");
    setAddBookedIds(new Set()); setAddError(""); setAddSaving(false);
    setShowAddModal(true);
  }

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterDate) params.set("from", filterDate);
      if (filterStatus) params.set("status", filterStatus);
      const res = await fetch(`/api/admin/reservations?${params}`);
      const json = await res.json() as { ok: boolean; reservations?: Reservation[]; error?: string };
      if (json.ok) setReservations(json.reservations ?? []);
    } catch (err) {
      console.error("ReservationsPanel fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [filterDate, filterStatus]);

  useEffect(() => { fetchReservations(); }, [fetchReservations]);

  // Poll every 8 s — anon supabase realtime no longer fires after RLS revoke.
  useEffect(() => {
    const id = setInterval(fetchReservations, 8_000);
    return () => clearInterval(id);
  }, [fetchReservations]);

  async function toggleEnabled() {
    setTogglingEnabled(true);
    updateSettings({ reservationSystem: { ...rs, enabled: !rs.enabled } });
    await new Promise((r) => setTimeout(r, 400));
    setTogglingEnabled(false);
  }

  // Per-row guards so a double-click on the same row's status/delete only fires once.
  const statusInFlight = useRef<Set<string>>(new Set());
  const deleteInFlight = useRef<Set<string>>(new Set());
  const addInFlight = useRef(false);

  async function handleStatusChange(id: string, status: ReservationStatus) {
    if (statusInFlight.current.has(id)) return;
    statusInFlight.current.add(id);
    try {
      const res = await fetch(`/api/admin/reservations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        console.error("ReservationsPanel status change:", j.error);
      }
      // Optimistic update — includes timestamp approximation
      setReservations((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const now = new Date().toISOString();
          return {
            ...r,
            status,
            ...(status === "checked_in" ? { checkedInAt: now } : {}),
            ...(status === "checked_out" ? { checkedOutAt: now } : {}),
          };
        })
      );
    } finally {
      statusInFlight.current.delete(id);
    }
  }

  async function handleDelete(id: string) {
    if (deleteInFlight.current.has(id)) return;
    if (!confirm("Delete this reservation? This cannot be undone.")) return;
    deleteInFlight.current.add(id);
    try {
      const res = await fetch(`/api/admin/reservations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        console.error("ReservationsPanel delete:", j.error);
        return;
      }
      setReservations((prev) => prev.filter((r) => r.id !== id));
    } finally {
      deleteInFlight.current.delete(id);
    }
  }

  async function handleAddBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!addTableId) { setAddError("Please select a table."); return; }
    if (!addName.trim()) { setAddError("Guest name is required."); return; }
    // Phone bookings always need a callback number — that's how staff reach
    // the guest if the booking needs to be confirmed or changed.
    if (addSource === "phone" && !addPhone.trim()) {
      setAddError("Phone number is required for phone bookings.");
      return;
    }

    const table = settings.diningTables?.find((t) => t.id === addTableId);
    if (!table) { setAddError("Selected table no longer exists. Refresh and try again."); return; }

    // Soft-warn: party exceeds table capacity. Admin can pull chairs / merge
    // tables, so we allow override after explicit confirmation (mirrors POS).
    if (table.seats < addParty) {
      const ok = window.confirm(
        `Table ${table.label} seats ${table.seats}, but the party is ${addParty}. ` +
        `Extra chairs or a combined table will be needed. Continue?`
      );
      if (!ok) return;
    }

    if (addInFlight.current) return;
    addInFlight.current = true;
    setAddSaving(true); setAddError("");
    try {
      const res = await fetch("/api/admin/reservations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: addTableId,
          date: addDate, time: addTime, partySize: addParty,
          customerName: addName.trim(), customerEmail: addEmail.trim(),
          customerPhone: addPhone.trim(), note: addNote.trim(),
          source: addSource,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setShowAddModal(false);
        fetchReservations();
      } else {
        setAddError(json.error ?? "Failed to create booking.");
      }
    } catch {
      setAddError("Network error — please try again.");
    } finally {
      addInFlight.current = false;
      setAddSaving(false);
    }
  }

  const filtered = reservations.filter((r) => {
    if (filterSource && r.source !== filterSource) return false;
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
    total: reservations.length,
    pending: reservations.filter((r) => r.status === "pending").length,
    confirmed: reservations.filter((r) => r.status === "confirmed").length,
    checkedIn: reservations.filter((r) => r.status === "checked_in").length,
    checkedOut: reservations.filter((r) => r.status === "checked_out").length,
    cancelled: reservations.filter((r) => r.status === "cancelled" || r.status === "no_show").length,
  };

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
              <><ToggleRight size={32} className="text-orange-500" /><span className="text-orange-600 hidden sm:inline">Enabled</span></>
            ) : (
              <><ToggleLeft size={32} className="text-gray-400" /><span className="text-gray-400 hidden sm:inline">Disabled</span></>
            )}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 hover:text-orange-700 transition"
          >
            <Settings2 size={13} />
            {showSettings ? "Hide settings" : "Configure booking settings"}
          </button>
          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-xl transition"
          >
            <UserPlus size={13} /> Add Walk-in / Phone Booking
          </button>
        </div>
      </div>

      {showSettings && <ReservationSettings />}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: "Total", value: stats.total, bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-800" },
          { label: "Pending", value: stats.pending, bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
          { label: "Confirmed", value: stats.confirmed, bg: "bg-green-50", border: "border-green-200", text: "text-green-700" },
          { label: "Dining", value: stats.checkedIn, bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
          { label: "Done", value: stats.checkedOut, bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-700" },
          { label: "Cancelled", value: stats.cancelled, bg: "bg-red-50", border: "border-red-200", text: "text-red-600" },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3`}>
            <div className={`text-xl font-bold ${s.text}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-orange-500 flex-shrink-0" />
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as "" | ReservationStatus)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="checked_in">Checked in</option>
          <option value="checked_out">Checked out</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No show</option>
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
        >
          <option value="">All sources</option>
          <option value="online">Online</option>
          <option value="walk-in">Walk-in</option>
          <option value="phone">Phone</option>
          <option value="other">Other</option>
        </select>
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

      {showAddModal && (() => {
        // Derived per-render state for the modal
        const activeTables = (settings.diningTables ?? []).filter((t) => t.active);
        const tablesBySection: Record<string, typeof activeTables> = {};
        for (const t of activeTables) {
          (tablesBySection[t.section || "Other"] = tablesBySection[t.section || "Other"] ?? []).push(t);
        }
        const slotPast = isSlotPast(addTime, addDate);
        const isBlackout = (rs.blackoutDates ?? []).includes(addDate);
        const maxParty = rs.maxPartySize ?? 10;
        const partyTooLarge = addParty > maxParty;
        const phoneMissing = addSource === "phone" && !addPhone.trim();
        const canSubmit = !addSaving && !!addTableId && !!addName.trim() && !slotPast && !isBlackout && !partyTooLarge && !phoneMissing;

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
            <div className="relative w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] overflow-hidden">

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <UserPlus size={16} className="text-orange-500" />
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">Add Booking</h3>
                    <p className="text-xs text-gray-400">Walk-in or phone reservation</p>
                  </div>
                </div>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600 transition">
                  <XCircle size={20} />
                </button>
              </div>

              <form onSubmit={handleAddBooking} className="overflow-y-auto flex-1 p-5 space-y-5">

                {/* Source toggle */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Source</p>
                  <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                    {(["walk-in", "phone"] as const).map((s) => (
                      <button key={s} type="button" onClick={() => setAddSource(s)}
                        className={`flex-1 py-2 text-sm font-semibold transition ${addSource === s ? "bg-orange-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}>
                        {s === "walk-in" ? "Walk-in (check in now)" : "Phone booking"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date + party. Date column is hidden for walk-ins — they're
                    seated now, so a "Seating now" pill replaces it. */}
                <div className={`grid gap-3 ${addSource === "phone" ? "grid-cols-2" : "grid-cols-1"}`}>
                  {addSource === "phone" && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Date <span className="text-red-400">*</span></label>
                      <input type="date" required value={addDate}
                        min={todayStr()} max={maxDateStr(rs.maxAdvanceDays ?? 30)}
                        onChange={(e) => setAddDate(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Guests <span className="text-red-400">*</span></label>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setAddParty((p) => Math.max(1, p - 1))}
                        className="w-9 h-9 rounded-full border border-gray-300 text-gray-500 hover:border-orange-400 hover:text-orange-500 font-bold transition flex items-center justify-center">−</button>
                      <span className="text-gray-900 font-bold text-lg w-8 text-center">{addParty}</span>
                      <button type="button" onClick={() => setAddParty((p) => Math.min(maxParty, p + 1))}
                        className="w-9 h-9 rounded-full border border-gray-300 text-gray-500 hover:border-orange-400 hover:text-orange-500 font-bold transition flex items-center justify-center">+</button>
                      <span className="text-xs text-gray-400 ml-1">max {maxParty}</span>
                    </div>
                  </div>
                </div>

                {addSource === "walk-in" && (
                  <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 text-sm text-orange-800">
                    <Clock size={14} className="flex-shrink-0" />
                    Seating now · <strong>{fmt12(addTime)}</strong>
                  </div>
                )}

                {/* Blackout warning — only relevant for future phone bookings */}
                {addSource === "phone" && isBlackout && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
                    <Ban size={14} className="flex-shrink-0" />
                    Restaurant is closed on this date — booking cannot be created.
                  </div>
                )}

                {/* Time slot picker — only shown for phone bookings */}
                {addSource === "phone" && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Time <span className="text-red-400">*</span></label>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                      {allSlots.map((slot) => {
                        const past = isSlotPast(slot, addDate);
                        const selected = addTime === slot;
                        return (
                          <button key={slot} type="button" disabled={past}
                            onClick={() => !past && setAddTime(slot)}
                            title={past ? "Time has passed" : undefined}
                            className={`py-2 rounded-lg text-xs font-semibold border transition ${past
                                ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed line-through"
                                : selected
                                  ? "bg-orange-500 text-white border-orange-500"
                                  : "bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600"
                              }`}>{fmt12(slot)}</button>
                        );
                      })}
                    </div>
                    {allSlots.every((s) => isSlotPast(s, addDate)) && (
                      <p className="text-xs text-amber-600 mt-2">All slots for today have passed — select a future date.</p>
                    )}
                  </div>
                )}

                {/* Table picker — section grouped, with reserved/undersized states */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Table <span className="text-red-400">*</span>
                  </label>
                  {activeTables.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2">No active tables — add tables in Waiters & Tables → Tables.</p>
                  ) : addLoadingTbl ? (
                    <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                      <Loader2 size={14} className="animate-spin text-orange-500" /> Checking table availability…
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(tablesBySection).map(([sec, tbls]) => (
                        <div key={sec}>
                          {sec && <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{sec}</p>}
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                            {tbls.map((t) => {
                              const sel = addTableId === t.id;
                              const isBooked = addBookedIds.has(t.id);
                              const isUndersized = t.seats < addParty;
                              const baseCls = "py-2 rounded-lg text-xs font-semibold border transition flex flex-col items-center leading-tight";
                              const cls = isBooked
                                ? `${baseCls} bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed line-through`
                                : sel
                                  ? isUndersized
                                    ? `${baseCls} bg-amber-500 text-white border-amber-500`
                                    : `${baseCls} bg-orange-500 text-white border-orange-500`
                                  : isUndersized
                                    ? `${baseCls} bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-400`
                                    : `${baseCls} bg-white text-gray-700 border-gray-200 hover:border-orange-300 hover:text-orange-600`;
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  disabled={isBooked}
                                  title={
                                    isBooked ? "Already reserved at this time" :
                                      isUndersized ? `Seats ${t.seats} — party of ${addParty} (will need extra chairs)` :
                                        `Seats ${t.seats}`
                                  }
                                  onClick={() => setAddTableId(t.id)}
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
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[10px] text-gray-500">
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-white border border-gray-300" /> free
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-amber-50 border border-amber-300" /> too small (warn)
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-gray-100 border border-gray-300" /> reserved (blocked)
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Guest details */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Guest details</p>
                  <input type="text" required value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Full name *"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition" />
                  <input type="email" autoComplete="off" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="Email (optional)"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition" />
                  <input type="tel" inputMode="tel" autoComplete="off" required={addSource === "phone"} value={addPhone} onChange={(e) => setAddPhone(cleanPhone(e.target.value))}
                    placeholder={addSource === "phone" ? "Phone *" : "Phone (optional)"}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition" />
                  <textarea rows={2} value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="Notes (allergies, special requests…)"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-orange-400 transition" />
                </div>

                {addError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> {addError}
                  </div>
                )}
              </form>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="text-gray-500 hover:text-gray-700 text-sm font-semibold transition">Cancel</button>
                <button type="button" onClick={(e) => handleAddBooking(e as unknown as React.FormEvent)} disabled={!canSubmit}
                  className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition">
                  {addSaving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> :
                    addSource === "walk-in" ? <><LogIn size={14} /> Check In Now</> : <><CheckCircle2 size={14} /> Create Booking</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
