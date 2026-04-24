"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/context/AppContext";
import type { MenuItem, WaiterStaff, DiningTable } from "@/types";
import {
  ChefHat, ArrowLeft, Plus, Minus, Trash2, SendHorizonal,
  LogOut, Users, UtensilsCrossed, CheckCircle2, Loader2,
  ChevronLeft, StickyNote, X, Receipt, CreditCard, Banknote,
  ClipboardList, Utensils, Printer, Mail, Eye, RefreshCw,
  AlertTriangle, RotateCcw, ShieldAlert,
} from "lucide-react";

// ─── Internal types ───────────────────────────────────────────────────────────

interface WaiterCartItem {
  lineId: string;
  menuItemId: string;
  name: string;       // includes variation/add-on labels
  unitPrice: number;
  quantity: number;
  note?: string;
}

type View = "login" | "tables" | "menu" | "success" | "bill";
type LoginStep = "staff" | "pin";

interface BillOrder {
  id: string;
  items: { name: string; qty: number; price: number }[];
  total: number;
  note: string;
}

interface WaiterReceipt {
  tableLabel: string;
  waiterName: string;
  date: string;                // ISO
  items: { name: string; qty: number; price: number }[];
  total: number;
  paymentMethod?: "cash" | "card" | "pending";
  orderIds: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtCur = (n: number) =>
  "£" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Receipt Modal ────────────────────────────────────────────────────────────

function buildReceiptHtml(receipt: WaiterReceipt, restaurantName: string, receiptPhone: string, receiptWebsite: string, vatNumber: string, thankYou: string): string {
  const itemsHtml = receipt.items.map((it) =>
    `<tr>
      <td style="padding:2px 0;font-size:12px">${it.name} ×${it.qty}</td>
      <td style="padding:2px 0;font-size:12px;text-align:right">£${(it.price * it.qty).toFixed(2)}</td>
    </tr>`
  ).join("");

  const payLabel = receipt.paymentMethod === "cash" ? "Cash" : receipt.paymentMethod === "card" ? "Card" : "Table Service";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title></head>
<body style="margin:0;background:#f9fafb;font-family:monospace">
<div style="max-width:320px;margin:24px auto;background:#fff;border-radius:12px;padding:24px">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-weight:700;font-size:16px;letter-spacing:1px">${restaurantName.toUpperCase()}</div>
    ${receiptPhone ? `<div style="font-size:11px;color:#6b7280">${receiptPhone}</div>` : ""}
    ${receiptWebsite ? `<div style="font-size:11px;color:#6b7280">${receiptWebsite}</div>` : ""}
    <div style="font-size:11px;color:#6b7280">${new Date(receipt.date).toLocaleString("en-GB")}</div>
    <div style="font-size:11px;color:#6b7280">Table: ${receipt.tableLabel}</div>
    <div style="font-size:11px;color:#6b7280">Served by: ${receipt.waiterName}</div>
    ${vatNumber ? `<div style="font-size:10px;color:#9ca3af">VAT No: ${vatNumber}</div>` : ""}
  </div>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="font-size:13px;font-weight:700">TOTAL</td><td style="font-size:13px;font-weight:700;text-align:right">£${receipt.total.toFixed(2)}</td></tr>
    <tr><td style="font-size:11px;color:#6b7280">Payment</td><td style="font-size:11px;color:#6b7280;text-align:right">${payLabel}</td></tr>
  </table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  ${thankYou ? `<div style="text-align:center;font-weight:600;color:#374151;font-size:12px">${thankYou}</div>` : ""}
</div></body></html>`;
}

function ReceiptModal({ receipt, onClose, onRefund }: { receipt: WaiterReceipt; onClose: () => void; onRefund?: () => void }) {
  const { settings } = useApp();
  const rs = settings.receiptSettings;
  const restaurantName = rs?.restaurantName?.trim() || settings.restaurant?.name || "Restaurant";
  const [emailTo, setEmailTo]   = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle"|"sending"|"sent"|"error">("idle");

  function handlePrint() {
    const html = buildReceiptHtml(receipt, restaurantName, rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!");
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
    const html = buildReceiptHtml(receipt, restaurantName, rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!");
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
  const payLabel = receipt.paymentMethod === "cash" ? "Cash" : receipt.paymentMethod === "card" ? "Card" : "Table Service";

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
            {rs?.phone    && <p className="text-slate-400 text-xs">{rs.phone}</p>}
            {rs?.website  && <p className="text-slate-400 text-xs">{rs.website}</p>}
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
                <span className="text-white text-sm font-medium">{fmtCur(it.price * it.qty)}</span>
              </div>
            ))}
          </div>

          <hr className="border-dashed border-slate-600" />

          {/* Total + payment */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-white font-black text-base">TOTAL</span>
              <span className="text-white font-black text-xl">{fmtCur(receipt.total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs">Payment</span>
              <span className="text-slate-300 text-xs">{payLabel}</span>
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
                className="flex-1 bg-slate-700 text-white placeholder-slate-500 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button
                onClick={handleEmail}
                disabled={!emailTo.trim() || emailStatus === "sending" || emailStatus === "sent"}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-2.5 rounded-xl transition flex-shrink-0"
              >
                {emailStatus === "sending" ? <Loader2 size={16} className="animate-spin" /> :
                 emailStatus === "sent"    ? <CheckCircle2 size={16} className="text-green-300" /> :
                 <Mail size={16} />}
              </button>
            </div>
            {emailStatus === "sent"  && <p className="text-green-400 text-xs">Receipt sent!</p>}
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

// ─── Bill Email Bar ───────────────────────────────────────────────────────────

function BillEmailBar({ onPrint, tableLabel, waiterName, consolidatedLines, billTotal, orderIds }: {
  onPrint: () => void;
  tableLabel: string;
  waiterName: string;
  consolidatedLines: { name: string; qty: number; price: number }[];
  billTotal: number;
  orderIds: string[];
}) {
  const { settings } = useApp();
  const rs = settings.receiptSettings;
  const restaurantName = rs?.restaurantName?.trim() || settings.restaurant?.name || "Restaurant";
  const [emailTo, setEmailTo] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle"|"sending"|"sent"|"error">("idle");

  async function handleEmail() {
    if (!emailTo.trim()) return;
    setEmailStatus("sending");
    const tempReceipt: WaiterReceipt = {
      tableLabel, waiterName,
      date: new Date().toISOString(),
      items: consolidatedLines,
      total: billTotal,
      paymentMethod: "pending",
      orderIds,
    };
    const html = buildReceiptHtml(tempReceipt, restaurantName, rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!");
    const subject = `Your bill from ${restaurantName} — Table ${tableLabel}`;
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: emailTo.trim(), subject, html }),
    });
    const d = await res.json().catch(() => ({})) as { ok?: boolean };
    setEmailStatus(d.ok ? "sent" : "error");
  }

  return (
    <div className="px-5 pb-5 border-t border-slate-800 bg-slate-950 space-y-3 pt-4 flex-shrink-0">
      <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Print or Email Bill</p>
      <button
        onClick={onPrint}
        className="w-full flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold rounded-2xl transition"
      >
        <Printer size={16} /> Print Bill
      </button>
      <div className="flex gap-2">
        <input
          type="email"
          value={emailTo}
          onChange={e => { setEmailTo(e.target.value); setEmailStatus("idle"); }}
          placeholder="Send bill to email…"
          className="flex-1 bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-orange-500"
        />
        <button
          onClick={handleEmail}
          disabled={!emailTo.trim() || emailStatus === "sending" || emailStatus === "sent"}
          className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition flex-shrink-0"
        >
          {emailStatus === "sending" ? <Loader2 size={15} className="animate-spin" /> :
           emailStatus === "sent"    ? <CheckCircle2 size={15} /> :
           <Mail size={15} />}
          {emailStatus === "sent" ? "Sent!" : emailStatus === "error" ? "Failed" : "Send"}
        </button>
      </div>
      {emailStatus === "error" && <p className="text-red-400 text-xs">Failed to send — check email settings.</p>}
    </div>
  );
}

// ─── Void / Refund Modal ──────────────────────────────────────────────────────

function VoidRefundModal({
  mode, orderIds, total, tableLabel, waiterName, isSenior, onSuccess, onClose,
}: {
  mode: "void" | "refund";
  orderIds: string[];
  total: number;
  tableLabel: string;
  waiterName: string;
  isSenior: boolean;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [reason,          setReason]          = useState("");
  const [refundType,      setRefundType]      = useState<"full" | "partial">("full");
  const [refundAmountStr, setRefundAmountStr] = useState("");
  const [refundMethod,    setRefundMethod]    = useState<"cash" | "card">("cash");
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  if (!isSenior) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center space-y-4">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert size={28} className="text-red-400" />
          </div>
          <h3 className="text-white font-bold text-lg">Access Denied</h3>
          <p className="text-slate-400 text-sm">Only senior staff can process voids and refunds.</p>
          <button onClick={onClose} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-semibold transition">
            Close
          </button>
        </div>
      </div>
    );
  }

  async function handleVoid() {
    if (!reason.trim()) { setError("Please enter a reason."); return; }
    setLoading(true); setError(null);
    const res = await fetch("/api/waiter/void", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds, reason: reason.trim(), voidedBy: waiterName }),
    });
    const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    setLoading(false);
    if (d.ok) onSuccess();
    else setError(d.error ?? "Failed to void orders.");
  }

  async function handleRefund() {
    if (!reason.trim()) { setError("Please enter a reason."); return; }
    const amount = refundType === "full" ? total : parseFloat(refundAmountStr);
    if (isNaN(amount) || amount <= 0) { setError("Enter a valid refund amount."); return; }
    if (amount > total + 0.001) { setError(`Refund cannot exceed ${fmtCur(total)}.`); return; }
    setLoading(true); setError(null);
    const res = await fetch("/api/waiter/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds, refundAmount: amount, refundMethod, reason: reason.trim(), refundedBy: waiterName }),
    });
    const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    setLoading(false);
    if (d.ok) onSuccess();
    else setError(d.error ?? "Failed to process refund.");
  }

  const isVoid   = mode === "void";
  const Icon     = isVoid ? AlertTriangle : RotateCcw;
  const actionCls = isVoid
    ? "bg-red-600 hover:bg-red-500"
    : "bg-amber-600 hover:bg-amber-500";

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isVoid ? "bg-red-500/20" : "bg-amber-500/20"}`}>
              <Icon size={18} className={isVoid ? "text-red-400" : "text-amber-400"} />
            </div>
            <div>
              <h3 className="text-white font-bold">{isVoid ? "Void Table" : "Process Refund"}</h3>
              <p className="text-slate-400 text-xs">Table {tableLabel} · {fmtCur(total)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Refund-specific options */}
          {!isVoid && (
            <>
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Refund Amount</p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {(["full", "partial"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setRefundType(t)}
                      className={`py-2.5 rounded-xl text-sm font-semibold transition border ${
                        refundType === t
                          ? "bg-amber-500/20 border-amber-500 text-amber-300"
                          : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500"
                      }`}
                    >
                      {t === "full" ? `Full ${fmtCur(total)}` : "Partial"}
                    </button>
                  ))}
                </div>
                {refundType === "partial" && (
                  <input
                    type="number"
                    min="0.01"
                    max={total}
                    step="0.01"
                    value={refundAmountStr}
                    onChange={(e) => setRefundAmountStr(e.target.value)}
                    placeholder={`Max ${fmtCur(total)}`}
                    className="w-full bg-slate-700 border border-slate-600 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                )}
              </div>

              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Return Method</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: "cash", label: "Cash",  Ico: Banknote   },
                    { v: "card", label: "Card",  Ico: CreditCard },
                  ] as const).map(({ v, label, Ico }) => (
                    <button
                      key={v}
                      onClick={() => setRefundMethod(v)}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition border ${
                        refundMethod === v
                          ? "bg-amber-500/20 border-amber-500 text-amber-300"
                          : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500"
                      }`}
                    >
                      <Ico size={15} /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Reason */}
          <div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">
              {isVoid ? "Void Reason" : "Refund Reason"}
            </p>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(null); }}
              placeholder={isVoid ? "e.g. Customer changed mind, duplicate order…" : "e.g. Incorrect item, quality issue…"}
              className="w-full bg-slate-700 border border-slate-600 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>

          {/* Void warning */}
          {isVoid && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
              <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-xs">
                This will cancel all {orderIds.length} order{orderIds.length !== 1 ? "s" : ""} for Table {tableLabel}. This action cannot be undone.
              </p>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-semibold text-sm transition"
          >
            Cancel
          </button>
          <button
            onClick={isVoid ? handleVoid : handleRefund}
            disabled={loading || !reason.trim()}
            className={`flex-1 py-3 ${actionCls} disabled:opacity-50 text-white rounded-xl font-bold text-sm transition flex items-center justify-center gap-2`}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
            {loading ? "Processing…" : isVoid ? "Void Table" : "Confirm Refund"}
          </button>
        </div>
      </div>
    </div>
  );
}

function isOutOfStock(item: MenuItem): boolean {
  if (item.stockQty !== undefined && item.stockQty <= 0) return true;
  if (item.stockStatus === "out_of_stock") return false; // intentionally: only qty blocks
  return false;
}

// ─── PIN pad ──────────────────────────────────────────────────────────────────

function PinPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return (
    <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
      {keys.map((k, i) => (
        k === "" ? (
          <div key={i} />
        ) : (
          <button
            key={k + i}
            onClick={() => {
              if (k === "⌫") onChange(value.slice(0, -1));
              else if (value.length < 4) onChange(value + k);
            }}
            className={`h-16 rounded-2xl text-2xl font-bold transition-all active:scale-95 select-none ${
              k === "⌫"
                ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                : "bg-slate-700 text-white hover:bg-slate-600 active:bg-orange-500"
            }`}
          >
            {k}
          </button>
        )
      ))}
    </div>
  );
}

// ─── Item modal ───────────────────────────────────────────────────────────────

function ItemModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (cartItem: WaiterCartItem) => void;
}) {
  const firstVar = item.variations?.[0];
  const firstOpt = firstVar?.options?.[0];

  const [selVarId,  setSelVarId]  = useState(firstVar?.id ?? "");
  const [selOptId,  setSelOptId]  = useState(firstOpt?.id ?? "");
  const [addOnIds,  setAddOnIds]  = useState<Set<string>>(new Set());
  const [qty,       setQty]       = useState(1);
  const [note,      setNote]      = useState("");

  const selectedOption = item.variations
    ?.find((v) => v.id === selVarId)
    ?.options.find((o) => o.id === selOptId);

  const basePrice = selectedOption?.price ?? item.price;
  const addOnTotal = (item.addOns ?? [])
    .filter((a) => addOnIds.has(a.id))
    .reduce((s, a) => s + a.price, 0);
  const unitPrice = basePrice + addOnTotal;

  function buildName(): string {
    let name = item.name;
    if (selectedOption) name += ` (${selectedOption.label})`;
    const addOnNames = (item.addOns ?? [])
      .filter((a) => addOnIds.has(a.id))
      .map((a) => a.name);
    if (addOnNames.length) name += " + " + addOnNames.join(", ");
    return name;
  }

  function handleAdd() {
    onAdd({
      lineId:    crypto.randomUUID(),
      menuItemId: item.id,
      name:      buildName(),
      unitPrice,
      quantity:  qty,
      note:      note.trim() || undefined,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-800 rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-700">
          <div>
            <h3 className="text-white font-bold text-lg leading-tight">{item.name}</h3>
            {item.description && (
              <p className="text-slate-400 text-sm mt-0.5 leading-snug">{item.description}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition ml-3 flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {/* Variations */}
          {item.variations?.map((variation) => (
            <div key={variation.id}>
              <p className="text-slate-300 text-xs font-bold uppercase tracking-widest mb-2">
                {variation.name}
              </p>
              <div className="grid grid-cols-1 gap-2">
                {variation.options.map((opt) => {
                  const active = selVarId === variation.id && selOptId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => { setSelVarId(variation.id); setSelOptId(opt.id); }}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                        active
                          ? "bg-orange-500 border-orange-500 text-white"
                          : "bg-slate-700/50 border-slate-600 text-slate-200 hover:border-orange-500/50"
                      }`}
                    >
                      <span>{opt.label}</span>
                      <span className={active ? "text-orange-100" : "text-slate-400"}>
                        {fmtCur(opt.price)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Add-ons */}
          {(item.addOns ?? []).length > 0 && (
            <div>
              <p className="text-slate-300 text-xs font-bold uppercase tracking-widest mb-2">Add-ons</p>
              <div className="grid grid-cols-1 gap-2">
                {item.addOns!.map((addon) => {
                  const checked = addOnIds.has(addon.id);
                  return (
                    <button
                      key={addon.id}
                      onClick={() => {
                        setAddOnIds((prev) => {
                          const next = new Set(prev);
                          checked ? next.delete(addon.id) : next.add(addon.id);
                          return next;
                        });
                      }}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                        checked
                          ? "bg-orange-500/20 border-orange-500 text-orange-300"
                          : "bg-slate-700/50 border-slate-600 text-slate-200 hover:border-orange-500/50"
                      }`}
                    >
                      <span>{addon.name}</span>
                      <span className={checked ? "text-orange-300" : "text-slate-400"}>
                        +{fmtCur(addon.price)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Note */}
          <div>
            <p className="text-slate-300 text-xs font-bold uppercase tracking-widest mb-2">
              Special instruction (optional)
            </p>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. No onions, extra sauce…"
              className="w-full bg-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        {/* Footer: qty + add */}
        <div className="p-5 border-t border-slate-700 flex items-center gap-3">
          {/* Qty stepper */}
          <div className="flex items-center gap-2 bg-slate-700 rounded-xl p-1">
            <button
              onClick={() => setQty(Math.max(1, qty - 1))}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-600 transition"
            >
              <Minus size={14} />
            </button>
            <span className="text-white font-bold w-6 text-center text-lg">{qty}</span>
            <button
              onClick={() => setQty(qty + 1)}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-600 transition"
            >
              <Plus size={14} />
            </button>
          </div>

          <button
            onClick={handleAdd}
            className="flex-1 bg-orange-500 hover:bg-orange-400 active:scale-[0.98] text-white font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-all"
          >
            <Plus size={16} />
            Add · {fmtCur(unitPrice * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WaiterPage() {
  // ── Menu data from AppContext (single source of truth, same as admin/online) ─
  const { menuItems, categories, settings: appSettings } = useApp();

  // ── Data ────────────────────────────────────────────────────────────────────
  const [allWaiters,     setAllWaiters]     = useState<Omit<WaiterStaff,"pin">[]>([]);
  const [tables,         setTables]         = useState<DiningTable[]>([]);
  const [occupiedLabels, setOccupiedLabels] = useState<Set<string>>(new Set());

  // ── Auth ────────────────────────────────────────────────────────────────────
  const [view,         setView]         = useState<View>("login");
  const [loginStep,    setLoginStep]    = useState<LoginStep>("staff");
  const [loginTarget,  setLoginTarget]  = useState<Omit<WaiterStaff,"pin"> | null>(null);
  const [pin,          setPin]          = useState("");
  const [pinError,     setPinError]     = useState(false);
  const [waiter,       setWaiter]       = useState<Omit<WaiterStaff,"pin"> | null>(null);
  const pinShakeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Table selection ──────────────────────────────────────────────────────────
  const [activeSection,  setActiveSection]  = useState("All");
  const [activeTable,    setActiveTable]    = useState<DiningTable | null>(null);
  const [covers,         setCovers]         = useState(2);

  // ── Ordering ─────────────────────────────────────────────────────────────────
  const [activeCatId,  setActiveCatId]  = useState<string | null>(null);
  const [cart,         setCart]         = useState<WaiterCartItem[]>([]);
  const [kitchenNote,  setKitchenNote]  = useState("");
  const [modalItem,    setModalItem]    = useState<MenuItem | null>(null);
  const [showCart,     setShowCart]     = useState(false); // mobile bottom-sheet

  // ── Send state ────────────────────────────────────────────────────────────────
  const [sending,      setSending]      = useState(false);

  // ── Bill state ────────────────────────────────────────────────────────────────
  const [billOrders,   setBillOrders]   = useState<BillOrder[]>([]);
  const [billLoading,  setBillLoading]  = useState(false);
  const [paying,       setPaying]       = useState(false);
  // table action sheet: null = closed, DiningTable = which table was tapped
  const [tableAction,  setTableAction]  = useState<DiningTable | null>(null);

  // ── Receipt state ─────────────────────────────────────────────────────────────
  const [receipt,      setReceipt]      = useState<WaiterReceipt | null>(null);

  // ── Void / Refund state ───────────────────────────────────────────────────────
  const [voidRefundTarget, setVoidRefundTarget] = useState<{
    mode: "void" | "refund";
    orderIds: string[];
    total: number;
    tableLabel: string;
  } | null>(null);

  // ── Initialise: restore session + load staff/tables config ──────────────────
  useEffect(() => {
    // Restore session
    try {
      const stored = sessionStorage.getItem("waiter_session");
      if (stored) {
        setWaiter(JSON.parse(stored));
        setView("tables");
      }
    } catch { /* ignore */ }

    // Load staff + tables
    fetch("/api/waiter/config")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setAllWaiters(d.waiters);
          setTables(d.tables);
        }
      });
  }, []);

  // ── Set initial category when menu loads ─────────────────────────────────────
  useEffect(() => {
    if (categories.length > 0 && activeCatId === null) {
      setActiveCatId(categories[0].id);
    }
  }, [categories, activeCatId]);

  // ── Occupied table detection ─────────────────────────────────────────────────
  const refreshOccupied = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select("note, status")
      .like("note", "[WAITER]%")
      .not("status", "in", '("delivered","cancelled")');

    const labels = new Set<string>();
    for (const o of data ?? []) {
      const m = String(o.note ?? "").match(/Table\s+(\S+)/);
      if (m) labels.add(m[1]);
    }
    setOccupiedLabels(labels);
  }, []);

  useEffect(() => {
    if (view === "tables") refreshOccupied();
  }, [view, refreshOccupied]);

  // ── Login flow ───────────────────────────────────────────────────────────────
  function selectStaff(w: Omit<WaiterStaff, "pin">) {
    setLoginTarget(w);
    setPin("");
    setPinError(false);
    setLoginStep("pin");
  }

  useEffect(() => {
    if (pin.length === 4 && loginTarget) {
      fetch("/api/waiter/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: loginTarget.id, pin }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) {
            setWaiter(d.waiter);
            sessionStorage.setItem("waiter_session", JSON.stringify(d.waiter));
            setView("tables");
            setLoginStep("staff");
            setPin("");
          } else {
            setPinError(true);
            setPin("");
            if (pinShakeRef.current) clearTimeout(pinShakeRef.current);
            pinShakeRef.current = setTimeout(() => setPinError(false), 700);
          }
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  function logout() {
    sessionStorage.removeItem("waiter_session");
    setWaiter(null);
    setLoginStep("staff");
    setLoginTarget(null);
    setPin("");
    setCart([]);
    setActiveTable(null);
    setView("login");
  }

  // ── Table selection ──────────────────────────────────────────────────────────
  function selectTable(table: DiningTable) {
    setActiveTable(table);
    setCart([]);
    setKitchenNote("");
    setView("menu");
  }

  // ── Cart ─────────────────────────────────────────────────────────────────────
  function addToCart(item: WaiterCartItem) {
    setCart((prev) => {
      // Merge identical lines (same name + no note)
      const match = prev.find((l) => l.name === item.name && !l.note && !item.note);
      if (match) return prev.map((l) => l.lineId === match.lineId ? { ...l, quantity: l.quantity + item.quantity } : l);
      return [...prev, item];
    });
    setShowCart(true);
  }

  function updateQty(lineId: string, delta: number) {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.lineId !== lineId) return [l];
        const next = l.quantity + delta;
        return next <= 0 ? [] : [{ ...l, quantity: next }];
      })
    );
  }

  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
  }

  // Quick-add for items with no modifiers
  function quickAdd(item: MenuItem) {
    if (isOutOfStock(item)) return;
    if ((item.variations?.length ?? 0) > 0 || (item.addOns?.length ?? 0) > 0) {
      setModalItem(item);
      return;
    }
    addToCart({
      lineId: crypto.randomUUID(),
      menuItemId: item.id,
      name: item.name,
      unitPrice: item.price,
      quantity: 1,
    });
  }

  // ── Send to kitchen ──────────────────────────────────────────────────────────
  async function sendToKitchen() {
    if (!activeTable || cart.length === 0 || sending) return;
    setSending(true);
    const total = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const res = await fetch("/api/waiter/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tableLabel: activeTable.label,
        covers,
        staffName: waiter?.name,
        items: cart.map((l) => ({ name: l.name + (l.note ? ` [${l.note}]` : ""), qty: l.quantity, price: l.unitPrice })),
        total,
        kitchenNote: kitchenNote.trim() || undefined,
      }),
    });
    setSending(false);
    if (res.ok) {
      setReceipt({
        tableLabel:    activeTable.label,
        waiterName:    waiter?.name ?? "Staff",
        date:          new Date().toISOString(),
        items:         cart.map((l) => ({ name: l.name, qty: l.quantity, price: l.unitPrice })),
        total,
        paymentMethod: "pending",
        orderIds:      [],
      });
      setView("success");
      refreshOccupied();
    }
  }

  // ── Bill ─────────────────────────────────────────────────────────────────────
  async function openBill(table: DiningTable) {
    setTableAction(null);
    setActiveTable(table);
    setBillLoading(true);
    setView("bill");

    const { data } = await supabase
      .from("orders")
      .select("id, items, total, note, status")
      .like("note", `[WAITER]%Table ${table.label}%`)
      .not("status", "in", '("delivered","cancelled")');

    setBillOrders(
      (data ?? []).map((o) => ({
        id:    o.id,
        items: o.items ?? [],
        total: Number(o.total),
        note:  String(o.note ?? ""),
      }))
    );
    setBillLoading(false);
  }

  async function payBill(method: "cash" | "card") {
    if (!activeTable || billOrders.length === 0 || paying) return;
    setPaying(true);
    await fetch("/api/waiter/settle", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        orderIds:    billOrders.map((o) => o.id),
        tableLabel:  activeTable.label,
        paymentMethod: method,
      }),
    });
    setPaying(false);

    // Consolidate items for receipt
    const lineMap = new Map<string, { name: string; qty: number; price: number }>();
    for (const o of billOrders) {
      for (const it of o.items) {
        const ex = lineMap.get(it.name);
        if (ex) ex.qty += it.qty;
        else lineMap.set(it.name, { ...it });
      }
    }
    setReceipt({
      tableLabel:    activeTable.label,
      waiterName:    waiter?.name ?? "Staff",
      date:          new Date().toISOString(),
      items:         Array.from(lineMap.values()),
      total:         billOrders.reduce((s, o) => s + o.total, 0),
      paymentMethod: method,
      orderIds:      billOrders.map((o) => o.id),
    });
    // Stay on bill view — ReceiptModal overlays and navigates away on close
  }

  // ── Computed ─────────────────────────────────────────────────────────────────
  const cartTotal   = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const cartCount   = cart.reduce((s, l) => s + l.quantity, 0);
  const sections    = ["All", ...Array.from(new Set(tables.map((t) => t.section)))];
  const visibleTables = activeSection === "All"
    ? tables
    : tables.filter((t) => t.section === activeSection);
  const visibleItems = menuItems.filter(
    (m) => !activeCatId || m.categoryId === activeCatId
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  // ── SUCCESS ──────────────────────────────────────────────────────────────────
  if (view === "success") {
    return (
      <>
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={40} className="text-white" />
          </div>
          <div>
            <h2 className="text-white text-2xl font-black">Order Sent!</h2>
            <p className="text-slate-400 mt-1">Kitchen is preparing {activeTable?.label}</p>
          </div>
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={() => { setCart([]); setKitchenNote(""); setView("menu"); }}
              className="px-6 py-3 bg-slate-700 text-white font-semibold rounded-2xl hover:bg-slate-600 transition"
            >
              Add more items
            </button>
            <button
              onClick={() => { setCart([]); setKitchenNote(""); setActiveTable(null); setView("tables"); }}
              className="px-6 py-3 bg-orange-500 text-white font-bold rounded-2xl hover:bg-orange-400 transition"
            >
              New table
            </button>
          </div>

          {/* Receipt actions */}
          {receipt && (
            <div className="flex gap-3 justify-center flex-wrap pt-2">
              <button
                onClick={() => setReceipt({ ...receipt })}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
              >
                <Eye size={15} /> View Receipt
              </button>
              <button
                onClick={() => {
                  const win = window.open("", "_blank", "width=400,height=600");
                  if (!win) return;
                  win.document.write(`<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script>`);
                  win.document.close();
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
              >
                <Printer size={15} /> Print
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Receipt modal */}
      {receipt && (
        <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
      )}
      </>
    );
  }

  // ── LOGIN ────────────────────────────────────────────────────────────────────
  if (view === "login") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 gap-8">
        {/* Branding */}
        <div className="text-center">
          <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <UtensilsCrossed size={28} className="text-white" />
          </div>
          <h1 className="text-white text-2xl font-black">Waiter Login</h1>
          <p className="text-slate-400 text-sm mt-1">Select your name then enter your PIN</p>
        </div>

        {loginStep === "staff" ? (
          /* Staff grid */
          <div className="w-full max-w-sm space-y-3">
            {allWaiters.length === 0 ? (
              <p className="text-slate-500 text-center text-sm">Loading staff…</p>
            ) : (
              allWaiters.map((w) => (
                <button
                  key={w.id}
                  onClick={() => selectStaff(w)}
                  className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-2xl px-5 py-4 transition-all"
                >
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
                    style={{ backgroundColor: w.avatarColor }}
                  >
                    {initials(w.name)}
                  </div>
                  <div className="text-left">
                    <p className="text-white font-bold">{w.name}</p>
                    <p className="text-slate-400 text-xs capitalize">{w.role}</p>
                  </div>
                  <ChevronLeft size={16} className="text-slate-500 ml-auto rotate-180" />
                </button>
              ))
            )}
          </div>
        ) : (
          /* PIN pad */
          <div className="w-full max-w-sm space-y-6">
            <button
              onClick={() => { setLoginStep("staff"); setPin(""); setPinError(false); }}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition text-sm"
            >
              <ArrowLeft size={14} /> Back
            </button>

            {/* Who */}
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ backgroundColor: loginTarget?.avatarColor }}
              >
                {initials(loginTarget?.name ?? "")}
              </div>
              <p className="text-white font-semibold">{loginTarget?.name}</p>
            </div>

            {/* PIN dots */}
            <div className={`flex justify-center gap-4 ${pinError ? "animate-bounce" : ""}`}>
              {[0,1,2,3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-all ${
                    i < pin.length
                      ? pinError ? "bg-red-500 border-red-500" : "bg-orange-500 border-orange-500"
                      : "border-slate-600"
                  }`}
                />
              ))}
            </div>

            <PinPad value={pin} onChange={setPin} />

            {pinError && (
              <p className="text-red-400 text-sm text-center font-medium">Incorrect PIN — try again</p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── TABLES ───────────────────────────────────────────────────────────────────
  if (view === "tables") {
    return (
      <>
      <div className="min-h-screen bg-slate-950 flex flex-col">
        {/* Header */}
        <header className="bg-slate-900 border-b border-slate-800 px-5 py-4 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center">
              <UtensilsCrossed size={17} className="text-white" />
            </div>
            <h1 className="text-white font-black text-base">Table Selection</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: waiter?.avatarColor ?? "#666" }}
              >
                {initials(waiter?.name ?? "")}
              </div>
              <span className="text-slate-300 text-sm font-medium hidden sm:block">{waiter?.name}</span>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl text-xs font-medium transition"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </header>

        {/* Section filter */}
        {sections.length > 2 && (
          <div className="flex gap-2 px-5 py-3 overflow-x-auto flex-shrink-0 border-b border-slate-800">
            {sections.map((s) => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition ${
                  activeSection === s
                    ? "bg-orange-500 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Table grid */}
        <div className="flex-1 p-5 overflow-y-auto">
          {tables.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-600">
              <UtensilsCrossed size={40} className="mb-3 opacity-30" />
              <p className="text-sm">No tables configured</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {visibleTables.map((table) => {
                const occupied = occupiedLabels.has(table.label);
                return (
                  <button
                    key={table.id}
                    onClick={() => occupied ? setTableAction(table) : selectTable(table)}
                    className={`relative flex flex-col items-center justify-center rounded-2xl p-4 aspect-square border-2 transition-all active:scale-95 ${
                      occupied
                        ? "bg-amber-950/40 border-amber-500/60 hover:bg-amber-950/60"
                        : "bg-slate-800 border-slate-700 hover:border-orange-500/60 hover:bg-slate-700"
                    }`}
                  >
                    {occupied && (
                      <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                    )}
                    <span className={`text-2xl font-black ${occupied ? "text-amber-300" : "text-white"}`}>
                      {table.label}
                    </span>
                    <span className={`text-xs mt-1 ${occupied ? "text-amber-400/70" : "text-slate-500"}`}>
                      <Users size={10} className="inline mr-0.5" />{table.seats}
                    </span>
                    {occupied && (
                      <span className="text-[10px] text-amber-500 font-semibold mt-0.5">Occupied</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Occupied-table action sheet ─────────────────────────────────── */}
        {tableAction && (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTableAction(null)} />
            <div className="relative bg-slate-900 rounded-t-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
                  <UtensilsCrossed size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-black text-lg">Table {tableAction.label}</p>
                  <p className="text-amber-400 text-xs font-medium">Currently occupied</p>
                </div>
              </div>

              <button
                onClick={() => { setTableAction(null); selectTable(tableAction); }}
                className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] rounded-2xl px-5 py-4 transition-all"
              >
                <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Utensils size={18} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="text-white font-bold">Add More Items</p>
                  <p className="text-slate-400 text-xs">Send another round to the kitchen</p>
                </div>
              </button>

              <button
                onClick={() => openBill(tableAction)}
                className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] rounded-2xl px-5 py-4 transition-all"
              >
                <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Receipt size={18} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="text-white font-bold">View Bill &amp; Pay</p>
                  <p className="text-slate-400 text-xs">Show total and settle the table</p>
                </div>
              </button>

              <button
                onClick={() => setTableAction(null)}
                className="w-full py-3 text-slate-500 hover:text-slate-300 text-sm font-medium transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Last receipt — floats above tables view after payment */}
      {receipt && (
        <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
      )}
      </>
    );
  }

  // ── BILL ─────────────────────────────────────────────────────────────────────
  if (view === "bill") {
    const billTotal = billOrders.reduce((s, o) => s + o.total, 0);

    // Consolidate all items across orders into a single list
    const lineMap = new Map<string, { name: string; qty: number; price: number }>();
    for (const order of billOrders) {
      for (const item of order.items) {
        const key = item.name;
        const existing = lineMap.get(key);
        if (existing) {
          existing.qty += item.qty;
        } else {
          lineMap.set(key, { name: item.name, qty: item.qty, price: item.price });
        }
      }
    }
    const consolidatedLines = Array.from(lineMap.values());

    function printBillPreview() {
      const rs = appSettings?.receiptSettings;
      const tempReceipt: WaiterReceipt = {
        tableLabel:    activeTable!.label,
        waiterName:    waiter?.name ?? "Staff",
        date:          new Date().toISOString(),
        items:         consolidatedLines,
        total:         billTotal,
        paymentMethod: "pending",
        orderIds:      billOrders.map(o => o.id),
      };
      const restaurantName = rs?.restaurantName?.trim() || appSettings?.restaurant?.name || "Restaurant";
      const html = buildReceiptHtml(tempReceipt, restaurantName, rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!");
      const win = window.open("", "_blank", "width=400,height=600");
      if (!win) return;
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
      win.onafterprint = () => win.close();
    }

    return (
      <>
      <div className="min-h-screen bg-slate-950 flex flex-col">
        {/* Header */}
        <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => { setView("tables"); setActiveTable(null); setBillOrders([]); }}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex-shrink-0"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-base">Bill — Table {activeTable?.label}</p>
            <p className="text-slate-400 text-xs">{billOrders.length} order{billOrders.length !== 1 ? "s" : ""} · {consolidatedLines.length} item type{consolidatedLines.length !== 1 ? "s" : ""}</p>
          </div>
          <Receipt size={20} className="text-emerald-400 flex-shrink-0" />
        </header>

        {/* Bill content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {billLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={28} className="text-orange-500 animate-spin" />
            </div>
          ) : billOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-600">
              <ClipboardList size={40} className="mb-3 opacity-30" />
              <p className="text-sm">No active orders found for this table.</p>
            </div>
          ) : (
            <>
              {/* Receipt card */}
              <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-800">
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Items</p>
                </div>
                <div className="divide-y divide-slate-800">
                  {consolidatedLines.map((line, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-3 gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-slate-500 text-sm font-bold w-6 flex-shrink-0">{line.qty}×</span>
                        <span className="text-white text-sm leading-snug">{line.name}</span>
                      </div>
                      <span className="text-white text-sm font-semibold flex-shrink-0">
                        {fmtCur(line.price * line.qty)}
                      </span>
                    </div>
                  ))}
                </div>
                {/* Total */}
                <div className="px-5 py-4 border-t border-slate-700 bg-slate-800/50 flex items-center justify-between">
                  <span className="text-slate-300 text-sm font-semibold">Total</span>
                  <span className="text-white text-2xl font-black">{fmtCur(billTotal)}</span>
                </div>
              </div>

              {/* Waiter note */}
              <p className="text-slate-600 text-xs text-center">
                {billOrders.length > 1 ? `Consolidated from ${billOrders.length} separate orders` : "Single order"}
                {" · "}Table {activeTable?.label}
              </p>
            </>
          )}
        </div>

        {/* Payment buttons */}
        {!billLoading && billOrders.length > 0 && (
          <div className="p-5 border-t border-slate-800 bg-slate-900 space-y-3 flex-shrink-0">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest text-center mb-1">
              Select Payment Method
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => payBill("cash")}
                disabled={paying}
                className="flex flex-col items-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 active:scale-[0.97] text-white font-bold py-5 rounded-2xl transition-all"
              >
                {paying ? <Loader2 size={22} className="animate-spin" /> : <Banknote size={22} />}
                <span className="text-sm">Pay by Cash</span>
              </button>
              <button
                onClick={() => payBill("card")}
                disabled={paying}
                className="flex flex-col items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 active:scale-[0.97] text-white font-bold py-5 rounded-2xl transition-all"
              >
                {paying ? <Loader2 size={22} className="animate-spin" /> : <CreditCard size={22} />}
                <span className="text-sm">Pay by Card</span>
              </button>
            </div>
            <button
              onClick={() => { setView("tables"); setActiveTable(null); setBillOrders([]); }}
              className="w-full py-3 text-slate-500 hover:text-slate-300 text-sm font-medium transition"
            >
              Back to Tables
            </button>
          </div>
        )}

        {/* Print / Email bill (before payment) */}
        {!billLoading && billOrders.length > 0 && !paying && (
          <BillEmailBar
            onPrint={printBillPreview}
            tableLabel={activeTable!.label}
            waiterName={waiter?.name ?? "Staff"}
            consolidatedLines={consolidatedLines}
            billTotal={billTotal}
            orderIds={billOrders.map(o => o.id)}
          />
        )}

        {/* Void Table — senior staff only */}
        {!billLoading && billOrders.length > 0 && !paying && (
          <div className="px-5 pb-5 flex-shrink-0">
            <button
              onClick={() => setVoidRefundTarget({
                mode: "void",
                orderIds: billOrders.map(o => o.id),
                total: billTotal,
                tableLabel: activeTable!.label,
              })}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-transparent border border-red-900/50 hover:border-red-700 text-red-500 hover:text-red-400 text-sm font-medium rounded-2xl transition"
            >
              <AlertTriangle size={14} />
              {waiter?.role === "senior" ? "Void Table" : "Void Table (Senior only)"}
            </button>
          </div>
        )}
      </div>

      {/* Receipt modal — overlays bill view after payment */}
      {receipt && (
        <ReceiptModal
          receipt={receipt}
          onClose={() => {
            setReceipt(null);
            setBillOrders([]);
            setActiveTable(null);
            refreshOccupied();
            setView("tables");
          }}
          onRefund={receipt.orderIds.length > 0 ? () => {
            setVoidRefundTarget({
              mode: "refund",
              orderIds: receipt.orderIds,
              total: receipt.total,
              tableLabel: receipt.tableLabel,
            });
          } : undefined}
        />
      )}

      {/* Void / Refund modal */}
      {voidRefundTarget && (
        <VoidRefundModal
          {...voidRefundTarget}
          waiterName={waiter?.name ?? "Staff"}
          isSenior={waiter?.role === "senior"}
          onClose={() => setVoidRefundTarget(null)}
          onSuccess={() => {
            setVoidRefundTarget(null);
            if (voidRefundTarget.mode === "void") {
              setBillOrders([]);
              setActiveTable(null);
              refreshOccupied();
              setView("tables");
            } else {
              // Refund: dismiss receipt + go back to tables
              setReceipt(null);
              setBillOrders([]);
              setActiveTable(null);
              refreshOccupied();
              setView("tables");
            }
          }}
        />
      )}
      </>
    );
  }

  // ── MENU / ORDERING ───────────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-slate-950 flex flex-col overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => { setView("tables"); setCart([]); setActiveTable(null); }}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex-shrink-0"
        >
          <ArrowLeft size={16} />
        </button>

        {/* Table + covers */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-orange-400 font-black text-xl">{activeTable?.label}</span>
          <span className="text-slate-600">·</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCovers(Math.max(1, covers - 1))}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition"
            >
              <Minus size={12} />
            </button>
            <span className="text-white text-sm font-semibold w-7 text-center">{covers}</span>
            <button
              onClick={() => setCovers(covers + 1)}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition"
            >
              <Plus size={12} />
            </button>
            <span className="text-slate-500 text-xs ml-1">covers</span>
          </div>
        </div>

        {/* Mobile cart toggle */}
        <button
          onClick={() => setShowCart((v) => !v)}
          className="sm:hidden relative flex items-center gap-1.5 bg-orange-500 text-white px-3 py-2 rounded-xl text-sm font-bold"
        >
          <ChefHat size={14} />
          {cartCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-white text-orange-600 text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center">
              {cartCount}
            </span>
          )}
        </button>

        {/* Desktop send button */}
        <button
          onClick={sendToKitchen}
          disabled={cart.length === 0 || sending}
          className="hidden sm:flex items-center gap-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white font-bold px-4 py-2.5 rounded-xl transition-all text-sm"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <SendHorizonal size={15} />}
          Send to Kitchen
          {cartCount > 0 && (
            <span className="bg-orange-300 text-orange-900 text-xs font-black px-1.5 py-0.5 rounded-lg">{cartCount}</span>
          )}
        </button>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── Left: Category tabs + item grid ─────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Category pills */}
          <div className="flex gap-2 px-4 py-3 overflow-x-auto flex-shrink-0 border-b border-slate-800">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCatId(cat.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition ${
                  activeCatId === cat.id
                    ? "bg-orange-500 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {cat.emoji && <span className="mr-1">{cat.emoji}</span>}{cat.name}
              </button>
            ))}
          </div>

          {/* Item grid */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {visibleItems.map((item) => {
                const oos    = isOutOfStock(item);
                const hasVar = (item.variations?.length ?? 0) > 0 || (item.addOns?.length ?? 0) > 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => quickAdd(item)}
                    disabled={oos}
                    className={`relative flex flex-col rounded-2xl border p-4 text-left transition-all active:scale-[0.97] ${
                      oos
                        ? "bg-slate-800/40 border-slate-800 opacity-50 cursor-not-allowed"
                        : "bg-slate-800 border-slate-700 hover:border-orange-500/50 hover:bg-slate-750"
                    }`}
                  >
                    {item.popular && !oos && (
                      <span className="absolute top-2 right-2 bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                        POPULAR
                      </span>
                    )}
                    {/* Emoji or image */}
                    <div className="text-3xl mb-2 leading-none">{item.image ? "🍽️" : "🍽️"}</div>
                    <p className="text-white font-semibold text-sm leading-snug line-clamp-2 flex-1">
                      {item.name}
                    </p>
                    {item.description && (
                      <p className="text-slate-500 text-[11px] mt-0.5 line-clamp-1">{item.description}</p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-orange-400 font-black text-base">{fmtCur(item.price)}</span>
                      {hasVar ? (
                        <span className="text-slate-500 text-[10px] font-semibold">options</span>
                      ) : oos ? (
                        <span className="text-red-400 text-[10px] font-semibold">Out of stock</span>
                      ) : (
                        <span className="w-7 h-7 flex items-center justify-center bg-orange-500 rounded-lg text-white">
                          <Plus size={13} />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Right: Cart (desktop) ────────────────────────────────────────── */}
        <div className="hidden sm:flex w-80 xl:w-96 flex-col border-l border-slate-800 bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <h2 className="text-white font-bold text-sm">
              Current Order · {activeTable?.label}
              {cart.length > 0 && (
                <span className="ml-2 bg-orange-500 text-white text-xs font-black px-2 py-0.5 rounded-full">{cartCount}</span>
              )}
            </h2>
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-600 select-none">
                <ChefHat size={32} className="mb-2 opacity-30" />
                <p className="text-sm">No items yet</p>
              </div>
            ) : (
              cart.map((line) => (
                <div key={line.lineId} className="bg-slate-800 rounded-xl p-3 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium leading-snug">{line.name}</p>
                    {line.note && (
                      <p className="text-amber-400 text-xs mt-0.5 flex items-center gap-1">
                        <StickyNote size={9} />{line.note}
                      </p>
                    )}
                    <p className="text-orange-400 text-sm font-bold mt-1">{fmtCur(line.unitPrice)}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => updateQty(line.lineId, -1)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
                      <Minus size={11} />
                    </button>
                    <span className="text-white text-sm font-bold w-5 text-center">{line.quantity}</span>
                    <button onClick={() => updateQty(line.lineId, +1)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
                      <Plus size={11} />
                    </button>
                    <button onClick={() => removeLine(line.lineId)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-red-900/60 text-slate-400 hover:text-red-400 transition ml-1">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Kitchen note */}
          <div className="px-3 pb-2 flex-shrink-0">
            <div className="flex items-center gap-2 bg-slate-800 rounded-xl px-3 py-2">
              <StickyNote size={13} className="text-amber-400 flex-shrink-0" />
              <input
                type="text"
                value={kitchenNote}
                onChange={(e) => setKitchenNote(e.target.value)}
                placeholder="Note to kitchen (optional)…"
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Total + send */}
          <div className="p-3 border-t border-slate-800 flex-shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-sm">Total</span>
              <span className="text-white font-black text-xl">{fmtCur(cartTotal)}</span>
            </div>
            <button
              onClick={sendToKitchen}
              disabled={cart.length === 0 || sending}
              className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] text-base"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <SendHorizonal size={18} />}
              Send to Kitchen
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile cart bottom sheet ─────────────────────────────────────── */}
      {showCart && (
        <div className="sm:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCart(false)} />
          <div className="relative bg-slate-900 rounded-t-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <h2 className="text-white font-bold">Order · {activeTable?.label}</h2>
              <button onClick={() => setShowCart(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
              {cart.map((line) => (
                <div key={line.lineId} className="bg-slate-800 rounded-xl p-3 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{line.name}</p>
                    {line.note && <p className="text-amber-400 text-xs mt-0.5">{line.note}</p>}
                    <p className="text-orange-400 text-sm font-bold mt-1">{fmtCur(line.unitPrice)}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => updateQty(line.lineId, -1)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-700 text-slate-300"><Minus size={12} /></button>
                    <span className="text-white font-bold w-5 text-center">{line.quantity}</span>
                    <button onClick={() => updateQty(line.lineId, +1)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-700 text-slate-300"><Plus size={12} /></button>
                    <button onClick={() => removeLine(line.lineId)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-700 text-red-400 ml-1"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-800 space-y-3">
              <input
                type="text"
                value={kitchenNote}
                onChange={(e) => setKitchenNote(e.target.value)}
                placeholder="Note to kitchen…"
                className="w-full bg-slate-800 text-sm text-white placeholder-slate-500 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Total</span>
                <span className="text-white font-black text-xl">{fmtCur(cartTotal)}</span>
              </div>
              <button
                onClick={() => { sendToKitchen(); setShowCart(false); }}
                disabled={cart.length === 0 || sending}
                className="w-full bg-orange-500 disabled:opacity-40 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 text-base"
              >
                {sending ? <Loader2 size={18} className="animate-spin" /> : <SendHorizonal size={18} />}
                Send to Kitchen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Item modal */}
      {modalItem && (
        <ItemModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          onAdd={addToCart}
        />
      )}
    </div>
  );
}

