"use client";

/**
 * Menu / ordering view for one table: category browsing, the cart (desktop
 * panel + mobile bottom sheet), and Send to Kitchen.
 *
 * Owns the whole cart lifecycle — the view mounts fresh per table visit, so
 * an abandoned cart dies with it (same behaviour as the old page-level
 * setCart([]) on every entry/exit). The page only learns about a successful
 * send via onSent(receipt).
 */

import { useState, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import {
  ChefHat, ArrowLeft, Plus, Minus, Trash2, SendHorizonal,
  StickyNote, X, Loader2, Package,
} from "lucide-react";
import CollectionFooter from "@/components/collection/CollectionFooter";
import { resolveStock, isAvailable } from "@/lib/stockUtils";
import { getOfferUnitPrice, isOfferActive, cartLineTotal, offerBadgeLabel } from "@/lib/menuOfferUtils";
import type { MenuItem, DiningTable } from "@/types";
import type { WaiterCartItem, WaiterReceipt } from "./_types";
import { fmtCur } from "./_utils";
import ItemModal from "./ItemModal";

// Use the shared resolver so waiter agrees with customer site / admin / POS.
// Once an item is in track-quantity mode, stockStatus is ignored (so a stale
// "out_of_stock" status carried over from manual mode can't block sales).
function isOutOfStock(item: MenuItem): boolean {
  return !isAvailable(item);
}

export default function MenuView({ table, covers, setCovers, waiterName, onBack, onSent }: {
  table: DiningTable;
  covers: number;
  setCovers: (n: number) => void;
  /** Signed-in waiter's name; undefined while the profile is still restoring
   *  (the kitchen note simply omits the Staff segment then). */
  waiterName: string | undefined;
  onBack: () => void;
  /** Order accepted by the kitchen — page shows the success screen + receipt. */
  onSent: (receipt: WaiterReceipt) => void;
}) {
  // ── Menu data from AppContext (single source of truth, same as admin/online) ─
  const { menuItems, categories, settings: appSettings } = useApp();
  const sym = appSettings.currency?.symbol ?? "£";

  const [activeCatId, setActiveCatId] = useState<string>("all");
  const [cart, setCart] = useState<WaiterCartItem[]>([]);
  const [kitchenNote, setKitchenNote] = useState("");
  const [modalItem, setModalItem] = useState<MenuItem | null>(null);
  const [showCart, setShowCart] = useState(false); // mobile bottom-sheet
  const [sending, setSending] = useState(false);

  // Determine which categories are "active" for filtering items.
  // If "all" -> null (shows everything).
  // If parent -> [parent, child1, child2...].
  // If sub -> [sub].
  const effectiveCatIds = useMemo(() => {
    if (activeCatId === "all") return null;

    const cat = categories.find((c) => c.id === activeCatId);
    if (!cat) return [activeCatId];

    // If it's a parent, include its children's IDs
    if (!cat.parentId) {
      const childIds = categories.filter((c) => c.parentId === cat.id).map((c) => c.id);
      return [cat.id, ...childIds];
    }

    // Otherwise it's a sub-category, just return itself
    return [cat.id];
  }, [activeCatId, categories]);

  // --- Hierarchical Category Logic for Mobile ---
  // Filtered lists for the sliders
  const parentCategories = categories.filter(c => !c.parentId);

  // Determine which parent is currently "active" to show its children
  const currentActiveObj = categories.find(c => c.id === activeCatId);
  const activeParentId = currentActiveObj?.parentId || (currentActiveObj && !currentActiveObj.parentId ? currentActiveObj.id : null);

  // Get subcategories belonging to the active parent
  const subCategoriesOfActive = activeParentId
    ? categories.filter(c => c.parentId === activeParentId)
    : [];

  // Helper to check if a parent pill should be highlighted
  // (true if parent itself is selected OR one of its children is)
  const isParentPillActive = (parentId: string) => {
    if (activeCatId === parentId) return true;
    return categories.find(c => c.id === activeCatId)?.parentId === parentId;
  };

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
    // math can apply it across qty. Same logic as the modal handleAdd and the
    // POS counter — shared in_store channel.
    const offerUnitPrice = getOfferUnitPrice(item, "in_store");
    const basePrice = offerUnitPrice ?? item.price;
    const cartLevelOffer = (offerUnitPrice === null && isOfferActive(item, "in_store"))
      ? item.offer
      : undefined;
    addToCart({
      lineId: crypto.randomUUID(),
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
    if (cart.length === 0 || sending) return;
    setSending(true);
    const total = cart.reduce((s, l) => s + lineMoney(l), 0);
    let res: Response;
    try {
      res = await fetch("/api/waiter/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableLabel: table.label,
          tableId: table.id,
          covers,
          staffName: waiterName,
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
      onSent({
        tableLabel: table.label,
        waiterName: waiterName ?? "Staff",
        date: new Date().toISOString(),
        items: cart.map((l) => ({ name: l.name, qty: l.quantity, price: l.unitPrice })),
        total,
        paymentMethod: "pending",
        orderIds: [],
      });
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

  const cartTotal = cart.reduce((s, l) => s + lineMoney(l), 0);
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);

  // Waiter = in_store channel (same as POS). Hide items admin tagged online-
  // only. Legacy items without a channels value stay visible.
  const visibleItems = menuItems.filter((m) => {
    // 1. Channel check: Only show items enabled for in-store/POS
    const ch = m.channels;
    if (ch && ch.length > 0 && !ch.includes("in_store")) return false;

    // 2. Hierarchy check: Show item if its category is in the effective set
    if (effectiveCatIds && !effectiveCatIds.includes(m.categoryId)) return false;

    return true;
  });

  return (
    <div className="h-full bg-slate-950 flex flex-col overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex-shrink-0"
        >
          <ArrowLeft size={16} />
        </button>

        {/* Table + covers */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-orange-400 font-black text-xl">{table.label}</span>
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

          {/* Hierarchical Category Sliders */}
          <div className="flex flex-col flex-shrink-0 border-b border-slate-800">

            {/* Row 1: All + Parent Categories */}
            <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
              <button
                onClick={() => setActiveCatId("all")}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${activeCatId === "all" ? "bg-orange-500 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
              >
                All
              </button>
              {parentCategories.map((cat) => {
                const active = isParentPillActive(cat.id);
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCatId(cat.id)}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition ${active
                      ? "bg-orange-500 text-white"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                  >
                    {cat.emoji && <span className="mr-1">{cat.emoji}</span>}{cat.name}
                  </button>
                );
              })}
            </div>

            {/* Row 2: Subcategories (Only visible if the active parent has children) */}
            {subCategoriesOfActive.length > 0 && (
              <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide animate-in slide-in-from-top-1 duration-200">
                {subCategoriesOfActive.map((sub) => {
                  const active = activeCatId === sub.id;
                  return (
                    <button
                      key={sub.id}
                      onClick={() => setActiveCatId(sub.id)}
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

          {/* Item grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {visibleItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-65 text-slate-500">
                <Package size={36} className="mb-3 text-slate-700" />
                <p className="text-sm">No items found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3">
                {visibleItems.map((item) => {
                  const stockState = resolveStock(item);
                  const oos = stockState === "out_of_stock";
                  const lowStock = stockState === "low_stock";
                  const hasVar = (item.variations?.length ?? 0) > 0 || (item.addOns?.length ?? 0) > 0;
                  // Offer math (shared in_store channel — same as POS counter)
                  const offerLabel = offerBadgeLabel(item, "in_store");
                  const offerPrice = getOfferUnitPrice(item, "in_store"); // null = cart-level (bogo/multibuy/qty) or no offer
                  const showStrike = offerPrice !== null && offerPrice < item.price;
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
                                <path d="m9 18 6-6-6-6" />
                              </svg>
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Cart (desktop) ────────────────────────────────────────── */}
        <div className="hidden md:flex w-80 xl:w-96 flex-col border-l border-slate-800 bg-slate-900">
          <div className="px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <h2 className="text-white font-bold text-sm">
              Current Order · {table.label}
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
              <h2 className="text-white font-bold">Order · {table.label}</h2>
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

      <CollectionFooter />

    </div>
  );
}
