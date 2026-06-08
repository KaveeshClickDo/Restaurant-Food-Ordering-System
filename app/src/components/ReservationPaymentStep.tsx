"use client";

/**
 * VIP booking-fee payment step for the public reservation flow.
 *
 * Self-contained card (Stripe) + PayPal payment UI. On mount the buyer picks a
 * method; we POST the booking to /api/reservations/intent to mint a Stripe
 * PaymentIntent or PayPal order, then render the matching widget. The
 * reservation itself is created by the webhook once the fee is captured, so on
 * success we just call onPaid() and the modal shows a "check your email" screen.
 *
 * Mirrors the order checkout's payment wiring (CheckoutModal) but scoped to a
 * single fixed fee with no address/total recalculation.
 */

import { useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { CreditCard, Wallet, Lock, Loader2, AlertCircle, ChevronLeft } from "lucide-react";

const PAYPAL_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";

// Stripe.js singleton — avoid re-downloading on every mount.
let _stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise(): Promise<StripeJs | null> {
  if (_stripePromise) return _stripePromise;
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) { _stripePromise = Promise.resolve(null); return _stripePromise; }
  _stripePromise = loadStripe(key);
  return _stripePromise;
}

export interface ReservationBookingPayload {
  tableId: string;
  date: string;
  time: string;
  partySize: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  note?: string;
}

interface Props {
  payload: ReservationBookingPayload;
  fee: number;
  currencyCode: string;
  currencySymbol: string;
  tableLabel: string;
  onPaid: () => void;
  onBack: () => void;
}

type Method = "card" | "paypal";

export default function ReservationPaymentStep({
  payload, fee, currencyCode, currencySymbol, tableLabel, onPaid, onBack,
}: Props) {
  const [method, setMethod]               = useState<Method | null>(null);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [clientSecret, setClientSecret]   = useState<string | null>(null);
  const [paypalOrderId, setPaypalOrderId] = useState<string | null>(null);

  const amountLabel = `${currencySymbol}${fee.toFixed(2)}`;

  async function startPayment(chosen: Method) {
    if (loading) return;
    setMethod(chosen);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/reservations/intent", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...payload, gateway: chosen === "card" ? "stripe" : "paypal" }),
      });
      const j = await res.json() as {
        ok: boolean; clientSecret?: string; paypalOrderId?: string; error?: string;
      };
      if (!j.ok) {
        setError(j.error ?? "Could not start payment. Please try again.");
        setMethod(null);
        return;
      }
      if (chosen === "card") {
        if (!j.clientSecret) { setError("Card payment is unavailable right now."); setMethod(null); return; }
        setClientSecret(j.clientSecret);
      } else {
        if (!j.paypalOrderId) { setError("PayPal is unavailable right now."); setMethod(null); return; }
        setPaypalOrderId(j.paypalOrderId);
      }
    } catch {
      setError("Network error — please try again.");
      setMethod(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-5 space-y-4">
      {/* Fee summary */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-800">VIP table {tableLabel} — booking fee</p>
          <p className="text-[11px] text-amber-600">Non-refundable. Charged to confirm your reservation.</p>
        </div>
        <span className="text-lg font-bold text-amber-900">{amountLabel}</span>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* Method picker (before a method is chosen) */}
      {!clientSecret && !paypalOrderId && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => startPayment("card")}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition"
          >
            {loading && method === "card"
              ? <><Loader2 size={16} className="animate-spin" /> Preparing…</>
              : <><CreditCard size={16} /> Pay by card</>}
          </button>
          {PAYPAL_CLIENT_ID && (
            <button
              type="button"
              disabled={loading}
              onClick={() => startPayment("paypal")}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition"
            >
              {loading && method === "paypal"
                ? <><Loader2 size={16} className="animate-spin" /> Preparing…</>
                : <><Wallet size={16} /> PayPal</>}
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="w-full flex items-center justify-center gap-1.5 text-gray-500 hover:text-gray-700 text-sm font-semibold py-2"
          >
            <ChevronLeft size={15} /> Back
          </button>
        </div>
      )}

      {/* Stripe card form */}
      {clientSecret && (
        <Elements
          stripe={getStripePromise()}
          options={{
            clientSecret,
            appearance: { theme: "stripe", variables: { colorPrimary: "#f97316" } },
          }}
        >
          <CardForm amountLabel={amountLabel} onPaid={onPaid} />
        </Elements>
      )}

      {/* PayPal buttons */}
      {paypalOrderId && (
        <PayPalScriptProvider options={{ clientId: PAYPAL_CLIENT_ID, currency: currencyCode, intent: "capture" }}>
          <PaypalButtonsInner paypalOrderId={paypalOrderId} onPaid={onPaid} />
        </PayPalScriptProvider>
      )}
    </div>
  );
}

// ─── Stripe card form ─────────────────────────────────────────────────────────
function CardForm({ amountLabel, onPaid }: { amountLabel: string; onPaid: () => void }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const returnUrl = typeof window !== "undefined"
        ? `${window.location.origin}/checkout-return`
        : "https://example.com/checkout-return";
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (stripeError) { setError(stripeError.message ?? "Payment could not be processed."); return; }
      if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
        onPaid();
        return;
      }
      setError(`Payment status: ${paymentIntent?.status ?? "unknown"}. Please try again.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-bold py-3.5 rounded-xl transition flex items-center justify-center gap-2"
      >
        {submitting
          ? <><Loader2 size={16} className="animate-spin" /> Processing…</>
          : <><Lock size={14} /> Pay {amountLabel}</>}
      </button>
      <p className="text-[10px] text-gray-400 text-center">
        Payments are processed securely by Stripe. Your card details are never stored on our servers.
      </p>
    </form>
  );
}

// ─── PayPal buttons ─────────────────────────────────────────────────────────
function PaypalButtonsInner({ paypalOrderId, onPaid }: { paypalOrderId: string; onPaid: () => void }) {
  const [error, setError]         = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  return (
    <div className="space-y-3">
      <PayPalButtons
        style={{ layout: "vertical", shape: "rect", label: "paypal" }}
        disabled={capturing}
        createOrder={() => Promise.resolve(paypalOrderId)}
        onApprove={async (data) => {
          setCapturing(true);
          setError(null);
          try {
            const r = await fetch("/api/payments/paypal/capture", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ paypalOrderId: data.orderID }),
            });
            const j = await r.json() as { ok: boolean; error?: string };
            if (!j.ok) { setError(j.error ?? "PayPal could not complete the payment."); return; }
            onPaid();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Network error capturing PayPal payment.");
          } finally {
            setCapturing(false);
          }
        }}
        onError={(err) => setError(err instanceof Error ? err.message : "PayPal encountered an error.")}
      />
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
      {capturing && (
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <Loader2 size={14} className="animate-spin" /> Finalising your payment…
        </div>
      )}
    </div>
  );
}
