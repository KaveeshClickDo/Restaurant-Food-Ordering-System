"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { usePOS } from "@/context/POSContext";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";
import { useConnectivity } from "@/lib/connectivity";
import { drainOutbox, pendingCount, retryFailed } from "@/lib/posOutbox";
import { buildTestReceipt, sendToPrinter, sendToPrinterUSB, printReceiptBrowser } from "@/lib/escpos";
import {
  POSProduct, POSCategory, POSCartItem, POSModifier, POSModifierOption,
  POSCartModifier, POSCustomer, POSStaff, POSSale, POSSettings,
  ROLE_PERMISSIONS, POSOffer, getOfferPrice, isOfferActive, cartLineTotal, cartLineSaving,
} from "@/types/pos";
import {
  ShoppingCart, LayoutDashboard, Users, UserCog, Settings2, ChefHat,
  Plus, Minus, Trash2, Tag, Percent, Receipt, Search, X, LogOut,
  Clock, TrendingUp, Package, Star, CreditCard, Banknote, Shuffle,
  ChevronRight, ChevronDown, CheckCircle2, AlertCircle, BadgeDollarSign,
  Pencil, Save, RefreshCw, ToggleLeft, ToggleRight, Printer, Gift,
  Phone, Mail, Calendar, ArrowUpRight, Trophy, Zap, BarChart3,
  UserPlus, ClockIcon, Timer, PanelLeftClose, Flame, CircleCheck, Download,
  Utensils, AlertTriangle, RotateCcw, ShieldOff, Loader2,
  UtensilsCrossed, LogIn, CalendarDays, WifiOff, Wifi,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, sym = "£") { return `${sym}${n.toFixed(2)}`; }
function fmtPct(n: number) { return `${n.toFixed(0)}%`; }
function getInitials(name: string) { return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2); }
function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type View = "sale" | "dashboard" | "customers" | "staff" | "settings" | "tables" | "reservations";

interface ModifierSelectionState {
  product: POSProduct;
  selections: Record<string, string[]>; // modifierId → optionIds
}

// ─── Modifier Modal ────────────────────────────────────────────────────────────

