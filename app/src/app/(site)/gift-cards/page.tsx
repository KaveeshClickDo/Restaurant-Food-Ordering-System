"use client";

import { useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useApp } from "@/context/AppContext";
import { Gift, Mail, Loader2, Lock, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";

// Stripe.js singleton — same pattern as CheckoutModal.
let _stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise(): Promise<StripeJs | null> {
  if (_stripePromise) return _stripePromise;
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) { _stripePromise = Promise.resolve(null); return _stripePromise; }
  _stripePromise = loadStripe(key);
  return _stripePromise;
}

type Step = "form" | "payment" | "success";

export default function GiftCardsPage() {
  const { settings, currentUser } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const gc  = settings.giftCardSettings;

  const presets    = gc?.presets ?? [10, 25, 50, 100];
  const minAmount  = gc?.minAmount ?? 5;
  const maxAmount  = gc?.maxAmount ?? 500;
  const enabled    = gc?.enabled ?? true;

  const [step, setStep] = useState<Step>("form");
  const [amount, setAmount] = useState<number>(presets[1] ?? 25);
  const [customAmount, setCustomAmount] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sendToMe, setSendToMe] = useState(false);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  // Effective amount — custom overrides preset when a valid custom value is set.
  const effectiveAmount = customAmount.trim()
    ? Math.round((parseFloat(customAmount) || 0) * 100) / 100
    : amount;

  function validate(): string | null {
    if (effectiveAmount < minAmount) return `Minimum amount is ${sym}${minAmount}.`;
    if (effectiveAmount > maxAmount) return `Maximum amount is ${sym}${maxAmount}.`;
    const email = sendToMe ? (currentUser?.email ?? "") : recipientEmail.trim();
    if (!email) return sendToMe ? "Sign in or untick 'send to me' and enter an email." : "Recipient email is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
    if (!sendToMe && !recipientName.trim()) return "Recipient name is required.";
    return null;
  }

  async function startPurchase() {
    if (inFlight.current) return;
    const err = validate();
    if (err) { setError(err); return; }
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    try {
      const email = sendToMe ? (currentUser?.email ?? "") : recipientEmail.trim();
      const name  = sendToMe ? (currentUser?.name ?? "You") : recipientName.trim();
      const res = await fetch("/api/gift-cards/intent", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          amount: effectiveAmount,
          recipientEmail: email,
          recipientName:  name,
          personalMessage: message.trim() || undefined,
        }),
      });
      const json = await res.json() as { ok: boolean; clientSecret?: string; error?: string };
      if (!json.ok || !json.clientSecret) {
        setError(json.error ?? "Could not start the purchase. Please try again.");
        return;
      }
      setClientSecret(json.clientSecret);
      setStep("payment");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (!enabled) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <Gift size={40} className="mx-auto text-zinc-300 mb-3" />
        <h1 className="text-xl font-bold text-zinc-800">Gift cards unavailable</h1>
        <p className="text-sm text-zinc-500 mt-1">Gift card sales are currently turned off. Please check back later.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-orange-100 flex items-center justify-center flex-shrink-0">
          <Gift size={22} className="text-orange-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Gift Cards</h1>
          <p className="text-sm text-zinc-500">Give the gift of a great meal at {settings.restaurant.name}.</p>
        </div>
      </div>

      {step === "form" && (
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5 sm:p-6 space-y-5">
          {/* Amount */}
          <div>
            <label className="block text-sm font-semibold text-zinc-700 mb-2">Amount</label>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => { setAmount(p); setCustomAmount(""); setError(""); }}
                  className={`py-3 rounded-xl text-sm font-bold border-2 transition ${
                    !customAmount && amount === p
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-zinc-200 text-zinc-700 hover:border-orange-300"
                  }`}
                >
                  {sym}{p}
                </button>
              ))}
            </div>
            <div className="relative mt-3">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">{sym}</span>
              <input
                type="number"
                min={minAmount}
                max={maxAmount}
                value={customAmount}
                onChange={(e) => { setCustomAmount(e.target.value); setError(""); }}
                placeholder={`Custom amount (${sym}${minAmount}–${sym}${maxAmount})`}
                className="w-full pl-7 pr-4 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
              />
            </div>
          </div>

          {/* Send to me toggle */}
          {currentUser && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={sendToMe} onChange={(e) => { setSendToMe(e.target.checked); setError(""); }} className="accent-orange-500" />
              <span className="text-sm text-zinc-700">Send the card to me ({currentUser.email})</span>
            </label>
          )}

          {/* Recipient fields — hidden when sending to self */}
          {!sendToMe && (
            <>
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Recipient name</label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => { setRecipientName(e.target.value); setError(""); }}
                  placeholder="Who's it for?"
                  className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Recipient email</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => { setRecipientEmail(e.target.value); setError(""); }}
                    placeholder="recipient@example.com"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                  />
                </div>
                <p className="text-xs text-zinc-400 mt-1">We&apos;ll email the code here once payment completes.</p>
              </div>
            </>
          )}

          {/* Personal message */}
          <div>
            <label className="block text-sm font-semibold text-zinc-700 mb-1.5">Personal message <span className="text-zinc-400 font-normal">(optional)</span></label>
            <textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Happy birthday — enjoy a meal on me!"
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <button
            onClick={() => void startPurchase()}
            disabled={submitting}
            className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white font-bold px-2 py-3.5 text-[15px] sm:text-base rounded-xl transition flex items-center justify-center gap-2"
          >
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Preparing…</> : <>Continue to payment · {sym}{effectiveAmount.toFixed(2)}</>}
          </button>
        </div>
      )}

      {step === "payment" && clientSecret && (
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5 sm:p-6">
          <button onClick={() => setStep("form")} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 mb-4">
            <ArrowLeft size={14} /> Back
          </button>
          <Elements stripe={getStripePromise()} options={{ clientSecret, appearance: { theme: "stripe" } }}>
            <GiftCardPaymentForm
              amountLabel={`${sym}${effectiveAmount.toFixed(2)}`}
              onPaid={() => setStep("success")}
            />
          </Elements>
        </div>
      )}

      {step === "success" && (
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-8 text-center space-y-4">
          <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={28} className="text-green-500" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900">Gift card purchased!</h2>
          <p className="text-sm text-zinc-500">
            {sendToMe
              ? "Check your inbox — we've emailed your gift card code."
              : `We've emailed the gift card code to ${recipientEmail}.`}
          </p>
          <p className="text-xs text-zinc-400">The recipient can redeem it at checkout or at the till. It&apos;s valid for 12 months.</p>
        </div>
      )}
    </div>
  );
}

// Inner card form — lives inside <Elements> so it can use Stripe hooks. The
// webhook is the source of truth for minting the gift card; we just confirm
// the payment here and show success on a clean result.
function GiftCardPaymentForm({ amountLabel, onPaid }: { amountLabel: string; onPaid: () => void }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const returnUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://example.com/gift-cards";
    return `${window.location.origin}/gift-cards`;
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || !stripe || !elements) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
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
      inFlight.current = false;
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
        className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white font-bold px-2 py-3.5 text-[15px] sm:text-base rounded-xl transition flex items-center justify-center gap-2"
      >
        {submitting ? <><Loader2 size={16} className="animate-spin" /> Processing…</> : <><Lock size={14} /> Pay {amountLabel}</>}
      </button>
      <p className="text-[10px] text-zinc-400 text-center">Payments are processed securely by Stripe.</p>
    </form>
  );
}
