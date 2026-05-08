"use client";

import { useState } from "react";
import {
  X, CreditCard, Wallet, Banknote, CheckCircle,
  AlertCircle, MapPin, Navigation, Loader2, CalendarDays,
  Tag, XCircle, Gift,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { DeliveryZone, Order, PaymentMethod, SavedAddress } from "@/types";
import { printOrder } from "@/lib/escpos";
import { computeTax, taxSurcharge } from "@/lib/taxUtils";

interface Props {
  onClose: () => void;
  onOrderPlaced?: () => void;
}

// ─── Geo helpers (no external API) ───────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Find the smallest enabled zone whose radius covers the given distance. */
function findZone(distKm: number, zones: DeliveryZone[]): DeliveryZone | null {
  return (
    zones
      .filter((z) => z.enabled && distKm >= z.minRadiusKm && distKm <= z.maxRadiusKm)
      .sort((a, b) => a.maxRadiusKm - b.maxRadiusKm)[0] ?? null
  );
}

/**
 * Returns true if a payment method should be shown to this customer.
 * - Collection orders ignore distance rules entirely.
 * - If distance is unknown (geolocation failed/skipped), show all active methods.
 * - If restricted, show only when distKm is within [minKm, maxKm].
 */
function isMethodAvailable(
  method: PaymentMethod,
  distKm: number | null,
  isDelivery: boolean,
): boolean {
  if (!method.enabled) return false;
  if (!isDelivery) return true;                        // collection — no distance check
  if (!method.deliveryRange.restricted) return true;  // no restriction set
  if (distKm === null) return true;                   // can't detect — show all active
  return distKm >= method.deliveryRange.minKm && distKm <= method.deliveryRange.maxKm;
}

// ─── Per-method visual config ─────────────────────────────────────────────────

function MethodIcon({ id }: { id: string }) {
  if (id === "stripe") return (
    <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
      <CreditCard size={18} className="text-white" />
    </div>
  );
  if (id === "paypal") return (
    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center flex-shrink-0">
      <Wallet size={18} className="text-white" />
    </div>
  );
  if (id === "cash") return (
    <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0">
      <Banknote size={18} className="text-white" />
    </div>
  );
  return (
    <div className="w-10 h-10 bg-gradient-to-br from-gray-400 to-gray-500 rounded-lg flex items-center justify-center flex-shrink-0">
      <CreditCard size={18} className="text-white" />
    </div>
  );
}

function hoverColor(id: string) {
  if (id === "paypal") return "hover:border-blue-400";
  if (id === "cash")   return "hover:border-green-400";
  return "hover:border-orange-400";
}

// ─── Location detector widget ─────────────────────────────────────────────────

type LocationState = "idle" | "detecting" | "found" | "denied" | "outside";

function LocationWidget({
  state, distKm, zone, onDetect,
}: {
  state: LocationState;
  distKm: number | null;
  zone: DeliveryZone | null;
  onDetect: () => void;
}) {
  if (state === "idle") {
    return (
      <button
        onClick={onDetect}
        className="w-full flex items-center gap-3 border-2 border-dashed border-gray-200 hover:border-orange-400 rounded-xl px-4 py-3 transition group text-left"
      >
        <Navigation size={16} className="text-gray-400 group-hover:text-orange-500 flex-shrink-0 transition" />
        <div>
          <p className="text-sm font-semibold text-gray-600 group-hover:text-gray-800 transition">Detect my delivery distance</p>
          <p className="text-xs text-gray-400">Confirms which payment methods are available to you</p>
        </div>
      </button>
    );
  }

  if (state === "detecting") {
    return (
      <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 bg-gray-50">
        <Loader2 size={16} className="text-orange-500 animate-spin flex-shrink-0" />
        <p className="text-sm text-gray-600">Detecting your location…</p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-700">Location access denied</p>
          <p className="text-xs text-amber-600 mt-0.5">Showing all active payment methods. Some may have distance restrictions.</p>
        </div>
      </div>
    );
  }

  if (state === "outside") {
    return (
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
        <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-700">
            You&apos;re {distKm !== null ? `${distKm.toFixed(1)} km` : "far"} from our restaurant
          </p>
          <p className="text-xs text-red-500 mt-0.5">Outside all active delivery zones. Contact us to arrange delivery.</p>
        </div>
      </div>
    );
  }

  // state === "found"
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3 border"
      style={{ backgroundColor: zone ? zone.color + "12" : "#f0fdf4", borderColor: zone ? zone.color + "40" : "#bbf7d0" }}
    >
      <MapPin size={16} className="flex-shrink-0" style={{ color: zone?.color ?? "#22c55e" }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">
          {distKm !== null ? `${distKm.toFixed(1)} km` : "Near"} from our restaurant
          {zone && <span className="ml-2 text-xs font-normal text-gray-500">— {zone.name}</span>}
        </p>
        {zone && (
          <p className="text-xs text-gray-500 mt-0.5">
            Delivery fee for your area: <span className="font-semibold text-gray-700">£{zone.fee.toFixed(2)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CheckoutModal({ onClose, onOrderPlaced }: Props) {
  const {
    cart, settings, clearCart, addOrder, currentUser, fulfillment, scheduledTime, setScheduledTime,
    appliedCoupon, applyCoupon, removeCoupon, incrementCouponUsage, spendStoreCredit,
    customers,
  } = useApp();

  // Always read from the live customers array (not the login snapshot) so any
  // store credit issued this session is immediately visible.
  const liveUser = customers.find((c) => c.id === currentUser?.id) ?? currentUser;
  const availableCredit = Math.max(0, liveUser?.storeCredit ?? 0);

  const savedAddresses: SavedAddress[] = currentUser?.savedAddresses ?? [];
  const defaultAddress = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0] ?? null;

  const [step, setStep] = useState<"form" | "success">("form");
  const [chosenMethod, setChosenMethod] = useState<PaymentMethod | null>(null);
  const [placedScheduledTime, setPlacedScheduledTime] = useState<string | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | "manual">(
    defaultAddress ? defaultAddress.id : "manual"
  );
  const [form, setForm] = useState({
    name:    currentUser?.name  ?? "",
    email:   currentUser?.email ?? "",
    phone:   currentUser?.phone ?? (defaultAddress?.phone ?? ""),
    address: defaultAddress ? `${defaultAddress.address}, ${defaultAddress.postcode}` : "",
  });

  // Coupon input state
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState("");

  // Store credit — auto-apply when the modal opens if the customer has credit.
  // availableCredit is computed before this useState so the lazy initialiser
  // captures the correct value on first mount.
  const [useCredit, setUseCredit] = useState(() => availableCredit > 0);

  // Location state
  const [locState, setLocState]   = useState<LocationState>("idle");
  const [distKm,   setDistKm]     = useState<number | null>(null);
  const [zone,     setZone]       = useState<DeliveryZone | null>(null);

  // Validation
  const [fieldErrors, setFieldErrors]  = useState<Record<string, string>>({});
  const [submitError, setSubmitError]  = useState("");
  const [submitting,  setSubmitting]   = useState(false);

  const isDelivery = fulfillment === "delivery";
  const restLat = settings.restaurant.lat ?? 51.515;
  const restLng = settings.restaurant.lng ?? -0.063;

  // Re-compute grand total using zone fee when detected
  const baseCartTotal  = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const deliveryFee    = isDelivery ? (zone?.fee ?? settings.restaurant.deliveryFee) : 0;
  const serviceFee     = baseCartTotal * (settings.restaurant.serviceFee / 100);
  const couponDiscount = appliedCoupon?.discountAmount ?? 0;
  const tax            = computeTax(baseCartTotal, settings);
  const adjustedTotal     = Math.max(0, baseCartTotal + deliveryFee + serviceFee + taxSurcharge(tax) - couponDiscount);
  const storeCreditApplied = useCredit ? Math.min(availableCredit, adjustedTotal) : 0;
  const orderTotal         = Math.max(0, adjustedTotal - storeCreditApplied);

  function applyCode() {
    setCouponError("");
    const result = applyCoupon(couponInput, baseCartTotal);
    if (!result.valid) {
      setCouponError(result.error ?? "Invalid coupon.");
    } else {
      setCouponInput("");
    }
  }

  // Filter payment methods
  const activeMethods = [...(settings.paymentMethods ?? [])]
    .filter((m) => m.enabled)
    .sort((a, b) => a.order - b.order);

  const availableMethods = activeMethods.filter((m) =>
    isMethodAvailable(m, isDelivery ? distKm : null, isDelivery)
  );

  const restrictedMethods = activeMethods.filter(
    (m) => !isMethodAvailable(m, isDelivery ? distKm : null, isDelivery)
  );

  function detectLocation() {
    if (!navigator.geolocation) { setLocState("denied"); return; }
    setLocState("detecting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const km = haversineKm(restLat, restLng, pos.coords.latitude, pos.coords.longitude);
        const found = findZone(km, settings.deliveryZones);
        setDistKm(km);
        setZone(found);
        setLocState(found ? "found" : "outside");
      },
      () => setLocState("denied"),
      { timeout: 8000 }
    );
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!form.name.trim())  errors.name  = "Full name is required.";
    if (!form.email.trim()) {
      errors.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (!form.phone.trim()) errors.phone = "Phone number is required.";
    if (isDelivery && !form.address.trim()) errors.address = "Delivery address is required.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handlePay(method: PaymentMethod) {
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError("");

    const newOrder: Order = {
      id: `ord-${crypto.randomUUID().slice(0, 8)}`,
      customerId: currentUser?.id ?? "guest",
      date: new Date().toISOString(),
      status: "pending",
      fulfillment,
      total: orderTotal,
      items: cart.map((i) => ({
        name: i.name,
        qty: i.quantity,
        price: i.price,
        menuItemId: i.menuItemId,
        ...(i.selectedVariation   ? { selectedVariation:   i.selectedVariation }   : {}),
        ...(i.selectedAddOns?.length ? { selectedAddOns: i.selectedAddOns }        : {}),
        ...(i.specialInstructions ? { specialInstructions: i.specialInstructions } : {}),
      })),
      paymentMethod: method.name,
      deliveryFee: isDelivery ? deliveryFee : 0,
      serviceFee,
      ...(isDelivery && form.address ? { address: form.address } : {}),
      ...(scheduledTime ? { scheduledTime } : {}),
      ...(appliedCoupon ? { couponCode: appliedCoupon.code, couponDiscount: appliedCoupon.discountAmount } : {}),
      ...(tax.enabled && tax.vatAmount > 0 ? { vatAmount: tax.vatAmount, vatInclusive: tax.inclusive } : {}),
      ...(storeCreditApplied > 0 ? { storeCreditUsed: storeCreditApplied } : {}),
    };

    if (currentUser) {
      const result = await addOrder(currentUser.id, newOrder);
      if (!result.ok) {
        setSubmitError(result.error ?? "Failed to place order. Please try again.");
        setSubmitting(false);
        return;
      }
    }

    if (appliedCoupon) {
      incrementCouponUsage(appliedCoupon.couponId);
      removeCoupon();
    }
    if (storeCreditApplied > 0 && currentUser) {
      spendStoreCredit(currentUser.id, storeCreditApplied);
    }
    setChosenMethod(method);
    setPlacedScheduledTime(scheduledTime);
    setStep("success");
    clearCart();
    setScheduledTime(null);
    setSubmitting(false);

    // Fire-and-forget: print receipt (confirmation email is sent server-side by /api/orders)
    printOrder(newOrder, settings);

    // Fire-and-forget: upsert guest profile so the admin can track this customer
    if (form.email.trim()) {
      fetch("/api/guest-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:       form.name.trim(),
          email:      form.email.trim(),
          phone:      form.phone.trim(),
          orderTotal: orderTotal,
        }),
      }).catch(() => {});
    }
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
        <div className="relative bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Order placed! 🎉</h2>
          <p className="text-gray-500 text-sm leading-relaxed">
            Thank you for your order. A confirmation has been sent to{" "}
            <span className="font-medium text-gray-700">{form.email || "your email"}</span>.
          </p>
          {chosenMethod?.id === "cash" ? (
            <p className="text-green-700 font-semibold mt-3 text-sm bg-green-50 rounded-xl px-4 py-2">
              💵 {chosenMethod.adminNote || "Please pay on delivery or in store."}
            </p>
          ) : null}
          {placedScheduledTime ? (
            <div className="mt-3 flex items-center justify-center gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-2">
              <CalendarDays size={14} className="text-green-600" />
              <p className="text-green-700 font-semibold text-sm">
                Scheduled for {placedScheduledTime}
              </p>
            </div>
          ) : chosenMethod?.id !== "cash" ? (
            <p className="text-orange-600 font-semibold mt-3 text-sm">
              Estimated {isDelivery ? "delivery" : "collection"}: {isDelivery ? settings.restaurant.deliveryTime : settings.restaurant.collectionTime} minutes
            </p>
          ) : null}
          <button
            onClick={() => { onClose(); onOrderPlaced?.(); }}
            className="mt-6 w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition"
          >
            View my orders
          </button>
        </div>
      </div>
    );
  }

  // ── Checkout form ───────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">Checkout</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Scheduled time banner */}
          {scheduledTime && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <CalendarDays size={15} className="text-green-600 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-green-800">Scheduled order</p>
                <p className="text-xs text-green-700 mt-0.5">{scheduledTime}</p>
              </div>
            </div>
          )}

          {/* Order summary */}
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">Order summary</h3>
            <ul className="space-y-1.5">
              {cart.map((item) => (
                <li key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-600">{item.quantity}× {item.name}</span>
                  <span className="font-medium text-gray-900">£{(item.price * item.quantity).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-gray-200 space-y-1">
              {isDelivery && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Delivery fee{zone ? ` (${zone.name})` : ""}</span>
                  <span>£{deliveryFee.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-gray-500">
                <span>Service fee ({settings.restaurant.serviceFee}%)</span>
                <span>£{serviceFee.toFixed(2)}</span>
              </div>
              {tax.enabled && tax.showBreakdown && tax.vatAmount > 0 && (
                <div className={`flex justify-between text-xs font-semibold ${
                  tax.inclusive ? "text-gray-400" : "text-orange-600"
                }`}>
                  <span>{tax.label}</span>
                  <span>{tax.inclusive ? `£${tax.vatAmount.toFixed(2)}` : `+£${tax.vatAmount.toFixed(2)}`}</span>
                </div>
              )}
              {appliedCoupon && (
                <div className="flex justify-between text-xs text-green-700 font-semibold">
                  <span className="flex items-center gap-1">
                    <Tag size={11} /> Coupon ({appliedCoupon.code})
                  </span>
                  <span>−£{appliedCoupon.discountAmount.toFixed(2)}</span>
                </div>
              )}
              {storeCreditApplied > 0 && (
                <div className="flex justify-between text-xs text-teal-700 font-semibold">
                  <span className="flex items-center gap-1">
                    <Gift size={11} /> Store credit
                  </span>
                  <span>−£{storeCreditApplied.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200 mt-1">
                <span>Total</span>
                <span>£{orderTotal.toFixed(2)}</span>
              </div>
              {tax.enabled && tax.inclusive && tax.showBreakdown && (
                <p className="text-[10px] text-gray-400 text-right">Prices include {tax.rate}% VAT</p>
              )}
            </div>
          </div>

          {/* Coupon code input */}
          <div>
            <h3 className="font-semibold text-gray-900 text-sm mb-2">Coupon code</h3>
            {appliedCoupon ? (
              <div className="flex items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Tag size={15} className="text-green-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-green-800 font-mono tracking-wider">{appliedCoupon.code}</p>
                    <p className="text-xs text-green-600">−£{appliedCoupon.discountAmount.toFixed(2)} discount applied</p>
                  </div>
                </div>
                <button
                  onClick={() => { removeCoupon(); setCouponError(""); }}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-semibold flex-shrink-0 transition"
                >
                  <XCircle size={14} /> Remove
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => { setCouponInput(e.target.value.toUpperCase().replace(/\s/g, "")); setCouponError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && applyCode()}
                    placeholder="Enter coupon code"
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono tracking-widest uppercase placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                  />
                  <button
                    onClick={applyCode}
                    disabled={!couponInput.trim()}
                    className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition"
                  >
                    <Tag size={14} /> Apply
                  </button>
                </div>
                {couponError && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertCircle size={12} className="flex-shrink-0" /> {couponError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Store credit */}
          {availableCredit > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 text-sm mb-2">Store credit</h3>
              <button
                type="button"
                onClick={() => setUseCredit((v) => !v)}
                className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 border-2 transition ${
                  useCredit
                    ? "border-teal-400 bg-teal-50"
                    : "border-gray-200 hover:border-teal-300"
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  useCredit ? "bg-teal-500" : "bg-teal-100"
                }`}>
                  <Gift size={18} className={useCredit ? "text-white" : "text-teal-600"} />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold text-gray-900">
                    Store credit — <span className="text-teal-600">£{availableCredit.toFixed(2)} available</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {useCredit
                      ? `−£${storeCreditApplied.toFixed(2)} applied · £${Math.max(0, availableCredit - storeCreditApplied).toFixed(2)} remaining after`
                      : "Tap to apply your credit to this order"}
                  </p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                  useCredit ? "border-teal-500 bg-teal-500" : "border-gray-300"
                }`}>
                  {useCredit && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </button>
            </div>
          )}

          {/* Customer details */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900 text-sm">Your details</h3>
            {[
              { key: "name",  label: "Full name",     type: "text",  placeholder: "Jane Smith" },
              { key: "email", label: "Email address", type: "email", placeholder: "jane@example.com" },
              { key: "phone", label: "Phone number",  type: "tel",   placeholder: "+44 7700 900000" },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {label} <span className="text-red-400">*</span>
                </label>
                <input
                  type={type}
                  value={form[key as keyof typeof form]}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, [key]: e.target.value }));
                    if (fieldErrors[key]) setFieldErrors((p) => ({ ...p, [key]: "" }));
                  }}
                  placeholder={placeholder}
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 transition ${
                    fieldErrors[key]
                      ? "border-red-400 focus:ring-red-300 bg-red-50"
                      : "border-gray-200 focus:ring-orange-400"
                  }`}
                />
                {fieldErrors[key] && (
                  <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
                    <AlertCircle size={11} className="flex-shrink-0" /> {fieldErrors[key]}
                  </p>
                )}
              </div>
            ))}

            {/* Delivery address — saved picker or manual input */}
            {isDelivery && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Delivery address <span className="text-red-400">*</span>
                </label>

                {/* Saved address cards (shown when customer has saved addresses) */}
                {savedAddresses.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {savedAddresses.map((addr) => (
                      <button
                        key={addr.id}
                        type="button"
                        onClick={() => {
                          setSelectedAddressId(addr.id);
                          setForm((f) => ({
                            ...f,
                            address: `${addr.address}, ${addr.postcode}`,
                            phone: f.phone || addr.phone || "",
                          }));
                          if (fieldErrors.address) setFieldErrors((p) => ({ ...p, address: "" }));
                        }}
                        className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl border transition ${
                          selectedAddressId === addr.id
                            ? "border-orange-400 bg-orange-50"
                            : "border-gray-200 hover:border-orange-300 bg-white"
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
                          selectedAddressId === addr.id ? "border-orange-500" : "border-gray-300"
                        }`}>
                          {selectedAddressId === addr.id && (
                            <div className="w-2 h-2 rounded-full bg-orange-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                            {addr.label}
                            {addr.isDefault && (
                              <span className="text-[9px] font-bold bg-orange-100 text-orange-600 rounded-full px-1.5 py-0.5">Default</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{addr.address}, {addr.postcode}</p>
                          {addr.note && <p className="text-[10px] text-gray-400 italic mt-0.5 truncate">{addr.note}</p>}
                        </div>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAddressId("manual");
                        setForm((f) => ({ ...f, address: "" }));
                      }}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border transition ${
                        selectedAddressId === "manual"
                          ? "border-orange-400 bg-orange-50"
                          : "border-dashed border-gray-200 hover:border-orange-300"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                        selectedAddressId === "manual" ? "border-orange-500" : "border-gray-300"
                      }`}>
                        {selectedAddressId === "manual" && (
                          <div className="w-2 h-2 rounded-full bg-orange-500" />
                        )}
                      </div>
                      <p className="text-xs font-semibold text-gray-600">Enter a different address</p>
                    </button>
                  </div>
                )}

                {/* Manual address input — always shown when no saved addresses, or "Enter different" selected */}
                {(savedAddresses.length === 0 || selectedAddressId === "manual") && (
                  <>
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, address: e.target.value }));
                        if (fieldErrors.address) setFieldErrors((p) => ({ ...p, address: "" }));
                      }}
                      placeholder="42 Example Street, London"
                      className={`w-full border rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 transition ${
                        fieldErrors.address
                          ? "border-red-400 focus:ring-red-300 bg-red-50"
                          : "border-gray-200 focus:ring-orange-400"
                      }`}
                    />
                    {fieldErrors.address && (
                      <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
                        <AlertCircle size={11} className="flex-shrink-0" /> {fieldErrors.address}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Delivery distance detector (delivery only) */}
          {isDelivery && (
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900 text-sm">Delivery area</h3>
              <LocationWidget
                state={locState}
                distKm={distKm}
                zone={zone}
                onDetect={detectLocation}
              />
            </div>
          )}

          {/* Submit error */}
          {submitError && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium">{submitError}</p>
            </div>
          )}

          {/* Payment methods */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900 text-sm">Payment</h3>

            {availableMethods.length === 0 && locState !== "outside" && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-4">
                <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700">No payment methods available</p>
                  <p className="text-xs text-red-500 mt-0.5">
                    The restaurant has not enabled any payment methods. Please contact us to place your order.
                  </p>
                </div>
              </div>
            )}

            {locState === "outside" && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-4">
                <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700">Outside delivery area</p>
                  <p className="text-xs text-red-500 mt-0.5">
                    We&apos;re unable to deliver to your location. Please contact us directly.
                  </p>
                </div>
              </div>
            )}

            {locState !== "outside" && availableMethods.map((method) => (
              <button
                key={method.id}
                onClick={() => handlePay(method)}
                disabled={submitting}
                className={`group w-full flex items-center gap-3 border-2 border-gray-200 rounded-xl px-4 py-3.5 transition disabled:opacity-60 disabled:cursor-not-allowed ${hoverColor(method.id)}`}
              >
                {submitting
                  ? <div className="w-10 h-10 flex items-center justify-center flex-shrink-0"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
                  : <MethodIcon id={method.id} />
                }
                <div className="text-left flex-1">
                  <p className="font-semibold text-sm text-gray-900">{method.name}</p>
                  <p className="text-xs text-gray-400">{submitting ? "Placing order…" : method.description}</p>
                </div>
                <span className="ml-auto text-gray-300 group-hover:text-gray-500 transition text-lg">›</span>
              </button>
            ))}

            {/* Methods hidden due to distance — shown as info only when location is detected */}
            {locState === "found" && restrictedMethods.length > 0 && (
              <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 mb-2">Not available at your distance</p>
                {restrictedMethods.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs text-gray-400 py-0.5">
                    <span>–</span>
                    <span className="font-medium">{m.name}</span>
                    <span>(available {m.deliveryRange.minKm}–{m.deliveryRange.maxKm} km)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
