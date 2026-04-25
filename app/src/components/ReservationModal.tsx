"use client";

import { useState, useEffect, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import {
  X, CalendarDays, Clock, Users, ChevronRight, ChevronLeft,
  CheckCircle2, Loader2, UtensilsCrossed, MapPin, AlertCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AvailableTable {
  id: string;
  label: string;
  seats: number;
  section: string;
}

type Step = "datetime" | "table" | "details" | "confirmed";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMins(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function generateSlots(open: string, close: string, interval: number): string[] {
  const slots: string[] = [];
  const end = toMins(close);
  for (let t = toMins(open); t < end; t += interval) {
    const h = Math.floor(t / 60).toString().padStart(2, "0");
    const m = (t % 60).toString().padStart(2, "0");
    slots.push(`${h}:${m}`);
  }
  return slots;
}

function fmt12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function fmtDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// Use local date components — toISOString() is UTC and can return yesterday east of UTC+0
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function maxDateStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowLocalMins(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

function isSlotPast(slot: string, selectedDate: string): boolean {
  return selectedDate === todayStr() && toMins(slot) <= nowLocalMins();
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS: { key: Step; label: string }[] = [
  { key: "datetime", label: "Date & Time" },
  { key: "table",    label: "Table"       },
  { key: "details",  label: "Details"     },
  { key: "confirmed", label: "Confirmed"  },
];

function StepDots({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-2">
      {STEPS.slice(0, 3).map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div className={[
            "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all",
            i < idx  ? "bg-orange-500 text-white"
            : i === idx ? "bg-orange-500 text-white ring-2 ring-orange-200"
            : "bg-gray-100 text-gray-400",
          ].join(" ")}>
            {i < idx ? <CheckCircle2 size={14} /> : i + 1}
          </div>
          {i < 2 && (
            <div className={`w-8 h-0.5 rounded ${i < idx ? "bg-orange-500" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReservationModal({ onClose }: { onClose: () => void }) {
  const { settings } = useApp();
  const rs = settings.reservationSystem;

  const slots = generateSlots(
    rs.openTime ?? "12:00",
    rs.closeTime ?? "22:00",
    rs.slotIntervalMinutes ?? 30,
  );

  // ── Form state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("datetime");
  const [date,      setDate]      = useState(todayStr());
  const [time,      setTime]      = useState(() => slots.find((s) => !isSlotPast(s, todayStr())) ?? slots[0] ?? "12:00");
  const [partySize, setPartySize] = useState(2);
  const [selectedTable, setSelectedTable] = useState<AvailableTable | null>(null);
  const [name,  setName]  = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note,  setNote]  = useState("");

  // ── Availability state ────────────────────────────────────────────────────
  const [tables,       setTables]       = useState<AvailableTable[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [availError,   setAvailError]   = useState("");

  // ── Submission state ──────────────────────────────────────────────────────
  const [submitting,     setSubmitting]     = useState(false);
  const [submitError,    setSubmitError]    = useState("");
  const [reservationId,  setReservationId]  = useState("");

  // When date changes to today, re-anchor the selected time to the first future slot
  useEffect(() => {
    const firstValid = slots.find((s) => !isSlotPast(s, date));
    if (firstValid && isSlotPast(time, date)) setTime(firstValid);
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch available tables when moving to step 2 ──────────────────────────
  const fetchTables = useCallback(async () => {
    setLoadingTables(true);
    setAvailError("");
    setSelectedTable(null);
    try {
      const res  = await fetch(
        `/api/reservations/availability?date=${date}&time=${time}&partySize=${partySize}`
      );
      const json = await res.json() as { ok: boolean; availableTables?: AvailableTable[]; error?: string };
      if (json.ok) {
        setTables(json.availableTables ?? []);
      } else {
        setAvailError(json.error ?? "Failed to check availability.");
      }
    } catch {
      setAvailError("Network error — please try again.");
    } finally {
      setLoadingTables(false);
    }
  }, [date, time, partySize]);

  useEffect(() => {
    if (step === "table") fetchTables();
  }, [step, fetchTables]);

  // ── Submit reservation ────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTable) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res  = await fetch("/api/reservations", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          tableId:       selectedTable.id,
          date,
          time,
          partySize,
          customerName:  name.trim(),
          customerEmail: email.trim(),
          customerPhone: phone.trim(),
          note:          note.trim(),
        }),
      });
      const json = await res.json() as { ok: boolean; reservationId?: string; error?: string };
      if (json.ok && json.reservationId) {
        setReservationId(json.reservationId);
        setStep("confirmed");
      } else {
        setSubmitError(json.error ?? "Failed to create reservation.");
      }
    } catch {
      setSubmitError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Group tables by section ───────────────────────────────────────────────
  const tablesBySection = tables.reduce<Record<string, AvailableTable[]>>((acc, t) => {
    (acc[t.section] = acc[t.section] ?? []).push(t);
    return acc;
  }, {});

  const maxDate = maxDateStr(rs.maxAdvanceDays ?? 30);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <CalendarDays size={17} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900 text-base leading-tight">Reserve a Table</h2>
              <p className="text-gray-400 text-xs mt-0.5">{settings.restaurant.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {step !== "confirmed" && <StepDots current={step} />}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">

          {/* ── Step 1: Date, Time, Party Size ─────────────────────────── */}
          {step === "datetime" && (
            <div className="p-5 space-y-5">

              {/* Date */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <CalendarDays size={14} className="inline mr-1.5 text-orange-500" />
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  min={todayStr()}
                  max={maxDate}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-800 focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
                />
              </div>

              {/* Party size */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <Users size={14} className="inline mr-1.5 text-orange-500" />
                  Party size
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPartySize((p) => Math.max(1, p - 1))}
                    className="w-10 h-10 rounded-full border border-gray-200 text-gray-600 hover:border-orange-400 hover:text-orange-500 font-bold text-lg transition flex items-center justify-center"
                  >
                    −
                  </button>
                  <span className="text-2xl font-bold text-gray-900 w-8 text-center">{partySize}</span>
                  <button
                    type="button"
                    onClick={() => setPartySize((p) => Math.min(20, p + 1))}
                    className="w-10 h-10 rounded-full border border-gray-200 text-gray-600 hover:border-orange-400 hover:text-orange-500 font-bold text-lg transition flex items-center justify-center"
                  >
                    +
                  </button>
                  <span className="text-sm text-gray-400 ml-1">
                    {partySize === 1 ? "1 guest" : `${partySize} guests`}
                  </span>
                </div>
              </div>

              {/* Time slots */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <Clock size={14} className="inline mr-1.5 text-orange-500" />
                  Time
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {slots.map((slot) => {
                    const past = isSlotPast(slot, date);
                    const selected = time === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        disabled={past}
                        onClick={() => !past && setTime(slot)}
                        title={past ? "Time has passed" : undefined}
                        className={[
                          "py-2.5 rounded-xl text-sm font-semibold border transition-all",
                          past
                            ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed line-through"
                            : selected
                              ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                              : "bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600",
                        ].join(" ")}
                      >
                        {fmt12(slot)}
                      </button>
                    );
                  })}
                </div>
                {slots.length === 0 && (
                  <p className="text-sm text-gray-400 mt-2">No time slots configured — please contact the restaurant.</p>
                )}
                {slots.length > 0 && slots.every((s) => isSlotPast(s, date)) && (
                  <p className="text-sm text-amber-600 mt-2">All slots for today have passed. Please select a future date.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Table Selection ───────────────────────────────── */}
          {step === "table" && (
            <div className="p-5">
              <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 mb-5 text-sm text-orange-800">
                <span className="font-semibold">{fmtDate(date)}</span>
                {" · "}{fmt12(time)}{" · "}
                {partySize} {partySize === 1 ? "guest" : "guests"}
              </div>

              {loadingTables ? (
                <div className="flex flex-col items-center py-12 text-gray-400 gap-3">
                  <Loader2 size={28} className="animate-spin text-orange-500" />
                  <span className="text-sm">Checking availability…</span>
                </div>
              ) : availError ? (
                <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Availability check failed</p>
                    <p className="mt-0.5">{availError}</p>
                    <button
                      onClick={fetchTables}
                      className="mt-2 text-red-700 font-semibold underline underline-offset-2 hover:text-red-900 transition"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : tables.length === 0 ? (
                <div className="flex flex-col items-center py-12 gap-3 text-center">
                  <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                    <UtensilsCrossed size={24} className="text-gray-400" />
                  </div>
                  <p className="font-semibold text-gray-700">No tables available</p>
                  <p className="text-sm text-gray-400 max-w-xs">
                    All tables are fully booked for this time. Try a different time or date.
                  </p>
                  <button
                    onClick={() => setStep("datetime")}
                    className="mt-2 text-orange-600 font-semibold text-sm hover:text-orange-700 transition"
                  >
                    ← Change date / time
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(tablesBySection).map(([section, sectionTables]) => (
                    <div key={section}>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        <MapPin size={11} />
                        {section}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {sectionTables.map((t) => {
                          const isSelected = selectedTable?.id === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setSelectedTable(t)}
                              className={[
                                "flex flex-col items-center gap-1.5 py-4 px-3 rounded-xl border-2 transition-all",
                                isSelected
                                  ? "border-orange-500 bg-orange-50 shadow-sm"
                                  : "border-gray-200 bg-white hover:border-orange-300",
                              ].join(" ")}
                            >
                              <div className={[
                                "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all",
                                isSelected ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600",
                              ].join(" ")}>
                                {t.label}
                              </div>
                              <span className={`text-xs font-medium ${isSelected ? "text-orange-700" : "text-gray-500"}`}>
                                Up to {t.seats} guests
                              </span>
                              {isSelected && (
                                <CheckCircle2 size={14} className="text-orange-500" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Customer Details ──────────────────────────────── */}
          {step === "details" && (
            <form id="details-form" onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Booking summary pill */}
              <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-sm text-orange-800 flex items-center gap-2">
                <UtensilsCrossed size={14} className="text-orange-500 flex-shrink-0" />
                <span>
                  <span className="font-semibold">{selectedTable?.label}</span>
                  {" · "}{fmtDate(date)}{" · "}{fmt12(time)}{" · "}
                  {partySize} {partySize === 1 ? "guest" : "guests"}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Full name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
                />
                <p className="text-xs text-gray-400 mt-1">Confirmation will be sent to this address.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Phone <span className="text-red-400">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+44 7700 900123"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Special requests <span className="text-gray-300 font-normal normal-case">(optional)</span>
                </label>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Allergies, dietary requirements, special occasion…"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition"
                />
              </div>

              {submitError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                  {submitError}
                </div>
              )}
            </form>
          )}

          {/* ── Step 4: Confirmed ─────────────────────────────────────── */}
          {step === "confirmed" && (
            <div className="p-6 flex flex-col items-center text-center gap-4">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 size={40} className="text-green-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Reservation Confirmed!</h3>
                <p className="text-gray-500 text-sm mt-1">
                  We look forward to welcoming you.
                </p>
              </div>

              {/* Booking card */}
              <div className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 text-left space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <CalendarDays size={15} className="text-orange-500 flex-shrink-0" />
                  <span className="font-semibold text-gray-800">{fmtDate(date)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={15} className="text-orange-500 flex-shrink-0" />
                  <span className="text-gray-700">{fmt12(time)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Users size={15} className="text-orange-500 flex-shrink-0" />
                  <span className="text-gray-700">{partySize} {partySize === 1 ? "guest" : "guests"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <UtensilsCrossed size={15} className="text-orange-500 flex-shrink-0" />
                  <span className="text-gray-700">
                    {selectedTable?.label} — {selectedTable?.section}
                  </span>
                </div>
                {name && (
                  <div className="border-t border-gray-200 pt-3 text-sm text-gray-500">
                    Booked for <span className="font-semibold text-gray-700">{name}</span>
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-400">
                Booking reference: <span className="font-mono font-semibold text-gray-600">{reservationId.slice(0, 8).toUpperCase()}</span>
              </p>
              <p className="text-xs text-gray-400 -mt-2">
                To cancel or modify, please contact us directly.
              </p>

              <button
                onClick={onClose}
                className="w-full bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white font-semibold py-3 rounded-xl transition-all mt-2"
              >
                Done
              </button>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        {step !== "confirmed" && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100 bg-white flex-shrink-0">
            {/* Back */}
            {step === "datetime" ? (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 transition"
              >
                <X size={14} />
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (step === "table")   setStep("datetime");
                  if (step === "details") setStep("table");
                }}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 transition"
              >
                <ChevronLeft size={16} />
                Back
              </button>
            )}

            {/* Next / Submit */}
            {step === "datetime" && (
              <button
                type="button"
                disabled={!date || !time || slots.length === 0 || isSlotPast(time, date)}
                onClick={() => setStep("table")}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all"
              >
                Check availability
                <ChevronRight size={16} />
              </button>
            )}

            {step === "table" && (
              <button
                type="button"
                disabled={!selectedTable || loadingTables}
                onClick={() => setStep("details")}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all"
              >
                Continue
                <ChevronRight size={16} />
              </button>
            )}

            {step === "details" && (
              <button
                type="submit"
                form="details-form"
                disabled={submitting || !name.trim() || !email.trim() || !phone.trim()}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all"
              >
                {submitting ? (
                  <><Loader2 size={15} className="animate-spin" /> Confirming…</>
                ) : (
                  <><CheckCircle2 size={15} /> Confirm reservation</>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
