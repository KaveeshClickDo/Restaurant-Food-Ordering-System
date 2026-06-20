"use client";

/**
 * Receipt overlay shown after an order is sent or a bill is settled.
 * Print / reprint, email to the customer, and (when the caller passes
 * onRefund) hand off to the refund flow.
 */

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import {
  Receipt, X, Loader2, CheckCircle2, Mail, Printer, RefreshCw, RotateCcw,
} from "lucide-react";
import type { WaiterReceipt } from "./_types";
import { fmtCur } from "./_utils";
import { buildReceiptHtml } from "./_receiptHtml";

export default function DineInReceiptModal({ receipt, onClose, onRefund }: { receipt: WaiterReceipt; onClose: () => void; onRefund?: () => void }) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const rs = settings.receiptSettings;
  const restaurantName = rs?.restaurantName?.trim() || settings.restaurant?.name || "Restaurant";
  const [emailTo, setEmailTo] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  function handlePrint() {
    const html = buildReceiptHtml(receipt, restaurantName, rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!", sym);
    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.onafterprint = () => win.close();
  }

  async function handleEmail() {
    if (!emailTo.trim()) return;
    setEmailStatus("sending");
    const html = buildReceiptHtml(receipt, restaurantName, rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!", sym);
    const subject = `Your receipt from ${restaurantName} — Table ${receipt.tableLabel}`;
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: emailTo.trim(), subject, html }),
    });
    const d = await res.json().catch(() => ({})) as { ok?: boolean };
    setEmailStatus(d.ok ? "sent" : "error");
  }

  const items = receipt.items;
  const payLabel = receipt.paymentMethod === "cash"
    ? "Cash"
    : receipt.paymentMethod === "card"
      ? "Card"
      : receipt.paymentMethod === "gift_card"
        ? "Gift Card"
        : "Table Service";

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
            {((receipt.discountAmount ?? 0) > 0 || (receipt.tipAmount ?? 0) > 0 || (receipt.vatAmount ?? 0) > 0 || (receipt.serviceFeeAmount ?? 0) > 0 || (receipt.giftCardUsed ?? 0) > 0) && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-xs">Subtotal</span>
                  <span className="text-slate-300 text-xs">{fmtCur(receipt.subtotal ?? receipt.total, sym)}</span>
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
                {(receipt.giftCardUsed ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-purple-400 text-xs">Gift card applied</span>
                    <span className="text-purple-400 text-xs">−{fmtCur(receipt.giftCardUsed ?? 0, sym)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-white font-black text-base">TOTAL</span>
              <span className="text-white font-black text-xl">{fmtCur(receipt.total, sym)}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-sm">Payment</span>
              <span className="text-slate-300 text-sm">{payLabel}</span>
            </div>

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
            {emailStatus === "sent" && <p className="text-green-400 text-xs">Receipt sent!</p>}
            {emailStatus === "error" && <p className="text-red-400 text-xs">Failed to send — check SMTP settings.</p>}
          </div>
        </div>

        {/* Footer actions */}
        <div className={`p-5 border-t border-slate-700 grid gap-2 flex-shrink-0 ${onRefund ? "grid-cols-2" : "grid-cols-3"}`}>
          {!onRefund ? (
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