function ModifierModal({
  product,
  onConfirm,
  onClose,
  currencySymbol,
}: {
  product: POSProduct;
  onConfirm: (modifiers: POSCartModifier[]) => void;
  onClose: () => void;
  currencySymbol: string;
}) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});

  const modifiers = product.modifiers ?? [];

  function toggle(modifier: POSModifier, option: POSModifierOption) {
    setSelections((prev) => {
      const current = prev[modifier.id] ?? [];
      if (modifier.multiSelect) {
        const next = current.includes(option.id)
          ? current.filter((id) => id !== option.id)
          : [...current, option.id];
        return { ...prev, [modifier.id]: next };
      } else {
        return { ...prev, [modifier.id]: [option.id] };
      }
    });
  }

  function canConfirm() {
    return modifiers.every((m) => !m.required || (selections[m.id]?.length ?? 0) > 0);
  }

  function confirm() {
    const flat: POSCartModifier[] = [];
    for (const m of modifiers) {
      const selected = selections[m.id] ?? [];
      for (const optId of selected) {
        const opt = m.options.find((o) => o.id === optId)!;
        flat.push({ modifierId: m.id, modifierName: m.name, optionId: opt.id, optionLabel: opt.label, priceAdjust: opt.priceAdjust });
      }
    }
    onConfirm(flat);
  }

  const totalAdjust = Object.entries(selections).reduce((sum, [mId, optIds]) => {
    const m = modifiers.find((mod) => mod.id === mId);
    if (!m) return sum;
    return sum + optIds.reduce((s, oId) => {
      const opt = m.options.find((o) => o.id === oId);
      return s + (opt?.priceAdjust ?? 0);
    }, 0);
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between">
          <div>
            <h2 className="text-white font-bold text-base">{product.name}</h2>
            <p className="text-slate-400 text-sm">{fmt(product.price + totalAdjust)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Modifiers */}
        <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {modifiers.map((modifier) => (
            <div key={modifier.id}>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-white font-semibold text-sm">{modifier.name}</p>
                {modifier.required && (
                  <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full font-medium">Required</span>
                )}
                {modifier.multiSelect && (
                  <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">Multi-select</span>
                )}
              </div>
              <div className="space-y-2">
                {modifier.options.map((option) => {
                  const selected = (selections[modifier.id] ?? []).includes(option.id);
                  return (
                    <button
                      key={option.id}
                      onClick={() => toggle(modifier, option)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                        selected
                          ? "bg-orange-500/20 border-orange-500 text-white"
                          : "bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                          selected ? "bg-orange-500 border-orange-500" : "border-slate-500"
                        }`}>
                          {selected && <CheckCircle2 size={12} className="text-white" />}
                        </div>
                        <span className="text-sm font-medium">{option.label}</span>
                      </div>
                      {option.priceAdjust !== 0 && (
                        <span className={`text-sm font-bold ${option.priceAdjust > 0 ? "text-green-400" : "text-red-400"}`}>
                          {option.priceAdjust > 0 ? "+" : ""}{fmt(option.priceAdjust)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Confirm */}
        <div className="p-4 border-t border-slate-700">
          <button
            disabled={!canConfirm()}
            onClick={confirm}
            className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all ${
              canConfirm()
                ? "bg-orange-500 hover:bg-orange-400 text-white active:scale-[0.98]"
                : "bg-slate-700 text-slate-500 cursor-not-allowed"
            }`}
          >
            Add to order · {fmt(product.price + totalAdjust)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Payment Modal ─────────────────────────────────────────────────────────────

function PaymentModal({
  total,
  onClose,
  onComplete,
  currencySymbol,
  isOffline = false,
}: {
  total: number;
  onClose: () => void;
  onComplete: (method: "cash" | "card" | "split", payments: {method:"cash"|"card";amount:number}[], cashTendered?: number) => void;
  currencySymbol: string;
  isOffline?: boolean;
}) {
  type Step = "method" | "cash" | "card" | "split" | "done";
  const [step, setStep] = useState<Step>("method");
  const [cashInput, setCashInput] = useState("");
  const [splitCash, setSplitCash] = useState("");
  const [splitCard, setSplitCard] = useState(total.toFixed(2));

  const QUICK_CASH = [Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 20) * 20].filter((v, i, a) => a.indexOf(v) === i);

  const cashTendered = parseFloat(cashInput) || 0;
  const change = Math.max(0, cashTendered - total);

  function completeCash() {
    onComplete("cash", [{ method: "cash", amount: total }], cashTendered);
  }

  function completeCard() {
    onComplete("card", [{ method: "card", amount: total }]);
  }

  function completeSplit() {
    const cash = parseFloat(splitCash) || 0;
    const card = parseFloat(splitCard) || 0;
    onComplete("split", [{ method: "cash", amount: cash }, { method: "card", amount: card }], cash);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-xs">Amount due</p>
            <p className="text-white font-bold text-2xl">{fmt(total, currencySymbol)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 transition-colors">
            <X size={20} />
          </button>
        </div>

        {step === "method" && (
          <div className="p-5 space-y-3">
            <p className="text-slate-400 text-sm mb-4">Choose payment method</p>
            {isOffline && (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 mb-1">
                <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
                <p className="text-amber-300 text-xs">Offline — card payments unavailable</p>
              </div>
            )}
            <button
              onClick={() => setStep("cash")}
              className="w-full flex items-center gap-4 p-4 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 hover:border-green-500/50 rounded-xl transition-all group"
            >
              <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center group-hover:bg-green-500/30 transition-colors">
                <Banknote size={20} className="text-green-400" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">Cash</p>
                <p className="text-slate-400 text-xs">Calculate change</p>
              </div>
              <ChevronRight size={16} className="text-slate-500 ml-auto" />
            </button>
            <button
              disabled={isOffline}
              onClick={() => !isOffline && setStep("card")}
              className={`w-full flex items-center gap-4 p-4 border rounded-xl transition-all group ${
                isOffline
                  ? "bg-slate-800/40 border-slate-700 opacity-50 cursor-not-allowed"
                  : "bg-slate-700/60 hover:bg-slate-700 border-slate-600 hover:border-blue-500/50"
              }`}
            >
              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                <CreditCard size={20} className="text-blue-400" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">Card</p>
                <p className="text-slate-400 text-xs">{isOffline ? "Requires internet" : "Tap, chip or swipe"}</p>
              </div>
              <ChevronRight size={16} className="text-slate-500 ml-auto" />
            </button>
            <button
              disabled={isOffline}
              onClick={() => !isOffline && setStep("split")}
              className={`w-full flex items-center gap-4 p-4 border rounded-xl transition-all group ${
                isOffline
                  ? "bg-slate-800/40 border-slate-700 opacity-50 cursor-not-allowed"
                  : "bg-slate-700/60 hover:bg-slate-700 border-slate-600 hover:border-purple-500/50"
              }`}
            >
              <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                <Shuffle size={20} className="text-purple-400" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">Split</p>
                <p className="text-slate-400 text-xs">{isOffline ? "Requires internet" : "Cash + card"}</p>
              </div>
              <ChevronRight size={16} className="text-slate-500 ml-auto" />
            </button>
          </div>
        )}

        {step === "cash" && (
          <div className="p-5">
            <button onClick={() => setStep("method")} className="text-slate-400 hover:text-white text-sm mb-5 flex items-center gap-1">← Back</button>
            <p className="text-slate-400 text-xs mb-2">Cash tendered</p>
            <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 mb-4 flex items-center gap-2">
              <span className="text-slate-500 text-xl font-bold">{currencySymbol}</span>
              <input
                type="number"
                step="0.01"
                min={total}
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder={total.toFixed(2)}
                autoFocus
                className="flex-1 bg-transparent text-white text-2xl font-bold outline-none placeholder-slate-600"
              />
            </div>
            <div className="flex gap-2 mb-5">
              {QUICK_CASH.map((v) => (
                <button key={v} onClick={() => setCashInput(v.toFixed(2))}
                  className="flex-1 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors">
                  {fmt(v, currencySymbol)}
                </button>
              ))}
              <button onClick={() => setCashInput(total.toFixed(2))}
                className="flex-1 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors">
                Exact
              </button>
            </div>
            {cashTendered >= total && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
                <span className="text-green-400 font-semibold text-sm">Change</span>
                <span className="text-green-400 font-bold text-xl">{fmt(change, currencySymbol)}</span>
              </div>
            )}
            <button
              disabled={cashTendered < total}
              onClick={completeCash}
              className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all ${cashTendered >= total ? "bg-green-500 hover:bg-green-400 text-white active:scale-[0.98]" : "bg-slate-700 text-slate-500 cursor-not-allowed"}`}
            >
              {cashTendered >= total ? `Confirm Cash · Change ${fmt(change, currencySymbol)}` : "Enter amount"}
            </button>
          </div>
        )}

        {step === "card" && (
          <div className="p-5">
            <button onClick={() => setStep("method")} className="text-slate-400 hover:text-white text-sm mb-5 flex items-center gap-1">← Back</button>
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CreditCard size={36} className="text-blue-400" />
              </div>
              <p className="text-white font-bold text-lg mb-1">Present card to terminal</p>
              <p className="text-slate-400 text-sm">Tap, insert or swipe to collect</p>
              <p className="text-2xl font-bold text-blue-400 mt-4">{fmt(total, currencySymbol)}</p>
            </div>
            <button
              onClick={completeCard}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-blue-500 hover:bg-blue-400 text-white transition-all active:scale-[0.98]"
            >
              Payment Received · {fmt(total, currencySymbol)}
            </button>
          </div>
        )}

        {step === "split" && (
          <div className="p-5">
            <button onClick={() => setStep("method")} className="text-slate-400 hover:text-white text-sm mb-5 flex items-center gap-1">← Back</button>
            <p className="text-slate-400 text-sm mb-4">Split {fmt(total, currencySymbol)} between cash and card</p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Cash amount</label>
                <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 flex items-center gap-2">
                  <Banknote size={16} className="text-green-400" />
                  <input type="number" step="0.01" min={0} max={total}
                    value={splitCash} onChange={(e) => { setSplitCash(e.target.value); setSplitCard((total - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                    placeholder="0.00" className="flex-1 bg-transparent text-white font-bold text-lg outline-none placeholder-slate-600" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Card amount</label>
                <div className="bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 flex items-center gap-2">
                  <CreditCard size={16} className="text-blue-400" />
                  <input type="number" step="0.01" min={0} max={total}
                    value={splitCard} onChange={(e) => { setSplitCard(e.target.value); setSplitCash((total - (parseFloat(e.target.value) || 0)).toFixed(2)); }}
                    placeholder="0.00" className="flex-1 bg-transparent text-white font-bold text-lg outline-none placeholder-slate-600" />
                </div>
              </div>
            </div>
            {Math.abs((parseFloat(splitCash) || 0) + (parseFloat(splitCard) || 0) - total) < 0.01 && (
              <button onClick={completeSplit} className="w-full py-3.5 rounded-xl font-bold text-sm bg-purple-500 hover:bg-purple-400 text-white transition-all active:scale-[0.98]">
                Confirm Split Payment
              </button>
            )}
            {Math.abs((parseFloat(splitCash) || 0) + (parseFloat(splitCard) || 0) - total) >= 0.01 && (
              <p className="text-center text-amber-400 text-xs">
                Total must equal {fmt(total, currencySymbol)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Receipt HTML builder (used for both display and email) ────────────────────

function buildReceiptHtml(sale: POSSale, settings: POSSettings, restaurantNameOverride?: string): string {
  const sym = settings.currencySymbol;
  const restaurantName = (restaurantNameOverride || settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant").toUpperCase();
  const taxRate      = sale.taxRate      ?? settings.taxRate;
  const taxInclusive = sale.taxInclusive ?? settings.taxInclusive;
  const vatLabel     = taxInclusive ? `VAT (${taxRate}% incl.)` : `VAT (${taxRate}%)`;
  const vatSign      = taxInclusive ? "" : "+";

  const row = (l: string, r: string, bold = false, color = "#374151") =>
    `<tr><td style="padding:1px 0;color:${color};${bold?"font-weight:700;":""}font-size:12px">${l}</td><td style="padding:1px 0;color:${color};${bold?"font-weight:700;":""}font-size:12px;text-align:right">${r}</td></tr>`;

  const itemsHtml = sale.items.map((item) => {
    const mods = item.modifiers.map((m) => `<div style="font-size:11px;color:#6b7280;padding-left:8px">+ ${m.optionLabel}</div>`).join("");
    const note = item.note ? `<div style="font-size:11px;color:#f97316;padding-left:8px;font-style:italic">"${item.note}"</div>` : "";
    return `<tr><td style="padding:2px 0;font-size:12px">${item.name} ×${item.quantity}${mods}${note}</td><td style="padding:2px 0;font-size:12px;text-align:right">${sym}${(item.price * item.quantity).toFixed(2)}</td></tr>`;
  }).join("");

  let paymentHtml = "";
  if (sale.paymentMethod === "split") {
    paymentHtml = sale.payments.map((p) =>
      `<tr><td style="font-size:11px;color:#6b7280;text-transform:capitalize">${p.method}</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${p.amount.toFixed(2)}</td></tr>`
    ).join("");
  } else if (sale.paymentMethod === "cash") {
    paymentHtml = `<tr><td style="font-size:11px;color:#6b7280">Cash</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${(sale.cashTendered ?? sale.total).toFixed(2)}</td></tr>`;
    if ((sale.changeGiven ?? 0) > 0) {
      paymentHtml += `<tr><td style="font-size:11px;color:#6b7280">Change</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${sale.changeGiven!.toFixed(2)}</td></tr>`;
    }
  } else {
    paymentHtml = `<tr><td style="font-size:11px;color:#6b7280;text-transform:capitalize">${sale.paymentMethod}</td><td style="font-size:11px;color:#6b7280;text-align:right">${sym}${sale.total.toFixed(2)}</td></tr>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f9fafb;font-family:monospace">
<div style="max-width:360px;margin:24px auto;background:#fff;border-radius:12px;padding:24px">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-weight:700;font-size:16px;letter-spacing:1px">${restaurantName}</div>
    ${settings.receiptPhone ? `<div style="font-size:11px;color:#6b7280">${settings.receiptPhone}</div>` : ""}
    ${settings.receiptWebsite ? `<div style="font-size:11px;color:#6b7280">${settings.receiptWebsite}</div>` : ""}
    <div style="font-size:11px;color:#6b7280">${new Date(sale.date).toLocaleString("en-GB")}</div>
    <div style="font-size:11px;color:#6b7280">Receipt #${sale.receiptNo}</div>
    ${sale.staffName ? `<div style="font-size:11px;color:#6b7280">Served by: ${sale.staffName}</div>` : ""}
    ${sale.customerName ? `<div style="font-size:11px;color:#6b7280">Customer: ${sale.customerName}</div>` : ""}
    ${settings.receiptVatNumber ? `<div style="font-size:10px;color:#9ca3af">VAT No: ${settings.receiptVatNumber}</div>` : ""}
  </div>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">
    ${row("Subtotal", `${sym}${sale.subtotal.toFixed(2)}`)}
    ${sale.discountAmount > 0 ? row(`Discount${sale.discountNote ? ` (${sale.discountNote})` : ""}`, `-${sym}${sale.discountAmount.toFixed(2)}`, false, "#16a34a") : ""}
    ${sale.taxAmount > 0 ? row(vatLabel, `${vatSign}${sym}${sale.taxAmount.toFixed(2)}`, false, "#6b7280") : ""}
    ${sale.tipAmount > 0 ? row("Tip", `${sym}${sale.tipAmount.toFixed(2)}`) : ""}
    ${row("TOTAL", `${sym}${sale.total.toFixed(2)}`, true)}
    ${paymentHtml}
  </table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  ${settings.receiptThankYouMessage ? `<div style="text-align:center;font-weight:600;color:#374151;font-size:12px;margin-bottom:4px">${settings.receiptThankYouMessage}</div>` : ""}
  ${settings.receiptCustomMessage ? `<div style="text-align:center;color:#6b7280;font-size:11px">${settings.receiptCustomMessage}</div>` : ""}
</div></body></html>`;
}

// ─── Receipt Modal ─────────────────────────────────────────────────────────────

function ReceiptModal({ sale, onClose }: { sale: POSSale; onClose: () => void }) {
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
  const taxRate      = sale.taxRate      ?? settings.taxRate;
  const taxInclusive = sale.taxInclusive ?? settings.taxInclusive;
  const vatLabel     = taxInclusive
    ? `VAT (${taxRate}% incl.)`
    : `VAT (${taxRate}%)`;
  const vatSign = taxInclusive ? "" : "+";

  async function sendEmail() {
    if (!emailTo.trim()) return;
    setEmailStatus("sending");
    setEmailError("");
    try {
      const html = buildReceiptHtml(sale, settings, effectiveName);
      const fromName = settings.smtpFromName?.trim() || effectiveName;
      const subject  = `Your receipt from ${fromName} — #${sale.receiptNo}`;
      // SMTP credentials are read from server-side env vars in /api/email
      const res = await fetch("/api/email", {
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
      <div className="bg-white rounded-2xl w-full max-w-xs overflow-hidden shadow-2xl">
        <div className="p-6 font-mono text-gray-900 text-xs">

          {/* ── Header ───────────────────────────────────────── */}
          <div className="text-center mb-4">
            <p className="font-bold text-base">{restaurantName}</p>
            {settings.receiptPhone && <p className="text-gray-500">{settings.receiptPhone}</p>}
            {settings.receiptWebsite && <p className="text-gray-500">{settings.receiptWebsite}</p>}
            <p className="text-gray-500">{fmtDate(sale.date)} · {fmtTime(sale.date)}</p>
            <p className="text-gray-500">Receipt #{sale.receiptNo}</p>
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
          {sale.taxAmount > 0 && (
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

          <div className="flex justify-between font-bold text-base mt-2 pt-2 border-t border-gray-300">
            <span>TOTAL</span><span>{fmt(sale.total, sym)}</span>
          </div>

          {/* ── Payment breakdown ─────────────────────────────── */}
          <div className="mt-1 space-y-0.5">
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
            ) : (
              <div className="flex justify-between text-gray-500 capitalize">
                <span>{sale.paymentMethod}</span><span>{fmt(sale.total, sym)}</span>
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
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-gray-900 text-xs outline-none focus:border-orange-400 placeholder-gray-400"
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

// ─── Order Panel ──────────────────────────────────────────────────────────────

function OrderPanel({
  onCharge,
  onSelectCustomer,
  onOpenDiscount,
  onOpenTip,
}: {
  onCharge: () => void;
  onSelectCustomer: () => void;
  onOpenDiscount: () => void;
  onOpenTip: () => void;
}) {
  const {
    cart, updateCartQty, removeFromCart, clearCart,
    subtotal, discountAmount, taxAmount, grandTotal, tipAmount,
    discount, settings, assignedCustomer, currentStaff,
  } = usePOS();

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700/50">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingCart size={16} className="text-orange-400" />
          <span className="text-white font-bold text-sm">Current Order</span>
          {cart.length > 0 && (
            <span className="bg-orange-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
              {cart.reduce((s, l) => s + l.quantity, 0)}
            </span>
          )}
        </div>
        {cart.length > 0 && (
          <button onClick={clearCart} className="text-slate-500 hover:text-red-400 transition-colors p-1">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Customer */}
      <button
        onClick={onSelectCustomer}
        className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
      >
        <Users size={14} className="text-slate-400" />
        <span className={`text-sm flex-1 text-left ${assignedCustomer ? "text-white font-medium" : "text-slate-400"}`}>
          {assignedCustomer ? assignedCustomer.name : "Assign customer"}
        </span>
        {assignedCustomer ? (
          <span className="text-xs text-amber-400 font-semibold flex items-center gap-1">
            <Star size={10} /> {assignedCustomer.loyaltyPoints}pts
          </span>
        ) : (
          <ChevronRight size={14} className="text-slate-500" />
        )}
      </button>

      {/* Items */}
      <div className="flex-1 overflow-y-auto mt-3">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <ShoppingCart size={40} className="text-slate-700 mb-3" />
            <p className="text-slate-500 text-sm font-medium">No items added</p>
            <p className="text-slate-600 text-xs mt-1">Tap items to add to order</p>
          </div>
        ) : (
          <ul className="space-y-1 px-3">
            {cart.map((item) => (
              <li key={item.lineId} className={`rounded-xl p-3 border ${item.offer?.active ? "bg-amber-500/5 border-amber-500/30" : "bg-slate-800/60 border-slate-700/50"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold leading-snug truncate">{item.name}</p>
                    {item.modifiers.map((m) => (
                      <p key={m.optionId} className="text-slate-400 text-xs mt-0.5">+ {m.optionLabel}</p>
                    ))}
                    {item.note && <p className="text-orange-400 text-xs italic mt-0.5">&ldquo;{item.note}&rdquo;</p>}
                    {/* Offer savings badge */}
                    {(() => { const saving = cartLineSaving(item); return saving > 0 ? (
                      <p className="text-amber-400 text-[10px] font-semibold mt-0.5">
                        Save {fmt(saving, settings.currencySymbol)} offer applied
                      </p>
                    ) : null; })()}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {(() => {
                      const total = cartLineTotal(item);
                      const full  = item.price * item.quantity;
                      return total < full ? (
                        <>
                          <p className="text-amber-400 font-bold text-sm">{fmt(total, settings.currencySymbol)}</p>
                          <p className="text-slate-500 text-xs line-through">{fmt(full, settings.currencySymbol)}</p>
                        </>
                      ) : (
                        <p className="text-white font-bold text-sm">{fmt(full, settings.currencySymbol)}</p>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-slate-500 text-xs">{fmt(item.price, settings.currencySymbol)} each</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateCartQty(item.lineId, item.quantity - 1)}
                      className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-red-500/30 text-slate-300 hover:text-red-400 flex items-center justify-center transition-all active:scale-95"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="text-white text-sm font-bold w-5 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateCartQty(item.lineId, item.quantity + 1)}
                      className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-orange-500/30 text-slate-300 hover:text-orange-400 flex items-center justify-center transition-all active:scale-95"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Totals + Actions */}
      {cart.length > 0 && (
        <div className="border-t border-slate-700/50 p-4 space-y-3">
          {/* Action row */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onOpenDiscount}
              disabled={!currentStaff?.permissions.canApplyDiscount}
              title={!currentStaff?.permissions.canApplyDiscount ? "Manager or Admin required" : undefined}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                !currentStaff?.permissions.canApplyDiscount
                  ? "bg-slate-800/40 text-slate-600 border border-slate-700/40 cursor-not-allowed"
                  : discount.pct > 0
                    ? "bg-green-500/20 text-green-400 border border-green-500/40"
                    : "bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600"
              }`}
            >
              <Percent size={12} />
              {discount.pct > 0 ? `${discount.pct}% off` : "Discount"}
            </button>
            <button
              onClick={onOpenTip}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                tipAmount > 0
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                  : "bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600"
              }`}
            >
              <BadgeDollarSign size={12} />
              {tipAmount > 0 ? fmt(tipAmount, settings.currencySymbol) : "Tip"}
            </button>
          </div>

          {/* Totals */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm text-slate-400">
              <span>Subtotal</span><span>{fmt(subtotal, settings.currencySymbol)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm text-green-400">
                <span>Discount ({discount.pct}%)</span><span>-{fmt(discountAmount, settings.currencySymbol)}</span>
              </div>
            )}
            {settings.taxInclusive && taxAmount > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>VAT ({settings.taxRate}% incl.)</span><span>{fmt(taxAmount, settings.currencySymbol)}</span>
              </div>
            )}
            {!settings.taxInclusive && taxAmount > 0 && (
              <div className="flex justify-between text-sm text-slate-400">
                <span>VAT ({settings.taxRate}%)</span><span>+{fmt(taxAmount, settings.currencySymbol)}</span>
              </div>
            )}
            {tipAmount > 0 && (
              <div className="flex justify-between text-sm text-amber-400">
                <span>Tip</span><span>{fmt(tipAmount, settings.currencySymbol)}</span>
              </div>
            )}
            <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-slate-700">
              <span>Total</span><span>{fmt(grandTotal, settings.currencySymbol)}</span>
            </div>
          </div>

          {/* Charge button */}
          <button
            onClick={onCharge}
            className="w-full py-4 rounded-xl bg-orange-500 hover:bg-orange-400 active:scale-[0.98] text-white font-bold text-base transition-all flex items-center justify-between px-4 shadow-lg shadow-orange-500/30"
          >
            <span className="flex items-center gap-2"><CreditCard size={18} /> Charge</span>
            <span>{fmt(grandTotal, settings.currencySymbol)}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sale View ────────────────────────────────────────────────────────────────

function SaleView({ isOffline = false }: { isOffline?: boolean }) {
  const { products, categories, addToCart, settings } = usePOS();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [modifierProduct, setModifierProduct] = useState<POSProduct | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [completedSale, setCompletedSale] = useState<POSSale | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const { completeSale, grandTotal, discount, setDiscount, tipAmount, setTipAmount, settings: s, customers, assignedCustomer, setAssignedCustomer } = usePOS();
  const [discountInput, setDiscountInput] = useState(discount.pct.toString());
  const [discountNote, setDiscountNote] = useState(discount.note);
  const [tipCustom, setTipCustom] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  const sortedCats = [...categories].sort((a, b) => a.order - b.order);
  const filtered = products.filter((p) => {
    if (!p.active) return false;
    if (activeCategory !== "all" && p.categoryId !== activeCategory) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function handleProductTap(product: POSProduct) {
    if (product.modifiers && product.modifiers.length > 0) {
      setModifierProduct(product);
    } else {
      addToCart(product, []);
    }
  }

  function handleCharge() { setShowPayment(true); }

  function handlePaymentComplete(method: "cash"|"card"|"split", payments: {method:"cash"|"card";amount:number}[], cashTendered?: number) {
    const sale = completeSale(method, payments, cashTendered);
    setShowPayment(false);
    setCompletedSale(sale);
  }

  const filteredCustomers = customers.filter((c) =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone?.includes(customerSearch) || c.email?.toLowerCase().includes(customerSearch.toLowerCase())
  );

  return (
    <div className="flex h-full">
      {/* Modifier modal */}
      {modifierProduct && (
        <ModifierModal
          product={modifierProduct}
          currencySymbol={settings.currencySymbol}
          onConfirm={(mods) => { addToCart(modifierProduct, mods); setModifierProduct(null); }}
          onClose={() => setModifierProduct(null)}
        />
      )}

      {/* Payment modal */}
      {showPayment && (
        <PaymentModal
          total={grandTotal}
          currencySymbol={settings.currencySymbol}
          onClose={() => setShowPayment(false)}
          onComplete={handlePaymentComplete}
          isOffline={isOffline}
        />
      )}

      {/* Receipt modal */}
      {completedSale && (
        <ReceiptModal sale={completedSale} onClose={() => setCompletedSale(null)} />
      )}

      {/* Discount modal */}
      {showDiscount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Apply Discount</h3>
              <button onClick={() => setShowDiscount(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-slate-400 text-xs mb-2">Discount percentage</p>
            <div className="flex gap-2 mb-4">
              {[5,10,15,20,25,50].map((v) => (
                <button key={v} onClick={() => setDiscountInput(v.toString())}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${discountInput === v.toString() ? "bg-orange-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                  {v}%
                </button>
              ))}
            </div>
            <input type="number" min={0} max={s.maxDiscountPercent} value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-lg font-bold outline-none focus:border-orange-500 mb-3" placeholder="Custom %" />
            <input type="text" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 mb-5" placeholder="Reason (optional)" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setDiscount({ pct: 0, note: "" }); setDiscountInput("0"); setDiscountNote(""); setShowDiscount(false); }}
                className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">
                Clear
              </button>
              <button onClick={() => { setDiscount({ pct: parseFloat(discountInput) || 0, note: discountNote }); setShowDiscount(false); }}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tip modal */}
      {showTip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Add Tip</h3>
              <button onClick={() => setShowTip(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {s.defaultTipOptions.map((pct) => {
                const amt = (grandTotal - tipAmount) * (pct / 100);
                return (
                  <button key={pct} onClick={() => setTipAmount(parseFloat(amt.toFixed(2)))}
                    className={`py-3 rounded-xl text-sm font-bold transition-all ${tipAmount === parseFloat(amt.toFixed(2)) ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                    {pct}% · {fmt(amt, s.currencySymbol)}
                  </button>
                );
              })}
            </div>
            <input type="number" step="0.01" min={0} value={tipCustom} onChange={(e) => setTipCustom(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-lg font-bold outline-none focus:border-amber-500 mb-5" placeholder="Custom amount" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setTipAmount(0); setTipCustom(""); setShowTip(false); }}
                className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">
                No Tip
              </button>
              <button onClick={() => { if (tipCustom) setTipAmount(parseFloat(tipCustom) || 0); setShowTip(false); }}
                className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm transition-colors">
                Apply Tip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer selector */}
      {showCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-white font-bold">Select Customer</h3>
              <button onClick={() => setShowCustomer(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-3">
              <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search by name or phone..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
            </div>
            <div className="max-h-72 overflow-y-auto">
              <button onClick={() => { setAssignedCustomer(null); setShowCustomer(false); }}
                className="w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-700/50 transition-colors text-left border-b border-slate-700/50">
                <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center text-slate-300"><Users size={14} /></div>
                <p className="text-slate-400 text-sm">No customer (walk-in)</p>
              </button>
              {filteredCustomers.map((c) => (
                <button key={c.id} onClick={() => { setAssignedCustomer(c); setShowCustomer(false); }}
                  className={`w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-700/50 transition-colors text-left ${assignedCustomer?.id === c.id ? "bg-orange-500/10" : ""}`}>
                  <div className="w-9 h-9 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">
                    {getInitials(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{c.name}</p>
                    <p className="text-slate-400 text-xs">{c.phone ?? c.email ?? "No contact"} · {c.loyaltyPoints}pts</p>
                  </div>
                  {c.tags.includes("VIP") && <Star size={12} className="text-amber-400 flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Left: Catalogue */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Category + Search bar */}
        <div className="bg-slate-900/80 border-b border-slate-700/50 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="bg-slate-900/50 border-b border-slate-700/30 px-4 py-2 flex gap-2 overflow-x-auto scrollbar-hide flex-shrink-0">
          <button
            onClick={() => setActiveCategory("all")}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${activeCategory === "all" ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
          >
            All
          </button>
          {sortedCats.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${activeCategory === cat.id ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
            >
              {cat.emoji} {cat.name}
            </button>
          ))}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
              <Package size={36} className="mb-3 text-slate-700" />
              <p className="text-sm">No items found</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map((product) => {
                const outOfStock = product.trackStock && (product.stockQty ?? 0) <= 0;
                const offerPrice = getOfferPrice(product);
                const hasOffer = isOfferActive(product);
                const offerBadgeText = (() => {
                  const o = product.offer!;
                  if (o?.label?.trim()) return o.label.trim();
                  switch (o?.type) {
                    case "percent":      return `${o.value}% OFF`;
                    case "fixed":        return `${settings.currencySymbol}${o.value} OFF`;
                    case "price":        return "SPECIAL";
                    case "bogo":         return `BUY ${o.buyQty ?? 1} GET ${o.freeQty ?? 1} FREE`;
                    case "multibuy":     return `${o.buyQty ?? 2} FOR ${settings.currencySymbol}${o.value}`;
                    case "qty_discount": return `${o.minQty ?? 2}+ GET ${o.value}% OFF`;
                    default: return "OFFER";
                  }
                });
                return (
                  <button
                    key={product.id}
                    onClick={() => !outOfStock && handleProductTap(product)}
                    disabled={outOfStock}
                    className={`relative flex flex-col items-start rounded-2xl border text-left transition-all active:scale-95 overflow-hidden ${
                      outOfStock
                        ? "bg-slate-800/30 border-slate-700/30 opacity-50 cursor-not-allowed"
                        : hasOffer
                          ? "bg-slate-800 border-amber-500/50 hover:border-amber-400/70 hover:shadow-lg hover:shadow-amber-500/10"
                          : "bg-slate-800 border-slate-700/50 hover:border-orange-500/60 hover:shadow-lg hover:shadow-orange-500/10"
                    }`}
                  >
                    {/* Image or emoji tile */}
                    {product.imageUrl ? (
                      <div className="w-full aspect-[4/3] relative flex-shrink-0 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        {outOfStock && (
                          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center">
                            <span className="text-[10px] text-white font-bold">Out of stock</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-full p-4 pb-0">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                          style={{ backgroundColor: product.color }}
                        >
                          {product.emoji ?? "🍽️"}
                        </div>
                      </div>
                    )}

                    {/* Offer badge */}
                    {hasOffer && (
                      <span className="absolute top-2 left-2 text-[9px] bg-amber-400 text-slate-900 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide leading-none">
                        {offerBadgeText()}
                      </span>
                    )}

                    {!hasOffer && product.popular && (
                      <span className="absolute top-2 left-2 text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">
                        Popular
                      </span>
                    )}

                    <div className="p-3 w-full">
                      <p className="text-white text-xs font-semibold leading-snug mb-1 line-clamp-2">{product.name}</p>
                      <div className="flex items-center justify-between gap-1">
                        {/* Simple per-unit offer: show discounted + strikethrough */}
                        {offerPrice !== null ? (
                          <div className="flex items-baseline gap-1.5">
                            <p className="text-amber-400 font-bold text-sm">{fmt(offerPrice, settings.currencySymbol)}</p>
                            <p className="text-slate-500 text-xs line-through">{fmt(product.price, settings.currencySymbol)}</p>
                          </div>
                        ) : (
                          <p className={`font-bold text-sm ${hasOffer ? "text-amber-400" : "text-orange-400"}`}>
                            {fmt(product.price, settings.currencySymbol)}
                          </p>
                        )}
                        {product.modifiers && product.modifiers.length > 0 && !outOfStock && (
                          <ChevronRight size={12} className="text-slate-500 flex-shrink-0" />
                        )}
                      </div>
                      {product.trackStock && product.stockQty !== undefined && (
                        <p className={`text-[10px] mt-0.5 ${product.stockQty <= 3 ? "text-red-400" : "text-slate-500"}`}>
                          {outOfStock ? "Out of stock" : `Stock: ${product.stockQty}`}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: Order panel */}
      <div className="w-80 xl:w-96 flex-shrink-0">
        <OrderPanel
          onCharge={handleCharge}
          onSelectCustomer={() => setShowCustomer(true)}
          onOpenDiscount={() => setShowDiscount(true)}
          onOpenTip={() => setShowTip(true)}
        />
      </div>
    </div>
  );
}

// ─── Dashboard View ────────────────────────────────────────────────────────────

// ─── Dashboard / Reports helpers ─────────────────────────────────────────────

type POSPeriod = "today" | "yesterday" | "week" | "month" | "last30" | "custom";

const POS_PERIODS: { id: POSPeriod; label: string }[] = [
  { id: "today",     label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week",      label: "This Week" },
  { id: "month",     label: "This Month" },
  { id: "last30",    label: "Last 30 Days" },
  { id: "custom",    label: "Custom" },
];

function getPOSDateRange(period: POSPeriod, customStart: string, customEnd: string): [Date, Date] {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "today":     return [today, now];
    case "yesterday": {
      const y  = new Date(today); y.setDate(y.getDate() - 1);
      const ye = new Date(today); ye.setMilliseconds(-1);
      return [y, ye];
    }
    case "week":  { const w = new Date(today); w.setDate(w.getDate() - 6); return [w, now]; }
    case "month": return [new Date(today.getFullYear(), today.getMonth(), 1), now];
    case "last30":{ const l = new Date(today); l.setDate(l.getDate() - 29); return [l, now]; }
    case "custom": return [
      customStart ? new Date(customStart)              : new Date(0),
      customEnd   ? new Date(customEnd + "T23:59:59")  : now,
    ];
  }
}

function posDailyBuckets(sales: POSSale[], start: Date, end: Date) {
  const map: Record<string, number> = {};
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay  = new Date(end.getFullYear(),  end.getMonth(),   end.getDate());
  while (cursor <= endDay) {
    map[cursor.toDateString()] = 0;
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const s of sales) {
    const key = new Date(s.date).toDateString();
    if (key in map) map[key] = (map[key] ?? 0) + s.total;
  }
  return Object.entries(map).map(([key, revenue]) => ({
    label:   new Date(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    revenue,
  }));
}

function posHourlyBuckets(sales: POSSale[]) {
  const map: number[] = Array(24).fill(0);
  for (const s of sales) map[new Date(s.date).getHours()] += s.total;
  return map;
}

function posExportCSV(sales: POSSale[], sym: string) {
  const header = ["Receipt No","Date","Time","Staff","Customer","Items","Subtotal","Discount","VAT","Tip","Total","Payment","Voided","Void Reason"].join(",");
  const rows = sales.map((s) => [
    s.receiptNo, fmtDate(s.date), fmtTime(s.date),
    `"${s.staffName}"`, `"${s.customerName ?? ""}"`,
    s.items.length, s.subtotal.toFixed(2), s.discountAmount.toFixed(2),
    s.taxAmount.toFixed(2), s.tipAmount.toFixed(2), s.total.toFixed(2),
    s.paymentMethod, s.voided ? "Yes" : "No", `"${s.voidReason ?? ""}"`,
  ].join(","));
  const csv  = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `pos-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Dine-in order type (from Supabase orders table) ─────────────────────────

interface DineInOrder {
  id: string;
  tableLabel: string;
  staffName: string;
  covers: number;
  items: { name: string; qty: number; price: number }[];
  total: number;
  status: string;
  paymentMethod: string;
  date: string;
}

function buildDineInReceiptHtml(order: DineInOrder, settings: POSSettings, restaurantNameOverride?: string): string {
  const name = (restaurantNameOverride || settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant").toUpperCase();
  const itemsHtml = order.items.map((it) =>
    `<tr><td style="padding:2px 0;font-size:12px">${it.name} ×${it.qty}</td><td style="padding:2px 0;font-size:12px;text-align:right">£${(it.price * it.qty).toFixed(2)}</td></tr>`
  ).join("");
  const payLabel = order.paymentMethod === "cash" ? "Cash" : order.paymentMethod === "card" ? "Card" : "Table Service";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f9fafb;font-family:monospace">
<div style="max-width:320px;margin:24px auto;background:#fff;border-radius:12px;padding:24px">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-weight:700;font-size:16px;letter-spacing:1px">${name}</div>
    ${settings.receiptPhone ? `<div style="font-size:11px;color:#6b7280">${settings.receiptPhone}</div>` : ""}
    <div style="font-size:11px;color:#6b7280">${new Date(order.date).toLocaleString("en-GB")}</div>
    <div style="font-size:11px;color:#6b7280">Table: ${order.tableLabel}</div>
    <div style="font-size:11px;color:#6b7280">Served by: ${order.staffName}</div>
    ${order.covers > 0 ? `<div style="font-size:11px;color:#6b7280">${order.covers} cover${order.covers !== 1 ? "s" : ""}</div>` : ""}
    ${settings.receiptVatNumber ? `<div style="font-size:10px;color:#9ca3af">VAT No: ${settings.receiptVatNumber}</div>` : ""}
  </div>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="font-size:13px;font-weight:700">TOTAL</td><td style="font-size:13px;font-weight:700;text-align:right">£${order.total.toFixed(2)}</td></tr>
    <tr><td style="font-size:11px;color:#6b7280">Payment</td><td style="font-size:11px;color:#6b7280;text-align:right">${payLabel}</td></tr>
  </table>
  <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0">
  ${settings.receiptThankYouMessage ? `<div style="text-align:center;font-weight:600;font-size:12px">${settings.receiptThankYouMessage}</div>` : ""}
</div></body></html>`;
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

function DashboardView() {
  const { sales, products, settings, voidSale, currentStaff } = usePOS();
  const { settings: appSettings } = useApp();
  const sym = settings.currencySymbol;

  // Top-level tab
  const [dashTab, setDashTab] = useState<"overview" | "reports" | "dine-in">("overview");

  // Void + refund modal (POS sales)
  const [voidTarget,      setVoidTarget]      = useState<string | null>(null);
  const [voidReason,      setVoidReason]      = useState("");
  const [refundMethod,    setRefundMethod]    = useState<"cash" | "card" | "none">("cash");
  const [refundAmount,    setRefundAmount]    = useState("");

  // Dine-in void / refund
  const [diAction,         setDiAction]         = useState<{ mode: "void" | "refund"; order: DineInOrder } | null>(null);
  const [diActionReason,   setDiActionReason]   = useState("");
  const [diRefundType,     setDiRefundType]     = useState<"full" | "partial">("full");
  const [diRefundAmtStr,   setDiRefundAmtStr]   = useState("");
  const [diRefundMethod,   setDiRefundMethod]   = useState<"cash" | "card">("cash");
  const [diActionLoading,  setDiActionLoading]  = useState(false);
  const [diActionError,    setDiActionError]    = useState<string | null>(null);

  // ── Dine-in orders (fetched from Supabase) ─────────────────────────────────
  const [dineInOrders,     setDineInOrders]     = useState<DineInOrder[]>([]);
  const [dineInLoading,    setDineInLoading]    = useState(false);
  const [dineInEmail,      setDineInEmail]      = useState<Record<string, string>>({});
  const [dineInEmailSt,    setDineInEmailSt]    = useState<Record<string, "idle"|"sending"|"sent"|"error">>({});
  const [dineInPrintId,    setDineInPrintId]    = useState<string | null>(null);

  // ── Today's dine-in: always-loaded for Overview KPIs ───────────────────────
  const [todayDineIn,      setTodayDineIn]      = useState<DineInOrder[]>([]);

  // ── Reports dine-in: all settled dine-in orders for the selected period ─────
  const [reportsDineIn,    setReportsDineIn]    = useState<DineInOrder[]>([]);
  const [reportsDineInLoading, setReportsDineInLoading] = useState(false);

  // Shared row mapper ─────────────────────────────────────────────────────────
  function mapDineInRow(o: Record<string, unknown>): DineInOrder {
    const n = String(o.note ?? "");
    return {
      id:            o.id as string,
      tableLabel:    n.match(/Table\s+(\S+)/)?.[1] ?? "?",
      staffName:     n.match(/Staff:\s*([^·\n]+)/)?.[1]?.trim() ?? "—",
      covers:        parseInt(n.match(/(\d+)\s+cover/)?.[1] ?? "0"),
      items:         (o.items as DineInOrder["items"]) ?? [],
      total:         Number(o.total),
      status:        o.status as string,
      paymentMethod: (o.payment_method as string) ?? "table-service",
      date:          o.date as string,
    };
  }

  const refreshTodayDineIn = useCallback(async () => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const { data } = await supabase
      .from("orders")
      .select("id, items, total, note, status, payment_method, date")
      .eq("fulfillment", "dine-in")
      .gte("date", todayStart.toISOString())
      .lte("date", todayEnd.toISOString())
      .order("date", { ascending: false });
    setTodayDineIn((data ?? []).map(mapDineInRow));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch today's dine-in on mount
  useEffect(() => { refreshTodayDineIn(); }, [refreshTodayDineIn]);

  const refreshDineInTab = useCallback(async () => {
    setDineInLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("id, items, total, note, status, payment_method, date")
      .eq("fulfillment", "dine-in")
      .order("date", { ascending: false })
      .limit(200);
    setDineInOrders((data ?? []).map(mapDineInRow));
    setDineInLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dashTab !== "dine-in") return;
    refreshDineInTab();
  }, [dashTab, refreshDineInTab]);

  async function sendDineInEmail(order: DineInOrder) {
    const email = dineInEmail[order.id]?.trim();
    if (!email) return;
    setDineInEmailSt((p) => ({ ...p, [order.id]: "sending" }));
    const effectiveName = appSettings.restaurant?.name || settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant";
    const html = buildDineInReceiptHtml(order, settings, effectiveName);
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: email, subject: `Your receipt from ${effectiveName} — Table ${order.tableLabel}`, html }),
    });
    const d = await res.json().catch(() => ({})) as { ok?: boolean };
    setDineInEmailSt((p) => ({ ...p, [order.id]: d.ok ? "sent" : "error" }));
  }

  function printDineInReceipt(order: DineInOrder) {
    const effectiveName = appSettings.restaurant?.name || settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant";
    const html = buildDineInReceiptHtml(order, settings, effectiveName);
    const win = window.open("", "_blank", "width=420,height=650");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    win.onafterprint = () => win.close();
  }

  async function submitDiVoid() {
    if (!diAction || !diActionReason.trim()) { setDiActionError("Please enter a reason."); return; }
    setDiActionLoading(true); setDiActionError(null);
    const res = await fetch("/api/waiter/void", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds: [diAction.order.id], reason: diActionReason.trim(), voidedBy: currentStaff?.name ?? "POS Admin" }),
    });
    const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    setDiActionLoading(false);
    if (d.ok) { setDiAction(null); setDiActionReason(""); refreshDineInTab(); refreshTodayDineIn(); }
    else setDiActionError(d.error ?? "Failed to void order.");
  }

  async function submitDiRefund() {
    if (!diAction || !diActionReason.trim()) { setDiActionError("Please enter a reason."); return; }
    const amt = diRefundType === "full" ? diAction.order.total : parseFloat(diRefundAmtStr);
    if (isNaN(amt) || amt <= 0) { setDiActionError("Enter a valid refund amount."); return; }
    if (amt > diAction.order.total + 0.001) { setDiActionError(`Cannot exceed ${fmt(diAction.order.total, sym)}.`); return; }
    setDiActionLoading(true); setDiActionError(null);
    const res = await fetch("/api/waiter/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds: [diAction.order.id], refundAmount: amt, refundMethod: diRefundMethod, reason: diActionReason.trim(), refundedBy: currentStaff?.name ?? "POS Admin" }),
    });
    const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    setDiActionLoading(false);
    if (d.ok) { setDiAction(null); setDiActionReason(""); setDiRefundAmtStr(""); refreshDineInTab(); refreshTodayDineIn(); }
    else setDiActionError(d.error ?? "Failed to process refund.");
  }

  function openVoidModal(saleId: string) {
    const sale = sales.find((s) => s.id === saleId);
    setVoidTarget(saleId);
    setVoidReason("");
    setRefundMethod(sale?.paymentMethod === "card" ? "card" : "cash");
    setRefundAmount(sale ? sale.total.toFixed(2) : "");
  }

  function confirmVoid() {
    if (!voidTarget || !voidReason.trim()) return;
    const amt = parseFloat(refundAmount);
    voidSale(
      voidTarget,
      voidReason.trim(),
      refundMethod,
      isNaN(amt) ? 0 : amt,
    );
    setVoidTarget(null);
  }

  // ── Overview computations ───────────────────────────────────────────────────
  const today = new Date().toDateString();
  const todaySales = sales.filter((s) => !s.voided && new Date(s.date).toDateString() === today);
  const todayDineInSettled = todayDineIn.filter(o => o.status === "delivered");

  const posRevenue        = todaySales.reduce((sum, s) => sum + s.total, 0);
  const diRevToday        = todayDineInSettled.reduce((sum, o) => sum + o.total, 0);
  const totalRevenue      = posRevenue + diRevToday;
  const totalTransactions = todaySales.length + todayDineInSettled.length;
  const todayAvgOrder     = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
  const totalTips         = todaySales.reduce((sum, s) => sum + s.tipAmount, 0);

  const itemCounts: Record<string, { name: string; count: number; revenue: number }> = {};
  for (const sale of sales.filter((s) => !s.voided)) {
    for (const item of sale.items) {
      if (!itemCounts[item.productId]) itemCounts[item.productId] = { name: item.name, count: 0, revenue: 0 };
      itemCounts[item.productId].count += item.quantity;
      itemCounts[item.productId].revenue += item.price * item.quantity;
    }
  }
  const bestSellersOverview = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 8);

  const last7: { label: string; revenue: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const rev = sales.filter((s) => !s.voided && new Date(s.date).toDateString() === d.toDateString()).reduce((s, x) => s + x.total, 0);
    last7.push({ label: d.toLocaleDateString("en-GB", { weekday: "short" }), revenue: rev });
  }
  const maxRev = Math.max(...last7.map((d) => d.revenue), 1);

  const overviewPayMix = { cash: 0, card: 0, split: 0 };
  for (const s of todaySales) overviewPayMix[s.paymentMethod] = (overviewPayMix[s.paymentMethod] || 0) + 1;
  const overviewPayTotal = totalTransactions || 1;

  const costMap: Record<string, number> = {};
  for (const p of products) if (p.cost) costMap[p.id] = p.cost;
  const totalCostAll = sales.filter((s) => !s.voided).reduce((sum, sale) =>
    sum + sale.items.reduce((s, item) => s + (costMap[item.productId] ?? 0) * item.quantity, 0), 0);
  const totalRevAll  = sales.filter((s) => !s.voided).reduce((s, x) => s + x.total, 0);
  const overviewMargin = totalRevAll > 0 ? ((totalRevAll - totalCostAll) / totalRevAll) * 100 : 0;

  // ── Reports state ───────────────────────────────────────────────────────────
  const [period,      setPeriod]      = useState<POSPeriod>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd,   setCustomEnd]   = useState("");
  type ReportTab = "overview" | "items" | "staff" | "transactions";
  const [reportTab,   setReportTab]   = useState<ReportTab>("overview");
  const [txSearch,    setTxSearch]    = useState("");
  const [sortField,   setSortField]   = useState<"date" | "total">("date");
  const [sortDir,     setSortDir]     = useState<"desc" | "asc">("desc");
  const [showVoided,  setShowVoided]  = useState(false);

  const [startDate, endDate] = useMemo(
    () => getPOSDateRange(period, customStart, customEnd),
    [period, customStart, customEnd],
  );

  const refreshReportsDineIn = useCallback(async () => {
    setReportsDineInLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("id, items, total, note, status, payment_method, date")
      .eq("fulfillment", "dine-in")
      .gte("date", startDate.toISOString())
      .lte("date", endDate.toISOString())
      .order("date", { ascending: false })
      .limit(500);
    setReportsDineIn((data ?? []).map(mapDineInRow));
    setReportsDineInLoading(false);
  }, [startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dashTab !== "reports") return;
    refreshReportsDineIn();
  }, [dashTab, refreshReportsDineIn]);

  // ── Realtime: auto-refresh when a waiter settles a payment ──────────────────
  useEffect(() => {
    const channel = supabase
      .channel("pos-dine-in-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row || row.fulfillment !== "dine-in") return;
          // Always keep today's overview data fresh
          refreshTodayDineIn();
          // Refresh the active tab's data
          if (dashTab === "dine-in") refreshDineInTab();
          if (dashTab === "reports") refreshReportsDineIn();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [dashTab, refreshTodayDineIn, refreshDineInTab, refreshReportsDineIn]);

  const inRange = useMemo(
    () => sales.filter((s) => { const d = new Date(s.date); return d >= startDate && d <= endDate; }),
    [sales, startDate, endDate],
  );
  const rFiltered  = useMemo(() => inRange.filter((s) => !s.voided), [inRange]);
  const voidedCount = inRange.filter((s) => s.voided).length;

  // KPIs
  const rRevenue   = rFiltered.reduce((s, x) => s + x.total, 0);
  const rTax       = rFiltered.reduce((s, x) => s + x.taxAmount, 0);
  const rTips      = rFiltered.reduce((s, x) => s + x.tipAmount, 0);
  const rDiscounts = rFiltered.reduce((s, x) => s + x.discountAmount, 0);
  const rAvgOrder  = rFiltered.length > 0 ? rRevenue / rFiltered.length : 0;
  const rCost      = rFiltered.reduce((sum, sale) =>
    sum + sale.items.reduce((s, item) => s + (costMap[item.productId] ?? 0) * item.quantity, 0), 0);
  const grossProfit = rRevenue - rCost;
  const marginPct   = rRevenue > 0 ? (grossProfit / rRevenue) * 100 : 0;

  // Payment mix (reports)
  const rPayMix = { cash: 0, card: 0, split: 0 };
  for (const s of rFiltered) rPayMix[s.paymentMethod] = (rPayMix[s.paymentMethod] ?? 0) + 1;
  const rPayTotal = rFiltered.length || 1;

  // Charts
  const dailyBuckets  = useMemo(() => posDailyBuckets(rFiltered, startDate, endDate), [rFiltered, startDate, endDate]);
  const maxDaily      = Math.max(...dailyBuckets.map((d) => d.revenue), 1);
  const hourlyBuckets = useMemo(() => posHourlyBuckets(rFiltered), [rFiltered]);
  const maxHourly     = Math.max(...hourlyBuckets, 1);

  // Best sellers (reports)
  const rItemStats: Record<string, { name: string; qty: number; revenue: number }> = {};
  for (const sale of rFiltered) {
    for (const item of sale.items) {
      if (!rItemStats[item.productId]) rItemStats[item.productId] = { name: item.name, qty: 0, revenue: 0 };
      rItemStats[item.productId].qty += item.quantity;
      rItemStats[item.productId].revenue += item.price * item.quantity;
    }
  }
  const rBestSellers = Object.values(rItemStats).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  const maxItemRev   = rBestSellers[0]?.revenue || 1;

  // Staff performance (reports)
  const staffStats: Record<string, { name: string; sales: number; revenue: number }> = {};
  for (const sale of rFiltered) {
    if (!staffStats[sale.staffId]) staffStats[sale.staffId] = { name: sale.staffName, sales: 0, revenue: 0 };
    staffStats[sale.staffId].sales++;
    staffStats[sale.staffId].revenue += sale.total;
  }
  const staffPerf    = Object.values(staffStats).map((s) => ({ ...s, avgOrder: s.sales > 0 ? s.revenue / s.sales : 0 })).sort((a, b) => b.revenue - a.revenue);
  const maxStaffRev  = staffPerf[0]?.revenue || 1;

  // Dine-in stats for reports
  const diSettled        = reportsDineIn.filter(o => o.status === "delivered");
  const diVoided         = reportsDineIn.filter(o => o.status === "cancelled");
  const diRefundedOrders = reportsDineIn.filter(o => o.status === "refunded" || o.status === "partially_refunded");
  const diRevenue        = diSettled.reduce((s, o) => s + o.total, 0);
  const diAvgOrder       = diSettled.length > 0 ? diRevenue / diSettled.length : 0;
  const diPayMix         = { cash: 0, card: 0, "table-service": 0 } as Record<string, number>;
  for (const o of diSettled) diPayMix[o.paymentMethod] = (diPayMix[o.paymentMethod] ?? 0) + 1;
  const diTotalCovers  = diSettled.reduce((s, o) => s + o.covers, 0);
  const diStaffStats: Record<string, { name: string; orders: number; revenue: number; covers: number; items: number }> = {};
  for (const o of diSettled) {
    const k = o.staffName || "—";
    if (!diStaffStats[k]) diStaffStats[k] = { name: k, orders: 0, revenue: 0, covers: 0, items: 0 };
    diStaffStats[k].orders++;
    diStaffStats[k].revenue += o.total;
    diStaffStats[k].covers  += o.covers;
    diStaffStats[k].items   += o.items.reduce((s, it) => s + it.qty, 0);
  }
  const diStaffPerf  = Object.values(diStaffStats).sort((a, b) => b.revenue - a.revenue);
  const maxDiRevenue = diStaffPerf[0]?.revenue || 1;
  const combinedRevenue = rRevenue + diRevenue;

  // Transactions
  const txSource   = showVoided ? inRange : rFiltered;
  const txFiltered = txSource.filter((s) => {
    if (!txSearch.trim()) return true;
    const q = txSearch.toLowerCase();
    return s.receiptNo.includes(q) || s.staffName.toLowerCase().includes(q) || (s.customerName ?? "").toLowerCase().includes(q);
  });
  const txSorted = [...txFiltered].sort((a, b) => {
    const dir = sortDir === "desc" ? -1 : 1;
    return sortField === "date"
      ? dir * (new Date(a.date).getTime() - new Date(b.date).getTime())
      : dir * (a.total - b.total);
  });
  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  // ── Payment-row helper ──────────────────────────────────────────────────────
  const reportPaymentRows = [
    { key: "cash",  label: "Cash",  bar: "bg-green-500",  Icon: Banknote  },
    { key: "card",  label: "Card",  bar: "bg-blue-500",   Icon: CreditCard },
    { key: "split", label: "Split", bar: "bg-purple-500", Icon: Shuffle   },
  ] as const;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-white font-bold text-xl">Sales Dashboard</h2>
            <p className="text-slate-400 text-sm mt-1">
              {dashTab === "overview"
                ? `Today · ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`
                : `${rFiltered.length} transactions · ${fmt(rRevenue, sym)} revenue${voidedCount > 0 ? ` · ${voidedCount} voided` : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dashTab === "reports" && (
              <button
                onClick={() => posExportCSV(showVoided ? inRange : rFiltered, sym)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-xs font-semibold transition-colors"
              >
                <Download size={13} /> Export CSV
              </button>
            )}
            {dashTab === "dine-in" && (
              <button
                onClick={() => {
                  setDineInOrders([]);
                  setDashTab("dine-in");
                  setDineInLoading(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold transition-colors"
              >
                <RefreshCw size={13} /> Refresh
              </button>
            )}
            <div className="flex gap-1 bg-slate-800 border border-slate-700 p-1 rounded-xl">
              {([
                { id: "overview", label: "Overview" },
                { id: "reports",  label: "Reports"  },
                { id: "dine-in",  label: "Dine-In"  },
              ] as { id: "overview"|"reports"|"dine-in"; label: string }[]).map((t) => (
                <button key={t.id} onClick={() => setDashTab(t.id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    dashTab === t.id ? "bg-orange-500 text-white shadow" : "text-slate-400 hover:text-white"
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ════════════════ OVERVIEW TAB ════════════════ */}
        {dashTab === "overview" && (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Today's Revenue",  value: fmt(totalRevenue, sym),   sub: diRevToday > 0 ? `incl. ${fmt(diRevToday, sym)} dine-in` : undefined, icon: TrendingUp,      color: "text-green-400",  bg: "bg-green-500/10" },
                { label: "Transactions",     value: `${totalTransactions}`,   sub: todayDineInSettled.length > 0 ? `${todaySales.length} POS · ${todayDineInSettled.length} dine-in` : undefined, icon: Receipt,         color: "text-blue-400",   bg: "bg-blue-500/10"  },
                { label: "Average Order",    value: fmt(todayAvgOrder, sym),  sub: "POS + dine-in",                                                       icon: BarChart3,       color: "text-purple-400", bg: "bg-purple-500/10"},
                { label: "Tips Collected",   value: fmt(totalTips, sym),      sub: "POS only",                                                            icon: BadgeDollarSign, color: "text-amber-400",  bg: "bg-amber-500/10" },
              ].map((card) => (
                <div key={card.label} className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                  <div className={`w-10 h-10 ${card.bg} rounded-xl flex items-center justify-center mb-3`}>
                    <card.icon size={20} className={card.color} />
                  </div>
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                  <p className="text-slate-400 text-xs mt-1">{card.label}</p>
                  {card.sub && <p className="text-slate-500 text-[10px] mt-0.5">{card.sub}</p>}
                </div>
              ))}
            </div>

            {/* Dine-in today strip */}
            {diRevToday > 0 && (
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl px-5 py-3 flex flex-wrap items-center gap-4">
                <Utensils size={16} className="text-violet-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-violet-200 text-sm font-semibold">Dine-In Today</p>
                  <p className="text-slate-400 text-xs">{todayDineInSettled.length} settled table{todayDineInSettled.length !== 1 ? "s" : ""} · {todayDineIn.filter(o => o.status !== "delivered" && o.status !== "cancelled").length} still open</p>
                </div>
                <div className="flex gap-6">
                  <div className="text-right">
                    <p className="text-violet-200 font-bold text-lg">{fmt(diRevToday, sym)}</p>
                    <p className="text-slate-500 text-[10px]">Revenue</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-bold text-lg">{fmt(todayDineInSettled.length > 0 ? diRevToday / todayDineInSettled.length : 0, sym)}</p>
                    <p className="text-slate-500 text-[10px]">Avg Bill</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Revenue last-7 chart */}
              <div className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-2xl p-5">
                <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <BarChart3 size={16} className="text-orange-400" /> Revenue — Last 7 Days
                </h3>
                <div className="flex items-end gap-2 h-32">
                  {last7.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex items-end justify-center" style={{ height: "100px" }}>
                        <div className={`w-full rounded-t-lg transition-all ${i === 6 ? "bg-orange-500" : "bg-slate-600"}`}
                          style={{ height: `${Math.max(4, (d.revenue / maxRev) * 100)}%` }} />
                      </div>
                      <span className="text-slate-500 text-[10px]">{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment mix */}
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                  <CreditCard size={16} className="text-blue-400" /> Payment Mix
                </h3>
                <div className="space-y-3">
                  {([["cash","Cash","bg-green-500"],["card","Card","bg-blue-500"],["split","Split","bg-purple-500"]] as [string,string,string][]).map(([key,label,color]) => {
                    const pct = ((overviewPayMix[key as keyof typeof overviewPayMix] ?? 0) / overviewPayTotal) * 100;
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                          <span>{label}</span><span>{overviewPayMix[key as keyof typeof overviewPayMix] ?? 0} txns</span>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-700">
                  <p className="text-slate-400 text-xs">Overall Margin</p>
                  <p className="text-white font-bold text-xl">{fmtPct(overviewMargin)}</p>
                  <p className="text-slate-500 text-xs">All-time · excl. voided</p>
                </div>
              </div>
            </div>

            {/* Best sellers */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                <Flame size={16} className="text-orange-400" /> Best Sellers (All Time)
              </h3>
              {bestSellersOverview.length === 0 ? (
                <p className="text-slate-500 text-sm">No sales recorded yet</p>
              ) : (
                <div className="space-y-2">
                  {bestSellersOverview.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-4">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        i === 0 ? "bg-amber-500 text-white" : i === 1 ? "bg-slate-500 text-white" : i === 2 ? "bg-orange-700 text-white" : "bg-slate-700 text-slate-300"
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{item.name}</p>
                        <div className="h-1.5 bg-slate-700 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(item.count / bestSellersOverview[0].count) * 100}%` }} />
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-white text-sm font-bold">{item.count} sold</p>
                        <p className="text-slate-400 text-xs">{fmt(item.revenue, sym)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent transactions — POS + dine-in merged */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                <Receipt size={16} className="text-slate-400" /> Recent Transactions
              </h3>
              {sales.length === 0 && todayDineIn.length === 0 ? (
                <p className="text-slate-500 text-sm">No transactions yet</p>
              ) : (
                <div className="space-y-2">
                  {/* Merge POS sales + dine-in, sort by date desc, show 12 */}
                  {[
                    ...sales.map(s => ({ type: "pos" as const, date: s.date, data: s })),
                    ...todayDineIn.map(o => ({ type: "dine-in" as const, date: o.date, data: o })),
                  ]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .slice(0, 12)
                    .map((entry) => {
                      if (entry.type === "pos") {
                        const sale = entry.data;
                        return (
                          <div key={sale.id} className={`flex items-center gap-4 px-4 py-3 rounded-xl ${sale.voided ? "bg-red-500/5 border border-red-500/20" : "bg-slate-700/50"}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${sale.voided ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>
                              {sale.voided ? "V" : "✓"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm font-medium">#{sale.receiptNo} · {sale.staffName}</p>
                              <p className="text-slate-400 text-xs">{sale.items.length} item{sale.items.length !== 1 ? "s" : ""} · {sale.paymentMethod} · {relTime(sale.date)}</p>
                              {sale.voided && sale.voidReason && <p className="text-red-400 text-xs italic">Void: {sale.voidReason}</p>}
                              {sale.voided && sale.refundMethod && sale.refundMethod !== "none" && (
                                <p className="text-xs mt-0.5 flex items-center gap-1">
                                  {sale.refundMethod === "cash" ? <Banknote size={10} className="text-green-400" /> : <CreditCard size={10} className="text-blue-400" />}
                                  <span className={sale.refundMethod === "cash" ? "text-green-400" : "text-blue-400"}>
                                    Refunded {fmt(sale.refundAmount ?? 0, settings.currencySymbol)} via {sale.refundMethod}
                                  </span>
                                </p>
                              )}
                            </div>
                            <p className={`font-bold text-sm flex-shrink-0 ${sale.voided ? "text-red-400 line-through" : "text-white"}`}>
                              {fmt(sale.total, sym)}
                            </p>
                            {!sale.voided && currentStaff?.permissions.canVoidSale && (
                              <button onClick={() => openVoidModal(sale.id)} className="text-slate-500 hover:text-red-400 transition-colors flex-shrink-0" title="Void sale">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        );
                      } else {
                        const order = entry.data;
                        const isSettled = order.status === "delivered";
                        return (
                          <div key={order.id} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-violet-500/5 border border-violet-500/15">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isSettled ? "bg-violet-500/20" : "bg-blue-500/20"}`}>
                              <Utensils size={13} className={isSettled ? "text-violet-400" : "text-blue-400"} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm font-medium">
                                Table {order.tableLabel}
                                {order.staffName && order.staffName !== "—" && <span className="text-slate-400"> · {order.staffName}</span>}
                              </p>
                              <p className="text-slate-400 text-xs">
                                {order.items.reduce((s, i) => s + i.qty, 0)} items · {order.paymentMethod === "cash" ? "Cash" : order.paymentMethod === "card" ? "Card" : "Table Service"} · {relTime(order.date)}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-white font-bold text-sm">{fmt(order.total, sym)}</p>
                              <p className={`text-[10px] ${isSettled ? "text-violet-400" : "text-blue-400"}`}>
                                {isSettled ? "Settled" : order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                              </p>
                            </div>
                          </div>
                        );
                      }
                    })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ════════════════ REPORTS TAB ════════════════ */}
        {dashTab === "reports" && (
          <>
            {/* Period selector */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
              <div className="flex flex-wrap gap-2">
                {POS_PERIODS.map((p) => (
                  <button key={p.id} onClick={() => setPeriod(p.id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      period === p.id ? "bg-orange-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
              {period === "custom" && (
                <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-slate-700">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">From</label>
                    <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                      className="bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">To</label>
                    <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                      className="bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-orange-500" />
                  </div>
                </div>
              )}
            </div>

            {/* Empty state — only when both POS and dine-in have nothing */}
            {rFiltered.length === 0 && diSettled.length === 0 && !reportsDineInLoading && (
              <div className="bg-slate-800 border border-slate-700 rounded-2xl p-12 text-center">
                <BarChart3 size={36} className="mx-auto text-slate-600 mb-3" />
                <p className="text-slate-400 font-medium">No sales found for this period</p>
                <p className="text-slate-600 text-sm mt-1">Try selecting a different date range.</p>
              </div>
            )}

            {/* Dine-In loading placeholder */}
            {rFiltered.length === 0 && reportsDineInLoading && (
              <div className="flex items-center justify-center py-12 text-slate-500 gap-2 text-sm">
                <RefreshCw size={16} className="animate-spin" /> Loading dine-in data…
              </div>
            )}

            {/* Dine-In only KPI strip — visible when POS has no sales but dine-in does */}
            {rFiltered.length === 0 && diSettled.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Dine-In Revenue",  value: fmt(diRevenue, sym),  color: "text-violet-300", bg: "bg-violet-500/10", icon: Utensils },
                    { label: "Tables Served",    value: String(diSettled.length), color: "text-white",  bg: "bg-slate-700",     icon: Receipt  },
                    { label: "Avg Bill",         value: fmt(diAvgOrder, sym), color: "text-emerald-300",bg: "bg-emerald-500/10",icon: TrendingUp},
                    { label: "Covers",           value: diTotalCovers > 0 ? String(diTotalCovers) : "—", color: "text-blue-300", bg: "bg-blue-500/10", icon: Users },
                  ].map(({ label, value, color, bg, icon: Icon }) => (
                    <div key={label} className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
                      <div className={`w-9 h-9 ${bg} rounded-xl flex items-center justify-center mb-2.5`}>
                        <Icon size={17} className={color} />
                      </div>
                      <p className={`text-xl font-bold ${color}`}>{value}</p>
                      <p className="text-slate-400 text-[11px] mt-1">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(rFiltered.length > 0 || diSettled.length > 0 || reportsDineInLoading) && (
              <>
                {/* POS KPI cards — only shown when POS has data */}
                {rFiltered.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                  {[
                    { label: "POS Revenue",    value: fmt(rRevenue, sym),    sub: `${rFiltered.length} txns`,    icon: TrendingUp,      color: "text-green-400",  bg: "bg-green-500/10"  },
                    { label: "Avg Order",      value: fmt(rAvgOrder, sym),   sub: "per transaction",             icon: Receipt,         color: "text-blue-400",   bg: "bg-blue-500/10"   },
                    { label: "Gross Profit",   value: fmt(grossProfit, sym), sub: `${fmtPct(marginPct)} margin`, icon: BarChart3,       color: "text-purple-400", bg: "bg-purple-500/10" },
                    { label: "VAT Collected",  value: fmt(rTax, sym),        sub: "excl. voided",                icon: Percent,         color: "text-amber-400",  bg: "bg-amber-500/10"  },
                    { label: "Tips",           value: fmt(rTips, sym),       sub: "staff tips",                  icon: BadgeDollarSign, color: "text-pink-400",   bg: "bg-pink-500/10"   },
                    { label: "Discounts",      value: fmt(rDiscounts, sym),  sub: "reductions applied",          icon: Tag,             color: "text-red-400",    bg: "bg-red-500/10"    },
                  ].map((card) => (
                    <div key={card.label} className="bg-slate-800 border border-slate-700 rounded-2xl p-4">
                      <div className={`w-9 h-9 ${card.bg} rounded-xl flex items-center justify-center mb-2.5`}>
                        <card.icon size={17} className={card.color} />
                      </div>
                      <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                      {card.sub && <p className="text-slate-500 text-[10px] mt-0.5">{card.sub}</p>}
                      <p className="text-slate-400 text-[11px] mt-1">{card.label}</p>
                    </div>
                  ))}
                </div>
                )}

                {/* Sub-tab bar */}
                <div className="flex gap-1 bg-slate-900 border border-slate-700 p-1 rounded-xl">
                  {(["overview","items","staff","transactions"] as ReportTab[]).map((t) => (
                    <button key={t} onClick={() => setReportTab(t)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${
                        reportTab === t ? "bg-slate-700 text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
                      }`}>
                      {t === "transactions" ? "Transactions" : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>

                {/* ── Overview sub-tab ─────────────────────────────────────── */}
                {reportTab === "overview" && (
                  <div className="space-y-4">
                    {/* Daily chart */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                      <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                        <BarChart3 size={16} className="text-orange-400" /> Revenue by Day
                      </h3>
                      {dailyBuckets.length <= 1 ? (
                        <p className="text-slate-500 text-sm">Select a wider date range to see the daily chart.</p>
                      ) : (
                        <div className="flex items-end gap-1" style={{ height: 140 }}>
                          {dailyBuckets.map((d, i) => (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.label}: ${fmt(d.revenue, sym)}`}>
                              <div className="w-full flex items-end justify-center" style={{ height: 110 }}>
                                <div className={`w-full rounded-t-md transition-all ${d.revenue > 0 ? "bg-orange-500" : "bg-slate-700"}`}
                                  style={{ height: `${Math.max(4, (d.revenue / maxDaily) * 100)}%` }} />
                              </div>
                              {dailyBuckets.length <= 14 && (
                                <span className="text-[9px] text-slate-500 text-center leading-tight">{d.label.split(" ").slice(0, 2).join(" ")}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Payment methods */}
                      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                        <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                          <CreditCard size={16} className="text-blue-400" /> Payment Methods
                        </h3>
                        <div className="space-y-3">
                          {reportPaymentRows.map(({ key, label, bar, Icon }) => {
                            const count = rPayMix[key];
                            const pct   = (count / rPayTotal) * 100;
                            const rev   = rFiltered.filter((s) => s.paymentMethod === key).reduce((s, x) => s + x.total, 0);
                            return (
                              <div key={key}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm text-slate-300 flex items-center gap-1.5"><Icon size={13} /> {label}</span>
                                  <span className="text-sm font-semibold text-white">{fmt(rev, sym)}</span>
                                </div>
                                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                  <div className={`h-full ${bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5">{count} transactions · {fmtPct(pct)}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Hourly heatmap */}
                      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                        <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                          <TrendingUp size={16} className="text-green-400" /> Busiest Hours
                        </h3>
                        <div className="grid grid-cols-12 gap-0.5">
                          {hourlyBuckets.map((rev, h) => {
                            const p = rev / maxHourly;
                            const intensity = p > 0.75 ? "bg-orange-500" : p > 0.5 ? "bg-orange-400" : p > 0.25 ? "bg-orange-300" : p > 0 ? "bg-orange-900" : "bg-slate-700";
                            return <div key={h} title={`${h}:00 — ${fmt(rev, sym)}`} className={`${intensity} rounded aspect-square`} />;
                          })}
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
                          <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-3 text-[10px] text-slate-500">
                          {["bg-slate-700","bg-orange-900","bg-orange-300","bg-orange-400","bg-orange-500"].map((c) => (
                            <div key={c} className={`w-3 h-3 rounded ${c}`} />
                          ))}
                          <span>Low → High</span>
                        </div>
                      </div>
                    </div>

                    {/* Financial summary */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                      <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
                        <Receipt size={16} className="text-slate-400" /> Financial Summary
                      </h3>
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-slate-700/40">
                          {[
                            ["Gross Sales",    fmt(rFiltered.reduce((s,x)=>s+x.subtotal,0), sym), "text-slate-200"],
                            ["Discounts",      `–${fmt(rDiscounts, sym)}`,                         "text-red-400"],
                            ["VAT Collected",  fmt(rTax, sym),                                     "text-amber-400"],
                            ["Tips",           fmt(rTips, sym),                                    "text-pink-400"],
                            ["Total Revenue",  fmt(rRevenue, sym),                                 "font-bold text-white"],
                            ["Est. COGS",      `–${fmt(rCost, sym)}`,                               "text-slate-500"],
                            ["Gross Profit",   fmt(grossProfit, sym),                              "font-semibold text-green-400"],
                            ["Gross Margin",   fmtPct(marginPct),                                  "text-purple-400"],
                          ].map(([label, value, cls]) => (
                            <tr key={label}>
                              <td className="py-2 text-slate-400 text-xs">{label}</td>
                              <td className={`py-2 text-right text-sm ${cls}`}>{value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Combined total */}
                    <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 gap-3">
                      <div className="bg-slate-700/40 rounded-xl p-3">
                        <p className="text-slate-400 text-xs">POS Revenue</p>
                        <p className="text-white font-bold text-lg">{fmt(rRevenue, sym)}</p>
                        <p className="text-slate-500 text-xs">{rFiltered.length} transactions</p>
                      </div>
                      <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3">
                        <p className="text-violet-300 text-xs">Dine-In Revenue</p>
                        <p className="text-white font-bold text-lg">{fmt(diRevenue, sym)}</p>
                        <p className="text-slate-500 text-xs">{diSettled.length} settled orders</p>
                      </div>
                      <div className="col-span-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center justify-between">
                        <div>
                          <p className="text-emerald-300 text-xs font-bold uppercase tracking-wider">Combined Revenue</p>
                          <p className="text-slate-400 text-xs">{rFiltered.length + diSettled.length} total orders</p>
                        </div>
                        <p className="text-emerald-300 font-black text-2xl">{fmt(combinedRevenue, sym)}</p>
                      </div>
                      {(diVoided.length > 0 || diRefundedOrders.length > 0) && (
                        <div className="col-span-2 flex gap-3">
                          {diVoided.length > 0 && (
                            <div className="flex-1 flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                              <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
                              <div>
                                <p className="text-red-300 text-xs font-semibold">{diVoided.length} Voided</p>
                                <p className="text-slate-500 text-[10px]">Dine-in orders cancelled</p>
                              </div>
                            </div>
                          )}
                          {diRefundedOrders.length > 0 && (
                            <div className="flex-1 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                              <RotateCcw size={13} className="text-amber-400 flex-shrink-0" />
                              <div>
                                <p className="text-amber-300 text-xs font-semibold">{diRefundedOrders.length} Refunded</p>
                                <p className="text-slate-500 text-[10px]">Dine-in orders refunded</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Dine-In breakdown card */}
                    {reportsDineInLoading ? (
                      <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
                        <RefreshCw size={14} className="animate-spin" /> Loading dine-in data…
                      </div>
                    ) : diSettled.length > 0 && (
                      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
                        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                          <Utensils size={16} className="text-violet-400" /> Dine-In Performance
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-slate-700/40 rounded-xl p-3 text-center">
                            <p className="text-violet-300 font-bold text-lg">{fmt(diRevenue, sym)}</p>
                            <p className="text-slate-500 text-xs">Revenue</p>
                          </div>
                          <div className="bg-slate-700/40 rounded-xl p-3 text-center">
                            <p className="text-white font-bold text-lg">{diSettled.length}</p>
                            <p className="text-slate-500 text-xs">Tables Served</p>
                          </div>
                          <div className="bg-slate-700/40 rounded-xl p-3 text-center">
                            <p className="text-white font-bold text-lg">{fmt(diAvgOrder, sym)}</p>
                            <p className="text-slate-500 text-xs">Avg Bill</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Payment Methods</p>
                          {(Object.entries(diPayMix) as [string, number][]).filter(([, v]) => v > 0).map(([key, count]) => {
                            const pct = (count / diSettled.length) * 100;
                            const label = key === "cash" ? "Cash" : key === "card" ? "Card" : "Table Service";
                            const color = key === "cash" ? "bg-green-500" : key === "card" ? "bg-blue-500" : "bg-violet-500";
                            return (
                              <div key={key}>
                                <div className="flex justify-between text-xs text-slate-400 mb-1">
                                  <span>{label}</span><span>{count} orders · {fmtPct(pct)}</span>
                                </div>
                                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                                  <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Items sub-tab ────────────────────────────────────────── */}
                {reportTab === "items" && (
                  <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-700">
                      <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                        <Package size={16} className="text-orange-400" /> Best-Selling Items
                      </h3>
                    </div>
                    {rBestSellers.length === 0 ? (
                      <p className="p-6 text-slate-500 text-sm">No item data for this period.</p>
                    ) : (
                      <div className="divide-y divide-slate-700/40">
                        {rBestSellers.map((item, i) => (
                          <div key={item.name} className="px-5 py-4 flex items-center gap-4">
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                              i === 0 ? "bg-amber-500 text-white" : i === 1 ? "bg-slate-500 text-white" : i === 2 ? "bg-orange-700 text-white" : "bg-slate-700 text-slate-300"
                            }`}>
                              {i === 0 ? <Trophy size={12} /> : i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm font-medium truncate">{item.name}</p>
                              <div className="h-1.5 bg-slate-700 rounded-full mt-1.5 overflow-hidden">
                                <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(item.revenue / maxItemRev) * 100}%` }} />
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-white font-semibold text-sm">{fmt(item.revenue, sym)}</p>
                              <p className="text-slate-400 text-xs">{item.qty} sold</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Staff sub-tab ────────────────────────────────────────── */}
                {reportTab === "staff" && (
                  <div className="space-y-4">
                    {/* POS Staff */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-700">
                        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                          <Users size={16} className="text-blue-400" /> POS Staff Performance
                        </h3>
                      </div>
                      {staffPerf.length === 0 ? (
                        <p className="p-6 text-slate-500 text-sm">No POS staff data for this period.</p>
                      ) : (
                        <div className="divide-y divide-slate-700/40">
                          {staffPerf.map((s, i) => (
                            <div key={s.name} className="px-5 py-4 flex items-center gap-4">
                              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                i === 0 ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-300"
                              }`}>
                                {i === 0 ? <Trophy size={12} /> : i + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-white text-sm font-medium">{s.name}</p>
                                <div className="h-1.5 bg-slate-700 rounded-full mt-1.5 overflow-hidden">
                                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(s.revenue / maxStaffRev) * 100}%` }} />
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-white font-semibold text-sm">{fmt(s.revenue, sym)}</p>
                                <p className="text-slate-400 text-xs">{s.sales} sales · avg {fmt(s.avgOrder, sym)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Waiter Staff */}
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                      {/* Header */}
                      <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between gap-3">
                        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                          <Utensils size={16} className="text-violet-400" /> Waiter Performance — Dine-In
                        </h3>
                        {!reportsDineInLoading && diSettled.length > 0 && (
                          <span className="text-xs text-slate-500">{diSettled.length} settled orders</span>
                        )}
                      </div>

                      {reportsDineInLoading ? (
                        <div className="p-6 flex items-center gap-2 text-slate-500 text-sm">
                          <RefreshCw size={14} className="animate-spin" /> Loading dine-in data…
                        </div>
                      ) : diStaffPerf.length === 0 ? (
                        <div className="p-10 text-center">
                          <Utensils size={32} className="mx-auto text-slate-700 mb-3" />
                          <p className="text-slate-500 text-sm">No dine-in orders for this period.</p>
                        </div>
                      ) : (
                        <>
                          {/* Period KPI strip */}
                          <div className="grid grid-cols-4 divide-x divide-slate-700 border-b border-slate-700">
                            {[
                              { label: "Revenue",      value: fmt(diRevenue, sym),                              color: "text-violet-300" },
                              { label: "Tables",       value: String(diSettled.length),                         color: "text-white"      },
                              { label: "Covers",       value: diTotalCovers > 0 ? String(diTotalCovers) : "—",  color: "text-white"      },
                              { label: "Avg Bill",     value: fmt(diAvgOrder, sym),                             color: "text-emerald-300" },
                            ].map(({ label, value, color }) => (
                              <div key={label} className="px-4 py-3 text-center">
                                <p className={`font-bold text-base ${color}`}>{value}</p>
                                <p className="text-slate-500 text-[10px] mt-0.5 uppercase tracking-wider">{label}</p>
                              </div>
                            ))}
                          </div>

                          {/* Per-waiter rows */}
                          <div className="divide-y divide-slate-700/40">
                            {diStaffPerf.map((s, i) => {
                              const pct     = (s.revenue / maxDiRevenue) * 100;
                              const avgBill = s.orders > 0 ? s.revenue / s.orders : 0;
                              const initials = s.name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();
                              const medals = ["bg-amber-500","bg-slate-400","bg-orange-700"];
                              return (
                                <div key={s.name} className="px-5 py-4">
                                  <div className="flex items-center gap-3 mb-2.5">
                                    {/* Rank + Avatar */}
                                    <div className="relative flex-shrink-0">
                                      <div className="w-9 h-9 rounded-full bg-violet-600/30 border border-violet-500/40 flex items-center justify-center text-violet-200 font-bold text-xs">
                                        {initials}
                                      </div>
                                      <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white ${medals[i] ?? "bg-slate-600"}`}>
                                        {i + 1}
                                      </span>
                                    </div>

                                    {/* Name + bar */}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-white text-sm font-semibold leading-none mb-1.5">{s.name}</p>
                                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                      </div>
                                    </div>

                                    {/* Revenue */}
                                    <div className="text-right flex-shrink-0">
                                      <p className="text-white font-bold text-sm">{fmt(s.revenue, sym)}</p>
                                      <p className="text-violet-400 text-xs">{fmtPct(pct)} of total</p>
                                    </div>
                                  </div>

                                  {/* Stat pills */}
                                  <div className="flex flex-wrap gap-2 ml-12">
                                    <span className="text-[11px] bg-slate-700/60 text-slate-300 px-2.5 py-1 rounded-full">
                                      🍽 {s.orders} table{s.orders !== 1 ? "s" : ""}
                                    </span>
                                    {s.covers > 0 && (
                                      <span className="text-[11px] bg-slate-700/60 text-slate-300 px-2.5 py-1 rounded-full">
                                        👥 {s.covers} cover{s.covers !== 1 ? "s" : ""}
                                      </span>
                                    )}
                                    <span className="text-[11px] bg-slate-700/60 text-slate-300 px-2.5 py-1 rounded-full">
                                      📦 {s.items} item{s.items !== 1 ? "s" : ""}
                                    </span>
                                    <span className="text-[11px] bg-violet-900/40 text-violet-300 px-2.5 py-1 rounded-full">
                                      avg {fmt(avgBill, sym)} / table
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Transactions sub-tab ─────────────────────────────────── */}
                {reportTab === "transactions" && (
                  <div className="space-y-4">
                  <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                    {/* Toolbar */}
                    <div className="px-5 py-4 border-b border-slate-700 flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-48 relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input value={txSearch} onChange={(e) => setTxSearch(e.target.value)}
                          placeholder="Search receipt, staff, customer…"
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl pl-9 pr-4 py-2 text-sm text-white outline-none focus:border-orange-500 placeholder-slate-500" />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                        <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} className="rounded accent-orange-500" />
                        Show voided
                      </label>
                      <p className="text-slate-600 text-xs ml-auto">{txSorted.length} rows</p>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-900/60 text-left">
                            <th className="px-5 py-3 text-xs text-slate-500 font-semibold">Receipt</th>
                            <th className="px-5 py-3 text-xs text-slate-500 font-semibold cursor-pointer hover:text-slate-300"
                                onClick={() => toggleSort("date")}>
                              Date {sortField === "date" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                            </th>
                            <th className="px-5 py-3 text-xs text-slate-500 font-semibold">Staff</th>
                            <th className="px-5 py-3 text-xs text-slate-500 font-semibold">Customer</th>
                            <th className="px-5 py-3 text-xs text-slate-500 font-semibold">Payment</th>
                            <th className="px-5 py-3 text-xs text-slate-500 font-semibold cursor-pointer hover:text-slate-300 text-right"
                                onClick={() => toggleSort("total")}>
                              Total {sortField === "total" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                            </th>
                            {currentStaff?.permissions.canVoidSale && (
                              <th className="px-4 py-3 text-xs text-slate-500 font-semibold" />
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/30">
                          {txSorted.length === 0 ? (
                            <tr><td colSpan={currentStaff?.permissions.canVoidSale ? 7 : 6} className="px-5 py-8 text-center text-slate-500 text-sm">No transactions found</td></tr>
                          ) : txSorted.map((sale) => (
                            <tr key={sale.id} className={`hover:bg-slate-700/30 transition-colors ${sale.voided ? "opacity-40" : ""}`}>
                              <td className="px-5 py-3 font-mono text-xs text-slate-300">
                                <div>#{sale.receiptNo}</div>
                                {sale.voided && (
                                  <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-semibold">VOID</span>
                                )}
                              </td>
                              <td className="px-5 py-3 text-slate-400 text-xs whitespace-nowrap">
                                {fmtDate(sale.date)}<br />
                                <span className="text-slate-600">{fmtTime(sale.date)}</span>
                              </td>
                              <td className="px-5 py-3 text-slate-300">{sale.staffName}</td>
                              <td className="px-5 py-3 text-slate-500 text-xs">{sale.customerName ?? "—"}</td>
                              <td className="px-5 py-3">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                                  sale.paymentMethod === "cash"  ? "bg-green-500/20 text-green-400"  :
                                  sale.paymentMethod === "card"  ? "bg-blue-500/20  text-blue-400"   :
                                                                   "bg-purple-500/20 text-purple-400"
                                }`}>{sale.paymentMethod}</span>
                                {sale.voided && sale.refundMethod && sale.refundMethod !== "none" && (
                                  <div className={`mt-1 text-[10px] flex items-center gap-1 font-semibold ${
                                    sale.refundMethod === "cash" ? "text-green-400" : "text-blue-400"
                                  }`}>
                                    {sale.refundMethod === "cash" ? <Banknote size={10} /> : <CreditCard size={10} />}
                                    Refund {fmt(sale.refundAmount ?? 0, sym)}
                                  </div>
                                )}
                                {sale.voided && sale.refundMethod === "none" && (
                                  <div className="mt-1 text-[10px] text-slate-500 font-semibold">No refund</div>
                                )}
                              </td>
                              <td className={`px-5 py-3 text-right font-semibold ${sale.voided ? "text-red-400 line-through" : "text-white"}`}>
                                {fmt(sale.total, sym)}
                              </td>
                              {currentStaff?.permissions.canVoidSale && (
                                <td className="px-4 py-3 text-center">
                                  {!sale.voided ? (
                                    <button
                                      onClick={() => { openVoidModal(sale.id); }}
                                      title="Void transaction"
                                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 transition-all"
                                    >
                                      <Trash2 size={11} /> Void
                                    </button>
                                  ) : (
                                    <span className="text-slate-600 text-[11px]">Voided</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                        {txSorted.length > 0 && (
                          <tfoot>
                            <tr className="bg-slate-900/60 border-t-2 border-slate-600">
                              <td colSpan={currentStaff?.permissions.canVoidSale ? 6 : 5} className="px-5 py-3 text-xs font-semibold text-slate-400">
                                Total ({txSorted.filter((s) => !s.voided).length} sales)
                              </td>
                              <td className="px-5 py-3 text-right font-bold text-white">
                                {fmt(txSorted.filter((s) => !s.voided).reduce((s, x) => s + x.total, 0), sym)}
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>

                  {/* Dine-In transactions */}
                  {reportsDineIn.length > 0 && (
                    <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                          <Utensils size={16} className="text-violet-400" /> Dine-In Orders
                        </h3>
                        <span className="text-slate-500 text-xs">{reportsDineIn.length} orders</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-700 text-left">
                              <th className="px-5 py-3 text-xs font-semibold text-slate-400">Date / Time</th>
                              <th className="px-5 py-3 text-xs font-semibold text-slate-400">Table</th>
                              <th className="px-5 py-3 text-xs font-semibold text-slate-400">Waiter</th>
                              <th className="px-5 py-3 text-xs font-semibold text-slate-400">Items</th>
                              <th className="px-5 py-3 text-xs font-semibold text-slate-400">Status</th>
                              <th className="px-5 py-3 text-xs font-semibold text-slate-400 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-700/40">
                            {reportsDineIn.map((o) => (
                              <tr key={o.id} className="hover:bg-slate-700/30 transition-colors">
                                <td className="px-5 py-3 text-slate-400 text-xs whitespace-nowrap">
                                  {new Date(o.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{" "}
                                  {new Date(o.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </td>
                                <td className="px-5 py-3 text-white font-semibold">T{o.tableLabel}</td>
                                <td className="px-5 py-3 text-slate-300">{o.staffName}</td>
                                <td className="px-5 py-3 text-slate-400 text-xs max-w-[180px] truncate">
                                  {o.items.map(it => `${it.qty}× ${it.name}`).join(", ")}
                                </td>
                                <td className="px-5 py-3">
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                    o.status === "delivered"           ? "bg-emerald-500/20 text-emerald-300" :
                                    o.status === "cancelled"           ? "bg-red-500/20 text-red-400" :
                                    o.status === "refunded"            ? "bg-amber-500/20 text-amber-300" :
                                    o.status === "partially_refunded"  ? "bg-amber-500/15 text-amber-400" :
                                    "bg-blue-500/20 text-blue-300"
                                  }`}>
                                    {o.status === "delivered"          ? "Settled" :
                                     o.status === "cancelled"          ? "Voided" :
                                     o.status === "refunded"           ? "Refunded" :
                                     o.status === "partially_refunded" ? "Part. Refund" :
                                     o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                                  </span>
                                </td>
                                <td className={`px-5 py-3 text-right font-bold ${
                                  o.status === "cancelled" ? "text-red-400 line-through opacity-50" :
                                  o.status === "refunded"  ? "text-amber-400 line-through opacity-70" :
                                  "text-white"
                                }`}>{fmt(o.total, sym)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-900/60 border-t-2 border-slate-600">
                              <td colSpan={5} className="px-5 py-3 text-xs font-semibold text-slate-400">
                                Dine-In Total ({reportsDineIn.filter(o => o.status === "delivered").length} settled)
                              </td>
                              <td className="px-5 py-3 text-right font-bold text-violet-300">
                                {fmt(reportsDineIn.filter(o => o.status === "delivered").reduce((s, o) => s + o.total, 0), sym)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Dine-In Orders tab ───────────────────────────────────────────── */}
      {dashTab === "dine-in" && (
        <div className="p-6 space-y-6">
          {dineInLoading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <RefreshCw size={24} className="animate-spin mr-3" />
              Loading dine-in orders…
            </div>
          ) : dineInOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Utensils size={48} className="mb-4 opacity-30" />
              <p className="text-lg font-medium">No dine-in orders found</p>
              <p className="text-sm mt-1">Waiter orders will appear here once placed</p>
            </div>
          ) : (
            <>
              {/* Open / active orders */}
              {dineInOrders.filter(o => o.status !== "delivered" && o.status !== "cancelled").length > 0 && (
                <div>
                  <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3">
                    Open Tables ({dineInOrders.filter(o => o.status !== "delivered" && o.status !== "cancelled").length})
                  </h3>
                  <div className="space-y-3">
                    {dineInOrders
                      .filter(o => o.status !== "delivered" && o.status !== "cancelled")
                      .map(order => (
                        <div key={order.id} className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-white font-bold text-lg">Table {order.tableLabel}</span>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  order.status === "confirmed" ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" :
                                  order.status === "preparing" ? "bg-orange-500/20 text-orange-300 border border-orange-500/30" :
                                  order.status === "ready" ? "bg-green-500/20 text-green-300 border border-green-500/30" :
                                  "bg-slate-600/50 text-slate-300 border border-slate-600"
                                }`}>
                                  {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                                </span>
                              </div>
                              <p className="text-slate-400 text-sm mt-0.5">
                                {order.staffName && <span>{order.staffName} · </span>}
                                {order.covers > 0 && <span>{order.covers} covers · </span>}
                                <span>{new Date(order.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-white font-bold text-xl">{settings.currencySymbol}{order.total.toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="border-t border-slate-700 pt-3">
                            <div className="flex flex-wrap gap-2">
                              {order.items.map((item, i) => (
                                <span key={i} className="text-xs bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg">
                                  {item.qty}× {item.name}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2 mt-4">
                            <button
                              onClick={() => printDineInReceipt(order)}
                              className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors"
                            >
                              <Printer size={14} />
                              Print
                            </button>
                            <div className="flex-1 flex gap-2">
                              <input
                                type="email"
                                placeholder="Email receipt…"
                                value={dineInEmail[order.id] ?? ""}
                                onChange={e => setDineInEmail(prev => ({ ...prev, [order.id]: e.target.value }))}
                                className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-violet-500 placeholder-slate-500 min-w-0"
                              />
                              <button
                                onClick={() => sendDineInEmail(order)}
                                disabled={dineInEmailSt[order.id] === "sending" || !dineInEmail[order.id]}
                                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                              >
                                <Mail size={14} />
                                {dineInEmailSt[order.id] === "sending" ? "Sending…" :
                                 dineInEmailSt[order.id] === "sent" ? "Sent!" :
                                 dineInEmailSt[order.id] === "error" ? "Failed" : "Send"}
                              </button>
                            </div>
                            {currentStaff?.permissions.canVoidSale && (
                              <button
                                onClick={() => { setDiAction({ mode: "void", order }); setDiActionReason(""); setDiActionError(null); }}
                                className="flex items-center gap-1.5 px-3 py-2 bg-red-900/30 hover:bg-red-900/60 border border-red-800/50 text-red-400 text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                              >
                                <AlertTriangle size={13} /> Void
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Settled orders */}
              {dineInOrders.filter(o => o.status === "delivered").length > 0 && (
                <div>
                  <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider mb-3">
                    Settled Today ({dineInOrders.filter(o => o.status === "delivered").length})
                  </h3>
                  <div className="space-y-3">
                    {dineInOrders
                      .filter(o => o.status === "delivered")
                      .map(order => (
                        <div key={order.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 opacity-80">
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-slate-300 font-bold text-lg">Table {order.tableLabel}</span>
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  Settled
                                </span>
                                {order.paymentMethod && order.paymentMethod !== "table-service" && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-600/50 text-slate-400 border border-slate-600">
                                    {order.paymentMethod.charAt(0).toUpperCase() + order.paymentMethod.slice(1)}
                                  </span>
                                )}
                              </div>
                              <p className="text-slate-500 text-sm mt-0.5">
                                {order.staffName && <span>{order.staffName} · </span>}
                                <span>{new Date(order.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-slate-300 font-bold text-xl">{settings.currencySymbol}{order.total.toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="border-t border-slate-700/50 pt-3 mb-4">
                            <div className="flex flex-wrap gap-2">
                              {order.items.map((item, i) => (
                                <span key={i} className="text-xs bg-slate-700/50 text-slate-400 px-2.5 py-1 rounded-lg">
                                  {item.qty}× {item.name}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => printDineInReceipt(order)}
                              className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors"
                            >
                              <Printer size={14} />
                              Reprint
                            </button>
                            <div className="flex-1 flex gap-2">
                              <input
                                type="email"
                                placeholder="Email receipt…"
                                value={dineInEmail[order.id] ?? ""}
                                onChange={e => setDineInEmail(prev => ({ ...prev, [order.id]: e.target.value }))}
                                className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-violet-500 placeholder-slate-500 min-w-0"
                              />
                              <button
                                onClick={() => sendDineInEmail(order)}
                                disabled={dineInEmailSt[order.id] === "sending" || !dineInEmail[order.id]}
                                className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                              >
                                <Mail size={14} />
                                {dineInEmailSt[order.id] === "sending" ? "Sending…" :
                                 dineInEmailSt[order.id] === "sent" ? "Sent!" :
                                 dineInEmailSt[order.id] === "error" ? "Failed" : "Send"}
                              </button>
                            </div>
                            {currentStaff?.permissions.canIssueRefund && (
                              <button
                                onClick={() => { setDiAction({ mode: "refund", order }); setDiActionReason(""); setDiRefundType("full"); setDiRefundAmtStr(""); setDiRefundMethod("cash"); setDiActionError(null); }}
                                className="flex items-center gap-1.5 px-3 py-2 bg-amber-900/30 hover:bg-amber-900/60 border border-amber-800/50 text-amber-400 text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                              >
                                <RotateCcw size={13} /> Refund
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Voided & Refunded orders */}
              {dineInOrders.filter(o => o.status === "cancelled" || o.status === "refunded" || o.status === "partially_refunded").length > 0 && (
                <div>
                  <h3 className="text-slate-400 font-semibold text-sm uppercase tracking-wider mb-3">
                    Voided / Refunded ({dineInOrders.filter(o => o.status === "cancelled" || o.status === "refunded" || o.status === "partially_refunded").length})
                  </h3>
                  <div className="space-y-3">
                    {dineInOrders
                      .filter(o => o.status === "cancelled" || o.status === "refunded" || o.status === "partially_refunded")
                      .map(order => (
                        <div key={order.id} className="bg-slate-800/30 border border-slate-700/30 rounded-2xl p-5 opacity-60">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-slate-400 font-bold">Table {order.tableLabel}</span>
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                                  order.status === "cancelled"
                                    ? "bg-red-500/15 text-red-400 border-red-500/25"
                                    : "bg-amber-500/15 text-amber-400 border-amber-500/25"
                                }`}>
                                  {order.status === "cancelled" ? "Voided" : order.status === "refunded" ? "Refunded" : "Partial Refund"}
                                </span>
                              </div>
                              <p className="text-slate-500 text-sm mt-0.5">
                                {order.staffName && <span>{order.staffName} · </span>}
                                <span>{new Date(order.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                              </p>
                            </div>
                            <p className="text-slate-500 font-bold text-xl line-through">{sym}{order.total.toFixed(2)}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Dine-in Void / Refund modal ─────────────────────────────────── */}
      {diAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${diAction.mode === "void" ? "bg-red-500/20" : "bg-amber-500/20"}`}>
                  {diAction.mode === "void"
                    ? <AlertTriangle size={17} className="text-red-400" />
                    : <RotateCcw size={17} className="text-amber-400" />}
                </div>
                <div>
                  <h3 className="text-white font-bold">{diAction.mode === "void" ? "Void Order" : "Refund Order"}</h3>
                  <p className="text-slate-400 text-xs">Table {diAction.order.tableLabel} · {sym}{diAction.order.total.toFixed(2)}</p>
                </div>
              </div>
              <button onClick={() => setDiAction(null)} className="text-slate-400 hover:text-white transition"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Refund options */}
              {diAction.mode === "refund" && (
                <>
                  <div>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Refund Amount</p>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {(["full", "partial"] as const).map(t => (
                        <button key={t} onClick={() => setDiRefundType(t)}
                          className={`py-2 rounded-xl text-sm font-semibold border transition ${diRefundType === t ? "bg-amber-500/20 border-amber-500 text-amber-300" : "bg-slate-700 border-slate-600 text-slate-300"}`}>
                          {t === "full" ? `Full ${sym}${diAction.order.total.toFixed(2)}` : "Partial"}
                        </button>
                      ))}
                    </div>
                    {diRefundType === "partial" && (
                      <input type="number" min="0.01" max={diAction.order.total} step="0.01"
                        value={diRefundAmtStr} onChange={e => setDiRefundAmtStr(e.target.value)}
                        placeholder={`Max ${sym}${diAction.order.total.toFixed(2)}`}
                        className="w-full bg-slate-700 border border-slate-600 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500" />
                    )}
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Return Method</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([{ v: "cash", label: "Cash", Ico: Banknote }, { v: "card", label: "Card", Ico: CreditCard }] as const).map(({ v, label, Ico }) => (
                        <button key={v} onClick={() => setDiRefundMethod(v)}
                          className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition ${diRefundMethod === v ? "bg-amber-500/20 border-amber-500 text-amber-300" : "bg-slate-700 border-slate-600 text-slate-300"}`}>
                          <Ico size={14} /> {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Reason */}
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">
                  {diAction.mode === "void" ? "Void Reason" : "Refund Reason"}
                </p>
                <textarea rows={2} value={diActionReason}
                  onChange={e => { setDiActionReason(e.target.value); setDiActionError(null); }}
                  placeholder={diAction.mode === "void" ? "e.g. Customer cancelled, duplicate order…" : "e.g. Incorrect item, quality issue…"}
                  className="w-full bg-slate-700 border border-slate-600 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-500 resize-none" />
              </div>

              {/* Void warning */}
              {diAction.mode === "void" && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                  <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs">This will cancel the order for Table {diAction.order.tableLabel}. This cannot be undone.</p>
                </div>
              )}

              {diActionError && <p className="text-red-400 text-sm">{diActionError}</p>}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setDiAction(null)}
                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl font-semibold text-sm transition">
                Cancel
              </button>
              <button
                onClick={diAction.mode === "void" ? submitDiVoid : submitDiRefund}
                disabled={diActionLoading || !diActionReason.trim()}
                className={`flex-1 py-3 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 ${diAction.mode === "void" ? "bg-red-600 hover:bg-red-500" : "bg-amber-600 hover:bg-amber-500"}`}>
                {diActionLoading
                  ? <><Loader2 size={15} className="animate-spin" /> Processing…</>
                  : diAction.mode === "void"
                    ? <><AlertTriangle size={15} /> Void Order</>
                    : <><RotateCcw size={15} /> Confirm Refund</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Void + Refund modal ──────────────────────────────────────────── */}
      {voidTarget && (() => {
        const targetSale = sales.find((s) => s.id === voidTarget);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                <div>
                  <h3 className="text-white font-bold">Void &amp; Refund</h3>
                  {targetSale && (
                    <p className="text-slate-400 text-xs mt-0.5">
                      #{targetSale.receiptNo} · {fmt(targetSale.total, settings.currencySymbol)} · {targetSale.staffName}
                    </p>
                  )}
                </div>
                <button onClick={() => setVoidTarget(null)} className="text-slate-400 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Void reason */}
                <div>
                  <label className="text-xs text-slate-400 font-medium mb-1.5 block">Void reason <span className="text-red-400">*</span></label>
                  <input
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="e.g. Customer changed mind, wrong order…"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-red-500 placeholder-slate-500"
                  />
                </div>

                {/* Refund method */}
                <div>
                  <label className="text-xs text-slate-400 font-medium mb-1.5 block">Refund method</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: "cash",  label: "Cash",       icon: Banknote,   color: "border-green-500 bg-green-500/10 text-green-400" },
                      { id: "card",  label: "Card",        icon: CreditCard, color: "border-blue-500  bg-blue-500/10  text-blue-400"  },
                      { id: "none",  label: "No Refund",   icon: X,          color: "border-slate-500 bg-slate-700    text-slate-300" },
                    ] as const).map(({ id, label, icon: Icon, color }) => (
                      <button
                        key={id}
                        onClick={() => setRefundMethod(id)}
                        className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all text-xs font-semibold ${
                          refundMethod === id ? color : "border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500"
                        }`}
                      >
                        <Icon size={16} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Refund amount */}
                {refundMethod !== "none" && (
                  <div>
                    <label className="text-xs text-slate-400 font-medium mb-1.5 block">Refund amount</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">
                        {settings.currencySymbol}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-600 rounded-xl pl-8 pr-4 py-2.5 text-white text-sm outline-none focus:border-orange-500"
                      />
                    </div>
                    {targetSale && parseFloat(refundAmount) < targetSale.total && parseFloat(refundAmount) > 0 && (
                      <p className="text-amber-400 text-xs mt-1">
                        Partial refund — {fmt(targetSale.total - parseFloat(refundAmount), settings.currencySymbol)} retained
                      </p>
                    )}
                  </div>
                )}

                {/* Refund summary banner */}
                {refundMethod !== "none" && parseFloat(refundAmount) > 0 && (
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                    refundMethod === "cash"
                      ? "bg-green-500/10 border-green-500/30 text-green-400"
                      : "bg-blue-500/10 border-blue-500/30 text-blue-400"
                  }`}>
                    {refundMethod === "cash" ? <Banknote size={16} /> : <CreditCard size={16} />}
                    <span className="text-sm font-semibold">
                      Return {fmt(parseFloat(refundAmount) || 0, settings.currencySymbol)} in {refundMethod === "cash" ? "cash to customer" : "card refund"}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="px-5 pb-5 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setVoidTarget(null)}
                  className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmVoid}
                  disabled={!voidReason.trim()}
                  className="py-3 rounded-xl bg-red-500 hover:bg-red-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Void &amp; {refundMethod === "none" ? "No Refund" : `Refund ${fmt(parseFloat(refundAmount) || 0, settings.currencySymbol)}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Customers View ───────────────────────────────────────────────────────────

const PRESET_TAGS = ["VIP", "Regular", "Halal", "Vegan", "Vegetarian", "Gluten-Free", "Allergy", "Staff"];

function CustomersView() {
  const { customers, setCustomers, sales, settings } = usePOS();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<POSCustomer | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "", phone: "", notes: "" });

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editDraft, setEditDraft] = useState({
    name: "", email: "", phone: "", notes: "",
    loyaltyPoints: 0, giftCardBalance: 0, tags: [] as string[], customTag: "",
  });
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const filtered = customers.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) || c.email?.toLowerCase().includes(search.toLowerCase())
  );

  function openEdit(c: POSCustomer) {
    setEditDraft({
      name:           c.name,
      email:          c.email   ?? "",
      phone:          c.phone   ?? "",
      notes:          c.notes   ?? "",
      loyaltyPoints:  c.loyaltyPoints,
      giftCardBalance: c.giftCardBalance,
      tags:           [...c.tags],
      customTag:      "",
    });
    setShowEdit(true);
  }

  function saveEdit() {
    if (!selected || !editDraft.name.trim()) return;
    const updated: POSCustomer = {
      ...selected,
      name:            editDraft.name.trim(),
      email:           editDraft.email.trim()  || undefined,
      phone:           editDraft.phone.trim()  || undefined,
      notes:           editDraft.notes.trim()  || undefined,
      loyaltyPoints:   Math.max(0, editDraft.loyaltyPoints),
      giftCardBalance: Math.max(0, editDraft.giftCardBalance),
      tags:            editDraft.tags,
    };
    setCustomers((prev) => prev.map((c) => c.id === selected.id ? updated : c));
    setSelected(updated);
    setShowEdit(false);
  }

  function deleteCustomer() {
    if (!selected) return;
    setCustomers((prev) => prev.filter((c) => c.id !== selected.id));
    setSelected(null);
    setDeleteConfirm(false);
    setShowEdit(false);
  }

  function toggleTag(tag: string) {
    setEditDraft((d) => ({
      ...d,
      tags: d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag],
    }));
  }

  function addCustomTag() {
    const tag = editDraft.customTag.trim();
    if (!tag || editDraft.tags.includes(tag)) return;
    setEditDraft((d) => ({ ...d, tags: [...d.tags, tag], customTag: "" }));
  }

  function addCustomer() {
    if (!newCustomer.name.trim()) return;
    const c: POSCustomer = {
      id: `pc-${Date.now()}`, name: newCustomer.name.trim(), email: newCustomer.email || undefined,
      phone: newCustomer.phone || undefined, loyaltyPoints: 0, giftCardBalance: 0, totalSpend: 0,
      visitCount: 0, tags: [], notes: newCustomer.notes || undefined, createdAt: new Date().toISOString(),
    };
    setCustomers((prev) => [...prev, c]);
    setNewCustomer({ name: "", email: "", phone: "", notes: "" });
    setShowAdd(false);
  }

  const customerSales = selected ? sales.filter((s) => !s.voided && s.customerId === selected.id) : [];

  return (
    <div className="flex-1 overflow-hidden flex">
      {/* List */}
      <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col border-r border-slate-700/50">
        <div className="p-4 border-b border-slate-700/50 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-bold">Customers</h2>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-colors">
              <UserPlus size={14} /> Add
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers…"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((c) => (
            <button key={c.id} onClick={() => setSelected(c)}
              className={`w-full px-4 py-4 flex items-center gap-3 text-left transition-colors border-b border-slate-800 ${selected?.id === c.id ? "bg-orange-500/10 border-l-2 border-l-orange-500" : "hover:bg-slate-800/50"}`}>
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm flex-shrink-0">
                {getInitials(c.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white text-sm font-semibold truncate">{c.name}</p>
                  {c.tags.includes("VIP") && <Star size={10} className="text-amber-400 flex-shrink-0" />}
                </div>
                <p className="text-slate-400 text-xs mt-0.5">{c.visitCount} visits · {fmt(c.totalSpend, settings.currencySymbol)} spent</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-amber-400 text-xs font-bold">{c.loyaltyPoints} pts</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600">
            <Users size={48} className="mb-3 text-slate-700" />
            <p className="text-sm">Select a customer to view details</p>
          </div>
        ) : (
          <div className="p-6 max-w-2xl">
            {/* Profile header */}
            <div className="flex items-start gap-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-2xl flex-shrink-0">
                {getInitials(selected.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-white font-bold text-xl">{selected.name}</h3>
                  {selected.tags.map((t) => (
                    <span key={t} className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full font-semibold">{t}</span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4 mt-2">
                  {selected.phone && <span className="flex items-center gap-1 text-slate-400 text-sm"><Phone size={13} />{selected.phone}</span>}
                  {selected.email && <span className="flex items-center gap-1 text-slate-400 text-sm"><Mail size={13} />{selected.email}</span>}
                </div>
                {selected.notes && <p className="text-slate-400 text-sm mt-2 italic">&quot;{selected.notes}&quot;</p>}
              </div>
              <button
                onClick={() => openEdit(selected)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-sm font-semibold transition-all flex-shrink-0"
              >
                <Pencil size={14} /> Edit
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: "Total Spend", value: fmt(selected.totalSpend, settings.currencySymbol), color: "text-green-400" },
                { label: "Visits", value: selected.visitCount.toString(), color: "text-blue-400" },
                { label: "Loyalty Points", value: `${selected.loyaltyPoints}`, color: "text-amber-400" },
                { label: "Gift Card", value: fmt(selected.giftCardBalance, settings.currencySymbol), color: "text-purple-400" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-slate-400 text-xs mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Purchase history */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h4 className="text-white font-semibold text-sm mb-4">Purchase History</h4>
              {customerSales.length === 0 ? (
                <p className="text-slate-500 text-sm">No purchases recorded for this customer</p>
              ) : (
                <div className="space-y-2">
                  {customerSales.map((sale) => (
                    <div key={sale.id} className="flex items-center gap-3 py-3 border-b border-slate-700/50 last:border-0">
                      <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-xs flex-shrink-0">✓</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">#{sale.receiptNo} · {sale.items.length} item{sale.items.length !== 1?"s":""}</p>
                        <p className="text-slate-400 text-xs">{fmtDate(sale.date)} · {fmtTime(sale.date)} · {sale.paymentMethod}</p>
                      </div>
                      <p className="text-white font-bold text-sm flex-shrink-0">{fmt(sale.total, settings.currencySymbol)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Edit customer modal ─────────────────────────────────────────── */}
      {showEdit && selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">
                  {getInitials(editDraft.name || selected.name)}
                </div>
                <h3 className="text-white font-bold">Edit Customer</h3>
              </div>
              <button onClick={() => setShowEdit(false)} className="text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Contact fields */}
              <div className="space-y-3">
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Contact</h4>
                {[
                  { key: "name",  label: "Full Name *",  placeholder: "Enter name",              type: "text" },
                  { key: "phone", label: "Phone",         placeholder: "07700 000000",            type: "tel" },
                  { key: "email", label: "Email",         placeholder: "customer@example.com",   type: "email" },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                    <input
                      type={f.type}
                      value={editDraft[f.key as "name" | "phone" | "email"]}
                      onChange={(e) => setEditDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Notes</label>
                  <textarea
                    rows={2}
                    value={editDraft.notes}
                    onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                    placeholder="Dietary requirements, preferences…"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500 resize-none"
                  />
                </div>
              </div>

              {/* Tags */}
              <div className="space-y-2">
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Tags</h4>
                <div className="flex flex-wrap gap-2">
                  {PRESET_TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                        editDraft.tags.includes(tag)
                          ? "bg-orange-500 border-orange-500 text-white"
                          : "bg-slate-700 border-slate-600 text-slate-400 hover:border-slate-500 hover:text-white"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                {/* Custom tag */}
                <div className="flex gap-2">
                  <input
                    value={editDraft.customTag}
                    onChange={(e) => setEditDraft((d) => ({ ...d, customTag: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }}
                    placeholder="Custom tag…"
                    className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                  <button
                    onClick={addCustomTag}
                    disabled={!editDraft.customTag.trim()}
                    className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                {/* Show active custom tags (non-preset) */}
                {editDraft.tags.filter((t) => !PRESET_TAGS.includes(t)).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {editDraft.tags.filter((t) => !PRESET_TAGS.includes(t)).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-slate-600 border border-slate-500 text-slate-300 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-400 transition-all"
                      >
                        {tag} <X size={10} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Loyalty & Gift Card */}
              <div className="space-y-3">
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Loyalty & Gift Card</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Loyalty Points</label>
                    <input
                      type="number" min="0" step="1"
                      value={editDraft.loyaltyPoints}
                      onChange={(e) => setEditDraft((d) => ({ ...d, loyaltyPoints: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-amber-400 font-bold text-sm outline-none focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Gift Card ({settings.currencySymbol})</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={editDraft.giftCardBalance}
                      onChange={(e) => setEditDraft((d) => ({ ...d, giftCardBalance: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-purple-400 font-bold text-sm outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-700 space-y-2 flex-shrink-0">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="py-3 rounded-xl border border-red-500/40 text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} /> Delete
                </button>
                <button
                  onClick={saveEdit}
                  disabled={!editDraft.name.trim()}
                  className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Save size={14} /> Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete customer confirm ──────────────────────────────────────── */}
      {deleteConfirm && selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <h3 className="text-white font-bold mb-1">Delete customer?</h3>
            <p className="text-slate-400 text-sm mb-1">
              <span className="text-white font-semibold">{selected.name}</span> will be permanently removed.
            </p>
            <p className="text-slate-500 text-xs mb-6">
              Their purchase history ({customerSales.length} sale{customerSales.length !== 1 ? "s" : ""}) will remain in the sales log.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteConfirm(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={deleteCustomer} className="py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add customer modal ───────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">New Customer</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-3 mb-5">
              {[
                { key: "name", label: "Full Name *", placeholder: "Enter name" },
                { key: "phone", label: "Phone", placeholder: "07700 000000" },
                { key: "email", label: "Email", placeholder: "customer@example.com" },
                { key: "notes", label: "Notes", placeholder: "Dietary requirements, preferences…" },
              ].map((field) => (
                <div key={field.key}>
                  <label className="text-xs text-slate-400 mb-1 block">{field.label}</label>
                  <input value={(newCustomer as Record<string,string>)[field.key]}
                    onChange={(e) => setNewCustomer((p) => ({ ...p, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShowAdd(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={addCustomer} disabled={!newCustomer.name.trim()} className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Staff View ────────────────────────────────────────────────────────────────

function StaffView() {
  const { staff, setStaff, clockEntries, clockIn, clockOut, isClocked, currentStaff } = usePOS();
  const [showAdd, setShowAdd] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: "", email: "", role: "cashier" as "admin"|"manager"|"cashier", pin: "", hourlyRate: "" });
  const COLORS = ["#7c3aed","#0891b2","#16a34a","#dc2626","#ea580c","#0284c7","#9333ea","#be185d"];
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n)=>n+1), 10000); return () => clearInterval(id); }, []);

  // Edit state
  const [editingStaff, setEditingStaff] = useState<POSStaff | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", email: "", role: "cashier" as "admin"|"manager"|"cashier", pin: "", hourlyRate: "" });

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  function addStaff() {
    if (!newStaff.name.trim() || newStaff.pin.length !== 4) return;
    const s: POSStaff = {
      id: `staff-${Date.now()}`, name: newStaff.name.trim(), email: newStaff.email,
      role: newStaff.role, pin: newStaff.pin, active: true,
      permissions: ROLE_PERMISSIONS[newStaff.role],
      hourlyRate: parseFloat(newStaff.hourlyRate) || undefined,
      avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
      createdAt: new Date().toISOString(),
    };
    setStaff((prev) => [...prev, s]);
    setNewStaff({ name: "", email: "", role: "cashier", pin: "", hourlyRate: "" });
    setShowAdd(false);
  }

  function openEdit(member: POSStaff) {
    setEditingStaff(member);
    setEditDraft({ name: member.name, email: member.email ?? "", role: member.role, pin: member.pin, hourlyRate: member.hourlyRate?.toString() ?? "" });
  }

  function saveEdit() {
    if (!editingStaff || !editDraft.name.trim() || editDraft.pin.length !== 4) return;
    setStaff((prev) => prev.map((s) => s.id === editingStaff.id
      ? { ...s, name: editDraft.name.trim(), email: editDraft.email, role: editDraft.role,
          pin: editDraft.pin, hourlyRate: parseFloat(editDraft.hourlyRate) || undefined,
          permissions: ROLE_PERMISSIONS[editDraft.role] }
      : s
    ));
    setEditingStaff(null);
  }

  function deleteStaff(staffId: string) {
    setStaff((prev) => prev.filter((s) => s.id !== staffId));
    setDeleteConfirm(null);
  }

  function toggleActive(staffId: string) {
    setStaff((prev) => prev.map((s) => s.id === staffId ? { ...s, active: !s.active } : s));
  }

  // Today's clock entries
  const today = new Date().toDateString();
  const todayEntries = clockEntries.filter((e) => new Date(e.clockIn).toDateString() === today);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-xl">Staff Management</h2>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
            <UserPlus size={16} /> Add Staff
          </button>
        </div>

        {/* Clock in/out panel */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2"><Clock size={16} className="text-orange-400" /> Today&apos;s Attendance</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {staff.filter((s) => s.active).map((member) => {
              const clocked = isClocked(member.id);
              const lastEntry = [...clockEntries].reverse().find((e) => e.staffId === member.id && new Date(e.clockIn).toDateString() === today);
              const minutesWorked = lastEntry
                ? clocked
                  ? Math.floor((Date.now() - new Date(lastEntry.clockIn).getTime()) / 60000)
                  : (lastEntry.totalMinutes ?? 0)
                : null;

              return (
                <div key={member.id} className="bg-slate-700/50 border border-slate-600 rounded-xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm text-white flex-shrink-0" style={{ backgroundColor: member.avatarColor }}>
                    {getInitials(member.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold">{member.name}</p>
                    <p className="text-slate-400 text-xs capitalize">{member.role}</p>
                    {minutesWorked !== null && (
                      <p className="text-slate-400 text-xs mt-0.5 flex items-center gap-1">
                        <Timer size={10} /> {Math.floor(minutesWorked/60)}h {minutesWorked%60}m {clocked ? "(ongoing)" : ""}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => clocked ? clockOut(member.id) : clockIn(member.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                      clocked
                        ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                        : "bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30"
                    }`}
                  >
                    {clocked ? "Clock Out" : "Clock In"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Staff list */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h3 className="text-white font-semibold text-sm">All Staff Members</h3>
          </div>
          <div className="divide-y divide-slate-700/50">
            {staff.map((member) => (
              <div key={member.id} className="px-5 py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm text-white flex-shrink-0 opacity-100" style={{ backgroundColor: member.avatarColor, opacity: member.active ? 1 : 0.5 }}>
                  {getInitials(member.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-semibold ${member.active ? "text-white" : "text-slate-500"}`}>{member.name}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize ${
                      member.role === "admin" ? "bg-purple-500/20 text-purple-400" :
                      member.role === "manager" ? "bg-blue-500/20 text-blue-400" :
                      "bg-slate-600 text-slate-400"
                    }`}>{member.role}</span>
                  </div>
                  <p className="text-slate-400 text-xs mt-0.5">{member.email} · PIN: {member.pin.split("").map(()=>"•").join("")}</p>
                  {member.hourlyRate && <p className="text-slate-500 text-xs">£{member.hourlyRate}/hr</p>}
                </div>
                <div className="flex items-center gap-2">
                  {isClocked(member.id) && (
                    <span className="flex items-center gap-1 text-[10px] bg-green-500/20 text-green-400 px-2 py-1 rounded-full font-semibold">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Clocked in
                    </span>
                  )}
                  <button
                    onClick={() => toggleActive(member.id)}
                    disabled={member.id === currentStaff?.id}
                    title={member.id === currentStaff?.id ? "Cannot deactivate yourself" : ""}
                    className={`transition-colors ${member.id === currentStaff?.id ? "opacity-30 cursor-not-allowed" : "hover:text-orange-400"}`}
                  >
                    {member.active
                      ? <ToggleRight size={24} className="text-green-400" />
                      : <ToggleLeft size={24} className="text-slate-500" />}
                  </button>
                  <button
                    onClick={() => openEdit(member)}
                    title="Edit staff member"
                    className="text-slate-400 hover:text-orange-400 transition-colors"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(member.id)}
                    disabled={member.id === currentStaff?.id}
                    title={member.id === currentStaff?.id ? "Cannot delete yourself" : "Delete staff member"}
                    className={`transition-colors ${member.id === currentStaff?.id ? "opacity-30 cursor-not-allowed" : "text-slate-400 hover:text-red-400"}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Clock history */}
        {todayEntries.length > 0 && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2"><ClockIcon size={16} className="text-slate-400" /> Today&apos;s Clock Entries</h3>
            <div className="space-y-2">
              {todayEntries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-slate-700/50 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0">
                    {getInitials(entry.staffName)}
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">{entry.staffName}</p>
                    <p className="text-slate-400 text-xs">In: {fmtTime(entry.clockIn)} {entry.clockOut ? `· Out: ${fmtTime(entry.clockOut)}` : "· Still clocked in"}</p>
                  </div>
                  {entry.totalMinutes !== undefined && (
                    <p className="text-slate-300 text-sm font-semibold">{Math.floor(entry.totalMinutes/60)}h {entry.totalMinutes%60}m</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add staff modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Add Staff Member</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Full Name *</label>
                <input value={newStaff.name} onChange={(e) => setNewStaff((p) => ({ ...p, name: e.target.value }))} placeholder="Staff name"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Email</label>
                <input value={newStaff.email} onChange={(e) => setNewStaff((p) => ({ ...p, email: e.target.value }))} placeholder="email@example.com"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Role</label>
                <select value={newStaff.role} onChange={(e) => setNewStaff((p) => ({ ...p, role: e.target.value as "admin"|"manager"|"cashier" }))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500">
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">4-digit PIN *</label>
                <input type="password" maxLength={4} value={newStaff.pin} onChange={(e) => setNewStaff((p) => ({ ...p, pin: e.target.value.replace(/\D/g,"") }))} placeholder="••••"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Hourly Rate (£)</label>
                <input type="number" step="0.5" value={newStaff.hourlyRate} onChange={(e) => setNewStaff((p) => ({ ...p, hourlyRate: e.target.value }))} placeholder="10.00"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShowAdd(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={addStaff} disabled={!newStaff.name.trim() || newStaff.pin.length !== 4}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit staff modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Edit Staff Member</h3>
              <button onClick={() => setEditingStaff(null)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Full Name *</label>
                <input value={editDraft.name} onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Staff name"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Email</label>
                <input value={editDraft.email} onChange={(e) => setEditDraft((p) => ({ ...p, email: e.target.value }))} placeholder="email@example.com"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Role</label>
                <select value={editDraft.role} onChange={(e) => setEditDraft((p) => ({ ...p, role: e.target.value as "admin"|"manager"|"cashier" }))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500">
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">4-digit PIN *</label>
                <input type="password" maxLength={4} value={editDraft.pin} onChange={(e) => setEditDraft((p) => ({ ...p, pin: e.target.value.replace(/\D/g,"") }))} placeholder="••••"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Hourly Rate (£)</label>
                <input type="number" step="0.5" value={editDraft.hourlyRate} onChange={(e) => setEditDraft((p) => ({ ...p, hourlyRate: e.target.value }))} placeholder="10.00"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setEditingStaff(null)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={!editDraft.name.trim() || editDraft.pin.length !== 4}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-5 shadow-2xl text-center">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-400" />
            </div>
            <h3 className="text-white font-bold mb-1">Delete Staff Member?</h3>
            <p className="text-slate-400 text-sm mb-5">
              {staff.find((s) => s.id === deleteConfirm)?.name} will be permanently removed. This cannot be undone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={() => deleteStaff(deleteConfirm)} className="py-3 rounded-xl bg-red-500 hover:bg-red-400 text-white font-semibold text-sm transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── POS Printer Panel ────────────────────────────────────────────────────────

const POS_CONNECTION_OPTIONS = [
  { value: "network"   as const, label: "Network / IP",  sub: "ESC/POS over TCP — same LAN as server" },
  { value: "bluetooth" as const, label: "Bluetooth",     sub: "Classic BT (SPP) — Android app, works offline" },
  { value: "usb"       as const, label: "USB (direct)",  sub: "Web USB — printer plugged into this device" },
  { value: "browser"   as const, label: "Browser print", sub: "window.print() — any OS-visible printer" },
] as const;

type POSConnectionMode = "network" | "bluetooth" | "usb" | "browser";

function POSPrinterPanel({ appSettings }: { appSettings: import("@/types").AdminSettings }) {
  const { updateSettings } = useApp();
  const p = appSettings.printer;

  const [draft, setDraft] = useState({
    connection:       (p.connection ?? "network") as POSConnectionMode,
    ip:               p.ip,
    port:             p.port,
    bluetoothAddress: p.bluetoothAddress ?? "",
    bluetoothName:    p.bluetoothName    ?? "",
  });
  const [testState,  setTestState]  = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [testError,  setTestError]  = useState("");
  const [saved,      setSaved]      = useState(false);
  const [btDevices,  setBtDevices]  = useState<import("@/lib/capacitorBridge").BluetoothDevice[]>([]);
  const [btScanning, setBtScanning] = useState(false);
  const [onAndroid,  setOnAndroid]  = useState(false);

  useEffect(() => {
    import("@/lib/capacitorBridge").then(({ isCapacitorAndroid }) => {
      setOnAndroid(isCapacitorAndroid());
    });
  }, []);

  async function scanBluetooth() {
    setBtScanning(true);
    const { getBluetoothPairedDevices } = await import("@/lib/capacitorBridge");
    const devices = await getBluetoothPairedDevices();
    setBtDevices(devices);
    setBtScanning(false);
    if (devices.length === 0) setTestError("No paired devices found. Pair the printer in Android Settings first.");
  }

  function handleSave() {
    updateSettings({ printer: { ...p, ...draft } });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleTest() {
    setTestState("sending");
    setTestError("");

    const previewSettings = { ...appSettings, printer: { ...p, ...draft } };

    if (draft.connection === "network") {
      if (!draft.ip.trim()) { setTestState("error"); setTestError("Enter a printer IP address first."); return; }
      const bytes  = buildTestReceipt(previewSettings);
      const result = await sendToPrinter(bytes, draft.ip.trim(), draft.port);
      if (result.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 5000); }
      else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
      return;
    }

    if (draft.connection === "bluetooth") {
      if (!draft.bluetoothAddress.trim()) { setTestState("error"); setTestError("Select a Bluetooth device first."); return; }
      const { sendBluetooth } = await import("@/lib/capacitorBridge");
      const bytes  = buildTestReceipt(previewSettings);
      const result = await sendBluetooth(draft.bluetoothAddress, bytes);
      if (result.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 5000); }
      else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
      return;
    }

    if (draft.connection === "usb") {
      const bytes  = buildTestReceipt(previewSettings);
      const result = await sendToPrinterUSB(bytes);
      if (result.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 5000); }
      else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
      return;
    }

    // browser
    const dummyOrder = {
      id: "TEST-001", date: new Date().toISOString(),
      items: [{ name: "Test Item", qty: 1, price: 0 }],
      total: 0, fulfillment: "collection" as const,
      status: "pending" as const, customerId: "", paymentMethod: "Test",
    };
    const result = printReceiptBrowser(dummyOrder, previewSettings);
    if (result.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 5000); }
    else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <Printer size={16} className="text-slate-400" /> Receipt Printer
        </h3>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          p.enabled ? "bg-green-500/20 text-green-400" : "bg-slate-700 text-slate-400"
        }`}>{p.enabled ? "Enabled" : "Disabled"}</span>
      </div>

      {!p.enabled && (
        <p className="text-slate-400 text-xs">
          Printer is disabled. Enable it in{" "}
          <span className="text-orange-400 font-medium">Admin → Integrations → Thermal Printer</span>.
        </p>
      )}

      {/* Connection type */}
      <div className="space-y-1.5">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Connection</p>
        {POS_CONNECTION_OPTIONS.map(({ value, label, sub }) => (
          <button key={value} onClick={() => setDraft((d) => ({ ...d, connection: value }))}
            className={`w-full text-left px-3 py-2.5 rounded-xl border transition text-sm ${
              draft.connection === value
                ? "border-orange-500 bg-orange-500/10 text-orange-300"
                : "border-slate-600 text-slate-300 hover:border-slate-500"
            }`}>
            <span className="font-semibold">{label}</span>
            <span className="text-xs text-slate-400 ml-2">{sub}</span>
          </button>
        ))}
      </div>

      {/* Network IP fields */}
      {draft.connection === "network" && (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-slate-400 mb-1 block">Printer IP</label>
            <input value={draft.ip} onChange={(e) => setDraft((d) => ({ ...d, ip: e.target.value }))}
              placeholder="192.168.1.100"
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-sm font-mono outline-none focus:border-orange-500 placeholder-slate-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Port</label>
            <input type="number" value={draft.port} min={1} max={65535}
              onChange={(e) => setDraft((d) => ({ ...d, port: Number(e.target.value) }))}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-sm font-mono outline-none focus:border-orange-500" />
          </div>
        </div>
      )}

      {/* Bluetooth device selector */}
      {draft.connection === "bluetooth" && (
        <div className="space-y-2">
          {draft.bluetoothAddress ? (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2.5">
              <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-green-300 text-xs font-semibold truncate">{draft.bluetoothName || "Unnamed device"}</p>
                <p className="text-green-500 text-[11px] font-mono">{draft.bluetoothAddress}</p>
              </div>
              <button onClick={() => setDraft((d) => ({ ...d, bluetoothAddress: "", bluetoothName: "" }))}
                className="text-slate-400 hover:text-red-400 text-xs transition">Clear</button>
            </div>
          ) : (
            <p className="text-slate-400 text-xs">No device selected.</p>
          )}

          {onAndroid ? (
            <>
              <button onClick={scanBluetooth} disabled={btScanning}
                className="w-full py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                {btScanning ? <><Loader2 size={14} className="animate-spin" /> Scanning…</> : "Scan paired devices"}
              </button>
              {btDevices.length > 0 && (
                <div className="border border-slate-600 rounded-xl overflow-hidden divide-y divide-slate-700">
                  {btDevices.map((dev) => (
                    <button key={dev.address}
                      onClick={() => setDraft((d) => ({ ...d, bluetoothAddress: dev.address, bluetoothName: dev.name }))}
                      className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition ${
                        draft.bluetoothAddress === dev.address ? "bg-orange-500/10" : "hover:bg-slate-700"
                      }`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-semibold truncate">{dev.name}</p>
                        <p className="text-slate-400 text-xs font-mono">{dev.address}</p>
                      </div>
                      {draft.bluetoothAddress === dev.address && <CheckCircle2 size={14} className="text-orange-400 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-slate-400 text-xs bg-slate-900 rounded-xl px-3 py-2.5">
              Bluetooth is only available in the <span className="text-orange-400 font-medium">Android app</span>. Use Network or Browser print on this device.
            </p>
          )}
        </div>
      )}

      {/* USB hint */}
      {draft.connection === "usb" && (
        <p className="text-xs text-slate-400">Chrome/Edge only. Click <span className="text-white font-medium">Test print</span> to select your USB printer. The browser will remember it.</p>
      )}

      {/* Browser hint */}
      {draft.connection === "browser" && (
        <p className="text-xs text-slate-400">Opens the browser print dialog. Allow pop-ups for this page. Set margins to None in the dialog.</p>
      )}

      {/* Test feedback */}
      {testState === "ok" && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2.5">
          <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
          <p className="text-green-400 text-xs font-semibold">Test page sent successfully!</p>
        </div>
      )}
      {testState === "error" && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-400 text-xs break-all">{testError}</p>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
            saved ? "bg-green-500/20 text-green-400" : "bg-orange-500 hover:bg-orange-400 text-white"
          }`}>
          {saved ? <><CheckCircle2 size={14} /> Saved</> : <><Save size={14} /> Save</>}
        </button>
        <button onClick={handleTest} disabled={testState === "sending"}
          className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
          {testState === "sending"
            ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
            : <><Zap size={14} /> Test print</>}
        </button>
      </div>
    </div>
  );
}

// ─── Settings View ─────────────────────────────────────────────────────────────

function SettingsView() {
  const { settings, setSettings, products, setProducts, categories, setCategories,
          sales, salesRetentionDays, exportSales, purgeOldSales } = usePOS();
  const { settings: appSettings } = useApp();
  const [local, setLocal] = useState({ ...settings });
  const [tab, setTab] = useState<"general"|"menu"|"receipt"|"hardware">("general");
  const [editProduct, setEditProduct] = useState<POSProduct | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: "", categoryId: "", price: "", cost: "", emoji: "", imageUrl: "", popular: false,
    offerActive: false, offerType: "percent" as POSOffer["type"],
    offerValue: "", offerLabel: "", offerStart: "", offerEnd: "",
    offerBuyQty: "", offerFreeQty: "", offerMinQty: "",
  });
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "", categoryId: "", price: "", cost: "", emoji: "🍽️", imageUrl: "",
    offerActive: false, offerType: "percent" as POSOffer["type"],
    offerValue: "", offerLabel: "", offerStart: "", offerEnd: "",
    offerBuyQty: "", offerFreeQty: "", offerMinQty: "",
  });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [menuTab, setMenuTab] = useState<"items"|"categories">("items");

  // ── Category management state ──────────────────────────────────────────────
  const [editCategory, setEditCategory] = useState<POSCategory | null>(null);
  const [catDraft, setCatDraft] = useState({ name: "", emoji: "", color: "#f97316" });
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: "", emoji: "🍽️", color: "#f97316" });
  const [deleteCatConfirm, setDeleteCatConfirm] = useState<string | null>(null);

  const PRESET_COLORS = [
    "#f97316","#8b5cf6","#f59e0b","#06b6d4","#10b981","#ec4899","#3b82f6",
    "#ef4444","#84cc16","#14b8a6","#a855f7","#f43f5e",
  ];

  function openEditCategory(cat: POSCategory) {
    setEditCategory(cat);
    setCatDraft({ name: cat.name, emoji: cat.emoji, color: cat.color });
  }

  function saveCategory() {
    if (!editCategory || !catDraft.name.trim()) return;
    setCategories((prev) => prev.map((c) =>
      c.id === editCategory.id
        ? { ...c, name: catDraft.name.trim(), emoji: catDraft.emoji || "🍽️", color: catDraft.color }
        : c
    ));
    setEditCategory(null);
  }

  function deleteCategory(id: string) {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    // Move orphaned products to first remaining category or leave uncategorised
    const remaining = categories.filter((c) => c.id !== id);
    if (remaining.length > 0) {
      setProducts((prev) => prev.map((p) =>
        p.categoryId === id ? { ...p, categoryId: remaining[0].id } : p
      ));
    }
    setDeleteCatConfirm(null);
    setEditCategory(null);
  }

  function addCategory() {
    if (!newCategory.name.trim()) return;
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.order), -1);
    const cat: POSCategory = {
      id: `cat-${Date.now()}`,
      name: newCategory.name.trim(),
      emoji: newCategory.emoji || "🍽️",
      color: newCategory.color,
      order: maxOrder + 1,
    };
    setCategories((prev) => [...prev, cat]);
    setNewCategory({ name: "", emoji: "🍽️", color: "#f97316" });
    setShowAddCategory(false);
  }

  function moveCategoryUp(id: string) {
    const sorted = [...categories].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((c) => c.id === id);
    if (idx <= 0) return;
    const updated = sorted.map((c, i) => {
      if (i === idx - 1) return { ...c, order: sorted[idx].order };
      if (i === idx)     return { ...c, order: sorted[idx - 1].order };
      return c;
    });
    setCategories(updated);
  }

  function moveCategoryDown(id: string) {
    const sorted = [...categories].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((c) => c.id === id);
    if (idx < 0 || idx >= sorted.length - 1) return;
    const updated = sorted.map((c, i) => {
      if (i === idx)     return { ...c, order: sorted[idx + 1].order };
      if (i === idx + 1) return { ...c, order: sorted[idx].order };
      return c;
    });
    setCategories(updated);
  }

  function saveSettings() { setSettings(local); }

  function toggleProduct(id: string) {
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, active: !p.active } : p));
  }

  function openEdit(product: POSProduct) {
    setEditProduct(product);
    const o = product.offer;
    setEditDraft({
      name:         product.name,
      categoryId:   product.categoryId,
      price:        product.price.toString(),
      cost:         product.cost?.toString() ?? "",
      emoji:        product.emoji ?? "🍽️",
      imageUrl:     product.imageUrl ?? "",
      popular:      product.popular ?? false,
      offerActive:  o?.active    ?? false,
      offerType:    o?.type      ?? "percent",
      offerValue:   o?.value?.toString()   ?? "",
      offerLabel:   o?.label    ?? "",
      offerStart:   o?.startDate ?? "",
      offerEnd:     o?.endDate   ?? "",
      offerBuyQty:  o?.buyQty?.toString()  ?? "",
      offerFreeQty: o?.freeQty?.toString() ?? "",
      offerMinQty:  o?.minQty?.toString()  ?? "",
    });
  }

  function buildOffer(d: {
    offerValue: string; offerType: POSOffer["type"]; offerLabel: string;
    offerActive: boolean; offerStart: string; offerEnd: string;
    offerBuyQty: string; offerFreeQty: string; offerMinQty: string;
  }): POSOffer | undefined {
    const needsValue = ["percent","fixed","price","multibuy","qty_discount"].includes(d.offerType);
    const needsBuy   = ["bogo","multibuy"].includes(d.offerType);
    if (needsValue && !d.offerValue) return undefined;
    if (needsBuy   && !d.offerBuyQty) return undefined;
    if (d.offerType === "bogo" && !d.offerFreeQty) return undefined;
    if (d.offerType === "qty_discount" && !d.offerMinQty) return undefined;
    return {
      type:      d.offerType,
      value:     parseFloat(d.offerValue)   || 0,
      label:     d.offerLabel.trim()        || undefined,
      active:    d.offerActive,
      startDate: d.offerStart               || undefined,
      endDate:   d.offerEnd                 || undefined,
      buyQty:    d.offerBuyQty  ? parseInt(d.offerBuyQty)  : undefined,
      freeQty:   d.offerFreeQty ? parseInt(d.offerFreeQty) : undefined,
      minQty:    d.offerMinQty  ? parseInt(d.offerMinQty)  : undefined,
    };
  }

  function saveEdit() {
    if (!editProduct || !editDraft.name.trim() || !editDraft.categoryId || !editDraft.price) return;
    setProducts((prev) => prev.map((p) =>
      p.id === editProduct.id
        ? {
            ...p,
            name:       editDraft.name.trim(),
            categoryId: editDraft.categoryId,
            price:      parseFloat(editDraft.price),
            cost:       editDraft.cost ? parseFloat(editDraft.cost) : undefined,
            emoji:      editDraft.imageUrl ? undefined : (editDraft.emoji || "🍽️"),
            imageUrl:   editDraft.imageUrl || undefined,
            popular:    editDraft.popular,
            offer:      buildOffer(editDraft),
          }
        : p
    ));
    setEditProduct(null);
  }

  function deleteProduct(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setDeleteConfirm(null);
    setEditProduct(null);
  }

  function addProduct() {
    if (!newProduct.name.trim() || !newProduct.categoryId || !newProduct.price) return;
    const p: POSProduct = {
      id: `p-${Date.now()}`, categoryId: newProduct.categoryId, name: newProduct.name.trim(),
      price: parseFloat(newProduct.price), cost: parseFloat(newProduct.cost) || undefined,
      emoji: newProduct.imageUrl ? undefined : (newProduct.emoji || "🍽️"),
      imageUrl: newProduct.imageUrl || undefined,
      color: "#e2e8f0", trackStock: false, active: true,
      offer: buildOffer(newProduct),
    };
    setProducts((prev) => [...prev, p]);
    setNewProduct({ name: "", categoryId: "", price: "", cost: "", emoji: "🍽️", imageUrl: "",
      offerActive: false, offerType: "percent", offerValue: "", offerLabel: "", offerStart: "", offerEnd: "",
      offerBuyQty: "", offerFreeQty: "", offerMinQty: "" });
    setShowAddProduct(false);
  }

  function handleImageFile(file: File, setter: (url: string) => void) {
    const reader = new FileReader();
    reader.onload = (e) => { if (e.target?.result) setter(e.target.result as string); };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h2 className="text-white font-bold text-xl">POS Settings</h2>

        {/* Sub-tabs */}
        <div className="flex gap-1.5 bg-slate-800/50 p-1 rounded-xl border border-slate-700">
          {(["general","menu","receipt","hardware"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${tab === t ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === "general" && (
          <div className="space-y-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
              <h3 className="text-white font-semibold text-sm">Business</h3>
              {/* Business Name — POS override; admin Restaurant Branding is the source of truth */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Business Name (POS override)</label>
                <input type="text" value={local.businessName ?? ""}
                  onChange={(e) => setLocal((p) => ({ ...p, businessName: e.target.value }))}
                  placeholder={appSettings.restaurant?.name || "Restaurant Name"}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                <p className="text-[11px] text-slate-500 mt-1">Leave blank to use your restaurant branding name automatically.</p>
              </div>
              {[
                { key: "location", label: "Location / Branch", type: "text" },
                { key: "currencySymbol", label: "Currency Symbol", type: "text" },
                { key: "receiptFooter", label: "Receipt Footer", type: "textarea" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                  {f.type === "textarea" ? (
                    <textarea rows={3} value={(local as Record<string,unknown>)[f.key] as string}
                      onChange={(e) => setLocal((p) => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 resize-none" />
                  ) : (
                    <input type={f.type} value={(local as Record<string,unknown>)[f.key] as string}
                      onChange={(e) => setLocal((p) => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500" />
                  )}
                </div>
              ))}
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-5">
              <h3 className="text-white font-semibold text-sm">Tax & Payments</h3>

              {/* Tax Rate */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Tax Rate (%)</label>
                  <input type="number" step="0.5" value={local.taxRate} onChange={(e) => setLocal((p) => ({ ...p, taxRate: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Max Discount (%)</label>
                  <input type="number" min={0} max={100} value={local.maxDiscountPercent} onChange={(e) => setLocal((p) => ({ ...p, maxDiscountPercent: parseInt(e.target.value) || 0 }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500" />
                </div>
              </div>

              {/* Tax Mode */}
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-3">Tax Mode</p>
                <div className="grid grid-cols-2 gap-3">
                  {/* Inclusive VAT */}
                  <button
                    onClick={() => setLocal((p) => ({ ...p, taxInclusive: true }))}
                    className={`text-left p-4 rounded-2xl border-2 transition-all ${
                      local.taxInclusive
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-600 bg-slate-900 hover:border-slate-500"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        local.taxInclusive ? "border-blue-400" : "border-slate-500"
                      }`}>
                        {local.taxInclusive && <div className="w-2 h-2 rounded-full bg-blue-400" />}
                      </div>
                      <span className={`text-sm font-bold ${local.taxInclusive ? "text-blue-300" : "text-slate-300"}`}>
                        Inclusive VAT
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed pl-6">
                      Prices <strong className="text-slate-300">include</strong> VAT. Extracted for display only — totals unchanged.
                    </p>
                  </button>

                  {/* Exclusive VAT */}
                  <button
                    onClick={() => setLocal((p) => ({ ...p, taxInclusive: false }))}
                    className={`text-left p-4 rounded-2xl border-2 transition-all ${
                      !local.taxInclusive
                        ? "border-orange-500 bg-orange-500/10"
                        : "border-slate-600 bg-slate-900 hover:border-slate-500"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        !local.taxInclusive ? "border-orange-400" : "border-slate-500"
                      }`}>
                        {!local.taxInclusive && <div className="w-2 h-2 rounded-full bg-orange-400" />}
                      </div>
                      <span className={`text-sm font-bold ${!local.taxInclusive ? "text-orange-300" : "text-slate-300"}`}>
                        Exclusive VAT
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed pl-6">
                      Prices are <strong className="text-slate-300">ex-VAT</strong>. VAT added on top — totals increase.
                    </p>
                  </button>
                </div>

                {/* Mode hint */}
                <div className={`mt-3 text-center text-xs font-semibold py-2 rounded-xl ${
                  local.taxInclusive
                    ? "bg-blue-900/30 text-blue-300"
                    : "bg-orange-900/30 text-orange-300"
                }`}>
                  {local.taxInclusive
                    ? `Inclusive VAT — ${local.taxRate}% extracted from price at checkout`
                    : `Exclusive VAT — ${local.taxRate}% added on top at checkout`}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">Require PIN for Discounts</p>
                  <p className="text-slate-400 text-xs">Managers must confirm discounts</p>
                </div>
                <button onClick={() => setLocal((p) => ({ ...p, requirePinForDiscount: !p.requirePinForDiscount }))} className="transition-colors">
                  {local.requirePinForDiscount ? <ToggleRight size={28} className="text-green-400" /> : <ToggleLeft size={28} className="text-slate-500" />}
                </button>
              </div>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
              <h3 className="text-white font-semibold text-sm">Loyalty Program</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Points per £</label>
                  <input type="number" min={0} step={1} value={local.loyaltyPointsPerPound} onChange={(e) => setLocal((p) => ({ ...p, loyaltyPointsPerPound: parseInt(e.target.value) || 0 }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Point value (£)</label>
                  <input type="number" min={0} step={0.001} value={local.loyaltyPointsValue} onChange={(e) => setLocal((p) => ({ ...p, loyaltyPointsValue: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500" />
                </div>
              </div>
            </div>

            <button onClick={saveSettings} className="w-full py-3.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-bold text-sm transition-all flex items-center justify-center gap-2">
              <Save size={16} /> Save Settings
            </button>
          </div>
        )}

        {tab === "menu" && (
          <div className="space-y-4">
            {/* Items / Categories sub-tabs */}
            <div className="flex gap-2 bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
              {(["items","categories"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setMenuTab(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${menuTab === t ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
                >
                  {t === "items" ? `Items (${products.length})` : `Categories (${categories.length})`}
                </button>
              ))}
            </div>

            {/* ── Items list ───────────────────────────────────────────── */}
            {menuTab === "items" && (
              <>
                <div className="flex justify-end">
                  <button onClick={() => setShowAddProduct(true)} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
                    <Plus size={16} /> Add Item
                  </button>
                </div>
                {categories.sort((a,b)=>a.order-b.order).map((cat) => {
                  const catProducts = products.filter((p) => p.categoryId === cat.id);
                  if (catProducts.length === 0) return null;
                  return (
                    <div key={cat.id} className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-700 flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                        <p className="text-white font-semibold text-sm">{cat.emoji} {cat.name}</p>
                        <span className="text-slate-500 text-xs ml-auto">{catProducts.length} items</span>
                      </div>
                      <div className="divide-y divide-slate-700/50">
                        {catProducts.map((product) => (
                          <div key={product.id} className="px-5 py-3 flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl flex-shrink-0 overflow-hidden" style={{ backgroundColor: product.imageUrl ? undefined : product.color }}>
                              {product.imageUrl
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                                : <span className="w-full h-full flex items-center justify-center text-base">{product.emoji ?? "🍽️"}</span>
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`text-sm font-semibold ${product.active ? "text-white" : "text-slate-500"}`}>{product.name}</p>
                                {product.popular && <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full font-medium">Popular</span>}
                                {product.offer?.active && <span className="text-[10px] bg-amber-400/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">{product.offer.label?.trim() || (product.offer.type === "percent" ? `${product.offer.value}% OFF` : product.offer.type === "fixed" ? `${settings.currencySymbol}${product.offer.value} OFF` : "SPECIAL")}</span>}
                              </div>
                              <p className="text-slate-400 text-xs">
                                {(() => { const op = getOfferPrice(product); return op !== null ? <><span className="text-amber-400 font-semibold">{fmt(op, settings.currencySymbol)}</span> <span className="line-through">{fmt(product.price, settings.currencySymbol)}</span></> : fmt(product.price, settings.currencySymbol); })()}
                                {product.cost ? ` · Cost: ${fmt(product.cost, settings.currencySymbol)}` : ""}
                              </p>
                            </div>
                            <button onClick={() => openEdit(product)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-all">
                              <Pencil size={15} />
                            </button>
                            <button onClick={() => toggleProduct(product.id)} className="transition-colors">
                              {product.active ? <ToggleRight size={24} className="text-green-400" /> : <ToggleLeft size={24} className="text-slate-500" />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* ── Categories list ──────────────────────────────────────── */}
            {menuTab === "categories" && (
              <>
                <div className="flex justify-end">
                  <button onClick={() => setShowAddCategory(true)} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
                    <Plus size={16} /> Add Category
                  </button>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                  {categories.length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-8">No categories yet. Add one to get started.</p>
                  )}
                  <div className="divide-y divide-slate-700/50">
                    {[...categories].sort((a, b) => a.order - b.order).map((cat, idx, arr) => {
                      const itemCount = products.filter((p) => p.categoryId === cat.id).length;
                      return (
                        <div key={cat.id} className="px-4 py-3 flex items-center gap-3">
                          {/* Color swatch + emoji */}
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: cat.color + "33", border: `2px solid ${cat.color}55` }}
                          >
                            {cat.emoji}
                          </div>

                          {/* Name + count */}
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-semibold text-sm">{cat.name}</p>
                            <p className="text-slate-400 text-xs">{itemCount} item{itemCount !== 1 ? "s" : ""}</p>
                          </div>

                          {/* Reorder arrows */}
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => moveCategoryUp(cat.id)}
                              disabled={idx === 0}
                              className="p-1 rounded text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                            >
                              <ChevronDown size={14} className="rotate-180" />
                            </button>
                            <button
                              onClick={() => moveCategoryDown(cat.id)}
                              disabled={idx === arr.length - 1}
                              className="p-1 rounded text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                            >
                              <ChevronDown size={14} />
                            </button>
                          </div>

                          {/* Edit */}
                          <button
                            onClick={() => openEditCategory(cat)}
                            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
                          >
                            <Pencil size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "receipt" && (
          <div className="space-y-4">
            {/* Logo */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
              <h3 className="text-white font-semibold text-sm">Logo</h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">Show logo on receipt</p>
                  <p className="text-slate-400 text-xs">Displayed at the top of every printed receipt</p>
                </div>
                <button onClick={() => setLocal((p) => ({ ...p, receiptShowLogo: !p.receiptShowLogo }))} className="transition-colors">
                  {local.receiptShowLogo
                    ? <ToggleRight size={28} className="text-green-400" />
                    : <ToggleLeft size={28} className="text-slate-500" />}
                </button>
              </div>
              {local.receiptShowLogo && (
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Logo URL</label>
                  <div className="flex gap-2 items-start">
                    <input
                      type="url"
                      value={local.receiptLogoUrl}
                      onChange={(e) => setLocal((p) => ({ ...p, receiptLogoUrl: e.target.value }))}
                      placeholder="https://example.com/logo.png"
                      className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                    />
                    {local.receiptLogoUrl && (
                      <div className="w-10 h-10 border border-slate-600 rounded-xl overflow-hidden flex-shrink-0 bg-slate-900">
                        <img
                          src={local.receiptLogoUrl}
                          alt="Logo preview"
                          className="w-full h-full object-contain p-1"
                          onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }}
                        />
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Square PNG with transparent background recommended.</p>
                </div>
              )}
            </div>

            {/* Top Section */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
              <h3 className="text-white font-semibold text-sm">Top Section</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Restaurant name — placeholder shows the live branding name */}
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Restaurant Name</label>
                  <input
                    type="text"
                    value={local.receiptRestaurantName ?? ""}
                    onChange={(e) => setLocal((p) => ({ ...p, receiptRestaurantName: e.target.value }))}
                    placeholder={appSettings.restaurant?.name || "Restaurant Name"}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Printed in large text at the top. Leave blank to use your branding name.</p>
                </div>
                {[
                  { key: "receiptPhone",     label: "Phone Number", type: "tel",   placeholder: "e.g. 020 7123 4567" },
                  { key: "receiptWebsite",   label: "Website",      type: "text",  placeholder: "e.g. www.restaurant.co.uk" },
                  { key: "receiptEmail",     label: "Email",        type: "email", placeholder: "e.g. hello@restaurant.co.uk" },
                  { key: "receiptVatNumber", label: "VAT Number",   type: "text",  placeholder: "e.g. GB 123 4567 89", hint: "Leave blank if not VAT registered" },
                ].map((f) => (
                  <div key={f.key} className={f.key === "receiptVatNumber" ? "sm:col-span-2" : ""}>
                    <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                    <input
                      type={f.type}
                      value={local[f.key as keyof POSSettings] as string}
                      onChange={(e) => setLocal((p) => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                    />
                    {f.hint && <p className="text-[11px] text-slate-500 mt-1">{f.hint}</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Section */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
              <h3 className="text-white font-semibold text-sm">Bottom Section</h3>
              {[
                { key: "receiptThankYouMessage", label: "Thank You Message", placeholder: "Thank you for your order!", hint: "Appears at the bottom of every receipt" },
                { key: "receiptCustomMessage",   label: "Custom Message",     placeholder: "e.g. Follow us on Instagram · Use code THANKS10 for 10% off", hint: "Optional second line — great for promotions or social handles" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                  <textarea
                    rows={2}
                    value={local[f.key as keyof POSSettings] as string}
                    onChange={(e) => setLocal((p) => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500 resize-none"
                  />
                  {f.hint && <p className="text-[11px] text-slate-500 mt-1">{f.hint}</p>}
                </div>
              ))}
            </div>

            {/* Receipt Preview */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4">Receipt Preview</h3>
              {(() => {
                const W = 42;
                const center = (s: string) => {
                  const str = s.slice(0, W);
                  const pad = Math.max(0, Math.floor((W - str.length) / 2));
                  return " ".repeat(pad) + str;
                };
                const twoCol = (l: string, r: string) => {
                  const lw = W - r.length;
                  const left = l.length > lw - 1 ? l.slice(0, lw - 2) + "~" : l.padEnd(lw);
                  return left + r;
                };
                const eq   = "═".repeat(W);
                const dash = "─".repeat(W);
                type Line = { text: string; bold?: boolean; large?: boolean; dim?: boolean };
                const lines: Line[] = [];

                const name = (local.receiptRestaurantName || appSettings.restaurant?.name || "Restaurant Name").toUpperCase();
                lines.push({ text: center(name), bold: true, large: true });
                if (local.receiptPhone)     lines.push({ text: center(local.receiptPhone) });
                if (local.receiptWebsite)   lines.push({ text: center(local.receiptWebsite) });
                if (local.receiptEmail)     lines.push({ text: center(local.receiptEmail) });
                if (local.receiptVatNumber) lines.push({ text: center(`VAT: ${local.receiptVatNumber}`), dim: true });
                lines.push({ text: eq });
                lines.push({ text: "ORDER  ORD-A1B2C3D4", bold: true });
                lines.push({ text: "Date:  16 Apr 2026, 12:34" });
                lines.push({ text: "Type:  DINE IN · Table 4" });
                lines.push({ text: "Pay:   Card" });
                lines.push({ text: eq });
                lines.push({ text: twoCol("ITEM", "PRICE"), bold: true });
                lines.push({ text: dash });
                lines.push({ text: twoCol("Chicken Tikka x2", "£11.98") });
                lines.push({ text: twoCol("Garlic Naan x1", "£2.99") });
                lines.push({ text: dash });
                lines.push({ text: twoCol("Subtotal", "£14.97") });
                if (local.taxRate > 0) {
                  const vatAmt = local.taxInclusive
                    ? (14.97 * local.taxRate / (100 + local.taxRate)).toFixed(2)
                    : (14.97 * local.taxRate / 100).toFixed(2);
                  lines.push({ text: twoCol(local.taxInclusive ? `VAT incl. (${local.taxRate}%)` : `VAT (${local.taxRate}%)`, local.taxInclusive ? `£${vatAmt}` : `+£${vatAmt}`), dim: true });
                }
                lines.push({ text: eq });
                lines.push({ text: twoCol("TOTAL", "£14.97"), bold: true });
                lines.push({ text: eq });
                lines.push({ text: "" });
                const ty = local.receiptThankYouMessage || "Thank you for your order!";
                lines.push({ text: center(ty), bold: true });
                if (local.receiptCustomMessage) lines.push({ text: center(local.receiptCustomMessage), dim: true });
                lines.push({ text: "" });

                return (
                  <div className="bg-white rounded-xl overflow-hidden shadow-inner">
                    {/* Sprocket strip top */}
                    <div className="flex gap-1.5 px-3 py-1.5 bg-gray-50 border-b border-dashed border-gray-200">
                      {Array.from({ length: 12 }).map((_, i) => <div key={i} className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />)}
                    </div>
                    <div className="px-4 py-4">
                      {local.receiptShowLogo && local.receiptLogoUrl && (
                        <div className="flex justify-center mb-3">
                          <img src={local.receiptLogoUrl} alt="Logo" className="h-10 w-auto object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </div>
                      )}
                      <div className="font-mono text-[11px] leading-[1.45] overflow-x-auto">
                        {lines.map((line, i) => (
                          <div key={i} className={[
                            "whitespace-pre",
                            line.bold ? "font-bold" : "font-normal",
                            line.large ? "text-[13px]" : "",
                            line.dim ? "text-gray-400" : "text-gray-800",
                          ].filter(Boolean).join(" ")}>
                            {line.text || "\u00A0"}
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Sprocket strip bottom */}
                    <div className="flex gap-1.5 px-3 py-1.5 bg-gray-50 border-t border-dashed border-gray-200">
                      {Array.from({ length: 12 }).map((_, i) => <div key={i} className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />)}
                    </div>
                  </div>
                );
              })()}
              <p className="text-[11px] text-slate-500 text-center mt-2">Live preview · reflects unsaved draft</p>
            </div>

            <button onClick={saveSettings} className="w-full py-3.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-bold text-sm transition-all flex items-center justify-center gap-2">
              <Save size={16} /> Save Receipt Settings
            </button>
          </div>
        )}

        {tab === "hardware" && (
          <div className="space-y-4">
            <POSPrinterPanel appSettings={appSettings} />
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-3">Cash Drawer</h3>
              <p className="text-slate-400 text-sm">Cash drawer triggers automatically on cash payment via ESC/POS printer port.</p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-3">Card Terminal</h3>
              <p className="text-slate-400 text-sm">Pair any standalone card terminal (SumUp, Zettle, Square). The POS records the payment — the terminal handles the transaction.</p>
            </div>

            {/* SMTP — Email Receipts */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
              <div>
                <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                  <Mail size={16} className="text-slate-400" /> Email Receipts (SMTP)
                </h3>
                <p className="text-slate-400 text-xs mt-1">
                  SMTP credentials are configured via server-side environment variables
                  (<code className="font-mono text-orange-400">SMTP_HOST</code>,{" "}
                  <code className="font-mono text-orange-400">SMTP_USER</code>,{" "}
                  <code className="font-mono text-orange-400">SMTP_PASS</code>).
                  They are never stored in the browser.
                </p>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">From Name (shown to customer)</label>
                <input value={local.smtpFromName ?? ""} onChange={(e) => setLocal((l) => ({ ...l, smtpFromName: e.target.value }))}
                  placeholder={appSettings.restaurant?.name || local.businessName || "Restaurant Name"}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <button
                onClick={() => setSettings({ ...settings, ...local })}
                className="w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <Save size={14} /> Save
              </button>
            </div>

            {/* Local Storage */}
            {(() => {
              const cutoff   = Date.now() - salesRetentionDays * 24 * 60 * 60 * 1000;
              const recent   = sales.filter((s) => new Date(s.date).getTime() >= cutoff).length;
              const archived = sales.length - recent;
              return (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
                  <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                    <Package size={16} className="text-slate-400" /> Local Storage
                  </h3>
                  <div className="bg-slate-900 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between text-slate-300">
                      <span>Sales in memory</span>
                      <span className="font-mono font-semibold">{sales.length}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Within {salesRetentionDays}-day window</span>
                      <span className="font-mono">{recent}</span>
                    </div>
                    {archived > 0 && (
                      <div className="flex justify-between text-amber-400">
                        <span>Older than {salesRetentionDays} days (not persisted)</span>
                        <span className="font-mono">{archived}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-slate-500 text-xs">
                    Only the last {salesRetentionDays} days of sales are written to localStorage to prevent quota exhaustion.
                    Export a full archive before older records are lost on page refresh.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={exportSales}
                      className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                      <Receipt size={14} /> Export JSON
                    </button>
                    <button
                      onClick={() => { if (confirm(`Remove ${archived} sale${archived !== 1 ? "s" : ""} older than ${salesRetentionDays} days from memory?`)) purgeOldSales(); }}
                      disabled={archived === 0}
                      className="flex-1 py-2.5 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                      <Trash2 size={14} /> Purge old
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Edit category modal ────────────────────────────────────────── */}
      {editCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold">Edit Category</h3>
              <button onClick={() => setEditCategory(null)} className="text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Emoji + Name */}
              <div className="flex gap-3">
                <div className="w-20 flex-shrink-0">
                  <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                  <input
                    value={catDraft.emoji}
                    onChange={(e) => setCatDraft((d) => ({ ...d, emoji: e.target.value }))}
                    placeholder="🍽️"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-400 mb-1 block">Name *</label>
                  <input
                    value={catDraft.name}
                    onChange={(e) => setCatDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Category name"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCatDraft((d) => ({ ...d, color: c }))}
                      className="w-8 h-8 rounded-lg transition-all"
                      style={{
                        backgroundColor: c,
                        outline: catDraft.color === c ? `3px solid white` : "none",
                        outlineOffset: "2px",
                        boxShadow: catDraft.color === c ? `0 0 0 1px ${c}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="flex items-center gap-3 bg-slate-900 rounded-xl px-4 py-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ backgroundColor: catDraft.color + "33", border: `2px solid ${catDraft.color}88` }}
                >
                  {catDraft.emoji || "🍽️"}
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">{catDraft.name || "Category name"}</p>
                  <p className="text-slate-400 text-xs">Preview</p>
                </div>
                <div className="ml-auto">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: catDraft.color }} />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-700 grid grid-cols-2 gap-2">
              <button
                onClick={() => setDeleteCatConfirm(editCategory.id)}
                className="py-3 rounded-xl border border-red-500/40 text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={14} /> Delete
              </button>
              <button
                onClick={saveCategory}
                disabled={!catDraft.name.trim()}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Save size={14} /> Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete category confirm ─────────────────────────────────────── */}
      {deleteCatConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <h3 className="text-white font-bold mb-1">Delete category?</h3>
            <p className="text-slate-400 text-sm mb-1">
              <span className="text-white font-semibold">{categories.find((c) => c.id === deleteCatConfirm)?.name}</span> will be removed.
            </p>
            {(() => {
              const count = products.filter((p) => p.categoryId === deleteCatConfirm).length;
              return count > 0 ? (
                <p className="text-amber-400 text-xs mb-5">
                  {count} item{count !== 1 ? "s" : ""} will be moved to the first remaining category.
                </p>
              ) : (
                <p className="text-slate-500 text-xs mb-5">This category has no items.</p>
              );
            })()}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteCatConfirm(null)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => deleteCategory(deleteCatConfirm)} className="py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add category modal ──────────────────────────────────────────── */}
      {showAddCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold">Add Category</h3>
              <button onClick={() => setShowAddCategory(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-3">
                <div className="w-20 flex-shrink-0">
                  <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                  <input
                    value={newCategory.emoji}
                    onChange={(e) => setNewCategory((d) => ({ ...d, emoji: e.target.value }))}
                    placeholder="🍽️"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-400 mb-1 block">Name *</label>
                  <input
                    value={newCategory.name}
                    onChange={(e) => setNewCategory((d) => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. Starters"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewCategory((d) => ({ ...d, color: c }))}
                      className="w-8 h-8 rounded-lg transition-all"
                      style={{
                        backgroundColor: c,
                        outline: newCategory.color === c ? `3px solid white` : "none",
                        outlineOffset: "2px",
                        boxShadow: newCategory.color === c ? `0 0 0 1px ${c}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 pb-5 grid grid-cols-2 gap-2">
              <button onClick={() => setShowAddCategory(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button
                onClick={addCategory}
                disabled={!newCategory.name.trim()}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit product modal ─────────────────────────────────────────── */}
      {editProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold">Edit Item</h3>
              <button onClick={() => setEditProduct(null)} className="text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            {/* Form */}
            <div className="p-5 space-y-3 max-h-[75vh] overflow-y-auto">

              {/* Image section */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Item Image</label>
                {editDraft.imageUrl ? (
                  <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-600 mb-2" style={{ height: 140 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={editDraft.imageUrl} alt="preview" className="absolute inset-0 w-full h-full object-cover" />
                    <button
                      onClick={() => setEditDraft((d) => ({ ...d, imageUrl: "" }))}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500/80 flex items-center justify-center text-white transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed border-slate-600 hover:border-orange-500 bg-slate-900 cursor-pointer transition-colors mb-2" style={{ height: 100 }}>
                    <Package size={22} className="text-slate-500 mb-1" />
                    <span className="text-xs text-slate-400">Click to upload image</span>
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f, (url) => setEditDraft((d) => ({ ...d, imageUrl: url }))); }}
                    />
                  </label>
                )}
                <input
                  value={editDraft.imageUrl}
                  onChange={(e) => setEditDraft((d) => ({ ...d, imageUrl: e.target.value }))}
                  placeholder="Or paste image URL…"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-xs outline-none focus:border-orange-500 placeholder-slate-500"
                />
              </div>

              {/* Emoji + Name row — emoji only shown when no image */}
              <div className="flex gap-3">
                {!editDraft.imageUrl && (
                  <div className="w-20 flex-shrink-0">
                    <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                    <input
                      value={editDraft.emoji}
                      onChange={(e) => setEditDraft((d) => ({ ...d, emoji: e.target.value }))}
                      placeholder="🍽️"
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <label className="text-xs text-slate-400 mb-1 block">Name *</label>
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Item name"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Category *</label>
                <select
                  value={editDraft.categoryId}
                  onChange={(e) => setEditDraft((d) => ({ ...d, categoryId: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500"
                >
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                </select>
              </div>

              {/* Price / Cost */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Price ({settings.currencySymbol}) *</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={editDraft.price}
                    onChange={(e) => setEditDraft((d) => ({ ...d, price: e.target.value }))}
                    placeholder="0.00"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Cost ({settings.currencySymbol})</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={editDraft.cost}
                    onChange={(e) => setEditDraft((d) => ({ ...d, cost: e.target.value }))}
                    placeholder="0.00"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
              </div>

              {/* Margin preview */}
              {editDraft.price && editDraft.cost && parseFloat(editDraft.price) > 0 && (
                <div className="bg-slate-900 rounded-xl px-4 py-2.5 flex items-center justify-between">
                  <span className="text-slate-400 text-xs">Margin</span>
                  <span className="text-green-400 text-sm font-bold">
                    {Math.round(((parseFloat(editDraft.price) - parseFloat(editDraft.cost)) / parseFloat(editDraft.price)) * 100)}%
                    <span className="text-slate-400 font-normal ml-1 text-xs">
                      ({settings.currencySymbol}{(parseFloat(editDraft.price) - parseFloat(editDraft.cost)).toFixed(2)})
                    </span>
                  </span>
                </div>
              )}

              {/* Offer section */}
              <div className="border border-slate-700 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-900/60">
                  <div>
                    <p className="text-white text-sm font-medium">Product Offer</p>
                    <p className="text-slate-400 text-xs">Discount shown on the sale tile</p>
                  </div>
                  <button onClick={() => setEditDraft((d) => ({ ...d, offerActive: !d.offerActive }))} className="transition-colors">
                    {editDraft.offerActive ? <ToggleRight size={28} className="text-amber-400" /> : <ToggleLeft size={28} className="text-slate-500" />}
                  </button>
                </div>
                {editDraft.offerActive && (
                  <div className="p-4 space-y-3 bg-slate-900/30">
                    {/* Type grid — 2 rows of 3 */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        ["percent",      "% Off"],
                        ["fixed",        `${settings.currencySymbol} Off`],
                        ["price",        "Set Price"],
                        ["bogo",         "BOGO"],
                        ["multibuy",     "Multi-Buy"],
                        ["qty_discount", "Qty Deal"],
                      ] as [POSOffer["type"], string][]).map(([t, label]) => (
                        <button key={t} onClick={() => setEditDraft((d) => ({ ...d, offerType: t }))}
                          className={`py-2 rounded-lg text-xs font-semibold transition-all ${editDraft.offerType === t ? "bg-amber-400 text-slate-900" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Type-specific inputs */}
                    {(editDraft.offerType === "percent" || editDraft.offerType === "fixed" || editDraft.offerType === "price") && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">
                            {editDraft.offerType === "percent" ? "Discount %" : editDraft.offerType === "fixed" ? `Amount Off (${settings.currencySymbol})` : `Special Price (${settings.currencySymbol})`}
                          </label>
                          <input type="number" min="0" step={editDraft.offerType === "percent" ? "1" : "0.01"}
                            value={editDraft.offerValue} onChange={(e) => setEditDraft((d) => ({ ...d, offerValue: e.target.value }))}
                            placeholder={editDraft.offerType === "percent" ? "e.g. 20" : "0.00"}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge label (optional)</label>
                          <input value={editDraft.offerLabel} onChange={(e) => setEditDraft((d) => ({ ...d, offerLabel: e.target.value }))}
                            placeholder="e.g. Happy Hour"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {editDraft.offerType === "bogo" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Buy qty</label>
                          <input type="number" min="1" step="1" value={editDraft.offerBuyQty}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerBuyQty: e.target.value }))} placeholder="1"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Get free</label>
                          <input type="number" min="1" step="1" value={editDraft.offerFreeQty}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerFreeQty: e.target.value }))} placeholder="1"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={editDraft.offerLabel} onChange={(e) => setEditDraft((d) => ({ ...d, offerLabel: e.target.value }))}
                            placeholder="e.g. BOGOF"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {editDraft.offerType === "multibuy" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Buy qty</label>
                          <input type="number" min="2" step="1" value={editDraft.offerBuyQty}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerBuyQty: e.target.value }))} placeholder="3"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Bundle price ({settings.currencySymbol})</label>
                          <input type="number" min="0" step="0.01" value={editDraft.offerValue}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerValue: e.target.value }))} placeholder="10.00"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={editDraft.offerLabel} onChange={(e) => setEditDraft((d) => ({ ...d, offerLabel: e.target.value }))}
                            placeholder={`${editDraft.offerBuyQty||"3"} for ${settings.currencySymbol}${editDraft.offerValue||"10"}`}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {editDraft.offerType === "qty_discount" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Min qty</label>
                          <input type="number" min="2" step="1" value={editDraft.offerMinQty}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerMinQty: e.target.value }))} placeholder="2"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Discount %</label>
                          <input type="number" min="1" max="100" step="1" value={editDraft.offerValue}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerValue: e.target.value }))} placeholder="15"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={editDraft.offerLabel} onChange={(e) => setEditDraft((d) => ({ ...d, offerLabel: e.target.value }))}
                            placeholder={`${editDraft.offerMinQty||"2"}+ save ${editDraft.offerValue||"15"}%`}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {/* Date range */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Start date (optional)</label>
                        <input type="date" value={editDraft.offerStart} onChange={(e) => setEditDraft((d) => ({ ...d, offerStart: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">End date (optional)</label>
                        <input type="date" value={editDraft.offerEnd} onChange={(e) => setEditDraft((d) => ({ ...d, offerEnd: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400" />
                      </div>
                    </div>

                    {/* Live preview */}
                    {editDraft.price && (() => {
                      const price = parseFloat(editDraft.price) || 0;
                      const sym = settings.currencySymbol;
                      let preview: string | null = null;
                      if ((editDraft.offerType === "percent" || editDraft.offerType === "fixed" || editDraft.offerType === "price") && editDraft.offerValue) {
                        const mock: POSProduct = { id:"", categoryId:"", name:"", price, color:"", trackStock:false, active:true,
                          offer: { type: editDraft.offerType, value: parseFloat(editDraft.offerValue)||0, active:true } };
                        const op = getOfferPrice(mock);
                        if (op !== null) preview = `${fmt(op,sym)} per item  (was ${fmt(price,sym)})`;
                      } else if (editDraft.offerType === "bogo" && editDraft.offerBuyQty && editDraft.offerFreeQty) {
                        const b = parseInt(editDraft.offerBuyQty), f = parseInt(editDraft.offerFreeQty);
                        preview = `Buy ${b} get ${f} free · pay for ${b} of every ${b+f}`;
                      } else if (editDraft.offerType === "multibuy" && editDraft.offerBuyQty && editDraft.offerValue) {
                        const qty = parseInt(editDraft.offerBuyQty), total = parseFloat(editDraft.offerValue);
                        const saving = price * qty - total;
                        preview = `${qty} for ${fmt(total,sym)} · save ${fmt(saving>0?saving:0,sym)}`;
                      } else if (editDraft.offerType === "qty_discount" && editDraft.offerMinQty && editDraft.offerValue) {
                        const discounted = price * (1 - parseFloat(editDraft.offerValue)/100);
                        preview = `Buy ${editDraft.offerMinQty}+ · ${fmt(discounted,sym)} each (was ${fmt(price,sym)})`;
                      }
                      return preview ? (
                        <div className="flex items-center gap-3 bg-amber-400/10 border border-amber-400/30 rounded-xl px-4 py-2.5">
                          <Tag size={14} className="text-amber-400 flex-shrink-0" />
                          <span className="text-amber-400 text-xs font-semibold">{preview}</span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>

              {/* Popular toggle */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-white text-sm font-medium">Mark as Popular</p>
                  <p className="text-slate-400 text-xs">Shows a &quot;Popular&quot; badge on the tile</p>
                </div>
                <button
                  onClick={() => setEditDraft((d) => ({ ...d, popular: !d.popular }))}
                  className="transition-colors"
                >
                  {editDraft.popular
                    ? <ToggleRight size={28} className="text-orange-400" />
                    : <ToggleLeft size={28} className="text-slate-500" />}
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-700 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDeleteConfirm(editProduct.id)}
                  className="py-3 rounded-xl border border-red-500/40 text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} /> Delete
                </button>
                <button
                  onClick={saveEdit}
                  disabled={!editDraft.name.trim() || !editDraft.categoryId || !editDraft.price}
                  className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Save size={14} /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <h3 className="text-white font-bold mb-1">Delete item?</h3>
            <p className="text-slate-400 text-sm mb-6">
              {products.find((p) => p.id === deleteConfirm)?.name} will be removed from the POS menu. This cannot be undone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteProduct(deleteConfirm)}
                className="py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add product modal ──────────────────────────────────────────── */}
      {showAddProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold">Add Menu Item</h3>
              <button onClick={() => setShowAddProduct(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[75vh] overflow-y-auto">

              {/* Image section */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Item Image</label>
                {newProduct.imageUrl ? (
                  <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-600 mb-2" style={{ height: 140 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={newProduct.imageUrl} alt="preview" className="absolute inset-0 w-full h-full object-cover" />
                    <button
                      onClick={() => setNewProduct((p) => ({ ...p, imageUrl: "" }))}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500/80 flex items-center justify-center text-white transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed border-slate-600 hover:border-orange-500 bg-slate-900 cursor-pointer transition-colors mb-2" style={{ height: 100 }}>
                    <Package size={22} className="text-slate-500 mb-1" />
                    <span className="text-xs text-slate-400">Click to upload image</span>
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f, (url) => setNewProduct((p) => ({ ...p, imageUrl: url }))); }}
                    />
                  </label>
                )}
                <input
                  value={newProduct.imageUrl}
                  onChange={(e) => setNewProduct((p) => ({ ...p, imageUrl: e.target.value }))}
                  placeholder="Or paste image URL…"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-xs outline-none focus:border-orange-500 placeholder-slate-500"
                />
              </div>

              <div className="flex gap-3">
                {!newProduct.imageUrl && (
                  <div className="w-20 flex-shrink-0">
                    <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                    <input value={newProduct.emoji} onChange={(e) => setNewProduct((p) => ({ ...p, emoji: e.target.value }))} placeholder="🍽️"
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500" />
                  </div>
                )}
                <div className="flex-1">
                  <label className="text-xs text-slate-400 mb-1 block">Name *</label>
                  <input value={newProduct.name} onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))} placeholder="Item name"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Category *</label>
                <select value={newProduct.categoryId} onChange={(e) => setNewProduct((p) => ({ ...p, categoryId: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500">
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Price ({settings.currencySymbol}) *</label>
                  <input type="number" step="0.01" min="0" value={newProduct.price} onChange={(e) => setNewProduct((p) => ({ ...p, price: e.target.value }))} placeholder="0.00"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Cost ({settings.currencySymbol})</label>
                  <input type="number" step="0.01" min="0" value={newProduct.cost} onChange={(e) => setNewProduct((p) => ({ ...p, cost: e.target.value }))} placeholder="0.00"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                </div>
              </div>

              {/* Offer section */}
              <div className="border border-slate-700 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-900/60">
                  <div>
                    <p className="text-white text-sm font-medium">Product Offer</p>
                    <p className="text-slate-400 text-xs">Optional discount on this item</p>
                  </div>
                  <button onClick={() => setNewProduct((p) => ({ ...p, offerActive: !p.offerActive }))} className="transition-colors">
                    {newProduct.offerActive ? <ToggleRight size={28} className="text-amber-400" /> : <ToggleLeft size={28} className="text-slate-500" />}
                  </button>
                </div>
                {newProduct.offerActive && (
                  <div className="p-4 space-y-3 bg-slate-900/30">
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        ["percent",      "% Off"],
                        ["fixed",        `${settings.currencySymbol} Off`],
                        ["price",        "Set Price"],
                        ["bogo",         "BOGO"],
                        ["multibuy",     "Multi-Buy"],
                        ["qty_discount", "Qty Deal"],
                      ] as [POSOffer["type"], string][]).map(([t, label]) => (
                        <button key={t} onClick={() => setNewProduct((p) => ({ ...p, offerType: t }))}
                          className={`py-2 rounded-lg text-xs font-semibold transition-all ${newProduct.offerType === t ? "bg-amber-400 text-slate-900" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {(newProduct.offerType === "percent" || newProduct.offerType === "fixed" || newProduct.offerType === "price") && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">
                            {newProduct.offerType === "percent" ? "Discount %" : newProduct.offerType === "fixed" ? `Amount Off (${settings.currencySymbol})` : `Special Price (${settings.currencySymbol})`}
                          </label>
                          <input type="number" min="0" step={newProduct.offerType === "percent" ? "1" : "0.01"}
                            value={newProduct.offerValue} onChange={(e) => setNewProduct((p) => ({ ...p, offerValue: e.target.value }))}
                            placeholder={newProduct.offerType === "percent" ? "e.g. 20" : "0.00"}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge label (optional)</label>
                          <input value={newProduct.offerLabel} onChange={(e) => setNewProduct((p) => ({ ...p, offerLabel: e.target.value }))}
                            placeholder="e.g. Happy Hour"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {newProduct.offerType === "bogo" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Buy qty</label>
                          <input type="number" min="1" step="1" value={newProduct.offerBuyQty}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerBuyQty: e.target.value }))} placeholder="1"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Get free</label>
                          <input type="number" min="1" step="1" value={newProduct.offerFreeQty}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerFreeQty: e.target.value }))} placeholder="1"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={newProduct.offerLabel} onChange={(e) => setNewProduct((p) => ({ ...p, offerLabel: e.target.value }))}
                            placeholder="e.g. BOGOF"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {newProduct.offerType === "multibuy" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Buy qty</label>
                          <input type="number" min="2" step="1" value={newProduct.offerBuyQty}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerBuyQty: e.target.value }))} placeholder="3"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Bundle price ({settings.currencySymbol})</label>
                          <input type="number" min="0" step="0.01" value={newProduct.offerValue}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerValue: e.target.value }))} placeholder="10.00"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={newProduct.offerLabel} onChange={(e) => setNewProduct((p) => ({ ...p, offerLabel: e.target.value }))}
                            placeholder={`${newProduct.offerBuyQty||"3"} for ${settings.currencySymbol}${newProduct.offerValue||"10"}`}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {newProduct.offerType === "qty_discount" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Min qty</label>
                          <input type="number" min="2" step="1" value={newProduct.offerMinQty}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerMinQty: e.target.value }))} placeholder="2"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Discount %</label>
                          <input type="number" min="1" max="100" step="1" value={newProduct.offerValue}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerValue: e.target.value }))} placeholder="15"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={newProduct.offerLabel} onChange={(e) => setNewProduct((p) => ({ ...p, offerLabel: e.target.value }))}
                            placeholder={`${newProduct.offerMinQty||"2"}+ save ${newProduct.offerValue||"15"}%`}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Start date (optional)</label>
                        <input type="date" value={newProduct.offerStart} onChange={(e) => setNewProduct((p) => ({ ...p, offerStart: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">End date (optional)</label>
                        <input type="date" value={newProduct.offerEnd} onChange={(e) => setNewProduct((p) => ({ ...p, offerEnd: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400" />
                      </div>
                    </div>

                    {newProduct.price && (() => {
                      const price = parseFloat(newProduct.price) || 0;
                      const sym = settings.currencySymbol;
                      let preview: string | null = null;
                      if ((newProduct.offerType === "percent" || newProduct.offerType === "fixed" || newProduct.offerType === "price") && newProduct.offerValue) {
                        const mock: POSProduct = { id:"", categoryId:"", name:"", price, color:"", trackStock:false, active:true,
                          offer: { type: newProduct.offerType, value: parseFloat(newProduct.offerValue)||0, active:true } };
                        const op = getOfferPrice(mock);
                        if (op !== null) preview = `${fmt(op,sym)} per item  (was ${fmt(price,sym)})`;
                      } else if (newProduct.offerType === "bogo" && newProduct.offerBuyQty && newProduct.offerFreeQty) {
                        const b = parseInt(newProduct.offerBuyQty), f = parseInt(newProduct.offerFreeQty);
                        preview = `Buy ${b} get ${f} free · pay for ${b} of every ${b+f}`;
                      } else if (newProduct.offerType === "multibuy" && newProduct.offerBuyQty && newProduct.offerValue) {
                        const qty = parseInt(newProduct.offerBuyQty), total = parseFloat(newProduct.offerValue);
                        const saving = price * qty - total;
                        preview = `${qty} for ${fmt(total,sym)} · save ${fmt(saving>0?saving:0,sym)}`;
                      } else if (newProduct.offerType === "qty_discount" && newProduct.offerMinQty && newProduct.offerValue) {
                        const discounted = price * (1 - parseFloat(newProduct.offerValue)/100);
                        preview = `Buy ${newProduct.offerMinQty}+ · ${fmt(discounted,sym)} each (was ${fmt(price,sym)})`;
                      }
                      return preview ? (
                        <div className="flex items-center gap-3 bg-amber-400/10 border border-amber-400/30 rounded-xl px-4 py-2.5">
                          <Tag size={14} className="text-amber-400 flex-shrink-0" />
                          <span className="text-amber-400 text-xs font-semibold">{preview}</span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 pb-5 grid grid-cols-2 gap-2">
              <button onClick={() => setShowAddProduct(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={addProduct} disabled={!newProduct.name.trim() || !newProduct.categoryId || !newProduct.price}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Add Item</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Table Status View (POS) ───────────────────────────────────────────────────

type ResRow = {
  id: string; table_id: string; table_label: string; section: string;
  customer_name: string; customer_email: string; customer_phone: string;
  date: string; time: string; party_size: number; status: string; note?: string;
  checked_in_at?: string; checked_out_at?: string;
};

type TableState = "free" | "reserved" | "occupied" | "done";

const TABLE_STATE_STYLES: Record<TableState, { card: string; badge: string; label: string; dot: string; ring: string }> = {
  free:     { card: "bg-slate-800/60 border-slate-700",       badge: "bg-slate-700 text-slate-300",       label: "Free",     dot: "bg-slate-500",  ring: "" },
  reserved: { card: "bg-amber-900/30 border-amber-600/60",    badge: "bg-amber-800/60 text-amber-300",    label: "Reserved", dot: "bg-amber-400",  ring: "ring-1 ring-amber-500/30" },
  occupied: { card: "bg-blue-900/40 border-blue-500/60",      badge: "bg-blue-800/60 text-blue-300",      label: "Occupied", dot: "bg-blue-400",   ring: "ring-1 ring-blue-400/30" },
  done:     { card: "bg-teal-900/30 border-teal-600/50",      badge: "bg-teal-800/50 text-teal-300",      label: "Done",     dot: "bg-teal-400",   ring: "" },
};

function fmt12Pos(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

function fmtTsPos(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function TableStatusView() {
  const { settings: appSettings } = useApp();
  const tables = (appSettings.diningTables ?? []).filter((t) => t.active);

  const [reservations,  setReservations]  = useState<ResRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [actioning,     setActioning]     = useState<string | null>(null);
  const [filterSection, setFilterSection] = useState("");

  const sections = [...new Set(tables.map((t) => t.section).filter(Boolean))];

  // Local date string — toISOString() is UTC and can return yesterday east of UTC+0
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const fetchToday = useCallback(async () => {
    setLoading(true);
    try {
      const today = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })();

      const COLUMN_SETS = [
        "id,table_id,customer_name,customer_phone,time,party_size,status,note,checked_in_at,checked_out_at",
        "id,table_id,customer_name,customer_phone,time,party_size,status,note",
      ];

      let data = null;
      for (const cols of COLUMN_SETS) {
        const { data: d, error: e } = await supabase
          .from("reservations")
          .select(cols)
          .eq("date", today)
          .in("status", ["pending", "confirmed", "checked_in", "checked_out"]);
        if (!e) { data = d; break; }
        if (!e.message?.includes("does not exist") && !e.message?.includes("schema cache")) {
          console.error("TableStatusView fetch:", e.message);
          break;
        }
      }

      setReservations((data ?? []) as unknown as ResRow[]);
    } catch (err) {
      console.error("TableStatusView fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  useEffect(() => {
    const ch = supabase
      .channel("pos-table-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, fetchToday)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchToday]);

  async function doAction(resId: string, status: "checked_in" | "checked_out") {
    setActioning(resId);
    const now = new Date().toISOString();
    await fetch(`/api/pos/reservations/${resId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setReservations((prev) =>
      prev.map((r) => r.id !== resId ? r : {
        ...r, status,
        ...(status === "checked_in"  ? { checked_in_at:  now } : {}),
        ...(status === "checked_out" ? { checked_out_at: now } : {}),
      })
    );
    setActioning(null);
  }

  function resolveState(tableId: string): { state: TableState; res?: ResRow } {
    const occupied = reservations.find((r) => r.table_id === tableId && r.status === "checked_in");
    if (occupied) return { state: "occupied", res: occupied };
    const reserved = reservations.find((r) => r.table_id === tableId && (r.status === "pending" || r.status === "confirmed"));
    if (reserved) return { state: "reserved", res: reserved };
    const done = reservations.find((r) => r.table_id === tableId && r.status === "checked_out");
    if (done) return { state: "done", res: done };
    return { state: "free" };
  }

  const visibleTables = tables.filter((t) => !filterSection || t.section === filterSection);

  const counts = { free: 0, reserved: 0, occupied: 0, done: 0 };
  for (const t of visibleTables) counts[resolveState(t.id).state]++;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 space-y-4">

      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-white font-bold text-lg">Table Status</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            {counts.occupied} occupied · {counts.reserved} reserved · {counts.free} free
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sections.length > 1 && (
            <select
              value={filterSection}
              onChange={(e) => setFilterSection(e.target.value)}
              className="bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-xl px-3 py-1.5 focus:outline-none focus:border-orange-500"
            >
              <option value="">All sections</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button
            onClick={fetchToday}
            disabled={loading}
            className="flex items-center gap-1.5 bg-slate-800 border border-slate-600 text-slate-300 hover:text-white text-sm px-3 py-1.5 rounded-xl transition"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-2">
        {([
          { key: "free",     label: "Free",     dot: "bg-slate-500" },
          { key: "reserved", label: "Reserved", dot: "bg-amber-400" },
          { key: "occupied", label: "Occupied", dot: "bg-blue-400"  },
          { key: "done",     label: "Done",     dot: "bg-teal-400"  },
        ] as { key: TableState; label: string; dot: string }[]).map(({ key, label, dot }) => (
          <div key={key} className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full ${dot}`} />
              <span className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide">{label}</span>
            </div>
            <span className="text-white font-bold text-xl">{counts[key]}</span>
          </div>
        ))}
      </div>

      {/* Table grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={28} className="animate-spin text-orange-500" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {visibleTables.map((t) => {
            const { state, res } = resolveState(t.id);
            const s = TABLE_STATE_STYLES[state];
            const busy = actioning === res?.id;

            return (
              <div key={t.id} className={`rounded-2xl border-2 p-3.5 flex flex-col gap-3 transition ${s.card} ${s.ring}`}>

                {/* Table header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <UtensilsCrossed size={13} className="text-orange-400" />
                      <span className="font-bold text-white text-sm">{t.label}</span>
                    </div>
                    <div className="text-slate-400 text-[11px] mt-0.5 flex items-center gap-2">
                      <span>{t.seats} seats</span>
                      {t.section && <span>· {t.section}</span>}
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${s.badge}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${s.dot}`} />
                    {s.label}
                  </span>
                </div>

                {/* Reservation detail */}
                {res && (
                  <div className="bg-slate-900/60 rounded-xl px-3 py-2 space-y-0.5">
                    <p className="font-semibold text-white text-sm truncate">{res.customer_name}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1"><Clock size={10} /> {fmt12Pos(res.time)}</span>
                      <span className="flex items-center gap-1"><Users size={10} /> {res.party_size} guests</span>
                      {res.customer_phone && (
                        <span className="flex items-center gap-1"><Phone size={10} /> {res.customer_phone}</span>
                      )}
                    </div>
                    {res.checked_in_at && (
                      <p className="text-[11px] text-blue-400 flex items-center gap-1">
                        <LogIn size={10} /> In {fmtTsPos(res.checked_in_at)}
                      </p>
                    )}
                    {res.checked_out_at && (
                      <p className="text-[11px] text-teal-400 flex items-center gap-1">
                        <LogOut size={10} /> Out {fmtTsPos(res.checked_out_at)}
                      </p>
                    )}
                    {res.note && (
                      <p className="text-[11px] text-amber-400 italic truncate">&ldquo;{res.note}&rdquo;</p>
                    )}
                  </div>
                )}

                {/* Action button */}
                {busy ? (
                  <div className="flex justify-center py-1">
                    <Loader2 size={16} className="animate-spin text-slate-400" />
                  </div>
                ) : state === "reserved" && res ? (
                  <button
                    onClick={() => doAction(res.id, "checked_in")}
                    className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-bold py-2.5 rounded-xl transition-all"
                  >
                    <LogIn size={13} /> Check In
                  </button>
                ) : state === "occupied" && res ? (
                  <button
                    onClick={() => doAction(res.id, "checked_out")}
                    className="w-full flex items-center justify-center gap-1.5 bg-teal-600 hover:bg-teal-500 active:scale-95 text-white text-xs font-bold py-2.5 rounded-xl transition-all"
                  >
                    <LogOut size={13} /> Check Out
                  </button>
                ) : state === "free" ? (
                  <div className="flex items-center justify-center gap-1 text-slate-500 text-xs py-2">
                    <CheckCircle2 size={13} /> Available
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1 text-teal-500 text-xs py-2">
                    <CheckCircle2 size={13} /> Freed
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {visibleTables.length === 0 && !loading && (
        <div className="flex flex-col items-center py-20 gap-3 text-center">
          <UtensilsCrossed size={32} className="text-slate-600" />
          <p className="text-slate-400 font-semibold">No active tables configured</p>
          <p className="text-slate-500 text-sm">Add tables in Admin → Staff &amp; Tables.</p>
        </div>
      )}
    </div>
  );
}

// ─── Reservations View (POS) ──────────────────────────────────────────────────

const RES_STATUS_CFG: Record<string, { label: string; dot: string; badge: string }> = {
  pending:     { label: "Pending",     dot: "bg-amber-400",  badge: "bg-amber-900/50 text-amber-300 border-amber-600/50"  },
  confirmed:   { label: "Confirmed",   dot: "bg-green-400",  badge: "bg-green-900/50 text-green-300 border-green-600/50"  },
  checked_in:  { label: "Dining",      dot: "bg-blue-400",   badge: "bg-blue-900/50  text-blue-300  border-blue-600/50"   },
  checked_out: { label: "Done",        dot: "bg-teal-400",   badge: "bg-teal-900/50  text-teal-300  border-teal-600/50"   },
  cancelled:   { label: "Cancelled",   dot: "bg-red-400",    badge: "bg-red-900/50   text-red-300   border-red-600/50"    },
  no_show:     { label: "No show",     dot: "bg-slate-500",  badge: "bg-slate-700    text-slate-400 border-slate-600"     },
};

const SOURCE_CFG: Record<string, { label: string; cls: string }> = {
  online:    { label: "Online",   cls: "bg-blue-900/50 text-blue-300 border-blue-700/50"     },
  "walk-in": { label: "Walk-in",  cls: "bg-green-900/50 text-green-300 border-green-700/50"  },
  phone:     { label: "Phone",    cls: "bg-purple-900/50 text-purple-300 border-purple-700/50"},
  other:     { label: "Other",    cls: "bg-slate-700 text-slate-400 border-slate-600"         },
};

// Local-date helpers (not UTC-based)
function localTodayStrRes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localMaxDateStrRes(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nowLocalMinsRes(): number { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
function toMinsRes(t: string): number { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function isSlotPastRes(slot: string, date: string): boolean {
  return date === localTodayStrRes() && toMinsRes(slot) <= nowLocalMinsRes();
}
function generateSlotsRes(open: string, close: string, interval: number): string[] {
  const slots: string[] = [];
  for (let t = toMinsRes(open); t < toMinsRes(close); t += interval) {
    slots.push(`${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`);
  }
  return slots;
}
function isNoShowCandidate(r: ResRow & { source?: string }): boolean {
  if (r.status !== "confirmed") return false;
  return new Date(`${r.date}T${r.time}`).getTime() < Date.now() - 30 * 60 * 1000;
}

type ResRowEx = ResRow & { source?: string };

interface AvailTablePos { id: string; label: string; seats: number; section: string; }

function ReservationsView() {
  const { settings: appSettings } = useApp();
  const rs = appSettings.reservationSystem ?? {};
  const allSlots = generateSlotsRes(rs.openTime ?? "12:00", rs.closeTime ?? "22:00", rs.slotIntervalMinutes ?? 30);
  const activeTables = (appSettings.diningTables ?? []).filter((t) => t.active);

  const [rows,         setRows]         = useState<ResRowEx[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [actioning,    setActioning]    = useState<string | null>(null);
  const [filterDate,   setFilterDate]   = useState(localTodayStrRes);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [search,       setSearch]       = useState("");

  // ── Add walk-in/phone modal state ─────────────────────────────────────────
  const [showAdd,        setShowAdd]        = useState(false);
  const [addSource,      setAddSource]      = useState<"walk-in" | "phone">("walk-in");
  const [addDate,        setAddDate]        = useState(localTodayStrRes);
  const [addParty,       setAddParty]       = useState(2);
  const [addTime,        setAddTime]        = useState(() => {
    const first = generateSlotsRes(rs.openTime ?? "12:00", rs.closeTime ?? "22:00", rs.slotIntervalMinutes ?? 30)
      .find((s) => !isSlotPastRes(s, localTodayStrRes()));
    return first ?? "";
  });
  const [addTableId,     setAddTableId]     = useState("");
  const [addTableMeta,   setAddTableMeta]   = useState<AvailTablePos | null>(null);
  const [addAvailTables, setAddAvailTables] = useState<AvailTablePos[]>([]);
  const [addLoadingTbl,  setAddLoadingTbl]  = useState(false);
  const [addName,        setAddName]        = useState("");
  const [addEmail,       setAddEmail]       = useState("");
  const [addPhone,       setAddPhone]       = useState("");
  const [addNote,        setAddNote]        = useState("");
  const [addSaving,      setAddSaving]      = useState(false);
  const [addError,       setAddError]       = useState("");

  // Fetch available tables for the add modal
  const fetchAddTables = useCallback(async (date: string, time: string, party: number) => {
    if (!date || !time || !party) return;
    setAddLoadingTbl(true);
    try {
      const res  = await fetch(`/api/reservations/availability?date=${date}&time=${time}&partySize=${party}`);
      const json = await res.json() as { ok: boolean; availableTables?: AvailTablePos[] };
      setAddAvailTables(json.ok ? (json.availableTables ?? []) : []);
    } catch { setAddAvailTables([]); }
    finally { setAddLoadingTbl(false); }
  }, []);

  // Re-fetch tables when date/time/party changes in modal
  useEffect(() => {
    if (!showAdd) return;
    setAddTableId(""); setAddTableMeta(null);
    if (addTime && !isSlotPastRes(addTime, addDate)) fetchAddTables(addDate, addTime, addParty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addDate, addTime, addParty, showAdd]);

  // Auto-advance time when date changes to today
  useEffect(() => {
    if (isSlotPastRes(addTime, addDate)) {
      const first = allSlots.find((s) => !isSlotPastRes(s, addDate));
      if (first) setAddTime(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addDate]);

  function openAddModal() {
    const today = localTodayStrRes();
    const firstSlot = allSlots.find((s) => !isSlotPastRes(s, today)) ?? allSlots[0] ?? "";
    setAddSource("walk-in"); setAddDate(today); setAddTime(firstSlot);
    setAddParty(2); setAddTableId(""); setAddTableMeta(null); setAddAvailTables([]);
    setAddName(""); setAddEmail(""); setAddPhone(""); setAddNote("");
    setAddError(""); setAddSaving(false); setShowAdd(true);
  }

  async function handleAddBooking() {
    if (!addTableMeta || !addName.trim()) return;
    setAddSaving(true); setAddError("");
    try {
      const res  = await fetch("/api/pos/reservations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: addTableMeta.id, tableLabel: addTableMeta.label,
          tableSeats: addTableMeta.seats, section: addTableMeta.section,
          date: addDate, time: addTime, partySize: addParty,
          customerName: addName.trim(), customerEmail: addEmail.trim(),
          customerPhone: addPhone.trim(), note: addNote.trim(), source: addSource,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) { setShowAdd(false); fetchRows(); }
      else setAddError(json.error ?? "Failed to create booking.");
    } catch { setAddError("Network error — please try again."); }
    finally { setAddSaving(false); }
  }

  // ── Main list ──────────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      // Column sets in descending order of preference.
      // Each entry is tried in turn; we fall back if a column doesn't exist yet.
      const COLUMN_SETS = [
        "id,table_id,table_label,section,customer_name,customer_email,customer_phone,date,time,party_size,status,note,source,checked_in_at,checked_out_at",
        "id,table_id,table_label,section,customer_name,customer_email,customer_phone,date,time,party_size,status,note,checked_in_at,checked_out_at",
        "id,table_id,table_label,section,customer_name,customer_email,customer_phone,date,time,party_size,status,note",
      ];

      let data = null;
      for (const cols of COLUMN_SETS) {
        let q = supabase
          .from("reservations")
          .select(cols)
          .eq("date", filterDate)
          .order("time", { ascending: true });
        if (filterStatus) q = q.eq("status", filterStatus);
        // Only filter by source when the column set includes it
        if (filterSource && cols.includes("source")) q = q.eq("source", filterSource);

        const { data: d, error: e } = await q;
        if (!e) { data = d; break; }
        // Any error other than a missing-column schema error is terminal
        if (!e.message?.includes("does not exist") && !e.message?.includes("schema cache")) {
          console.error("ReservationsView fetch:", e.message);
          break;
        }
      }

      setRows((data ?? []) as unknown as ResRowEx[]);
    } catch (err) {
      console.error("ReservationsView fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [filterDate, filterStatus, filterSource]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    const ch = supabase
      .channel("pos-reservations-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, fetchRows)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchRows]);

  async function doStatus(resId: string, status: string) {
    setActioning(resId);
    await fetch(`/api/pos/reservations/${resId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const now = new Date().toISOString();
    setRows((prev) => prev.map((r) => r.id !== resId ? r : {
      ...r, status,
      ...(status === "checked_in"  ? { checked_in_at:  now } : {}),
      ...(status === "checked_out" ? { checked_out_at: now } : {}),
    }));
    setActioning(null);
  }

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.customer_name.toLowerCase().includes(q) ||
           r.customer_email.toLowerCase().includes(q) ||
           r.table_label.toLowerCase().includes(q);
  });

  const stats = {
    total:     rows.length,
    pending:   rows.filter((r) => r.status === "pending").length,
    confirmed: rows.filter((r) => r.status === "confirmed").length,
    dining:    rows.filter((r) => r.status === "checked_in").length,
    done:      rows.filter((r) => r.status === "checked_out").length,
    cancelled: rows.filter((r) => r.status === "cancelled" || r.status === "no_show").length,
  };

  const fmtDateShort = (d: string) => {
    const [y, mo, day] = d.split("-").map(Number);
    return new Date(y, mo - 1, day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  };

  // Tables grouped by section for the add modal selector
  const tablesBySection = activeTables.reduce<Record<string, typeof activeTables>>((acc, t) => {
    (acc[t.section || "Other"] = acc[t.section || "Other"] ?? []).push(t); return acc;
  }, {});

  const addSlotsForDate = allSlots; // full list; UI disables past ones

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-white font-bold text-lg">Reservations</h2>
          <p className="text-slate-400 text-xs mt-0.5">{fmtDateShort(filterDate)} · {rows.length} booking{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
          >
            <UserPlus size={13} /> Add Walk-in
          </button>
          <button
            onClick={fetchRows}
            disabled={loading}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl px-3 py-2 text-slate-300 text-xs font-medium transition"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { label: "Total",     value: stats.total,     cls: "text-slate-300" },
          { label: "Pending",   value: stats.pending,   cls: "text-amber-400" },
          { label: "Confirmed", value: stats.confirmed, cls: "text-green-400" },
          { label: "Dining",    value: stats.dining,    cls: "text-blue-400"  },
          { label: "Done",      value: stats.done,      cls: "text-teal-400"  },
          { label: "Cancelled", value: stats.cancelled, cls: "text-red-400"   },
        ].map((s) => (
          <div key={s.label} className="bg-slate-800/60 border border-slate-700 rounded-xl p-3">
            <div className={`text-xl font-bold ${s.cls}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2">
          <Calendar size={13} className="text-orange-400 flex-shrink-0" />
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="bg-transparent text-slate-200 text-sm focus:outline-none"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="checked_in">Dining</option>
          <option value="checked_out">Done</option>
          <option value="cancelled">Cancelled</option>
          <option value="no_show">No show</option>
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-sm focus:outline-none"
        >
          <option value="">All sources</option>
          <option value="online">Online</option>
          <option value="walk-in">Walk-in</option>
          <option value="phone">Phone</option>
          <option value="other">Other</option>
        </select>
        <div className="flex items-center gap-2 flex-1 min-w-[160px] bg-slate-800 border border-slate-700 rounded-xl px-3 py-2">
          <Search size={13} className="text-slate-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Name, email, table…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-slate-200 text-sm focus:outline-none placeholder-slate-500"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-orange-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 bg-slate-800/40 rounded-2xl border border-slate-700">
          <CalendarDays size={32} className="text-slate-600" />
          <p className="text-slate-400 font-semibold">No reservations found</p>
          <p className="text-slate-500 text-sm">{search ? "Try a different search." : "No bookings for this date / filter."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const cfg    = RES_STATUS_CFG[r.status] ?? RES_STATUS_CFG.pending;
            const srcCfg = SOURCE_CFG[r.source ?? "online"] ?? SOURCE_CFG.other;
            const busy   = actioning === r.id;
            const noShow = isNoShowCandidate(r);
            return (
              <div
                key={r.id}
                className={`border rounded-xl p-4 transition ${
                  noShow        ? "bg-amber-950/40 border-amber-500/50" :
                  r.status === "checked_in" ? "bg-slate-800/70 border-blue-500/50" :
                  "bg-slate-800/70 border-slate-700"
                }`}
              >
                {/* No-show warning */}
                {noShow && (
                  <div className="flex items-center gap-2 bg-amber-900/40 border border-amber-600/50 rounded-lg px-3 py-2 mb-3 text-amber-300 text-xs font-semibold">
                    <AlertTriangle size={13} className="flex-shrink-0" />
                    Guest may not have shown — reservation time has passed
                  </div>
                )}

                <div className="flex items-start justify-between gap-3 flex-wrap">
                  {/* Left */}
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Status + source + ref + timestamps */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                      {r.source && (
                        <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border ${srcCfg.cls}`}>
                          {srcCfg.label}
                        </span>
                      )}
                      <span className="text-slate-500 text-xs font-mono">{r.id.slice(0, 8).toUpperCase()}</span>
                      {r.checked_in_at && (
                        <span className="text-blue-400 text-xs flex items-center gap-1">
                          <LogIn size={11} /> {fmtTsPos(r.checked_in_at)}
                        </span>
                      )}
                      {r.checked_out_at && (
                        <span className="text-teal-400 text-xs flex items-center gap-1">
                          <LogOut size={11} /> {fmtTsPos(r.checked_out_at)}
                        </span>
                      )}
                    </div>
                    {/* Time / party / table */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
                      <span className="flex items-center gap-1.5"><Clock size={13} className="text-orange-400" />{fmt12Pos(r.time)}</span>
                      <span className="flex items-center gap-1.5"><Users size={13} className="text-orange-400" />{r.party_size} {r.party_size === 1 ? "guest" : "guests"}</span>
                      <span className="flex items-center gap-1.5"><UtensilsCrossed size={13} className="text-orange-400" />{r.table_label}{r.section ? <span className="text-slate-500"> · {r.section}</span> : null}</span>
                    </div>
                    {/* Customer */}
                    <div className="space-y-0.5">
                      <div className="text-white font-semibold text-sm">{r.customer_name}</div>
                      {r.customer_email && <div className="text-slate-400 text-xs">{r.customer_email}</div>}
                      {r.customer_phone && <div className="text-slate-400 text-xs">{r.customer_phone}</div>}
                    </div>
                    {r.note && (
                      <div className="bg-amber-900/30 border border-amber-700/40 rounded-lg px-2.5 py-1.5 text-amber-300 text-xs italic">
                        &ldquo;{r.note}&rdquo;
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {busy ? (
                      <Loader2 size={16} className="animate-spin text-slate-400 mx-auto" />
                    ) : (
                      <>
                        {r.status === "pending" && (
                          <button
                            onClick={() => doStatus(r.id, "confirmed")}
                            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <CheckCircle2 size={13} /> Confirm
                          </button>
                        )}
                        {(r.status === "confirmed" || noShow) && r.status !== "checked_in" && (
                          <button
                            onClick={() => doStatus(r.id, "checked_in")}
                            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <LogIn size={13} /> Check In
                          </button>
                        )}
                        {r.status === "checked_in" && (
                          <button
                            onClick={() => doStatus(r.id, "checked_out")}
                            className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <LogOut size={13} /> Check Out
                          </button>
                        )}
                        {noShow && r.status === "confirmed" && (
                          <button
                            onClick={() => doStatus(r.id, "no_show")}
                            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 active:scale-95 text-slate-400 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <AlertTriangle size={13} /> No Show
                          </button>
                        )}
                        {(r.status === "pending" || r.status === "confirmed" || r.status === "checked_in") && (
                          <button
                            onClick={() => doStatus(r.id, "cancelled")}
                            className="flex items-center gap-1.5 bg-slate-700 hover:bg-red-900/60 border border-slate-600 hover:border-red-700/60 active:scale-95 text-slate-400 hover:text-red-400 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                          >
                            <X size={13} /> Cancel
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Walk-in / Phone Booking Modal ─────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative w-full sm:max-w-lg bg-slate-900 border border-slate-700 sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh] overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
              <div>
                <h3 className="text-white font-bold text-base">Add Booking</h3>
                <p className="text-slate-400 text-xs mt-0.5">Walk-in or phone reservation</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-700 hover:text-white transition">
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-5">

              {/* Source toggle */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Source</p>
                <div className="flex gap-2">
                  {(["walk-in", "phone"] as const).map((src) => (
                    <button key={src} type="button" onClick={() => setAddSource(src)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                        addSource === src
                          ? "bg-orange-500 border-orange-500 text-white"
                          : "bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500"
                      }`}>
                      {src === "walk-in" ? "Walk-in" : "Phone booking"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date + party */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Date</label>
                  <input type="date" value={addDate} min={localTodayStrRes()} max={localMaxDateStrRes(rs.maxAdvanceDays ?? 30)}
                    onChange={(e) => setAddDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-orange-500 transition" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Guests</label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setAddParty((p) => Math.max(1, p - 1))}
                      className="w-9 h-9 rounded-full border border-slate-600 text-slate-400 hover:border-orange-500 hover:text-orange-400 font-bold transition flex items-center justify-center">−</button>
                    <span className="text-white font-bold text-lg w-6 text-center">{addParty}</span>
                    <button type="button" onClick={() => setAddParty((p) => Math.min(20, p + 1))}
                      className="w-9 h-9 rounded-full border border-slate-600 text-slate-400 hover:border-orange-500 hover:text-orange-400 font-bold transition flex items-center justify-center">+</button>
                  </div>
                </div>
              </div>

              {/* Time slots */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Time</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {addSlotsForDate.map((slot) => {
                    const past     = isSlotPastRes(slot, addDate);
                    const selected = addTime === slot;
                    return (
                      <button key={slot} type="button" disabled={past}
                        onClick={() => !past && setAddTime(slot)}
                        title={past ? "Time has passed" : undefined}
                        className={`py-2 rounded-lg text-xs font-semibold border transition-all ${
                          past
                            ? "bg-slate-900 text-slate-700 border-slate-800 cursor-not-allowed line-through"
                            : selected
                              ? "bg-orange-500 text-white border-orange-500"
                              : "bg-slate-800 text-slate-300 border-slate-700 hover:border-orange-500 hover:text-orange-300"
                        }`}>{fmt12Pos(slot)}</button>
                    );
                  })}
                </div>
                {addSlotsForDate.every((s) => isSlotPastRes(s, addDate)) && (
                  <p className="text-xs text-amber-400 mt-2">All slots for today have passed — select a future date.</p>
                )}
              </div>

              {/* Table selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Table
                  {addSource === "walk-in" && <span className="text-slate-500 font-normal normal-case ml-1">(select from all active tables)</span>}
                </label>
                {addSource === "walk-in" ? (
                  /* Walk-ins: pick any active table — staff can see what's free */
                  <div className="space-y-2">
                    {Object.entries(tablesBySection).map(([sec, tbls]) => (
                      <div key={sec}>
                        {sec && <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{sec}</p>}
                        <div className="grid grid-cols-4 gap-1.5">
                          {tbls.map((t) => {
                            const sel = addTableId === t.id;
                            return (
                              <button key={t.id} type="button"
                                onClick={() => { setAddTableId(t.id); setAddTableMeta({ id: t.id, label: t.label, seats: t.seats, section: t.section }); }}
                                className={`py-2 rounded-lg text-xs font-semibold border transition-all ${
                                  sel ? "bg-orange-500 text-white border-orange-500" : "bg-slate-800 text-slate-300 border-slate-700 hover:border-orange-500 hover:text-orange-300"
                                }`}>{t.label}</button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : addLoadingTbl ? (
                  <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                    <Loader2 size={14} className="animate-spin text-orange-500" /> Checking availability…
                  </div>
                ) : addAvailTables.length === 0 ? (
                  <p className="text-slate-500 text-sm py-2">No available tables for this slot — try a different time.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {addAvailTables.map((t) => {
                      const sel = addTableId === t.id;
                      return (
                        <button key={t.id} type="button"
                          onClick={() => { setAddTableId(t.id); setAddTableMeta(t); }}
                          className={`py-2 rounded-lg text-xs font-semibold border transition-all ${
                            sel ? "bg-orange-500 text-white border-orange-500" : "bg-slate-800 text-slate-300 border-slate-700 hover:border-orange-500 hover:text-orange-300"
                          }`}>{t.label}</button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Guest details */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Guest details</p>
                <input type="text" placeholder="Full name *" value={addName} onChange={(e) => setAddName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500 transition" />
                <input type="email" placeholder="Email (optional)" value={addEmail} onChange={(e) => setAddEmail(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500 transition" />
                <input type="tel" placeholder="Phone (optional)" value={addPhone} onChange={(e) => setAddPhone(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500 transition" />
                <textarea rows={2} placeholder="Notes (optional)" value={addNote} onChange={(e) => setAddNote(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-slate-200 text-sm placeholder-slate-500 resize-none focus:outline-none focus:border-orange-500 transition" />
              </div>

              {addError && (
                <div className="flex items-start gap-2 bg-red-900/40 border border-red-700/50 rounded-xl p-3 text-sm text-red-300">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />{addError}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-700 flex-shrink-0">
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-200 text-sm font-semibold transition">Cancel</button>
              <button
                onClick={handleAddBooking}
                disabled={addSaving || !addName.trim() || !addTableMeta || isSlotPastRes(addTime, addDate)}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              >
                {addSaving ? <><Loader2 size={14} className="animate-spin" />Saving…</> :
                 addSource === "walk-in" ? <><LogIn size={14} />Check In Now</> : <><CheckCircle2 size={14} />Create Booking</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main POS Page ─────────────────────────────────────────────────────────────

export default function POSPage() {
  const router = useRouter();
  const { currentStaff, logout, settings } = usePOS();
  const { settings: appSettings } = useApp();
  const [view, setView] = useState<View>("sale");
  const [time, setTime] = useState(""); // empty string on SSR, filled after mount
  const [mounted, setMounted] = useState(false);

  // ── Connectivity & offline outbox ─────────────────────────────────────────
  const { isOnline, recheck } = useConnectivity();
  const [outboxCount, setOutboxCount] = useState(0);
  const prevOnline = useRef(true);

  // Mount guard: prevents SSR/hydration mismatch from localStorage state
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!currentStaff) { router.replace("/pos/login"); return; }
    // Redirect to sale if current view is no longer permitted
    const p = currentStaff.permissions;
    const allowed: Record<View, boolean> = {
      sale: true,
      dashboard: p.canAccessDashboard,
      customers: p.canManageCustomers,
      staff: p.canManageStaff,
      settings: p.canAccessSettings,
      tables: true,
      reservations: true,
    };
    if (!allowed[view]) setView("sale");
  }, [mounted, currentStaff, router, view]);

  useEffect(() => {
    // Only run clock on client after mount
    setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })), 30000);
    return () => clearInterval(id);
  }, []);

  // Drain outbox when we come back online
  useEffect(() => {
    if (isOnline && !prevOnline.current) {
      retryFailed();
      drainOutbox().then(() => setOutboxCount(pendingCount()));
    }
    prevOnline.current = isOnline;
  }, [isOnline]);

  // Keep outbox badge count fresh (poll every 5 s)
  useEffect(() => {
    setOutboxCount(pendingCount());
    const id = setInterval(() => setOutboxCount(pendingCount()), 5000);
    return () => clearInterval(id);
  }, []);

  // Warn before tab close when there are unsynced sales
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (pendingCount() > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Show nothing until client has hydrated (avoids mismatch between SSR null and client session)
  if (!mounted || !currentStaff) return <div className="min-h-screen bg-slate-950" />;

  const perms = currentStaff.permissions;

  // hasTables: any dining tables exist (active or not) — shows Table Service tab
  const hasTables      = (appSettings.diningTables?.length ?? 0) > 0;
  // hasReservations: reservation system is explicitly enabled — shows Reservations tab
  // Use || hasTables so it also appears alongside Table Service when tables are configured.
  const hasReservations = (appSettings.reservationSystem?.enabled === true) || hasTables;

  const NAV = [
    { id: "sale"         as View, label: "Sale",          icon: ShoppingCart,    show: true },
    { id: "dashboard"    as View, label: "Dashboard",     icon: LayoutDashboard, show: perms.canAccessDashboard },
    { id: "customers"    as View, label: "Customers",     icon: Users,           show: perms.canManageCustomers },
    { id: "tables"       as View, label: "Table Service", icon: UtensilsCrossed, show: hasTables },
    { id: "reservations" as View, label: "Reservations",  icon: CalendarDays,    show: hasReservations },
    { id: "staff"        as View, label: "Staff",         icon: UserCog,         show: perms.canManageStaff },
    { id: "settings"     as View, label: "Settings",      icon: Settings2,       show: perms.canAccessSettings },
  ].filter((n) => n.show);

  const viewLabels: Record<View, string> = {
    sale: "Point of Sale",
    dashboard: "Sales Dashboard",
    customers: "Customers",
    staff: "Staff & Attendance",
    settings: "Settings",
    tables: "Table Service",
    reservations: "Reservations",
  };

  return (
    <div className="h-screen flex flex-col bg-slate-950 overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 h-14 bg-slate-900 border-b border-slate-700/50 flex items-center px-4 gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center">
            <ChefHat size={14} className="text-white" />
          </div>
          <span className="text-white font-bold text-sm hidden sm:block">{appSettings.restaurant?.name || settings.businessName || "POS"}</span>
        </div>

        <div className="h-6 w-px bg-slate-700 flex-shrink-0" />

        {/* Breadcrumb */}
        <p className="text-slate-300 text-sm font-medium hidden sm:block">{viewLabels[view]}</p>

        <div className="flex-1" />

        {/* Clock */}
        <p className="text-slate-400 text-sm font-mono hidden md:block">{time}</p>

        <div className="h-6 w-px bg-slate-700 flex-shrink-0 hidden md:block" />

        {/* Staff */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: currentStaff.avatarColor }}>
            {getInitials(currentStaff.name)}
          </div>
          <div className="hidden sm:block">
            <p className="text-white text-xs font-semibold leading-none">{currentStaff.name}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${
              currentStaff.role === "admin"   ? "bg-purple-500/20 text-purple-400" :
              currentStaff.role === "manager" ? "bg-blue-500/20   text-blue-400"   :
                                                "bg-slate-600     text-slate-400"
            }`}>
              {currentStaff.role}
            </span>
          </div>
        </div>

        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-slate-400 hover:text-red-400 text-xs font-medium transition-colors ml-2 px-3 py-2 rounded-lg hover:bg-red-500/10"
        >
          <LogOut size={14} />
          <span className="hidden sm:block">Logout</span>
        </button>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="flex-shrink-0 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-3">
          <WifiOff size={14} className="text-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-xs font-medium flex-1">
            No internet connection — cash payments only. Sales are saved locally.
            {outboxCount > 0 && ` ${outboxCount} sale${outboxCount > 1 ? "s" : ""} pending sync.`}
          </p>
          <button
            onClick={recheck}
            className="text-amber-400 hover:text-amber-300 transition-colors flex-shrink-0"
            title="Retry connection"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      )}

      {/* Online + pending sync indicator */}
      {isOnline && outboxCount > 0 && (
        <div className="flex-shrink-0 bg-blue-500/10 border-b border-blue-500/20 px-4 py-1.5 flex items-center gap-2">
          <Wifi size={12} className="text-blue-400 flex-shrink-0" />
          <p className="text-blue-300 text-xs flex-1">
            Syncing {outboxCount} offline sale{outboxCount > 1 ? "s" : ""} to server…
          </p>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {view === "sale" && <SaleView isOffline={!isOnline} />}
        {view === "dashboard" && perms.canAccessDashboard && <DashboardView />}
        {view === "customers" && perms.canManageCustomers && <CustomersView />}
        {view === "staff" && perms.canManageStaff && <StaffView />}
        {view === "settings" && perms.canAccessSettings && <SettingsView />}
        {view === "tables" && <TableStatusView />}
        {view === "reservations" && <ReservationsView />}
      </div>

      {/* Bottom nav */}
      <nav className="flex-shrink-0 h-16 bg-slate-900 border-t border-slate-700/50 flex items-stretch">
        {NAV.map((item) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
                active
                  ? "text-orange-400 bg-orange-500/10 border-t-2 border-orange-500"
                  : "text-slate-500 hover:text-slate-300 border-t-2 border-transparent"
              }`}
            >
              <item.icon size={20} />
              <span className="text-[10px] font-semibold">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
