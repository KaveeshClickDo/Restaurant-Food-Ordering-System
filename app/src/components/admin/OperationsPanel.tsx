"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useApp } from "@/context/AppContext";
import { RestaurantInfo } from "@/types";
import { restaurantInfo as seedInfo } from "@/data/restaurant";
import { CURRENCY_PRESETS, DEFAULT_CURRENCY } from "@/lib/currency";
import { Store, Clock, Coins, MapPin, CheckCircle2, AlertCircle, Palette, Upload, X, Image as ImageIcon, Search, Code2, Info, Navigation, Star, Eye, EyeOff, Bike, ShoppingBag } from "lucide-react";

const LocationMap = dynamic(() => import("@/components/maps/LocationMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] w-full bg-gray-50 rounded-xl flex items-center justify-center text-xs text-gray-400 border border-gray-100">
      Loading map…
    </div>
  ),
});

// Country-aware postcode/ZIP validation
function validatePostcode(code: string, country: string): boolean {
  const c = code.trim();
  if (!c) return false;
  const re: Record<string, RegExp> = {
    "United Kingdom": /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
    "United States": /^\d{5}(-\d{4})?$/,
    "Canada": /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i,
    "Australia": /^\d{4}$/,
    "Ireland": /^(?:[A-Z]{1,2}\d{1,2}\s?[A-Z]{1,2}\d|D\d{1,2})$/i,
    "Germany": /^\d{5}$/,
    "France": /^\d{5}$/,
    "Netherlands": /^\d{4}\s?[A-Z]{2}$/i,
    "India": /^\d{6}$/,
    "Sri Lanka": /^\d{5}$/,
  };
  const r = re[country];
  if (r) return r.test(c);
  // Unknown country: accept any 3-12 char alphanumeric-with-space code
  return /^[A-Za-z0-9\s-]{3,12}$/.test(c);
}

export default function OperationsPanel() {
  const { settings, updateSettings } = useApp();
  const { restaurant } = settings;
  const sym = settings.currency?.symbol || DEFAULT_CURRENCY.symbol;

  function update(patch: Partial<RestaurantInfo>) {
    // Logic to prevent both being false
    if (patch.deliveryEnabled === false && restaurant.collectionEnabled === false) return;
    if (patch.collectionEnabled === false && restaurant.deliveryEnabled === false) return;

    updateSettings({ restaurant: { ...restaurant, ...patch } });
  }

  return (
    <div className="space-y-6">
      {/* ── Branding ────────────────────────────────────────────────────── */}
      <BrandingCard />

      {/* ── Fees & Timings ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center">
            <Store size={18} className="text-orange-600" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">Restaurant Operations</h2>
            <p className="text-xs text-gray-400">Fees, timings and order limits</p>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field
            icon={<span className="text-xs font-bold">{sym}</span>}
            label={`Minimum order (${sym})`}
            value={restaurant.minOrder}
            onChange={(v) => update({ minOrder: Number(v) })}
            type="number" step="0.50" min="0"
          />
          <Field
            icon={<span className="text-xs font-bold">{sym}</span>}
            label={`Delivery fee (${sym})`}
            value={restaurant.deliveryFee}
            onChange={(v) => update({ deliveryFee: Number(v) })}
            type="number" step="0.10" min="0"
          />
          <Field
            icon={<span className="text-xs font-bold">%</span>}
            label="Service fee (%)"
            value={restaurant.serviceFee}
            onChange={(v) => update({ serviceFee: Number(v) })}
            type="number" step="0.5" min="0" max="20"
          />
          <Field
            icon={<Clock size={15} />}
            label="Delivery time (minutes)"
            value={restaurant.deliveryTime}
            onChange={(v) => update({ deliveryTime: Number(v) })}
            type="number" step="5" min="5"
          />
          <Field
            icon={<Clock size={15} />}
            label="Collection time (minutes)"
            value={restaurant.collectionTime}
            onChange={(v) => update({ collectionTime: Number(v) })}
            type="number" step="5" min="5"
          />

          <div className="pt-0 border-t border-gray-50">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Available Order Types
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => {
                  // Validation: Cannot disable both
                  if (restaurant.collectionEnabled === false && restaurant.deliveryEnabled !== false) return;
                  update({ deliveryEnabled: !restaurant.deliveryEnabled });
                }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-1 rounded-xl border transition-all ${restaurant.deliveryEnabled !== false
                  ? "border-orange-400 bg-orange-50 text-orange-700"
                  : "border-gray-100 bg-white text-gray-400 opacity-60"
                  }`}
              >
                <Bike size={17} />
                <div className="text-left">
                  <p className="text-[13px] font-semibold leading-tight">Delivery</p>
                  <p className="text-[9px] opacity-70">Courier to door</p>
                </div>
              </button>

              <button
                onClick={() => {
                  // Validation: Cannot disable both
                  if (restaurant.deliveryEnabled === false && restaurant.collectionEnabled !== false) return;
                  update({ collectionEnabled: !restaurant.collectionEnabled });
                }}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-1 rounded-xl border transition-all ${restaurant.collectionEnabled !== false
                  ? "border-orange-400 bg-orange-50 text-orange-700"
                  : "border-gray-100 bg-white text-gray-400 opacity-60"
                  }`}
              >
                <ShoppingBag size={17} />
                <div className="text-left">
                  <p className="text-[13px] font-semibold leading-tight">Collection</p>
                  <p className="text-[9px] opacity-70">Customer pick-up</p>
                </div>
              </button>
            </div>
            {(restaurant.deliveryEnabled === false || restaurant.collectionEnabled === false) && (
              <p className="text-[11px] text-orange-500 mt-2 font-medium">
                Note: At least one order type must remain active.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Currency ────────────────────────────────────────────────────── */}
      <CurrencyCard />

      {/* Loyalty Program moved to its own Finance → Loyalty Program tab. */}

      {/* Customer Display Access moved to its own Displays → Customer Display tab. */}

      {/* ── Hygiene Rating ──────────────────────────────────────────────── */}
      <HygieneRatingCard restaurant={restaurant} update={update} />

      {/* ── Restaurant Location ──────────────────────────────────────────── */}
      <LocationCard />

      {/* ── SEO ─────────────────────────────────────────────────────────── */}
      <SeoCard />

      {/* ── Custom Head Code ────────────────────────────────────────────── */}
      <CustomHeadCard />
    </div>
  );
}

