
import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { fullOrderNumber } from "@/lib/orderNumber";
import { parseTableLabelFromNote } from "@/lib/tableLabel";
import { printOnlineOrderAsAdmin } from "@/lib/escpos";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Customer, Order, OrderStatus } from "@/types";
import { Ban, Check, CheckCircle2, ChefHat, Circle, FileDown, Loader2, Package, Printer, Receipt, Truck, X } from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OrderStatus, { label: string; className: string; icon: React.ReactNode }> = {
    pending: { label: "Pending", className: "bg-yellow-50 text-yellow-700 border-yellow-200", icon: <Circle size={11} className="fill-yellow-400 text-yellow-400" /> },
    confirmed: { label: "Confirmed", className: "bg-blue-50 text-blue-700 border-blue-200", icon: <CheckCircle2 size={11} className="text-blue-500" /> },
    preparing: { label: "Preparing", className: "bg-orange-50 text-orange-700 border-orange-200", icon: <ChefHat size={11} className="text-orange-500" /> },
    ready: { label: "Ready", className: "bg-purple-50 text-purple-700 border-purple-200", icon: <Package size={11} className="text-purple-500" /> },
    delivered: { label: "Delivered", className: "bg-green-50 text-green-700 border-green-200", icon: <Truck size={11} className="text-green-600" /> },
    cancelled: { label: "Cancelled", className: "bg-red-50 text-red-700 border-red-200", icon: <Ban size={11} className="text-red-500" /> },
};

