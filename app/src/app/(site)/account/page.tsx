"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  User, Mail, Phone, Calendar, ShoppingBag, TrendingUp, Clock,
  ChevronDown, ChevronUp, Star, Package,
  Edit2, Check, X, RotateCcw, ShoppingCart, AlertCircle, RefreshCw,
  Heart, Plus, PackageX, MapPin, Home, Briefcase, Trash2, Star as StarIcon, Truck, Gift,
  Lock, Eye, EyeOff, ShieldCheck,
  LayoutDashboard,
  LogOut,
  Search,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { Order, OrderLine, OrderStatus, DeliveryStatus, MenuItem, SavedAddress, AddOn, CartItem } from "@/types";
import AuthModal from "@/components/AuthModal";
import ItemCustomizationModal from "@/components/ItemCustomizationModal";
import { resolveStock } from "@/lib/stockUtils";
import MobileBottomNav from "@/components/MobileBottomNav";
import CartPanel from "@/components/CartPanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; dot: string }> = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-700", dot: "bg-yellow-500" },
  confirmed: { label: "Confirmed", color: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  preparing: { label: "Preparing", color: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  ready: { label: "Ready", color: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-700", dot: "bg-green-500" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700", dot: "bg-red-400" },
  refunded: { label: "Refunded", color: "bg-teal-100 text-teal-700", dot: "bg-teal-500" },
  partially_refunded: { label: "Partially Refunded", color: "bg-cyan-100 text-cyan-700", dot: "bg-cyan-500" },
};

// Kitchen-only steps (delivery hands off to driver after "ready")
const DELIVERY_STEPS: OrderStatus[] = ["pending", "confirmed", "preparing", "ready"];
// Collection goes all the way through to "delivered" in the kitchen flow
const COLLECTION_STEPS: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "delivered"];

function getReadyLabel(fulfillment: string) {
  return fulfillment === "delivery" ? "Ready for Pickup" : "Ready for Collection";
}

// While order.status stays "ready" during the driver leg, these configs override
// the badge so the customer sees meaningful progress rather than "Ready for Pickup".
const DELIVERY_STATUS_BADGE: Record<DeliveryStatus, { label: string; color: string; dot: string }> = {
  assigned: { label: "Driver Assigned", color: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  picked_up: { label: "Picked Up", color: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  on_the_way: { label: "On the Way", color: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500" },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-700", dot: "bg-green-500" },
};

function StatusBadge({ order }: { order: Order }) {
  // Delivery orders with an active driver leg: show delivery status instead of
  // order status, because order.status stays "ready" until final delivery.
  if (
    order.fulfillment === "delivery" &&
    order.deliveryStatus &&
    order.status !== "cancelled"
  ) {
    const cfg = DELIVERY_STATUS_BADGE[order.deliveryStatus];
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
    );
  }

  const cfg = STATUS_CONFIG[order.status];
  const label = order.status === "ready" ? getReadyLabel(order.fulfillment) : cfg.label;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {label}
    </span>
  );
}