// Customer Display Access card MOVED to its own panel:
// components/admin/CustomerDisplayPanel.tsx (Admin → Displays → Customer
// Display). Removed from here to keep OperationsPanel focused on restaurant
// operations.

// ─── Hygiene rating card ──────────────────────────────────────────────────────

function HygieneRatingCard({
  restaurant,
  update,
}: {
  restaurant: RestaurantInfo;
  update: (patch: Partial<RestaurantInfo>) => void;
}) {
  const rating = Number(restaurant.hygieneRating ?? 0);
  const visible = restaurant.hygieneRatingVisible !== false;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center">
          <Star size={18} className="text-green-600" />
        </div>
        <div>
          <h2 className="font-bold text-gray-900">Food Hygiene Rating</h2>
          <p className="text-xs text-gray-400">Shown as a badge on the customer site header</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Rating value */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">Rating (0 – 5)</label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              {[0, 1, 2, 3, 4, 5].map((n) => {
                const active = n <= rating;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => update({ hygieneRating: n })}
                    className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl border flex items-center justify-center transition ${active
                      ? "bg-green-50 border-green-300 text-green-700"
                      : "bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300"
                      }`}
                    aria-label={`Set hygiene rating to ${n}`}
                  >
                    <span className="text-sm font-semibold">{n}</span>
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-gray-400">
              Current: <span className="font-semibold text-gray-700">{rating} / 5</span>
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            UK Food Standards Agency scale. Use 0 if you have no published rating.
          </p>
        </div>

        {/* Visibility toggle */}
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
          <div className="flex items-start gap-3">
            {visible ? (
              <Eye size={18} className="text-gray-500 mt-0.5 flex-shrink-0" />
            ) : (
              <EyeOff size={18} className="text-gray-400 mt-0.5 flex-shrink-0" />
            )}
            <div>
              <p className="text-sm font-semibold text-gray-800">Show on customer site</p>
              <p className="text-xs text-gray-400">
                {visible
                  ? "The hygiene badge is visible in the customer header."
                  : "The hygiene badge is hidden from customers."}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={visible}
            onClick={() => update({ hygieneRatingVisible: !visible })}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition ${visible ? "bg-green-500" : "bg-gray-300"
              }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${visible ? "translate-x-5" : "translate-x-0.5"
                } mt-0.5`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Currency card ────────────────────────────────────────────────────────────

