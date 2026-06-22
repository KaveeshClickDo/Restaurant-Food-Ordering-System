"use client";

import { useMemo, useState } from "react";
import { usePOS } from "@/context/POSContext";
import { POSProduct, POSSale, getOfferPrice, isOfferActive } from "@/types/pos";
import { ChevronRight, Search, X, Users, Star, Package, ShoppingCart } from "lucide-react";
import { fmt, getInitials } from "./_utils";
import ModifierModal from "./ModifierModal";
import PaymentModal from "./PaymentModal";
import ReceiptModal from "./ReceiptModal";
import OrderPanel from "./OrderPanel";
import { resolveStock, isAvailable, LOW_STOCK_THRESHOLD } from "@/lib/stockUtils";

export default function SaleView({ isOffline = false }: { isOffline?: boolean }) {
  const { products, categories, addToCart, settings, cart, imageCache } = usePOS();
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [modifierProduct, setModifierProduct] = useState<POSProduct | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [completedSale, setCompletedSale] = useState<POSSale | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [showServiceFee, setShowServiceFee] = useState(false);
  const { completeSale, afterTaxTotal, grandTotal, discount, setDiscount, tipAmount, setTipAmount, serviceFeePct, setServiceFeePct, settings: s, customers, assignedCustomer, setAssignedCustomer } = usePOS();
  const [discountInput, setDiscountInput] = useState(discount.pct.toString());
  const [discountNote, setDiscountNote] = useState(discount.note);
  const [tipCustom, setTipCustom] = useState("");
  const [serviceFeeInput, setServiceFeeInput] = useState(serviceFeePct.pct.toString());
  const [customerSearch, setCustomerSearch] = useState("");

  const sortedCats = [...categories].sort((a, b) => a.order - b.order);

  // When a parent category is selected, include items from it AND all of its
  // sub-categories — otherwise a parent whose items live only in sub-categories
  // would show as an empty tab. Mirrors the customer menu's behaviour.
  const activeCatIds = useMemo(() => {
    if (activeCategory === "all") return null;
    const childIds = categories.filter((c) => c.parentId === activeCategory).map((c) => c.id);
    return new Set<string>([activeCategory, ...childIds]);
  }, [activeCategory, categories]);

  // --- Hierarchical Category Logic for Mobile ---    
  // Filtered lists for the sliders
  const parentCategories = sortedCats.filter(c => !c.parentId);

  // Determine which parent is currently "active" to show its children
  const currentActiveObj = sortedCats.find(c => c.id === activeCategory);
  const activeParentId = currentActiveObj?.parentId || (currentActiveObj && !currentActiveObj.parentId ? currentActiveObj.id : null);

  // Get subcategories belonging to the active parent
  const subCategoriesOfActive = activeParentId
    ? sortedCats.filter(c => c.parentId === activeParentId)
    : [];

  // Helper to check if a parent pill should be highlighted 
  // (true if parent itself is selected OR one of its children is)
  const isParentPillActive = (parentId: string) => {
    if (activeCategory === parentId) return true;
    return sortedCats.find(c => c.id === activeCategory)?.parentId === parentId;
  };


  const filtered = products.filter((p) => {
    if (!p.active) return false;
    // POS = in_store channel. Items admin marked online-only (e.g. an
    // online-exclusive deal) shouldn't appear on the till. Legacy items
    // without channels default to both in the loader, so they stay visible.
    const ch = p.channels;
    if (ch && ch.length > 0 && !ch.includes("in_store")) return false;
    if (activeCatIds && !activeCatIds.has(p.categoryId)) return false;
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

  async function handlePaymentComplete(
    method: "cash" | "card" | "split" | "gift_card",
    payments: { method: "cash" | "card"; amount: number }[],
    cashTendered?: number,
    giftCard?: { code: string; amount: number },
  ) {
    const { sale, error } = await completeSale(method, payments, cashTendered, giftCard);
    if (!sale) {
      // Surface the server's actual reason (e.g. "'Burger' is no longer
      // available on the menu", "Insufficient stock") instead of a generic
      // network message. Falls back to the network copy when the request
      // never reached the server.
      alert(error ?? "Couldn't save the sale to the server. Check your network and try again.");
      return;
    }
    setShowPayment(false);
    setShowMobileCart(false);
    setCompletedSale(sale);
  }

  const filteredCustomers = customers.filter((c) =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone?.includes(customerSearch) || c.email?.toLowerCase().includes(customerSearch.toLowerCase())
  );

  return (
    <div className="flex h-full relative">
      {/* Modifier modal */}
      {modifierProduct && (
        <ModifierModal
          product={modifierProduct}
          currencySymbol={settings.currencySymbol}
          onConfirm={(mods, note) => { addToCart(modifierProduct, mods, note); setModifierProduct(null); }}
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
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Apply Discount</h3>
              <button onClick={() => setShowDiscount(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-slate-400 text-xs mb-2">Discount percentage</p>
            <div className="flex gap-1 sm:gap-2 mb-4">
              {[5, 10, 15, 20, 25, 50].map((v) => (
                <button key={v} onClick={() => setDiscountInput(v.toString())}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${discountInput === v.toString() ? "bg-orange-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                  {v}%
                </button>
              ))}
            </div>
            {/* Discounts are capped at 100% regardless of how the settings
                value is configured — 110% off would imply paying the customer.
                Browser-enforced max= only restricts spinner clicks, so we also
                clamp on Apply below. */}
            <input type="number" min={0} max={Math.min(100, s.maxDiscountPercent)} value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-base sm:text-lg font-bold outline-none focus:border-orange-500 mb-3" placeholder="Custom %" />
            <input type="text" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 mb-5" placeholder="Reason (optional)" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setDiscount({ pct: 0, note: "" }); setDiscountInput("0"); setDiscountNote(""); setShowDiscount(false); }}
                className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">
                Clear
              </button>
              <button onClick={() => {
                const raw = parseFloat(discountInput) || 0;
                const clamped = Math.max(0, Math.min(raw, 100, s.maxDiscountPercent));
                setDiscount({ pct: clamped, note: discountNote });
                setDiscountInput(clamped.toString());
                setShowDiscount(false);
              }}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tip modal */}
      {showTip && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Add Tip</h3>
              <button onClick={() => setShowTip(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
              {s.defaultTipOptions.map((pct) => {
                const amt = afterTaxTotal * (pct / 100);
                return (
                  <button key={pct} onClick={() => setTipAmount(parseFloat(amt.toFixed(2)))}
                    className={`py-3 rounded-xl text-sm font-bold transition-all ${tipAmount === parseFloat(amt.toFixed(2)) ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                    {pct}% · {fmt(amt, s.currencySymbol)}
                  </button>
                );
              })}
            </div>
            <input type="number" step="0.01" min={0} value={tipCustom} onChange={(e) => setTipCustom(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-base sm:text-lg font-bold outline-none focus:border-amber-500 mb-5" placeholder="Custom amount" />
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

      {/* Service Fee modal */}
      {showServiceFee && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Add Service Fee</h3>
              <button onClick={() => setShowServiceFee(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
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
              <button onClick={() => { setServiceFeePct({ pct: 0 }); setServiceFeeInput("0"); setShowServiceFee(false); }}
                className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">
                Clear
              </button>
              <button onClick={() => {
                const raw = parseFloat(serviceFeeInput) || 0;
                const clamped = Math.max(0, Math.min(raw, 100));
                setServiceFeePct({ pct: clamped });
                setServiceFeeInput(clamped.toString());
                setShowServiceFee(false);
              }}
                className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-semibold text-sm transition-colors">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer selector */}
      {showCustomer && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
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
                    <p className="text-slate-400 text-xs">{c.phone ?? c.email ?? "No contact"} · {c.loyaltyPoints ?? 0}pts</p>
                  </div>
                  {c.tags.includes("VIP") && <Star size={12} className="text-amber-400 flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Left: Catalogue */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 md:pb-0">
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

        {/* Hierarchical Category Sliders */}
        <div className="bg-slate-900/50 border-b border-slate-700/30 flex flex-col flex-shrink-0 border-b border-slate-800">

          {/* Row 1: All + Parent Categories */}
          <div className="px-4 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setActiveCategory("all")}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${activeCategory === "all" ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
            >
              All
            </button>
            {parentCategories.map((cat) => {
              const active = isParentPillActive(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${active ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
                >
                  {cat.emoji} {cat.name}
                </button>
              );
            })}
          </div>

          {/* Row 2: Subcategories (Only visible if the active parent has children) */}
          {subCategoriesOfActive.length > 0 && (
            <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide animate-in slide-in-from-top-1 duration-200">
              {subCategoriesOfActive.map((sub) => {
                const active = activeCategory === sub.id;
                return (
                  <button
                    key={sub.id}
                    onClick={() => setActiveCategory(sub.id)}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold border transition ${active
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-slate-900/50 border border-slate-700 text-slate-500 hover:text-slate-300"
                      }`}
                  >
                    {sub.emoji && <span className="text-xs">{sub.emoji}</span>}
                    <span>{sub.name}</span>
                  </button>
                );
              })}
            </div>
          )}

        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
              <Package size={36} className="mb-3 text-slate-700" />
              <p className="text-sm">No items found</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {filtered.map((product) => {
                // Use the shared resolver so POS, customer site, waiter and admin
                // agree on availability. `isAvailable` honours BOTH track-quantity
                // (qty <= 0 → OOS) and manual status (stockStatus === "out_of_stock"
                // → OOS), which the old inline check missed for manual mode.
                const stockState = resolveStock(product);
                const outOfStock = !isAvailable(product);
                const lowStock = stockState === "low_stock" && !outOfStock;
                const isTrackedQty = typeof product.stockQty === "number";
                const offerPrice = getOfferPrice(product);
                const hasOffer = isOfferActive(product);
                const offerBadgeText = (() => {
                  const o = product.offer!;
                  if (o?.label?.trim()) return o.label.trim();
                  switch (o?.type) {
                    case "percent": return `${o.value}% OFF`;
                    case "fixed": return `${settings.currencySymbol}${o.value} OFF`;
                    case "price": return "SPECIAL";
                    case "bogo": return `BUY ${o.buyQty ?? 1} GET ${o.freeQty ?? 1} FREE`;
                    case "multibuy": return `${o.buyQty ?? 2} FOR ${settings.currencySymbol}${o.value}`;
                    case "qty_discount": return `${o.minQty ?? 2}+ GET ${o.value}% OFF`;
                    default: return "OFFER";
                  }
                });
                return (
                  <button
                    key={product.id}
                    onClick={() => !outOfStock && handleProductTap(product)}
                    disabled={outOfStock}
                    className={`relative flex flex-col items-start rounded-2xl border text-left transition-all active:scale-95 overflow-hidden ${outOfStock
                      ? "bg-slate-800/30 border-slate-700/30 opacity-50 cursor-not-allowed"
                      : hasOffer
                        ? "bg-slate-800 border-amber-500/50 hover:border-amber-400/70 hover:shadow-lg hover:shadow-amber-500/10"
                        : "bg-slate-800 border-slate-700/50 hover:border-orange-500/60 hover:shadow-lg hover:shadow-orange-500/10"
                      }`}
                  >
                    {/* Image or emoji tile */}
                    {product.imageUrl ? (
                      <div className="w-full aspect-[5/3] max-h-[75px] relative flex-shrink-0 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imageCache[product.imageUrl] ?? product.imageUrl}
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
                      <div className="w-full p-4 pb-0 relative">
                        <div
                          className="w-15 h-15 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                          style={{ backgroundColor: product.color }}
                        >
                          {product.emoji ?? "🍽️"}
                        </div>
                        {outOfStock && (
                          <span className="absolute top-2 right-2 text-[9px] bg-red-500/90 text-white px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">
                            OOS
                          </span>
                        )}
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
                      {product.description && (
                        <p className="text-slate-500 text-[11px] mt-0.5 line-clamp-1">{product.description}</p>
                      )}
                      <div className="flex items-center justify-between gap-1">
                        {/* Simple per-unit offer: show discounted + strikethrough */}
                        {offerPrice !== null ? (
                          <div className="flex flex-wrap items-baseline gap-1">
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
                      {/* Stock label. Tracked items always show the count; manual-
                          mode items show OOS / Low when the admin has set it. */}
                      {isTrackedQty && product.stockQty !== undefined ? (
                        <p className={`text-[10px] mt-0.5 ${product.stockQty <= LOW_STOCK_THRESHOLD ? "text-red-400" : "text-slate-500"}`}>
                          {outOfStock ? "Out of stock" : `Stock: ${product.stockQty}`}
                        </p>
                      ) : outOfStock ? (
                        <p className="text-[10px] mt-0.5 text-red-400">Out of stock</p>
                      ) : lowStock ? (
                        <p className="text-[10px] mt-0.5 text-amber-400">Low stock</p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Cart Toggle / Bottom Bar */}
      {!showMobileCart && (
        <div className="md:hidden absolute bottom-0 left-0 right-0 p-4 bg-slate-900 border-t border-slate-700/50 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-40">
          <button
            onClick={() => setShowMobileCart(true)}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white rounded-xl py-3 px-4 flex items-center justify-between font-bold shadow-lg transition-colors"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} />
              <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                {cart.reduce((s, l) => s + l.quantity, 0)} <span className="hidden sm:inline">items</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] sm:text-[13px]">View Order</span>
              <span className="opacity-60 text-sm font-normal">|</span>
              <span>{fmt(grandTotal, settings.currencySymbol)}</span>
            </div>
          </button>
        </div>
      )}

      {/* Right: Order panel */}
      <div className={`
        ${showMobileCart ? 'fixed inset-0 z-50 flex flex-col bg-slate-950' : 'hidden md:flex md:flex-col'}
        md:w-75 xl:w-96 flex-shrink-0 md:static md:block
      `}>
        {showMobileCart && (
          <div className="md:hidden bg-slate-900 border-b border-slate-800 p-4 flex items-center flex-shrink-0 pt-safe-top">
            <button onClick={() => setShowMobileCart(false)} className="flex items-center gap-2 text-slate-300 hover:text-white font-semibold transition-colors">
              <X size={18} />
              <span>Back to Menu</span>
            </button>
          </div>
        )}
        <div className="flex-1 overflow-hidden md:h-full">
          <OrderPanel
            onCharge={() => { setShowPayment(true); }}
            onSelectCustomer={() => { setShowCustomer(true); }}
            onOpenDiscount={() => { setShowDiscount(true); }}
            onOpenTip={() => { setShowTip(true); }}
            onOpenServiceFee={() => { setShowServiceFee(true); }}
          />
        </div>
      </div>
    </div>
  );
}
