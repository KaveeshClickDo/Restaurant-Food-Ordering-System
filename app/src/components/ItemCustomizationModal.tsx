"use client";

import { useState } from "react";
import { MenuItem, CartItem } from "@/types";
import { X, Plus, Minus, ChevronRight } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { isAvailable } from "@/lib/stockUtils";

const DIETARY_COLORS: Record<string, string> = {
  vegetarian:  "bg-green-100 text-green-700",
  vegan:       "bg-emerald-100 text-emerald-700",
  halal:       "bg-purple-100 text-purple-700",
  "gluten-free": "bg-amber-100 text-amber-700",
};

interface Props {
  item: MenuItem;
  onClose: () => void;
}

export default function ItemCustomizationModal({ item, onClose }: Props) {
  const { addToCart } = useApp();
  const [quantity, setQuantity] = useState(1);
  const [selectedVariations, setSelectedVariations] = useState<Record<string, string>>({});
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");

  // Calculate price
  const variationExtra = Object.entries(selectedVariations).reduce((sum, [varId, optId]) => {
    const variation = item.variations?.find((v) => v.id === varId);
    const option = variation?.options.find((o) => o.id === optId);
    return sum + (option?.price ?? 0);
  }, 0);

  const addOnExtra = selectedAddOns.reduce((sum, id) => {
    const ao = item.addOns?.find((a) => a.id === id);
    return sum + (ao?.price ?? 0);
  }, 0);

  const unitPrice = item.price + variationExtra + addOnExtra;
  const total = unitPrice * quantity;

  function handleAddToCart() {
    if (!isAvailable(item)) return; // defensive guard
    const cartItem: CartItem = {
      id: crypto.randomUUID(),
      menuItemId: item.id,
      name: item.name,
      price: unitPrice,
      quantity,
      specialInstructions: instructions || undefined,
      selectedAddOns: selectedAddOns.map((id) => {
        const ao = item.addOns!.find((a) => a.id === id)!;
        return ao;
      }),
    };
    addToCart(cartItem);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Item image banner */}
        {item.image && (
          <div className="w-full h-44 overflow-hidden bg-gray-100 flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.image}
              alt={item.name}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="flex-1 pr-4">
            <h2 className="text-xl font-bold text-gray-900">{item.name}</h2>
            <p className="text-gray-500 text-sm mt-1 leading-relaxed">{item.description}</p>
            {/* Dietary badges */}
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
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition text-gray-600"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Variations */}
          {item.variations?.map((variation) => (
            <div key={variation.id} className="px-5 py-4 border-b border-gray-50">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                <ChevronRight size={15} className="text-orange-500" />
                {variation.name}
                <span className="text-xs text-gray-400 font-normal ml-1">Required</span>
              </h3>
              <div className="space-y-2">
                {variation.options.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex items-center gap-3 cursor-pointer group"
                  >
                    <input
                      type="radio"
                      name={variation.id}
                      value={opt.id}
                      checked={selectedVariations[variation.id] === opt.id}
                      onChange={() =>
                        setSelectedVariations((prev) => ({
                          ...prev,
                          [variation.id]: opt.id,
                        }))
                      }
                      className="w-4 h-4 accent-orange-500"
                    />
                    <span className="flex-1 text-sm text-gray-700 group-hover:text-gray-900">
                      {opt.label}
                    </span>
                    {opt.price > 0 && (
                      <span className="text-sm text-gray-500">+£{opt.price.toFixed(2)}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}

          {/* Add-ons */}
          {item.addOns && item.addOns.length > 0 && (
            <div className="px-5 py-4 border-b border-gray-50">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                <ChevronRight size={15} className="text-orange-500" />
                Add extras
                <span className="text-xs text-gray-400 font-normal ml-1">Optional</span>
              </h3>
              <div className="space-y-2">
                {item.addOns.map((ao) => (
                  <label key={ao.id} className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selectedAddOns.includes(ao.id)}
                      onChange={(e) =>
                        setSelectedAddOns((prev) =>
                          e.target.checked
                            ? [...prev, ao.id]
                            : prev.filter((id) => id !== ao.id)
                        )
                      }
                      className="w-4 h-4 rounded accent-orange-500"
                    />
                    <span className="flex-1 text-sm text-gray-700 group-hover:text-gray-900">
                      {ao.name}
                    </span>
                    <span className="text-sm text-gray-500">+£{ao.price.toFixed(2)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Special instructions */}
          <div className="px-5 py-4">
            <h3 className="font-semibold text-gray-900 mb-2">Special instructions</h3>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="E.g. no onions, extra sauce…"
              rows={3}
              className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 bg-white">
          {/* Quantity */}
          <div className="flex items-center justify-between mb-4">
            <span className="font-medium text-gray-700">Quantity</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition"
              >
                <Minus size={14} />
              </button>
              <span className="w-6 text-center font-semibold text-gray-900">{quantity}</span>
              <button
                onClick={() => setQuantity((q) => q + 1)}
                className="w-8 h-8 rounded-full bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center transition"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Add to order */}
          <button
            onClick={handleAddToCart}
            className="w-full bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-between px-5"
          >
            <span>Add to order</span>
            <span>£{total.toFixed(2)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
