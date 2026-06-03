"use client";

import { uuid } from "@/lib/uuid";
import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { useIdleLogout } from "@/lib/useIdleLogout";
import { resolveStock, isAvailable } from "@/lib/stockUtils";
import { computeTax, taxSurcharge } from "@/lib/taxUtils";
import { getOfferUnitPrice, isOfferActive, cartLineTotal, offerBadgeLabel } from "@/lib/menuOfferUtils";
import type { MenuItem, MenuItemOffer, WaiterStaff, DiningTable } from "@/types";
import {
  ChefHat, ArrowLeft, Plus, Minus, Trash2, SendHorizonal,
  LogOut, Users, UtensilsCrossed, CheckCircle2, Loader2,
  ChevronLeft, StickyNote, X, Receipt, CreditCard, Banknote,
  ClipboardList, Utensils, Printer, Mail, Eye, RefreshCw,
  AlertTriangle, RotateCcw, ShieldAlert, Gift, Percent, BadgeDollarSign, Crown,
  Clock, CalendarClock,
} from "lucide-react";

// ─── Internal types ───────────────────────────────────────────────────────────

interface WaiterCartItem {
  lineId: string;
  menuItemId: string;
  name: string;       // includes variation/add-on labels
  unitPrice: number;  // base + variations + add-ons. Per-unit offers already
                      // applied to the base; cart-level offers are NOT — see
                      // `offer` below.
  quantity: number;
  note?: string;
  /** Cart-level offer snapshot (bogo / multibuy / qty_discount) taken at
   *  add-to-cart time so a mid-cart admin change doesn't retroactively
   *  rewrite a line. Per-unit offers are baked into unitPrice — for those
   *  this field stays undefined. */
  offer?: MenuItemOffer;
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
  /** Pre-discount/tip sum of items. Optional — when absent the receipt has no
   *  discount/tip and `total` is shown alone (back-compat). */
  subtotal?: number;
  /** Bill-level manual discount (money) and its reason. */
  discountAmount?: number;
  discountNote?: string;
  /** VAT on the (post-discount) bill, synced from the admin Tax & VAT setting.
   *  inclusive = VAT already inside the prices (informational line); exclusive
   *  = VAT added on top. rate is the % for the label. */
  vatAmount?: number;
  vatInclusive?: boolean;
  vatRate?: number;
  /** Table-service tip (money). */
  tipAmount?: number;
  /** Final amount owed = subtotal − discount + (exclusive VAT) + tip. */
  total: number;
  /** Amount paid by gift card. The cash/card amount collected is
   *  total − giftCardUsed. */
  giftCardUsed?: number;
  paymentMethod?: "cash" | "card" | "pending";
  orderIds: string[];
}

// Today's reservations the waiter grid overlays on the table tiles. Shape
// matches GET /api/waiter/reservations (camelCase). Read-only awareness; the
// only writes are seat (checked_in) and check-out (checked_out).
interface WaiterReservation {
  id: string;
  tableLabel: string;
  section: string;
  customerName: string;
  partySize: number;
  date: string;     // "YYYY-MM-DD"
  time: string;     // "HH:MM"
  status: string;   // pending | confirmed | checked_in
  note: string | null;
  source: string | null;
}