function OrderTracker({ order }: { order: Order }) {
  if (order.status === "cancelled") return null;

  // Delivery orders: kitchen tracker only goes up to "ready" — the driver leg
  // (assigned → picked_up → on_the_way → delivered) is shown in DeliveryTracker.
  // Collection orders: full 5-step flow including "delivered".
  const steps = order.fulfillment === "delivery" ? DELIVERY_STEPS : COLLECTION_STEPS;

  // When a delivery order is fully delivered, treat all kitchen steps as done.
  const effectiveStatus = (order.status === "delivered" && order.fulfillment === "delivery")
    ? "ready"   // all 4 kitchen steps done
    : order.status;

  const currentIdx = steps.indexOf(effectiveStatus);

  return (
    <div className="flex items-center gap-1 mt-3">
      {steps.map((step, i) => {
        const done = i <= currentIdx || order.status === "delivered";
        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors ${done ? "bg-orange-500" : "bg-gray-200"}`} />
            {i < steps.length - 1 && (
              <div className={`h-0.5 flex-1 mx-0.5 transition-colors ${i < (order.status === "delivered" ? steps.length : currentIdx) ? "bg-orange-500" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Delivery status tracker (driver leg) ─────────────────────────────────────

const DS_STEPS: DeliveryStatus[] = ["assigned", "picked_up", "on_the_way", "delivered"];

const DS_CONFIG: Record<DeliveryStatus, { label: string; emoji: string; color: string; pulse?: boolean }> = {
  assigned: { label: "Driver assigned", emoji: "🏍️", color: "text-amber-600", pulse: false },
  picked_up: { label: "Order picked up", emoji: "📦", color: "text-blue-600", pulse: false },
  on_the_way: { label: "Driver on the way", emoji: "🚴", color: "text-indigo-600", pulse: true },
  delivered: { label: "Order delivered", emoji: "✅", color: "text-green-600", pulse: false },
};

function DeliveryTracker({ order }: { order: Order }) {
  const ds = order.deliveryStatus;
  if (!ds || order.fulfillment !== "delivery") return null;

  const currentIdx = DS_STEPS.indexOf(ds);
  const cfg = DS_CONFIG[ds];

  return (
    <div className={`mt-3 rounded-xl px-3 py-2.5 border ${ds === "on_the_way" ? "bg-indigo-50 border-indigo-200" :
      ds === "delivered" ? "bg-green-50 border-green-200" :
        ds === "picked_up" ? "bg-blue-50 border-blue-200" :
          "bg-amber-50 border-amber-200"
      }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{cfg.emoji}</span>
        <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
        {cfg.pulse && <span className="ml-auto flex items-center gap-1 text-[10px] text-indigo-500 font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" /> Live
        </span>}
      </div>
      {/* Step dots */}
      <div className="flex items-center gap-1">
        {DS_STEPS.map((step, i) => {
          const done = i <= currentIdx;
          const active = step === ds;
          return (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-all ${active ? "bg-indigo-500 ring-2 ring-indigo-200 scale-125" :
                done ? "bg-indigo-400" : "bg-gray-200"
                }`} />
              {i < DS_STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-0.5 transition-colors ${i < currentIdx ? "bg-indigo-400" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        {DS_STEPS.map((step, i) => (
          <span key={step} className={`text-[9px] font-medium ${i === currentIdx ? "text-indigo-500" : "text-zinc-300"}`}>
            {DS_CONFIG[step].label.split(" ")[0]}
          </span>
        ))}
      </div>
      {order.driverName && (
        <p className="text-[10px] text-zinc-500 mt-2 flex items-center gap-1">
          <Truck size={9} /> Driver: <span className="font-semibold text-zinc-700">{order.driverName}</span>
        </p>
      )}
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function itemSummary(items: OrderLine[], max = 3) {
  const names = items.slice(0, max).map((i) => `${i.qty}× ${i.name}`);
  const extra = items.length - max;
  return extra > 0 ? [...names, `+${extra} more`].join(", ") : names.join(", ");
}

// ─── Reorder toast ────────────────────────────────────────────────────────────

interface ReorderResult { added: number; skipped: string[]; priceChanged: string[] }

function ReorderToast({ result, onClose }: { result: ReorderResult; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-start gap-3">
        <ShoppingCart size={18} className="text-zinc-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {result.added > 0
              ? `${result.added} item${result.added !== 1 ? "s" : ""} added to cart`
              : "No items could be added"}
          </p>
          {result.priceChanged.length > 0 && (
            <p className="text-xs text-amber-400 mt-0.5 truncate">
              Price updated: {result.priceChanged.join(", ")}
            </p>
          )}
          {result.skipped.length > 0 && (
            <p className="text-xs text-zinc-400 mt-0.5 truncate">
              Unavailable: {result.skipped.join(", ")}
            </p>
          )}
          {result.added > 0 && (
            <Link
              href="/"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-orange-400 hover:text-orange-300 transition"
            >
              <ShoppingCart size={11} /> Go to cart
            </Link>
          )}
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-white transition flex-shrink-0">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Quick Re-order section ───────────────────────────────────────────────────

function QuickReorder({
  orders,
  onReorder,
}: {
  orders: Order[];
  onReorder: (order: Order) => void;
}) {
  const eligible = orders
    .filter((o) => o.status === "delivered")
    .slice(0, 3);

  if (eligible.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-100 flex items-center gap-3">
        <div className="w-8 h-8 bg-zinc-100 rounded-xl flex items-center justify-center">
          <RotateCcw size={15} className="text-zinc-700" />
        </div>
        <div>
          <h3 className="font-bold text-zinc-900 text-sm">Quick Re-order</h3>
          <p className="text-xs text-zinc-400">Repeat a previous order with one click</p>
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        {eligible.map((order) => (
          <div key={order.id} className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-zinc-50 transition">
            {/* Icon */}
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-zinc-50 rounded-xl flex items-center justify-center flex-shrink-0 text-base sm:text-lg">
              🍛
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">
                {itemSummary(order.items, 2)}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-xs text-zinc-400">{formatDate(order.date)}</span>
                <span className="text-zinc-300 text-xs">·</span>
                <span className="text-xs font-semibold text-zinc-700 tabular-nums">£{order.total.toFixed(2)}</span>
              </div>
            </div>

            {/* Re-order button */}
            <button
              onClick={() => onReorder(order)}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3 py-2.5 rounded-xl transition flex-shrink-0 min-h-[38px]"
            >
              <RotateCcw size={12} />
              <span className="hidden sm:inline">Re-order</span>
              <span className="sm:hidden">Order</span>
            </button>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100">
        <p className="text-xs text-zinc-400 flex items-center gap-1.5">
          <AlertCircle size={11} className="text-zinc-300" />
          Items are added at current menu prices. Unavailable items are skipped.
        </p>
      </div>
    </div>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────

function OrderCard({ order, onReorder }: { order: Order; onReorder: (o: Order) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = !["delivered", "cancelled", "refunded", "partially_refunded"].includes(order.status);
  const canReorder = ["delivered", "refunded", "partially_refunded"].includes(order.status);

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${isActive ? "border-zinc-200" : "border-zinc-100"}`}>
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start justify-between p-4 sm:p-5 text-left hover:bg-zinc-50 transition"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-800 text-sm">#{order.id.slice(0, 8).toUpperCase()}</span>
            <StatusBadge order={order} />
            {isActive && (
              <span className="text-[10px] font-semibold bg-zinc-50 text-zinc-700 border border-zinc-200 rounded-full px-2 py-0.5">
                Live
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            {formatDate(order.date)} at {formatTime(order.date)} · {order.fulfillment === "delivery" ? "Delivery" : "Collection"}
          </p>
          {isActive && <OrderTracker order={order} />}
          <DeliveryTracker order={order} />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <span className="font-bold text-zinc-900 tabular-nums">£{order.total.toFixed(2)}</span>
          {expanded ? <ChevronUp size={16} className="text-zinc-400" /> : <ChevronDown size={16} className="text-zinc-400" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-zinc-100 px-4 sm:px-5 py-4 bg-zinc-50 space-y-2">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Items</p>
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between gap-3 text-sm">
              <span className="text-zinc-600 min-w-0 flex-1">
                <span className="font-medium text-gray-800">{item.qty}×</span> {item.name}
              </span>
              <span className="font-medium text-gray-800 flex-shrink-0 tabular-nums">£{(item.price * item.qty).toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t border-zinc-200 mt-3 pt-3 flex justify-between font-bold text-zinc-900 text-sm">
            <span>Total</span>
            <span className="tabular-nums">£{order.total.toFixed(2)}</span>
          </div>
          {order.address && (
            <p className="text-xs text-zinc-400 mt-2 break-words">
              Delivered to: <span className="text-zinc-600">{order.address}</span>
            </p>
          )}
          {order.note && (
            <p className="text-xs text-red-400 mt-1 italic break-words">{order.note}</p>
          )}

          {/* Re-order button in expanded view */}
          {canReorder && (
            <div className="pt-3 border-t border-zinc-200">
              <button
                onClick={() => onReorder(order)}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-3 rounded-xl transition"
              >
                <RotateCcw size={15} />
                Re-order this meal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Favourites Tab ───────────────────────────────────────────────────────────

function FavouritesTab() {
  const { currentUser, menuItems, toggleFavourite, isOpen, scheduledTime } = useApp();
  const [modalItem, setModalItem] = useState<MenuItem | null>(null);

  const favouriteIds = currentUser?.favourites ?? [];
  const favouriteItems = favouriteIds
    .map((id) => menuItems.find((m) => m.id === id))
    .filter((m): m is MenuItem => m !== undefined);

  const canOrder = isOpen || !!scheduledTime;

  if (favouriteItems.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm py-16 text-center">
        <Heart size={40} className="mx-auto text-zinc-200 mb-3" />
        <p className="font-semibold text-zinc-400">No favourites yet</p>
        <p className="text-sm text-zinc-300 mt-1">Tap the heart icon on any menu item to save it here.</p>
        <Link href="/" className="mt-4 inline-flex items-center gap-1.5 text-sm text-zinc-700 font-semibold hover:underline">
          Browse the menu
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {favouriteItems.map((item) => {
          const outOfStock = resolveStock(item) === "out_of_stock";

          return (
            <div key={item.id} className="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden flex flex-col">
              {/* Image */}
              {item.image && (
                <div className={`relative w-full h-36 overflow-hidden ${outOfStock ? "grayscale opacity-60" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                  <button
                    onClick={() => toggleFavourite(item.id)}
                    className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 backdrop-blur-sm hover:bg-white shadow transition"
                    title="Remove from favourites"
                  >
                    <Heart size={14} className="text-red-500 fill-red-500" />
                  </button>
                </div>
              )}

              {/* Info */}
              <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 text-sm leading-snug">{item.name}</p>
                    {item.dietary.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.dietary.map((d) => (
                          <span key={d} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {!item.image && (
                    <button
                      onClick={() => toggleFavourite(item.id)}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full border border-red-200 hover:bg-red-50 transition"
                      title="Remove from favourites"
                    >
                      <Heart size={12} className="text-red-500 fill-red-500" />
                    </button>
                  )}
                </div>

                <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">{item.description}</p>

                <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
                  <span className="font-bold text-zinc-900 text-sm">£{item.price.toFixed(2)}</span>
                  {outOfStock ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 px-3 py-1.5 rounded-xl border border-red-100">
                      <PackageX size={12} /> Unavailable
                    </span>
                  ) : (
                    <button
                      disabled={!canOrder}
                      onClick={() => canOrder && setModalItem(item)}
                      className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition ${canOrder
                        ? "bg-orange-500 hover:bg-orange-600 text-white"
                        : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                        }`}
                    >
                      <Plus size={12} />
                      Add
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modalItem && (
        <ItemCustomizationModal item={modalItem} onClose={() => setModalItem(null)} />
      )}
    </>
  );
}

// ─── Addresses Tab ────────────────────────────────────────────────────────────

const LABEL_ICONS: Record<string, React.ReactNode> = {
  Home: <Home size={14} className="text-zinc-700" />,
  Work: <Briefcase size={14} className="text-blue-500" />,
};

function getLabelIcon(label: string) {
  return LABEL_ICONS[label] ?? <MapPin size={14} className="text-zinc-400" />;
}

const EMPTY_FORM: Omit<SavedAddress, "id" | "createdAt" | "isDefault"> = {
  label: "Home", address: "", postcode: "", phone: "", note: "",
};

function AddressesTab() {
  const { currentUser, addSavedAddress, updateSavedAddress, deleteSavedAddress, setDefaultAddress } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null); // null = adding new
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<SavedAddress, "id" | "createdAt" | "isDefault">>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY_FORM, string>>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!currentUser) return null;
  const user = currentUser; // narrowed — safe to use inside closures

  const addresses = user.savedAddresses ?? [];

  function validate() {
    const e: Partial<Record<keyof typeof EMPTY_FORM, string>> = {};
    if (!form.label.trim()) e.label = "Label is required.";
    if (!form.address.trim()) e.address = "Address is required.";
    if (!form.postcode.trim()) e.postcode = "Postcode is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setShowForm(true);
  }

  function openEdit(addr: SavedAddress) {
    setEditingId(addr.id);
    setForm({ label: addr.label, address: addr.address, postcode: addr.postcode, phone: addr.phone ?? "", note: addr.note ?? "" });
    setErrors({});
    setShowForm(true);
  }

  function handleSave() {
    if (!validate()) return;
    if (editingId) {
      const existing = addresses.find((a) => a.id === editingId)!;
      updateSavedAddress(user.id, { ...existing, ...form });
    } else {
      addSavedAddress(user.id, {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        isDefault: addresses.length === 0,
        ...form,
      });
    }
    setShowForm(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleDelete(id: string) {
    deleteSavedAddress(user.id, id);
    setDeleteConfirm(null);
  }

  function field(key: keyof typeof EMPTY_FORM, label: string, opts?: { type?: string; placeholder?: string }) {
    return (
      <div>
        <label className="block text-xs font-medium text-zinc-500 mb-1">{label}</label>
        <input
          type={opts?.type ?? "text"}
          value={form[key]}
          onChange={(e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setErrors((er) => ({ ...er, [key]: undefined })); }}
          placeholder={opts?.placeholder}
          className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 transition ${errors[key] ? "border-red-400" : "border-zinc-200"}`}
        />
        {errors[key] && <p className="text-xs text-red-500 mt-1">{errors[key]}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {saved && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-700 font-medium">
          <Check size={14} /> Address saved successfully
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5 space-y-4">
          <h3 className="font-semibold text-zinc-900 text-sm">
            {editingId ? "Edit address" : "Add new address"}
          </h3>

          {/* Label quick-select */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">Label</label>
            <div className="flex gap-2 mb-2">
              {["Home", "Work", "Other"].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, label: l }))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${form.label === l
                    ? "bg-orange-500 border-orange-500 text-white"
                    : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                    }`}
                >
                  {l === "Home" ? <Home size={12} /> : l === "Work" ? <Briefcase size={12} /> : <MapPin size={12} />}
                  {l}
                </button>
              ))}
            </div>
            {!["Home", "Work", "Other"].includes(form.label) || form.label === "Other" ? (
              <input
                type="text"
                value={form.label === "Other" ? "" : form.label}
                onChange={(e) => { setForm((f) => ({ ...f, label: e.target.value || "Other" })); setErrors((er) => ({ ...er, label: undefined })); }}
                placeholder="Custom label…"
                className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 transition ${errors.label ? "border-red-400" : "border-zinc-200"}`}
              />
            ) : null}
            {errors.label && <p className="text-xs text-red-500 mt-1">{errors.label}</p>}
          </div>

          {field("address", "Full address", { placeholder: "42 Example Street, London" })}
          {field("postcode", "Postcode", { placeholder: "EC1A 1BB" })}
          {field("phone", "Phone (optional)", { type: "tel", placeholder: "+44 7700 900000" })}
          {field("note", "Delivery note (optional)", { placeholder: "Leave at front door…" })}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 rounded-xl text-sm transition"
            >
              {editingId ? "Update address" : "Save address"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 bg-zinc-100 hover:bg-gray-200 text-zinc-700 font-semibold rounded-xl text-sm transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Address list */}
      {addresses.length === 0 && !showForm ? (
        <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm py-14 text-center">
          <MapPin size={36} className="mx-auto text-zinc-200 mb-3" />
          <p className="font-semibold text-zinc-400">No saved addresses</p>
          <p className="text-sm text-zinc-300 mt-1">Save your delivery addresses for faster checkout.</p>
          <button
            onClick={openAdd}
            className="mt-4 inline-flex items-center gap-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl transition"
          >
            <Plus size={14} /> Add address
          </button>
        </div>
      ) : (
        <>
          {addresses.map((addr) => (
            <div key={addr.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${addr.isDefault ? "border-zinc-200" : "border-zinc-100"}`}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${addr.isDefault ? "bg-zinc-100" : "bg-zinc-100"}`}>
                      {getLabelIcon(addr.label)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-zinc-900 text-sm">{addr.label}</span>
                        {addr.isDefault && (
                          <span className="text-[10px] font-bold bg-zinc-100 text-zinc-700 rounded-full px-2 py-0.5 flex items-center gap-1">
                            <StarIcon size={9} className="fill-zinc-600" /> Default
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 mt-0.5 truncate">{addr.address}</p>
                      <p className="text-xs text-zinc-400">{addr.postcode}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(addr)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition"
                    >
                      <Edit2 size={13} />
                    </button>
                    {deleteConfirm === addr.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleDelete(addr.id)} className="text-xs font-bold text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition">Delete</button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-xs text-zinc-400 hover:text-zinc-600 px-2 py-1 rounded-lg transition">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(addr.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {(addr.phone || addr.note) && (
                  <div className="mt-3 pt-3 border-t border-gray-50 space-y-1">
                    {addr.phone && (
                      <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                        <Phone size={11} className="text-zinc-300" /> {addr.phone}
                      </p>
                    )}
                    {addr.note && (
                      <p className="text-xs text-zinc-500 flex items-center gap-1.5 italic">
                        <AlertCircle size={11} className="text-zinc-300" /> {addr.note}
                      </p>
                    )}
                  </div>
                )}

                {!addr.isDefault && (
                  <button
                    onClick={() => setDefaultAddress(user.id, addr.id)}
                    className="mt-3 text-xs text-zinc-700 hover:text-zinc-700 font-semibold transition"
                  >
                    Set as default
                  </button>
                )}
              </div>
            </div>
          ))}

          {!showForm && (
            <button
              onClick={openAdd}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-zinc-200 hover:border-zinc-400 text-zinc-400 hover:text-zinc-700 font-semibold text-sm py-4 rounded-2xl transition"
            >
              <Plus size={16} /> Add new address
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Change Password Card ─────────────────────────────────────────────────────

function ChangePasswordCard() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  function reset() {
    setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    setShowCurrent(false); setShowNew(false);
    setError(""); setSuccess(false);
  }

  function handleToggle() {
    if (open) reset();
    setOpen((v) => !v);
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) { setError("New password must be at least 6 characters."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setSuccess(true);
        reset();
        setTimeout(() => { setOpen(false); setSuccess(false); }, 2500);
      } else {
        setError(json.error ?? "Failed to change password.");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const pwdInputCls = "w-full border border-zinc-200 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 transition";

  return (
    <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 sm:px-6 py-5 hover:bg-zinc-50 transition text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-zinc-100 rounded-xl flex items-center justify-center">
            <ShieldCheck size={15} className="text-zinc-700" />
          </div>
          <div>
            <p className="font-semibold text-zinc-900 text-sm">Change password</p>
            <p className="text-xs text-zinc-400 mt-0.5">Update your account password</p>
          </div>
        </div>
        {open
          ? <X size={16} className="text-zinc-400 flex-shrink-0" />
          : <Lock size={16} className="text-zinc-400 flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="border-t border-zinc-100 px-4 sm:px-6 pb-6 pt-4">
          {success ? (
            <div className="flex items-center gap-2.5 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 font-medium">
              <Check size={15} className="flex-shrink-0" /> Password updated successfully
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Current password */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">Current password</label>
                <div className="relative">
                  <input
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => { setCurrentPassword(e.target.value); setError(""); }}
                    placeholder="Your current password"
                    required
                    autoComplete="current-password"
                    className={pwdInputCls}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition"
                    tabIndex={-1}
                  >
                    {showCurrent ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">New password</label>
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                    placeholder="Min. 6 characters"
                    required
                    autoComplete="new-password"
                    className={pwdInputCls}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition"
                    tabIndex={-1}
                  >
                    {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">Confirm new password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                  placeholder="Repeat new password"
                  required
                  autoComplete="new-password"
                  className="w-full border border-zinc-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 transition"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={loading || !currentPassword || !newPassword || !confirmPassword}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl text-sm transition"
                >
                  {loading ? "Updating…" : "Update password"}
                </button>
                <button
                  type="button"
                  onClick={handleToggle}
                  className="px-4 py-2.5 bg-zinc-100 hover:bg-gray-200 text-zinc-700 font-semibold rounded-xl text-sm transition"
                >
                  Cancel
                </button>
              </div>

              <p className="text-center text-xs text-zinc-400">
                Forgot your password?{" "}
                <Link href="/login?action=forgot" className="text-zinc-700 font-semibold hover:underline">
                  Reset via email
                </Link>
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab() {
  const { currentUser, updateCustomer } = useApp();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: currentUser?.name ?? "", phone: currentUser?.phone ?? "" });
  const [saved, setSaved] = useState(false);

  if (!currentUser) return null;

  function handleSave() {
    if (!currentUser) return;
    updateCustomer({ ...currentUser, name: form.name, phone: form.phone });
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleCancel() {
    setForm({ name: currentUser?.name ?? "", phone: currentUser?.phone ?? "" });
    setEditing(false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-zinc-900">Personal details</h3>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-sm text-zinc-700 hover:text-zinc-700 font-medium transition"
            >
              <Edit2 size={14} /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={handleCancel} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600 transition">
                <X size={14} /> Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg transition"
              >
                <Check size={14} /> Save
              </button>
            </div>
          )}
        </div>

        {saved && (
          <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-700 font-medium">
            <Check size={14} /> Profile updated successfully
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">Full name</label>
            {editing ? (
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-zinc-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 transition"
              />
            ) : (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-50 rounded-xl">
                <User size={15} className="text-zinc-400 flex-shrink-0" />
                <span className="text-sm text-gray-800">{currentUser.name}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">Email address</label>
            <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-50 rounded-xl min-w-0">
              <Mail size={15} className="text-zinc-400 flex-shrink-0" />
              <span className="text-sm text-gray-800 truncate flex-1 min-w-0">{currentUser.email}</span>
              <span className="flex-shrink-0 text-[10px] text-zinc-400 bg-zinc-100 rounded-full px-2 py-0.5 whitespace-nowrap">Cannot change</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">Phone number</label>
            {editing ? (
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full border border-zinc-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 transition"
              />
            ) : (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-50 rounded-xl">
                <Phone size={15} className="text-zinc-400 flex-shrink-0" />
                <span className="text-sm text-gray-800">{currentUser.phone || "—"}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">Member since</label>
            <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-50 rounded-xl">
              <Calendar size={15} className="text-zinc-400 flex-shrink-0" />
              <span className="text-sm text-gray-800">{formatDate(currentUser.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>

      <ChangePasswordCard />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AccountPage() {
  return (
    <Suspense>
      <AccountPageContent />
    </Suspense>
  );
}

const VALID_TABS = ["orders", "favourites", "addresses", "profile"] as const;
type TabId = typeof VALID_TABS[number];

function AccountPageContent() {
  const { currentUser, customers, addToCart, menuItems, refreshCurrentUser, settings, logout } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [authModal, setAuthModal] = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const urlTab = searchParams.get("tab");
  const initialTab: TabId = (VALID_TABS as readonly string[]).includes(urlTab ?? "") ? urlTab as TabId : "orders";

  const [tab, setTab] = useState<TabId>(initialTab);

  function handleTabChange(t: TabId) {
    setTab(t);
    router.replace(t === "orders" ? "/account" : `/account?tab=${t}`, { scroll: false });
    window.dispatchEvent(new CustomEvent("account-tab-change", { detail: { tab: t } }));
  }

  const [showAuth, setShowAuth] = useState(false);
  const [reorderToast, setReorderToast] = useState<ReorderResult | null>(null);
  const [updateBanner, setUpdateBanner] = useState<string | null>(null);
  // True while the server fetch is in-flight so we show a skeleton instead of
  // the "No orders yet" empty state before data has arrived.
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);

  // Sync fresh orders from the server whenever the logged-in user changes.
  // Using currentUser?.id as the dep (not []) so this also fires when currentUser
  // goes from null → set (cold page load where auth session resolves after mount).
  useEffect(() => {
    if (!currentUser) { setIsLoadingOrders(false); return; }
    setIsLoadingOrders(true);
    refreshCurrentUser().finally(() => setIsLoadingOrders(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]); // re-runs on login/logout, not on every render

  // Poll every 15 s while viewing the orders tab — graceful fallback if Realtime drops.
  useEffect(() => {
    if (!currentUser?.id || tab !== "orders") return;
    const id = setInterval(() => refreshCurrentUser().catch(() => { }), 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, tab]);

  // Re-fetch when the browser tab becomes visible — catches updates missed while away.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && currentUser && tab === "orders") {
        refreshCurrentUser().catch(() => { });
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, tab]);

  // ── Cross-tab status-change indicator ─────────────────────────────────────
  // Watches both `order.status` (kitchen lifecycle) and `order.deliveryStatus`
  // (driver delivery leg). When either changes in another tab the storage event
  // updates `customers` in AppContext; we surface a contextual banner.
  const prevStatusMapRef = useRef<Record<string, OrderStatus>>({});
  const prevDeliveryMapRef = useRef<Record<string, DeliveryStatus | undefined>>({});

  useEffect(() => {
    if (!currentUser) return;

    const prevS = prevStatusMapRef.current;
    const prevD = prevDeliveryMapRef.current;
    let banner: string | null = null;

    currentUser.orders.forEach((o) => {
      // Kitchen status change
      if (prevS[o.id] !== undefined && prevS[o.id] !== o.status) {
        const label = STATUS_CONFIG[o.status]?.label ?? o.status;
        banner = `Your order is now ${label}`;
      }
      prevS[o.id] = o.status;

      // Delivery status change — takes priority over kitchen status message
      if (prevD[o.id] !== undefined && prevD[o.id] !== o.deliveryStatus && o.deliveryStatus) {
        const ds = o.deliveryStatus;
        banner =
          ds === "on_the_way" ? "🚴 Your driver is on the way!" :
            ds === "picked_up" ? "📦 Your order has been picked up" :
              ds === "assigned" ? "🏍️ A driver has been assigned to your order" :
                ds === "delivered" ? "✅ Your order has been delivered!" :
                  banner;
      }
      prevD[o.id] = o.deliveryStatus;
    });

    if (banner) {
      setUpdateBanner(banner);
      const t = setTimeout(() => setUpdateBanner(null), 6000);
      return () => clearTimeout(t);
    }
  }, [currentUser]);

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-zinc-100 p-10 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <User size={28} className="text-zinc-700" />
          </div>
          <h1 className="text-xl font-bold text-zinc-900 mb-2">Sign in to your account</h1>
          <p className="text-sm text-zinc-400 mb-6">View your orders, track deliveries, and manage your profile.</p>
          <button
            onClick={() => setShowAuth(true)}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition text-sm"
          >
            Sign in or Register
          </button>
          <Link href="/" className="mt-4 flex items-center justify-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-600 transition">
            Back to menu
          </Link>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  // Profile-level fields (storeCredit, tags, savedAddresses) come from the
  // customers state which the Realtime subscription keeps fresh.
  // Orders always come from currentUser which is updated by both optimistic
  // writes and the Realtime handler — never stale from the anon-key init fetch.
  const liveUser = customers.find((c) => c.id === currentUser.id) ?? currentUser;

  const orders = [...currentUser.orders].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const activeOrders = orders.filter((o) => !["delivered", "cancelled"].includes(o.status));
  const totalSpent = orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.total, 0);

  const itemCounts: Record<string, number> = {};
  orders.forEach((o) => o.items.forEach((i) => { itemCounts[i.name] = (itemCounts[i.name] ?? 0) + i.qty; }));
  const favourite = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  // ── Re-order handler ───────────────────────────────────────────────────────
  function handleReorder(order: Order) {
    const added: string[] = [];
    const skipped: string[] = [];
    const priceChanged: string[] = [];

    order.items.forEach((line) => {
      // Match by menuItemId first (preferred), fall back to name
      const menuItem = line.menuItemId
        ? menuItems.find((m) => m.id === line.menuItemId)
        : menuItems.find((m) => m.name.toLowerCase() === line.name.toLowerCase());

      if (!menuItem) {
        skipped.push(line.name);
        return;
      }

      if (resolveStock(menuItem) === "out_of_stock") {
        skipped.push(line.name);
        return;
      }

      // Resolve variation — verify it still exists in the current menu item
      let selectedVariation: CartItem["selectedVariation"];
      let variationPrice = 0;
      if (line.selectedVariation) {
        const variation = menuItem.variations?.find(
          (v) => v.id === line.selectedVariation!.variationId
        );
        const option = variation?.options.find(
          (o) => o.id === line.selectedVariation!.optionId
        );
        if (variation && option) {
          selectedVariation = { variationId: variation.id, optionId: option.id, label: option.label };
          variationPrice = option.price;
        }
      }

      // Resolve add-ons — keep only those still present in the menu item
      let selectedAddOns: CartItem["selectedAddOns"];
      let addOnsTotal = 0;
      if (line.selectedAddOns?.length) {
        const currentAddOns = menuItem.addOns ?? [];
        const resolved = line.selectedAddOns
          .map((saved) => currentAddOns.find((a) => a.id === saved.id))
          .filter((a): a is AddOn => a != null);
        if (resolved.length > 0) {
          selectedAddOns = resolved;
          addOnsTotal = resolved.reduce((s, a) => s + a.price, 0);
        }
      }

      const currentPrice = menuItem.price + variationPrice + addOnsTotal;
      if (Math.abs(currentPrice - line.price) > 0.005) {
        priceChanged.push(line.name);
      }

      addToCart({
        id: crypto.randomUUID(),
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: currentPrice,
        quantity: line.qty,
        selectedVariation,
        selectedAddOns,
        specialInstructions: line.specialInstructions,
      });
      added.push(line.name);
    });

    setReorderToast({ added: added.length, skipped, priceChanged });
    setTimeout(() => setReorderToast(null), 6000);

    if (added.length > 0) {
      router.push("/");
    }
  }

  return (
    <>
      <div className="h-full flex overflow-hidden" style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif', backgroundColor: 'var(--brand-bg, #FAFAF9)' }}>

        {/* ── Main content area ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 h-full">

          {/* Top search header */}
          <header className="hidden lg:flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-b border-zinc-200/70 bg-white flex-shrink-0">
            {/* Mobile: logo */}
            <div className="lg:hidden flex items-center gap-2 flex-shrink-0">
              {settings.restaurant.logoImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={settings.restaurant.logoImage} alt={settings.restaurant.name}
                  className="w-8 h-8 rounded-xl object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[14px] font-bold">
                  {settings.restaurant.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Search */}
            <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-100 max-w-xl">
              <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dishes…"
                className="flex-1 bg-transparent outline-none text-[13.5px] text-zinc-900 placeholder:text-zinc-400"
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-[11px] font-medium text-zinc-400 hover:text-zinc-700 transition-colors">
                  Clear
                </button>
              )}
            </div>

            {/* Auth / user (desktop) */}
            <div className="hidden lg:flex items-center gap-2">
              {currentUser ? (
                <div className="relative">
                  <button
                    onClick={() => setUserMenuOpen((o) => !o)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 transition-colors"
                  >
                    <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-[11px] font-bold">
                      {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
                    </div>
                    <span className="text-[13px] font-medium text-zinc-700">{currentUser.name?.split(" ")[0]}</span>
                  </button>
                  {userMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl border border-zinc-200/70 shadow-lg z-20 overflow-hidden py-1">
                        <Link href="/account" onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50 transition-colors">
                          <LayoutDashboard className="w-4 h-4" strokeWidth={1.6} />Account
                        </Link>
                        <button onClick={() => { logout(); setUserMenuOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors">
                          <LogOut className="w-4 h-4" strokeWidth={1.6} />Sign out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button onClick={() => setAuthModal({ open: true, tab: "login" })}
                  className="px-4 py-2 rounded-xl bg-orange-500 text-white text-[13px] font-medium hover:bg-orange-600 transition-colors">
                  Sign in
                </button>
              )}
            </div>

          </header>
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto pb-28 lg:pb-8">

            <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-8 pb-8 sm:pb-12 space-y-4 sm:space-y-6">
              {/* Profile banner */}
              <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-2xl p-4 sm:p-6 text-white shadow-lg">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-xl sm:text-2xl font-bold text-white">{liveUser.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h1 className="text-lg sm:text-xl font-bold truncate">{liveUser.name}</h1>
                    <p className="text-zinc-300 text-xs sm:text-sm truncate">{liveUser.email}</p>
                    {liveUser.tags.length > 0 && (
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {liveUser.tags.map((tag) => (
                          <span key={tag} className="text-[10px] font-bold bg-white/20 text-white rounded-full px-2 py-0.5">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className={`grid gap-3 sm:gap-4 ${(liveUser.storeCredit ?? 0) > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}>
                <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-4 sm:p-5">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                    <ShoppingBag size={14} className="text-zinc-700 flex-shrink-0" />
                    <span className="text-[11px] sm:text-xs font-medium text-zinc-500 truncate">Total orders</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-zinc-900 tabular-nums">{orders.length}</p>
                </div>
                <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-4 sm:p-5">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                    <TrendingUp size={14} className="text-zinc-700 flex-shrink-0" />
                    <span className="text-[11px] sm:text-xs font-medium text-zinc-500 truncate">Total spent</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold text-zinc-900 tabular-nums">£{totalSpent.toFixed(2)}</p>
                </div>
                {favourite ? (
                  <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-4 sm:p-5 col-span-2 sm:col-span-1">
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                      <Star size={14} className="text-zinc-700 flex-shrink-0" />
                      <span className="text-[11px] sm:text-xs font-medium text-zinc-500 truncate">Most ordered</span>
                    </div>
                    <p className="text-sm font-bold text-zinc-900 leading-snug line-clamp-2">{favourite}</p>
                  </div>
                ) : null}

                {/* Store credit stat card — only when balance > 0 */}
                {(liveUser.storeCredit ?? 0) > 0 && (
                  <div className="bg-teal-500 rounded-2xl p-4 sm:p-5 col-span-2 sm:col-span-1">
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                      <Gift size={14} className="text-teal-100 flex-shrink-0" />
                      <span className="text-[11px] sm:text-xs font-medium text-teal-100 truncate">Store credit</span>
                    </div>
                    <p className="text-xl sm:text-2xl font-bold text-white tabular-nums">£{(liveUser.storeCredit ?? 0).toFixed(2)}</p>
                    <p className="text-[10px] text-teal-200 mt-1">Auto-applied at checkout</p>
                  </div>
                )}
              </div>

              {/* Store credit action banner */}
              {(liveUser.storeCredit ?? 0) > 0 && (
                <div className="flex items-start gap-3 sm:gap-4 bg-teal-50 border border-teal-200 rounded-2xl px-4 sm:px-5 py-4">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 bg-teal-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Gift size={16} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-teal-800">
                      You have <span className="text-teal-600 tabular-nums">£{(liveUser.storeCredit ?? 0).toFixed(2)}</span> store credit
                    </p>
                    <p className="text-xs text-teal-600 mt-0.5 leading-relaxed">
                      Automatically applied at checkout. Toggle on/off before paying.
                    </p>
                  </div>
                </div>
              )}

              {/* Active orders alert */}
              {activeOrders.length > 0 && (
                <div className="flex items-start gap-3 bg-zinc-50 border border-zinc-200 rounded-2xl px-4 sm:px-5 py-3.5 sm:py-4">
                  <Clock size={16} className="text-zinc-700 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-700">
                      {activeOrders.length} active order{activeOrders.length > 1 ? "s" : ""} in progress
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">Track your live orders in the Orders tab.</p>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-1 bg-zinc-100 p-1 rounded-xl overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                {(["orders", "favourites", "addresses", "profile"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => handleTabChange(t)}
                    className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-[13px] sm:text-sm font-semibold transition-all whitespace-nowrap flex-shrink-0 ${tab === t ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                      }`}
                  >
                    {t === "orders" ? <Package size={14} /> :
                      t === "favourites" ? <Heart size={14} /> :
                        t === "addresses" ? <MapPin size={14} /> :
                          <User size={14} />}
                    {t === "orders" ? "Orders" :
                      t === "favourites" ? "Favourites" :
                        t === "addresses" ? "Addresses" : "Profile"}
                    {t === "orders" && orders.length > 0 && (
                      <span className="ml-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {orders.length > 99 ? "99+" : orders.length}
                      </span>
                    )}
                    {t === "favourites" && (liveUser.favourites?.length ?? 0) > 0 && (
                      <span className="ml-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {liveUser.favourites!.length}
                      </span>
                    )}
                    {t === "addresses" && (liveUser.savedAddresses?.length ?? 0) > 0 && (
                      <span className="ml-0.5 bg-blue-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                        {liveUser.savedAddresses!.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {tab === "orders" && (
                <div className="space-y-4">
                  {isLoadingOrders && orders.length === 0 ? (
                    /* Skeleton shown while the first server fetch is in-flight */
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="bg-white rounded-2xl border border-zinc-100 shadow-sm p-5 animate-pulse">
                          <div className="flex items-center justify-between mb-3">
                            <div className="h-4 w-24 bg-zinc-100 rounded-full" />
                            <div className="h-5 w-20 bg-zinc-100 rounded-full" />
                          </div>
                          <div className="h-3 w-40 bg-zinc-100 rounded-full mb-2" />
                          <div className="h-3 w-28 bg-zinc-100 rounded-full" />
                        </div>
                      ))}
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-zinc-100 shadow-sm py-16 text-center">
                      <ShoppingBag size={40} className="mx-auto text-zinc-200 mb-3" />
                      <p className="font-semibold text-zinc-400">No orders yet</p>
                      <p className="text-sm text-zinc-300 mt-1">Your order history will appear here.</p>
                      <Link href="/" className="mt-4 inline-flex items-center gap-1.5 text-sm text-zinc-700 font-semibold hover:underline">
                        Browse the menu
                      </Link>
                    </div>
                  ) : (
                    <>
                      {/* Quick re-order section */}
                      <QuickReorder orders={orders} onReorder={handleReorder} />

                      {/* Full order history */}
                      <div className="space-y-3">
                        {orders.map((order) => (
                          <OrderCard key={order.id} order={order} onReorder={handleReorder} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === "favourites" && <FavouritesTab />}
              {tab === "addresses" && <AddressesTab />}
              {tab === "profile" && <ProfileTab />}
            </div>

            {/* Re-order toast */}
            {reorderToast && (
              <ReorderToast result={reorderToast} onClose={() => setReorderToast(null)} />
            )}

            {/* Order status update banner (cross-tab real-time sync) */}
            {updateBanner && !reorderToast && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
                <div className={`text-white rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-3 ${updateBanner.includes("on the way") ? "bg-indigo-600" :
                  updateBanner.includes("delivered") ? "bg-green-600" :
                    updateBanner.includes("picked up") ? "bg-blue-600" :
                      updateBanner.includes("driver") ? "bg-amber-600" :
                        "bg-gray-900"
                  }`}>
                  <span className="text-lg flex-shrink-0">
                    {updateBanner.startsWith("🚴") ? "🚴" :
                      updateBanner.startsWith("📦") ? "📦" :
                        updateBanner.startsWith("🏍️") ? "🏍️" :
                          updateBanner.startsWith("✅") ? "✅" : <RefreshCw size={16} />}
                  </span>
                  <p className="text-sm font-semibold flex-1">{updateBanner.replace(/^[^ ]+ /, "")}</p>
                  <button
                    onClick={() => setUpdateBanner(null)}
                    className="text-white/60 hover:text-white transition flex-shrink-0"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Mobile Bottom Nav ── */}
        <MobileBottomNav
          onCartOpen={() => setShowMobileCart(true)}
          onAuth={() => setAuthModal({ open: true, tab: "login" })}
        />

        {/* ── Mobile Cart Drawer ── */}
        {showMobileCart && (
          <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileCart(false)} />
            <div className="relative bg-white rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
              <CartPanel
                onMobileClose={() => setShowMobileCart(false)}
                onOrderPlaced={() => { setShowMobileCart(false); router.push('/my-orders'); }}
              />
            </div>
          </div>
        )}

        {authModal.open && (
          <AuthModal
            initialTab={authModal.tab}
            onClose={() => setAuthModal({ open: false, tab: "login" })}
          />
        )}

      </div>
    </>
  );
}
