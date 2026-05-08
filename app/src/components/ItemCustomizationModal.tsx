"use client";

import { useState } from "react";
import { MenuItem, CartItem } from "@/types";
import { X, Plus, Minus, UtensilsCrossed, ChevronRight, Check } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { isAvailable } from "@/lib/stockUtils";

const DIETARY_COLORS: Record<string, string> = {
  vegetarian:    "bg-green-100 text-green-700",
  vegan:         "bg-emerald-100 text-emerald-700",
  halal:         "bg-purple-100 text-purple-700",
  "gluten-free": "bg-amber-100 text-amber-700",
};

interface Props {
  item: MenuItem;
  onClose: () => void;
}

export default function ItemCustomizationModal({ item, onClose }: Props) {
  const { addToCart } = useApp();
  const [quantity, setQuantity]               = useState(1);
  const [selectedVariations, setSelectedVariations] = useState<Record<string, string>>({});
  const [selectedAddOns, setSelectedAddOns]   = useState<string[]>([]);
  const [instructions, setInstructions]       = useState("");
  const [imgError, setImgError]               = useState(false);

  // Price calculation
  const variationExtra = Object.entries(selectedVariations).reduce((sum, [varId, optId]) => {
    const opt = item.variations?.find((v) => v.id === varId)?.options.find((o) => o.id === optId);
    return sum + (opt?.price ?? 0);
  }, 0);

  const addOnExtra = selectedAddOns.reduce((sum, id) => {
    return sum + (item.addOns?.find((a) => a.id === id)?.price ?? 0);
  }, 0);

  const unitPrice = item.price + variationExtra + addOnExtra;
  const total     = unitPrice * quantity;

  function handleAddToCart() {
    if (!isAvailable(item)) return;
    const cartItem: CartItem = {
      id:           crypto.randomUUID(),
      menuItemId:   item.id,
      name:         item.name,
      price:        unitPrice,
      quantity,
      specialInstructions: instructions || undefined,
      selectedAddOns: selectedAddOns.map((id) => item.addOns!.find((a) => a.id === id)!),
    };
    addToCart(cartItem);
    onClose();
  }

  const hasImage = !!item.image && !imgError;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className={`relative bg-white rounded-t-2xl sm:rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col
        ${hasImage ? "sm:max-w-2xl" : "sm:max-w-md"} max-h-[92vh]`}>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-md hover:bg-gray-100 transition text-gray-600"
        >
          <X size={16} strokeWidth={2.5} />
        </button>

        {/* Two-column layout when image exists */}
        <div className={`flex flex-1 min-h-0 ${hasImage ? "flex-col sm:flex-row" : "flex-col"}`}>

          {/* ── Left: Image pane ──────────────────────────────────────────── */}
          {hasImage ? (
            <div className="relative sm:w-[42%] flex-shrink-0 bg-zinc-100 h-48 sm:h-auto overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt={item.name}
                onError={() => setImgError(true)}
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
          ) : null}

          {/* If image was set but failed, show no image pane at all — handled by hasImage=false */}

          {/* ── Right: Content pane ───────────────────────────────────────── */}
          <div className="flex flex-col flex-1 min-h-0 min-w-0">

            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
              {!hasImage && !item.image && (
                <div className="w-12 h-12 rounded-xl bg-zinc-100 flex items-center justify-center mb-3">
                  <UtensilsCrossed className="w-6 h-6 text-zinc-400" strokeWidth={1.4} />
                </div>
              )}
              <h2 className="text-xl font-bold text-gray-900 leading-snug pr-6">{item.name}</h2>
              {item.description && (
                <p className="text-gray-500 text-sm mt-1 leading-relaxed">{item.description}</p>
              )}
              {item.dietary.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {item.dietary.map((d) => (
                    <span
                      key={d}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${DIETARY_COLORS[d] ?? "bg-gray-100 text-gray-600"}`}
                    >
                      {d}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto">

              {/* Variations */}
              {item.variations?.map((variation) => (
                <div key={variation.id} className="px-6 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-1.5 mb-3">
                    <ChevronRight size={13} className="text-orange-500 flex-shrink-0" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
                      {variation.name}
                    </span>
                    <span className="text-[10px] text-gray-400 font-medium ml-0.5">· Required</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {variation.options.map((opt) => {
                      const active = selectedVariations[variation.id] === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            setSelectedVariations((prev) => ({ ...prev, [variation.id]: opt.id }))
                          }
                          className={`relative rounded-xl border-2 px-4 py-3 text-left transition-all ${
                            active
                              ? "border-orange-500 bg-orange-50"
                              : "border-gray-200 bg-gray-50 hover:border-gray-300"
                          }`}
                        >
                          {active && (
                            <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-orange-500 flex items-center justify-center">
                              <Check size={9} className="text-white" strokeWidth={3} />
                            </span>
                          )}
                          <p className={`text-sm font-semibold ${active ? "text-orange-700" : "text-gray-800"}`}>
                            {opt.label}
                          </p>
                          <p className={`text-xs mt-0.5 ${active ? "text-orange-500" : "text-gray-500"}`}>
                            £{(item.price + (opt.price ?? 0)).toFixed(2)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Add-ons */}
              {item.addOns && item.addOns.length > 0 && (
                <div className="px-6 py-4 border-b border-gray-50">
                  <div className="flex items-center gap-1.5 mb-3">
                    <ChevronRight size={13} className="text-orange-500 flex-shrink-0" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
                      Add-ons
                    </span>
                    <span className="text-[10px] text-gray-400 font-medium ml-0.5">· Optional</span>
                  </div>
                  <div className="space-y-2">
                    {item.addOns.map((ao) => {
                      const checked = selectedAddOns.includes(ao.id);
                      return (
                        <button
                          key={ao.id}
                          type="button"
                          onClick={() =>
                            setSelectedAddOns((prev) =>
                              checked ? prev.filter((id) => id !== ao.id) : [...prev, ao.id]
                            )
                          }
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                            checked
                              ? "border-orange-400 bg-orange-50"
                              : "border-gray-200 bg-gray-50 hover:border-gray-300"
                          }`}
                        >
                          <span className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                            checked ? "bg-orange-500 border-orange-500" : "border-gray-300"
                          }`}>
                            {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                          </span>
                          <span className={`flex-1 text-sm ${checked ? "text-orange-800 font-medium" : "text-gray-700"}`}>
                            {ao.name}
                          </span>
                          <span className={`text-sm flex-shrink-0 ${checked ? "text-orange-600 font-semibold" : "text-gray-500"}`}>
                            +£{ao.price.toFixed(2)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Notes for the kitchen */}
              <div className="px-6 py-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <ChevronRight size={13} className="text-orange-500 flex-shrink-0" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
                    Notes for the kitchen
                  </span>
                </div>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Allergies, preferences…"
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400 resize-none transition"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 bg-white flex-shrink-0">
              <div className="flex items-center gap-3">
                {/* Qty controls */}
                <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-7 h-7 rounded-lg bg-white shadow-sm flex items-center justify-center text-gray-600 hover:text-gray-900 transition active:scale-90"
                  >
                    <Minus size={13} strokeWidth={2.5} />
                  </button>
                  <span className="w-6 text-center font-bold text-gray-900 text-[15px] tabular-nums">{quantity}</span>
                  <button
                    onClick={() => setQuantity((q) => q + 1)}
                    className="w-7 h-7 rounded-lg bg-white shadow-sm flex items-center justify-center text-gray-600 hover:text-gray-900 transition active:scale-90"
                  >
                    <Plus size={13} strokeWidth={2.5} />
                  </button>
                </div>

                {/* Add to order */}
                <button
                  onClick={handleAddToCart}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white font-bold py-3 rounded-xl transition-all flex items-center justify-between px-5 text-[15px]"
                >
                  <span>Add to order</span>
                  <span className="tabular-nums">£{total.toFixed(2)}</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
