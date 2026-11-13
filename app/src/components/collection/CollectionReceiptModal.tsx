"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, FileDown, Info, Loader2, Printer, Receipt, X } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { Customer, Order, PrinterCategory } from "@/types";
import { fullOrderNumber } from "@/lib/orderNumber";
import { printOnlineOrderAsAdmin } from "@/lib/escpos";
import { buildPrintHtml, historicalVatRate } from "@/components/admin/ReceiptModal";

const CATEGORY_LABEL: Record<PrinterCategory, string> = { online: "Online", pos: "Receipt", kitchen: "Kitchen" };

/**
 * Receipt shown right after a payment is taken. Same look as the waiter's
 * dine-in receipt (dark card, dashed dividers). Print sends it to the active
 * printer in `printCategory` (the Online printer by default) through
 * `printEndpoint` (the collection-staff relay by default); PDF opens the
 * browser print window (choose "Save as PDF"). Closing is final — the order
 * has already moved to History — so a backdrop click does not close it, only the
 * Close button, the X or Esc.
 */
export default function CollectionReceiptModal({
  order,
  customer,
  onClose,
  printEndpoint = "/api/collection/print",
  printCategory = "online",
}: {
  order: Order;
  customer: Customer;
  onClose: () => void;
  printEndpoint?: string;
  printCategory?: PrinterCategory;
}) {
  const printerLabel = CATEGORY_LABEL[printCategory];
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const { restaurant, receiptSettings: rs, taxSettings: tax } = settings;
  const restaurantName = rs.restaurantName?.trim() || restaurant.name || "Restaurant";
  const restaurantAddress = rs.address?.trim() || [restaurant.addressLine1, restaurant.city, restaurant.postcode].filter(Boolean).join(", ");
  const showVat = order.vatInclusive ? tax.showBreakdown : true;
  const vatRate = historicalVatRate(order);

  const subtotal = order.items.reduce((s, l) => s + l.price * l.qty, 0);
  const serviceFee = order.serviceFee ?? 0;
  const couponDisc = order.couponDiscount ?? 0;
  const vatAmt = order.vatAmount ?? 0;
  const storeCredit = order.storeCreditUsed ?? 0;
  const giftCard = order.giftCardUsed ?? 0;
  // A tip the customer added on the card machine, on top of the total.
  const cardTip = order.cardTipAmount ?? 0;
  const hasBreakdown = serviceFee > 0 || couponDisc > 0 || (vatAmt > 0 && showVat) || storeCredit > 0 || giftCard > 0;
  const money = (n: number) => `${sym}${n.toFixed(2)}`;
  // Just-paid orders are always "paid"; a History reprint can also be refunded.
  const payment =
    order.paymentStatus === "refunded" ? { label: "REFUNDED", className: "text-red-400" }
    : order.paymentStatus === "partially_refunded" ? { label: "PAID (partly refunded)", className: "text-amber-400" }
    : order.paymentStatus === "unpaid" ? { label: "UNPAID", className: "text-amber-400" }
    : { label: "PAID", className: "text-emerald-400" };

  const [printState, setPrintState] = useState<"idle" | "busy" | "done">("idle");
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handlePrint() {
    if (printState === "busy") return;
    setPrintState("busy");
    setNotice(null);
    const result = await printOnlineOrderAsAdmin(
      order,
      settings,
      { customerName: customer.name, customerPhone: customer.phone, heading: "RECEIPT", vatRate },
      printEndpoint,
      printCategory,
    );
    if (result.noPrinter) {
      setPrintState("idle");
      setNotice({
        tone: "info",
        text: printCategory === "pos"
          ? "No receipt printer is set up. Add one in Settings → Hardware and set it active. You can still save this receipt as a PDF."
          : "No online printer is set up under the Admin Receipts section. Ask an admin to add one in Admin → Integrations and set it active. You can still save this receipt as a PDF.",
      });
      return;
    }
    if (!result.ok) {
      setPrintState("idle");
      setNotice({ tone: "error", text: result.error ?? "Printing failed." });
      return;
    }
    setPrintState("done");
    setTimeout(() => setPrintState("idle"), 2500);
  }

  function handlePdf() {
    setNotice(null);
    const html = buildPrintHtml(order, customer, rs, restaurantAddress, sym, showVat);
    const win = window.open("", "_blank", "width=420,height=720");
    if (!win) {
      setNotice({ tone: "error", text: "Pop-up was blocked. Allow pop-ups for this site and try again." });
      return;
    }
    win.document.write(html);
    win.document.close();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Payment receipt"
      className="fixed inset-0 z-60 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="bg-slate-800 rounded-3xl w-full max-w-sm max-h-[92dvh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-5 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Receipt size={18} className="text-emerald-400 flex-shrink-0" />
            <span title={fullOrderNumber(order.id)} className="text-white font-bold truncate">Receipt — {fullOrderNumber(order.id)}</span>
          </div>
          <button onClick={onClose} aria-label="Close receipt" className="text-slate-400 hover:text-white transition flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* Receipt preview */}
        <div className="p-5 flex-1 min-h-0 overflow-y-auto space-y-4">
          {/* Header block */}
          <div className="text-center space-y-0.5">
            <p className="text-white font-black text-base tracking-widest uppercase">{restaurantName}</p>
            {restaurantAddress && <p className="text-slate-500 text-[10px]">{restaurantAddress}</p>}
            {rs.phone && <p className="text-slate-400 text-xs">{rs.phone}</p>}
            {rs.website && <p className="text-slate-400 text-xs">{rs.website}</p>}
            <p className="text-slate-400 text-xs">{new Date(order.date).toLocaleString("en-GB")}</p>
            <p className="text-slate-400 text-xs">Customer: <span className="text-white font-bold">{customer.name}</span></p>
            {customer.phone && <p className="text-slate-400 text-xs">Phone: <span className="text-white">{customer.phone}</span></p>}
            <p className="text-slate-400 text-xs">Type: <span className="text-white">Collection</span></p>
            {order.scheduledTime && <p className="text-slate-400 text-xs">Scheduled: <span className="text-white">{order.scheduledTime}</span></p>}
            {rs.companyNumber && <p className="text-slate-500 text-[10px]">Company No: {rs.companyNumber}</p>}
            {rs.vatNumber && <p className="text-slate-500 text-[10px]">VAT No: {rs.vatNumber}</p>}
          </div>

          <hr className="border-dashed border-slate-600" />

          {/* Items */}
          <div className="space-y-1.5">
            {order.items.map((line, i) => {
              const choices = [
                line.selectedVariations?.map((v) => v.label).join(", "),
                line.selectedAddOns?.map((a) => a.name).join(", "),
              ].filter(Boolean).join(" / ");
              return (
                <div key={i} className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300 text-sm">{line.name} <span className="text-slate-500">×{line.qty}</span></span>
                    {choices && <p className="text-slate-500 text-[11px] leading-tight mt-0.5">{choices}</p>}
                    {line.specialInstructions && <p className="text-slate-500 text-[11px] leading-tight mt-0.5 italic">“{line.specialInstructions}”</p>}
                  </div>
                  <span className="text-white text-sm font-medium">{money(line.price * line.qty)}</span>
                </div>
              );
            })}
          </div>

          <hr className="border-dashed border-slate-600" />

          {/* Total + payment */}
          <div className="space-y-1">
            {hasBreakdown && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-xs">Subtotal</span>
                  <span className="text-slate-300 text-xs">{money(subtotal)}</span>
                </div>
                {serviceFee > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">Service Fee</span>
                    <span className="text-slate-300 text-xs">{money(serviceFee)}</span>
                  </div>
                )}
                {couponDisc > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 text-xs">Coupon{order.couponCode ? ` (${order.couponCode})` : ""}</span>
                    <span className="text-emerald-400 text-xs">−{money(couponDisc)}</span>
                  </div>
                )}
                {vatAmt > 0 && showVat && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-xs">{order.vatInclusive ? `Incl. VAT${vatRate ? ` (${vatRate}%)` : ""}` : `VAT${vatRate ? ` (${vatRate}%)` : ""}`}</span>
                    <span className="text-slate-300 text-xs">{order.vatInclusive ? "" : "+"}{money(vatAmt)}</span>
                  </div>
                )}
                {storeCredit > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-blue-300 text-xs">Store credit applied</span>
                    <span className="text-blue-300 text-xs">−{money(storeCredit)}</span>
                  </div>
                )}
                {giftCard > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-orange-300 text-xs">Gift card applied</span>
                    <span className="text-orange-300 text-xs">−{money(giftCard)}</span>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-white font-black text-base">TOTAL</span>
              <span className="text-white font-black text-xl">{money(order.total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-xs">Payment</span>
              <span className="text-xs">
                <span className={`${payment.className} font-bold`}>{payment.label}</span>
                {order.paymentMethod && <span className="text-slate-300"> · {order.paymentMethod}</span>}
              </span>
            </div>
            {cardTip > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-xs">Tip on card machine</span>
                  <span className="text-slate-300 text-xs">{money(cardTip)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white font-bold text-sm">Card total</span>
                  <span className="text-white font-bold text-sm">{money(Math.round((order.total + cardTip) * 100) / 100)}</span>
                </div>
              </>
            )}
          </div>

          {order.note && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-amber-300 text-xs">
              Note: {order.note}
            </div>
          )}

          {(rs.thankYouMessage || rs.customMessage) && (
            <div className="text-center space-y-0.5 pt-1">
              {rs.thankYouMessage && <p className="text-slate-300 text-xs font-semibold">{rs.thankYouMessage}</p>}
              {rs.customMessage && <p className="text-slate-500 text-[10px] leading-snug whitespace-pre-wrap">{rs.customMessage}</p>}
            </div>
          )}
        </div>

        {/* Print / PDF notice */}
        {notice && (
          <div
            role="alert"
            className={`mx-5 mb-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs flex-shrink-0 ${
              notice.tone === "error"
                ? "bg-red-500/10 border-red-500/30 text-red-300"
                : "bg-amber-500/10 border-amber-500/30 text-amber-300"
            }`}
          >
            {notice.tone === "error"
              ? <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              : <Info size={14} className="flex-shrink-0 mt-0.5" />}
            <p className="flex-1 leading-snug">{notice.text}</p>
          </div>
        )}

        {/* Footer actions */}
        <div className="p-5 border-t border-slate-700 grid grid-cols-3 gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex flex-col items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-300 py-3 rounded-xl transition text-xs font-medium"
          >
            <X size={16} /> Close
          </button>
          <button
            onClick={handlePdf}
            title="Open the print window, then choose Save as PDF"
            className="flex flex-col items-center gap-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl transition text-xs font-medium"
          >
            <FileDown size={16} /> PDF
          </button>
          <button
            onClick={handlePrint}
            disabled={printState === "busy"}
            title={`Print to the ${printerLabel} printer`}
            className="flex flex-col items-center gap-1 bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white py-3 rounded-xl transition text-xs font-medium"
          >
            {printState === "busy" ? <Loader2 size={16} className="animate-spin" />
              : printState === "done" ? <Check size={16} />
              : <Printer size={16} />}
            {printState === "busy" ? "Printing…" : printState === "done" ? "Printed" : "Print"}
          </button>
        </div>
      </div>
    </div>
  );
}
