"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  X, CreditCard, Banknote, CheckCircle,
  AlertCircle, MapPin, Navigation, Loader2, CalendarDays,
  Tag, XCircle, Gift, Lock, Wallet,
} from "lucide-react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { useApp } from "@/context/AppContext";
import { DeliveryZone, Order, PaymentMethod, SavedAddress } from "@/types";
import { printOrder } from "@/lib/escpos";
import { computeTax, taxSurcharge } from "@/lib/taxUtils";
import { cartSubtotal } from "@/lib/menuOfferUtils";
import { checkoutFormSchema } from "@/lib/schemas/order";
import { cleanPhone } from "@/lib/inputUtils";
import { geocode } from "@/lib/useGeocode";

/**
 * How the current customer pin was set. Drives the pin-status badge above
 * the delivery map so the customer knows whether to drag-refine.
 *   - "user"       — clicked map, dragged, used "Detect location", or picked
 *                    a saved address that already had pinned coords
 *   - "estimated"  — geocoded from the typed address as the user wrote it
 *   - null         — no pin yet (driver will rely on the address string)
 */
type PinSource = "user" | "estimated" | null;

// PayPal's per-currency minimum — mirrors the server-side guard in
// /api/payments/paypal. PayPal doesn't publish a strict floor but very low
// totals are rejected as AMOUNT_NOT_SUPPORTED by some funding sources.
const PAYPAL_MIN_CHARGE_BY_CURRENCY: Record<string, number> = {
  GBP: 1.00,
  USD: 1.00,
  EUR: 1.00,
};
const PAYPAL_MIN_CHARGE_FALLBACK = 1.00;

// PayPal Smart Buttons need the public client id at script-load time. Empty
// string disables the PayPal option entirely (the filter below hides it).
const PAYPAL_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";

// Synthetic payment method used when a gift card / store credit fully covers
// the order (£0 to pay). Routed through the cash path; the server marks the
// £0 order paid since there's nothing to collect.
const COVERED_METHOD: PaymentMethod = {
  id: "cash",
  name: "Gift card / credit",
  description: "Fully covered",
  adminNote: "",
  enabled: true,
  builtIn: true,
  order: 0,
  deliveryRange: { restricted: false, minKm: 0, maxKm: 0 },
};

// Stripe.js loader — singleton so we don't re-download Stripe.js on every
// modal open. `loadStripe` returns null if the key is missing, which the
// card payment step handles with a friendly error message.
let _stripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise(): Promise<StripeJs | null> {
  if (_stripePromise) return _stripePromise;
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    console.warn("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set — card payments will be unavailable.");
    _stripePromise = Promise.resolve(null);
    return _stripePromise;
  }
  _stripePromise = loadStripe(key);
  return _stripePromise;
}

const LocationMap = dynamic(() => import("@/components/maps/LocationMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[180px] w-full bg-gray-50 rounded-xl flex items-center justify-center text-xs text-gray-400 border border-gray-100">
      Loading map…
    </div>
  ),
});

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
  if (id === "cash")   return "hover:border-green-400";
  if (id === "paypal") return "hover:border-blue-400";
  return "hover:border-orange-400";
}

// ─── Location detector widget ─────────────────────────────────────────────────

type LocationState = "idle" | "detecting" | "found" | "denied" | "outside";

