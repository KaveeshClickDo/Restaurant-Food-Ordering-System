"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CalendarDays, Clock, Users, UtensilsCrossed, CheckCircle2,
  Loader2, AlertCircle, MapPin, ChevronLeft, ChevronRight,
} from "lucide-react";

interface AvailableTable { id: string; label: string; seats: number; section: string; }
type Step = "datetime" | "table" | "details" | "confirmed";

function toMins(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function generateSlots(open: string, close: string, interval: number): string[] {
  const slots: string[] = [];
  for (let t = toMins(open); t < toMins(close); t += interval) {
    const h = Math.floor(t / 60).toString().padStart(2, "0");
    const m = (t % 60).toString().padStart(2, "0");
    slots.push(`${h}:${m}`);
  }
  return slots;
}
function fmt12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function fmtDate(d: string) {
  const [y, mo, day] = d.split("-").map(Number);
  return new Date(y, mo - 1, day).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
// Use local date (not UTC) so users east of UTC+0 don't see yesterday
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function maxDateStr(days: number) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Current local time in minutes
function nowLocalMins() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
// A slot is past only when the selected date is today
function isSlotPast(slot: string, selectedDate: string): boolean {
  return selectedDate === todayStr() && toMins(slot) <= nowLocalMins();
}

const STEPS = ["Date & Time", "Table", "Details"];

export default function BookPage() {
  // Settings fetched from the public API
  const [rsSettings, setRsSettings] = useState<{
    openTime: string; closeTime: string; slotIntervalMinutes: number; maxAdvanceDays: number; maxPartySize: number;
  } | null>(null);
  const [restaurantName, setRestaurantName] = useState("Reserve a Table");

  useEffect(() => {
    fetch("/api/settings/public").then((r) => r.json()).then((j) => {
      if (j?.reservationSystem) setRsSettings(j.reservationSystem);
      if (j?.restaurant?.name) setRestaurantName(j.restaurant.name);
    }).catch(() => {});
  }, []);

  const open    = rsSettings?.openTime            ?? "12:00";
  const close   = rsSettings?.closeTime           ?? "22:00";
  const interval= rsSettings?.slotIntervalMinutes ?? 30;
  const maxDays = rsSettings?.maxAdvanceDays       ?? 30;
  const maxPS   = rsSettings?.maxPartySize         ?? 10;
  const slots   = generateSlots(open, close, interval);

  const [step,          setStep]          = useState<Step>("datetime");
  const [date,          setDate]          = useState(todayStr());
  const [time,          setTime]          = useState("");
  const [partySize,     setPartySize]     = useState(2);
  const [tables,        setTables]        = useState<AvailableTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<AvailableTable | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);
  const [availError,    setAvailError]    = useState("");
  const [blackout,      setBlackout]      = useState(false);
  const [name,          setName]          = useState("");
  const [email,         setEmail]         = useState("");
  const [phone,         setPhone]         = useState("");
  const [note,          setNote]          = useState("");
  const [submitting,    setSubmitting]    = useState(false);
  const [submitError,   setSubmitError]   = useState("");
  const [reservationId, setReservationId] = useState("");

  // When slots load or date changes, default to the first future slot (never a past one)
  useEffect(() => {
    const firstValid = slots.find((s) => !isSlotPast(s, date));
    if (firstValid && (!time || isSlotPast(time, date))) setTime(firstValid ?? "");
  }, [slots, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchTables = useCallback(async () => {
    setLoadingTables(true); setAvailError(""); setBlackout(false); setSelectedTable(null);
    try {
      const res  = await fetch(`/api/reservations/availability?date=${date}&time=${time}&partySize=${partySize}`);
      const json = await res.json() as { ok: boolean; availableTables?: AvailableTable[]; error?: string; blackout?: boolean };
      if (json.blackout) { setBlackout(true); setTables([]); }
      else if (json.ok)  { setTables(json.availableTables ?? []); }
      else               { setAvailError(json.error ?? "Failed to check availability."); }
    } catch { setAvailError("Network error — please try again."); }
    finally { setLoadingTables(false); }
  }, [date, time, partySize]);

  useEffect(() => { if (step === "table") fetchTables(); }, [step, fetchTables]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!selectedTable) return;
    setSubmitting(true); setSubmitError("");
    try {
      const res  = await fetch("/api/reservations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: selectedTable.id, date, time, partySize,
          customerName: name.trim(), customerEmail: email.trim(), customerPhone: phone.trim(),
          note: note.trim(), source: "online" }),
      });
      const json = await res.json() as { ok: boolean; reservationId?: string; error?: string };
      if (json.ok && json.reservationId) { setReservationId(json.reservationId); setStep("confirmed"); }
      else { setSubmitError(json.error ?? "Failed to create reservation."); }
    } catch { setSubmitError("Network error — please try again."); }
    finally { setSubmitting(false); }
  }

  const tablesBySection = tables.reduce<Record<string, AvailableTable[]>>((acc, t) => {
    (acc[t.section] = acc[t.section] ?? []).push(t); return acc;
  }, {});

  const stepIdx = step === "datetime" ? 0 : step === "table" ? 1 : step === "details" ? 2 : 3;

  if (step === "confirmed") {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center space-y-5">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle2 size={40} className="text-green-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Booking Confirmed!</h1>
            <p className="text-gray-500 text-sm mt-1">We look forward to welcoming you at {restaurantName}.</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-left space-y-2.5 text-sm">
            <p><span className="text-gray-500">Date:</span> <span className="font-semibold text-gray-800">{fmtDate(date)}</span></p>
            <p><span className="text-gray-500">Time:</span> <span className="font-semibold text-gray-800">{fmt12(time)}</span></p>
            <p><span className="text-gray-500">Guests:</span> <span className="font-semibold text-gray-800">{partySize}</span></p>
            <p><span className="text-gray-500">Table:</span> <span className="font-semibold text-gray-800">{selectedTable?.label} — {selectedTable?.section}</span></p>
            <p><span className="text-gray-500">Name:</span> <span className="font-semibold text-gray-800">{name}</span></p>
            <p className="text-xs text-gray-400 pt-1">Ref: <span className="font-mono">{reservationId.slice(0, 8).toUpperCase()}</span></p>
          </div>
          <p className="text-xs text-gray-400">A confirmation email has been sent. Check your inbox for a cancel link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-8 px-4">
      <div className="max-w-lg mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <CalendarDays size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-lg leading-tight">Reserve a Table</h1>
            <p className="text-gray-400 text-xs">{restaurantName}</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${i <= stepIdx ? "text-zinc-700" : "text-gray-400"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  i < stepIdx ? "bg-orange-500 text-white" : i === stepIdx ? "bg-zinc-100 text-zinc-700 ring-2 ring-zinc-300" : "bg-gray-100 text-gray-400"
                }`}>
                  {i < stepIdx ? <CheckCircle2 size={12} /> : i + 1}
                </div>
                <span className="hidden sm:block">{label}</span>
              </div>
              {i < 2 && <div className={`h-0.5 flex-1 rounded ${i < stepIdx ? "bg-zinc-400" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">

          {/* Step 1: Date / Time / Party */}
          {step === "datetime" && (
            <div className="p-5 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <CalendarDays size={13} className="inline mr-1.5 text-zinc-700" />Date
                </label>
                <input type="date" value={date} min={todayStr()} max={maxDateStr(maxDays)}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 transition" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <Users size={13} className="inline mr-1.5 text-zinc-700" />Party size
                </label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setPartySize((p) => Math.max(1, p - 1))}
                    className="w-10 h-10 rounded-full border border-gray-200 text-gray-600 hover:border-zinc-400 hover:text-zinc-700 font-bold text-lg transition flex items-center justify-center">−</button>
                  <span className="text-2xl font-bold text-gray-900 w-8 text-center">{partySize}</span>
                  <button type="button" onClick={() => setPartySize((p) => Math.min(maxPS, p + 1))}
                    className="w-10 h-10 rounded-full border border-gray-200 text-gray-600 hover:border-zinc-400 hover:text-zinc-700 font-bold text-lg transition flex items-center justify-center">+</button>
                  <span className="text-sm text-gray-400">{partySize === 1 ? "1 guest" : `${partySize} guests`}</span>
                </div>
                {partySize >= maxPS && <p className="text-xs text-amber-600 mt-1">Maximum party size is {maxPS}. Call us for larger groups.</p>}
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  <Clock size={13} className="inline mr-1.5 text-zinc-700" />Time
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {slots.map((slot) => {
                    const past = isSlotPast(slot, date);
                    const selected = time === slot;
                    return (
                      <button key={slot} type="button"
                        disabled={past}
                        onClick={() => !past && setTime(slot)}
                        title={past ? "Time has passed" : undefined}
                        className={`py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                          past
                            ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed line-through"
                            : selected
                              ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                              : "bg-white text-gray-600 border-gray-200 hover:border-zinc-300 hover:text-zinc-700"
                        }`}>{fmt12(slot)}</button>
                    );
                  })}
                </div>
                {slots.length === 0 && <p className="text-sm text-gray-400 mt-2">No time slots — please contact us directly.</p>}
                {slots.length > 0 && slots.every((s) => isSlotPast(s, date)) && (
                  <p className="text-sm text-amber-600 mt-2">All slots for today have passed. Please select a future date.</p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Table selection */}
          {step === "table" && (
            <div className="p-5">
              <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 mb-5 text-sm text-zinc-700 font-medium">
                {fmtDate(date)} · {fmt12(time)} · {partySize} {partySize === 1 ? "guest" : "guests"}
              </div>
              {loadingTables ? (
                <div className="flex flex-col items-center py-12 gap-3 text-gray-400">
                  <Loader2 size={28} className="animate-spin text-zinc-700" />
                  <span className="text-sm">Checking availability…</span>
                </div>
              ) : blackout ? (
                <div className="flex flex-col items-center py-12 gap-3 text-center">
                  <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
                    <CalendarDays size={24} className="text-amber-500" />
                  </div>
                  <p className="font-semibold text-gray-700">Restaurant closed</p>
                  <p className="text-sm text-gray-400">We&apos;re not taking bookings on this date. Please choose another day.</p>
                  <button onClick={() => setStep("datetime")} className="mt-2 text-zinc-700 font-semibold text-sm hover:text-zinc-800 transition">← Change date</button>
                </div>
              ) : availError ? (
                <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Availability check failed</p>
                    <p>{availError}</p>
                    <button onClick={fetchTables} className="mt-2 font-semibold underline">Retry</button>
                  </div>
                </div>
              ) : tables.length === 0 ? (
                <div className="flex flex-col items-center py-12 gap-3 text-center">
                  <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                    <UtensilsCrossed size={24} className="text-gray-400" />
                  </div>
                  <p className="font-semibold text-gray-700">No tables available</p>
                  <p className="text-sm text-gray-400 max-w-xs">All tables are fully booked for this slot. Try a different time or date.</p>
                  <button onClick={() => setStep("datetime")} className="mt-2 text-zinc-700 font-semibold text-sm hover:text-zinc-800 transition">← Change date / time</button>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(tablesBySection).map(([section, st]) => (
                    <div key={section}>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        <MapPin size={11} />{section}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {st.map((t) => {
                          const sel = selectedTable?.id === t.id;
                          return (
                            <button key={t.id} type="button" onClick={() => setSelectedTable(t)}
                              className={`flex flex-col items-center gap-1.5 py-4 px-3 rounded-xl border-2 transition-all ${
                                sel ? "border-orange-500 bg-orange-50 shadow-sm" : "border-gray-200 bg-white hover:border-zinc-300"
                              }`}>
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${sel ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600"}`}>{t.label}</div>
                              <span className={`text-xs font-medium ${sel ? "text-orange-700" : "text-gray-500"}`}>Up to {t.seats} guests</span>
                              {sel && <CheckCircle2 size={14} className="text-orange-600" />}
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

          {/* Step 3: Customer details */}
          {step === "details" && (
            <form id="book-form" onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 text-sm text-zinc-700 font-medium">
                {selectedTable?.label} · {fmtDate(date)} · {fmt12(time)} · {partySize} guests
              </div>
              {[
                { label: "Full name", type: "text",  value: name,  setter: setName,  ph: "Jane Smith",       req: true  },
                { label: "Email",     type: "email", value: email, setter: setEmail, ph: "jane@example.com", req: true  },
                { label: "Phone",     type: "tel",   value: phone, setter: setPhone, ph: "+44 7700 900123",  req: true  },
              ].map(({ label, type, value, setter, ph, req }) => (
                <div key={label}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    {label} {req && <span className="text-red-400">*</span>}
                  </label>
                  <input type={type} required={req} value={value} placeholder={ph}
                    onChange={(e) => setter(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 transition" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Special requests <span className="text-gray-300 font-normal normal-case">(optional)</span>
                </label>
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Allergies, dietary requirements, special occasion…"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-300 transition" />
              </div>
              {submitError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                  <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />{submitError}
                </div>
              )}
            </form>
          )}

          {/* Footer nav */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100 bg-gray-50">
            {step !== "datetime" ? (
              <button type="button" onClick={() => setStep(step === "table" ? "datetime" : "table")}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 transition">
                <ChevronLeft size={16} />Back
              </button>
            ) : <span />}

            {step === "datetime" && (
              <button type="button"
                disabled={!date || !time || slots.length === 0 || isSlotPast(time, date)}
                onClick={() => setStep("table")}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all">
                Check availability<ChevronRight size={16} />
              </button>
            )}
            {step === "table" && (
              <button type="button" disabled={!selectedTable || loadingTables || blackout}
                onClick={() => setStep("details")}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all">
                Continue<ChevronRight size={16} />
              </button>
            )}
            {step === "details" && (
              <button type="submit" form="book-form" disabled={submitting || !name.trim() || !email.trim() || !phone.trim()}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all">
                {submitting ? <><Loader2 size={15} className="animate-spin" />Confirming…</> : <><CheckCircle2 size={15} />Confirm booking</>}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400">Powered by {restaurantName}</p>
      </div>
    </div>
  );
}