// Derived per-tile reservation state used to render badges + drive the seat sheet.
interface TileReservation {
  /** The reservation currently seated at this table (status checked_in), if any. */
  seated: WaiterReservation | null;
  /** The next not-yet-seated booking worth surfacing, if any. */
  next: WaiterReservation | null;
  /** Minutes from now until `next` (negative = the booking time has passed). */
  minutesUntil: number | null;
  /** `next` is arriving soon — prompt the waiter to seat it. */
  isDue: boolean;
  /** `next`'s time has passed and nobody has been seated (awaiting / likely no-show). */
  isOverdue: boolean;
  /** How many active bookings this table has today (seated + upcoming). */
  count: number;
  /** Upcoming (not-yet-seated) bookings — drives the "+N more" badge. */
  upcomingCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtCur = (n: number, sym = "£") =>
  sym + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

// "HH:MM" → minutes since midnight. Used to compare booking times against now.
function hhmmToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Awareness windows (minutes). A booking is "due" when it's within DUE_LEAD of
// now; "overdue" once it's OVERDUE_GRACE past with nobody seated; bookings more
// than STALE_MAX in the past are ignored as stale data (POS/admin will clear).
const DUE_LEAD      = 30;
const OVERDUE_GRACE = 15;
const STALE_MAX     = 120;

// ─── Receipt Modal ────────────────────────────────────────────────────────────

function buildReceiptHtml(receipt: WaiterReceipt, restaurantName: string, receiptPhone: string, receiptWebsite: string, vatNumber: string, thankYou: string, sym: string): string {
  const itemsHtml = receipt.items.map((it) =>
    `<tr>
      <td style="padding:2px 0;font-size:12px">${it.name} ×${it.qty}</td>
      <td style="padding:2px 0;font-size:12px;text-align:right">${sym}${(it.price * it.qty).toFixed(2)}</td>
    </tr>`
  ).join("");

  const payLabel = receipt.paymentMethod === "cash" ? "Cash" : receipt.paymentMethod === "card" ? "Card" : "Table Service";
  const giftUsed = receipt.giftCardUsed ?? 0;
  const amountPaid = Math.max(0, receipt.total - giftUsed);
  const rcptDiscount = receipt.discountAmount ?? 0;
  const rcptTip      = receipt.tipAmount ?? 0;
  const rcptVat      = receipt.vatAmount ?? 0;
  const rcptSubtotal = receipt.subtotal ?? receipt.total;
  const vatLabel     = receipt.vatInclusive
    ? `Incl. VAT${receipt.vatRate ? ` (${receipt.vatRate}%)` : ""}`
    : `VAT${receipt.vatRate ? ` (${receipt.vatRate}%)` : ""}`;
  // Subtotal / Discount / VAT / Tip lines only appear when something applies.
  const breakdownHtml = (rcptDiscount > 0 || rcptTip > 0 || rcptVat > 0)
    ? `<tr><td style="font-size:11px;color:#6b7280">Subtotal</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${rcptSubtotal.toFixed(2)}</td></tr>
       ${rcptDiscount > 0 ? `<tr><td style="font-size:11px;color:#16a34a">Discount${receipt.discountNote ? ` (${receipt.discountNote})` : ""}</td><td style="font-size:11px;color:#16a34a;text-align:right">−${sym}${rcptDiscount.toFixed(2)}</td></tr>` : ""}
       ${rcptVat > 0 ? `<tr><td style="font-size:11px;color:#6b7280">${vatLabel}</td><td style="font-size:11px;color:#6b7280;text-align:right">${receipt.vatInclusive ? "" : "+"}${sym}${rcptVat.toFixed(2)}</td></tr>` : ""}
       ${rcptTip > 0 ? `<tr><td style="font-size:11px;color:#6b7280">Tip</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${rcptTip.toFixed(2)}</td></tr>` : ""}`
    : "";

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
    ${breakdownHtml}
    <tr><td style="font-size:13px;font-weight:700">TOTAL</td><td style="font-size:13px;font-weight:700;text-align:right">${sym}${receipt.total.toFixed(2)}</td></tr>
    ${giftUsed > 0 ? `<tr><td style="font-size:11px;color:#7c3aed">Gift card</td><td style="font-size:11px;color:#7c3aed;text-align:right">−${sym}${giftUsed.toFixed(2)}</td></tr>
    <tr><td style="font-size:12px;font-weight:700">PAID (${payLabel})</td><td style="font-size:12px;font-weight:700;text-align:right">${sym}${amountPaid.toFixed(2)}</td></tr>` : `<tr><td style="font-size:11px;color:#6b7280">Payment</td><td style="font-size:11px;color:#6b7280;text-align:right">${payLabel}</td></tr>`}
  </table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  ${thankYou ? `<div style="text-align:center;font-weight:600;color:#374151;font-size:12px">${thankYou}</div>` : ""}
</div></body></html>`;
}

function ReceiptModal({ receipt, onClose, onRefund }: { receipt: WaiterReceipt; onClose: () => void; onRefund?: () => void }) {
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
            {((receipt.discountAmount ?? 0) > 0 || (receipt.tipAmount ?? 0) > 0 || (receipt.vatAmount ?? 0) > 0) && (
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
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-white font-black text-base">TOTAL</span>
              <span className="text-white font-black text-xl">{fmtCur(receipt.total, sym)}</span>
            </div>
            {(receipt.giftCardUsed ?? 0) > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-orange-300 text-xs">Gift card</span>
                  <span className="text-orange-300 text-xs">−{fmtCur(receipt.giftCardUsed ?? 0, sym)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white font-bold text-sm">Paid ({payLabel})</span>
                  <span className="text-white font-bold text-sm">{fmtCur(Math.max(0, receipt.total - (receipt.giftCardUsed ?? 0)), sym)}</span>
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

// ─── Bill Email Bar ───────────────────────────────────────────────────────────

function BillEmailBar({ onPrint, tableLabel, waiterName, consolidatedLines, billSubtotal, billDiscountAmount, billDiscountNote, billVatAmount, billVatInclusive, billVatRate, billTip, billTotal, orderIds }: {
  onPrint: () => void;
  tableLabel: string;
  waiterName: string;
  consolidatedLines: { name: string; qty: number; price: number }[];
  billSubtotal: number;
  billDiscountAmount: number;
  billDiscountNote: string;
  billVatAmount: number;
  billVatInclusive: boolean;
  billVatRate?: number;
  billTip: number;
  billTotal: number;
  orderIds: string[];
}) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const rs = settings.receiptSettings;
  const restaurantName = rs?.restaurantName?.trim() || settings.restaurant?.name || "Restaurant";
  const [emailTo, setEmailTo] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleEmail() {
    if (!emailTo.trim()) return;
    setEmailStatus("sending");
    const tempReceipt: WaiterReceipt = {
      tableLabel, waiterName,
      date: new Date().toISOString(),
      items: consolidatedLines,
      subtotal: billSubtotal,
      discountAmount: billDiscountAmount > 0 ? billDiscountAmount : undefined,
      discountNote:   billDiscountAmount > 0 ? (billDiscountNote.trim() || undefined) : undefined,
      vatAmount:      billVatAmount > 0 ? billVatAmount : undefined,
      vatInclusive:   billVatAmount > 0 ? billVatInclusive : undefined,
      vatRate:        billVatAmount > 0 ? billVatRate : undefined,
      tipAmount:      billTip > 0 ? billTip : undefined,
      total: billTotal,
      paymentMethod: "pending",
      orderIds,
    };
    const html = buildReceiptHtml(tempReceipt, restaurantName, rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!", sym);
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
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          value={emailTo}
          onChange={e => { setEmailTo(e.target.value); setEmailStatus("idle"); }}
          placeholder="Send bill to email…"
          className="flex-1 min-w-0 bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm rounded-xl px-3 py-2.5 outline-none focus:border-orange-500"
        />
        <button
          onClick={handleEmail}
          disabled={!emailTo.trim() || emailStatus === "sending" || emailStatus === "sent"}
          className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition flex-shrink-0"
        >
          {emailStatus === "sending" ? <Loader2 size={15} className="animate-spin" /> :
            emailStatus === "sent" ? <CheckCircle2 size={15} /> :
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
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const [reason, setReason] = useState("");
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [refundAmountStr, setRefundAmountStr] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "card">("cash");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

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
    if (inFlight.current) return;
    if (!reason.trim()) { setError("Please enter a reason."); return; }
    inFlight.current = true;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/waiter/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, reason: reason.trim(), voidedBy: waiterName }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (d.ok) onSuccess();
      else setError(d.error ?? "Failed to void orders.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function handleRefund() {
    if (inFlight.current) return;
    if (!reason.trim()) { setError("Please enter a reason."); return; }
    const amount = refundType === "full" ? total : parseFloat(refundAmountStr);
    if (isNaN(amount) || amount <= 0) { setError("Enter a valid refund amount."); return; }
    if (amount > total + 0.001) { setError(`Refund cannot exceed ${fmtCur(total, sym)}.`); return; }
    inFlight.current = true;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/waiter/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, refundAmount: amount, refundMethod, reason: reason.trim(), refundedBy: waiterName }),
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (d.ok) onSuccess();
      else setError(d.error ?? "Failed to process refund.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  const isVoid = mode === "void";
  const Icon = isVoid ? AlertTriangle : RotateCcw;
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
              <p className="text-slate-400 text-xs">Table {tableLabel} · {fmtCur(total, sym)}</p>
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
                      className={`py-2.5 rounded-xl text-sm font-semibold transition border ${refundType === t
                        ? "bg-amber-500/20 border-amber-500 text-amber-300"
                        : "bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500"
                        }`}
                    >
                      {t === "full" ? `Full ${fmtCur(total, sym)}` : "Partial"}
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
                    placeholder={`Max ${fmtCur(total, sym)}`}
                    className="w-full bg-slate-700 border border-slate-600 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                )}
              </div>

              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Return Method</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: "cash", label: "Cash", Ico: Banknote },
                    { v: "card", label: "Card", Ico: CreditCard },
                  ] as const).map(({ v, label, Ico }) => (
                    <button
                      key={v}
                      onClick={() => setRefundMethod(v)}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition border ${refundMethod === v
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

// Use the shared resolver so waiter agrees with customer site / admin / POS.
// Once an item is in track-quantity mode, stockStatus is ignored (so a stale
// "out_of_stock" status carried over from manual mode can't block sales).
function isOutOfStock(item: MenuItem): boolean {
  return !isAvailable(item);
}

// ─── PIN pad ──────────────────────────────────────────────────────────────────

function PinPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
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
              else if (value.length < 6) onChange(value + k);
            }}
            className={`h-16 rounded-2xl text-2xl font-bold transition-all active:scale-95 select-none ${k === "⌫"
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
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const firstVar = item.variations?.[0];
  const firstOpt = firstVar?.options?.[0];

  const [selVarId, setSelVarId] = useState(firstVar?.id ?? "");
  const [selOptId, setSelOptId] = useState(firstOpt?.id ?? "");
  const [addOnIds, setAddOnIds] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const selectedOption = item.variations
    ?.find((v) => v.id === selVarId)
    ?.options.find((o) => o.id === selOptId);

  // variations[].options[].price is a delta added on top of item.price (matches
  // ItemCustomizationModal and the admin MenuManagementPanel convention).
  const variationExtra = selectedOption?.price ?? 0;
  const addOnTotal = (item.addOns ?? [])
    .filter((a) => addOnIds.has(a.id))
    .reduce((s, a) => s + a.price, 0);
  // Per-unit offers (percent / fixed / price) discount the BASE only — not
  // variations / add-ons. Mirrors POS + customer site. Cart-level offers
  // (bogo / multibuy / qty_discount) return null here and are snapshotted on
  // the cart line at add time so cartLineTotal can apply them across qty.
  const offerUnitPrice = getOfferUnitPrice(item, "in_store");
  const basePrice = offerUnitPrice ?? item.price;
  const unitPrice = basePrice + variationExtra + addOnTotal;
  const cartLevelOffer = (offerUnitPrice === null && isOfferActive(item, "in_store"))
    ? item.offer
    : undefined;

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
      lineId: uuid(),
      menuItemId: item.id,
      name: buildName(),
      unitPrice,
      quantity: qty,
      note: note.trim() || undefined,
      offer: cartLevelOffer,
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
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all ${active
                        ? "bg-orange-500 border-orange-500 text-white"
                        : "bg-slate-700/50 border-slate-600 text-slate-200 hover:border-orange-500/50"
                        }`}
                    >
                      <span>{opt.label}</span>
                      <span className={active ? "text-orange-100" : "text-slate-400"}>
                        {fmtCur(item.price + opt.price, sym)}
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
                          if (checked) next.delete(addon.id); else next.add(addon.id);
                          return next;
                        });
                      }}
                      className={`flex text-left items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all ${checked
                        ? "bg-orange-500/20 border-orange-500 text-orange-300"
                        : "bg-slate-700/50 border-slate-600 text-slate-200 hover:border-orange-500/50"
                        }`}
                    >
                      <span>{addon.name}</span>
                      <span className={checked ? "text-orange-300 whitespace-nowrap" : "text-slate-400 whitespace-nowrap"}>
                        +{fmtCur(addon.price, sym)}
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
        <div className="p-5 border-t border-slate-700 flex flex-wrap items-center gap-3">
          {/* Qty stepper */}
          <div className="flex items-center gap-2 bg-slate-700 rounded-xl p-1">
            <button
              onClick={() => setQty(Math.max(1, qty - 1))}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-600 transition"
            >
              <Minus size={14} />
            </button>
            <span className="text-white font-bold w-6 text-center text-sm sm:text-base">{qty}</span>
            <button
              onClick={() => setQty(qty + 1)}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-600 transition"
            >
              <Plus size={14} />
            </button>
          </div>

          <button
            onClick={handleAdd}
            className="flex-1 bg-orange-500 hover:bg-orange-400 active:scale-[0.98] text-sm sm:text-base text-white font-bold rounded-xl px-1 py-3 flex items-center justify-center gap-2 transition-all"
          >
            <Plus size={16} />
            Add · {fmtCur(unitPrice * qty, sym)}
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
  const sym = appSettings.currency?.symbol ?? "£";

  // ── Data ────────────────────────────────────────────────────────────────────
  const [allWaiters, setAllWaiters] = useState<Omit<WaiterStaff, "pin">[]>([]);
  const [staffLoaded, setStaffLoaded] = useState(false);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [occupiedLabels, setOccupiedLabels] = useState<Set<string>>(new Set());
  // Today's active reservations, overlaid on the table grid. Kept entirely
  // separate from `occupiedLabels` so the two concepts never get merged.
  const [reservations, setReservations] = useState<WaiterReservation[]>([]);

  // ── Auth ────────────────────────────────────────────────────────────────────
  const [view, setView] = useState<View>("login");
  const [loginStep, setLoginStep] = useState<LoginStep>("staff");
  const [loginTarget, setLoginTarget] = useState<Omit<WaiterStaff, "pin"> | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [waiter, setWaiter] = useState<Omit<WaiterStaff, "pin"> | null>(null);
  const pinShakeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Table selection ──────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState("All");
  const [activeTable, setActiveTable] = useState<DiningTable | null>(null);
  const [covers, setCovers] = useState(2);

  // ── Ordering ─────────────────────────────────────────────────────────────────
  const [activeCatId, setActiveCatId] = useState<string | null>(null);
  const [cart, setCart] = useState<WaiterCartItem[]>([]);
  const [kitchenNote, setKitchenNote] = useState("");
  const [modalItem, setModalItem] = useState<MenuItem | null>(null);
  const [showCart, setShowCart] = useState(false); // mobile bottom-sheet

  // ── Send state ────────────────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);

  // ── Bill state ────────────────────────────────────────────────────────────────
  const [billOrders, setBillOrders] = useState<BillOrder[]>([]);
  const [billLoading, setBillLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  // Pending settle confirmation (the chosen method) — null means no prompt visible.
  const [settleConfirm, setSettleConfirm] = useState<"cash" | "card" | null>(null);
  // Gift card applied to the bill (bearer code). Reduces the amount due; the
  // remainder is settled by cash/card as normal.
  const [billGiftCard, setBillGiftCard] = useState<{ code: string; balance: number } | null>(null);
  const [gcInput, setGcInput] = useState("");
  const [gcError, setGcError] = useState("");
  const [gcLooking, setGcLooking] = useState(false);
  // Bill-level manual discount (percentage, like POS) + table-service tip.
  // Discount is senior/head-waiter only; both flow into the settle total and
  // the receipt. Reset whenever the bill is closed or the table changes.
  const [billDiscountPct, setBillDiscountPct]   = useState(0);
  const [billDiscountNote, setBillDiscountNote] = useState("");
  const [billTip, setBillTip]                   = useState(0);
  const [showBillDiscount, setShowBillDiscount] = useState(false);
  const [showBillTip, setShowBillTip]           = useState(false);
  const [discountInput, setDiscountInput]       = useState("");
  const [tipInput, setTipInput]                 = useState("");
  // table action sheet: null = closed, DiningTable = which table was tapped
  const [tableAction, setTableAction] = useState<DiningTable | null>(null);
  // seat sheet for a free-but-reserved table: choose "seat reservation" or "walk-in"
  const [seatAction, setSeatAction] = useState<{ table: DiningTable; reservation: WaiterReservation } | null>(null);
  // best-effort flag while a seat/check-in PUT is in flight (prevents double taps)
  const [seating, setSeating] = useState(false);

  // ── Receipt state ─────────────────────────────────────────────────────────────
  const [receipt, setReceipt] = useState<WaiterReceipt | null>(null);

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
        setStaffLoaded(true);
      })
      .catch(() => {
        setStaffLoaded(true);
      });
  }, []);

  // ── Live sync from admin (Bugs #9 + #12) ────────────────────────────────────
  // Re-fetch the public config every 15 s so admin-side additions (new tables,
  // newly-hired staff) appear without the waiter having to refresh the page.
  // When the waiter is signed in, also refresh their own profile from
  // /api/auth/waiter/me — admin edits to name/hourly rate/avatar previously
  // required a sign-out + sign-in to surface. A 401 here also auto-logs the
  // waiter out (covers the session_version path for deactivation).
  const lastConfigKey = useRef<string>("");
  const lastMeKey     = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (document.visibilityState !== "visible") return;

      try {
        const r = await fetch("/api/waiter/config", { cache: "no-store" });
        const d = await r.json();
        if (d.ok && !cancelled) {
          const key = JSON.stringify({ w: d.waiters, t: d.tables });
          if (key !== lastConfigKey.current) {
            lastConfigKey.current = key;
            setAllWaiters(d.waiters ?? []);
            setTables(d.tables ?? []);
          }
        }
      } catch { /* network — keep last good values */ }

      if (waiter) {
        try {
          const r = await fetch("/api/auth/waiter/me", { cache: "no-store" });
          if (r.status === 401) {
            if (!cancelled) {
              sessionStorage.removeItem("waiter_session");
              setWaiter(null);
              setView("login");
            }
            return;
          }
          const d = await r.json() as { ok: boolean; waiter?: Omit<WaiterStaff, "pin"> };
          if (d.ok && d.waiter && !cancelled) {
            const key = JSON.stringify(d.waiter);
            if (key !== lastMeKey.current) {
              lastMeKey.current = key;
              sessionStorage.setItem("waiter_session", JSON.stringify(d.waiter));
              setWaiter(d.waiter);
            }
          }
        } catch { /* ignore */ }
      }
    }
    const id = setInterval(tick, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [waiter]);

  // ── Set initial category when menu loads ─────────────────────────────────────
  useEffect(() => {
    if (categories.length > 0 && activeCatId === null) {
      setActiveCatId(categories[0].id);
    }
  }, [categories, activeCatId]);

  // ── Occupied table detection ─────────────────────────────────────────────────
  // Pulls all active dine-in orders via the authenticated /api/waiter/orders
  // endpoint and scans for the [WAITER] note pattern. Replaces the prior anon
  // supabase read.
  const refreshOccupied = useCallback(async () => {
    try {
      const r = await fetch("/api/waiter/orders", { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; orders?: Array<{ note?: string | null; status?: string }> };
      if (!json.ok || !json.orders) return;

      const labels = new Set<string>();
      for (const o of json.orders) {
        const note = String(o.note ?? "");
        if (!note.startsWith("[WAITER]")) continue;
        if (o.status === "delivered" || o.status === "cancelled") continue;
        const m = note.match(/Table\s+(\S+)/);
        if (m) labels.add(m[1]);
      }
      setOccupiedLabels(labels);
    } catch { /* ignore — surface is non-critical */ }
  }, []);

  useEffect(() => {
    if (view !== "tables") return;
    refreshOccupied();
    // Unlike the kitchen/driver/POS surfaces, the waiter grid had no auto-
    // refresh, so a tablet left on the tables view could show stale occupied/
    // free state until its own waiter acted. Poll every 5 s while the grid is
    // visible so changes from other devices (another waiter seating or
    // settling a table) self-heal. Interval matches the 4–6 s used elsewhere.
    const id = setInterval(refreshOccupied, 5_000);
    return () => clearInterval(id);
  }, [view, refreshOccupied]);

  // ── Today's reservations overlay ─────────────────────────────────────────────
  // Master kill-switch: when the reservation system is disabled the waiter grid
  // behaves exactly as before — no fetch, no badges, no seat actions.
  const reservationsEnabled = appSettings.reservationSystem?.enabled === true;
  const slotDuration = appSettings.reservationSystem?.slotDurationMinutes ?? 90;

  const refreshReservations = useCallback(async () => {
    if (!reservationsEnabled) { setReservations([]); return; }
    try {
      // Use the tablet's local date so a server/browser timezone gap can't shift
      // which day's bookings we load.
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const r = await fetch(`/api/waiter/reservations?date=${localDate}`, { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json() as { ok: boolean; reservations?: WaiterReservation[] };
      if (json.ok && Array.isArray(json.reservations)) setReservations(json.reservations);
    } catch { /* network — keep last good values */ }
  }, [reservationsEnabled]);

  useEffect(() => {
    if (view !== "tables" || !reservationsEnabled) return;
    refreshReservations();
    // Bookings don't move second-to-second, so poll slower than occupancy (30 s).
    const id = setInterval(refreshReservations, 30_000);
    return () => clearInterval(id);
  }, [view, reservationsEnabled, refreshReservations]);

  // ── Login flow ───────────────────────────────────────────────────────────────
  function selectStaff(w: Omit<WaiterStaff, "pin">) {
    setLoginTarget(w);
    setPin("");
    setPinError(false);
    setLoginStep("pin");
  }

  useEffect(() => {
    if (pin.length === 6 && loginTarget) {
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

  const logout = useCallback(() => {
    // Tell the server to drop the cookie before we wipe the local mirror.
    // Fire-and-forget — even if the request fails (network blip), wiping the
    // client state still removes the visible session.
    fetch("/api/waiter/logout", { method: "POST" }).catch(() => {});
    sessionStorage.removeItem("waiter_session");
    setWaiter(null);
    setLoginStep("staff");
    setLoginTarget(null);
    setPin("");
    setCart([]);
    setActiveTable(null);
    setView("login");
  }, []);

  // Auto-logout after 15 minutes of inactivity. Tablets get passed around
  // during a shift — without this, a forgotten tab keeps the waiter PIN
  // valid for the full 30-day server cookie window.
  useIdleLogout({
    enabled:   Boolean(waiter),
    timeoutMs: 15 * 60 * 1000,
    onIdle:    logout,
  });

  // ── Table selection ──────────────────────────────────────────────────────────
  function selectTable(table: DiningTable) {
    setActiveTable(table);
    setCart([]);
    setKitchenNote("");
    setView("menu");
  }

  // A table is occupied if a waiter order is active on it OR a reservation is
  // checked in there — both mean a party is physically seated. This keeps the
  // grid honest when a guest is checked in from POS/admin (or our own Seat
  // action) before any order is placed, instead of waiting for the first order.
  function isOccupiedLabel(label: string): boolean {
    if (occupiedLabels.has(label)) return true;
    return reservationsEnabled && reservations.some((r) => r.tableLabel === label && r.status === "checked_in");
  }

  // Tile tap router: occupied → bill/add-items sheet (unchanged); free-but-booked
  // → seat sheet (choose reservation vs walk-in); plain free → straight to menu.
  function onTileClick(table: DiningTable) {
    if (isOccupiedLabel(table.label)) { setTableAction(table); return; }
    const info = reservationInfoFor(table.label);
    if (info?.next) { setSeatAction({ table, reservation: info.next }); return; }
    selectTable(table);
  }

  // Seat a reservation: flip it to checked_in (best-effort — never blocks
  // ordering), pre-fill covers from the party size, then enter the order flow.
  // The endpoint is idempotent, so a stale double-tap is harmless.
  function seatReservation(table: DiningTable, res: WaiterReservation) {
    setSeatAction(null);
    setSeating(true);
    setCovers(res.partySize > 0 ? res.partySize : 2);
    fetch(`/api/waiter/reservations/${res.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "checked_in" }),
    })
      .then(() => refreshReservations())
      .catch(() => { /* check-in is best-effort; ordering proceeds regardless */ })
      .finally(() => setSeating(false));
    selectTable(table);
  }

  // When a table is settled/cleared, close out any reservation seated there
  // today. Best-effort + idempotent: a missing or already checked-out booking is
  // a no-op and never blocks the bill.
  function checkoutReservationForLabel(label: string) {
    if (!reservationsEnabled) return;
    const res = reservations.find((r) => r.tableLabel === label && r.status === "checked_in");
    if (!res) return;
    fetch(`/api/waiter/reservations/${res.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "checked_out" }),
    })
      .then(() => refreshReservations())
      .catch(() => {});
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
    // Apply in_store per-unit offer (happy hour pricing etc.) at add time and
    // snapshot any cart-level offer (bogo / multibuy / qty_discount) so cart
    // math can apply it across qty. Same logic as the modal handleAdd above
    // and the POS counter — shared in_store channel.
    const offerUnitPrice = getOfferUnitPrice(item, "in_store");
    const basePrice = offerUnitPrice ?? item.price;
    const cartLevelOffer = (offerUnitPrice === null && isOfferActive(item, "in_store"))
      ? item.offer
      : undefined;
    addToCart({
      lineId: uuid(),
      menuItemId: item.id,
      name: item.name,
      unitPrice: basePrice,
      quantity: 1,
      offer: cartLevelOffer,
    });
  }

  // ── Send to kitchen ──────────────────────────────────────────────────────────
  // Money helper for waiter lines — uses the shared cartLineTotal helper on the
  // in_store channel so cart-level offers (bogo / multibuy / qty_discount) are
  // applied across qty. Per-unit offers are already baked into l.unitPrice.
  function lineMoney(l: WaiterCartItem): number {
    return cartLineTotal({ price: l.unitPrice, quantity: l.quantity, offer: l.offer }, "in_store");
  }

  async function sendToKitchen() {
    if (!activeTable || cart.length === 0 || sending) return;
    setSending(true);
    const total = cart.reduce((s, l) => s + lineMoney(l), 0);
    let res: Response;
    try {
      res = await fetch("/api/waiter/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableLabel: activeTable.label,
          tableId: activeTable.id,
          covers,
          staffName: waiter?.name,
          items: cart.map((l) => ({ menuItemId: l.menuItemId, name: l.name + (l.note ? ` [${l.note}]` : ""), qty: l.quantity, price: l.unitPrice })),
          total,
          kitchenNote: kitchenNote.trim() || undefined,
        }),
      });
    } catch (err) {
      console.error("sendToKitchen network error:", err);
      setSending(false);
      alert("Couldn't send the order to the kitchen. Check your network and try again.");
      return;
    }
    setSending(false);
    if (res.ok) {
      setReceipt({
        tableLabel: activeTable.label,
        waiterName: waiter?.name ?? "Staff",
        date: new Date().toISOString(),
        items: cart.map((l) => ({ name: l.name, qty: l.quantity, price: l.unitPrice })),
        total,
        paymentMethod: "pending",
        orderIds: [],
      });
      setView("success");
      refreshOccupied();
      return;
    }
    // Surface the server's actual reason — insufficient stock, item removed,
    // online-only, manual OOS, permission denied — instead of silently
    // failing. 4xx is expected user-input flow so log as warn; 5xx is a real
    // backend problem worth flagging as an error.
    const json = await res.json().catch(() => ({})) as { error?: string };
    const log = res.status >= 500 ? console.error : console.warn;
    log("sendToKitchen failed:", res.status, json.error ?? "(no details)");
    alert(json.error ?? "Couldn't send the order to the kitchen. Check your network and try again.");
  }

  // ── Bill ─────────────────────────────────────────────────────────────────────
  // Clear bill-level tender extras (gift card, discount, tip) so a freshly
  // opened or settled bill never inherits a previous table's values.
  function resetBillExtras() {
    setBillGiftCard(null);
    setGcInput("");
    setGcError("");
    setBillDiscountPct(0);
    setBillDiscountNote("");
    setBillTip(0);
    setDiscountInput("");
    setTipInput("");
    setShowBillDiscount(false);
    setShowBillTip(false);
  }

  async function openBill(table: DiningTable) {
    setTableAction(null);
    setActiveTable(table);
    setBillLoading(true);
    setView("bill");
    resetBillExtras();

    try {
      const r = await fetch("/api/waiter/orders", { cache: "no-store" });
      if (!r.ok) { setBillOrders([]); return; }
      type BillLineItem = { name: string; qty: number; price: number };
      const json = await r.json() as {
        ok: boolean;
        orders?: Array<{ id: string; items?: BillLineItem[]; total?: number; note?: string | null; status?: string }>;
      };
      if (!json.ok || !json.orders) { setBillOrders([]); return; }

      const match = `[WAITER]`;
      const tableTag = `Table ${table.label}`;
      const filtered = json.orders.filter(
        (o) =>
          o.status !== "delivered" &&
          o.status !== "cancelled" &&
          String(o.note ?? "").startsWith(match) &&
          String(o.note ?? "").includes(tableTag),
      );

      setBillOrders(
        filtered.map((o) => ({
          id:    o.id,
          items: (o.items ?? []) as BillLineItem[],
          total: Number(o.total ?? 0),
          note:  String(o.note ?? ""),
        }))
      );
    } finally {
      setBillLoading(false);
    }
  }

  async function applyBillGiftCard(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setGcError("");
    setGcLooking(true);
    try {
      const res = await fetch("/api/gift-cards/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; card?: { code: string; balance: number } };
      if (!res.ok || !json.ok || !json.card) { setGcError(json.error ?? "Could not apply that gift card."); return; }
      setBillGiftCard({ code: json.card.code, balance: json.card.balance });
      setGcInput("");
    } catch {
      setGcError("Connection error.");
    } finally {
      setGcLooking(false);
    }
  }

  async function payBill(method: "cash" | "card") {
    if (!activeTable || billOrders.length === 0 || paying) return;
    setPaying(true);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const subtotal = round2(billOrders.reduce((s, o) => s + o.total, 0));
    const discountAmount = round2(subtotal * (billDiscountPct / 100));
    const afterDiscount = round2(subtotal - discountAmount);
    const tax = computeTax(afterDiscount, appSettings);
    const vatAmount = tax.enabled ? round2(tax.vatAmount) : 0;
    const tipAmount = round2(billTip);
    const total = round2(afterDiscount + taxSurcharge(tax) + tipAmount);
    const gcAmount = billGiftCard ? round2(Math.min(billGiftCard.balance, total)) : 0;
    let res: Response;
    try {
      res = await fetch("/api/waiter/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: billOrders.map((o) => o.id),
          tableLabel: activeTable.label,
          paymentMethod: method,
          ...(discountAmount > 0 ? { discountAmount, discountNote: billDiscountNote.trim() || undefined } : {}),
          ...(vatAmount > 0 ? { vatAmount, vatInclusive: tax.inclusive } : {}),
          ...(tipAmount > 0 ? { tipAmount } : {}),
          ...(billGiftCard && gcAmount > 0 ? { giftCardCode: billGiftCard.code, giftCardUsed: gcAmount } : {}),
        }),
      });
    } catch (err) {
      console.error("payBill network error:", err);
      setPaying(false);
      alert("Couldn't settle the bill. Check your network and try again.");
      return;
    }
    setPaying(false);
    if (!res.ok) {
      // Surface the server's actual reason — gift card invalid/expired, no
      // permission, orders not found — instead of silently flipping the
      // table to settled in the UI when nothing was persisted. 4xx is
      // expected user-input flow (warn), 5xx is a real backend problem.
      const json = await res.json().catch(() => ({})) as { error?: string };
      const log = res.status >= 500 ? console.error : console.warn;
      log("payBill failed:", res.status, json.error ?? "(no details)");
      alert(json.error ?? "Couldn't settle the bill. Please try again.");
      return;
    }
    // Table is settled — close out any reservation that was seated here today.
    // Best-effort; the bill is already the source of truth.
    checkoutReservationForLabel(activeTable.label);
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
      tableLabel: activeTable.label,
      waiterName: waiter?.name ?? "Staff",
      date: new Date().toISOString(),
      items: Array.from(lineMap.values()),
      subtotal,
      discountAmount: discountAmount > 0 ? discountAmount : undefined,
      discountNote:   discountAmount > 0 ? (billDiscountNote.trim() || undefined) : undefined,
      vatAmount:      vatAmount > 0 ? vatAmount : undefined,
      vatInclusive:   vatAmount > 0 ? tax.inclusive : undefined,
      vatRate:        vatAmount > 0 ? appSettings.taxSettings?.rate : undefined,
      tipAmount:      tipAmount > 0 ? tipAmount : undefined,
      total,
      giftCardUsed: gcAmount > 0 ? gcAmount : undefined,
      paymentMethod: method,
      orderIds: billOrders.map((o) => o.id),
    });
    resetBillExtras();
    // Stay on bill view — ReceiptModal overlays and navigates away on close
  }

  // ── Computed ─────────────────────────────────────────────────────────────────
  // Per-tile reservation state (null when the system is off or the table has no
  // active booking today). Pure — recomputed each render; the 5 s / 30 s polls
  // keep "now" fresh enough for the due / overdue windows.
  function reservationInfoFor(label: string): TileReservation | null {
    if (!reservationsEnabled) return null;
    const forLabel = reservations.filter((r) => r.tableLabel === label);
    if (forLabel.length === 0) return null;

    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const seated = forLabel.find((r) => r.status === "checked_in") ?? null;
    // Upcoming = not yet seated; ignore stale bookings hours in the past.
    const upcoming = forLabel
      .filter((r) =>
        (r.status === "pending" || r.status === "confirmed") &&
        hhmmToMins(r.time) - nowMins > -STALE_MAX,
      )
      .sort((a, b) => hhmmToMins(a.time) - hhmmToMins(b.time));

    const next = upcoming[0] ?? null;
    let minutesUntil: number | null = null;
    let isDue = false;
    let isOverdue = false;
    if (next) {
      minutesUntil = hhmmToMins(next.time) - nowMins;
      isOverdue = minutesUntil <= -OVERDUE_GRACE;
      isDue = !isOverdue && minutesUntil <= DUE_LEAD;
    }
    if (!seated && !next) return null;
    return {
      seated, next, minutesUntil, isDue, isOverdue,
      count: upcoming.length + (seated ? 1 : 0),
      upcomingCount: upcoming.length,
    };
  }

  const cartTotal = cart.reduce((s, l) => s + lineMoney(l), 0);
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const sections = ["All", ...Array.from(new Set(tables.map((t) => t.section)))];
  const visibleTables = activeSection === "All"
    ? tables
    : tables.filter((t) => t.section === activeSection);
  // Waiter = in_store channel (same as POS). Hide items admin tagged online-
  // only. Legacy items without a channels value stay visible.
  const visibleItems = menuItems.filter((m) => {
    if (activeCatId && m.categoryId !== activeCatId) return false;
    const ch = m.channels;
    if (ch && ch.length > 0 && !ch.includes("in_store")) return false;
    return true;
  });

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
            {!staffLoaded ? (
              <p className="text-slate-500 text-center text-sm">Loading staff…</p>
            ) : allWaiters.length === 0 ? (
              <p className="text-slate-500 text-center text-sm">No staff configured. Ask an admin to add staff in the Admin → Staff panel.</p>
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
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-white font-bold truncate">{w.name}</p>
                    <p className="text-slate-400 text-xs capitalize truncate">{w.role}</p>
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
            <div className={`flex justify-center gap-3 ${pinError ? "animate-bounce" : ""}`}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-all ${i < pin.length
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
        <div className="min-h-screen bg-slate-950 flex flex-col h-full">
          {/* Header */}
          <header className="bg-slate-900 border-b border-slate-800 px-5 py-4 flex items-center justify-between gap-3 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center">
                <UtensilsCrossed size={17} className="text-white" />
              </div>
              <h1 className="text-white font-black text-[15px] sm:text-base">Table Selection</h1>
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
                className="flex whitespace-nowrap items-center gap-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-xl text-xs font-medium transition"
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
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition ${activeSection === s
                    ? "bg-orange-500 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Colour key — explains the tile states. Matches the POS / admin
              Table Status boards (amber = reserved, blue = occupied). */}
          {tables.length > 0 && (
            <div className="flex items-center gap-3 px-5 py-2 flex-shrink-0 border-b border-slate-800 overflow-x-auto text-[11px] text-slate-400">
              <span className="font-bold uppercase tracking-wide text-slate-500">Key</span>
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-600" /> Available
              </span>
              {reservationsEnabled && (
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Reserved
                </span>
              )}
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-400" /> Occupied
              </span>
              {reservationsEnabled && (
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> Due / turn soon
                </span>
              )}
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <Crown size={11} className="text-amber-400" /> VIP
              </span>
            </div>
          )}

          {/* Table grid */}
          <div className="flex-1 p-5 pb-15 overflow-y-auto h-full">
            {tables.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-600">
                <UtensilsCrossed size={40} className="mb-3 opacity-30" />
                <p className="text-sm">No tables configured</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {visibleTables.map((table) => {
                  const occupied = isOccupiedLabel(table.label);
                  const resInfo = reservationInfoFor(table.label);
                  // Two distinct signals, kept visually separate and aligned with
                  // the POS / admin boards: OCCUPIED = blue, RESERVED = amber.
                  const reservedFree = !occupied && !!resInfo?.next;
                  const dueFree = reservedFree && (resInfo!.isDue || resInfo!.isOverdue);

                  const tileCls = occupied
                    ? "bg-blue-950/40 border-blue-500/60 hover:bg-blue-950/60"
                    : dueFree
                      ? "bg-amber-950/40 border-amber-500/60 hover:bg-amber-950/60"
                      : reservedFree
                        ? "bg-slate-800 border-amber-500/30 hover:border-amber-400/60 hover:bg-slate-700"
                        : "bg-slate-800 border-slate-700 hover:border-orange-500/60 hover:bg-slate-700";

                  // Bottom status line pieces. An occupied table shows a calendar
                  // icon + "Next <time>" so the bare time reads clearly as the
                  // upcoming booking (rose if it lands within one sitting); a
                  // free-but-booked table reads Soon / Res / Due.
                  const seatedName  = occupied ? resInfo?.seated?.customerName?.split(" ")[0] : undefined;
                  const nextSoon    = !!resInfo?.next && resInfo.minutesUntil != null && resInfo.minutesUntil <= slotDuration;
                  const moreLabel   = resInfo && resInfo.upcomingCount > 1 ? ` +${resInfo.upcomingCount - 1}` : "";
                  const reservedTag = resInfo?.isOverdue ? "Due" : resInfo?.isDue ? "Soon" : "Res";

                  return (
                    <button
                      key={table.id}
                      onClick={() => onTileClick(table)}
                      className={`relative flex flex-col items-center justify-center rounded-2xl p-4 aspect-square border-2 transition-all active:scale-95 ${tileCls}`}
                    >
                      {table.isVip && (
                        <span className="absolute top-2 left-2" title="VIP table">
                          <Crown size={13} className="text-amber-400" />
                        </span>
                      )}
                      {occupied && (
                        <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                      )}
                      {reservedFree && (
                        <span className="absolute top-2 right-2" title={`Reserved ${resInfo!.next!.time} · ${resInfo!.next!.partySize} guests`}>
                          <CalendarClock size={12} className={resInfo!.isOverdue ? "text-rose-400" : "text-amber-400"} />
                        </span>
                      )}
                      <span className={`text-2xl font-black ${occupied ? "text-blue-100" : reservedFree ? "text-amber-100" : "text-white"}`}>
                        {table.label}
                      </span>
                      <span className={`text-xs mt-1 ${occupied ? "text-blue-300/70" : reservedFree ? "text-amber-300/70" : "text-slate-500"}`}>
                        <Users size={10} className="inline mr-0.5" />{table.seats}
                      </span>
                      {occupied ? (
                        resInfo?.next ? (
                          <span className={`mt-0.5 flex items-center gap-0.5 text-[10px] font-semibold max-w-full px-1 ${nextSoon ? "text-rose-400" : "text-amber-400"}`}>
                            <CalendarClock size={9} className="flex-shrink-0" />
                            <span className="truncate">Next {resInfo.next.time}{moreLabel}</span>
                          </span>
                        ) : (
                          <span className="mt-0.5 text-[10px] font-semibold text-blue-400 truncate max-w-full px-1">
                            {seatedName || "Occupied"}
                          </span>
                        )
                      ) : resInfo?.next ? (
                        <span className={`mt-0.5 text-[10px] font-semibold truncate max-w-full px-1 ${resInfo.isOverdue ? "text-rose-400" : resInfo.isDue ? "text-amber-300" : "text-amber-400/70"}`}>
                          {reservedTag} {resInfo.next.time}{moreLabel}
                        </span>
                      ) : (
                        <span className="mt-0.5 text-[10px] font-semibold invisible">Available</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Occupied-table action sheet ─────────────────────────────────── */}
          {tableAction && (() => {
            const seatedRes = reservationsEnabled
              ? reservations.find((r) => r.tableLabel === tableAction.label && r.status === "checked_in") ?? null
              : null;
            // The next not-yet-seated booking for this table today (if any), so
            // the floor knows the table is booked again later — at any distance.
            const nextRes = reservationsEnabled ? (reservationInfoFor(tableAction.label)?.next ?? null) : null;
            return (
            <div className="fixed inset-0 z-50 flex items-end justify-center">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTableAction(null)} />
              <div className="relative bg-slate-900 rounded-t-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                    <UtensilsCrossed size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-white font-black text-lg">Table {tableAction.label}</p>
                    <p className="text-blue-400 text-xs font-medium">{seatedRes ? "Seated guest" : "Currently occupied"}</p>
                  </div>
                </div>

                {/* Booking details — shown when this occupied table is a seated reservation */}
                {seatedRes && (
                  <div className="bg-slate-800 rounded-2xl px-4 py-3 space-y-1.5">
                    <p className="text-white text-sm font-medium">{seatedRes.customerName}</p>
                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                      <Clock size={12} className="text-amber-400" />
                      <span>{seatedRes.time}</span>
                      <span className="text-slate-600">·</span>
                      <Users size={12} />
                      <span>{seatedRes.partySize} guests</span>
                    </div>
                    {seatedRes.note && (
                      <p className="text-amber-400 text-xs flex items-center gap-1">
                        <StickyNote size={11} /> {seatedRes.note}
                      </p>
                    )}
                  </div>
                )}

                {/* Upcoming booking — this table is reserved again later today */}
                {nextRes && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 space-y-1">
                    <p className="text-amber-300 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5">
                      <CalendarClock size={12} /> Booked again today
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-300 text-sm">
                      <span className="flex items-center gap-1"><Clock size={13} className="text-amber-400" /> <span className="font-semibold">{nextRes.time}</span></span>
                      <span className="text-slate-600">·</span>
                      <span className="flex items-center gap-1"><Users size={12} className="text-slate-400" /> {nextRes.partySize}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{nextRes.customerName}</span>
                    </div>
                  </div>
                )}

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
            );
          })()}
          {/* ── Reserved-table seat sheet ───────────────────────────────────── */}
          {seatAction && (
            <div className="fixed inset-0 z-50 flex items-end justify-center">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSeatAction(null)} />
              <div className="relative bg-slate-900 rounded-t-3xl w-full max-w-md p-6 shadow-2xl space-y-4">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
                    <CalendarClock size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-white font-black text-lg">Table {seatAction.table.label}</p>
                    <p className="text-amber-400 text-xs font-medium">Reserved</p>
                  </div>
                </div>

                {/* Booking details */}
                <div className="bg-slate-800 rounded-2xl px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-white">
                    <Clock size={14} className="text-amber-400" />
                    <span className="font-bold">{seatAction.reservation.time}</span>
                    <span className="text-slate-600">·</span>
                    <Users size={13} className="text-slate-400" />
                    <span className="text-slate-300 text-sm">{seatAction.reservation.partySize} guests</span>
                  </div>
                  <p className="text-slate-300 text-sm font-medium">{seatAction.reservation.customerName}</p>
                  {seatAction.reservation.note && (
                    <p className="text-amber-400 text-xs flex items-center gap-1">
                      <StickyNote size={11} /> {seatAction.reservation.note}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => seatReservation(seatAction.table, seatAction.reservation)}
                  disabled={seating}
                  className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] rounded-2xl px-5 py-4 transition-all disabled:opacity-50"
                >
                  <div className="w-10 h-10 bg-amber-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={18} className="text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-bold">Seat this reservation</p>
                    <p className="text-slate-400 text-xs">Check in &amp; start the order</p>
                  </div>
                </button>

                <button
                  onClick={() => { const t = seatAction.table; setSeatAction(null); selectTable(t); }}
                  className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] rounded-2xl px-5 py-4 transition-all"
                >
                  <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Utensils size={18} className="text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-bold">Seat a walk-in instead</p>
                    <p className="text-slate-400 text-xs">Use this table without the booking</p>
                  </div>
                </button>

                <button
                  onClick={() => setSeatAction(null)}
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
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const billSubtotal = round2(billOrders.reduce((s, o) => s + o.total, 0));
    const billDiscountAmount = round2(billSubtotal * (billDiscountPct / 100));
    const afterDiscount = round2(billSubtotal - billDiscountAmount);
    // VAT synced from the admin Tax & VAT setting — same rate/mode as online + POS.
    const billTax = computeTax(afterDiscount, appSettings);
    const billTotal = round2(afterDiscount + taxSurcharge(billTax) + billTip);
    const giftCardApplied = billGiftCard ? round2(Math.min(billGiftCard.balance, billTotal)) : 0;
    const dueAfterGiftCard = Math.max(0, round2(billTotal - giftCardApplied));
    const canDiscount = waiter?.role === "senior";

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
        tableLabel: activeTable!.label,
        waiterName: waiter?.name ?? "Staff",
        date: new Date().toISOString(),
        items: consolidatedLines,
        subtotal: billSubtotal,
        discountAmount: billDiscountAmount > 0 ? billDiscountAmount : undefined,
        discountNote:   billDiscountAmount > 0 ? (billDiscountNote.trim() || undefined) : undefined,
        vatAmount:      billTax.enabled && billTax.vatAmount > 0 ? billTax.vatAmount : undefined,
        vatInclusive:   billTax.enabled && billTax.vatAmount > 0 ? billTax.inclusive : undefined,
        vatRate:        billTax.enabled && billTax.vatAmount > 0 ? appSettings.taxSettings?.rate : undefined,
        tipAmount:      billTip > 0 ? billTip : undefined,
        total: billTotal,
        paymentMethod: "pending",
        orderIds: billOrders.map(o => o.id),
      };
      const restaurantName = rs?.restaurantName?.trim() || appSettings?.restaurant?.name || "Restaurant";
      const html = buildReceiptHtml(tempReceipt, restaurantName, rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!", sym);
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
        <div className="h-full bg-slate-950 flex flex-col ">
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

          <div className="overflow-y-auto">

            {/* Bill content */}
            <div className="flex-1 p-5 space-y-4">
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
                            {fmtCur(line.price * line.qty, sym)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Totals breakdown */}
                    <div className="px-5 py-4 border-t border-slate-700 bg-slate-800/50 space-y-1.5">
                      {(billDiscountAmount > 0 || billTip > 0 || (billTax.enabled && billTax.vatAmount > 0)) && (
                        <>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-400">Subtotal</span>
                            <span className="text-slate-300">{fmtCur(billSubtotal, sym)}</span>
                          </div>
                          {billDiscountAmount > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-emerald-400">Discount{billDiscountNote ? ` (${billDiscountNote})` : ` (${billDiscountPct}%)`}</span>
                              <span className="text-emerald-400">−{fmtCur(billDiscountAmount, sym)}</span>
                            </div>
                          )}
                          {billTax.enabled && billTax.vatAmount > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-400">{billTax.inclusive ? `Incl. VAT (${appSettings.taxSettings?.rate}%)` : `VAT (${appSettings.taxSettings?.rate}%)`}</span>
                              <span className="text-slate-300">{billTax.inclusive ? "" : "+"}{fmtCur(billTax.vatAmount, sym)}</span>
                            </div>
                          )}
                          {billTip > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-400">Tip</span>
                              <span className="text-slate-300">{fmtCur(billTip, sym)}</span>
                            </div>
                          )}
                        </>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-slate-300 text-sm font-semibold">Total</span>
                        <span className="text-white text-lg sm:text-xl md:text-2xl font-black">{fmtCur(billTotal, sym)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Discount + Tip controls */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { if (!canDiscount) return; setDiscountInput(billDiscountPct ? String(billDiscountPct) : ""); setShowBillDiscount(true); }}
                      disabled={!canDiscount}
                      title={canDiscount ? "Apply a bill discount" : "Senior / head waiter only"}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition ${
                        billDiscountAmount > 0
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                          : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <Percent size={14} />
                      {billDiscountAmount > 0 ? `Discount ${billDiscountPct}%` : "Discount"}
                    </button>
                    <button
                      onClick={() => { setTipInput(billTip ? String(billTip) : ""); setShowBillTip(true); }}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition ${
                        billTip > 0
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                          : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      <BadgeDollarSign size={14} />
                      {billTip > 0 ? `Tip ${fmtCur(billTip, sym)}` : "Tip"}
                    </button>
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
                {settleConfirm ? (
                  // Inline confirm — settling is final (orders flip to delivered),
                  // so we require an explicit second click before posting.
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5">
                      <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-amber-300 text-xs">
                        Settle {activeTable?.label ? `Table ${activeTable.label}` : "this bill"} as {settleConfirm === "cash" ? "Cash" : "Card"}? This marks all orders as delivered and cannot be undone.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setSettleConfirm(null)}
                        disabled={paying}
                        className="py-3 rounded-2xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 disabled:opacity-50 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { const m = settleConfirm; setSettleConfirm(null); payBill(m); }}
                        disabled={paying}
                        className={`flex items-center text-sm sm:text-base justify-center gap-2 px-2 py-3 rounded-2xl text-white font-bold transition disabled:opacity-50 ${settleConfirm === "cash" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-blue-600 hover:bg-blue-500"}`}
                      >
                        {paying
                          ? <Loader2 size={18} className="animate-spin" />
                          : settleConfirm === "cash" ? <Banknote size={18} className="hidden sm:block"/> : <CreditCard size={18} className="hidden sm:block" />}
                        Confirm Settle
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Gift card tender */}
                    {billGiftCard ? (
                      <div className="flex items-center justify-between gap-2 bg-purple-500/10 border border-purple-500/40 rounded-xl px-3 py-2.5 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Gift size={15} className="text-purple-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-purple-200 text-xs font-bold font-mono tracking-wider truncate">{billGiftCard.code}</p>
                            <p className="text-purple-400 text-[11px]">
                              −{fmtCur(giftCardApplied, sym)} · {fmtCur(dueAfterGiftCard, sym)} due
                            </p>
                          </div>
                        </div>
                        <button onClick={() => setBillGiftCard(null)} className="text-slate-400 hover:text-white text-xs flex-shrink-0">Remove</button>
                      </div>
                    ) : (
                      <div className="mb-3 space-y-1.5">
                        <div className="flex gap-2">
                          <input
                            value={gcInput}
                            onChange={(e) => { setGcInput(e.target.value.toUpperCase()); setGcError(""); }}
                            onKeyDown={(e) => e.key === "Enter" && applyBillGiftCard(gcInput)}
                            placeholder="Gift card code"
                            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm font-mono tracking-wider outline-none focus:border-purple-500 placeholder-slate-600"
                          />
                          <button
                            onClick={() => applyBillGiftCard(gcInput)}
                            disabled={!gcInput.trim() || gcLooking}
                            className="flex items-center gap-1.5 bg-purple-500/80 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold px-3 rounded-xl transition-colors"
                          >
                            {gcLooking ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
                          </button>
                        </div>
                        {gcError && <p className="text-red-400 text-xs px-1">{gcError}</p>}
                      </div>
                    )}

                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest text-center mb-2">
                      {dueAfterGiftCard <= 0 && billGiftCard ? "Fully covered by gift card" : "Select Payment Method"}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setSettleConfirm("cash")}
                        disabled={paying}
                        className="flex flex-col items-center gap-1 md:gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 active:scale-[0.97] text-white font-bold py-2 md:py-5 rounded-2xl transition-all"
                      >
                        {paying ? <Loader2 size={22} className="animate-spin" /> : <Banknote size={22} />}
                        <span className="text-sm">Pay by Cash</span>
                      </button>
                      <button
                        onClick={() => setSettleConfirm("card")}
                        disabled={paying}
                        className="flex flex-col items-center gap-1 md:gap-2  bg-blue-600 hover:bg-blue-500 disabled:opacity-50 active:scale-[0.97] text-white font-bold py-2 md:py-5 rounded-2xl transition-all"
                      >
                        {paying ? <Loader2 size={22} className="animate-spin" /> : <CreditCard size={22} />}
                        <span className="text-sm">Pay by Card</span>
                      </button>
                    </div>
                    <button
                      onClick={() => { setView("tables"); setActiveTable(null); setBillOrders([]); }}
                      className="w-full pt-3 text-slate-500 hover:text-slate-300 text-sm font-medium transition"
                    >
                      Back to Tables
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Print / Email bill (before payment) */}
            {!billLoading && billOrders.length > 0 && !paying && (
              <BillEmailBar
                onPrint={printBillPreview}
                tableLabel={activeTable!.label}
                waiterName={waiter?.name ?? "Staff"}
                consolidatedLines={consolidatedLines}
                billSubtotal={billSubtotal}
                billDiscountAmount={billDiscountAmount}
                billDiscountNote={billDiscountNote}
                billVatAmount={billTax.enabled ? billTax.vatAmount : 0}
                billVatInclusive={billTax.inclusive}
                billVatRate={appSettings.taxSettings?.rate}
                billTip={billTip}
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


        </div>

        {/* Discount modal — senior/head waiter only, capped at 100% */}
        {showBillDiscount && canDiscount && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-white font-bold">Apply Discount</h3>
                <button onClick={() => setShowBillDiscount(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
              </div>
              <p className="text-slate-400 text-xs mb-2">Discount percentage</p>
              <div className="flex gap-1.5 mb-4">
                {[5, 10, 15, 20, 50].map((v) => (
                  <button key={v} onClick={() => setDiscountInput(String(v))}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${discountInput === String(v) ? "bg-orange-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                    {v}%
                  </button>
                ))}
              </div>
              <input type="number" min={0} max={100} value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder="Custom %"
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-lg font-bold outline-none focus:border-orange-500 mb-3" />
              <input type="text" value={billDiscountNote} onChange={(e) => setBillDiscountNote(e.target.value)}
                placeholder="Reason (e.g. service recovery)"
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 mb-5" />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setBillDiscountPct(0); setBillDiscountNote(""); setDiscountInput(""); setShowBillDiscount(false); }}
                  className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition">Clear</button>
                <button onClick={() => {
                  const raw = parseFloat(discountInput) || 0;
                  setBillDiscountPct(Math.max(0, Math.min(100, raw)));
                  setShowBillDiscount(false);
                }}
                  className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition">Apply</button>
              </div>
            </div>
          </div>
        )}

        {/* Tip modal — preset % of subtotal + custom amount */}
        {showBillTip && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-white font-bold">Add Tip</h3>
                <button onClick={() => setShowBillTip(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
              </div>
              <p className="text-slate-400 text-xs mb-2">Tip ({fmtCur(billSubtotal, sym)} subtotal)</p>
              <div className="flex gap-1.5 mb-4">
                {[10, 12.5, 15].map((v) => (
                  <button key={v} onClick={() => setTipInput((Math.round(billSubtotal * (v / 100) * 100) / 100).toFixed(2))}
                    className="flex-1 py-2 rounded-lg text-xs font-bold bg-slate-700 text-slate-300 hover:bg-slate-600 transition">
                    {v}%
                  </button>
                ))}
              </div>
              <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 mb-5 flex items-center gap-2">
                <span className="text-slate-500 text-lg font-bold">{sym}</span>
                <input type="number" step="0.01" min={0} value={tipInput}
                  onChange={(e) => setTipInput(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 min-w-0 bg-transparent text-white text-lg font-bold outline-none placeholder-slate-600" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setBillTip(0); setTipInput(""); setShowBillTip(false); }}
                  className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition">Clear</button>
                <button onClick={() => { setBillTip(Math.max(0, Math.round((parseFloat(tipInput) || 0) * 100) / 100)); setShowBillTip(false); }}
                  className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm transition">Apply</button>
              </div>
            </div>
          </div>
        )}

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
    <div className="h-full bg-slate-950 flex flex-col overflow-hidden">
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
          className="md:hidden relative flex items-center gap-1.5 bg-orange-500 text-white px-3 py-2 rounded-xl text-sm font-bold"
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
          className="hidden md:flex items-center gap-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white font-bold px-4 py-2.5 rounded-xl transition-all text-sm"
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
                className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition ${activeCatId === cat.id
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
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3">
              {visibleItems.map((item) => {
                const stockState = resolveStock(item);
                const oos = stockState === "out_of_stock";
                const lowStock = stockState === "low_stock";
                const hasVar = (item.variations?.length ?? 0) > 0 || (item.addOns?.length ?? 0) > 0;
                // Offer math (shared in_store channel — same as POS counter)
                const offerLabel  = offerBadgeLabel(item, "in_store");
                const offerPrice  = getOfferUnitPrice(item, "in_store"); // null = cart-level (bogo/multibuy/qty) or no offer
                const showStrike  = offerPrice !== null && offerPrice < item.price;
                return (
                  <button
                    key={item.id}
                    onClick={() => quickAdd(item)}
                    disabled={oos}
                    className={`relative flex flex-col rounded-2xl border text-left transition-all active:scale-[0.97] overflow-hidden ${oos
                      ? "bg-slate-800/40 border-slate-800 opacity-50 cursor-not-allowed"
                      : "bg-slate-800 border-slate-700 hover:border-orange-500/50 hover:bg-slate-750"
                      }`}
                  >
                    {/* Top image/placeholder */}
                    <div className="relative w-full aspect-[5/3.5] max-h-[95px] bg-slate-800 flex items-center justify-start flex-shrink-0 px-4 pt-4">
                      {item.popular && !oos && (
                        <span className="absolute top-2 left-2 z-10 bg-orange-500 text-white text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-wide">
                          POPULAR
                        </span>
                      )}
                      {offerLabel && !oos && (
                        <span className={`absolute ${item.popular ? "top-9" : "top-2"} left-2 z-10 bg-emerald-500 text-white text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-wide shadow-sm`}>
                          {offerLabel}
                        </span>
                      )}
                      {lowStock && !oos && (
                        <span className="absolute top-2 right-2 z-10 bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide">
                          {typeof item.stockQty === "number" ? `${item.stockQty} left` : "Low"}
                        </span>
                      )}

                      {item.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={item.image} alt={item.name} className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div className="w-20 h-20 rounded-2xl flex items-center justify-center bg-[#fcdcae] text-[40px]">
                          🍽️
                        </div>
                      )}
                    </div>

                    <div className="p-3 sm:p-4 flex flex-col flex-1 w-full">
                      <p className="text-white font-semibold text-sm leading-snug line-clamp-2">
                        {item.name}
                      </p>
                      {item.description && (
                        <p className="text-slate-500 text-[11px] mt-0.5 line-clamp-1">{item.description}</p>
                      )}
                      <div className="mt-2 flex-1 flex flex-wrap gap-0.5 items-end justify-between">
                        {showStrike ? (
                          <span className="flex items-baseline gap-1.5">
                            <span className="text-emerald-400 font-black text-base">{fmtCur(offerPrice!, sym)}</span>
                            <span className="text-slate-500 text-xs line-through">{fmtCur(item.price, sym)}</span>
                          </span>
                        ) : (
                          <span className="text-orange-400 font-black text-base">{fmtCur(item.price, sym)}</span>
                        )}
                        {hasVar ? (
                          <span className="ml-auto text-slate-500 text-[10px] font-semibold">options</span>
                        ) : oos ? (
                          <span className="text-red-400 text-[10px] font-semibold">Out of stock</span>
                        ) : (
                          <span className="ml-auto text-slate-500 hover:text-white transition">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m9 18 6-6-6-6"/>
                            </svg>
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Right: Cart (desktop) ────────────────────────────────────────── */}
        <div className="hidden md:flex w-80 xl:w-96 flex-col border-l border-slate-800 bg-slate-900">
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
                    <p className="text-orange-400 text-sm font-bold mt-1">{fmtCur(line.unitPrice, sym)}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => updateQty(line.lineId, -1)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
                      <Minus size={11} />
                    </button>
                    <span className="text-white text-[13px] font-bold w-6 text-center">{line.quantity}</span>
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
              <span className="text-white font-black text-xl">{fmtCur(cartTotal, sym)}</span>
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
        <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end">
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
                    <p className="text-orange-400 text-sm font-bold mt-1">{fmtCur(line.unitPrice, sym)}</p>
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
                <span className="text-white font-black text-xl">{fmtCur(cartTotal, sym)}</span>
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

