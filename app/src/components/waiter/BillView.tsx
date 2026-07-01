"use client";

/**
 * Bill view for one occupied table: consolidates that table's active orders,
 * applies discount / tip / service-fee / gift card, prints or emails the pending bill, and
 * settles by cash or card (with an explicit confirm step — settling flips the
 * orders to "delivered" and can't be undone). Senior staff can void from here.
 *
 * Owns the whole bill lifecycle and fetches the table's orders on mount; the
 * view mounts fresh per table visit so nothing leaks between bills. The page
 * supplies the shared receipt state (the receipt outlives this view) and is
 * told when to navigate away via onExit.
 */

import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import {
  ArrowLeft, Receipt, Loader2, ClipboardList, Percent, BadgeDollarSign,
  AlertTriangle, Banknote, CreditCard, Gift, X,
  DollarSign,
} from "lucide-react";
import CollectionFooter from "@/components/collection/CollectionFooter";
import { computeTax, taxSurcharge } from "@/lib/taxUtils";
import { parseTableLabelFromNote } from "@/lib/tableLabel";
import type { WaiterStaff, DiningTable } from "@/types";
import type { BillOrder, WaiterReceipt } from "./_types";
import { fmtCur } from "./_utils";
import { buildReceiptHtml } from "./_receiptHtml";
import ReceiptModal from "./ReceiptModal";
import BillEmailBar from "./BillEmailBar";
import VoidRefundModal from "./VoidRefundModal";