function LocationWidget({
  state, distKm, zone, onDetect, currencySymbol,
}: {
  state: LocationState;
  distKm: number | null;
  zone: DeliveryZone | null;
  onDetect: () => void;
  currencySymbol: string;
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
            Delivery fee for your area: <span className="font-semibold text-gray-700">{currencySymbol}{zone.fee.toFixed(2)}</span>
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
    appliedCoupon, applyCoupon, removeCoupon, incrementCouponUsage, applyStoreCreditOptimistic,
    customers,
  } = useApp();

  // Always read from the live customers array (not the login snapshot) so any
  // store credit issued this session is immediately visible.
  const liveUser = customers.find((c) => c.id === currentUser?.id) ?? currentUser;
  const availableCredit = Math.max(0, liveUser?.storeCredit ?? 0);

  const savedAddresses: SavedAddress[] = currentUser?.savedAddresses ?? [];
  const defaultAddress = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0] ?? null;

  const [step, setStep] = useState<"form" | "card_payment" | "paypal_payment" | "success">("form");
  const [chosenMethod, setChosenMethod] = useState<PaymentMethod | null>(null);
  const [placedScheduledTime, setPlacedScheduledTime] = useState<string | null>(null);

  // Stripe card-payment session state — populated when the user picks "Card"
  // and /api/payments/intent returns a client secret. The PaymentElement
  // attaches to this secret and confirms the charge.
  const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<Order | null>(null);

  // PayPal session state — populated when the user picks "PayPal" and
  // /api/payments/paypal returns an order id. The PayPalButtons SDK reads
  // it from createOrder() and the popup opens against that order.
  const [paypalOrderId, setPaypalOrderId] = useState<string | null>(null);

  // Server-authoritative total returned by /api/payments/intent or
  // /api/payments/paypal. The client computes its own preview total, but the
  // server may recompute the delivery fee (zone rules, address validation) and
  // return a different number. We display this authoritative total on the
  // payment step so the customer sees exactly what they'll be charged.
  const [authoritativeTotal, setAuthoritativeTotal] = useState<number | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | "manual">(
    defaultAddress ? defaultAddress.id : "manual"
  );
  const [form, setForm] = useState({
    name:    currentUser?.name  ?? "",
    email:   currentUser?.email ?? "",
    phone:   currentUser?.phone ?? (defaultAddress?.phone ?? ""),
    address: defaultAddress ? `${defaultAddress.address}, ${defaultAddress.postcode}` : "",
    note:    defaultAddress?.note ?? "",
  });

  // Coupon input state
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState("");

  // Store credit — auto-apply when the modal opens if the customer has credit.
  // availableCredit is computed before this useState so the lazy initialiser
  // captures the correct value on first mount.
  const [useCredit, setUseCredit] = useState(() => availableCredit > 0);

  // Gift card — bearer code. Customer types the code; we POST /api/gift-cards/lookup
  // and stash the result so the order summary can show the balance. Unlike store
  // credit there's no auto-apply: we don't know the code until the user types it.
  const [giftCardInput, setGiftCardInput] = useState("");
  const [giftCardError, setGiftCardError] = useState("");
  const [appliedGiftCard, setAppliedGiftCard] = useState<{ code: string; balance: number } | null>(null);
  const [giftCardLookingUp, setGiftCardLookingUp] = useState(false);

  // Location state
  const [locState, setLocState]   = useState<LocationState>("idle");
  const [distKm,   setDistKm]     = useState<number | null>(null);
  const [zone,     setZone]       = useState<DeliveryZone | null>(null);
  const [custLat,  setCustLat]    = useState<number | null>(defaultAddress?.lat ?? null);
  const [custLng,  setCustLng]    = useState<number | null>(defaultAddress?.lng ?? null);
  // A saved-address pin is treated as user-confirmed (the customer placed it
  // when they saved the address). Manual entry starts with no pin → null.
  const [pinSource, setPinSource] = useState<PinSource>(
    defaultAddress?.lat != null && defaultAddress?.lng != null ? "user" : null,
  );
  // Live ref to pinSource so the debounced geocode effect can re-check the
  // current value AFTER its await, not the closure-captured value from when
  // the timeout was scheduled (the user may have placed a pin during the wait).
  const pinSourceRef = useRef<PinSource>(pinSource);
  useEffect(() => { pinSourceRef.current = pinSource; }, [pinSource]);

  // Validation
  const [fieldErrors, setFieldErrors]  = useState<Record<string, string>>({});
  const [submitError, setSubmitError]  = useState("");
  const [submitting,  setSubmitting]   = useState(false);

  const isDelivery = fulfillment === "delivery";
  const sym = settings.currency?.symbol ?? "£";
  const restLat = settings.restaurant.lat ?? 51.515;
  const restLng = settings.restaurant.lng ?? -0.063;

  // Re-compute grand total using zone fee when detected. cartSubtotal applies
  // any cart-level offers (bogo/multibuy/qty_discount) snapshotted on each
  // line; per-unit offers are already in i.price.
  const baseCartTotal  = cartSubtotal(cart);
  const deliveryFee    = isDelivery ? (zone?.fee ?? settings.restaurant.deliveryFee) : 0;
  const serviceFee     = baseCartTotal * (settings.restaurant.serviceFee / 100);
  const couponDiscount = appliedCoupon?.discountAmount ?? 0;
  const tax            = computeTax(baseCartTotal, settings);
  const adjustedTotal     = Math.max(0, baseCartTotal + deliveryFee + serviceFee + taxSurcharge(tax) - couponDiscount);
  const storeCreditApplied = useCredit ? Math.min(availableCredit, adjustedTotal) : 0;
  // Gift card applies after coupon + store credit, capped by the remaining
  // total. Order of operations matches the server (orderValidation.ts).
  const totalBeforeGiftCard = Math.max(0, adjustedTotal - storeCreditApplied);
  const giftCardApplied     = appliedGiftCard
    ? Math.round(Math.min(appliedGiftCard.balance, totalBeforeGiftCard) * 100) / 100
    : 0;
  const orderTotal         = Math.max(0, totalBeforeGiftCard - giftCardApplied);

  // Card minimum is enforced server-side via Stripe's own rejection (see
  // /api/payments/intent catch block). We don't pre-check on the client
  // because per-currency minimums shift with FX rates and hardcoded tables
  // go stale.
  const paypalMin       = PAYPAL_MIN_CHARGE_BY_CURRENCY[(settings.currency?.code ?? "GBP").toUpperCase()] ?? PAYPAL_MIN_CHARGE_FALLBACK;
  const belowPaypalMin  = orderTotal > 0 && orderTotal < paypalMin;

  function applyCode() {
    setCouponError("");
    const result = applyCoupon(couponInput, baseCartTotal);
    if (!result.valid) {
      setCouponError(result.error ?? "Invalid coupon.");
    } else {
      setCouponInput("");
    }
  }

  async function applyGiftCardCode() {
    const code = giftCardInput.trim();
    if (!code) return;
    setGiftCardError("");
    setGiftCardLookingUp(true);
    try {
      const res = await fetch("/api/gift-cards/lookup", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code }),
      });
      const json = await res.json().catch(() => ({})) as {
        ok?: boolean; error?: string; card?: { code: string; balance: number };
      };
      if (!res.ok || !json.ok || !json.card) {
        setGiftCardError(json.error ?? "Could not apply that gift card.");
        return;
      }
      setAppliedGiftCard({ code: json.card.code, balance: json.card.balance });
      setGiftCardInput("");
    } catch {
      setGiftCardError("Connection error. Please try again.");
    } finally {
      setGiftCardLookingUp(false);
    }
  }

  function removeGiftCard() {
    setAppliedGiftCard(null);
    setGiftCardError("");
  }

  // Filter payment methods.
  // PayPal is hidden when NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set — the admin
  // can still toggle the method in Integrations, but a misconfigured deploy
  // should not show a button that opens a broken popup.
  const activeMethods = [...(settings.paymentMethods ?? [])]
    .filter((m) => m.enabled)
    .filter((m) => m.id !== "paypal" || PAYPAL_CLIENT_ID !== "")
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
        applyCustomerCoords(pos.coords.latitude, pos.coords.longitude, "user");
      },
      () => setLocState("denied"),
      { timeout: 8000 }
    );
  }

  function applyCustomerCoords(lat: number, lng: number, source: PinSource = "user") {
    const km = haversineKm(restLat, restLng, lat, lng);
    const found = findZone(km, settings.deliveryZones);
    setCustLat(+lat.toFixed(6));
    setCustLng(+lng.toFixed(6));
    setDistKm(km);
    setZone(found);
    setLocState(found ? "found" : "outside");
    setPinSource(source);
  }

  // ── Geocode-on-debounce ──────────────────────────────────────────────────
  // When the customer types an address into the manual input and has not yet
  // placed a pin themselves, run a debounced Nominatim lookup so a draft pin
  // appears on the map and the fee preview becomes meaningful. Only fires for
  // delivery orders + the manual-address branch, and never overwrites a
  // user-placed pin (pinSource === "user").
  useEffect(() => {
    if (!isDelivery) return;
    if (selectedAddressId !== "manual" && savedAddresses.length > 0) return;
    if (pinSourceRef.current === "user") return;
    const q = form.address.trim();
    if (q.length < 6) return;
    const timer = setTimeout(async () => {
      const geo = await geocode(q);
      if (!geo) return;
      // Skip if the user placed a pin while we were geocoding (read the live
      // value via ref — closure-captured pinSource is stale here).
      if (pinSourceRef.current === "user") return;
      applyCustomerCoords(geo.lat, geo.lng, "estimated");
    }, 700);
    return () => clearTimeout(timer);
    // We deliberately exclude applyCustomerCoords/pinSource from deps: rerunning
    // on every pin-source flip would cause an infinite loop (estimated → set →
    // re-trigger). The address change is the only trigger we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.address, isDelivery, selectedAddressId, savedAddresses.length]);

  function validate(): boolean {
    const result = checkoutFormSchema({ isDelivery }).safeParse({
      name: form.name, email: form.email, phone: form.phone, address: form.address,
    });
    if (result.success) { setFieldErrors({}); return true; }
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
    }
    setFieldErrors(errors);
    return false;
  }

  /**
   * Build the in-memory Order object that mirrors what the server will
   * eventually insert. Both cash and card flows need the same shape — cash
   * inserts it immediately via /api/orders, card stashes it in a
   * payment_session and the webhook inserts after payment_intent.succeeded.
   */
  function buildOrder(method: PaymentMethod): Order {
    return {
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
        // Emit the deprecated singular field too so older consumers keep working.
        ...(i.selectedVariation   ? { selectedVariation:   i.selectedVariation }   : {}),
        ...(i.selectedVariations?.length ? { selectedVariations: i.selectedVariations } : {}),
        ...(i.selectedAddOns?.length ? { selectedAddOns: i.selectedAddOns }        : {}),
        ...(i.specialInstructions ? { specialInstructions: i.specialInstructions } : {}),
        // Snapshot of the offer at add-to-cart time. Server re-verifies it
        // against the current menu_items.offer and applies cart-level
        // discounts authoritatively.
        ...(i.offer ? { offer: i.offer } : {}),
      })),
      paymentMethod: method.name,
      deliveryFee: isDelivery ? deliveryFee : 0,
      serviceFee,
      ...(isDelivery && form.address ? { address: form.address } : {}),
      ...(isDelivery && form.note.trim() ? { note: form.note.trim() } : {}),
      ...(isDelivery && custLat != null && custLng != null
        ? { customerLat: custLat, customerLng: custLng }
        : {}),
      ...(scheduledTime ? { scheduledTime } : {}),
      ...(appliedCoupon ? { couponCode: appliedCoupon.code, couponDiscount: appliedCoupon.discountAmount } : {}),
      ...(tax.enabled && tax.vatAmount > 0 ? { vatAmount: tax.vatAmount, vatInclusive: tax.inclusive } : {}),
      ...(storeCreditApplied > 0 ? { storeCreditUsed: storeCreditApplied } : {}),
      ...(appliedGiftCard && giftCardApplied > 0
        ? { giftCardCode: appliedGiftCard.code, giftCardUsed: giftCardApplied }
        : {}),
    };
  }

  /** Build the body for /api/payments/intent — same fields the cash flow sends to /api/orders. */
  function buildOrderPayload(order: Order) {
    return {
      id: order.id,
      customer_id: order.customerId,
      date: order.date,
      fulfillment: order.fulfillment,
      items: order.items,
      payment_method: order.paymentMethod ?? "",
      address: order.address ?? "",
      note: order.note ?? "",
      // Persist the pin only when the customer actually has one. Server-side
      // validation re-checks bounds, so a malformed pin is safe to send too.
      customer_lat: order.customerLat ?? null,
      customer_lng: order.customerLng ?? null,
      delivery_fee: order.deliveryFee ?? 0,
      service_fee: order.serviceFee ?? 0,
      scheduled_time: order.scheduledTime ?? "",
      coupon_code: order.couponCode ?? "",
      vat_amount: order.vatAmount ?? 0,
      vat_inclusive: order.vatInclusive ?? true,
      store_credit_used: order.storeCreditUsed ?? 0,
      // Gift card code is held in component state, not on the Order object —
      // the server looks it up + clamps the amount authoritatively.
      ...(appliedGiftCard && giftCardApplied > 0
        ? { gift_card_code: appliedGiftCard.code, gift_card_used: giftCardApplied }
        : {}),
      customer_email: form.email.trim() || undefined,
    };
  }

  async function handlePay(method: PaymentMethod) {
    if (!validate()) return;
    if (method.id === "stripe")      await startCardPayment(method);
    else if (method.id === "paypal") await startPaypalPayment(method);
    else                             await placeCashOrder(method);
  }

  // Synchronous double-submit guards. The `submitting` state already disables
  // the buttons but a fast double-click can fire before React re-renders;
  // these refs catch the second call before the fetch is issued.
  const cashInFlight   = useRef(false);
  const cardInFlight   = useRef(false);
  const paypalInFlight = useRef(false);

  /** Cash / pay-on-delivery — order is inserted immediately. */
  async function placeCashOrder(method: PaymentMethod) {
    if (cashInFlight.current) return;
    cashInFlight.current = true;
    setSubmitting(true);
    setSubmitError("");
    const newOrder = buildOrder(method);

    if (currentUser) {
      const result = await addOrder(currentUser.id, newOrder);
      if (!result.ok) {
        setSubmitError(result.error ?? "Failed to place order. Please try again.");
        cashInFlight.current = false;
        setSubmitting(false);
        return;
      }
    }

    if (appliedCoupon) {
      incrementCouponUsage(appliedCoupon.couponId);
      removeCoupon();
    }
    if (storeCreditApplied > 0 && currentUser) {
      // Server-side deduction now happens in /api/orders (same pattern as the
      // Stripe / PayPal webhooks). Here we just sync the optimistic UI so the
      // user's balance display updates immediately without waiting for a
      // reload. The legacy /api/customers/[id]/spend-credit call was removed
      // because the orders POST already stamps `store_credit_used` at insert,
      // which made that endpoint 409 and the balance silently never moved.
      applyStoreCreditOptimistic(currentUser.id, storeCreditApplied);
    }
    setChosenMethod(method);
    setPlacedScheduledTime(scheduledTime);
    setStep("success");
    clearCart();
    setScheduledTime(null);
    cashInFlight.current = false;
    setSubmitting(false);

    printOrder(newOrder, settings);

    // Guest profile is for anonymous (no-account) checkouts only.
    // Signed-in users live in the canonical `customers` table — including them
    // here would double-list them as "guest profiles" (Bug #9).
    if (!currentUser && form.email.trim()) {
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

  /**
   * Stripe card flow — call /api/payments/intent to mint a PaymentIntent
   * and switch to the card_payment step where <PaymentElement /> takes
   * over. The order is NOT created here; the webhook does that after
   * payment_intent.succeeded fires.
   */
  async function startCardPayment(method: PaymentMethod) {
    if (cardInFlight.current) return;
    cardInFlight.current = true;
    setSubmitting(true);
    setSubmitError("");
    const newOrder = buildOrder(method);

    try {
      const r = await fetch("/api/payments/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOrderPayload(newOrder)),
      });
      const j = await r.json() as {
        ok: boolean;
        error?: string;
        clientSecret?: string;
        amount?: number;
      };
      if (!j.ok || !j.clientSecret) {
        setSubmitError(j.error ?? "Could not start payment. Please try again.");
        return;
      }
      setStripeClientSecret(j.clientSecret);
      setPendingOrder(newOrder);
      setChosenMethod(method);
      // Capture the server-authoritative total so the payment screen shows the
      // real charge amount, not the client-computed preview.
      setAuthoritativeTotal(typeof j.amount === "number" ? j.amount : null);
      setStep("card_payment");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error — please try again.");
    } finally {
      cardInFlight.current = false;
      setSubmitting(false);
    }
  }

  /** Called from the inner CardPaymentForm once Stripe confirms the charge. */
  function handleCardPaid() {
    if (appliedCoupon) {
      incrementCouponUsage(appliedCoupon.couponId);
      removeCoupon();
    }
    if (storeCreditApplied > 0 && currentUser) {
      // Stripe order is inserted asynchronously by the webhook — the order
      // row doesn't exist yet at this moment, so calling the server-side
      // spend-credit endpoint would 404. The webhook deducts the customer's
      // balance authoritatively after insert; we just keep the UI in sync.
      applyStoreCreditOptimistic(currentUser.id, storeCreditApplied);
    }
    setPlacedScheduledTime(scheduledTime);
    setStep("success");
    clearCart();
    setScheduledTime(null);
    setStripeClientSecret(null);

    // Receipt printing — the order itself will arrive via Realtime when the
    // webhook inserts it; print the in-memory copy for an immediate receipt.
    if (pendingOrder) printOrder(pendingOrder, settings);

    // Guest profile is for anonymous (no-account) checkouts only.
    // Signed-in users live in the canonical `customers` table — including them
    // here would double-list them as "guest profiles" (Bug #9).
    if (!currentUser && form.email.trim()) {
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

  /**
   * PayPal flow — call /api/payments/paypal to create the PayPal order,
   * switch to the paypal_payment step where <PayPalButtons /> renders the
   * Smart Buttons. The order is NOT created here; the webhook does that
   * after PAYMENT.CAPTURE.COMPLETED fires.
   */
  async function startPaypalPayment(method: PaymentMethod) {
    if (paypalInFlight.current) return;
    if (belowPaypalMin) {
      setSubmitError(`PayPal payments require a minimum of ${sym}${paypalMin.toFixed(2)}. Please pay by cash or add more to your order.`);
      return;
    }
    paypalInFlight.current = true;
    setSubmitting(true);
    setSubmitError("");
    const newOrder = buildOrder(method);

    try {
      const r = await fetch("/api/payments/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOrderPayload(newOrder)),
      });
      const j = await r.json() as {
        ok: boolean;
        error?: string;
        paypalOrderId?: string;
        amount?: number;
      };
      if (!j.ok || !j.paypalOrderId) {
        setSubmitError(j.error ?? "Could not start PayPal payment. Please try again.");
        return;
      }
      setPaypalOrderId(j.paypalOrderId);
      setPendingOrder(newOrder);
      setChosenMethod(method);
      // Capture the server-authoritative total so the payment screen shows the
      // real charge amount, not the client-computed preview.
      setAuthoritativeTotal(typeof j.amount === "number" ? j.amount : null);
      setStep("paypal_payment");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error — please try again.");
    } finally {
      paypalInFlight.current = false;
      setSubmitting(false);
    }
  }

  /** Called once /api/payments/paypal/capture confirms the capture. */
  function handlePaypalPaid() {
    if (appliedCoupon) {
      incrementCouponUsage(appliedCoupon.couponId);
      removeCoupon();
    }
    if (storeCreditApplied > 0 && currentUser) {
      // PayPal order is inserted by the webhook after capture — same race as
      // the Stripe path. Webhook handles the server-side deduction; we just
      // keep the UI in sync here.
      applyStoreCreditOptimistic(currentUser.id, storeCreditApplied);
    }
    setPlacedScheduledTime(scheduledTime);
    setStep("success");
    clearCart();
    setScheduledTime(null);
    setPaypalOrderId(null);

    // Receipt printing — the order itself will arrive via Realtime when the
    // webhook inserts it; print the in-memory copy for an immediate receipt.
    if (pendingOrder) printOrder(pendingOrder, settings);

    if (!currentUser && form.email.trim()) {
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

  // ── Card payment screen — Stripe PaymentElement ─────────────────────────────
  if (step === "card_payment" && stripeClientSecret) {
    // Prefer the server's authoritative number for what we display + send to
    // <CardPaymentForm>. If it differs from the client preview by more than
    // a rounding error, surface a notice so the customer isn't surprised.
    const chargeTotal = authoritativeTotal ?? orderTotal;
    const totalAdjusted = authoritativeTotal != null && Math.abs(authoritativeTotal - orderTotal) > 0.01;
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Complete payment</h2>
              <p className="text-xs text-gray-500 mt-0.5">{sym}{chargeTotal.toFixed(2)} · {chosenMethod?.name}</p>
            </div>
            <button
              onClick={() => {
                // Going back doesn't cancel the PaymentIntent — Stripe expires
                // unfunded intents after a while. We just hide the UI.
                setStep("form");
                setStripeClientSecret(null);
                setPendingOrder(null);
                setAuthoritativeTotal(null);
              }}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition"
            >
              <X size={16} />
            </button>
          </div>
          {totalAdjusted && (
            <div className="px-5 pt-4">
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  <span className="font-semibold">Total updated to {sym}{chargeTotal.toFixed(2)}.</span> Your delivery fee was recalculated based on your address. You&apos;ll be charged this amount.
                </p>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-5">
            <Elements
              stripe={getStripePromise()}
              options={{
                clientSecret: stripeClientSecret,
                appearance: { theme: "stripe", variables: { colorPrimary: "#f97316" } },
              }}
            >
              <CardPaymentForm
                amountLabel={`${sym}${chargeTotal.toFixed(2)}`}
                onPaid={handleCardPaid}
              />
            </Elements>
          </div>
        </div>
      </div>
    );
  }

  // ── PayPal payment screen — Smart Buttons ───────────────────────────────────
  if (step === "paypal_payment" && paypalOrderId) {
    // Same authoritative-total handling as the Stripe screen above. PayPal's
    // own popup will display the captured amount (= the server total), so the
    // notice keeps our own UI honest with that.
    const chargeTotal = authoritativeTotal ?? orderTotal;
    const totalAdjusted = authoritativeTotal != null && Math.abs(authoritativeTotal - orderTotal) > 0.01;
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Pay with PayPal</h2>
              <p className="text-xs text-gray-500 mt-0.5">{sym}{chargeTotal.toFixed(2)} · {chosenMethod?.name}</p>
            </div>
            <button
              onClick={() => {
                // Going back doesn't cancel the PayPal order — it expires on
                // PayPal's side after a few hours of inactivity. We just hide
                // the UI; if the customer retries with the same cart, a new
                // PayPal order is created.
                setStep("form");
                setPaypalOrderId(null);
                setPendingOrder(null);
                setAuthoritativeTotal(null);
              }}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition"
            >
              <X size={16} />
            </button>
          </div>
          {totalAdjusted && (
            <div className="px-5 pt-4">
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  <span className="font-semibold">Total updated to {sym}{chargeTotal.toFixed(2)}.</span> Your delivery fee was recalculated based on your address. PayPal will charge this amount.
                </p>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-5">
            <PaypalPaymentForm
              paypalOrderId={paypalOrderId}
              amountLabel={`${sym}${chargeTotal.toFixed(2)}`}
              currencyCode={(settings.currency?.code ?? "GBP").toUpperCase()}
              onPaid={handlePaypalPaid}
              onCancel={() => {
                setStep("form");
                setPaypalOrderId(null);
                setPendingOrder(null);
                setAuthoritativeTotal(null);
              }}
            />
          </div>
        </div>
      </div>
    );
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
                  <span className="font-medium text-gray-900">{sym}{(item.price * item.quantity).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-gray-200 space-y-1">
              {isDelivery && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Delivery fee{zone ? ` (${zone.name})` : ""}</span>
                  <span>{sym}{deliveryFee.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-gray-500">
                <span>Service fee ({settings.restaurant.serviceFee}%)</span>
                <span>{sym}{serviceFee.toFixed(2)}</span>
              </div>
              {tax.enabled && tax.showBreakdown && tax.vatAmount > 0 && (
                <div className={`flex justify-between text-xs font-semibold ${
                  tax.inclusive ? "text-gray-400" : "text-orange-600"
                }`}>
                  <span>{tax.label}</span>
                  <span>{tax.inclusive ? `${sym}${tax.vatAmount.toFixed(2)}` : `+${sym}${tax.vatAmount.toFixed(2)}`}</span>
                </div>
              )}
              {appliedCoupon && (
                <div className="flex justify-between text-xs text-green-700 font-semibold">
                  <span className="flex items-center gap-1">
                    <Tag size={11} /> Coupon ({appliedCoupon.code})
                  </span>
                  <span>−{sym}{appliedCoupon.discountAmount.toFixed(2)}</span>
                </div>
              )}
              {storeCreditApplied > 0 && (
                <div className="flex justify-between text-xs text-teal-700 font-semibold">
                  <span className="flex items-center gap-1">
                    <Gift size={11} /> Store credit
                  </span>
                  <span>−{sym}{storeCreditApplied.toFixed(2)}</span>
                </div>
              )}
              {giftCardApplied > 0 && (
                <div className="flex justify-between text-xs text-orange-700 font-semibold">
                  <span className="flex items-center gap-1">
                    <Gift size={11} /> Gift card
                  </span>
                  <span>−{sym}{giftCardApplied.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-200 mt-1">
                <span>Total</span>
                <span>{sym}{orderTotal.toFixed(2)}</span>
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
                    <p className="text-xs text-green-600">−{sym}{appliedCoupon.discountAmount.toFixed(2)} discount applied</p>
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
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-mono tracking-widest uppercase placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
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

          {/* Gift card code */}
          <div>
            <h3 className="font-semibold text-gray-900 text-sm mb-2">Gift card</h3>
            {appliedGiftCard ? (
              <>
                <div className="flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Gift size={15} className="text-orange-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-orange-800 font-mono tracking-wider truncate">{appliedGiftCard.code}</p>
                      <p className="text-xs text-orange-600">
                        −{sym}{giftCardApplied.toFixed(2)} applied
                        {appliedGiftCard.balance - giftCardApplied > 0.001 &&
                          ` · ${sym}${(appliedGiftCard.balance - giftCardApplied).toFixed(2)} left after`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={removeGiftCard}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-semibold flex-shrink-0 transition"
                  >
                    <XCircle size={14} /> Remove
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5 flex items-start gap-1">
                  <AlertCircle size={12} className="flex-shrink-0 text-gray-400 mt-px" />
                  Gift card payments are non-refundable — only the amount paid by card can be refunded.
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={giftCardInput}
                    onChange={(e) => { setGiftCardInput(e.target.value.toUpperCase()); setGiftCardError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && applyGiftCardCode()}
                    placeholder="GC-XXXX-XXXX-XXXX"
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-mono tracking-widest uppercase placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                  />
                  <button
                    onClick={applyGiftCardCode}
                    disabled={!giftCardInput.trim() || giftCardLookingUp}
                    className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition"
                  >
                    <Gift size={14} /> {giftCardLookingUp ? "…" : "Apply"}
                  </button>
                </div>
                {giftCardError && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertCircle size={12} className="flex-shrink-0" /> {giftCardError}
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
                    Store credit — <span className="text-teal-600">{sym}{availableCredit.toFixed(2)} available</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {useCredit
                      ? `−${sym}${storeCreditApplied.toFixed(2)} applied · ${sym}${Math.max(0, availableCredit - storeCreditApplied).toFixed(2)} remaining after`
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
                  inputMode={key === "phone" ? "tel" : undefined}
                  autoComplete={key === "phone" ? "tel" : key === "email" ? "email" : key === "name" ? "name" : undefined}
                  value={form[key as keyof typeof form]}
                  onChange={(e) => {
                    const v = key === "phone" ? cleanPhone(e.target.value) : e.target.value;
                    setForm((f) => ({ ...f, [key]: v }));
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
                            // Pre-fill the delivery note from the saved address so the
                            // customer doesn't retype "Flat 3B, gate code 4321" every
                            // time. They can still edit it for this order.
                            note: addr.note ?? "",
                          }));
                          if (fieldErrors.address) setFieldErrors((p) => ({ ...p, address: "" }));
                          if (addr.lat != null && addr.lng != null) {
                            applyCustomerCoords(addr.lat, addr.lng, "user");
                          } else {
                            // Saved address has no pin (legacy entries) — clear any
                            // leftover coords so the geocode-on-debounce can run.
                            setCustLat(null);
                            setCustLng(null);
                            setPinSource(null);
                            setLocState("idle");
                            setDistKm(null);
                            setZone(null);
                          }
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
                        // Switching to manual entry invalidates the previously
                        // selected saved-address pin and note. Clear them so the
                        // geocode-on-debounce can populate fresh values from the
                        // new typed address.
                        setForm((f) => ({ ...f, address: "", note: "" }));
                        setCustLat(null);
                        setCustLng(null);
                        setPinSource(null);
                        setLocState("idle");
                        setDistKm(null);
                        setZone(null);
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
                        // We don't clear an "estimated" pin per-keystroke — the
                        // debounced effect will replace it 700ms after the last
                        // edit. A "user" pin is left untouched (the effect's own
                        // guard skips when pinSource === "user").
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

                {/* Delivery note — for the last-mile bits an address can't express:
                    flat/unit, gate code, "leave at door", etc. Optional but
                    valuable in housing schemes / large complexes. */}
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Delivery note <span className="text-gray-400">(optional — flat / unit / access instructions)</span>
                  </label>
                  <input
                    type="text"
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    placeholder="Flat 3B, gate code 1234, leave at door"
                    maxLength={200}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                  />
                </div>
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
                currencySymbol={sym}
              />

              {/* Pin-source indicator — tells the customer whether their visible
                  pin is a confirmed location or just a guess from the address.
                  Encourages drag-to-refine when the pin came from geocoding. */}
              {custLat != null && custLng != null ? (
                pinSource === "estimated" ? (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <MapPin size={12} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-700">
                      <span className="font-semibold">Pin estimated from your address.</span> Drag the blue pin on the map to confirm the exact spot.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <MapPin size={12} className="text-green-600 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-green-700">
                      <span className="font-semibold">Exact pin set.</span> Drag it if you need to refine.
                    </p>
                  </div>
                )
              ) : (
                <div className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <MapPin size={12} className="text-gray-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-gray-500">
                    <span className="font-semibold">No pin yet.</span> Type your address, tap &quot;Detect&quot;, or click the map.
                  </p>
                </div>
              )}

              {/* Mini-map: restaurant + zone circles + customer pin (when detected) */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <LocationMap
                  center={
                    custLat != null && custLng != null
                      ? [(restLat + custLat) / 2, (restLng + custLng) / 2]
                      : [restLat, restLng]
                  }
                  height={180}
                  fitToContent={custLat != null && custLng != null}
                  zones={settings.deliveryZones
                    .filter((z) => z.enabled)
                    .map((z) => ({ lat: restLat, lng: restLng, radiusKm: z.maxRadiusKm, color: z.color }))}
                  markers={[
                    { lat: restLat, lng: restLng, color: "#f97316", tooltip: "Restaurant" },
                    ...(custLat != null && custLng != null
                      ? [{ lat: custLat, lng: custLng, isPrimary: true, color: "#2563eb", tooltip: "Your location" }]
                      : []),
                  ]}
                  draggable={custLat != null && custLng != null}
                  clickToMove
                  // Map clicks / drags always count as a user-confirmed pin —
                  // the customer is explicitly placing it.
                  onPrimaryMove={(lat, lng) => applyCustomerCoords(lat, lng, "user")}
                />
              </div>
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

            {/* Fully covered by gift card / store credit — nothing left to
                charge, so skip the payment-method tiles and offer a single
                "place order" action. The server marks the £0 order paid. */}
            {orderTotal <= 0 && locState !== "outside" && (
              <button
                onClick={() => placeCashOrder(COVERED_METHOD)}
                disabled={submitting}
                className="group w-full flex items-center gap-3 border-2 border-green-200 bg-green-50 rounded-xl px-4 py-3.5 transition disabled:opacity-60"
              >
                {submitting
                  ? <div className="w-10 h-10 flex items-center justify-center flex-shrink-0"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
                  : <div className="w-10 h-10 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0"><Gift size={18} className="text-white" /></div>
                }
                <div className="text-left flex-1">
                  <p className="font-semibold text-sm text-gray-900">{submitting ? "Placing order…" : "Place order"}</p>
                  <p className="text-xs text-gray-500">
                    Fully covered by {appliedGiftCard ? "gift card" : "store credit"} — nothing to pay
                  </p>
                </div>
                <span className="ml-auto text-gray-300 group-hover:text-gray-500 transition text-lg">›</span>
              </button>
            )}

            {orderTotal > 0 && availableMethods.length === 0 && locState !== "outside" && (
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

            {orderTotal > 0 && locState !== "outside" && availableMethods.map((method) => {
              // Stripe minimum is enforced server-side via Stripe's own
              // rejection (and translated to a friendly message). PayPal
              // we still pre-check because its rejections are less clean.
              const disabledByMin = method.id === "paypal" && belowPaypalMin;
              const methodMin     = paypalMin;
              return (
                <button
                  key={method.id}
                  onClick={() => handlePay(method)}
                  disabled={submitting || disabledByMin}
                  title={disabledByMin ? `${method.name} requires a minimum of ${sym}${methodMin.toFixed(2)}` : undefined}
                  className={`group w-full flex items-center gap-3 border-2 border-gray-200 rounded-xl px-4 py-3.5 transition disabled:opacity-60 disabled:cursor-not-allowed ${hoverColor(method.id)}`}
                >
                  {submitting
                    ? <div className="w-10 h-10 flex items-center justify-center flex-shrink-0"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
                    : <MethodIcon id={method.id} />
                  }
                  <div className="text-left flex-1">
                    <p className="font-semibold text-sm text-gray-900">{method.name}</p>
                    <p className="text-xs text-gray-400">
                      {submitting
                        ? "Placing order…"
                        : disabledByMin
                          ? `Minimum ${sym}${methodMin.toFixed(2)} required for ${method.name}`
                          : method.description}
                    </p>
                  </div>
                  <span className="ml-auto text-gray-300 group-hover:text-gray-500 transition text-lg">›</span>
                </button>
              );
            })}

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

// ─── Inner card-payment form ──────────────────────────────────────────────────
// Lives inside <Elements> so it can use the Stripe hooks. stripe.confirmPayment
// returns when the customer has finished any 3-D-Secure / redirect challenge,
// or with an error if the card was declined. The webhook is the source of
// truth for order creation — we only call onPaid() on a clean success here.

function CardPaymentForm({
  amountLabel,
  onPaid,
}: {
  amountLabel: string;
  onPaid: () => void;
}) {
  const stripe   = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const submitInFlight              = useRef(false);

  // Stripe needs an absolute return_url for redirect-based methods (Klarna,
  // Bancontact, etc.). Even when we confirm in-place via redirect:'if_required',
  // Stripe rejects the request without a return_url being set.
  const returnUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://example.com/checkout-return";
    return `${window.location.origin}/checkout-return`;
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitInFlight.current) return;
    if (!stripe || !elements) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });

      if (stripeError) {
        // Card declined, validation error, or any other Stripe-side issue.
        setError(stripeError.message ?? "Payment could not be processed.");
        return;
      }
      if (paymentIntent && paymentIntent.status === "succeeded") {
        onPaid();
        return;
      }
      if (paymentIntent && paymentIntent.status === "processing") {
        // Some payment methods (bank debits) confirm asynchronously. The webhook
        // will eventually fire payment_intent.succeeded; treat as success here.
        onPaid();
        return;
      }
      setError(`Payment status: ${paymentIntent?.status ?? "unknown"}. Please try again.`);
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition flex items-center justify-center gap-2"
      >
        {submitting
          ? <><Loader2 size={16} className="animate-spin" /> Processing…</>
          : <><Lock size={14} /> Pay {amountLabel}</>
        }
      </button>
      <p className="text-[10px] text-gray-400 text-center">
        Payments are processed securely by Stripe. Your card details are never stored on our servers.
      </p>
    </form>
  );
}

// ─── Inner PayPal payment form ────────────────────────────────────────────────
// Wraps <PayPalButtons /> with the script provider configured for our public
// client id + the order's currency. createOrder() returns the order id we
// already minted via /api/payments/paypal, so the popup attaches to the
// server-verified amount rather than anything supplied by the browser.

function PaypalPaymentForm({
  paypalOrderId,
  amountLabel,
  currencyCode,
  onPaid,
  onCancel,
}: {
  paypalOrderId: string;
  amountLabel:   string;
  currencyCode:  string;
  onPaid:        () => void;
  onCancel:      () => void;
}) {
  const [error,      setError]      = useState<string | null>(null);
  const [capturing,  setCapturing]  = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Amount to pay</span>
        <span className="text-base font-bold text-gray-900">{amountLabel}</span>
      </div>

      <PayPalScriptProvider
        options={{
          clientId: PAYPAL_CLIENT_ID,
          currency: currencyCode,
          intent:   "capture",
        }}
      >
        <PayPalButtons
          style={{ layout: "vertical", shape: "rect", label: "paypal" }}
          disabled={capturing}
          // createOrder fires when the buyer clicks the PayPal button — we
          // already have the server-minted order id, so just hand it over.
          createOrder={() => Promise.resolve(paypalOrderId)}
          onApprove={async (data) => {
            setCapturing(true);
            setError(null);
            try {
              const r = await fetch("/api/payments/paypal/capture", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paypalOrderId: data.orderID }),
              });
              const j = await r.json() as { ok: boolean; error?: string };
              if (!j.ok) {
                setError(j.error ?? "PayPal could not complete the payment.");
                return;
              }
              onPaid();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Network error capturing PayPal payment.");
            } finally {
              setCapturing(false);
            }
          }}
          onCancel={() => onCancel()}
          onError={(err) => {
            const message = err instanceof Error ? err.message : "PayPal encountered an error.";
            setError(message);
          }}
        />
      </PayPalScriptProvider>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {capturing && (
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          Finalising your payment with PayPal…
        </div>
      )}

      <p className="text-[10px] text-gray-400 text-center">
        Payments are processed securely by PayPal. We never see your card or bank details.
      </p>
    </div>
  );
}
