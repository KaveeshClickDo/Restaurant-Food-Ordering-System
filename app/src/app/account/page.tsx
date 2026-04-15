"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  User, Mail, Phone, Calendar, ShoppingBag, TrendingUp, Clock,
  ChevronDown, ChevronUp, LogOut, ArrowLeft, Star, Package,
  Edit2, Check, X, RotateCcw, ShoppingCart, AlertCircle, RefreshCw,
  Heart, Plus, PackageX, MapPin, Home, Briefcase, Trash2, Star as StarIcon, Truck,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { Order, OrderLine, OrderStatus, DeliveryStatus, MenuItem, SavedAddress } from "@/types";
import AuthModal from "@/components/AuthModal";
import ItemCustomizationModal from "@/components/ItemCustomizationModal";
import { resolveStock } from "@/lib/stockUtils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; dot: string }> = {
  pending:   { label: "Pending",   color: "bg-yellow-100 text-yellow-700",  dot: "bg-yellow-500"  },
  confirmed: { label: "Confirmed", color: "bg-blue-100 text-blue-700",      dot: "bg-blue-500"    },
  preparing: { label: "Preparing", color: "bg-orange-100 text-orange-700",  dot: "bg-orange-500"  },
  ready:     { label: "Ready",     color: "bg-purple-100 text-purple-700",  dot: "bg-purple-500"  },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-700",    dot: "bg-green-500"   },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700",        dot: "bg-red-400"     },
};

const STEPS: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "delivered"];

