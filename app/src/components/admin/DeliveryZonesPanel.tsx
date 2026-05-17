"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useApp } from "@/context/AppContext";
import { DeliveryZone } from "@/types";
import {
  MapPin, Plus, Trash2, Pencil, Check, X,
  Navigation, Ruler, ToggleRight, ToggleLeft,
  Info, AlertCircle,
} from "lucide-react";

const DeliveryZoneMap = dynamic(() => import("./DeliveryZoneMap"), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm h-[420px] flex items-center justify-center text-sm text-gray-400">
      Loading map…
    </div>
  ),
});

const PRESET_COLORS = [
  "#f97316", "#3b82f6", "#a855f7", "#10b981",
  "#ef4444", "#f59e0b", "#06b6d4", "#ec4899",
];

// ─── Zone Card ────────────────────────────────────────────────────────────────

function ZoneCard({
  zone, onUpdate, onDelete,
}: {
  zone: DeliveryZone;
  onUpdate: (z: DeliveryZone) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: zone.name,
    minRadiusKm: zone.minRadiusKm,
    maxRadiusKm: zone.maxRadiusKm,
    fee: zone.fee,
    color: zone.color,
  });

  function save() {
    onUpdate({ ...zone, ...draft });
    setEditing(false);
  }
  function cancel() {
    setDraft({ name: zone.name, minRadiusKm: zone.minRadiusKm, maxRadiusKm: zone.maxRadiusKm, fee: zone.fee, color: zone.color });
    setEditing(false);
  }

  return (
    <div className={`rounded-2xl border-2 transition-colors ${zone.enabled ? "border-gray-100 bg-white" : "border-dashed border-gray-200 bg-gray-50/60"}`}>
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: zone.color }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`font-semibold text-sm ${zone.enabled ? "text-gray-900" : "text-gray-400"}`}>
                {zone.name}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${zone.enabled ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-400 border-gray-200"
                }`}>
                {zone.enabled ? "Active" : "Disabled"}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {zone.minRadiusKm}–{zone.maxRadiusKm} km &nbsp;·&nbsp; £{zone.fee.toFixed(2)} delivery
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center sm:justify-end gap-2 flex-shrink-0 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-0 border-gray-100">
          <button
            onClick={() => onUpdate({ ...zone, enabled: !zone.enabled })}
            className={`transition-colors ${zone.enabled ? "text-green-500 hover:text-green-600" : "text-gray-300 hover:text-gray-400"}`}
          >
            {zone.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-orange-100 hover:text-orange-600 text-gray-500 transition"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={onDelete}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-red-100 hover:text-red-500 text-gray-500 transition"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Inline editor */}
      {editing && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 bg-gray-50/50 rounded-b-2xl space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Zone name</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Min (km)</label>
              <input
                type="number" min="0" step="0.5"
                value={draft.minRadiusKm}
                onChange={(e) => setDraft((d) => ({ ...d, minRadiusKm: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Max (km)</label>
              <input
                type="number" min="0" step="0.5"
                value={draft.maxRadiusKm}
                onChange={(e) => setDraft((d) => ({ ...d, maxRadiusKm: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Fee (£)</label>
              <input
                type="number" min="0" step="0.10"
                value={draft.fee}
                onChange={(e) => setDraft((d) => ({ ...d, fee: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition"
              />
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Zone colour</label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setDraft((d) => ({ ...d, color: c }))}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${draft.color === c ? "ring-2 ring-offset-1 ring-gray-400 scale-110" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={save} className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition">
              <Check size={13} /> Save
            </button>
            <button onClick={cancel} className="flex items-center gap-1.5 border border-gray-200 text-gray-500 hover:text-gray-700 text-xs font-semibold px-3 py-2 rounded-xl transition">
              <X size={13} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Restaurant Location Card ─────────────────────────────────────────────────

function RestaurantLocationCard() {
  const { settings, updateSettings } = useApp();
  const { restaurant } = settings;
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");

  function handleDetect() {
    if (!navigator.geolocation) { setLocError("Geolocation not supported by this browser."); return; }
    setLocating(true);
    setLocError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateSettings({
          restaurant: { ...restaurant, lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) },
        });
        setLocating(false);
      },
      () => { setLocError("Location access denied."); setLocating(false); }
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-orange-100 rounded-xl flex items-center justify-center">
          <Navigation size={15} className="text-orange-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">Restaurant location</h3>
          <p className="text-xs text-gray-400">Used to calculate delivery distances</p>
        </div>
      </div>

      <p className="text-xs text-gray-500 mb-3 flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 flex-shrink-0 text-gray-400" />
        {[restaurant.addressLine1, restaurant.addressLine2, restaurant.city, restaurant.postcode, restaurant.country]
          .filter(Boolean).join(", ")}
      </p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Latitude</label>
          <input
            type="number" step="0.0001"
            value={restaurant.lat ?? 51.515}
            onChange={(e) => updateSettings({ restaurant: { ...restaurant, lat: Number(e.target.value) } })}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Longitude</label>
          <input
            type="number" step="0.0001"
            value={restaurant.lng ?? -0.063}
            onChange={(e) => updateSettings({ restaurant: { ...restaurant, lng: Number(e.target.value) } })}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
          />
        </div>
      </div>

      <button
        onClick={handleDetect}
        disabled={locating}
        className="flex items-center gap-2 text-sm font-semibold text-orange-600 hover:text-orange-700 disabled:opacity-50 transition"
      >
        <Navigation size={14} className={locating ? "animate-spin" : ""} />
        {locating ? "Detecting…" : "Use my current location"}
      </button>
      {locError && <p className="text-xs text-red-500 mt-1">{locError}</p>}
    </div>
  );
}

// ─── Payment Method Distance Rules ────────────────────────────────────────────

function PaymentDistanceRules() {
  const { settings, updatePaymentMethod } = useApp();
  const methods = [...settings.paymentMethods].sort((a, b) => a.order - b.order);
  const maxZoneKm = settings.deliveryZones.length
    ? Math.max(...settings.deliveryZones.map((z) => z.maxRadiusKm))
    : 50;

  const METHOD_ICONS: Record<string, string> = { stripe: "💳", paypal: "🅿️", cash: "💵" };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <Ruler size={15} className="text-orange-500" />
        <h3 className="font-semibold text-gray-900 text-sm">Payment method distance rules</h3>
        <span className="ml-2 text-xs text-gray-400">Restrict which methods appear at checkout based on delivery distance</span>
      </div>

      <div className="divide-y divide-gray-50">
        {methods.map((method) => {
          const range = method.deliveryRange ?? { restricted: false, minKm: 0, maxKm: 50 };
          return (
            <div key={method.id} className="px-5 py-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-lg flex-shrink-0">{METHOD_ICONS[method.id] ?? "💳"}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm text-gray-900">{method.name}</span>
                  {!method.enabled && (
                    <span className="ml-2 text-[10px] bg-gray-100 text-gray-400 rounded-full px-2 py-0.5">Disabled</span>
                  )}
                </div>

                {/* Restrict toggle */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{range.restricted ? "Restricted" : "No restriction"}</span>
                  <button
                    onClick={() => updatePaymentMethod({ ...method, deliveryRange: { ...range, restricted: !range.restricted } })}
                    className={`transition-colors ${range.restricted ? "text-orange-500 hover:text-orange-600" : "text-gray-300 hover:text-gray-400"}`}
                  >
                    {range.restricted ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                  </button>
                </div>
              </div>

              {/* Range inputs — only shown when restricted */}
              {range.restricted && (
                <div className="flex flex-wrap items-center gap-3 pl-4 sm:pl-9">
                  <div className="flex items-center gap-2 ">
                    <span className="text-xs text-gray-500 whitespace-nowrap">Min km</span>
                    <input
                      type="number" min="0" step="0.5" max={range.maxKm}
                      value={range.minKm}
                      onChange={(e) => updatePaymentMethod({ ...method, deliveryRange: { ...range, minKm: Number(e.target.value) } })}
                      className="w-10 sm:w-20 px-3 py-1.5 border border-gray-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                    />
                  </div>
                  <span className="text-gray-300">—</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-gray-500 whitespace-nowrap">Max km</span>
                    <input
                      type="number" min={range.minKm} step="0.5" max={maxZoneKm}
                      value={range.maxKm}
                      onChange={(e) => updatePaymentMethod({ ...method, deliveryRange: { ...range, maxKm: Number(e.target.value) } })}
                      className="w-10 sm:w-20 px-3 py-1.5 border border-gray-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                    />
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    Available {range.minKm}–{range.maxKm} km from restaurant
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function DeliveryZonesPanel() {
  const { settings, updateSettings, addDeliveryZone, updateDeliveryZone, deleteDeliveryZone } = useApp();
  const zones = [...settings.deliveryZones].sort((a, b) => a.maxRadiusKm - b.maxRadiusKm);
  const [showAdd, setShowAdd] = useState(false);
  const [newZone, setNewZone] = useState({ name: "", minRadiusKm: 0, maxRadiusKm: 5, fee: 2.99, color: PRESET_COLORS[zones.length % PRESET_COLORS.length] });

  // Validation for overlap
  function hasOverlap(minKm: number, maxKm: number, excludeId?: string): boolean {
    return zones
      .filter((z) => z.id !== excludeId)
      .some((z) => minKm < z.maxRadiusKm && maxKm > z.minRadiusKm);
  }

  function handleAdd() {
    if (!newZone.name.trim() || newZone.maxRadiusKm <= newZone.minRadiusKm) return;
    addDeliveryZone({
      id: crypto.randomUUID(),
      ...newZone,
      enabled: true,
    });
    setShowAdd(false);
    setNewZone({ name: "", minRadiusKm: 0, maxRadiusKm: 5, fee: 2.99, color: PRESET_COLORS[(zones.length + 1) % PRESET_COLORS.length] });
  }

  const activeCount = zones.filter((z) => z.enabled).length;
  const { restaurant } = settings;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium mb-1">Active zones</p>
          <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
          <p className="text-xs text-gray-400">of {zones.length} configured</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium mb-1">Max radius</p>
          <p className="text-2xl font-bold text-gray-900">
            {zones.length ? Math.max(...zones.map((z) => z.maxRadiusKm)) : 0} km
          </p>
          <p className="text-xs text-gray-400">furthest delivery zone</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-gray-500 font-medium mb-1">Fee range</p>
          <p className="text-2xl font-bold text-gray-900">
            {zones.length
              ? `£${Math.min(...zones.map((z) => z.fee)).toFixed(2)}–£${Math.max(...zones.map((z) => z.fee)).toFixed(2)}`
              : "—"}
          </p>
          <p className="text-xs text-gray-400">across all zones</p>
        </div>
      </div>

      {/* Main grid: location card + map side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RestaurantLocationCard />
        <DeliveryZoneMap
          zones={zones}
          lat={restaurant.lat ?? 51.515}
          lng={restaurant.lng ?? -0.063}
          onLocationChange={(lat, lng) =>
            updateSettings({ restaurant: { ...restaurant, lat, lng } })
          }
        />
      </div>

      {/* Zone list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-row gap-3">
            <MapPin size={15} className="text-orange-500" />
            <h3 className="font-semibold text-gray-900 text-sm">Delivery zones</h3>
          </div>
          <span className="text-xs text-gray-400">{zones.length} zone{zones.length !== 1 ? "s" : ""} defined</span>

          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition"
          >
            <Plus size={13} /> Add zone
          </button>
        </div>

        {/* Add zone form */}
        {showAdd && (
          <div className="px-5 py-4 border-b border-orange-100 bg-orange-50/40">
            <p className="text-xs font-semibold text-gray-700 mb-3">New zone</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Name</label>
                <input
                  type="text"
                  placeholder="e.g. Zone 1"
                  value={newZone.name}
                  onChange={(e) => setNewZone((d) => ({ ...d, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Min (km)</label>
                <input type="number" min="0" step="0.5" value={newZone.minRadiusKm}
                  onChange={(e) => setNewZone((d) => ({ ...d, minRadiusKm: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Max (km)</label>
                <input type="number" min="0" step="0.5" value={newZone.maxRadiusKm}
                  onChange={(e) => setNewZone((d) => ({ ...d, maxRadiusKm: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Fee (£)</label>
                <input type="number" min="0" step="0.10" value={newZone.fee}
                  onChange={(e) => setNewZone((d) => ({ ...d, fee: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition" />
              </div>
            </div>

            <div className="flex items-center gap-3 mb-3">
              <label className="text-xs font-semibold text-gray-500">Colour</label>
              <div className="flex gap-2">
                {PRESET_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewZone((d) => ({ ...d, color: c }))}
                    className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${newZone.color === c ? "ring-2 ring-offset-1 ring-gray-400 scale-110" : ""}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>

            {hasOverlap(newZone.minRadiusKm, newZone.maxRadiusKm) && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                <AlertCircle size={12} /> This range overlaps with an existing zone.
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={handleAdd}
                disabled={!newZone.name.trim() || newZone.maxRadiusKm <= newZone.minRadiusKm}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-3 py-2 rounded-xl transition">
                <Check size={13} /> Add zone
              </button>
              <button onClick={() => setShowAdd(false)}
                className="flex items-center gap-1.5 border border-gray-200 text-gray-500 hover:text-gray-700 text-xs font-semibold px-3 py-2 rounded-xl transition">
                <X size={13} /> Cancel
              </button>
            </div>
          </div>
        )}

        {/* Zone cards */}
        <div className="p-5 space-y-3">
          {zones.length === 0 ? (
            <div className="text-center py-10">
              <MapPin size={32} className="mx-auto text-gray-200 mb-2" />
              <p className="text-sm text-gray-400 font-medium">No delivery zones yet</p>
              <p className="text-xs text-gray-300 mt-1">Add zones to control delivery fees and payment method availability.</p>
            </div>
          ) : (
            zones.map((zone) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                onUpdate={updateDeliveryZone}
                onDelete={() => deleteDeliveryZone(zone.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Payment method distance rules */}
      <PaymentDistanceRules />
    </div>
  );
}