export default function BillView({ table, waiter, receipt, setReceipt, onCheckoutReservation, onExit }: {
  table: DiningTable;
  waiter: Omit<WaiterStaff, "pin"> | null;
  /** Shared last-receipt state — set after settle, survives leaving this view. */
  receipt: WaiterReceipt | null;
  setReceipt: (r: WaiterReceipt | null) => void;
  /** Close out the reservation seated at this table once the bill settles. */
  onCheckoutReservation: (label: string) => void;
  /** Leave the bill view; refresh=true re-polls occupancy (after settle/void). */
  onExit: (refresh: boolean) => void;
}) {
  const { settings: appSettings } = useApp();
  const sym = appSettings.currency?.symbol ?? "£";

  const [billOrders, setBillOrders] = useState<BillOrder[]>([]);
  const [billLoading, setBillLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  // Pending settle confirmation (the chosen method) — null means no prompt visible.
  const [settleConfirm, setSettleConfirm] = useState<"cash" | "card" | "gift_card" | null>(null);
  // Gift card applied to the bill (bearer code). Reduces the amount due; the
  // remainder is settled by cash/card as normal.
  const [billGiftCard, setBillGiftCard] = useState<{ code: string; balance: number } | null>(null);
  const [gcInput, setGcInput] = useState("");
  const [gcError, setGcError] = useState("");
  const [gcLooking, setGcLooking] = useState(false);
  // Bill-level manual discount (percentage, like POS) + table-service tip + table-service fee.
  // Discount is senior/head-waiter only; both flow into the settle total and
  // the receipt.
  const [billDiscountPct, setBillDiscountPct] = useState(0);
  const [billDiscountNote, setBillDiscountNote] = useState("");
  const [billTip, setBillTip] = useState(0);
  const [billServicePct, setBillServicePct] = useState(0);
  const [showBillDiscount, setShowBillDiscount] = useState(false);
  const [showBillTip, setShowBillTip] = useState(false);
  const [showBillServiceFee, setShowBillServiceFee] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [tipInput, setTipInput] = useState("");
  const [serviceFeeInput, setServiceFeeInput] = useState("");
  const [voidRefundTarget, setVoidRefundTarget] = useState<{
    mode: "void" | "refund";
    orderIds: string[];
    total: number;
    tableLabel: string;
  } | null>(null);

  // Clear bill-level tender extras (gift card, discount, tip, service-fee) so a settled
  // bill never carries values into the receipt-overlay state.
  function resetBillExtras() {
    setBillGiftCard(null);
    setGcInput("");
    setGcError("");
    setBillDiscountPct(0);
    setBillDiscountNote("");
    setBillTip(0);
    setBillServicePct(0);
    setDiscountInput("");
    setTipInput("");
    setServiceFeeInput("");
    setShowBillDiscount(false);
    setShowBillTip(false);
    setShowBillServiceFee(false);
  }

  // Load this table's active orders once on mount (the view remounts per
  // table visit, so this is the same lifecycle the old page-level openBill had).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/waiter/orders", { cache: "no-store" });
        if (!r.ok) { setBillOrders([]); return; }
        type BillLineItem = { name: string; qty: number; price: number };
        const json = await r.json() as {
          ok: boolean;
          orders?: Array<{ id: string; items?: BillLineItem[]; total?: number; note?: string | null; status?: string; table_label?: string | null }>;
        };
        if (!json.ok || !json.orders) { setBillOrders([]); return; }

        // EXACT table-label match, like the occupancy scan. The old
        // `note.includes("Table " + label)` substring test let "Table 1" swallow
        // "Table 11"'s orders into the wrong bill — and settle them with it.
        const filtered = json.orders.filter((o) => {
          if (o.status === "delivered" || o.status === "cancelled") return false;
          const label = o.table_label?.trim() || parseTableLabelFromNote(String(o.note ?? ""));
          return label === table.label;
        });

        setBillOrders(
          filtered.map((o) => ({
            id: o.id,
            items: (o.items ?? []) as BillLineItem[],
            total: Number(o.total ?? 0),
            note: String(o.note ?? ""),
          }))
        );
      } finally {
        setBillLoading(false);
      }
    })();
  }, [table.label]);

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

  async function payBill(method: "cash" | "card" | "gift_card") {
    if (billOrders.length === 0 || paying) return;
    setPaying(true);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const subtotal = round2(billOrders.reduce((s, o) => s + o.total, 0));
    const discountAmount = round2(subtotal * (billDiscountPct / 100));
    const afterDiscount = round2(subtotal - discountAmount);
    const serviceFeeAmount = round2(afterDiscount * (billServicePct / 100));
    const taxBase = afterDiscount + serviceFeeAmount; 
    const tax = computeTax(subtotal, taxBase, appSettings);
    const vatAmount = tax.enabled ? round2(tax.vatAmount) : 0;
    const tipAmount = round2(billTip);
    const total = round2(taxBase + taxSurcharge(tax) + tipAmount);
    const gcAmount = billGiftCard ? round2(Math.min(billGiftCard.balance, total)) : 0;
    let res: Response;
    try {
      res = await fetch("/api/waiter/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: billOrders.map((o) => o.id),
          tableLabel: table.label,
          paymentMethod: method,
          ...(discountAmount > 0 ? { discountAmount, discountNote: billDiscountNote.trim() || undefined } : {}),
          ...(vatAmount > 0 ? { vatAmount, vatInclusive: tax.inclusive } : {}),
          ...(tipAmount > 0 ? { tipAmount } : {}),
          ...(serviceFeeAmount > 0 ? { serviceFeeAmount } : {}),
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
    onCheckoutReservation(table.label);
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
      tableLabel: table.label,
      waiterName: waiter?.name ?? "Staff",
      date: new Date().toISOString(),
      items: Array.from(lineMap.values()),
      subtotal,
      discountAmount: discountAmount > 0 ? discountAmount : undefined,
      discountNote: discountAmount > 0 ? (billDiscountNote.trim() || undefined) : undefined,
      vatAmount: vatAmount > 0 ? vatAmount : undefined,
      vatInclusive: vatAmount > 0 ? tax.inclusive : undefined,
      vatRate: vatAmount > 0 ? appSettings.taxSettings?.rate : undefined,
      tipAmount: tipAmount > 0 ? tipAmount : undefined,
      serviceFeeAmount: serviceFeeAmount > 0 ? serviceFeeAmount : undefined,
      // Store NET money paid (gift card already deducted); the receipt re-adds
      // gift_card_used to show the gross goods line. Avoids double-counting.
      total: Math.max(0, round2(total - gcAmount)),
      giftCardUsed: gcAmount > 0 ? gcAmount : undefined,
      paymentMethod: method,
      orderIds: billOrders.map((o) => o.id),
    });
    resetBillExtras();
    // Stay on bill view — ReceiptModal overlays and navigates away on close
  }

  // ── Computed ─────────────────────────────────────────────────────────────────
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const billSubtotal = round2(billOrders.reduce((s, o) => s + o.total, 0));
  const billDiscountAmount = round2(billSubtotal * (billDiscountPct / 100));
  const afterDiscount = round2(billSubtotal - billDiscountAmount);
  const billServiceFee = round2(afterDiscount * (billServicePct / 100));
  const taxBase = afterDiscount + billServiceFee; 
  // VAT synced from the admin Tax & VAT setting — same rate/mode as online + POS.
  const billTax = computeTax(billSubtotal, taxBase, appSettings);
  const billAfterTax = round2(taxBase + taxSurcharge(billTax));
  const billTotal = round2(billAfterTax + billTip);
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
      tableLabel: table.label,
      waiterName: waiter?.name ?? "Staff",
      date: new Date().toISOString(),
      items: consolidatedLines,
      subtotal: billSubtotal,
      discountAmount: billDiscountAmount > 0 ? billDiscountAmount : undefined,
      discountNote: billDiscountAmount > 0 ? (billDiscountNote.trim() || undefined) : undefined,
      vatAmount: billTax.enabled && billTax.vatAmount > 0 ? billTax.vatAmount : undefined,
      vatInclusive: billTax.enabled && billTax.vatAmount > 0 ? billTax.inclusive : undefined,
      vatRate: billTax.enabled && billTax.vatAmount > 0 ? appSettings.taxSettings?.rate : undefined,
      tipAmount: billTip > 0 ? billTip : undefined,
      serviceFeeAmount: billServiceFee > 0 ? billServiceFee : undefined,
      giftCardUsed: giftCardApplied > 0 ? giftCardApplied : undefined,
      // NET money paid; the receipt re-adds gift_card_used for the gross line.
      total: dueAfterGiftCard,
      paymentMethod: "pending",
      orderIds: billOrders.map(o => o.id),
    };
    const restaurantName = rs?.restaurantName?.trim() || appSettings?.restaurant?.name || "Restaurant";
    const html = buildReceiptHtml(tempReceipt, restaurantName, rs?.address ?? "", rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!", sym);
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
            onClick={() => onExit(false)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex-shrink-0"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-base">Bill — Table {table.label}</p>
            <p className="text-slate-400 text-xs">{billOrders.length} order{billOrders.length !== 1 ? "s" : ""} · {consolidatedLines.length} item type{consolidatedLines.length !== 1 ? "s" : ""}</p>
          </div>
          <Receipt size={20} className="text-emerald-400 flex-shrink-0" />
        </header>

        <div className="overflow-y-auto flex-1">

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
                    {(billDiscountAmount > 0 || billTip > 0 || billServiceFee > 0 || (billTax.enabled && billTax.vatAmount > 0)) && (
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
                        {billServiceFee > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-400">Service Fee ({billServicePct}%)</span>
                            <span className="text-slate-300">{fmtCur(billServiceFee, sym)}</span>
                          </div>
                        )}
                        {billTax.enabled && billTax.vatAmount > 0 && appSettings.taxSettings?.showBreakdown && (
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
                      <span className={`text-lg sm:text-xl md:text-2xl font-black ${giftCardApplied > 0 ? "text-slate-400" : "text-white"}`}>{fmtCur(billTotal, sym)}</span>
                    </div>
                    {giftCardApplied > 0 && (
                      <>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-purple-300 flex items-center gap-1"><Gift size={13} className="flex-shrink-0" /> Gift Card</span>
                          <span className="text-purple-300">−{fmtCur(giftCardApplied, sym)}</span>
                        </div>
                        <div className="flex items-center justify-between pt-0.5">
                          <span className="text-slate-300 text-sm font-semibold">{dueAfterGiftCard <= 0 ? "Paid by gift card" : "Due"}</span>
                          <span className="text-emerald-300 text-lg sm:text-xl md:text-2xl font-black">{fmtCur(dueAfterGiftCard, sym)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Discount + Tip + Service Fee controls */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => { if (!canDiscount) return; setDiscountInput(billDiscountPct ? String(billDiscountPct) : ""); setShowBillDiscount(true); }}
                    disabled={!canDiscount}
                    title={canDiscount ? "Apply a bill discount" : "Senior / head waiter only"}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition ${billDiscountAmount > 0
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <Percent size={14} className="flex-shrink-0" />
                    {billDiscountAmount > 0 ? `Discount ${billDiscountPct}%` : "Discount"}
                  </button>
                  <button
                    onClick={() => { setTipInput(billTip ? String(billTip) : ""); setShowBillTip(true); }}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition ${billTip > 0
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                      : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
                      }`}
                  >
                    <BadgeDollarSign size={14} className="flex-shrink-0" />
                    {billTip > 0 ? `Tip ${fmtCur(billTip, sym)}` : "Tip"}
                  </button>
                  <div className="grid col-span-2 sm:col-span-1">
                    <button
                      onClick={() => { setServiceFeeInput(billServicePct ? String(billServicePct) : ""); setShowBillServiceFee(true); }}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition ${billServiceFee > 0
                        ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                        : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
                        }`}
                    >
                      <DollarSign size={14} className="flex-shrink-0" />
                      {billServiceFee > 0 ? `Service Fee ${billServicePct}%` : "Service Fee"}
                    </button>
                  </div>
                </div>

                {/* Waiter note */}
                <p className="text-slate-600 text-xs text-center">
                  {billOrders.length > 1 ? `Consolidated from ${billOrders.length} separate orders` : "Single order"}
                  {" · "}Table {table.label}
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
                      Settle Table {table.label} as {settleConfirm === "cash" ? "Cash" : settleConfirm === "card" ? "Card" : "Gift Card"}? This marks all orders as delivered and cannot be undone.
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
                      className={`flex items-center text-sm sm:text-base justify-center gap-2 px-2 py-3 rounded-2xl text-white font-bold transition disabled:opacity-50 ${settleConfirm === "cash" ? "bg-emerald-700 hover:bg-emerald-600" : settleConfirm === "card" ? "bg-blue-600 hover:bg-blue-500" : "bg-purple-600 hover:bg-purple-500"}`}
                    >
                      {paying
                        ? <Loader2 size={18} className="animate-spin" />
                        : settleConfirm === "cash" ? <Banknote size={18} className="hidden sm:block" /> : settleConfirm === "card" ? <CreditCard size={18} className="hidden sm:block" /> : <Gift size={18} className="hidden sm:block" />}
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
                  {dueAfterGiftCard <= 0 && billGiftCard ? (
                    // Gift card covers the whole bill — there's no cash/card remainder
                    // to collect, so settle as a gift-card-only tender (mirrors the POS
                    // "gift card only" path) instead of forcing a misleading cash/card.
                    <button
                      onClick={() => setSettleConfirm("gift_card")}
                      disabled={paying}
                      className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 active:scale-[0.97] text-white font-bold py-4 md:py-5 rounded-2xl transition-all"
                    >
                      {paying ? <Loader2 size={22} className="animate-spin" /> : <Gift size={22} />}
                      <span className="text-sm">Settle with Gift Card</span>
                    </button>
                  ) : (
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
                  )}
                  <button
                    onClick={() => onExit(false)}
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
              tableLabel={table.label}
              waiterName={waiter?.name ?? "Staff"}
              consolidatedLines={consolidatedLines}
              billSubtotal={billSubtotal}
              billDiscountAmount={billDiscountAmount}
              billDiscountNote={billDiscountNote}
              billVatAmount={billTax.enabled ? billTax.vatAmount : 0}
              billVatInclusive={billTax.inclusive}
              billVatRate={appSettings.taxSettings?.rate}
              billTip={billTip}
              billServiceFee={billServiceFee}
              giftCardApplied={giftCardApplied}
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
                  tableLabel: table.label,
                })}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-transparent border border-red-900/50 hover:border-red-700 text-red-500 hover:text-red-400 text-sm font-medium rounded-2xl transition"
              >
                <AlertTriangle size={14} />
                {waiter?.role === "senior" ? "Void Table" : "Void Table (Senior only)"}
              </button>
            </div>
          )}
        </div>

        <CollectionFooter />
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
            <p className="text-slate-400 text-xs mb-2">Tip ({fmtCur(billAfterTax, sym)} total)</p>
            <div className="flex gap-1.5 mb-4">
              {[10, 12.5, 15].map((v) => (
                <button key={v} onClick={() => setTipInput((Math.round(billAfterTax * (v / 100) * 100) / 100).toFixed(2))}
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

      {/* Service Fee modal — preset % of subtotal + custom amount */}
      {showBillServiceFee && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Add Service Fee</h3>
              <button onClick={() => setShowBillServiceFee(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="flex gap-1 sm:gap-2 mb-4">
              {[5, 8, 10, 12, 15, 20].map((v) => {
                return (
                  <button key={v} onClick={() => setServiceFeeInput(v.toString())}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${serviceFeeInput === v.toString() ? "bg-orange-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                    {v}%
                  </button>
                );
              })}
            </div>
            <input type="number" step="0.1" min={0} max={100} value={serviceFeeInput} onChange={(e) => setServiceFeeInput(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-base sm:text-lg font-bold outline-none focus:border-amber-500 mb-5" placeholder="Custom %" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setBillServicePct(0); setServiceFeeInput("0"); setShowBillServiceFee(false); }}
                className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">
                Clear
              </button>
              <button onClick={() => {
                const raw = parseFloat(serviceFeeInput) || 0;
                setBillServicePct(Math.max(0, Math.min(100, raw)));
                setShowBillServiceFee(false);
              }}
                className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm transition-colors">
                Apply
              </button>
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
            onExit(true);
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
            if (voidRefundTarget.mode === "refund") setReceipt(null);
            onExit(true);
          }}
        />
      )}
    </>
  );
}
