"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiBase } from "@/lib/apiBase";
import { usePOS } from "@/context/POSContext";
import { useApp } from "@/context/AppContext";
import { POSSale } from "@/types/pos";
import { Mail, CheckCircle2, RefreshCw, Printer, AlertTriangle } from "lucide-react";
import { fmt, fmtDate, fmtTime, isOfflineSale } from "./_utils";
import { buildReceiptHtml } from "./_receipts";
import { printPOSSale } from "@/lib/posPrint";
import { isCapacitorAndroid } from "@/lib/capacitorBridge";

export default function ReceiptModal(
  { sale, onClose, autoPrint = false }: { sale: POSSale; onClose: () => void; autoPrint?: boolean },
) {
  const { settings, customers } = usePOS();
  const { settings: appSettings } = useApp();
  // Receipt header/footer content — the shared source of truth (Admin → Receipt /
  // POS → Receipt), so the on-screen receipt matches the printed one.
  const rs = appSettings.receiptSettings;
  const customer = customers.find((c) => c.id === sale.customerId);
  const [emailTo, setEmailTo] = useState(customer?.email ?? "");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailError, setEmailError] = useState("");
  const [printStatus, setPrintStatus] = useState<"idle" | "printing" | "ok" | "error">("idle");
  const [printError, setPrintError] = useState("");
  const sym = settings.currencySymbol;
  // window.print() is a no-op inside the Android WebView, so on Android we never
  // fall back to it — we surface an actionable message instead.
  const onAndroid = isCapacitorAndroid();

  // Prefer the restaurant name from admin branding settings (single source of truth)
  const effectiveName = appSettings.restaurant?.name || rs.restaurantName?.trim() || settings.businessName || "Restaurant";
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
      const html = buildReceiptHtml(sale, settings, rs, effectiveName);
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

  // Print to the configured thermal printer. On Android this goes straight to
  // the printer (Bluetooth / USB / direct TCP) with no server — so it works
  // offline. "browser" mode (or a disabled printer) falls back to window.print().
  const handlePrint = useCallback(async () => {
    setPrintStatus("printing");
    setPrintError("");
    const r = await printPOSSale(sale, settings, appSettings.printer, effectiveName, rs);
    if (r.browser) {
      // No thermal printer configured (or "browser" mode). On a desktop browser
      // window.print() opens the OS print dialog; inside the Android WebView it
      // does nothing — so on the tablet, tell the cashier what to do instead of
      // silently failing.
      if (onAndroid) {
        setPrintStatus("error");
        setPrintError(
          appSettings.printer?.enabled
            ? "Printer set to “browser” mode, which isn’t available on the tablet. Pick Bluetooth, USB, or Network in Settings → Hardware."
            : "No printer configured. Set one up in Settings → Hardware.",
        );
      } else {
        setPrintStatus("idle");
        window.print();
      }
      return;
    }
    if (r.ok) {
      setPrintStatus("ok");
      setTimeout(() => setPrintStatus("idle"), 4000);
    } else {
      setPrintStatus("error");
      setPrintError(r.error ?? "Printing failed.");
    }
  }, [sale, settings, appSettings.printer, effectiveName, onAndroid, rs]);

  // Auto-print once when the receipt opens straight after a sale (autoPrint
  // prop), but only for real thermal modes the cashier configured — never
  // auto-trigger the browser print dialog (intrusive), and never on the
  // dashboard's "view old receipt" path (which doesn't pass autoPrint).
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (autoPrinted.current || !autoPrint) return;
    const pr = appSettings.printer;
    if (pr?.enabled && pr.autoPrint && pr.connection !== "browser") {
      autoPrinted.current = true;
      void handlePrint();
    }
  }, [autoPrint, appSettings.printer, handlePrint]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-xs flex flex-col shadow-2xl overflow-hidden max-h-[95vh]">
        <div className="p-6 font-mono text-gray-900 text-xs overflow-y-auto flex-1">

          {/* ── Header ───────────────────────────────────────── */}
          <div className="text-center mb-4">
            {rs.showLogo && rs.logoUrl && (
              <div className="flex justify-center mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary URL or data: URI, needs onError fallback */}
                <img src={rs.logoUrl} alt="Logo" className="h-10 w-auto object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
            )}
            <p className="font-bold text-base">{restaurantName}</p>
            {rs.address?.trim() && <p className="text-gray-500 whitespace-pre-line">{rs.address.trim()}</p>}
            {rs.phone && <p className="text-gray-500">{rs.phone}</p>}
            {rs.website && <p className="text-gray-500">{rs.website}</p>}
            {rs.email && <p className="text-gray-500">{rs.email}</p>}
            <p className="text-gray-500">{fmtDate(sale.date)} · {fmtTime(sale.date)}</p>
            <p className="text-gray-500">Receipt #{sale.receiptNo}</p>
            {isOfflineSale(sale.receiptNo) && <p className="font-bold text-amber-600 tracking-wide">OFFLINE SALE</p>}
            {sale.staffName && <p className="text-gray-500">Served by: {sale.staffName}</p>}
            {sale.customerName && <p className="text-gray-500">Customer: {sale.customerName}</p>}
            {rs.vatNumber && (
              <p className="text-gray-400 text-[10px]">VAT No: {rs.vatNumber}</p>
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
          {rs.thankYouMessage && (
            <p className="text-center text-gray-700 font-semibold">
              {rs.thankYouMessage}
            </p>
          )}
          {rs.customMessage && (
            <p className="text-center text-gray-500 mt-1">
              {rs.customMessage}
            </p>
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

        {/* ── Print status ─────────────────────────────────────── */}
        {printStatus === "ok" && (
          <div className="mx-4 mb-2 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <CheckCircle2 size={13} className="text-green-600 shrink-0" />
            <p className="text-green-700 text-xs font-semibold">Receipt sent to printer.</p>
          </div>
        )}
        {printStatus === "error" && (
          <div className="mx-4 mb-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-red-700 text-xs break-all">{printError}</p>
              {/* window.print() only works on a desktop browser, not the Android
                  WebView — so only offer it off-Android. */}
              {!onAndroid && (
                <button onClick={() => window.print()} className="text-red-600 text-xs font-semibold underline mt-0.5">
                  Print via browser instead
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Buttons ──────────────────────────────────────────── */}
        <div className="px-4 pb-4 grid grid-cols-2 gap-2 mt-2">
          <button
            onClick={onClose}
            className="py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={handlePrint}
            disabled={printStatus === "printing"}
            className="py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {printStatus === "printing"
              ? <><RefreshCw size={14} className="animate-spin" /> Printing…</>
              : <><Printer size={14} /> Print</>}
          </button>
        </div>
      </div>
    </div>
  );
}
