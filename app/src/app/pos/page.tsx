"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePOS } from "@/context/POSContext";
import {
  POSProduct, POSCategory, POSCartItem, POSModifier, POSModifierOption,
  POSCartModifier, POSCustomer, POSStaff, POSSale, POSSettings,
  ROLE_PERMISSIONS,
} from "@/types/pos";
import {
  ShoppingCart, LayoutDashboard, Users, UserCog, Settings2, ChefHat,
  Plus, Minus, Trash2, Tag, Percent, Receipt, Search, X, LogOut,
  Clock, TrendingUp, Package, Star, CreditCard, Banknote, Shuffle,
  ChevronRight, ChevronDown, CheckCircle2, AlertCircle, BadgeDollarSign,
  Pencil, Save, RefreshCw, ToggleLeft, ToggleRight, Printer, Gift,
  Phone, Mail, Calendar, ArrowUpRight, Trophy, Zap, BarChart3,
  UserPlus, ClockIcon, Timer, PanelLeftClose, Flame, CircleCheck,
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

type View = "sale" | "dashboard" | "customers" | "staff" | "settings";

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
}: {
  total: number;
  onClose: () => void;
  onComplete: (method: "cash" | "card" | "split", payments: {method:"cash"|"card";amount:number}[], cashTendered?: number) => void;
  currencySymbol: string;
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
              onClick={() => setStep("card")}
              className="w-full flex items-center gap-4 p-4 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 hover:border-blue-500/50 rounded-xl transition-all group"
            >
              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                <CreditCard size={20} className="text-blue-400" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">Card</p>
                <p className="text-slate-400 text-xs">Tap, chip or swipe</p>
              </div>
              <ChevronRight size={16} className="text-slate-500 ml-auto" />
            </button>
            <button
              onClick={() => setStep("split")}
              className="w-full flex items-center gap-4 p-4 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 hover:border-purple-500/50 rounded-xl transition-all group"
            >
              <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                <Shuffle size={20} className="text-purple-400" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold text-sm">Split</p>
                <p className="text-slate-400 text-xs">Cash + card</p>
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

// ─── Receipt Modal ─────────────────────────────────────────────────────────────

function ReceiptModal({ sale, onClose }: { sale: POSSale; onClose: () => void }) {
  const { settings } = usePOS();
  const sym = settings.currencySymbol;

  // Restaurant name: prefer receipt-specific name, fall back to business name
  const restaurantName = (settings.receiptRestaurantName?.trim() || settings.businessName || "Restaurant").toUpperCase();

  // VAT label and sign — read from the snapshot saved on the sale itself so it's
  // always accurate even if settings change after the transaction.
  const taxRate      = sale.taxRate      ?? settings.taxRate;
  const taxInclusive = sale.taxInclusive ?? settings.taxInclusive;
  const vatLabel     = taxInclusive
    ? `VAT (${taxRate}% incl.)`
    : `VAT (${taxRate}%)`;
  const vatSign = taxInclusive ? "" : "+";

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

        {/* ── Buttons ──────────────────────────────────────────── */}
        <div className="px-4 pb-4 grid grid-cols-2 gap-2">
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
    discount, settings, assignedCustomer,
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
              <li key={item.lineId} className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold leading-snug truncate">{item.name}</p>
                    {item.modifiers.map((m) => (
                      <p key={m.optionId} className="text-slate-400 text-xs mt-0.5">+ {m.optionLabel}</p>
                    ))}
                    {item.note && <p className="text-orange-400 text-xs italic mt-0.5">&ldquo;{item.note}&rdquo;</p>}
                  </div>
                  <p className="text-white font-bold text-sm flex-shrink-0">{fmt(item.price * item.quantity, settings.currencySymbol)}</p>
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
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                discount.pct > 0
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

function SaleView() {
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
                return (
                  <button
                    key={product.id}
                    onClick={() => !outOfStock && handleProductTap(product)}
                    disabled={outOfStock}
                    className={`relative flex flex-col items-start p-4 rounded-2xl border text-left transition-all active:scale-95 ${
                      outOfStock
                        ? "bg-slate-800/30 border-slate-700/30 opacity-50 cursor-not-allowed"
                        : "bg-slate-800 border-slate-700/50 hover:border-orange-500/60 hover:bg-slate-750 hover:shadow-lg hover:shadow-orange-500/10"
                    }`}
                  >
                    {/* Emoji / color tile */}
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xl mb-3 flex-shrink-0"
                      style={{ backgroundColor: product.color }}
                    >
                      {product.emoji ?? "🍽️"}
                    </div>
                    {product.popular && (
                      <span className="absolute top-2 right-2 text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">
                        Popular
                      </span>
                    )}
                    <p className="text-white text-xs font-semibold leading-snug mb-1 line-clamp-2">{product.name}</p>
                    <p className="text-orange-400 font-bold text-sm mt-auto">{fmt(product.price, settings.currencySymbol)}</p>
                    {product.trackStock && product.stockQty !== undefined && (
                      <p className={`text-[10px] mt-0.5 ${product.stockQty <= 3 ? "text-red-400" : "text-slate-500"}`}>
                        {outOfStock ? "Out of stock" : `Stock: ${product.stockQty}`}
                      </p>
                    )}
                    {product.modifiers && product.modifiers.length > 0 && !outOfStock && (
                      <div className="absolute bottom-2 right-2">
                        <ChevronRight size={12} className="text-slate-500" />
                      </div>
                    )}
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

function DashboardView() {
  const { sales, products, settings } = usePOS();
  const today = new Date().toDateString();
  const todaySales = sales.filter((s) => !s.voided && new Date(s.date).toDateString() === today);
  const totalRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);
  const totalTransactions = todaySales.length;
  const avgOrder = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
  const totalTips = todaySales.reduce((sum, s) => sum + s.tipAmount, 0);

  // Best sellers
  const itemCounts: Record<string, { name: string; count: number; revenue: number }> = {};
  for (const sale of sales.filter((s) => !s.voided)) {
    for (const item of sale.items) {
      if (!itemCounts[item.productId]) itemCounts[item.productId] = { name: item.name, count: 0, revenue: 0 };
      itemCounts[item.productId].count += item.quantity;
      itemCounts[item.productId].revenue += item.price * item.quantity;
    }
  }
  const bestSellers = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 8);

  // Revenue last 7 days
  const last7: { label: string; revenue: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStr = d.toDateString();
    const rev = sales.filter((s) => !s.voided && new Date(s.date).toDateString() === dayStr).reduce((s, x) => s + x.total, 0);
    last7.push({ label: d.toLocaleDateString("en-GB", { weekday: "short" }), revenue: rev });
  }
  const maxRev = Math.max(...last7.map((d) => d.revenue), 1);

  // Payment mix
  const payMix = { cash: 0, card: 0, split: 0 };
  for (const s of todaySales) { payMix[s.paymentMethod] = (payMix[s.paymentMethod] || 0) + 1; }
  const payTotal = totalTransactions || 1;

  // Cost/margin (approximate)
  const totalCost = sales.filter(s=>!s.voided).reduce((sum, sale) => {
    return sum + sale.items.reduce((s, item) => {
      const p = products.find(pr => pr.id === item.productId);
      return s + (p?.cost ?? 0) * item.quantity;
    }, 0);
  }, 0);
  const totalRevAll = sales.filter(s=>!s.voided).reduce((s,x)=>s+x.total,0);
  const marginPct = totalRevAll > 0 ? ((totalRevAll - totalCost) / totalRevAll) * 100 : 0;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h2 className="text-white font-bold text-xl">Sales Dashboard</h2>
          <p className="text-slate-400 text-sm mt-1">Today · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Today's Revenue", value: fmt(totalRevenue, settings.currencySymbol), icon: TrendingUp, color: "text-green-400", bg: "bg-green-500/10" },
            { label: "Transactions", value: totalTransactions.toString(), icon: Receipt, color: "text-blue-400", bg: "bg-blue-500/10" },
            { label: "Average Order", value: fmt(avgOrder, settings.currencySymbol), icon: BarChart3, color: "text-purple-400", bg: "bg-purple-500/10" },
            { label: "Tips Collected", value: fmt(totalTips, settings.currencySymbol), icon: BadgeDollarSign, color: "text-amber-400", bg: "bg-amber-500/10" },
          ].map((card) => (
            <div key={card.label} className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <div className={`w-10 h-10 ${card.bg} rounded-xl flex items-center justify-center mb-3`}>
                <card.icon size={20} className={card.color} />
              </div>
              <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              <p className="text-slate-400 text-xs mt-1">{card.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Revenue chart */}
          <div className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-orange-400" /> Revenue — Last 7 Days</h3>
            <div className="flex items-end gap-2 h-32">
              {last7.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: "100px" }}>
                    <div
                      className={`w-full rounded-t-lg transition-all ${i === 6 ? "bg-orange-500" : "bg-slate-600"}`}
                      style={{ height: `${Math.max(4, (d.revenue / maxRev) * 100)}%` }}
                    />
                  </div>
                  <span className="text-slate-500 text-[10px]">{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Payment mix */}
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2"><CreditCard size={16} className="text-blue-400" /> Payment Mix</h3>
            <div className="space-y-3">
              {([["cash", "Cash", "bg-green-500"] , ["card", "Card", "bg-blue-500"], ["split", "Split", "bg-purple-500"]] as [string,string,string][]).map(([key, label, color]) => {
                const pct = ((payMix[key as keyof typeof payMix] ?? 0) / payTotal) * 100;
                return (
                  <div key={key}>
                    <div className="flex justify-between text-xs text-slate-400 mb-1"><span>{label}</span><span>{payMix[key as keyof typeof payMix] ?? 0} txns</span></div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-700">
              <p className="text-slate-400 text-xs">Overall Margin</p>
              <p className="text-white font-bold text-xl">{fmtPct(marginPct)}</p>
              <p className="text-slate-500 text-xs">All-time · excl. voided</p>
            </div>
          </div>
        </div>

        {/* Best sellers */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2"><Flame size={16} className="text-orange-400" /> Best Sellers (All Time)</h3>
          {bestSellers.length === 0 ? (
            <p className="text-slate-500 text-sm">No sales recorded yet</p>
          ) : (
            <div className="space-y-2">
              {bestSellers.map((item, i) => (
                <div key={item.name} className="flex items-center gap-4">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${i === 0 ? "bg-amber-500 text-white" : i === 1 ? "bg-slate-500 text-white" : i === 2 ? "bg-orange-700 text-white" : "bg-slate-700 text-slate-300"}`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{item.name}</p>
                    <div className="h-1.5 bg-slate-700 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(item.count / bestSellers[0].count) * 100}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-white text-sm font-bold">{item.count} sold</p>
                    <p className="text-slate-400 text-xs">{fmt(item.revenue, settings.currencySymbol)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent transactions */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
          <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2"><Receipt size={16} className="text-slate-400" /> Recent Transactions</h3>
          {sales.length === 0 ? (
            <p className="text-slate-500 text-sm">No transactions yet</p>
          ) : (
            <div className="space-y-2">
              {sales.slice(0, 10).map((sale) => (
                <div key={sale.id} className={`flex items-center gap-4 px-4 py-3 rounded-xl ${sale.voided ? "bg-red-500/5 border border-red-500/20" : "bg-slate-700/50"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${sale.voided ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>
                    {sale.voided ? "V" : "✓"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">#{sale.receiptNo} · {sale.staffName}</p>
                    <p className="text-slate-400 text-xs">{sale.items.length} item{sale.items.length !== 1 ? "s" : ""} · {sale.paymentMethod} · {relTime(sale.date)}</p>
                  </div>
                  <p className={`font-bold text-sm flex-shrink-0 ${sale.voided ? "text-red-400 line-through" : "text-white"}`}>
                    {fmt(sale.total, settings.currencySymbol)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
    </div>
  );
}

// ─── Settings View ─────────────────────────────────────────────────────────────

function SettingsView() {
  const { settings, setSettings, products, setProducts, categories, setCategories } = usePOS();
  const [local, setLocal] = useState({ ...settings });
  const [tab, setTab] = useState<"general"|"menu"|"receipt"|"hardware">("general");
  const [editProduct, setEditProduct] = useState<POSProduct | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", categoryId: "", price: "", cost: "", emoji: "", popular: false });
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", categoryId: "", price: "", cost: "", emoji: "🍽️" });
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
    setEditDraft({
      name:       product.name,
      categoryId: product.categoryId,
      price:      product.price.toString(),
      cost:       product.cost?.toString() ?? "",
      emoji:      product.emoji ?? "🍽️",
      popular:    product.popular ?? false,
    });
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
            emoji:      editDraft.emoji || "🍽️",
            popular:    editDraft.popular,
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
      emoji: newProduct.emoji || "🍽️", color: "#e2e8f0", trackStock: false, active: true,
    };
    setProducts((prev) => [...prev, p]);
    setNewProduct({ name: "", categoryId: "", price: "", cost: "", emoji: "🍽️" });
    setShowAddProduct(false);
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
              {[
                { key: "businessName", label: "Business Name", type: "text" },
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
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: product.color }}>
                              {product.emoji ?? "🍽️"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className={`text-sm font-semibold ${product.active ? "text-white" : "text-slate-500"}`}>{product.name}</p>
                                {product.popular && <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full font-medium">Popular</span>}
                              </div>
                              <p className="text-slate-400 text-xs">{fmt(product.price, settings.currencySymbol)}{product.cost ? ` · Cost: ${fmt(product.cost, settings.currencySymbol)}` : ""}</p>
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
                {[
                  { key: "receiptRestaurantName", label: "Restaurant Name", type: "text",  placeholder: "e.g. Spice Garden", hint: "Printed in large text at the top" },
                  { key: "receiptPhone",          label: "Phone Number",    type: "tel",   placeholder: "e.g. 020 7123 4567" },
                  { key: "receiptWebsite",        label: "Website",         type: "text",  placeholder: "e.g. www.spicegarden.co.uk" },
                  { key: "receiptEmail",          label: "Email",           type: "email", placeholder: "e.g. hello@spicegarden.co.uk" },
                  { key: "receiptVatNumber",      label: "VAT Number",      type: "text",  placeholder: "e.g. GB 123 4567 89", hint: "Leave blank if not VAT registered" },
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
                { key: "receiptCustomMessage",   label: "Custom Message",     placeholder: "e.g. Follow us @spicegarden · Use code THANKS10 for 10% off", hint: "Optional second line — great for promotions or social handles" },
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

                const name = (local.receiptRestaurantName || "Restaurant Name").toUpperCase();
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
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
              <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Printer size={16} className="text-slate-400" /> Receipt Printer</h3>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-amber-400 text-sm">
                Connect a network receipt printer by entering its IP address. Supports ESC/POS compatible printers (Epson, Star Micronics).
              </div>
              {[
                { label: "Printer IP Address", placeholder: "192.168.1.100" },
                { label: "Port", placeholder: "9100" },
              ].map((f) => (
                <div key={f.label}>
                  <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                  <input placeholder={f.placeholder} className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                </div>
              ))}
              <button className="w-full py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-colors flex items-center justify-center gap-2">
                <Zap size={14} /> Test Connection
              </button>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-3">Cash Drawer</h3>
              <p className="text-slate-400 text-sm">Cash drawer triggers automatically on cash payment via ESC/POS printer port.</p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-3">Card Terminal</h3>
              <p className="text-slate-400 text-sm">Pair any standalone card terminal (SumUp, Zettle, Square). The POS records the payment — the terminal handles the transaction.</p>
            </div>
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
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              {/* Emoji + Name row */}
              <div className="flex gap-3">
                <div className="w-20 flex-shrink-0">
                  <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                  <input
                    value={editDraft.emoji}
                    onChange={(e) => setEditDraft((d) => ({ ...d, emoji: e.target.value }))}
                    placeholder="🍽️"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500"
                  />
                </div>
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
            <div className="p-5 space-y-3">
              <div className="flex gap-3">
                <div className="w-20 flex-shrink-0">
                  <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                  <input value={newProduct.emoji} onChange={(e) => setNewProduct((p) => ({ ...p, emoji: e.target.value }))} placeholder="🍽️"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500" />
                </div>
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

// ─── Main POS Page ─────────────────────────────────────────────────────────────

export default function POSPage() {
  const router = useRouter();
  const { currentStaff, logout, settings } = usePOS();
  const [view, setView] = useState<View>("sale");
  const [time, setTime] = useState(""); // empty string on SSR, filled after mount
  const [mounted, setMounted] = useState(false);

  // Mount guard: prevents SSR/hydration mismatch from localStorage state
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!currentStaff) { router.replace("/pos/login"); }
  }, [mounted, currentStaff, router]);

  useEffect(() => {
    // Only run clock on client after mount
    setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })), 30000);
    return () => clearInterval(id);
  }, []);

  // Show nothing until client has hydrated (avoids mismatch between SSR null and client session)
  if (!mounted || !currentStaff) return <div className="min-h-screen bg-slate-950" />;

  const NAV = [
    { id: "sale" as View, label: "Sale", icon: ShoppingCart },
    { id: "dashboard" as View, label: "Dashboard", icon: LayoutDashboard },
    { id: "customers" as View, label: "Customers", icon: Users },
    { id: "staff" as View, label: "Staff", icon: UserCog },
    { id: "settings" as View, label: "Settings", icon: Settings2 },
  ];

  const viewLabels: Record<View, string> = {
    sale: "Point of Sale",
    dashboard: "Sales Dashboard",
    customers: "Customers",
    staff: "Staff & Attendance",
    settings: "Settings",
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
          <span className="text-white font-bold text-sm hidden sm:block">{settings.businessName}</span>
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
            <p className="text-slate-400 text-[10px] capitalize leading-none mt-0.5">{currentStaff.role}</p>
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

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {view === "sale" && <SaleView />}
        {view === "dashboard" && <DashboardView />}
        {view === "customers" && <CustomersView />}
        {view === "staff" && <StaffView />}
        {view === "settings" && <SettingsView />}
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
