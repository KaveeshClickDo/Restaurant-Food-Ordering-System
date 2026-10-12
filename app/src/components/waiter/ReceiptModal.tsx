"use client";

/**
 * Receipt overlay shown after an order is sent or a bill is settled.
 * Print / reprint, email to the customer, and (when the caller passes
 * onRefund) hand off to the refund flow. With `thermalPrint` (POS Dashboard),
 * Print goes to the Receipt / POS printer and PDF opens the browser print window.
 */

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import {
  Receipt, X, Loader2, CheckCircle2, Mail, Printer, RefreshCw, RotateCcw, FileDown, AlertTriangle, Info,
} from "lucide-react";
import type { WaiterReceipt } from "./_types";
import { fmtCur } from "./_utils";
import { buildReceiptHtml } from "./_receiptHtml";
import { isCapacitorAndroid } from "@/lib/capacitorBridge";

export default function ReceiptModal({ receipt, onClose, onRefund, thermalPrint, noPrinterHint, printerLabel = "Receipt", autoPrintError, autoPrintOff, noPrinterConfigured, autoPrinting }: {
  receipt: WaiterReceipt;
  onClose: () => void;
  onRefund?: () => void;
  thermalPrint?: () => Promise<{ ok: boolean; error?: string; browser?: boolean; noPrinter?: boolean }>;
  noPrinterHint?: string;
  printerLabel?: string;
  autoPrintError?: string;
  autoPrintOff?: boolean;
  noPrinterConfigured?: boolean;
  /** An automatic print is currently in flight — shows the same "Printing…" state as a manual click. */
  autoPrinting?: boolean;
}) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const rs = settings.receiptSettings;
  const restaurantName = rs?.restaurantName?.trim() || settings.restaurant?.name || "Restaurant";
  const [emailTo, setEmailTo] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [printState, setPrintState] = useState<"idle" | "printing" | "ok" | "error">("idle");
  const [printError, setPrintError] = useState("");
  const [printNoPrinter, setPrintNoPrinter] = useState(false);
  const onAndroid = isCapacitorAndroid();
  // Manual click or an automatic print in flight — either way, show "Printing…".
  const isPrinting = printState === "printing" || !!autoPrinting;

  function handlePrint() {
    const html = buildReceiptHtml(receipt, restaurantName, rs?.address ?? "", rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!", sym);
    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) {
      alert("Pop-up was blocked. Allow pop-ups for this site and try again.");
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.onafterprint = () => win.close();
  }

  // Shared by the manual Print button and the auto-trigger below — UI state only, no real print.
  function showNoPrinterError() {
    setPrintState("error");
    setPrintNoPrinter(true);
    setPrintError(`No ${printerLabel.toLowerCase()} printer is set up. ${noPrinterHint ?? "Add one in Settings → Hardware."}`);
  }

  // No active printer at all — show the same message the manual Print button would,
  // without a click. Never calls thermalPrint(), so no real print is triggered.
  useEffect(() => {
    if (noPrinterConfigured) showNoPrinterError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noPrinterConfigured]);

  // Print to the target printer (see printerLabel). "Browser" mode uses the browser window; with no printer, show an error.
  async function handleThermalPrint() {
    if (!thermalPrint) return;
    setPrintState("printing");
    setPrintError("");
    setPrintNoPrinter(false);
    const r = await thermalPrint();
    if (r.noPrinter) {
      showNoPrinterError();
      return;
    }
    if (r.browser) {
      if (onAndroid) {
        setPrintState("error");
        setPrintError(`The ${printerLabel} printer is set to Browser print, which the tablet can't use. ${noPrinterHint ?? "Change it in Settings → Hardware."}`);
      } else {
        setPrintState("idle");
        handlePrint();
      }
      return;
    }
    if (r.ok) {
      setPrintState("ok");
      setTimeout(() => setPrintState("idle"), 4000);
    } else {
      setPrintState("error");
      setPrintError(r.error ?? "Printing failed.");
    }
  }

  async function handleEmail() {
    if (!emailTo.trim()) return;
    setEmailStatus("sending");
    const html = buildReceiptHtml(receipt, restaurantName, rs?.address ?? "", rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!", sym);
    const subject = `Your receipt from ${restaurantName} — Table ${receipt.tableLabel}`;
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: emailTo.trim(), subject, html, marketingOptIn }),
    });
    const d = await res.json().catch(() => ({})) as { ok?: boolean };
    setEmailStatus(d.ok ? "sent" : "error");
  }

  const items = receipt.items;
  const payLabel = receipt.paymentMethod === "cash" ? "Cash" : receipt.paymentMethod === "card" ? "Card" : receipt.paymentMethod === "gift_card" ? "Gift Card" : "Table Service";
  // `total` is stored NET (gift card already deducted): it IS the money paid.
  // Re-add the card for the gross goods TOTAL line.
  const giftUsed = receipt.giftCardUsed ?? 0;
  const grossTotal = Math.round((receipt.total + giftUsed) * 100) / 100;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 rounded-3xl w-full max-w-sm max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Receipt size={18} className="text-emerald-400" />
            <span className="text-white font-bold">Receipt — Table {receipt.tableLabel}</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        {/* Receipt preview */}
        <div className="p-5 flex-1 space-y-4">
          {/* Header block */}
          <div className="text-center space-y-0.5">
            <p className="text-white font-black text-base tracking-widest uppercase">{restaurantName}</p>
            {rs?.phone && <p className="text-slate-400 text-xs">{rs.phone}</p>}
            {rs?.website && <p className="text-slate-400 text-xs">{rs.website}</p>}
            <p className="text-slate-400 text-xs">{new Date(receipt.date).toLocaleString("en-GB")}</p>
            <p className="text-slate-400 text-xs">Table: <span className="text-white font-bold">{receipt.tableLabel}</span></p>
            <p className="text-slate-400 text-xs">Served by: <span className="text-white">{receipt.waiterName}</span></p>
            {rs?.vatNumber && <p className="text-slate-500 text-[10px]">VAT No: {rs.vatNumber}</p>}
          </div>

          <hr className="border-dashed border-slate-600" />

          {/* Items */}
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="text-slate-300 text-sm flex-1">{it.name} <span className="text-slate-500">×{it.qty}</span></span>
                <span className="text-white text-sm font-medium">{fmtCur(it.price * it.qty, sym)}</span>
              </div>
            ))}
          </div>

          <hr className="border-dashed border-slate-600" />

          {/* Total + payment */}
          <div className="space-y-1">
            {((receipt.discountAmount ?? 0) > 0 || (receipt.tipAmount ?? 0) > 0 || (receipt.vatAmount ?? 0) > 0 || (receipt.serviceFeeAmount ?? 0) > 0) && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-xs">Subtotal</span>
                  <span className="text-slate-300 text-xs">{fmtCur(receipt.subtotal ?? grossTotal, sym)}</span>
                </div>
                {(receipt.discountAmount ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 text-xs">Discount{receipt.discountNote ? ` (${receipt.discountNote})` : ""}</span>
                    <span className="text-emerald-400 text-xs">−{fmtCur(receipt.discountAmount ?? 0, sym)}</span>
                  </div>
                )}
                {(receipt.vatAmount ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">{receipt.vatInclusive ? `Incl. VAT${receipt.vatRate ? ` (${receipt.vatRate}%)` : ""}` : `VAT${receipt.vatRate ? ` (${receipt.vatRate}%)` : ""}`}</span>
                    <span className="text-slate-300 text-xs">{receipt.vatInclusive ? "" : "+"}{fmtCur(receipt.vatAmount ?? 0, sym)}</span>
                  </div>
                )}
                {(receipt.tipAmount ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">Tip</span>
                    <span className="text-slate-300 text-xs">{fmtCur(receipt.tipAmount ?? 0, sym)}</span>
                  </div>
                )}
                {(receipt.serviceFeeAmount ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">Service Fee</span>
                    <span className="text-slate-300 text-xs">{fmtCur(receipt.serviceFeeAmount ?? 0, sym)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-white font-black text-base">TOTAL</span>
              <span className="text-white font-black text-xl">{fmtCur(grossTotal, sym)}</span>
            </div>
            {(receipt.giftCardUsed ?? 0) > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-orange-300 text-xs">Gift card</span>
                  <span className="text-orange-300 text-xs">−{fmtCur(receipt.giftCardUsed ?? 0, sym)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white font-bold text-sm">Paid ({payLabel})</span>
                  <span className="text-white font-bold text-sm">{fmtCur(receipt.total, sym)}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Payment</span>
                <span className="text-slate-300 text-xs">{payLabel}</span>
              </div>
            )}
          </div>

          {rs?.thankYouMessage && (
            <p className="text-center text-slate-300 text-xs font-semibold pt-1">{rs.thankYouMessage}</p>
          )}

          {/* Email section */}
          <hr className="border-dashed border-slate-600" />
          <div className="space-y-2">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Send by Email</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={emailTo}
                onChange={(e) => { setEmailTo(e.target.value); setEmailStatus("idle"); }}
                placeholder="customer@email.com"
                className="flex-1 min-w-0 bg-slate-700 text-white placeholder-slate-500 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button
                onClick={handleEmail}
                disabled={!emailTo.trim() || emailStatus === "sending" || emailStatus === "sent"}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-2.5 rounded-xl transition flex-shrink-0"
              >
                {emailStatus === "sending" ? <Loader2 size={16} className="animate-spin" /> :
                  emailStatus === "sent" ? <CheckCircle2 size={16} className="text-green-300" /> :
                    <Mail size={16} />}
              </button>
            </div>
            {/* Marketing consent — PECR: opt-out offered when the email is collected */}
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)}
                className="w-4 h-4 accent-orange-500 mt-0.5 shrink-0" />
              <span className="text-xs text-slate-500">Guest agrees to receive offers &amp; news by email</span>
            </label>
            {emailStatus === "sent" && <p className="text-green-400 text-xs">Receipt sent!</p>}
            {emailStatus === "error" && <p className="text-red-400 text-xs">Failed to send — check SMTP settings.</p>}
          </div>
        </div>

        {autoPrintOff && !autoPrintError && (
          <div role="status" className="mx-5 mb-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
            <Info size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-300 text-xs break-words">
              The {printerLabel} printer&apos;s Auto-print is off, so no kitchen slip was printed. An admin can turn it on in Admin → Integrations.
            </p>
          </div>
        )}
        {autoPrintError && (
          <div role="alert" className="mx-5 mb-3 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-xs break-words">
              <span className="font-semibold">Kitchen slip did not print — tell the kitchen.</span> {autoPrintError}
            </p>
          </div>
        )}
        {printState === "ok" && (
          <div className="mx-5 mb-3 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-3 py-2">
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
            <p className="text-emerald-300 text-xs font-semibold">Receipt sent to printer.</p>
          </div>
        )}
        {printState === "error" && (
          <div role="alert" className="mx-5 mb-3 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-red-300 text-xs break-words">{printError}</p>
              {/* Browser printing does not work in the Android WebView. */}
              {!onAndroid && (
                <button onClick={handlePrint} className="text-red-300 text-xs font-semibold underline mt-0.5">
                  {printNoPrinter ? "Save as PDF instead" : "Print via browser instead"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className={`p-5 border-t border-slate-700 grid gap-2 flex-shrink-0 ${
          thermalPrint && onRefund ? (onAndroid ? "grid-cols-3" : "grid-cols-3")
            : thermalPrint ? (onAndroid ? "grid-cols-2" : "grid-cols-3")
              : onRefund ? "grid-cols-2" : "grid-cols-3"
        }`}>
          {thermalPrint && onRefund ? (
            <>
              {!onAndroid && (
                <button onClick={handlePrint} title="Open the print window, then choose Save as PDF" className="flex flex-col items-center gap-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl transition text-xs font-medium">
                  <FileDown size={16} /> PDF
                </button>
              )}
              <button onClick={handleThermalPrint} disabled={isPrinting} title={`Print to the ${printerLabel} printer`} className="flex flex-col items-center gap-1 bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white py-3 rounded-xl transition text-xs font-medium">
                {isPrinting
                  ? <><Loader2 size={16} className="animate-spin" /> Printing…</>
                  : <><Printer size={16} /> Print</>}
              </button>
              <button onClick={onRefund} className="flex flex-col items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-xl transition text-xs font-medium">
                <RotateCcw size={16} /> Refund
              </button>
            </>
          ) : thermalPrint ? (
            <>
              <button onClick={onClose} className="flex flex-col items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-300 py-3 rounded-xl transition text-xs font-medium">
                <X size={16} /> Close
              </button>
              {!onAndroid && (
                <button onClick={handlePrint} title="Open the print window, then choose Save as PDF" className="flex flex-col items-center gap-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl transition text-xs font-medium">
                  <FileDown size={16} /> PDF
                </button>
              )}
              <button onClick={handleThermalPrint} disabled={isPrinting} title={`Print to the ${printerLabel} printer`} className="flex flex-col items-center gap-1 bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white py-3 rounded-xl transition text-xs font-medium">
                {isPrinting
                  ? <><Loader2 size={16} className="animate-spin" /> Printing…</>
                  : <><Printer size={16} /> Print</>}
              </button>
            </>
          ) : !onRefund ? (
            <>
              <button onClick={onClose} className="flex flex-col items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-300 py-3 rounded-xl transition text-xs font-medium">
                <X size={16} /> Close
              </button>
              <button onClick={handlePrint} className="flex flex-col items-center gap-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl transition text-xs font-medium">
                <Printer size={16} /> Print
              </button>
              <button onClick={handlePrint} className="flex flex-col items-center gap-1 bg-orange-500 hover:bg-orange-400 text-white py-3 rounded-xl transition text-xs font-medium">
                <RefreshCw size={16} /> Reprint
              </button>
            </>
          ) : (
            <>
              <button onClick={handlePrint} className="flex flex-col items-center gap-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl transition text-xs font-medium">
                <Printer size={16} /> Print
              </button>
              <button onClick={onRefund} className="flex flex-col items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-xl transition text-xs font-medium">
                <RotateCcw size={16} /> Refund
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
