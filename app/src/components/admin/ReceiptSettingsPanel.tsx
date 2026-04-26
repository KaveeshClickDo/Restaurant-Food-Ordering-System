"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { ReceiptSettings } from "@/types";
import {
  Receipt, CheckCircle, Eye, EyeOff, ToggleLeft, ToggleRight,
} from "lucide-react";

// ─── Shared field component ───────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = "text", hint, span2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : ""}>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
      />
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

// ─── Textarea field ───────────────────────────────────────────────────────────

function TextareaField({
  label, value, onChange, placeholder, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition resize-none"
      />
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`transition-colors flex-shrink-0 ${enabled ? "text-orange-500" : "text-gray-300 hover:text-gray-400"}`}
      role="switch"
      aria-checked={enabled}
    >
      {enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
    </button>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">{children}</p>
  );
}

// ─── Receipt preview ──────────────────────────────────────────────────────────

function ReceiptPreview({ r, restaurantName }: { r: ReceiptSettings; restaurantName?: string }) {
  const W = 42;

  function center(str: string) {
    const str_ = str.slice(0, W);
    const pad = Math.max(0, Math.floor((W - str_.length) / 2));
    return " ".repeat(pad) + str_;
  }

  function twoCol(left: string, right: string) {
    const leftW = W - right.length;
    const l = left.length > leftW - 1 ? left.slice(0, leftW - 2) + "~" : left.padEnd(leftW);
    return l + right;
  }

  const eq = "═".repeat(W);
  const dash = "─".repeat(W);

  type Line = { text: string; bold?: boolean; large?: boolean; dim?: boolean };
  const lines: Line[] = [];

  // ── Top section ──
  const name = (r.restaurantName || restaurantName || "Restaurant Name").toUpperCase();
  lines.push({ text: center(name), bold: true, large: true });
  if (r.phone)     lines.push({ text: center(r.phone) });
  if (r.website)   lines.push({ text: center(r.website) });
  if (r.email)     lines.push({ text: center(r.email) });
  if (r.vatNumber) lines.push({ text: center(`VAT: ${r.vatNumber}`), dim: true });
  lines.push({ text: eq });

  // ── Order block ──
  lines.push({ text: "ORDER  ORD-A1B2C3D4", bold: true });
  lines.push({ text: "Date:  13 Apr 2026, 12:34" });
  lines.push({ text: "Type:  DELIVERY" });
  lines.push({ text: "Pay:   Cash on Delivery" });
  lines.push({ text: eq });

  // ── Items ──
  lines.push({ text: twoCol("ITEM", "PRICE"), bold: true });
  lines.push({ text: dash });
  lines.push({ text: twoCol("Chicken Tikka x2", "£11.98") });
  lines.push({ text: twoCol("Garlic Naan x1", "£2.99") });
  lines.push({ text: dash });

  // ── Totals ──
  lines.push({ text: twoCol("Subtotal", "£14.97") });
  lines.push({ text: twoCol("Delivery fee", "£2.99") });
  lines.push({ text: eq });
  lines.push({ text: twoCol("TOTAL", "£17.96"), bold: true });
  lines.push({ text: eq });

  // ── Bottom section ──
  lines.push({ text: "" });
  const ty = r.thankYouMessage || "Thank you for your order!";
  lines.push({ text: center(ty), bold: true });
  if (r.customMessage) lines.push({ text: center(r.customMessage), dim: true });
  lines.push({ text: "" });

  return (
    <div className="bg-gray-800 rounded-2xl p-4">
      {/* Simulated printer paper */}
      <div className="bg-white rounded-xl overflow-hidden shadow-inner">
        {/* Sprocket holes strip */}
        <div className="flex gap-1.5 px-3 py-1.5 bg-gray-50 border-b border-dashed border-gray-200">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
          ))}
        </div>

        <div className="px-4 py-4">
          {/* Logo */}
          {r.showLogo && r.logoUrl && (
            <div className="flex justify-center mb-3">
              <img
                src={r.logoUrl}
                alt="Receipt logo"
                className="h-10 w-auto object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
          {/* Receipt lines */}
          <div className="font-mono text-[11px] leading-[1.45] overflow-x-auto">
            {lines.map((line, i) => (
              <div
                key={i}
                className={[
                  "whitespace-pre",
                  line.bold ? "font-bold" : "font-normal",
                  line.large ? "text-[13px]" : "",
                  line.dim ? "text-gray-400" : "text-gray-800",
                ].filter(Boolean).join(" ")}
              >
                {line.text || "\u00A0"}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom tear strip */}
        <div className="flex gap-1.5 px-3 py-1.5 bg-gray-50 border-t border-dashed border-gray-200">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
          ))}
        </div>
      </div>

      <p className="text-[10px] text-gray-500 text-center mt-2">
        Live preview · reflects unsaved draft
      </p>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ReceiptSettingsPanel() {
  const { settings, updateSettings } = useApp();
  const [draft, setDraft] = useState<ReceiptSettings>({ ...settings.receiptSettings });
  const liveRestaurantName = settings.restaurant?.name || "";
  const [saved, setSaved]             = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  function patch(p: Partial<ReceiptSettings>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function handleSave() {
    updateSettings({ receiptSettings: { ...draft } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="space-y-5">
      {/* Panel header card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Receipt size={18} className="text-orange-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Receipt Settings</h2>
              <p className="text-xs text-gray-400">
                Customise the header and footer on all printed and emailed receipts
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowPreview((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition flex-shrink-0 ${
              showPreview
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>

        {/* Two-column layout: form + preview */}
        <div className={`grid ${showPreview ? "lg:grid-cols-2" : "grid-cols-1"}`}>

          {/* ── Form ────────────────────────────────────────────────────────── */}
          <div className="p-6 space-y-7">

            {/* Logo */}
            <div>
              <SectionHeading>Logo</SectionHeading>
              <div className="flex items-start justify-between gap-3 mb-4 pb-4 border-b border-gray-100">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Show logo on receipt</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Displayed at the top of printed and emailed receipts
                  </p>
                </div>
                <Toggle enabled={draft.showLogo} onToggle={() => patch({ showLogo: !draft.showLogo })} />
              </div>

              {draft.showLogo && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Logo URL</label>
                    <div className="flex gap-2 items-start">
                      <input
                        type="url"
                        value={draft.logoUrl}
                        onChange={(e) => patch({ logoUrl: e.target.value })}
                        placeholder="https://example.com/logo.png or data:image/png;base64,…"
                        className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                      />
                      {draft.logoUrl && (
                        <div className="w-10 h-10 border border-gray-200 rounded-xl overflow-hidden flex-shrink-0 bg-gray-50">
                          <img
                            src={draft.logoUrl}
                            alt="Logo preview"
                            className="w-full h-full object-contain p-1"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.opacity = "0";
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Hosted URL or base64 data URI. Square PNG with transparent background recommended.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Top section */}
            <div>
              <SectionHeading>Top Section</SectionHeading>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Restaurant Name"
                  value={draft.restaurantName}
                  onChange={(v) => patch({ restaurantName: v })}
                  placeholder={liveRestaurantName || "Restaurant Name"}
                  hint="Leave blank to use your branding name automatically"
                />
                <Field
                  label="Phone Number"
                  value={draft.phone}
                  onChange={(v) => patch({ phone: v })}
                  placeholder="e.g. 020 7123 4567"
                  type="tel"
                />
                <Field
                  label="Website"
                  value={draft.website}
                  onChange={(v) => patch({ website: v })}
                  placeholder="e.g. www.restaurant.co.uk"
                />
                <Field
                  label="Email"
                  value={draft.email}
                  onChange={(v) => patch({ email: v })}
                  placeholder="e.g. hello@restaurant.co.uk"
                  type="email"
                />
                <Field
                  label="VAT Number"
                  value={draft.vatNumber}
                  onChange={(v) => patch({ vatNumber: v })}
                  placeholder="e.g. GB 123 4567 89"
                  hint="Leave blank if not VAT registered"
                  span2
                />
              </div>
            </div>

            {/* Bottom section */}
            <div>
              <SectionHeading>Bottom Section</SectionHeading>
              <div className="space-y-4">
                <TextareaField
                  label="Thank You Message"
                  value={draft.thankYouMessage}
                  onChange={(v) => patch({ thankYouMessage: v })}
                  placeholder="Thank you for your order!"
                  hint="Appears at the bottom of every receipt"
                />
                <TextareaField
                  label="Custom Message"
                  value={draft.customMessage}
                  onChange={(v) => patch({ customMessage: v })}
                  placeholder="e.g. Follow us on Instagram · 10% off your next order with code THANKS10"
                  hint="Optional second line — great for promotions or social media handles"
                />
              </div>
            </div>

            {/* Save button */}
            <button
              onClick={handleSave}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                saved
                  ? "bg-green-100 text-green-700"
                  : "bg-orange-500 hover:bg-orange-600 text-white"
              }`}
            >
              {saved ? (
                <><CheckCircle size={15} /> Saved!</>
              ) : (
                "Save receipt settings"
              )}
            </button>
          </div>

          {/* ── Preview pane ─────────────────────────────────────────────────── */}
          {showPreview && (
            <div className="border-t lg:border-t-0 lg:border-l border-gray-100 p-6 bg-gray-50/70">
              <SectionHeading>Receipt Preview</SectionHeading>
              <ReceiptPreview r={draft} restaurantName={liveRestaurantName} />
            </div>
          )}
        </div>
      </div>

      {/* Info callout */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 flex items-start gap-3">
        <Receipt size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700 space-y-1">
          <p className="font-semibold">Where these settings apply</p>
          <ul className="text-xs text-blue-600 space-y-0.5 list-disc list-inside">
            <li>Thermal / ESC·POS printed receipts (header name, phone, website, email, VAT — and footer messages)</li>
            <li>Order confirmation and status emails (header branding and footer contact block)</li>
            <li>Logo appears on emailed receipts when a valid URL is provided and logo is enabled</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
