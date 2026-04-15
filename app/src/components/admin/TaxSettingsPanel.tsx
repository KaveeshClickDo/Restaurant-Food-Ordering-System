"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { TaxSettings } from "@/types";
import {
  Receipt, CheckCircle, ToggleLeft, ToggleRight,
  AlertTriangle, Info, ShoppingCart, Tag,
} from "lucide-react";

// ─── Small shared helpers ─────────────────────────────────────────────────────

function Toggle({
  enabled, onToggle, size = "md",
}: { enabled: boolean; onToggle: () => void; size?: "sm" | "md" }) {
  const track = size === "sm" ? "w-9 h-5" : "w-11 h-6";
  const thumb = size === "sm"
    ? `w-3.5 h-3.5 ${enabled ? "translate-x-4" : "translate-x-0.5"}`
    : `w-4 h-4 ${enabled ? "translate-x-6" : "translate-x-1"}`;
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      className={`relative inline-flex items-center ${track} rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-1 ${
        enabled ? "bg-green-500" : "bg-gray-300"
      }`}
    >
      <span className={`inline-block bg-white rounded-full shadow-sm transition-transform ${thumb}`} />
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{children}</p>
  );
}

// ─── Live preview card ────────────────────────────────────────────────────────

function TaxPreview({ draft }: { draft: TaxSettings }) {
  const exampleSubtotal = 25.00;
  const exampleDelivery = 2.99;
  const exampleService  = 1.25;
  const base            = exampleSubtotal + exampleDelivery + exampleService;

  let vatAmount = 0;
  let total     = base;
  let vatLine   = "";

  if (draft.enabled && draft.rate > 0) {
    if (draft.inclusive) {
      vatAmount = parseFloat((exampleSubtotal * draft.rate / (100 + draft.rate)).toFixed(2));
      total     = base;                       // total unchanged — VAT is inside the price
      vatLine   = `Incl. VAT (${draft.rate}%)`;
    } else {
      vatAmount = parseFloat((exampleSubtotal * draft.rate / 100).toFixed(2));
      total     = parseFloat((base + vatAmount).toFixed(2));
      vatLine   = `VAT (${draft.rate}%)`;
    }
  }

  const fmt = (n: number) => `£${n.toFixed(2)}`;

  return (
    <div className="bg-gray-900 rounded-2xl p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Live preview · example order
      </p>
      <div className="bg-white rounded-xl p-4 space-y-2 text-sm">
        {/* Items */}
        <div className="flex justify-between text-gray-600">
          <span>Items subtotal</span>
          <span>{fmt(exampleSubtotal)}</span>
        </div>
        <div className="flex justify-between text-gray-500 text-xs">
          <span>Delivery fee</span>
          <span>{fmt(exampleDelivery)}</span>
        </div>
        <div className="flex justify-between text-gray-500 text-xs">
          <span>Service fee</span>
          <span>{fmt(exampleService)}</span>
        </div>

        {/* VAT line */}
        {draft.enabled && draft.showBreakdown && vatAmount > 0 && (
          <div className={`flex justify-between text-xs font-semibold pt-1 ${
            draft.inclusive ? "text-gray-400" : "text-orange-600"
          }`}>
            <span>{vatLine}</span>
            <span>{draft.inclusive ? fmt(vatAmount) : `+${fmt(vatAmount)}`}</span>
          </div>
        )}

        {/* Total */}
        <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-100 text-base">
          <span>Total</span>
          <span>{fmt(total)}</span>
        </div>

        {/* Inclusive note */}
        {draft.enabled && draft.inclusive && draft.showBreakdown && vatAmount > 0 && (
          <p className="text-[11px] text-gray-400 text-right">
            Prices include {draft.rate}% VAT
          </p>
        )}
      </div>

      {/* Mode chip */}
      {draft.enabled ? (
        <div className={`mt-3 text-center text-xs font-semibold py-1.5 rounded-lg ${
          draft.inclusive
            ? "bg-blue-900/40 text-blue-300"
            : "bg-orange-900/40 text-orange-300"
        }`}>
          {draft.inclusive ? "VAT-Inclusive mode" : "VAT-Exclusive mode — adds to total"}
        </div>
      ) : (
        <div className="mt-3 text-center text-xs font-semibold py-1.5 rounded-lg bg-gray-700/60 text-gray-400">
          VAT disabled — no tax applied
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function TaxSettingsPanel() {
  const { settings, updateSettings } = useApp();
  const [draft, setDraft] = useState<TaxSettings>({ ...settings.taxSettings });
  const [saved, setSaved] = useState(false);
  const [rateError, setRateError] = useState("");

  function patch(p: Partial<TaxSettings>) {
    setDraft((d) => ({ ...d, ...p }));
    setRateError("");
    setSaved(false);
  }

  function handleSave() {
    if (draft.enabled) {
      const r = draft.rate;
      if (!r || r <= 0 || r > 100) {
        setRateError("VAT rate must be between 0.1 and 100.");
        return;
      }
    }
    updateSettings({ taxSettings: { ...draft } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="space-y-5">
      {/* Panel header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Receipt size={18} className="text-blue-600" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">Tax Settings</h2>
            <p className="text-xs text-gray-400">
              Configure VAT — applied to cart, checkout, receipts, and emails
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-0">
          {/* ── Form ────────────────────────────────────────────────────────── */}
          <div className="p-6 space-y-7">

            {/* Master toggle */}
            <div>
              <SectionLabel>VAT Status</SectionLabel>
              <div className="flex items-center justify-between gap-4 bg-gray-50 rounded-2xl px-5 py-4 border border-gray-100">
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    {draft.enabled ? "VAT enabled" : "VAT disabled"}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {draft.enabled
                      ? "Tax calculations are active across the entire ordering flow"
                      : "No tax is applied — prices are charged as listed"}
                  </p>
                </div>
                <Toggle enabled={draft.enabled} onToggle={() => patch({ enabled: !draft.enabled })} />
              </div>
            </div>

            {/* VAT rate */}
            <div className={draft.enabled ? "" : "opacity-40 pointer-events-none"}>
              <SectionLabel>VAT Rate</SectionLabel>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  VAT Percentage
                </label>
                <div className="relative max-w-xs">
                  <input
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.1"
                    value={draft.rate}
                    onChange={(e) => patch({ rate: parseFloat(e.target.value) || 0 })}
                    className={`w-full px-4 pr-10 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition ${
                      rateError ? "border-red-400 bg-red-50" : "border-gray-200"
                    }`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">%</span>
                </div>
                {rateError ? (
                  <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                    <AlertTriangle size={11} /> {rateError}
                  </p>
                ) : (
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    Standard UK rate is 20%. Reduced rate is 5%. Zero-rated = 0%.
                  </p>
                )}
              </div>
            </div>

            {/* Tax mode */}
            <div className={draft.enabled ? "" : "opacity-40 pointer-events-none"}>
              <SectionLabel>Tax Mode</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Inclusive */}
                <button
                  onClick={() => patch({ inclusive: true })}
                  className={`text-left px-4 py-4 rounded-2xl border-2 transition ${
                    draft.inclusive
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      draft.inclusive ? "border-blue-500" : "border-gray-300"
                    }`}>
                      {draft.inclusive && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                    </div>
                    <span className={`text-sm font-bold ${draft.inclusive ? "text-blue-700" : "text-gray-700"}`}>
                      Inclusive (inc. VAT)
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed pl-6">
                    Prices <strong>already include</strong> VAT. The VAT amount is extracted and shown for transparency. Order totals stay the same.
                  </p>
                </button>

                {/* Exclusive */}
                <button
                  onClick={() => patch({ inclusive: false })}
                  className={`text-left px-4 py-4 rounded-2xl border-2 transition ${
                    !draft.inclusive
                      ? "border-orange-500 bg-orange-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      !draft.inclusive ? "border-orange-500" : "border-gray-300"
                    }`}>
                      {!draft.inclusive && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                    </div>
                    <span className={`text-sm font-bold ${!draft.inclusive ? "text-orange-700" : "text-gray-700"}`}>
                      Exclusive (ex. VAT)
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed pl-6">
                    Prices are <strong>ex-VAT</strong>. VAT is calculated and <strong>added on top</strong> at checkout. Order totals increase.
                  </p>
                </button>
              </div>
            </div>

            {/* Show breakdown toggle */}
            <div className={draft.enabled ? "" : "opacity-40 pointer-events-none"}>
              <SectionLabel>Display Options</SectionLabel>
              <div className="flex items-center justify-between gap-4 py-3 border-b border-gray-100">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Show VAT breakdown</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Display the VAT line in cart, checkout, printed receipts, and order emails
                  </p>
                </div>
                <Toggle
                  size="sm"
                  enabled={draft.showBreakdown}
                  onToggle={() => patch({ showBreakdown: !draft.showBreakdown })}
                />
              </div>
            </div>

            {/* Save */}
            <button
              onClick={handleSave}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                saved
                  ? "bg-green-100 text-green-700"
                  : "bg-orange-500 hover:bg-orange-600 text-white"
              }`}
            >
              {saved ? <><CheckCircle size={15} /> Saved!</> : "Save tax settings"}
            </button>
          </div>

          {/* ── Preview ──────────────────────────────────────────────────────── */}
          <div className="border-t lg:border-t-0 lg:border-l border-gray-100 p-6 bg-gray-50/70">
            <SectionLabel>Order Preview</SectionLabel>
            <TaxPreview draft={draft} />
          </div>
        </div>
      </div>

      {/* Where VAT applies callout */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700 space-y-2">
          <p className="font-semibold">Where VAT is applied</p>
          <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
            <li className="flex items-center gap-1.5">
              <ShoppingCart size={11} className="flex-shrink-0" />
              Cart sidebar — VAT line shown in the totals block
            </li>
            <li className="flex items-center gap-1.5">
              <Receipt size={11} className="flex-shrink-0" />
              Checkout modal — VAT displayed in the order summary
            </li>
            <li className="flex items-center gap-1.5">
              <Tag size={11} className="flex-shrink-0" />
              Thermal receipts — VAT line printed after totals
            </li>
            <li className="flex items-center gap-1.5">
              <Receipt size={11} className="flex-shrink-0" />
              Order emails — VAT included as a template variable{" "}
              <code className="bg-blue-100 px-1 rounded text-[10px]">{"{{order_vat}}"}</code>
            </li>
          </ul>
          <p className="text-xs text-blue-500 mt-1">
            VAT is calculated on the <strong>item subtotal only</strong>. Delivery and service fees are treated as non-VATable.
          </p>
        </div>
      </div>

      {/* Warning when exclusive mode is on */}
      {draft.enabled && !draft.inclusive && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Exclusive VAT mode active</p>
            <p className="text-xs text-amber-700 mt-1">
              Your menu prices are treated as ex-VAT. {draft.rate}% VAT will be <strong>added on top</strong> at checkout,
              increasing the final order total. Ensure your menu prices reflect this correctly.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
