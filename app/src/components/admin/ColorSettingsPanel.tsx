"use client";

import { useState, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import type { ColorSettings } from "@/types";
import { generateShades, hslToHex, hexToHsl } from "@/lib/colorUtils";
import { Palette, RotateCcw, Check, ShoppingBag, Star, Flame } from "lucide-react";

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS: ColorSettings = {
  primaryColor:    "#f97316",
  backgroundColor: "#f9fafb",
};

// ─── Preset themes ────────────────────────────────────────────────────────────

const PRESETS: { name: string; primary: string; bg: string }[] = [
  { name: "Orange",  primary: "#f97316", bg: "#f9fafb" },
  { name: "Red",     primary: "#ef4444", bg: "#fafafa" },
  { name: "Rose",    primary: "#f43f5e", bg: "#fafafa" },
  { name: "Violet",  primary: "#8b5cf6", bg: "#fafafa" },
  { name: "Blue",    primary: "#3b82f6", bg: "#f8fafc" },
  { name: "Teal",    primary: "#14b8a6", bg: "#f0fdfa" },
  { name: "Emerald", primary: "#10b981", bg: "#f0fdf4" },
  { name: "Slate",   primary: "#475569", bg: "#f8fafc" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Lighten a hex color by `amount` lightness points (0-100). */
function lighten(hex: string, amount: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, Math.min(l + amount, 98));
}

/** Return true if the hex represents a "light" color (use dark text on it). */
function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}

// ─── ColorInput ───────────────────────────────────────────────────────────────

interface ColorInputProps {
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
}

function ColorInput({ label, hint, value, onChange }: ColorInputProps) {
  const [text, setText] = useState(value);

  // Keep text in sync when value changes externally (preset click)
  if (text !== value && /^#[0-9a-fA-F]{6}$/.test(value)) {
    setText(value);
  }

  function commitText(raw: string) {
    const v = raw.startsWith("#") ? raw : `#${raw}`;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
    setText(v);
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        {/* Native colour wheel */}
        <label className="relative cursor-pointer flex-shrink-0">
          <div
            className="w-11 h-11 rounded-xl border-2 border-gray-200 shadow-sm overflow-hidden"
            style={{ backgroundColor: value }}
          />
          <input
            type="color"
            value={value}
            onChange={(e) => { onChange(e.target.value); setText(e.target.value); }}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </label>

        {/* Hex text input */}
        <input
          type="text"
          value={text}
          maxLength={7}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commitText(text)}
          placeholder="#000000"
          className="w-28 px-3 py-2 text-sm font-mono border border-gray-200 rounded-xl
                     focus:outline-none focus:ring-2 focus:ring-orange-300 uppercase"
        />

        {/* Shade strip preview */}
        <div className="flex gap-0.5 flex-1 min-w-0 overflow-hidden rounded-lg">
          {Object.values(generateShades(value) ?? {}).map((shade, i) => (
            <div key={i} className="flex-1 h-8" style={{ backgroundColor: shade }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── LivePreview ──────────────────────────────────────────────────────────────

function LivePreview({ draft, name }: { draft: ColorSettings; name: string }) {
  const shades = generateShades(draft.primaryColor) ?? {};
  const p500 = shades["500"] ?? draft.primaryColor;
  const p600 = shades["600"] ?? draft.primaryColor;
  const p50  = shades["50"]  ?? "#fff7ed";
  const p100 = shades["100"] ?? "#ffedd5";
  const p200 = shades["200"] ?? "#fed7aa";
  const p700 = shades["700"] ?? "#c2410c";
  const btnText = isLight(p500) ? "#1a1a1a" : "#ffffff";

  return (
    <div className="rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
      {/* Simulated header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between"
           style={{ backgroundColor: "#ffffff" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
               style={{ backgroundColor: p500 }}>
            <span className="text-xs font-bold" style={{ color: btnText }}>{name.charAt(0)}</span>
          </div>
          <span className="text-sm font-bold text-gray-900">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: p50, color: p700 }}>
            Store open
          </span>
        </div>
      </div>

      {/* Simulated content */}
      <div className="p-4" style={{ backgroundColor: draft.backgroundColor }}>
        {/* Active tab indicator */}
        <div className="flex gap-3 mb-4">
          {["Starters", "Mains", "Desserts"].map((t, i) => (
            <div key={t} className="text-xs font-semibold pb-1.5"
                 style={i === 0
                   ? { borderBottom: `2px solid ${p500}`, color: p600 }
                   : { borderBottom: "2px solid transparent", color: "#6b7280" }}>
              {t}
            </div>
          ))}
        </div>

        {/* Sample item card */}
        <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">Chicken Tikka Masala</p>
              <span className="flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full border"
                    style={{ color: p600, backgroundColor: p50, borderColor: p200 }}>
                <Flame size={9} />
                Popular
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
              Tender chicken in a rich, creamy tomato sauce
            </p>
            <p className="text-sm font-bold text-gray-900 mt-1.5">£12.95</p>
          </div>
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-xl">
              🍛
            </div>
            <button className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-bold"
                    style={{ borderColor: p500, color: p500 }}>
              +
            </button>
          </div>
        </div>

        {/* Sample buttons row */}
        <div className="flex items-center gap-2 mt-3">
          <button className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl"
                  style={{ backgroundColor: p500, color: btnText }}>
            <ShoppingBag size={12} />
            Go to checkout
          </button>
          <button className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border"
                  style={{ borderColor: p200, color: p700, backgroundColor: p50 }}>
            <Star size={11} />
            5 Hygiene
          </button>
          <span className="text-xs font-medium px-2.5 py-1.5 rounded-full"
                style={{ backgroundColor: p100, color: p700 }}>
            Delivery
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ColorSettingsPanel() {
  const { settings, updateSettings } = useApp();
  const [draft, setDraft] = useState<ColorSettings>(settings.colors ?? DEFAULTS);
  const [saved, setSaved] = useState(false);

  const update = useCallback((patch: Partial<ColorSettings>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  function applyColors() {
    updateSettings({ colors: draft });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function resetColors() {
    setDraft(DEFAULTS);
    updateSettings({ colors: DEFAULTS });
  }

  const isDefault =
    draft.primaryColor    === DEFAULTS.primaryColor &&
    draft.backgroundColor === DEFAULTS.backgroundColor;

  return (
    <div className="space-y-6">

      {/* ── Preset themes ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Palette size={18} className="text-orange-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Quick Themes</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              One-click colour themes — applied to the entire site
            </p>
          </div>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {PRESETS.map((preset) => {
            const active =
              draft.primaryColor    === preset.primary &&
              draft.backgroundColor === preset.bg;
            return (
              <button
                key={preset.name}
                onClick={() => setDraft({ primaryColor: preset.primary, backgroundColor: preset.bg })}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all ${
                  active
                    ? "border-gray-900 shadow-md scale-105"
                    : "border-transparent hover:border-gray-200"
                }`}
              >
                <div
                  className="w-10 h-10 rounded-full shadow-sm border border-white/40 ring-1 ring-black/5"
                  style={{ backgroundColor: preset.primary }}
                />
                <span className="text-[10px] font-medium text-gray-600 leading-none">
                  {preset.name}
                </span>
                {active && (
                  <Check size={10} className="text-gray-900 -mt-0.5" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Custom colour pickers ──────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6">
        <div>
          <h3 className="font-semibold text-gray-900">Custom Colours</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Fine-tune individual colours — the shade palette is generated automatically from your primary pick
          </p>
        </div>

        <ColorInput
          label="Primary / Brand Colour"
          hint="Controls buttons, active states, badges, links, and all accent elements across both the customer menu and admin panel"
          value={draft.primaryColor}
          onChange={(hex) => update({ primaryColor: hex })}
        />

        <ColorInput
          label="Page Background"
          hint="Background colour of the customer menu page and admin dashboard — defaults to a very light grey"
          value={draft.backgroundColor}
          onChange={(hex) => update({ backgroundColor: hex })}
        />
      </div>

      {/* ── Live preview ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-gray-900">Live Preview</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Reflects your current selections — changes apply to the whole site once you click Apply
          </p>
        </div>
        <LivePreview draft={draft} name={settings.restaurant.name} />
      </div>

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center justify-between gap-4 flex-wrap">
        <button
          onClick={resetColors}
          disabled={isDefault}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw size={14} />
          Reset to defaults
        </button>

        <button
          onClick={applyColors}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            saved
              ? "bg-green-100 text-green-700"
              : "bg-orange-500 hover:bg-orange-600 text-white"
          }`}
        >
          {saved ? <><Check size={14} /> Applied!</> : "Apply to website"}
        </button>
      </div>

    </div>
  );
}
