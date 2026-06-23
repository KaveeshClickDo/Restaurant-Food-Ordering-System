"use client";

import { useState } from "react";
import { apiBase } from "@/lib/apiBase";
import { usePOS } from "@/context/POSContext";
import { useApp } from "@/context/AppContext";
import { POSSale } from "@/types/pos";
import { Mail, CheckCircle2, RefreshCw, Printer } from "lucide-react";
import { fmt, fmtDate, fmtTime, isOfflineSale } from "./_utils";
import { buildReceiptHtml } from "./_receipts";

export default function ReceiptModal({ sale, onClose }: { sale: POSSale; onClose: () => void }) {
  const { settings, customers } = usePOS();
  const { settings: appSettings } = useApp();
  const customer = customers.find((c) => c.id === sale.customerId);
  const [emailTo, setEmailTo] = useState(customer?.email ?? "");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailError, setEmailError] = useState("");
  const sym = settings.currencySymbol;

  // Prefer the restaurant name from admin branding settings (single source of truth)
  const effectiveName = appSettings.restaurant?.name || settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant";
  const restaurantName = effectiveName.toUpperCase();

  // VAT label and sign — read from the snapshot saved on the sale itself so it's
  // always accurate even if settings change after the transaction.
  const taxRate = sale.taxRate ?? settings.taxRate;
  const taxInclusive = sale.taxInclusive ?? settings.taxInclusive;
  const vatLabel = taxInclusive
    ? `VAT (${taxRate}% incl.)`
    : `VAT (${taxRate}%)`;
  const vatSign = taxInclusive ? "" : "+";

  // `total` is stored NET (gift card already deducted). Re-add the card to show
  // the gross goods TOTAL; the net `total` is the real money paid by cash/card.
  const giftAmt    = sale.giftCardUsed ?? sale.giftCard?.amount ?? 0;
  const grossTotal = Math.round((sale.total + giftAmt) * 100) / 100;

  async function sendEmail() {
    if (!emailTo.trim()) return;
    setEmailStatus("sending");
    setEmailError("");
    try {
      const html = buildReceiptHtml(sale, settings, effectiveName);
      const fromName = settings.smtpFromName?.trim() || effectiveName;
      const subject = `Your receipt from ${fromName} — #${sale.receiptNo}`;
      // SMTP credentials are read from server-side env vars in /api/email
      const res = await fetch(apiBase() + "/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailTo.trim(), subject, html }),
      });
      const data = await res.json();
      if (data.ok) {
        setEmailStatus("sent");
      } else {
        setEmailStatus("error");
        setEmailError(data.error ?? "Failed to send email");
      }
    } catch (e) {
      setEmailStatus("error");
      setEmailError(e instanceof Error ? e.message : "Network error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-xs flex flex-col shadow-2xl overflow-hidden max-h-[95vh]">
        <div className="p-6 font-mono text-gray-900 text-xs overflow-y-auto flex-1">

          {/* ── Header ───────────────────────────────────────── */}
          <div className="text-center mb-4">
            {settings.receiptShowLogo && settings.receiptLogoUrl && (
              <div className="flex justify-center mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary URL or data: URI, needs onError fallback */}
                <img src={settings.receiptLogoUrl} alt="Logo" className="h-10 w-auto object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
            )}
            <p className="font-bold text-base">{restaurantName}</p>
            {settings.receiptPhone && <p className="text-gray-500">{settings.receiptPhone}</p>}
            {settings.receiptWebsite && <p className="text-gray-500">{settings.receiptWebsite}</p>}
            <p className="text-gray-500">{fmtDate(sale.date)} · {fmtTime(sale.date)}</p>
            <p className="text-gray-500">Receipt #{sale.receiptNo}</p>
            {isOfflineSale(sale.receiptNo) && <p className="font-bold text-amber-600 tracking-wide">OFFLINE SALE</p>}
            {sale.staffName && <p className="text-gray-500">Served by: {sale.staffName}</p>}
            {sale.customerName && <p className="text-gray-500">Customer: {sale.customerName}</p>}
            {settings.receiptVatNumber && (
              <p className="text-gray-400 text-[10px]">VAT No: {settings.receiptVatNumber}</p>
            )}
          </div>

          <div className="border-t border-dashed border-gray-300 my-3" />

          {/* ── Items ─────────────────────────────────────────── */}
          {sale.items.map((item) => (
            <div key={item.lineId} className="mb-2">
              <div className="flex justify-between">
                <span className="font-semibold">{item.name} ×{item.quantity}</span>
                <span>{fmt(item.price * item.quantity, sym)}</span>
              </div>
              {item.modifiers.map((m) => (
                <p key={m.optionId} className="text-gray-500 pl-2">+ {m.optionLabel}</p>
              ))}
              {item.note && <p className="text-gray-500 pl-2 italic">&ldquo;{item.note}&rdquo;</p>}
            </div>
          ))}

          <div className="border-t border-dashed border-gray-300 my-3" />

          {/* ── Totals ────────────────────────────────────────── */}
          <div className="flex justify-between">
            <span>Subtotal</span><span>{fmt(sale.subtotal, sym)}</span>
          </div>
          {sale.discountAmount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Discount{sale.discountNote ? ` (${sale.discountNote})` : ""}</span>
              <span>-{fmt(sale.discountAmount, sym)}</span>
            </div>
          )}
          {sale.taxAmount > 0 && settings.showBreakdown && (
            <div className="flex justify-between text-gray-500">
              <span>{vatLabel}</span>
              <span>{vatSign}{fmt(sale.taxAmount, sym)}</span>
            </div>
          )}
          {sale.tipAmount > 0 && (
            <div className="flex justify-between">
              <span>Tip</span><span>{fmt(sale.tipAmount, sym)}</span>
            </div>
          )}
          {sale.serviceFeeAmount > 0 && (
            <div className="flex justify-between">
              <span>Service Fee</span><span>{fmt(sale.serviceFeeAmount, sym)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base mt-2 pt-2 border-t border-gray-300">
            <span>TOTAL</span><span>{fmt(grossTotal, sym)}</span>
          </div>

          {/* ── Payment breakdown ─────────────────────────────── */}
          <div className="mt-1 space-y-0.5">
            {/* 1. Show the gift card deduction first */}
            {giftAmt > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Gift Card {sale.giftCard?.code ? `(..${sale.giftCard.code.slice(-4)})` : ""}</span>
                <span>{fmt(giftAmt, sym)}</span>
              </div>
            )}

            {/* 2. Show the remaining amount paid by Cash/Card/Split */}
            {sale.paymentMethod === "split" ? (
              sale.payments.map((p, i) => (
                <div key={i} className="flex justify-between text-gray-500 capitalize">
                  <span>{p.method}</span><span>{fmt(p.amount, sym)}</span>
                </div>
              ))
            ) : sale.paymentMethod === "cash" ? (
              <>
                <div className="flex justify-between text-gray-500">
                  <span>Cash</span>
                  <span>{fmt(sale.cashTendered ?? sale.total, sym)}</span>
                </div>
                {(sale.changeGiven ?? 0) > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Change</span><span>{fmt(sale.changeGiven!, sym)}</span>
                  </div>
                )}
              </>
            ) : sale.paymentMethod === "gift_card" ? (
              // Covered entirely by gift card — the deduction line above shows it.
              null
            ) : (
              <div className="flex justify-between text-gray-500 capitalize">
                <span>{sale.paymentMethod}</span>
                {/* total is already net of the gift card = the amount charged */}
                <span>{fmt(sale.total, sym)}</span>
              </div>
            )}
          </div>

          {/* ── Footer ────────────────────────────────────────── */}
          <div className="border-t border-dashed border-gray-300 my-3" />
          {settings.receiptThankYouMessage && (
            <p className="text-center text-gray-700 font-semibold">
              {settings.receiptThankYouMessage}
            </p>
          )}
          {settings.receiptCustomMessage && (
            <p className="text-center text-gray-500 mt-1">
              {settings.receiptCustomMessage}
            </p>
          )}
          {/* Legacy footer field kept for backwards-compat */}
          {!settings.receiptThankYouMessage && settings.receiptFooter && (
            <p className="text-center text-gray-500 whitespace-pre-line">{settings.receiptFooter}</p>
          )}
        </div>

        {/* ── Email receipt section ─────────────────────────── */}
        <div className="px-4 pb-2">
          <div className="border border-gray-200 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <Mail size={11} /> Email Receipt
            </p>
            {emailStatus === "sent" ? (
              <div className="flex items-center gap-2 text-green-600 text-xs font-semibold">
                <CheckCircle2 size={14} /> Receipt sent to {emailTo}
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={emailTo}
                    onChange={(e) => { setEmailTo(e.target.value); setEmailStatus("idle"); }}
                    placeholder="customer@email.com"
                    type="email"
                    className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-gray-900 text-xs outline-none focus:border-orange-400 placeholder-gray-400"
                  />
                  <button
                    onClick={sendEmail}
                    disabled={!emailTo.trim() || emailStatus === "sending"}
                    className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 flex-shrink-0"
                  >
                    {emailStatus === "sending" ? (
                      <RefreshCw size={11} className="animate-spin" />
                    ) : (
                      <Mail size={11} />
                    )}
                    {emailStatus === "sending" ? "Sending…" : "Send"}
                  </button>
                </div>
                {emailStatus === "error" && (
                  <p className="text-red-500 text-[10px]">{emailError}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Buttons ──────────────────────────────────────────── */}
        <div className="px-4 pb-4 grid grid-cols-2 gap-2 mt-2">
          <button
            onClick={onClose}
            className="py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => window.print()}
            className="py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
          >
            <Printer size={14} /> Print
          </button>
        </div>
      </div>
    </div>
  );
}
