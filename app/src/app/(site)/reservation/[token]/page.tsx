"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  CalendarDays, Clock, Users, UtensilsCrossed, CheckCircle2,
  XCircle, Loader2, AlertTriangle, MapPin,
} from "lucide-react";

interface BookingDetails {
  id: string;
  customer_name: string;
  date: string;
  time: string;
  table_label: string;
  section: string;
  party_size: number;
  status: string;
  note?: string;
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

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:     { label: "Pending confirmation", color: "text-amber-600 bg-amber-50 dark:bg-amber-600/10 dark:border-amber-200 dark:border-amber-800" },
  confirmed:   { label: "Confirmed",            color: "text-green-700 bg-green-50 dark:bg-green-600/10 dark:border-green-200 dark:border-green-800" },
  checked_in:  { label: "Currently dining",     color: "text-blue-700 bg-blue-50 dark:bg-blue-600/10 dark:border-blue-200 dark:border-blue-800" },
  checked_out: { label: "Visit complete",       color: "text-teal-700 bg-teal-50 dark:bg-teal-600/10 dark:border-teal-200 dark:border-teal-800" },
  cancelled:   { label: "Cancelled",            color: "text-red-700 bg-red-50 dark:bg-red-600/10 dark:border-red-200 dark:border-red-800" },
  no_show:     { label: "No show",              color: "text-gray-600 bg-zinc-50 dark:bg-zinc-600/10 dark:border-zinc-200 dark:border-zinc-800" },
};