// A refunded order must surface both states — a bare "Cancelled" or
// "Delivered" badge hides the fact that the customer's money already went
// back (QA #37). Refund state lives on paymentStatus (dine-in refunds keep
// status "delivered").
function orderStatusLabel(o: { status: OrderStatus; paymentStatus?: string | null }): string {
    const base = STATUS_CONFIG[o.status]?.label ?? String(o.status);
    if (o.paymentStatus === "refunded") return `${base} · Refunded`;
    if (o.paymentStatus === "partially_refunded") return `${base} · Partial refund`;
    return base;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Matches escpos.ts's orderTypeLabel() and the on-screen preview below — all
// three fulfillment types, not just Delivery/Collection.
function orderTypeLabel(order: Order): string {
    return order.fulfillment === "delivery" ? "Delivery" : order.fulfillment === "dine-in" ? "Dine-In" : "Collection";
}

export function buildPrintHtml(
    order: Order,
    customer: Customer,
    rs: { showLogo: boolean; logoUrl: string; restaurantName: string; address: string; phone: string; website: string; email: string; companyNumber: string; vatNumber: string; thankYouMessage: string; customMessage: string },
    restaurantAddress: string,
    sym: string,
    showVat: boolean,
): string {
    const subtotal = order.items.reduce((s, l) => s + l.price * l.qty, 0);
    const deliveryFee = order.deliveryFee ?? 0;
    const serviceFee = order.serviceFee ?? 0;
    const couponDisc = order.couponDiscount ?? 0;
    const vatAmt = order.vatAmount ?? 0;
    const vatInclusive = order.vatInclusive ?? true;
    const storeCreditUsed = order.storeCreditUsed ?? 0;
    const giftCardUsed = order.giftCardUsed ?? 0;
    const tipAmount = order.tipAmount ?? 0;
    const discountAmount = order.discountAmount ?? 0;
    const discountNote = order.discountNote ?? "";
    const tableLabel = order.fulfillment === "dine-in" ? parseTableLabelFromNote(order.note) : null;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Receipt ${fullOrderNumber(order.id)}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Courier New',monospace;font-size:12px;color:#111;background:#fff;padding:16px}
    .r{max-width:300px;margin:0 auto}
    .c{text-align:center}
    .b{font-weight:bold}
    .d{border-top:1px dashed #999;margin:8px 0}
    .row{display:flex;justify-content:space-between;margin:3px 0}
    .tot{display:flex;justify-content:space-between;font-weight:bold;font-size:14px;margin-top:4px}
    .sm{font-size:10px;color:#555}
    .logo{max-height:60px;max-width:160px;object-fit:contain;margin:0 auto 6px;display:block}
  </style>
</head>
<body>
<div class="r">
  ${rs.showLogo && rs.logoUrl ? `<img src="${rs.logoUrl}" class="logo" alt="Logo"/>` : ""}
  <div class="c b" style="font-size:15px">${rs.restaurantName}</div>
  ${restaurantAddress ? `<div class="c sm">${restaurantAddress}</div>` : ""}
  ${rs.phone ? `<div class="c sm">${rs.phone}</div>` : ""}
  ${rs.website ? `<div class="c sm">${rs.website}</div>` : ""}
  ${rs.email ? `<div class="c sm">${rs.email}</div>` : ""}
  ${rs.companyNumber ? `<div class="c sm">Company No: ${rs.companyNumber}</div>` : ""}
  ${rs.vatNumber ? `<div class="c sm">VAT: ${rs.vatNumber}</div>` : ""}
  <div class="d"></div>
  <div class="c b">RECEIPT</div>
  <div class="c sm" style="word-break:break-all">${fullOrderNumber(order.id)}</div>
  ${order.id?.startsWith("OFF") ? `<div class="c sm" style="font-weight:700;color:#b45309">OFFLINE SALE</div>` : ""}
  <div class="c sm">${fmtDate(order.date)} at ${fmtTime(order.date)}</div>
  <div class="d"></div>
  <div class="row"><span>Customer:</span><span>${customer.name}</span></div>
  <div class="row"><span>Type:</span><span>${orderTypeLabel(order)}</span></div>
  ${tableLabel ? `<div class="row"><span>Table:</span><span>${tableLabel}</span></div>` : ""}
  ${order.address ? `<div class="row"><span>Address:</span><span style="text-align:right;max-width:180px">${order.address}</span></div>` : ""}
  ${order.scheduledTime ? `<div class="row"><span>Scheduled:</span><span>${order.scheduledTime}</span></div>` : ""}
  <div class="d"></div>
  ${order.items.map((l) => `<div class="row"><span>${l.qty}x ${l.name}</span><span>${sym}${(l.price * l.qty).toFixed(2)}</span></div>`).join("")}
  <div class="d"></div>
  <div class="row"><span>Subtotal</span><span>${sym}${subtotal.toFixed(2)}</span></div>
  ${order.fulfillment === "delivery" ? `<div class="row"><span>Delivery fee</span><span>${sym}${deliveryFee.toFixed(2)}</span></div>` : ""}
  ${serviceFee > 0 ? `<div class="row"><span>Service fee</span><span>${sym}${serviceFee.toFixed(2)}</span></div>` : ""}
  ${couponDisc > 0 ? `<div class="row" style="color:#16a34a;font-weight:600"><span>Coupon (${order.couponCode ?? ""})</span><span>-${sym}${couponDisc.toFixed(2)}</span></div>` : ""}
  ${discountAmount > 0 ? `<div class="row" style="color:#16a34a;font-weight:600"><span>Discount ${discountNote ? `(${discountNote})` : ""}</span><span>-${sym}${discountAmount.toFixed(2)}</span></div>` : ""}
  ${vatAmt > 0 && showVat ? `<div class="row" style="color:${vatInclusive ? "#9ca3af" : "#ea580c"};font-weight:600"><span>${vatInclusive ? "Incl. VAT" : "VAT"}</span><span>${vatInclusive ? "" : "+"}${sym}${vatAmt.toFixed(2)}</span></div>` : ""}
  ${tipAmount > 0 ? `<div class="row" style="color:#2563eb;font-weight:600"><span>Tip</span><span>${sym}${tipAmount.toFixed(2)}</span></div>` : ""}
  ${storeCreditUsed > 0 ? `<div class="row" style="color:#2563eb;font-weight:600"><span>Store credit applied</span><span>-${sym}${storeCreditUsed.toFixed(2)}</span></div>` : ""}
  ${giftCardUsed > 0 ? `<div class="row" style="color:#8b5cf6;font-weight:600"><span>Gift card applied</span><span>-${sym}${giftCardUsed.toFixed(2)}</span></div>` : ""}
  <div class="d"></div>
  <div class="tot"><span>TOTAL</span><span>${sym}${order.total.toFixed(2)}</span></div>
  ${vatAmt > 0 && vatInclusive && showVat ? `<div class="c sm" style="margin-top:3px">Prices include VAT</div>` : ""}
  ${order.paymentMethod ? `<div class="row" style="margin-top:6px"><span>Payment:</span><span>${order.paymentMethod}</span></div>` : ""}
  ${(order.cardTipAmount ?? 0) > 0 ? `<div class="row"><span>Tip on card machine</span><span>${sym}${(order.cardTipAmount ?? 0).toFixed(2)}</span></div>
  <div class="row" style="font-weight:700"><span>Card total</span><span>${sym}${(Math.round((order.total + (order.cardTipAmount ?? 0)) * 100) / 100).toFixed(2)}</span></div>` : ""}
  <div class="row"><span>Status:</span><span>${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span></div>
  <div class="d"></div>
  ${rs.thankYouMessage ? `<div class="c b" style="margin-bottom:3px">${rs.thankYouMessage}</div>` : ""}
  ${rs.customMessage ? `<div class="c sm" style="margin-bottom:3px;white-space:pre-wrap">${rs.customMessage}</div>` : ""}
  <div class="c sm">${rs.restaurantName}</div>
</div>
<script>
  window.onafterprint = function () { window.close(); };
  window.onload = function () { window.focus(); window.print(); };
</script>
</body>
</html>`;
}

/** The VAT rate the order was charged at, worked back from its stored VAT amount
 *  (so an old receipt keeps its rate even if the tax setting changed since). */
export function historicalVatRate(order: Order): number {
    const vatAmt = order.vatAmount ?? 0;
    if (vatAmt <= 0) return 0;
    const subtotal = order.items.reduce((s, l) => s + l.price * l.qty, 0);
    // The base amount before store credit/gift cards are applied
    const baseAmount = subtotal + (order.deliveryFee ?? 0) + (order.serviceFee ?? 0) - (order.couponDiscount ?? 0);
    if (baseAmount <= 0) return 0;
    // Inclusive: Rate = (VAT / (Gross - VAT)) * 100.  Exclusive: Rate = (VAT / Net) * 100.
    return Math.round((order.vatInclusive ? vatAmt / (subtotal - vatAmt) : vatAmt / baseAmount) * 100);
}

// ─── Receipt Modal ────────────────────────────────────────────────────────────

export function ReceiptModal({
    order,
    customer,
    onClose,
}: {
    order: Order;
    customer: Customer;
    onClose: () => void;
}) {
    const { settings } = useApp();
    const sym = settings.currency?.symbol ?? "£";
    const { restaurant, receiptSettings: rs } = settings;
    const restaurantAddress = rs.address?.trim() || [restaurant.addressLine1, restaurant.city, restaurant.postcode].filter(Boolean).join(", ");
    const tax = settings.taxSettings;
    const showVat = order.vatInclusive ? tax.showBreakdown : true;

    const subtotal = order.items.reduce((s, l) => s + l.price * l.qty, 0);
    const deliveryFee = order.deliveryFee ?? 0;
    const serviceFee = order.serviceFee ?? 0;
    const couponDisc = order.couponDiscount ?? 0;
    const vatAmt = order.vatAmount ?? 0;
    // const vatRate = settings.taxSettings?.rate ?? 0;
    const storeCreditUsed = order.storeCreditUsed ?? 0;
    const giftCardUsed = order.giftCardUsed ?? 0;
    const tipAmount = order.tipAmount ?? 0;
    const discountAmount = order.discountAmount ?? 0;
    const discountNote = order.discountNote ?? "";

    const vatRate = historicalVatRate(order);

    function handlePdf() {
        const html = buildPrintHtml(order, customer, rs, restaurantAddress, sym, showVat);
        const win = window.open("", "_blank", "width=420,height=720");
        if (!win) {
            alert("Pop-up was blocked. Allow pop-ups for this site and try again.");
            return;
        }
        win.document.write(html);
        win.document.close();
    }

    // "Print": sends the receipt to the active Admin Receipts printer (Admin → Integrations).
    const [printState, setPrintState] = useState<"idle" | "busy" | "done">("idle");
    const [noPrinterOpen, setNoPrinterOpen] = useState(false);

    async function handlePrint() {
        if (printState === "busy") return;
        setPrintState("busy");
        const result = await printOnlineOrderAsAdmin(order, settings, {
            customerName: customer.name,
            customerPhone: customer.phone,
            heading: "RECEIPT",
            vatRate,
            staffName: (order as unknown as { staffName?: string }).staffName,
        });
        if (result.noPrinter) { setPrintState("idle"); setNoPrinterOpen(true); return; }
        if (!result.ok) { setPrintState("idle"); alert(result.error ?? "Printing failed."); return; }
        setPrintState("done");
        setTimeout(() => setPrintState("idle"), 2000);
    }

    return (
        <>
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[410px] max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <Receipt size={16} className="text-orange-500" />
                        <h2 title={`Receipt ${fullOrderNumber(order.id)}`} className="font-bold text-gray-900 text-sm truncate">Receipt {fullOrderNumber(order.id)}</h2>
                        {order.id?.startsWith("OFF") && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">OFFLINE SALE</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handlePrint}
                            disabled={printState === "busy"}
                            title="Print to the Admin Receipts printer"
                            className="flex items-center gap-1.5 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1.5 rounded-lg transition disabled:opacity-60"
                        >
                            {printState === "busy" ? <Loader2 size={12} className="animate-spin" />
                                : printState === "done" ? <Check size={12} className="text-green-600" />
                                : <Printer size={12} />}
                            {printState === "busy" ? "Printing…" : "Print"}
                        </button>
                        <button
                            onClick={handlePdf}
                            title="Open the print window, then choose Save as PDF"
                            className="flex items-center gap-1.5 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1.5 rounded-lg transition"
                        >
                            <FileDown size={12} /> PDF
                        </button>
                        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition">
                            <X size={13} />
                        </button>
                    </div>
                </div>

                {/* Receipt body */}
                <div className="flex-1 overflow-y-auto p-5 font-mono text-xs space-y-3 text-gray-800">
                    {/* Restaurant header */}
                    <div className="text-center space-y-0.5">
                        {rs.showLogo && rs.logoUrl && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={rs.logoUrl} alt="Logo" className="h-12 object-contain mx-auto mb-1" />
                        )}
                        <p className="font-bold text-base text-gray-900">{rs.restaurantName}</p>
                        {restaurantAddress && <p className="text-gray-500 text-[10px]">{restaurantAddress}</p>}
                        {rs.phone && <p className="text-gray-500">{rs.phone}</p>}
                        {rs.website && <p className="text-gray-500">{rs.website}</p>}
                        {rs.email && <p className="text-gray-500">{rs.email}</p>}
                        {rs.companyNumber && <p className="text-gray-500">Company No: {rs.companyNumber}</p>}
                        {rs.vatNumber && <p className="text-gray-500">VAT: {rs.vatNumber}</p>}
                    </div>

                    <div className="border-t border-dashed border-gray-300" />

                    <div className="text-center space-y-0.5">
                        <p className="font-bold text-sm">RECEIPT</p>
                        <p title={fullOrderNumber(order.id)} className="text-gray-500 break-all">{fullOrderNumber(order.id)}</p>
                        <p className="text-gray-500">{fmtDate(order.date)} at {fmtTime(order.date)}</p>
                    </div>

                    <div className="border-t border-dashed border-gray-300" />

                    <div className="space-y-1">
                        <div className="flex justify-between">
                            <span className="text-gray-500">Customer</span>
                            <span className="font-medium">{customer.name}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Type</span>
                            <span className="font-medium">{order.fulfillment === "delivery" ? "🚚 Delivery" : order.fulfillment === 'collection' ? "🏪 Collection" : "🍽️ Dine-In"}</span>
                        </div>
                        {order.fulfillment === "dine-in" && parseTableLabelFromNote(order.note) && (
                            <div className="flex justify-between">
                                <span className="text-gray-500">Table</span>
                                <span className="font-medium">{parseTableLabelFromNote(order.note)}</span>
                            </div>
                        )}
                        {order.address && (
                            <div className="flex justify-between gap-4">
                                <span className="text-gray-500 flex-shrink-0">Address</span>
                                <span className="text-right font-medium">{order.address}</span>
                            </div>
                        )}
                        {order.scheduledTime && (
                            <div className="flex justify-between gap-4">
                                <span className="text-gray-500 flex-shrink-0">Scheduled</span>
                                <span className="text-right font-medium text-green-700">{order.scheduledTime}</span>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-dashed border-gray-300" />

                    <div className="space-y-3">
                        {order.items.map((line, i) => {
                            // 1. Process details
                            const v = line.selectedVariations?.map(v => v.label).join(", ");
                            const a = line.selectedAddOns?.map(a => a.name).join(", ");
                            const details = [v, a].filter(Boolean).join(" / ");

                            return (
                                <div key={i} className="flex justify-between items-start">
                                    <div className="flex-1 min-w-0">
                                        <span className="block text-sm">
                                            {line.qty}× {line.name}
                                        </span>

                                        {/* 2. Only show details if they exist */}
                                        {details && (
                                            <p className="text-[11px] text-gray-400 leading-tight mt-0.5">
                                                {details}
                                            </p>
                                        )}
                                    </div>

                                    <span className="text-sm font-medium tabular-nums ml-4">
                                        {sym}{(line.price * line.qty).toFixed(2)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    <div className="border-t border-dashed border-gray-300" />

                    <div className="space-y-1">
                        <div className="flex justify-between text-gray-500">
                            <span>Subtotal</span><span>{sym}{subtotal.toFixed(2)}</span>
                        </div>
                        {order.fulfillment === "delivery" && (
                            <div className="flex justify-between text-gray-500">
                                <span>Delivery fee</span><span>{sym}{deliveryFee.toFixed(2)}</span>
                            </div>
                        )}
                        {serviceFee > 0 && (
                            <div className="flex justify-between text-gray-500">
                                <span>Service fee</span><span>{sym}{serviceFee.toFixed(2)}</span>
                            </div>
                        )}
                        {couponDisc > 0 && (
                            <div className="flex justify-between text-green-700 font-semibold">
                                <span>Coupon ({order.couponCode})</span>
                                <span>−{sym}{couponDisc.toFixed(2)}</span>
                            </div>
                        )}
                        {discountAmount > 0 && (
                            <div className="flex justify-between text-green-700 font-semibold">
                                <span>Discount {discountNote ? `(${discountNote})` : ""}</span>
                                <span>−{sym}{discountAmount.toFixed(2)}</span>
                            </div>
                        )}
                        {vatAmt > 0 && showVat && (
                            <div className={`flex justify-between font-semibold ${order.vatInclusive ? "text-gray-400" : "text-orange-600"}`}>
                                <span>{order.vatInclusive ? `Incl. VAT (${vatRate}%)` : `VAT (${vatRate}%)`}</span>
                                <span>{order.vatInclusive ? `${sym}${vatAmt.toFixed(2)}` : `+${sym}${vatAmt.toFixed(2)}`}</span>
                            </div>
                        )}
                        {tipAmount > 0 && (
                            <div className="flex justify-between text-blue-600 font-semibold">
                                <span>Tip</span>
                                <span>{sym}{tipAmount.toFixed(2)}</span>
                            </div>
                        )}
                        {storeCreditUsed > 0 && (
                            <div className="flex justify-between text-blue-600 font-semibold">
                                <span>Store credit applied</span>
                                <span>−{sym}{storeCreditUsed.toFixed(2)}</span>
                            </div>
                        )}
                        {giftCardUsed > 0 && (
                            <div className="flex justify-between text-purple-600 font-semibold">
                                <span>Gift card applied</span>
                                <span>−{sym}{giftCardUsed.toFixed(2)}</span>
                            </div>
                        )}
                    </div>

                    <div className="border-t border-dashed border-gray-300" />

                    <div className="flex justify-between font-bold text-base">
                        <span>TOTAL</span><span>{sym}{order.total.toFixed(2)}</span>
                    </div>
                    {vatAmt > 0 && order.vatInclusive && showVat && (
                        <p className="text-[10px] text-gray-400 text-right">Prices include {vatRate}% VAT</p>
                    )}

                    {(order.paymentMethod || order.status) && (
                        <div className="space-y-1">
                            {order.paymentMethod && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Payment</span>
                                    <span className="font-medium">{order.paymentMethod}</span>
                                </div>
                            )}
                            {(order.cardTipAmount ?? 0) > 0 && (
                                <>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Tip on card machine</span>
                                        <span className="font-medium">{sym}{(order.cardTipAmount ?? 0).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between font-semibold">
                                        <span>Card total</span>
                                        <span>{sym}{(Math.round((order.total + (order.cardTipAmount ?? 0)) * 100) / 100).toFixed(2)}</span>
                                    </div>
                                </>
                            )}
                            <div className="flex justify-between">
                                <span className="text-gray-500">Status</span>
                                <span className={`font-semibold ${STATUS_CONFIG[order.status].className.split(" ").find((c) => c.startsWith("text-")) ?? "text-gray-900"}`}>
                                    {orderStatusLabel(order)}
                                </span>
                            </div>
                        </div>
                    )}

                    {order.note && (
                        <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-amber-700">
                            Note: {order.note}
                        </div>
                    )}

                    <div className="border-t border-dashed border-gray-300" />

                    <div className="text-center space-y-0.5 text-gray-500">
                        {rs.thankYouMessage && <p className="font-medium text-gray-700">{rs.thankYouMessage}</p>}
                        {rs.customMessage && <p className="text-[10px] leading-snug whitespace-pre-wrap">{rs.customMessage}</p>}
                        <p>{rs.restaurantName}</p>
                    </div>
                </div>
            </div>
        </div>

        {/* Print clicked with no active Admin Receipts printer: say so, and offer the PDF instead. */}
        <ConfirmDialog
            open={noPrinterOpen}
            title="No printer set up"
            message="Print needs an active printer in the Admin Receipts section. Add one in Admin → Integrations → Thermal Printer and set it active. You can still save this receipt as a PDF."
            confirmLabel="Save as PDF"
            cancelLabel="Close"
            tone="primary"
            onConfirm={() => { setNoPrinterOpen(false); handlePdf(); }}
            onCancel={() => setNoPrinterOpen(false)}
        />
        </>
    );
}