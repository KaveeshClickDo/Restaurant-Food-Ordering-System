"use client";

/**
 * Variation / add-on picker for menu items that have modifiers.
 * Builds the cart line (name with labels, unit price, qty, note) and hands
 * it back via onAdd — cart state stays with the caller.
 */

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { X, Minus, Plus } from "lucide-react";
import { getOfferUnitPrice, isOfferActive } from "@/lib/menuOfferUtils";
import type { MenuItem } from "@/types";
import type { WaiterCartItem } from "./_types";
import { fmtCur } from "./_utils";

export default function ItemModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (cartItem: WaiterCartItem) => void;
}) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";

  // Initialize state with the first option of EVERY variation group selected by default
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    item.variations?.forEach((v) => {
      if (v.options.length > 0) {
        initial[v.id] = v.options[0].id;
      }
    });
    return initial;
  });

  const [addOnIds, setAddOnIds] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  // Calculate the total extra cost from all selected variation options
  const variationExtra = item.variations?.reduce((total, v) => {
    const selectedOptId = selectedOptions[v.id];
    const option = v.options.find((o) => o.id === selectedOptId);
    return total + (option?.price ?? 0);
  }, 0) ?? 0;

  const addOnTotal = (item.addOns ?? [])
    .filter((a) => addOnIds.has(a.id))
    .reduce((s, a) => s + a.price, 0);
  // Per-unit offers (percent / fixed / price) discount the BASE only — not
  // variations / add-ons. Mirrors POS + customer site. Cart-level offers
  // (bogo / multibuy / qty_discount) return null here and are snapshotted on
  // the cart line at add time so cartLineTotal can apply them across qty.
  const offerUnitPrice = getOfferUnitPrice(item, "in_store");
  const basePrice = offerUnitPrice ?? item.price;
  const unitPrice = basePrice + variationExtra + addOnTotal;
  const cartLevelOffer = (offerUnitPrice === null && isOfferActive(item, "in_store"))
    ? item.offer
    : undefined;

  // Check if all required variations have a selection
  const isMissingRequired = item.variations?.some(
    (v) => v.required !== false && !selectedOptions[v.id]
  );

  function buildName(): string {
    let name = item.name;
    const labels: string[] = [];

    item.variations?.forEach((v) => {
      const optId = selectedOptions[v.id];
      const opt = v.options.find((o) => o.id === optId);
      if (opt) labels.push(opt.label);
    });

    if (labels.length) name += ` (${labels.join(", ")})`;

    const addOnNames = (item.addOns ?? [])
      .filter((a) => addOnIds.has(a.id))
      .map((a) => a.name);
    if (addOnNames.length) name += " + " + addOnNames.join(", ");

    return name;
  }

  const handleToggleOption = (variationId: string, optionId: string, isRequired: boolean) => {
    setSelectedOptions((prev) => {
      const next = { ...prev };
      // If it's already selected and NOT required, deselect it
      if (prev[variationId] === optionId && !isRequired) {
        delete next[variationId];
      } else {
        // Otherwise set/change the selection for this group
        next[variationId] = optionId;
      }
      return next;
    });
  };

  function handleAdd() {
    onAdd({
      lineId: crypto.randomUUID(),
      menuItemId: item.id,
      name: buildName(),
      unitPrice,
      quantity: qty,
      note: note.trim() || undefined,
      offer: cartLevelOffer,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-800 rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-700">
          <div>
            <h3 className="text-white font-bold text-lg leading-tight">{item.name}</h3>
            {item.description && (
              <p className="text-slate-400 text-sm mt-0.5 leading-snug">{item.description}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition ml-3 flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {/* Multi-Variations List */}
          {item.variations?.map((variation) => {
            const isReq = variation.required !== false;
            return (
              <div key={variation.id}>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-slate-300 text-xs font-bold uppercase tracking-widest">
                    {variation.name}
                  </p>
                  {isReq && (
                    <span className="text-[10px] bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded font-bold">REQUIRED</span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {variation.options.map((opt) => {
                    const active = selectedOptions[variation.id] === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleToggleOption(variation.id, opt.id, isReq)}
                        className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all ${active
                          ? "bg-orange-500 border-orange-500 text-white"
                          : "bg-slate-700/50 border-slate-600 text-slate-200 hover:border-orange-500/50"
                          }`}
                      >
                        <span className="text-left">{opt.label}</span>
                        <span className={active ? "text-orange-100" : "text-slate-400"}>
                          {fmtCur(item.price + opt.price, sym)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Add-ons */}
          {(item.addOns ?? []).length > 0 && (
            <div>
              <p className="text-slate-300 text-xs font-bold uppercase tracking-widest mb-2">Add-ons</p>
              <div className="grid grid-cols-1 gap-2">
                {item.addOns!.map((addon) => {
                  const checked = addOnIds.has(addon.id);
                  return (
                    <button
                      key={addon.id}
                      onClick={() => {
                        setAddOnIds((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(addon.id); else next.add(addon.id);
                          return next;
                        });
                      }}
                      className={`flex text-left items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all ${checked
                        ? "bg-orange-500/20 border-orange-500 text-orange-300"
                        : "bg-slate-700/50 border-slate-600 text-slate-200 hover:border-orange-500/50"
                        }`}
                    >
                      <span>{addon.name}</span>
                      <span className={checked ? "text-orange-300 whitespace-nowrap" : "text-slate-400 whitespace-nowrap"}>
                        +{fmtCur(addon.price, sym)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Note */}
          <div>
            <p className="text-slate-300 text-xs font-bold uppercase tracking-widest mb-2">
              Special instruction (optional)
            </p>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. No onions, extra sauce…"
              className="w-full bg-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        {/* Footer: qty + add */}
        <div className="p-5 border-t border-slate-700 flex flex-wrap items-center gap-3">
          {/* Qty stepper */}
          <div className="flex items-center gap-2 bg-slate-700 rounded-xl p-1">
            <button
              onClick={() => setQty(Math.max(1, qty - 1))}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-600 transition"
            >
              <Minus size={14} />
            </button>
            <span className="text-white font-bold w-6 text-center text-sm sm:text-base">{qty}</span>
            <button
              onClick={() => setQty(qty + 1)}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-600 transition"
            >
              <Plus size={14} />
            </button>
          </div>

          <button
            onClick={handleAdd}
            disabled={isMissingRequired}
            className={`flex-1 flex items-center justify-center gap-2 px-1 py-3 rounded-xl font-bold transition-all ${
              isMissingRequired
                ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                : "bg-orange-500 hover:bg-orange-400 text-white active:scale-[0.98]"
            }`}
          >
            <Plus size={16} />
            {isMissingRequired ? "Selection Required" : `Add · ${fmtCur(unitPrice * qty, sym)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
