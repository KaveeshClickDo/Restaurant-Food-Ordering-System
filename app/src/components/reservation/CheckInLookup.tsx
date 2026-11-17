"use client";

/**
 * "Check in a guest" for the POS Reservations tab and the admin Reservations
 * panel. One box takes all three ways in:
 *   - a plug-in barcode scanner (works even when nothing is clicked, see
 *     useScannerWedge),
 *   - the booking reference typed by hand,
 *   - the device camera (CameraScanModal).
 * It finds the booking, shows who it is, and checks the guest in. The rules
 * (lib/reservationCheckIn.ts) are enforced by the server; this screen only
 * words them.
 */

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle, Camera, CalendarDays, CheckCircle2, Crown, Loader2, Phone, Receipt, ScanLine,
  Users, UtensilsCrossed, X,
} from "lucide-react";
import { apiBase } from "@/lib/apiBase";
import {
  bookingReference, checkInBlockMessage, formatBookingDay, formatBookingTime, localDateString,
  type CheckInEligibility, type CheckInReservation,
} from "@/lib/reservationCheckIn";
import { useScannerWedge } from "./useScannerWedge";
import CameraScanModal from "./CameraScanModal";

type Found = { reservation: CheckInReservation; eligibility: CheckInEligibility };

type ApiReply = {
  ok: boolean;
  error?: string;
  reservation?: CheckInReservation;
  eligibility?: CheckInEligibility;
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending:     { label: "Pending",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmed:   { label: "Confirmed",  cls: "bg-green-50 text-green-700 border-green-200" },
  checked_in:  { label: "Dining",     cls: "bg-blue-50 text-blue-700 border-blue-200" },
  checked_out: { label: "Done",       cls: "bg-teal-50 text-teal-700 border-teal-200" },
  cancelled:   { label: "Cancelled",  cls: "bg-red-50 text-red-700 border-red-200" },
  no_show:     { label: "No show",    cls: "bg-gray-100 text-gray-600 border-gray-300" },
};

export default function CheckInLookup({
  surface,
  theme,
  currencySymbol = "£",
  onCheckedIn,
  onViewReceipt,
}: {
  surface: "pos" | "admin";
  theme: "dark" | "light";
  currencySymbol?: string;
  /** Called after a successful check-in, e.g. to refresh the bookings list. */
  onCheckedIn?: (reservation: CheckInReservation) => void;
  /** Opens the booking receipt; the result window closes first. */
  onViewReceipt?: (reservation: CheckInReservation) => void;
}) {
  const base = surface === "pos" ? `${apiBase()}/api/pos/reservations` : "/api/admin/reservations";
  const dark = theme === "dark";

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const [justCheckedIn, setJustCheckedIn] = useState(false);
  const lookupInFlight = useRef(false);

  const lookup = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code || lookupInFlight.current) return;
    lookupInFlight.current = true;
    setBusy(true);
    setError("");
    setCheckInError("");
    setJustCheckedIn(false);
    try {
      const res = await fetch(`${base}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, today: localDateString() }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as ApiReply;
      if (json.ok && json.reservation && json.eligibility) {
        setFound({ reservation: json.reservation, eligibility: json.eligibility });
        setValue("");
      } else {
        setFound(null);
        setError(json.error ?? "Couldn't find that booking. Check the reference, or search by the guest's name.");
      }
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      lookupInFlight.current = false;
      setBusy(false);
    }
  }, [base]);

  // A plug-in scanner works anywhere on the screen, except while the camera is open.
  useScannerWedge(lookup, !cameraOpen);

  async function checkIn() {
    if (!found || checkingIn) return;
    setCheckingIn(true);
    setCheckInError("");
    try {
      const res = await fetch(`${base}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: found.reservation.id, today: localDateString() }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as ApiReply;
      if (json.ok && json.reservation) {
        setFound({ reservation: json.reservation, eligibility: { canCheckIn: false, block: "checked_in" } });
        setJustCheckedIn(true);
        onCheckedIn?.(json.reservation);
      } else if (json.reservation && json.eligibility) {
        // Refused: the booking changed (another device, a cancellation). Show why.
        setFound({ reservation: json.reservation, eligibility: json.eligibility });
      } else {
        setCheckInError(json.error ?? "Couldn't check the guest in. Please try again.");
      }
    } catch {
      setCheckInError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setCheckingIn(false);
    }
  }

  function closeResult() {
    setFound(null);
    setCheckInError("");
    setJustCheckedIn(false);
  }

  const r = found?.reservation;
  const status = r ? STATUS_LABELS[r.status] ?? { label: r.status, cls: "bg-gray-100 text-gray-600 border-gray-300" } : null;

  return (
    <>
      {/* ── The box ───────────────────────────────────────────────────── */}
      <div className={dark
        ? "bg-slate-800/70 border border-slate-700 rounded-2xl p-3 sm:p-4"
        : "bg-white border border-gray-200 rounded-2xl p-3 sm:p-4 shadow-sm"}>
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          <ScanLine size={16} className={dark ? "text-orange-400" : "text-orange-500"} />
          <p className={`font-semibold text-sm ${dark ? "text-white" : "text-gray-900"}`}>Check in a guest</p>
          <p className={`text-xs ${dark ? "text-slate-400" : "text-gray-400"}`}>
            Scan their QR code, or type the booking reference
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); void lookup(value); }}
        >
          <input
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(""); }}
            placeholder="Scan QR or type reference, e.g. A1B2C3D4"
            aria-label="Booking QR code or reference"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={dark
              ? "flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 font-mono outline-none focus:border-orange-500"
              : "flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 font-mono outline-none focus:border-orange-400"}
          />
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors flex-shrink-0"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            Find
          </button>
          <button
            type="button"
            onClick={() => { setError(""); setCameraOpen(true); }}
            title="Scan with this device's camera"
            className={dark
              ? "flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 text-sm font-semibold px-3 sm:px-4 py-2.5 rounded-xl transition-colors flex-shrink-0"
              : "flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-700 text-sm font-semibold px-3 sm:px-4 py-2.5 rounded-xl transition-colors flex-shrink-0"}
          >
            <Camera size={15} />
            <span className="hidden sm:inline">Camera</span>
          </button>
        </form>
        {error && (
          <p role="alert" className={`mt-2 text-xs flex items-start gap-1.5 ${dark ? "text-red-300" : "text-red-600"}`}>
            <AlertTriangle size={13} className="flex-shrink-0 mt-px" /> {error}
          </p>
        )}
      </div>

      {/* ── Camera ────────────────────────────────────────────────────── */}
      {cameraOpen && (
        <CameraScanModal
          onResult={(text) => { setCameraOpen(false); void lookup(text); }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* ── Result ────────────────────────────────────────────────────── */}
      {found && r && status && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Booking ${bookingReference(r.id)}`}
          onClick={closeResult}
        >
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono font-semibold text-gray-400 tracking-wider">BOOKING {bookingReference(r.id)}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wide border px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
                </div>
                <p className="text-lg font-bold text-gray-900 truncate mt-0.5">{r.customer_name}</p>
              </div>
              <button onClick={closeResult} aria-label="Close" className="text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-2 text-sm text-gray-700">
              <p className="flex items-center gap-2"><Users size={15} className="text-orange-500 flex-shrink-0" />{r.party_size} {r.party_size === 1 ? "guest" : "guests"}</p>
              <p className="flex items-center gap-2"><CalendarDays size={15} className="text-orange-500 flex-shrink-0" />{formatBookingDay(r.date)}, {formatBookingTime(r.time)}</p>
              <p className="flex items-center gap-2"><UtensilsCrossed size={15} className="text-orange-500 flex-shrink-0" />{r.table_label}{r.section ? <span className="text-gray-400">· {r.section}</span> : null}</p>
              {r.customer_phone && (
                <p className="flex items-center gap-2"><Phone size={15} className="text-orange-500 flex-shrink-0" />{r.customer_phone}</p>
              )}
              {r.vip_fee > 0 && (
                <p className="flex items-center gap-2 text-amber-700">
                  <Crown size={15} className="text-amber-500 flex-shrink-0" />
                  VIP booking fee {currencySymbol}{r.vip_fee.toFixed(2)}{r.payment_status === "paid" ? " · paid" : ""}
                </p>
              )}
              {r.note && (
                <p className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800 text-xs italic">&ldquo;{r.note}&rdquo;</p>
              )}
            </div>

            <div className="px-5 pb-5 space-y-3">
              {justCheckedIn ? (
                <div role="status" className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-green-800 text-sm font-semibold">
                  <CheckCircle2 size={17} className="text-green-600 flex-shrink-0" />
                  Checked in · {r.table_label}
                </div>
              ) : found.eligibility.canCheckIn ? (
                <p className="text-sm text-green-700 font-medium">Booked for {formatBookingTime(r.time)} today.</p>
              ) : (
                <div role="alert" className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-amber-900 text-sm">
                  <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  {checkInBlockMessage(r, found.eligibility.block ?? "other")}
                </div>
              )}
              {checkInError && (
                <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{checkInError}</p>
              )}

              <div className="flex gap-2">
                {found.eligibility.canCheckIn && !justCheckedIn && (
                  <button
                    onClick={() => void checkIn()}
                    disabled={checkingIn}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white font-semibold text-sm py-3 rounded-xl transition-colors"
                  >
                    {checkingIn ? <><Loader2 size={15} className="animate-spin" /> Checking in…</> : <><CheckCircle2 size={15} /> Check in</>}
                  </button>
                )}
                {onViewReceipt && (
                  <button
                    onClick={() => { const res = r; closeResult(); onViewReceipt(res); }}
                    className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors"
                  >
                    <Receipt size={15} /> Receipt
                  </button>
                )}
                <button
                  onClick={closeResult}
                  className={`${found.eligibility.canCheckIn && !justCheckedIn ? "" : "flex-1 "}px-4 py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
