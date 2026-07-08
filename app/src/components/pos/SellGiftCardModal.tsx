"use client";

/**
 * Sell (activate) an admin pre-issued gift card at the till.
 *
 * The cashier picked a physical card off the rack via the gold "Gift Cards"
 * category on the Sale tab. This modal takes the payment (cash/card), an
 * OPTIONAL recipient email (walk-ins aren't forced to leave one), and calls
 * POST /api/pos/gift-cards/[id]/activate — the moment the card becomes
 * redeemable and finance books the income on the POS slice.
 *
 * Gift card sales deliberately do NOT go through the cart: no VAT, no
 * discounts, no tips apply to prepaid money, and the income is booked from
 * the gift_cards table (not pos_sales) so it is never double-counted.
 */

import { useState } from "react";
import { apiBase } from "@/lib/apiBase";
import { Gift, X, Banknote, CreditCard, CheckCircle, Loader2 } from "lucide-react";
import { fmt } from "./_utils";

export interface SellableGiftCard {
  id: string;
  code: string;
  initialAmount: number;
  createdAt: string;
}

export default function SellGiftCardModal({ card, currencySymbol, onClose, onSold }: {
  card: SellableGiftCard;
  currencySymbol: string;
  onClose: () => void;
  /** Called after a successful activation so the caller can refresh the rack. */
  onSold: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sold, setSold] = useState(false);

  async function handleSell() {
    // Email is required — every till sale captures a marketing contact (with
    // the consent tick), same policy as the admin counter sale.
    if (!email.trim()) { setError("Customer email is required to sell the card."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase()}/api/pos/gift-cards/${card.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod,
          recipientEmail: email.trim(),
          recipientName:  name.trim() || undefined,
          sendEmail,
          marketingOptIn,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Couldn't activate the card. Try again.");
        return;
      }
      setSold(true);
      onSold();
    } catch {
      setError("Connection error — the card was NOT sold. Check the network and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Gift size={16} className="text-amber-400" /> {sold ? "Gift card sold" : "Sell Gift Card"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        {sold ? (
          <div className="px-5 py-6 text-center space-y-4">
            <div className="w-12 h-12 bg-green-500/15 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle size={24} className="text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold font-mono tracking-wider text-white">{card.code}</p>
              <p className="text-amber-400 font-bold mt-1">{fmt(card.initialAmount, currencySymbol)} · now active</p>
            </div>
            <p className="text-slate-400 text-sm">
              Hand the card to the customer{sendEmail && email.trim() ? ` — code also emailed to ${email.trim()}` : ""}. It can be spent right away.
            </p>
            <button onClick={onClose} className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm transition-colors">
              Done
            </button>
          </div>
        ) : (
          <div className="px-5 py-5 space-y-4">
            {/* The card being sold — cashier verifies it matches the physical one */}
            <div className="bg-gradient-to-br from-amber-500/15 to-yellow-500/5 border border-amber-500/40 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-lg font-bold font-mono tracking-wider text-white">{card.code}</p>
                <p className="text-amber-400 font-bold text-lg tabular-nums">{fmt(card.initialAmount, currencySymbol)}</p>
              </div>
              <p className="text-[11px] text-amber-200/70 mt-1">Check this code matches the physical card before taking payment.</p>
            </div>

            {/* Payment */}
            <div>
              <p className="text-slate-400 text-xs mb-2 font-semibold uppercase tracking-wide">Paid by</p>
              <div className="grid grid-cols-2 gap-2">
                {([["cash", "Cash", Banknote], ["card", "Card", CreditCard]] as const).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPaymentMethod(key)}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-bold transition-all ${
                      paymentMethod === key
                        ? "bg-amber-500 border-amber-500 text-slate-900"
                        : "bg-slate-900 border-slate-600 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Required recipient — every till sale captures a marketing
                contact (with the consent tick), same as the admin flow. */}
            <div>
              <p className="text-slate-400 text-xs mb-2 font-semibold uppercase tracking-wide">Customer email <span className="text-red-400">*</span></p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-500 placeholder-slate-500"
              />
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name (optional)"
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-amber-500 placeholder-slate-500"
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="accent-amber-500" />
              <span className="text-sm text-slate-300">Email the card to the customer</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} className="accent-amber-500" />
              <span className="text-sm text-slate-300">Customer agrees to receive offers &amp; news by email</span>
            </label>

            {error && (
              <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              onClick={() => void handleSell()}
              disabled={busy}
              className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} />}
              {busy ? "Activating…" : `Take ${fmt(card.initialAmount, currencySymbol)} · Activate`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