export default function ReservationTokenPage() {
  const { token } = useParams<{ token: string }>();

  const [booking,    setBooking]    = useState<BookingDetails | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [notFound,   setNotFound]   = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled,  setCancelled]  = useState(false);
  const [error,      setError]      = useState("");
  const [confirmed,  setConfirmed]  = useState(false);

  useEffect(() => {
    fetch(`/api/reservation/${token}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; reservation?: BookingDetails }) => {
        if (j.ok && j.reservation) setBooking(j.reservation);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  const cancelInFlight = useRef(false);

  async function handleCancel() {
    if (cancelInFlight.current) return;
    cancelInFlight.current = true;
    setCancelling(true);
    setError("");
    try {
      const res  = await fetch(`/api/reservation/${token}`, { method: "POST" });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setCancelled(true);
        setBooking((b) => b ? { ...b, status: "cancelled" } : b);
      } else {
        setError(json.error ?? "Could not cancel. Please contact us.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      cancelInFlight.current = false;
      setCancelling(false);
    }
  }

  const isCancellable = booking && (booking.status === "pending" || booking.status === "confirmed");

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-10">
        <Loader2 size={32} className="animate-spin text-zinc-600" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center h-full py-8">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertTriangle size={28} className="text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-[var(--brand-text-dark)]">Booking not found</h1>
        <p className="text-gray-500 dark:text-zinc-400 max-w-sm">
          This link may have expired or is invalid. Please contact us directly if you need help with your reservation.
        </p>
      </div>
    );
  }

  const statusInfo = booking ? (STATUS_LABELS[booking.status] ?? STATUS_LABELS.pending) : STATUS_LABELS.pending;

  return (
    <div className="py-12 px-4">
      <div className="max-w-md mx-auto space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <UtensilsCrossed size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-[var(--brand-text-dark)]">Your Reservation</h1>
          <p className="text-gray-500 dark:text-zinc-400 text-sm mt-1">Booking ref: {booking?.id.slice(0, 8).toUpperCase()}</p>
        </div>

        {/* Status badge */}
        {booking && (
          <div className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border text-sm font-semibold w-fit mx-auto ${statusInfo.color}`}>
            <span className="w-2 h-2 rounded-full bg-current opacity-70" />
            {statusInfo.label}
          </div>
        )}

        {/* Booking details card */}
        {booking && (
          <div className="bg-white dark:bg-[var(--brand-surface-dark)] rounded-2xl border border-zinc-200 dark:border-[var(--brand-border-dark)] shadow-sm p-6 space-y-4">
            <h2 className="font-bold text-gray-900 dark:text-[var(--brand-text-dark)] text-lg">{booking.customer_name}</h2>

            <div className="space-y-3">
              <div className="flex items-center gap-3 text-gray-700 dark:text-zinc-400">
                <CalendarDays size={18} className="text-zinc-600 dark:text-zinc-400 flex-shrink-0" />
                <span>{fmtDate(booking.date)}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-700 dark:text-zinc-400">
                <Clock size={18} className="text-zinc-600 dark:text-zinc-400 flex-shrink-0" />
                <span>{fmt12(booking.time)}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-700 dark:text-zinc-400">
                <Users size={18} className="text-zinc-600 dark:text-zinc-400 flex-shrink-0" />
                <span>{booking.party_size} {booking.party_size === 1 ? "guest" : "guests"}</span>
              </div>
              <div className="flex items-center gap-3 text-gray-700 dark:text-zinc-400">
                <UtensilsCrossed size={18} className="text-zinc-600 dark:text-zinc-400 flex-shrink-0" />
                <span>{booking.table_label}{booking.section ? ` · ${booking.section}` : ""}</span>
              </div>
              {booking.note && (
                <div className="flex items-start gap-3 text-gray-600 dark:text-zinc-400">
                  <MapPin size={18} className="text-zinc-600 dark:text-zinc-400 flex-shrink-0 mt-0.5" />
                  <span className="italic">&ldquo;{booking.note}&rdquo;</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Success state */}
        {cancelled && (
          <div className="bg-teal-50 dark:bg-teal-600/10 border border-teal-200 dark:border-teal-800 rounded-2xl p-5 flex items-start gap-3">
            <CheckCircle2 size={20} className="text-teal-600 dark:text-teal-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-teal-800 dark:text-teal-500">Booking cancelled</p>
              <p className="text-sm text-teal-700 dark:text-teal-400 mt-0.5">
                Your reservation has been cancelled. You should receive a confirmation email shortly.
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-600/10 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-center gap-3">
            <XCircle size={18} className="text-red-500 dark:text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-500">{error}</p>
          </div>
        )}

        {/* Cancel action */}
        {isCancellable && !cancelled && (
          <div className="bg-white dark:bg-[var(--brand-surface-dark)] rounded-2xl border border-zinc-200 dark:border-[var(--brand-border-dark)] shadow-sm p-5 space-y-3">
            {!confirmed ? (
              <>
                <p className="text-sm text-gray-600 dark:text-zinc-400">
                  Need to cancel your booking? Click below and we&apos;ll free up the table.
                </p>
                <button
                  onClick={() => setConfirmed(true)}
                  className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 active:scale-95 text-white font-semibold text-sm transition-all"
                >
                  Cancel my booking
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-gray-800 dark:text-zinc-200">Are you sure you want to cancel?</p>
                <p className="text-xs text-gray-500 dark:text-zinc-400">This cannot be undone. You&apos;ll need to make a new booking.</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirmed(false)}
                    className="flex-1 py-3 rounded-xl border border-zinc-200 dark:border-[var(--brand-border-dark)] text-gray-600 dark:text-zinc-300 font-semibold text-sm hover:bg-zinc-50 dark:hover:bg-white/5 transition"
                  >
                    Keep booking
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-semibold text-sm transition flex items-center justify-center gap-2"
                  >
                    {cancelling ? <Loader2 size={15} className="animate-spin" /> : null}
                    {cancelling ? "Cancelling…" : "Yes, cancel"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Non-cancellable info */}
        {booking && !isCancellable && !cancelled && booking.status !== "cancelled" && (
          <div className="bg-amber-50 dark:bg-amber-600/10 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 text-sm text-amber-800 dark:text-amber-700">
            This booking can no longer be cancelled online. Please contact us directly for assistance.
          </div>
        )}
      </div>
    </div>
  );
}