function StatusBadge({ status }: { status: OrderStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function OrderTracker({ status }: { status: OrderStatus }) {
  if (status === "cancelled") return null;
  const currentIdx = STEPS.indexOf(status);
  return (
    <div className="flex items-center gap-1 mt-3">
      {STEPS.map((step, i) => {
        const done = i <= currentIdx;
        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors ${done ? "bg-orange-500" : "bg-gray-200"}`} />
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-0.5 transition-colors ${i < currentIdx ? "bg-orange-500" : "bg-gray-200"}`} />
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
  assigned:   { label: "Driver assigned",    emoji: "🏍️", color: "text-amber-600",  pulse: false },
  picked_up:  { label: "Order picked up",    emoji: "📦", color: "text-blue-600",   pulse: false },
  on_the_way: { label: "Driver on the way",  emoji: "🚴", color: "text-indigo-600", pulse: true  },
  delivered:  { label: "Order delivered",    emoji: "✅", color: "text-green-600",  pulse: false },
};

function DeliveryTracker({ order }: { order: Order }) {
  const ds = order.deliveryStatus;
  if (!ds || order.fulfillment !== "delivery") return null;

  const currentIdx = DS_STEPS.indexOf(ds);
  const cfg = DS_CONFIG[ds];

  return (
    <div className={`mt-3 rounded-xl px-3 py-2.5 border ${
      ds === "on_the_way" ? "bg-indigo-50 border-indigo-200" :
      ds === "delivered"  ? "bg-green-50 border-green-200"   :
      ds === "picked_up"  ? "bg-blue-50 border-blue-200"     :
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
              <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-all ${
                active ? "bg-indigo-500 ring-2 ring-indigo-200 scale-125" :
                done   ? "bg-indigo-400" : "bg-gray-200"
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
          <span key={step} className={`text-[9px] font-medium ${i === currentIdx ? "text-indigo-500" : "text-gray-300"}`}>
            {DS_CONFIG[step].label.split(" ")[0]}
          </span>
        ))}
      </div>
      {order.driverName && (
        <p className="text-[10px] text-gray-500 mt-2 flex items-center gap-1">
          <Truck size={9} /> Driver: <span className="font-semibold text-gray-700">{order.driverName}</span>
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

interface ReorderResult { added: number; skipped: string[] }

function ReorderToast({ result, onClose }: { result: ReorderResult; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-start gap-3">
        <ShoppingCart size={18} className="text-orange-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {result.added} item{result.added !== 1 ? "s" : ""} added to cart
          </p>
          {result.skipped.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              Unavailable: {result.skipped.join(", ")}
            </p>
          )}
          <Link
            href="/"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-orange-400 hover:text-orange-300 transition"
          >
            <ShoppingCart size={11} /> Go to cart
          </Link>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition flex-shrink-0">
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-8 h-8 bg-orange-100 rounded-xl flex items-center justify-center">
          <RotateCcw size={15} className="text-orange-600" />
        </div>
        <div>
          <h3 className="font-bold text-gray-900 text-sm">Quick Re-order</h3>
          <p className="text-xs text-gray-400">Repeat a previous order with one click</p>
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        {eligible.map((order) => (
          <div key={order.id} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition">
            {/* Icon */}
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0 text-lg">
              🍛
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">
                {itemSummary(order.items)}
              </p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs text-gray-400">{formatDate(order.date)}</span>
                <span className="text-gray-300 text-xs">·</span>
                <span className="text-xs text-gray-400 capitalize">{order.fulfillment}</span>
                <span className="text-gray-300 text-xs">·</span>
                <span className="text-xs font-semibold text-gray-700">£{order.total.toFixed(2)}</span>
              </div>
            </div>

            {/* Re-order button */}
            <button
              onClick={() => onReorder(order)}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition flex-shrink-0"
            >
              <RotateCcw size={12} />
              Re-order
            </button>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
        <p className="text-xs text-gray-400 flex items-center gap-1.5">
          <AlertCircle size={11} className="text-gray-300" />
          Items are added at current menu prices. Unavailable items are skipped.
        </p>
      </div>
    </div>
  );
}

// ─── Order Card ───────────────────────────────────────────────────────────────

function OrderCard({ order, onReorder }: { order: Order; onReorder: (o: Order) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = !["delivered", "cancelled"].includes(order.status);
  const canReorder = order.status === "delivered";

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${isActive ? "border-orange-200" : "border-gray-100"}`}>
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start justify-between p-5 text-left hover:bg-gray-50 transition"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-800 text-sm">#{order.id.slice(0, 8).toUpperCase()}</span>
            <StatusBadge status={order.status} />
            {isActive && (
              <span className="text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-200 rounded-full px-2 py-0.5">
                Live
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {formatDate(order.date)} at {formatTime(order.date)} · {order.fulfillment === "delivery" ? "Delivery" : "Collection"}
          </p>
          {isActive && <OrderTracker status={order.status} />}
          <DeliveryTracker order={order} />
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <span className="font-bold text-gray-900">£{order.total.toFixed(2)}</span>
          {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Items</p>
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-gray-600">
                <span className="font-medium text-gray-800">{item.qty}×</span> {item.name}
              </span>
              <span className="font-medium text-gray-800">£{(item.price * item.qty).toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t border-gray-200 mt-3 pt-3 flex justify-between font-bold text-gray-900 text-sm">
            <span>Total</span>
            <span>£{order.total.toFixed(2)}</span>
          </div>
          {order.address && (
            <p className="text-xs text-gray-400 mt-2">
              Delivered to: <span className="text-gray-600">{order.address}</span>
            </p>
          )}
          {order.note && (
            <p className="text-xs text-red-400 mt-1 italic">{order.note}</p>
          )}

          {/* Re-order button in expanded view */}
          {canReorder && (
            <div className="pt-3 border-t border-gray-200">
              <button
                onClick={() => onReorder(order)}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl transition"
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
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
        <Heart size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="font-semibold text-gray-400">No favourites yet</p>
        <p className="text-sm text-gray-300 mt-1">Tap the heart icon on any menu item to save it here.</p>
        <Link href="/" className="mt-4 inline-flex items-center gap-1.5 text-sm text-orange-500 font-semibold hover:underline">
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
            <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
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
                    <p className="font-semibold text-gray-900 text-sm leading-snug">{item.name}</p>
                    {item.dietary.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.dietary.map((d) => (
                          <span key={d} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
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

                <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">{item.description}</p>

                <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
                  <span className="font-bold text-gray-900 text-sm">£{item.price.toFixed(2)}</span>
                  {outOfStock ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 px-3 py-1.5 rounded-xl border border-red-100">
                      <PackageX size={12} /> Unavailable
                    </span>
                  ) : (
                    <button
                      disabled={!canOrder}
                      onClick={() => canOrder && setModalItem(item)}
                      className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl transition ${
                        canOrder
                          ? "bg-orange-500 hover:bg-orange-600 text-white"
                          : "bg-gray-100 text-gray-400 cursor-not-allowed"
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
  Home:   <Home      size={14} className="text-orange-500" />,
  Work:   <Briefcase size={14} className="text-blue-500"   />,
};

function getLabelIcon(label: string) {
  return LABEL_ICONS[label] ?? <MapPin size={14} className="text-gray-400" />;
}

const EMPTY_FORM: Omit<SavedAddress, "id" | "createdAt" | "isDefault"> = {
  label: "Home", address: "", postcode: "", phone: "", note: "",
};

function AddressesTab() {
  const { currentUser, addSavedAddress, updateSavedAddress, deleteSavedAddress, setDefaultAddress } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null); // null = adding new
  const [showForm,  setShowForm]  = useState(false);
  const [form,      setForm]      = useState<Omit<SavedAddress, "id" | "createdAt" | "isDefault">>(EMPTY_FORM);
  const [errors,    setErrors]    = useState<Partial<Record<keyof typeof EMPTY_FORM, string>>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saved,     setSaved]     = useState(false);

  if (!currentUser) return null;
  const user = currentUser; // narrowed — safe to use inside closures

  const addresses = user.savedAddresses ?? [];

  function validate() {
    const e: Partial<Record<keyof typeof EMPTY_FORM, string>> = {};
    if (!form.label.trim())   e.label   = "Label is required.";
    if (!form.address.trim()) e.address  = "Address is required.";
    if (!form.postcode.trim())e.postcode = "Postcode is required.";
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
        <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
        <input
          type={opts?.type ?? "text"}
          value={form[key]}
          onChange={(e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setErrors((er) => ({ ...er, [key]: undefined })); }}
          placeholder={opts?.placeholder}
          className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition ${errors[key] ? "border-red-400" : "border-gray-200"}`}
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="font-semibold text-gray-900 text-sm">
            {editingId ? "Edit address" : "Add new address"}
          </h3>

          {/* Label quick-select */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Label</label>
            <div className="flex gap-2 mb-2">
              {["Home", "Work", "Other"].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, label: l }))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    form.label === l
                      ? "bg-orange-500 border-orange-500 text-white"
                      : "border-gray-200 text-gray-600 hover:border-orange-300"
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
                className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition ${errors.label ? "border-red-400" : "border-gray-200"}`}
              />
            ) : null}
            {errors.label && <p className="text-xs text-red-500 mt-1">{errors.label}</p>}
          </div>

          {field("address",  "Full address",  { placeholder: "42 Example Street, London" })}
          {field("postcode", "Postcode",       { placeholder: "EC1A 1BB" })}
          {field("phone",    "Phone (optional)", { type: "tel", placeholder: "+44 7700 900000" })}
          {field("note",     "Delivery note (optional)", { placeholder: "Leave at front door…" })}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 rounded-xl text-sm transition"
            >
              {editingId ? "Update address" : "Save address"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-sm transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Address list */}
      {addresses.length === 0 && !showForm ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-14 text-center">
          <MapPin size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="font-semibold text-gray-400">No saved addresses</p>
          <p className="text-sm text-gray-300 mt-1">Save your delivery addresses for faster checkout.</p>
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
            <div key={addr.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${addr.isDefault ? "border-orange-200" : "border-gray-100"}`}>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${addr.isDefault ? "bg-orange-100" : "bg-gray-100"}`}>
                      {getLabelIcon(addr.label)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm">{addr.label}</span>
                        {addr.isDefault && (
                          <span className="text-[10px] font-bold bg-orange-100 text-orange-600 rounded-full px-2 py-0.5 flex items-center gap-1">
                            <StarIcon size={9} className="fill-orange-500" /> Default
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mt-0.5 truncate">{addr.address}</p>
                      <p className="text-xs text-gray-400">{addr.postcode}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(addr)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition"
                    >
                      <Edit2 size={13} />
                    </button>
                    {deleteConfirm === addr.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleDelete(addr.id)} className="text-xs font-bold text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition">Delete</button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg transition">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(addr.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {(addr.phone || addr.note) && (
                  <div className="mt-3 pt-3 border-t border-gray-50 space-y-1">
                    {addr.phone && (
                      <p className="text-xs text-gray-500 flex items-center gap-1.5">
                        <Phone size={11} className="text-gray-300" /> {addr.phone}
                      </p>
                    )}
                    {addr.note && (
                      <p className="text-xs text-gray-500 flex items-center gap-1.5 italic">
                        <AlertCircle size={11} className="text-gray-300" /> {addr.note}
                      </p>
                    )}
                  </div>
                )}

                {!addr.isDefault && (
                  <button
                    onClick={() => setDefaultAddress(user.id, addr.id)}
                    className="mt-3 text-xs text-orange-500 hover:text-orange-600 font-semibold transition"
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
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 hover:border-orange-400 text-gray-400 hover:text-orange-500 font-semibold text-sm py-4 rounded-2xl transition"
            >
              <Plus size={16} /> Add new address
            </button>
          )}
        </>
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
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900">Personal details</h3>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-sm text-orange-500 hover:text-orange-600 font-medium transition"
            >
              <Edit2 size={14} /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={handleCancel} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition">
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
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Full name</label>
            {editing ? (
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
              />
            ) : (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 rounded-xl">
                <User size={15} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-800">{currentUser.name}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Email address</label>
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 rounded-xl">
              <Mail size={15} className="text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-800">{currentUser.email}</span>
              <span className="ml-auto text-[10px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">Cannot change</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Phone number</label>
            {editing ? (
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
              />
            ) : (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 rounded-xl">
                <Phone size={15} className="text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-800">{currentUser.phone || "—"}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Member since</label>
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 rounded-xl">
              <Calendar size={15} className="text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-800">{formatDate(currentUser.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AccountPage() {
  const { currentUser, customers, logout, addToCart, menuItems } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState<"orders" | "favourites" | "addresses" | "profile">("orders");
  const [showAuth, setShowAuth] = useState(false);
  const [reorderToast, setReorderToast] = useState<ReorderResult | null>(null);
  const [updateBanner, setUpdateBanner] = useState<string | null>(null);

  // ── Cross-tab status-change indicator ─────────────────────────────────────
  // Watches both `order.status` (kitchen lifecycle) and `order.deliveryStatus`
  // (driver delivery leg). When either changes in another tab the storage event
  // updates `customers` in AppContext; we surface a contextual banner.
  const prevStatusMapRef   = useRef<Record<string, OrderStatus>>({});
  const prevDeliveryMapRef = useRef<Record<string, DeliveryStatus | undefined>>({});

  useEffect(() => {
    if (!currentUser) return;
    const liveCustomer = customers.find((c) => c.id === currentUser.id);
    if (!liveCustomer) return;

    const prevS = prevStatusMapRef.current;
    const prevD = prevDeliveryMapRef.current;
    let banner: string | null = null;

    liveCustomer.orders.forEach((o) => {
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
          ds === "picked_up"  ? "📦 Your order has been picked up" :
          ds === "assigned"   ? "🏍️ A driver has been assigned to your order" :
          ds === "delivered"  ? "✅ Your order has been delivered!" :
          banner;
      }
      prevD[o.id] = o.deliveryStatus;
    });

    if (banner) {
      setUpdateBanner(banner);
      const t = setTimeout(() => setUpdateBanner(null), 6000);
      return () => clearTimeout(t);
    }
  }, [customers, currentUser]);

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <User size={28} className="text-orange-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Sign in to your account</h1>
          <p className="text-sm text-gray-400 mb-6">View your orders, track deliveries, and manage your profile.</p>
          <button
            onClick={() => setShowAuth(true)}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition text-sm"
          >
            Sign in or Register
          </button>
          <Link href="/" className="mt-4 flex items-center justify-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition">
            <ArrowLeft size={14} /> Back to menu
          </Link>
        </div>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </div>
    );
  }

  // ── Always read the live customer record from the customers array ───────────
  // currentUser is set as a snapshot at login — reading from customers ensures
  // orders placed after login (and status updates from the admin panel) are visible.
  const liveUser = customers.find((c) => c.id === currentUser.id) ?? currentUser;

  const orders = [...liveUser.orders].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const activeOrders  = orders.filter((o) => !["delivered", "cancelled"].includes(o.status));
  const totalSpent    = orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.total, 0);

  const itemCounts: Record<string, number> = {};
  orders.forEach((o) => o.items.forEach((i) => { itemCounts[i.name] = (itemCounts[i.name] ?? 0) + i.qty; }));
  const favourite = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  // ── Re-order handler ───────────────────────────────────────────────────────
  function handleReorder(order: Order) {
    const added: string[] = [];
    const skipped: string[] = [];

    order.items.forEach((line) => {
      const menuItem = menuItems.find(
        (m) => m.name.toLowerCase() === line.name.toLowerCase()
      );
      if (menuItem) {
        addToCart({
          id: crypto.randomUUID(),
          menuItemId: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: line.qty,
        });
        added.push(line.name);
      } else {
        skipped.push(line.name);
      }
    });

    setReorderToast({ added: added.length, skipped });
    setTimeout(() => setReorderToast(null), 5000);

    // Navigate to menu so customer can review cart and checkout
    router.push("/");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
            <ArrowLeft size={15} /> Menu
          </Link>
          <span className="text-gray-200">|</span>
          <span className="font-semibold text-gray-900 text-sm">My Account</span>
          <div className="ml-auto">
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-500 transition"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-8 space-y-6">
        {/* Profile banner */}
        <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl p-4 sm:p-6 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-2xl font-bold text-white">{liveUser.name.charAt(0).toUpperCase()}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold truncate">{liveUser.name}</h1>
              <p className="text-orange-100 text-sm truncate">{liveUser.email}</p>
              {liveUser.tags.length > 0 && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingBag size={16} className="text-orange-500" />
              <span className="text-xs font-medium text-gray-500">Total orders</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{orders.length}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={16} className="text-orange-500" />
              <span className="text-xs font-medium text-gray-500">Total spent</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">£{totalSpent.toFixed(2)}</p>
          </div>
          {favourite ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2 mb-1">
                <Star size={16} className="text-orange-500" />
                <span className="text-xs font-medium text-gray-500">Most ordered</span>
              </div>
              <p className="text-sm font-bold text-gray-900 leading-snug">{favourite}</p>
            </div>
          ) : null}
        </div>

        {/* Active orders alert */}
        {activeOrders.length > 0 && (
          <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-2xl px-5 py-4">
            <Clock size={18} className="text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">
                {activeOrders.length} active order{activeOrders.length > 1 ? "s" : ""} in progress
              </p>
              <p className="text-xs text-orange-600 mt-0.5">Track your live orders below in the Orders tab.</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl flex-wrap">
          {(["orders", "favourites", "addresses", "profile"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "orders"     ? <Package  size={14} /> :
               t === "favourites" ? <Heart    size={14} /> :
               t === "addresses"  ? <MapPin   size={14} /> :
                                    <User     size={14} />}
              {t === "orders"     ? "Orders"     :
               t === "favourites" ? "Favourites" :
               t === "addresses"  ? "Addresses"  : "Profile"}
              {t === "orders" && orders.length > 0 && (
                <span className="ml-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {orders.length}
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
            {orders.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
                <ShoppingBag size={40} className="mx-auto text-gray-200 mb-3" />
                <p className="font-semibold text-gray-400">No orders yet</p>
                <p className="text-sm text-gray-300 mt-1">Your order history will appear here.</p>
                <Link href="/" className="mt-4 inline-flex items-center gap-1.5 text-sm text-orange-500 font-semibold hover:underline">
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
        {tab === "addresses"  && <AddressesTab />}
        {tab === "profile"    && <ProfileTab />}
      </div>

      {/* Re-order toast */}
      {reorderToast && (
        <ReorderToast result={reorderToast} onClose={() => setReorderToast(null)} />
      )}

      {/* Order status update banner (cross-tab real-time sync) */}
      {updateBanner && !reorderToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
          <div className={`text-white rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-3 ${
            updateBanner.includes("on the way") ? "bg-indigo-600" :
            updateBanner.includes("delivered")  ? "bg-green-600"  :
            updateBanner.includes("picked up")  ? "bg-blue-600"   :
            updateBanner.includes("driver")     ? "bg-amber-600"  :
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
  );
}