function CurrencyCard() {
  const { settings, updateSettings } = useApp();
  const current = settings.currency ?? DEFAULT_CURRENCY;

  const matchedPreset = CURRENCY_PRESETS.find(
    (p) => p.code === current.code && p.symbol === current.symbol,
  );
  const [mode, setMode] = useState<"preset" | "custom">(matchedPreset ? "preset" : "custom");
  const [code, setCode] = useState(current.code);
  const [symbol, setSymbol] = useState(current.symbol);
  const [saved, setSaved] = useState(false);

  // Re-sync local state when settings load from Supabase after mount
  useEffect(() => {
    setCode(current.code);
    setSymbol(current.symbol);
    const preset = CURRENCY_PRESETS.find((p) => p.code === current.code && p.symbol === current.symbol);
    setMode(preset ? "preset" : "custom");

  }, [current.code, current.symbol]);

  function handleSelectPreset(presetCode: string) {
    const preset = CURRENCY_PRESETS.find((p) => p.code === presetCode);
    if (!preset) return;
    setMode("preset");
    setCode(preset.code);
    setSymbol(preset.symbol);
    setSaved(false);
  }

  function handleSave() {
    const trimmedSymbol = symbol.trim();
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedSymbol) return;
    updateSettings({ currency: { code: trimmedCode || "XXX", symbol: trimmedSymbol } });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Coins size={18} className="text-emerald-600 flex-shrink-0" />
        </div>
        <div>
          <h2 className="font-bold text-gray-900">Currency</h2>
          <p className="text-xs text-gray-400">Displayed across the customer site, admin panels, POS, and receipts</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Live preview */}
        <div className="bg-gray-50 rounded-xl px-3 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Preview</p>
            <p className="text-[13px] sm:text-base font-mono text-gray-700">
              {symbol}12.50 · {symbol}99.00 · {symbol}1.20
            </p>
          </div>
          <span className="text-[10px] font-mono uppercase bg-gray-200 text-gray-600 px-2 py-1 rounded">{code || "—"}</span>
        </div>

        {/* Preset / Custom toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode("preset")}
            className={`px-3 py-2 text-xs font-semibold rounded-lg border transition ${mode === "preset" ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
          >
            Preset
          </button>
          <button
            type="button"
            onClick={() => setMode("custom")}
            className={`px-3 py-2 text-xs font-semibold rounded-lg border transition ${mode === "custom" ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
          >
            Custom symbol
          </button>
        </div>

        {mode === "preset" ? (
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Currency</label>
            <select
              value={code}
              onChange={(e) => handleSelectPreset(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 transition"
            >
              {CURRENCY_PRESETS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.symbol} — {p.label} ({p.code})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Symbol</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => { setSymbol(e.target.value); setSaved(false); }}
                maxLength={6}
                placeholder="$"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition"
              />
              <p className="mt-1 text-[11px] text-gray-400">Up to 6 characters — e.g. <span className="font-mono">Rs.</span>, <span className="font-mono">kr</span>, <span className="font-mono">د.إ</span></p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">ISO Code (optional)</label>
              <input
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 3)); setSaved(false); }}
                maxLength={3}
                placeholder="XXX"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-emerald-400 transition"
              />
              <p className="mt-1 text-[11px] text-gray-400">3-letter ISO 4217 code — used by future payment integrations.</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold rounded-xl transition"
          >
            Save currency
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <CheckCircle2 size={16} /> Saved — all prices now display in {symbol}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Branding card ───────────────────────────────────────────────────────────

const LOGO_MAX_MB = 2;
const BANNER_MAX_MB = 5;

function BrandingCard() {
  const { settings, updateSettings } = useApp();
  const { restaurant } = settings;

  const [name, setName] = useState(restaurant.name);
  const [tagline, setTagline] = useState(restaurant.tagline);
  const [logo, setLogo] = useState(restaurant.logoImage);
  const [banner, setBanner] = useState(restaurant.coverImage);
  const [nameErr, setNameErr] = useState("");
  const [imgErr, setImgErr] = useState("");
  const [saved, setSaved] = useState(false);

  // Sync local form state when settings load from Supabase (async after mount).
  // Uses a ref to avoid overwriting in-progress edits once the user starts typing.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setName(restaurant.name);
    setTagline(restaurant.tagline);
    setLogo(restaurant.logoImage);
    setBanner(restaurant.coverImage);
  }, [restaurant.name, restaurant.tagline, restaurant.logoImage, restaurant.coverImage]);

  const logoRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  function readImage(file: File, maxMb: number, onDone: (dataUrl: string) => void) {
    setImgErr("");
    if (!file.type.startsWith("image/")) {
      setImgErr("Please select a valid image file (JPEG, PNG, WebP, etc.).");
      return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      setImgErr(`File is too large — max ${maxMb} MB allowed.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => { if (e.target?.result) onDone(e.target.result as string); };
    reader.readAsDataURL(file);
  }

  function handleSave() {
    if (!name.trim()) { setNameErr("Restaurant name is required."); return; }
    setNameErr("");
    const newName = name.trim();
    const oldName = restaurant.name;

    const patch: Parameters<typeof updateSettings>[0] = {
      restaurant: { ...restaurant, name: newName, tagline: tagline.trim(), logoImage: logo, coverImage: banner },
    };

    // Cascade the new name into every setting that still contains the old name.
    if (oldName && newName !== oldName) {
      const replace = (s: string) => s.split(oldName).join(newName);
      patch.seo = {
        metaTitle: replace(settings.seo.metaTitle),
        metaDescription: replace(settings.seo.metaDescription),
        metaKeywords: replace(settings.seo.metaKeywords),
        ogImage: settings.seo.ogImage ?? "",
        siteUrl: settings.seo.siteUrl ?? "",
        faviconUrl: settings.seo.faviconUrl ?? "",
        faviconVersion: settings.seo.faviconVersion ?? "",
      };
      if (settings.footerCopyright.includes(oldName)) {
        patch.footerCopyright = replace(settings.footerCopyright);
      }
      // Keep receipt name in sync if it still matches the old brand name.
      if (settings.receiptSettings.restaurantName === oldName) {
        patch.receiptSettings = { ...settings.receiptSettings, restaurantName: newName };
      }
    }

    updateSettings(patch);
    dirtyRef.current = false;
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-9 h-9 bg-purple-50 rounded-xl flex items-center justify-center">
          <Palette size={18} className="text-purple-600" />
        </div>
        <div>
          <h2 className="font-bold text-gray-900">Restaurant Branding</h2>
          <p className="text-xs text-gray-400">Name, tagline, logo and header banner — changes apply instantly</p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Name + tagline */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Restaurant name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { dirtyRef.current = true; setName(e.target.value); setNameErr(""); setSaved(false); }}
              placeholder="Your Restaurant Name"
              className={`w-full px-3 py-2.5 border rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 transition ${nameErr ? "border-red-300 focus:ring-red-300" : "border-gray-200 focus:ring-orange-400"
                }`}
            />
            {nameErr && (
              <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={11} /> {nameErr}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Tagline</label>
            <input
              type="text"
              value={tagline}
              onChange={(e) => { dirtyRef.current = true; setTagline(e.target.value); setSaved(false); }}
              placeholder="Authentic Indian Cuisine"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            />
          </div>
        </div>

        {/* Image error */}
        {imgErr && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
            <AlertCircle size={15} className="flex-shrink-0" />
            {imgErr}
          </div>
        )}

        {/* Image uploaders */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Logo */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">
              Logo <span className="font-normal text-gray-400">(square · max {LOGO_MAX_MB} MB)</span>
            </p>
            <div className="relative rounded-2xl overflow-hidden border-2 border-dashed border-gray-200 bg-gray-50 aspect-square flex items-center justify-center group">
              {logo ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logo} alt="Logo preview" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-300">
                  <ImageIcon size={32} />
                  <span className="text-xs">No logo</span>
                </div>
              )}
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button
                  onClick={() => logoRef.current?.click()}
                  className="flex items-center gap-1.5 bg-white text-gray-800 text-xs font-semibold px-3 py-2 rounded-lg hover:bg-gray-100 transition"
                >
                  <Upload size={13} />
                  {logo !== seedInfo.logoImage ? "Replace" : "Upload"}
                </button>
                {logo !== seedInfo.logoImage && (
                  <button
                    onClick={() => { setLogo(seedInfo.logoImage); setSaved(false); }}
                    className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-red-600 transition"
                  >
                    <X size={13} /> Remove
                  </button>
                )}
              </div>
            </div>
            {/* Mobile buttons (always visible on small screens) */}
            <div className="mt-2 flex gap-2 md:hidden">
              <button
                onClick={() => logoRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 text-xs font-semibold px-3 py-2 rounded-lg hover:border-orange-300 hover:text-orange-600 transition"
              >
                <Upload size={12} /> {logo !== seedInfo.logoImage ? "Replace logo" : "Upload logo"}
              </button>
              {logo !== seedInfo.logoImage && (
                <button
                  onClick={() => { setLogo(seedInfo.logoImage); setSaved(false); }}
                  className="flex items-center gap-1.5 border border-red-200 text-red-500 text-xs font-semibold px-3 py-2 rounded-lg hover:bg-red-50 transition"
                >
                  <X size={12} /> Remove
                </button>
              )}
            </div>
            <input
              ref={logoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readImage(file, LOGO_MAX_MB, (url) => { setLogo(url); setSaved(false); });
                e.target.value = "";
              }}
            />
          </div>

          {/* Banner */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">
              Header banner <span className="font-normal text-gray-400">(wide · max {BANNER_MAX_MB} MB)</span>
            </p>
            <div className="relative rounded-2xl overflow-hidden border-2 border-dashed border-gray-200 bg-gray-50 aspect-video flex items-center justify-center group">
              {banner ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={banner} alt="Banner preview" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-300">
                  <ImageIcon size={32} />
                  <span className="text-xs">No banner</span>
                </div>
              )}
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button
                  onClick={() => bannerRef.current?.click()}
                  className="flex items-center gap-1.5 bg-white text-gray-800 text-xs font-semibold px-3 py-2 rounded-lg hover:bg-gray-100 transition"
                >
                  <Upload size={13} />
                  {banner !== seedInfo.coverImage ? "Replace" : "Upload"}
                </button>
                {banner !== seedInfo.coverImage && (
                  <button
                    onClick={() => { setBanner(seedInfo.coverImage); setSaved(false); }}
                    className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-red-600 transition"
                  >
                    <X size={13} /> Remove
                  </button>
                )}
              </div>
            </div>
            {/* Mobile buttons */}
            <div className="mt-2 flex gap-2 md:hidden">
              <button
                onClick={() => bannerRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 text-xs font-semibold px-3 py-2 rounded-lg hover:border-orange-300 hover:text-orange-600 transition"
              >
                <Upload size={12} /> {banner !== seedInfo.coverImage ? "Replace banner" : "Upload banner"}
              </button>
              {banner !== seedInfo.coverImage && (
                <button
                  onClick={() => { setBanner(seedInfo.coverImage); setSaved(false); }}
                  className="flex items-center gap-1.5 border border-red-200 text-red-500 text-xs font-semibold px-3 py-2 rounded-lg hover:bg-red-50 transition"
                >
                  <X size={12} /> Remove
                </button>
              )}
            </div>
            <input
              ref={bannerRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readImage(file, BANNER_MAX_MB, (url) => { setBanner(url); setSaved(false); });
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition"
          >
            Save branding
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <CheckCircle2 size={16} /> Saved — changes are live
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SEO card ─────────────────────────────────────────────────────────────────

const TITLE_MAX = 60;
const DESC_MAX = 160;

function charColor(len: number, soft: number, hard: number) {
  if (len > hard) return "text-red-500";
  if (len > soft) return "text-yellow-500";
  return "text-gray-400";
}

function SeoCard() {
  const { settings, updateSettings } = useApp();

  const [title, setTitle] = useState(settings.seo.metaTitle);
  const [desc, setDesc] = useState(settings.seo.metaDescription);
  const [keywords, setKeywords] = useState(settings.seo.metaKeywords);
  const [ogImage, setOgImage] = useState(settings.seo.ogImage ?? "");
  const [siteUrl, setSiteUrl] = useState(settings.seo.siteUrl ?? "");
  const [faviconUrl, setFaviconUrl] = useState(settings.seo.faviconUrl ?? "");
  const [faviconVersion, setFaviconVersion] = useState(settings.seo.faviconVersion ?? "");
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; desc?: string }>({});
  const [favErr, setFavErr] = useState("");
  const faviconRef = useRef<HTMLInputElement>(null);

  function computeFaviconVersion(url: string): string {
    return url.length.toString(36) + Date.now().toString(36).slice(-6);
  }

  function readFavicon(file: File) {
    setFavErr("");
    if (file.size > 512 * 1024) { setFavErr("Max 512 KB for favicons."); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        const url = e.target.result as string;
        setFaviconUrl(url);
        setFaviconVersion(computeFaviconVersion(url));
        setSaved(false);
      }
    };
    reader.readAsDataURL(file);
  }

  function validate() {
    const e: typeof errors = {};
    if (!title.trim()) e.title = "Meta title is required.";
    if (!desc.trim()) e.desc = "Meta description is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    const trimmedFavicon = faviconUrl.trim();
    // If favicon URL changed since the version was computed, recompute now.
    // If favicon was cleared, drop the version too.
    const currentSavedUrl = (settings.seo.faviconUrl ?? "").trim();
    let nextVersion = faviconVersion;
    if (!trimmedFavicon) {
      nextVersion = "";
    } else if (trimmedFavicon !== currentSavedUrl && !nextVersion) {
      nextVersion = computeFaviconVersion(trimmedFavicon);
    }
    updateSettings({
      seo: {
        metaTitle: title.trim(),
        metaDescription: desc.trim(),
        metaKeywords: keywords.trim(),
        ogImage: ogImage.trim(),
        siteUrl: siteUrl.trim(),
        faviconUrl: trimmedFavicon,
        faviconVersion: nextVersion,
      }
    });
    setFaviconVersion(nextVersion);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  // Preview domain — derive from siteUrl if set
  const previewUrl = siteUrl.trim().replace(/^https?:\/\//, "") || "yourrestaurant.com";
  const previewTitle = title.trim() || "Page title";
  const previewDesc = desc.trim() || "Page description";

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">
          <Search size={18} className="text-green-600" />
        </div>
        <div>
          <h2 className="font-bold text-gray-900">SEO &amp; Meta Tags</h2>
          <p className="text-xs text-gray-400">Controls how your site appears in Google and other search engines</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Google SERP preview */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Search result preview</p>
          <p className="text-xs text-green-700 mb-0.5">{previewUrl}</p>
          <p className="text-base font-medium text-blue-700 leading-snug truncate">{previewTitle}</p>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{previewDesc}</p>
        </div>

        {/* Meta title */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-600">
              Meta title <span className="text-red-400">*</span>
            </label>
            <span className={`text-xs font-mono ${charColor(title.length, 50, TITLE_MAX)}`}>
              {title.length}/{TITLE_MAX}
            </span>
          </div>
          <input
            type="text"
            value={title}
            maxLength={TITLE_MAX + 20}
            onChange={(e) => { setTitle(e.target.value); setSaved(false); setErrors((p) => ({ ...p, title: undefined })); }}
            placeholder="Your Restaurant — Order Online"
            className={`w-full px-3 py-2.5 border rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 transition ${errors.title ? "border-red-300 focus:ring-red-300" : "border-gray-200 focus:ring-orange-400"
              }`}
          />
          {errors.title ? (
            <p className="mt-1 text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{errors.title}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-400">Recommended: 50–60 characters. Shown as the clickable headline in search results.</p>
          )}
        </div>

        {/* Meta description */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-600">
              Meta description <span className="text-red-400">*</span>
            </label>
            <span className={`text-xs font-mono ${charColor(desc.length, 140, DESC_MAX)}`}>
              {desc.length}/{DESC_MAX}
            </span>
          </div>
          <textarea
            value={desc}
            maxLength={DESC_MAX + 40}
            rows={3}
            onChange={(e) => { setDesc(e.target.value); setSaved(false); setErrors((p) => ({ ...p, desc: undefined })); }}
            placeholder="Order online from Your Restaurant. Fast delivery and easy collection."
            className={`w-full px-3 py-2.5 border rounded-xl text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 transition ${errors.desc ? "border-red-300 focus:ring-red-300" : "border-gray-200 focus:ring-orange-400"
              }`}
          />
          {errors.desc ? (
            <p className="mt-1 text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{errors.desc}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-400">Recommended: 120–160 characters. Shown below the title in search results.</p>
          )}
        </div>

        {/* Meta keywords */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Meta keywords</label>
          <input
            type="text"
            value={keywords}
            onChange={(e) => { setKeywords(e.target.value); setSaved(false); }}
            placeholder="food delivery, online order, your restaurant name"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
          />
          <p className="mt-1 text-xs text-gray-400">Comma-separated. Most modern search engines ignore this field, but it can aid internal site search.</p>
        </div>

        {/* Site URL */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Site URL</label>
          <input
            type="url"
            value={siteUrl}
            onChange={(e) => { setSiteUrl(e.target.value); setSaved(false); }}
            placeholder="https://demo.directdine.tech"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 font-mono focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
          />
          <p className="mt-1 text-xs text-gray-400">Your full domain — used for the canonical og:url tag. Required for accurate social sharing.</p>
        </div>

        {/* OG Image */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Social share image (og:image)</label>
          <input
            type="url"
            value={ogImage}
            onChange={(e) => { setOgImage(e.target.value); setSaved(false); }}
            placeholder="https://demo.directdine.tech/og-image.jpg"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 font-mono focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
          />
          <p className="mt-1 text-xs text-gray-400">Shown when someone shares your site on WhatsApp, Facebook, Twitter etc. Recommended: 1200×630 px JPG/PNG.</p>
          {ogImage && (
            <div className="mt-2 rounded-xl overflow-hidden border border-gray-200 w-48 h-24 bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ogImage} alt="OG preview" className="w-full h-full object-cover" />
            </div>
          )}
        </div>

        {/* Favicon */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Favicon</label>
          <div className="flex items-start gap-4">
            {/* Preview box */}
            <div className="flex-shrink-0 w-14 h-14 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
              {faviconUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={faviconUrl} alt="Favicon preview" className="w-8 h-8 object-contain" />
              ) : (
                <span className="text-2xl select-none">🌐</span>
              )}
            </div>
            {/* Actions */}
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => faviconRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 text-xs font-semibold rounded-lg hover:border-orange-300 hover:text-orange-600 transition"
                >
                  <Upload size={12} />
                  {faviconUrl ? "Replace favicon" : "Upload favicon"}
                </button>
                {faviconUrl && (
                  <button
                    type="button"
                    onClick={() => { setFaviconUrl(""); setFaviconVersion(""); setSaved(false); setFavErr(""); }}
                    className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-500 text-xs font-semibold rounded-lg hover:bg-red-50 transition"
                  >
                    <X size={12} /> Remove
                  </button>
                )}
              </div>
              {favErr && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} /> {favErr}
                </p>
              )}
              <p className="text-xs text-gray-400">
                PNG, ICO, or SVG · max 512 KB · displayed in browser tabs and bookmarks.
              </p>
            </div>
          </div>
          <input
            ref={faviconRef}
            type="file"
            accept="image/*,.ico"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFavicon(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition"
          >
            Save SEO settings
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <CheckCircle2 size={16} /> Saved — meta tags updated live
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Custom head code card ────────────────────────────────────────────────────

const EXAMPLES = [
  "Google Analytics (gtag.js / GA4)",
  "Google Search Console verification",
  "Facebook Pixel",
  "Hotjar tracking snippet",
  "Custom Open Graph or Twitter Card meta tags",
];

function CustomHeadCard() {
  const { settings, updateSettings } = useApp();

  const [code, setCode] = useState(settings.customHeadCode);
  const [saved, setSaved] = useState(false);
  const [warning, setWarning] = useState("");

  function handleSave() {
    // Basic sanity: warn if unclosed tags are detected (simple heuristic)
    const opens = (code.match(/<[a-zA-Z]/g) ?? []).length;
    const closes = (code.match(/<\/[a-zA-Z]|\/>/g) ?? []).length;
    if (opens > 0 && opens !== closes) {
      setWarning("Code may contain unclosed tags — double-check before saving.");
    } else {
      setWarning("");
    }
    updateSettings({ customHeadCode: code });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function handleClear() {
    setCode("");
    setWarning("");
    setSaved(false);
    updateSettings({ customHeadCode: "" });
  }

  const hasCode = code.trim().length > 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
          <Code2 size={18} className="text-gray-600" />
        </div>
        <div>
          <h2 className="font-bold text-gray-900">Custom Head Code</h2>
          <p className="text-xs text-gray-400">Inject scripts, meta tags, or tracking snippets into the site <code className="font-mono bg-gray-100 px-1 rounded">&lt;head&gt;</code></p>
        </div>
        {hasCode && (
          <span className="ml-auto flex items-center gap-1.5 bg-green-50 border border-green-200 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Active
          </span>
        )}
      </div>

      <div className="p-6 space-y-4">
        {/* Security notice */}
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Info size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-700 leading-relaxed">
            <span className="font-semibold">Only paste code from trusted sources.</span> This is injected directly
            into the page <code className="font-mono bg-amber-100 px-1 rounded">&lt;head&gt;</code> and executes
            on every page load. Invalid or malicious code can break your site.
          </div>
        </div>

        {/* What you can add */}
        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Common uses</p>
          <ul className="space-y-1">
            {EXAMPLES.map((ex) => (
              <li key={ex} className="text-xs text-gray-500 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-gray-300 flex-shrink-0" />
                {ex}
              </li>
            ))}
          </ul>
        </div>

        {/* Code textarea */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-600">Code</label>
            <span className="text-xs font-mono text-gray-400">{code.length} chars</span>
          </div>
          <textarea
            value={code}
            onChange={(e) => { setCode(e.target.value); setSaved(false); setWarning(""); }}
            rows={8}
            spellCheck={false}
            placeholder={`<!-- Example: Google Analytics -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n  gtag('config', 'G-XXXXXXXXXX');\n</script>`}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs font-mono text-gray-700 bg-gray-50 resize-y focus:outline-none focus:ring-2 focus:ring-orange-400 transition placeholder:text-gray-300 leading-relaxed"
          />
          {warning && (
            <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
              <AlertCircle size={11} /> {warning}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition"
          >
            {hasCode ? "Update head code" : "Save head code"}
          </button>
          {hasCode && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-red-200 text-red-500 hover:bg-red-50 text-sm font-semibold rounded-xl transition"
            >
              <X size={14} /> Remove all
            </button>
          )}
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <CheckCircle2 size={16} /> Saved — injected into &lt;head&gt;
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Location card ────────────────────────────────────────────────────────────

function LocationCard() {
  const { settings, updateSettings } = useApp();
  const { restaurant } = settings;

  const [draft, setDraft] = useState({
    addressLine1: restaurant.addressLine1 ?? "",
    addressLine2: restaurant.addressLine2 ?? "",
    city: restaurant.city ?? "",
    postcode: restaurant.postcode ?? "",
    country: restaurant.country ?? "United Kingdom",
    phone: restaurant.phone ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Partial<typeof draft>>({});

  // Sync when settings load from Supabase after mount
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setDraft({
      addressLine1: restaurant.addressLine1 ?? "",
      addressLine2: restaurant.addressLine2 ?? "",
      city: restaurant.city ?? "",
      postcode: restaurant.postcode ?? "",
      country: restaurant.country ?? "United Kingdom",
      phone: restaurant.phone ?? "",
    });
  }, [restaurant.addressLine1, restaurant.addressLine2, restaurant.city, restaurant.postcode, restaurant.country, restaurant.phone]);

  function validate(): boolean {
    const e: Partial<typeof draft> = {};
    if (!draft.addressLine1.trim()) e.addressLine1 = "Address is required";
    if (!draft.city.trim()) e.city = "City is required";
    if (!draft.postcode.trim()) e.postcode = "Postcode is required";
    else if (!validatePostcode(draft.postcode.trim(), draft.country.trim())) e.postcode = `Enter a valid ${draft.country.trim() || "country"} postcode/ZIP`;
    if (!draft.country.trim()) e.country = "Country is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    updateSettings({
      restaurant: {
        ...restaurant,
        addressLine1: draft.addressLine1.trim(),
        addressLine2: draft.addressLine2.trim(),
        city: draft.city.trim(),
        postcode: draft.postcode.trim().toUpperCase(),
        country: draft.country.trim(),
        phone: draft.phone.trim(),
      },
    });
    setSaved(true);
    setErrors({});
    dirtyRef.current = false;
    setTimeout(() => setSaved(false), 3000);
  }

  function field(key: keyof typeof draft) {
    return {
      value: draft[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        dirtyRef.current = true;
        setDraft((p) => ({ ...p, [key]: e.target.value }));
        setSaved(false);
        if (errors[key]) setErrors((p) => ({ ...p, [key]: undefined }));
      },
    };
  }

  const formattedAddress = [
    draft.addressLine1, draft.addressLine2, draft.city,
    draft.postcode.toUpperCase(), draft.country,
  ].filter(Boolean).join(", ");

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
          <MapPin size={18} className="text-blue-600" />
        </div>
        <div>
          <h2 className="font-bold text-gray-900">Location &amp; Contact</h2>
          <p className="text-xs text-gray-400">Address and phone number — shown in emails, receipts, and the website</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Address preview pill */}
        {formattedAddress && (
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <MapPin size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
            <span className="text-xs text-blue-700 leading-relaxed">{formattedAddress}</span>
          </div>
        )}

        {/* Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Address line 1 */}
          <div className="sm:col-span-2">
            <LocationField
              label="Address line 1"
              required
              placeholder="42 Curry Lane"
              error={errors.addressLine1}
              {...field("addressLine1")}
            />
          </div>

          {/* Address line 2 */}
          <div className="sm:col-span-2">
            <LocationField
              label="Address line 2"
              placeholder="Flat, suite, floor (optional)"
              {...field("addressLine2")}
            />
          </div>

          {/* City */}
          <LocationField
            label="City / Town"
            required
            placeholder="London"
            error={errors.city}
            {...field("city")}
          />

          {/* Postcode */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Postcode <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              placeholder="E1 6RF"
              className={`w-full px-3 py-2.5 border rounded-xl text-sm text-gray-800 uppercase placeholder:normal-case focus:outline-none focus:ring-2 transition ${errors.postcode
                ? "border-red-300 focus:ring-red-300"
                : "border-gray-200 focus:ring-orange-400"
                }`}
              {...field("postcode")}
              onChange={(e) => {
                field("postcode").onChange(e);
              }}
            />
            {errors.postcode && (
              <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={11} /> {errors.postcode}
              </p>
            )}
          </div>

          {/* Country */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Country <span className="text-red-400">*</span>
            </label>
            <select
              className={`w-full px-3 py-2.5 border rounded-xl text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 transition ${errors.country
                ? "border-red-300 focus:ring-red-300"
                : "border-gray-200 focus:ring-orange-400"
                }`}
              {...field("country")}
            >
              <option value="United Kingdom">United Kingdom</option>
              <option value="Ireland">Ireland</option>
              <option value="United States">United States</option>
              <option value="Canada">Canada</option>
              <option value="Australia">Australia</option>
              <option value="Other">Other</option>
            </select>
            {errors.country && (
              <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={11} /> {errors.country}
              </p>
            )}
          </div>

          {/* Phone */}
          <div className="sm:col-span-2">
            <LocationField
              label="Phone number"
              placeholder="020 7123 4567"
              {...field("phone")}
            />
            <p className="mt-1 text-xs text-gray-400">Shown in email footers, the website header, and order receipts.</p>
          </div>
        </div>

        {/* GPS pin map — click or drag to set the restaurant's coordinates */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Navigation size={13} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-600">GPS pin</span>
              <span className="text-xs text-gray-400 font-mono">
                {(restaurant.lat ?? 0).toFixed(4)}, {(restaurant.lng ?? 0).toFixed(4)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(
                  (pos) => updateSettings({
                    restaurant: {
                      ...restaurant,
                      lat: +pos.coords.latitude.toFixed(6),
                      lng: +pos.coords.longitude.toFixed(6),
                    },
                  }),
                );
              }}
              className="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1"
            >
              <Navigation size={11} /> Use my location
            </button>
          </div>
          <LocationMap
            center={[restaurant.lat ?? 51.515, restaurant.lng ?? -0.063]}
            height={220}
            className="rounded-xl border border-gray-200"
            markers={[{
              lat: restaurant.lat ?? 51.515,
              lng: restaurant.lng ?? -0.063,
              isPrimary: true,
              tooltip: "Restaurant",
            }]}
            clickToMove
            draggable
            onPrimaryMove={(lat, lng) => updateSettings({ restaurant: { ...restaurant, lat, lng } })}
          />
          <p className="mt-2 text-[11px] text-gray-400">
            Click anywhere on the map or drag the pin to set the precise restaurant location. Used for delivery distance calculations.
          </p>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition"
          >
            Save location
          </button>

          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium animate-fade-in">
              <CheckCircle2 size={16} />
              Saved successfully
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shared input components ───────────────────────────────────────────────────

interface LocationFieldProps {
  label: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function LocationField({ label, placeholder, required, error, value, onChange }: LocationFieldProps) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={`w-full px-3 py-2.5 border rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 transition ${error
          ? "border-red-300 focus:ring-red-300"
          : "border-gray-200 focus:ring-orange-400"
          }`}
      />
      {error && (
        <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  );
}

interface FieldProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  min?: string;
  max?: string;
}

function Field({ icon, label, value, onChange, type = "text", step, min, max }: FieldProps) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>
        <input
          type={type}
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
        />
      </div>
    </div>
  );
}
