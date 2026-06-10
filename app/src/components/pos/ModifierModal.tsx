"use client";

import { useState } from "react";
import { POSProduct, POSModifier, POSModifierOption, POSCartModifier } from "@/types/pos";
import { X, CheckCircle2 } from "lucide-react";
import { fmt } from "./_utils";

export default function ModifierModal({
  product,
  onConfirm,
  onClose,
  currencySymbol,
}: {
  product: POSProduct;
  onConfirm: (modifiers: POSCartModifier[], note?: string) => void;
  onClose: () => void;
  currencySymbol: string;
}) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");

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
    const trimmedNote = note.trim();
    onConfirm(flat, trimmedNote ? trimmedNote : undefined);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between">
          <div>
            <h2 className="text-white font-bold text-base">{product.name}</h2>
            {product.description && (
              <p className="text-slate-400 text-sm mt-0.5 leading-snug line-clamp-2">{product.description}</p>
            )}
            {/* <p className="text-slate-400 text-sm">{fmt(product.price + totalAdjust, currencySymbol)}</p> */}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Modifiers + special note */}
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
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center flex-shrink-0 justify-center transition-all ${
                          selected ? "bg-orange-500 border-orange-500" : "border-slate-500"
                        }`}>
                          {selected && <CheckCircle2 size={12} className="text-white" />}
                        </div>
                        <span className="text-sm font-medium text-start">{option.label}</span>
                      </div>
                      {option.priceAdjust !== 0 && (
                        <span className={`text-sm font-bold whitespace-nowrap ${option.priceAdjust > 0 ? "text-green-400" : "text-red-400"}`}>
                          {option.priceAdjust > 0 ? "+" : ""}{fmt(option.priceAdjust, currencySymbol)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Special note — sent through to the kitchen ticket on the line */}
          <div>
            <p className="text-white font-semibold text-sm mb-2">Special note <span className="text-slate-500 font-normal">(optional)</span></p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. no onions, well done, allergy: nuts"
              rows={2}
              maxLength={200}
              className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-orange-500 resize-none"
            />
          </div>
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
            Add to order · {fmt(product.price + totalAdjust, currencySymbol)}
          </button>
        </div>
      </div>
    </div>
  );
}
