"use client";

import { useState, useRef } from "react";
import { usePOS } from "@/context/POSContext";
import { useApp } from "@/context/AppContext";
import { useConnectivity } from "@/lib/connectivity";
import { POSSettings } from "@/types/pos";
import { Check, Mail, Receipt, Save, ToggleLeft, ToggleRight } from "lucide-react";
import POSPrinterPanel from "./POSPrinterPanel";
import MenuTab from "./settings/MenuTab";
import { isCapacitorAndroid } from "@/lib/capacitorBridge";

type SaveKey = "general" | "receipt" | "smtp";

// ─── Small shared helpers ─────────────────────────────────────────────────────

function Toggle({
  enabled, onToggle, size = "sm", disabled = false
}: { enabled: boolean; onToggle: () => void; size?: "sm" | "md"; disabled?: boolean }) {
  const track = size === "sm" ? "w-6.5 h-4.5" : "w-9 h-5";
  const thumb = size === "sm"
    ? `w-2.5 h-2.5 ${enabled ? "translate-x-2.5" : "translate-x-0.5"}`
    : `w-4 h-4 ${enabled ? "translate-x-6" : "translate-x-1"}`;
  return (
    <button
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      className={`relative flex-shrink-0 inline-flex items-center ${track} rounded-full transition-colors focus:outline-none border-3 ${enabled ? "border-green-500" : "border-slate-500"} ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span className={`inline-block border-3 ${enabled ?  'border-green-400' : 'border-slate-500'} rounded-full shadow-sm transition-transform ${thumb}`} />
    </button>
  );
}

export default function SettingsView() {
  const { settings, setSettings, sales, exportSales } = usePOS();
  const { settings: appSettings, updateSettingsViaPos } = useApp();
  const { isOnline } = useConnectivity();
  const [local, setLocal] = useState({ ...settings });
  const [tab, setTab] = useState<"general" | "menu" | "receipt" | "hardware">("general");
  // Persistence is synchronous (localStorage), so we flash a brief "Saved"
  // confirmation rather than a fake spinner — addresses QA #33 (no feedback).
  const [savedKey, setSavedKey] = useState<SaveKey | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashSaved(key: SaveKey) {
    setSavedKey(key);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedKey(null), 1800);
  }

  function saveSettings(key: SaveKey = "general") {
    // Read-only offline: settings push to the server (/api/pos/settings), which
    // is unreachable offline. The buttons are disabled too; this guards programmatic calls.
    if (!isOnline) return;
    // Create a copy of the local state so we can safely modify it before saving
    const nextLocal = { ...local };

    // If saving the general tab, also push the shared settings back to the global DB
    if (key === "general") {

      updateSettingsViaPos({
        // Update Tax settings in the global config to match
        taxSettings: {
          ...(appSettings.taxSettings || {}),
          rate: local.taxRate,
          inclusive: local.taxInclusive,
          showBreakdown: local.showBreakdown, 
        }
      });
    }

    setSettings(nextLocal);
    setLocal(nextLocal);
    flashSaved(key);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h2 className="text-white font-bold text-xl">POS Settings</h2>

        {!isOnline && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
            <p className="text-amber-300 text-xs">Read-only while offline — settings save to the server. Reconnect to change tax, receipt, or hardware settings.</p>
          </div>
        )}

        {/* Sub-tabs */}
        <div className="flex gap-1.5 bg-slate-800/50 p-1 rounded-xl border border-slate-700">
          {(["general", "menu", "receipt", "hardware"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 px-1.5 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${tab === t ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}>
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
              {/* Currency is set centrally in Admin → Operations → Currency. */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Currency</label>
                <div className="flex items-center gap-3 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5">
                  <span className="text-white font-mono text-base">{appSettings.currency?.symbol ?? local.currencySymbol}</span>
                  <span className="text-slate-500 text-xs">Managed in Admin → Operations → Currency</span>
                </div>
              </div>
              {[
                { key: "location", label: "Location / Branch", type: "text" },
                { key: "receiptFooter", label: "Receipt Footer", type: "textarea" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                  {f.type === "textarea" ? (
                    <textarea rows={3} value={(local as Record<string, unknown>)[f.key] as string}
                      onChange={(e) => setLocal((p) => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 resize-none" />
                  ) : (
                    <input type={f.type} value={(local as Record<string, unknown>)[f.key] as string}
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
                  <input
                    type="number"
                    step="0.5"
                    value={local.taxRate}
                    placeholder="e.g. 20 for 20%"
                    onChange={(e) => setLocal((p) => ({ ...p, taxRate: e.target.value === "" ? ("" as unknown as number) : parseFloat(e.target.value) }))}
                    onBlur={() => {
                      if (String(local.taxRate) === "" || isNaN(Number(local.taxRate))) {
                        setLocal((p) => ({ ...p, taxRate: 0 }));
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Max Discount (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={local.maxDiscountPercent}
                    placeholder="e.g. 50 for 50%"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "") {
                        setLocal((p) => ({ ...p, maxDiscountPercent: "" as unknown as number }));
                      } else {
                        const raw = parseInt(val) || 0;
                        setLocal((p) => ({ ...p, maxDiscountPercent: Math.max(0, Math.min(100, raw)) }));
                      }
                    }}
                    onBlur={() => {
                      if (String(local.maxDiscountPercent) === "" || isNaN(Number(local.maxDiscountPercent))) {
                        setLocal((p) => ({ ...p, maxDiscountPercent: 0 }));
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500" />
                </div>
              </div>

              {/* Tax Mode */}
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-3">Tax Mode</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Inclusive VAT */}
                  <button
                    onClick={() => setLocal((p) => ({ ...p, taxInclusive: true }))}
                    className={`text-left p-4 rounded-2xl border-2 transition-all ${local.taxInclusive
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-slate-600 bg-slate-900 hover:border-slate-500"
                      }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${local.taxInclusive ? "border-blue-400" : "border-slate-500"
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
                    onClick={() => setLocal((p) => ({ ...p, taxInclusive: false, showBreakdown: true }))}
                    className={`text-left p-4 rounded-2xl border-2 transition-all ${!local.taxInclusive
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-slate-600 bg-slate-900 hover:border-slate-500"
                      }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${!local.taxInclusive ? "border-orange-400" : "border-slate-500"
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
                <div className={`mt-3 text-center text-xs font-semibold px-2 py-2 rounded-xl ${local.taxInclusive
                  ? "bg-blue-900/30 text-blue-300"
                  : "bg-orange-900/30 text-orange-300"
                  }`}>
                  {local.taxInclusive
                    ? `Inclusive VAT — ${local.taxRate}% extracted from price at checkout`
                    : `Exclusive VAT — ${local.taxRate}% added on top at checkout`}
                </div>
              </div>

              {/* Show breakdown toggle */}
              <div className="pt-2 border-t border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-3">Display Options</p>
                <div className="flex items-center justify-between gap-4 py-1">
                  <div>
                    <p className="text-sm font-semibold text-white">Show VAT breakdown</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {!local.taxInclusive
                        ? "Breakdown must be visible when using exclusive tax to ensure transparency for your customers."
                        : "Display the VAT line in cart, checkout, printed receipts, and order emails."}
                    </p>
                  </div>
                  <Toggle
                    size="sm"
                    enabled={local.showBreakdown}
                    disabled={!local.taxInclusive} // Locks the toggle if Exclusive is selected
                    onToggle={() => {
                      if (local.taxInclusive) {
                        setLocal((p) => ({ ...p, showBreakdown: !p.showBreakdown }));
                      }
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">Require PIN for Discounts</p>
                  <p className="text-slate-400 text-xs">Managers must confirm discounts</p>
                </div>
                <button onClick={() => setLocal((p) => ({ ...p, requirePinForDiscount: !p.requirePinForDiscount }))} className="transition-colors flex-shrink-0">
                  {local.requirePinForDiscount ? <ToggleRight size={28} className="text-green-400" /> : <ToggleLeft size={28} className="text-slate-500" />}
                </button>
              </div>
            </div>

            {/* Loyalty Program moved to Admin → Operations. Earning happens
                server-side on every sale; the reward catalog is admin-managed. */}

            <button
              onClick={() => saveSettings("general")}
              disabled={savedKey === "general" || !isOnline}
              className={`w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all flex items-center justify-center gap-2 ${savedKey === "general"
                ? "bg-green-600"
                : "bg-orange-500 hover:bg-orange-400"
                }`}
            >
              {savedKey === "general" ? (
                <><Check size={16} /> Saved</>
              ) : (
                <><Save size={16} /> Save Settings</>
              )}
            </button>
          </div>
        )}

        {tab === "menu" && (
          isOnline
            ? <MenuTab />
            : <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 text-center">
                <p className="text-amber-300 text-sm font-semibold">Menu editing needs internet</p>
                <p className="text-slate-400 text-xs mt-1">You can still ring up sales from the cached menu on the Sale tab. Reconnect to add or edit menu items.</p>
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
                <button onClick={() => setLocal((p) => ({ ...p, receiptShowLogo: !p.receiptShowLogo }))} className="transition-colors flex-shrink-0">
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
                      className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                    />
                    {local.receiptLogoUrl && (
                      <div className="w-10 h-10 border border-slate-600 rounded-xl overflow-hidden flex-shrink-0 bg-slate-900">
                        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary URL or data: URI, needs onError fallback */}
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
                  { key: "receiptPhone", label: "Phone Number", type: "tel", placeholder: "e.g. 020 7123 4567" },
                  { key: "receiptWebsite", label: "Website", type: "text", placeholder: "e.g. www.restaurant.co.uk" },
                  { key: "receiptEmail", label: "Email", type: "email", placeholder: "e.g. hello@restaurant.co.uk" },
                  { key: "receiptVatNumber", label: "VAT Number", type: "text", placeholder: "e.g. GB 123 4567 89", hint: "Leave blank if not VAT registered" },
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
                { key: "receiptCustomMessage", label: "Custom Message", placeholder: "e.g. Follow us on Instagram · Use code THANKS10 for 10% off", hint: "Optional second line — great for promotions or social handles" },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                  <textarea
                    rows={3}
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
                const W = 31;
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
                const eq = "═".repeat(W);
                const dash = "─".repeat(W);
                type Line = { text: string; bold?: boolean; large?: boolean; dim?: boolean };
                const lines: Line[] = [];

                const name = (local.receiptRestaurantName || appSettings.restaurant?.name || "Restaurant Name").toUpperCase();
                lines.push({ text: center(name), bold: true, large: true });
                if (local.receiptPhone) lines.push({ text: center(local.receiptPhone) });
                if (local.receiptWebsite) lines.push({ text: center(local.receiptWebsite) });
                if (local.receiptEmail) lines.push({ text: center(local.receiptEmail) });
                if (local.receiptVatNumber) lines.push({ text: center(`VAT: ${local.receiptVatNumber}`), dim: true });
                lines.push({ text: eq });
                lines.push({ text: "ORDER  ORD-A1B2C3D4", bold: true });
                lines.push({ text: "Date:  16 Apr 2026, 12:34" });
                lines.push({ text: "Type:  DINE IN · Table 4" });
                lines.push({ text: "Pay:   Card" });
                lines.push({ text: eq });
                lines.push({ text: twoCol("ITEM", "PRICE"), bold: true });
                lines.push({ text: dash });
                const previewSym = appSettings.currency?.symbol ?? local.currencySymbol;
                lines.push({ text: twoCol("Chicken Tikka x2", `${previewSym}11.98`) });
                lines.push({ text: twoCol("Garlic Naan x1", `${previewSym}2.99`) });
                lines.push({ text: dash });
                lines.push({ text: twoCol("Subtotal", `${previewSym}14.97`) });
                if (local.taxRate > 0) {
                  const vatAmt = local.taxInclusive
                    ? (14.97 * local.taxRate / (100 + local.taxRate)).toFixed(2)
                    : (14.97 * local.taxRate / 100).toFixed(2);
                  lines.push({ text: twoCol(local.taxInclusive ? `VAT incl. (${local.taxRate}%)` : `VAT (${local.taxRate}%)`, local.taxInclusive ? `${previewSym}${vatAmt}` : `+${previewSym}${vatAmt}`), dim: true });
                }
                lines.push({ text: eq });
                lines.push({ text: twoCol("TOTAL", `${previewSym}14.97`), bold: true });
                lines.push({ text: eq });
                lines.push({ text: "" });
                const ty = local.receiptThankYouMessage || "Thank you for your order!";
                lines.push({ text: center(ty), bold: true });
                if (local.receiptCustomMessage) lines.push({ text: center(local.receiptCustomMessage), dim: true });
                lines.push({ text: "" });

                return (
                  <div className="bg-white rounded-xl overflow-hidden shadow-inner max-w-[280px] mx-auto">
                    {/* Sprocket strip top */}
                    <div className="flex justify-between px-3 py-1.5 bg-gray-50 border-b border-dashed border-gray-200">
                      {Array.from({ length: 15 }).map((_, i) => <div key={i} className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />)}
                    </div>
                    <div className="px-4 py-4 w-full text-center">
                      {local.receiptShowLogo && local.receiptLogoUrl && (
                        <div className="flex justify-center mb-3">
                          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary URL or data: URI, needs onError fallback */}
                          <img src={local.receiptLogoUrl} alt="Logo" className="h-10 w-auto object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </div>
                      )}
                      {/* Monospace block: rendered left-aligned (the text is already
                          space-padded to a fixed 31-char width) and centred as a
                          whole via the parent's text-center. No magic offsets \u2014 those
                          shifted + clipped the block in the Android WebView. */}
                      <div className="font-mono text-[11px] leading-[1.45] inline-block text-left align-top">
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
                    <div className="flex justify-between px-3 py-1.5 bg-gray-50 border-t border-dashed border-gray-200">
                      {Array.from({ length: 15 }).map((_, i) => <div key={i} className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />)}
                    </div>
                  </div>
                );
              })()}
              <p className="text-[11px] text-slate-500 text-center mt-2">Live preview · reflects unsaved draft</p>
            </div>

            <button
              onClick={() => saveSettings("receipt")}
              disabled={savedKey === "receipt" || !isOnline}
              className={`w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all flex items-center justify-center gap-2 ${savedKey === "receipt"
                ? "bg-green-600"
                : "bg-orange-500 hover:bg-orange-400"
                }`}
            >
              {savedKey === "receipt" ? (
                <><Check size={16} /> Saved</>
              ) : (
                <><Save size={16} /> Save Receipt Settings</>
              )}
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
                onClick={() => { setSettings({ ...settings, ...local }); flashSaved("smtp"); }}
                disabled={savedKey === "smtp"}
                className={`w-full py-2.5 rounded-xl text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${savedKey === "smtp"
                  ? "bg-green-600"
                  : "bg-orange-500 hover:bg-orange-400"
                  }`}
              >
                {savedKey === "smtp" ? (
                  <><Check size={14} /> Saved</>
                ) : (
                  <><Save size={14} /> Save</>
                )}
              </button>
            </div>

            {/* Sales archive */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
              <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                <Receipt size={16} className="text-slate-400" /> Sales archive
              </h3>
              <div className="bg-slate-900 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between text-slate-300">
                  <span>Sales loaded from server</span>
                  <span className="font-mono font-semibold">{sales.length}</span>
                </div>
              </div>
              <p className="text-slate-500 text-xs">
                Sales are stored in the pos_sales database table — all tills aggregate to the
                same record set.{!isCapacitorAndroid() && " Use the export below for an offline JSON copy."}
              </p>
              {/* JSON export relies on a browser file download, which the Android
                  WebView can't trigger — so it's web-only. Sales already live in
                  the shared DB, so nothing is lost on the tablet. */}
              {!isCapacitorAndroid() && (
                <button
                  onClick={exportSales}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <Receipt size={14} className="flex-shrink-0" /> Export loaded sales as JSON
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
