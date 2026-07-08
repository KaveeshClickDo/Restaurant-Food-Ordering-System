"use client";

/**
 * Pre-payment "Print or Email Bill" bar at the bottom of the bill view.
 * Builds a pending-payment receipt from the current bill figures and emails
 * it via /api/email; printing is delegated back to the caller.
 */

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { Printer, Loader2, CheckCircle2, Mail } from "lucide-react";
import type { WaiterReceipt } from "./_types";
import { buildReceiptHtml } from "./_receiptHtml";

export default function BillEmailBar({ onPrint, tableLabel, waiterName, consolidatedLines, billSubtotal, billDiscountAmount, billDiscountNote, billVatAmount, billVatInclusive, billVatRate, billTip, billServiceFee, giftCardApplied, billTotal, orderIds }: {
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
  billServiceFee: number;
  giftCardApplied: number;
  billTotal: number;
  orderIds: string[];
}) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const rs = settings.receiptSettings;
  const restaurantName = rs?.restaurantName?.trim() || settings.restaurant?.name || "Restaurant";
  const [emailTo, setEmailTo] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [marketingOptIn, setMarketingOptIn] = useState(true);

  async function handleEmail() {
    if (!emailTo.trim()) return;
    setEmailStatus("sending");
    const tempReceipt: WaiterReceipt = {
      tableLabel, waiterName,
      date: new Date().toISOString(),
      items: consolidatedLines,
      subtotal: billSubtotal,
      discountAmount: billDiscountAmount > 0 ? billDiscountAmount : undefined,
      discountNote: billDiscountAmount > 0 ? (billDiscountNote.trim() || undefined) : undefined,
      vatAmount: billVatAmount > 0 ? billVatAmount : undefined,
      vatInclusive: billVatAmount > 0 ? billVatInclusive : undefined,
      vatRate: billVatAmount > 0 ? billVatRate : undefined,
      tipAmount: billTip > 0 ? billTip : undefined,
      serviceFeeAmount: billServiceFee > 0 ? billServiceFee : undefined,
      giftCardUsed: giftCardApplied > 0 ? giftCardApplied : undefined,
      // NET money paid; the receipt re-adds gift_card_used for the gross line.
      total: Math.max(0, Math.round((billTotal - giftCardApplied) * 100) / 100),
      paymentMethod: "pending",
      orderIds,
    };
    const html = buildReceiptHtml(tempReceipt, restaurantName, rs?.address ?? "", rs?.phone ?? "", rs?.website ?? "", rs?.vatNumber ?? "", rs?.thankYouMessage ?? "Thank you for dining with us!", sym);
    const subject = `Your bill from ${restaurantName} — Table ${tableLabel}`;
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: emailTo.trim(), subject, html, marketingOptIn }),
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
      {/* Marketing consent — PECR: opt-out offered when the email is collected */}
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)}
          className="w-4 h-4 accent-orange-500 mt-0.5 shrink-0" />
        <span className="text-xs text-slate-500">Guest agrees to receive offers &amp; news by email</span>
      </label>
      {emailStatus === "error" && <p className="text-red-400 text-xs">Failed to send — check email settings.</p>}
    </div>
  );
}
