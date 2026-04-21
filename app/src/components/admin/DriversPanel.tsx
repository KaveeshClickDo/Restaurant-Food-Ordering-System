"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import type { Driver, Order } from "@/types";
import {
  UserPlus, Pencil, Trash2, Car, Phone, Mail,
  CheckCircle2, XCircle, Truck, Package, User,
  ChevronDown, ChevronUp, AlertCircle, X,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function avatarColor(id: string) {
  const colors = [
    "bg-orange-500", "bg-blue-500", "bg-purple-500",
    "bg-green-500",  "bg-pink-500",  "bg-indigo-500",
  ];
  const idx = id.split("").reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return colors[idx];
}

// ─── Driver Form ──────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "", email: "", phone: "", password: "",
  vehicleInfo: "", notes: "", active: true,
};

function DriverForm({
  initial,
  existingEmails,
  onSave,
  onCancel,
}: {
  initial?: Partial<typeof EMPTY_FORM>;
  existingEmails: string[];
  onSave: (data: typeof EMPTY_FORM) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPwd, setShowPwd] = useState(false);

  function set(k: keyof typeof EMPTY_FORM, v: string | boolean) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim())   e.name  = "Name is required.";
    if (!form.email.trim())  e.email = "Email is required.";
    else if (existingEmails.includes(form.email.toLowerCase()))
      e.email = "A driver with this email already exists.";
    if (!form.phone.trim())  e.phone = "Phone is required.";
    if (!form.password.trim() || form.password.length < 6)
      e.password = "Password must be at least 6 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (validate()) onSave(form);
  }

  const field = (
    key: keyof typeof EMPTY_FORM,
    label: string,
    opts?: { type?: string; placeholder?: string; optional?: boolean },
  ) => (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label}{opts?.optional && <span className="text-gray-400 font-normal ml-1">(optional)</span>}
      </label>
      <input
        type={opts?.type ?? "text"}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value)}
        placeholder={opts?.placeholder}
        className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition ${
          errors[key]
            ? "border-red-300 focus:ring-red-400"
            : "border-gray-200 focus:ring-orange-400"
        }`}
      />
      {errors[key] && <p className="text-xs text-red-500 mt-1">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("name",  "Full name",     { placeholder: "Jane Driver" })}
        {field("phone", "Phone number",  { placeholder: "+44 7700 900000" })}
        {field("email", "Email address", { placeholder: "jane@example.com", type: "email" })}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Password</label>
          <div className="relative">
            <input
              type={showPwd ? "text" : "password"}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="Min. 6 characters"
              className={`w-full border rounded-xl px-3 py-2.5 text-sm pr-16 focus:outline-none focus:ring-2 transition ${
                errors.password ? "border-red-300 focus:ring-red-400" : "border-gray-200 focus:ring-orange-400"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-700 font-medium"
            >
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>
          {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
        </div>
        {field("vehicleInfo", "Vehicle info", { placeholder: "Red Honda Civic – AB12 CDE", optional: true })}
        {field("notes", "Admin notes", { placeholder: "Any internal notes", optional: true })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => set("active", !form.active)}
          className={`relative w-10 h-5.5 rounded-full transition-colors ${form.active ? "bg-green-500" : "bg-gray-300"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.active ? "left-5" : "left-0.5"}`} />
        </button>
        <span className="text-sm text-gray-600 font-medium">{form.active ? "Active" : "Inactive"}</span>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition"
        >
          Save Driver
        </button>
        <button
          onClick={onCancel}
          className="border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Driver Row ───────────────────────────────────────────────────────────────

function DriverRow({
  driver,
  activeOrderCount,
  onEdit,
  onDelete,
  onToggle,
}: {
  driver: Driver;
  activeOrderCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={`bg-white border rounded-2xl px-4 py-3.5 flex items-center gap-4 ${
      driver.active ? "border-gray-100" : "border-gray-100 opacity-60"
    }`}>
      {/* Avatar */}
      <div className={`w-10 h-10 rounded-xl ${avatarColor(driver.id)} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
        {initials(driver.name)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900 text-sm">{driver.name}</p>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            driver.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}>
            {driver.active ? "Active" : "Inactive"}
          </span>
          {activeOrderCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
              {activeOrderCount} on delivery
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-500 flex items-center gap-1"><Phone size={10} />{driver.phone}</span>
          <span className="text-xs text-gray-500 flex items-center gap-1"><Mail size={10} />{driver.email}</span>
          {driver.vehicleInfo && (
            <span className="text-xs text-gray-500 flex items-center gap-1"><Car size={10} />{driver.vehicleInfo}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={onToggle}
          title={driver.active ? "Deactivate" : "Activate"}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
        >
          {driver.active ? <CheckCircle2 size={16} className="text-green-500" /> : <XCircle size={16} />}
        </button>
        <button
          onClick={onEdit}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50 transition"
        >
          <Pencil size={14} />
        </button>
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onDelete}
              className="text-xs bg-red-500 hover:bg-red-600 text-white font-bold px-2.5 py-1 rounded-lg transition"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Unassigned Order Card ────────────────────────────────────────────────────

function UnassignedOrderCard({
  order,
  customerName,
  customerId,
  drivers,
  onAssign,
}: {
  order: Order;
  customerName: string;
  customerId: string;
  drivers: Driver[];
  onAssign: (customerId: string, orderId: string, driverId: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const activeDrivers = drivers.filter((d) => d.active);

  return (
    <div className="bg-white border border-orange-200 rounded-2xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-gray-900 text-sm">#{order.id.slice(-8).toUpperCase()}</p>
          <span className="text-xs text-gray-500">{customerName}</span>
        </div>
        {order.address && (
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1 truncate">
            <Package size={10} /> {order.address}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">{order.items.length} item{order.items.length !== 1 ? "s" : ""} · £{order.total.toFixed(2)}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {activeDrivers.length === 0 ? (
          <p className="text-xs text-red-500 font-semibold">No active drivers</p>
        ) : (
          <>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            >
              <option value="">Select driver…</option>
              {activeDrivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <button
              disabled={!selected}
              onClick={() => { if (selected) onAssign(customerId, order.id, selected); }}
              className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-bold px-4 py-2 rounded-xl transition"
            >
              Assign
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Active Delivery Card ─────────────────────────────────────────────────────

const DELIVERY_STATUS_CONFIG = {
  assigned:    { label: "Assigned",    color: "bg-amber-100 text-amber-700" },
  picked_up:   { label: "Picked Up",  color: "bg-blue-100 text-blue-700" },
  on_the_way:  { label: "On the Way", color: "bg-indigo-100 text-indigo-700" },
  delivered:   { label: "Delivered",  color: "bg-green-100 text-green-700" },
} as const;

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function DriversPanel() {
  const {
    drivers, customers,
    addDriver, updateDriver, deleteDriver, toggleDriver,
    assignDriverToOrder,
  } = useApp();

  const [showForm, setShowForm]       = useState(false);
  const [editDriver, setEditDriver]   = useState<Driver | null>(null);
  const [showActive, setShowActive]   = useState(true);
  const [apiError, setApiError]       = useState("");

  // Flatten all orders for driver-related lookups
  const allOrders = customers.flatMap((c) =>
    c.orders.map((o) => ({ ...o, customerName: c.name, customerId: c.id }))
  );

  // Unassigned: ready delivery orders with no driver
  const unassigned = allOrders.filter(
    (o) =>
      o.status === "ready" &&
      o.fulfillment === "delivery" &&
      !o.driverId,
  );

  // Active deliveries: assigned / picked_up / on_the_way
  const activeDeliveries = allOrders.filter(
    (o) =>
      o.deliveryStatus &&
      ["assigned", "picked_up", "on_the_way"].includes(o.deliveryStatus),
  );

  // Per-driver active order count
  function driverActiveCount(driverId: string) {
    return activeDeliveries.filter((o) => o.driverId === driverId).length;
  }

  // Stats
  const total    = drivers.length;
  const active   = drivers.filter((d) => d.active).length;
  const onDelivery = new Set(activeDeliveries.map((o) => o.driverId)).size;

  async function handleAdd(form: typeof EMPTY_FORM) {
    setApiError("");
    try {
      await addDriver(form);
      setShowForm(false);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to add driver.");
    }
  }

  async function handleEdit(form: typeof EMPTY_FORM) {
    if (!editDriver) return;
    setApiError("");
    try {
      await updateDriver(editDriver.id, form);
      setEditDriver(null);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to update driver.");
    }
  }

  const existingEmails = drivers
    .filter((d) => d.id !== editDriver?.id)
    .map((d) => d.email.toLowerCase());

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total drivers",   value: total,      icon: <User size={16} />,       color: "text-gray-600"  },
          { label: "Active",          value: active,     icon: <CheckCircle2 size={16} />,color: "text-green-600" },
          { label: "Inactive",        value: total - active, icon: <XCircle size={16} />, color: "text-gray-400"  },
          { label: "On delivery",     value: onDelivery, icon: <Truck size={16} />,       color: "text-orange-600"},
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className={`${color} flex-shrink-0`}>{icon}</div>
            <div>
              <p className="text-xl font-extrabold text-gray-900 leading-none">{value}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Unassigned orders alert */}
      {unassigned.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
            <h3 className="font-bold text-amber-800 text-sm">
              {unassigned.length} order{unassigned.length !== 1 ? "s" : ""} awaiting driver assignment
            </h3>
          </div>
          <div className="space-y-2">
            {unassigned.map((o) => (
              <UnassignedOrderCard
                key={o.id}
                order={o}
                customerName={o.customerName}
                customerId={o.customerId}
                drivers={drivers}
                onAssign={assignDriverToOrder}
              />
            ))}
          </div>
        </div>
      )}

      {/* Active deliveries */}
      {activeDeliveries.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowActive((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 transition"
          >
            <div className="flex items-center gap-2">
              <Truck size={15} className="text-orange-500" />
              <span className="font-bold text-gray-900 text-sm">Active deliveries</span>
              <span className="bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {activeDeliveries.length}
              </span>
            </div>
            {showActive ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
          </button>
          {showActive && (
            <div className="divide-y divide-gray-50">
              {activeDeliveries.map((o) => {
                const ds = o.deliveryStatus as keyof typeof DELIVERY_STATUS_CONFIG;
                const cfg = DELIVERY_STATUS_CONFIG[ds];
                return (
                  <div key={o.id} className="px-5 py-3 flex items-center gap-3">
                    <div className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${cfg.color}`}>
                      {cfg.label}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        #{o.id.slice(-8).toUpperCase()} — {o.customerName}
                      </p>
                      {o.address && <p className="text-xs text-gray-400 truncate">{o.address}</p>}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1 flex-shrink-0">
                      <Car size={11} />
                      {o.driverName ?? "Unknown"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Driver management */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-sm">Drivers</h3>
          {!showForm && !editDriver && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition"
            >
              <UserPlus size={13} /> Add Driver
            </button>
          )}
        </div>

        <div className="p-4 space-y-3">
          {apiError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{apiError}</p>
            </div>
          )}
          {showForm && (
            <DriverForm
              existingEmails={existingEmails}
              onSave={handleAdd}
              onCancel={() => setShowForm(false)}
            />
          )}

          {drivers.length === 0 && !showForm ? (
            <div className="text-center py-12 text-gray-400">
              <User size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No drivers yet</p>
              <p className="text-xs mt-1">Add your first delivery driver above.</p>
            </div>
          ) : (
            drivers.map((driver) =>
              editDriver?.id === driver.id ? (
                <DriverForm
                  key={driver.id}
                  initial={editDriver}
                  existingEmails={existingEmails}
                  onSave={handleEdit}
                  onCancel={() => setEditDriver(null)}
                />
              ) : (
                <DriverRow
                  key={driver.id}
                  driver={driver}
                  activeOrderCount={driverActiveCount(driver.id)}
                  onEdit={() => { setShowForm(false); setEditDriver(driver); setApiError(""); }}
                  onDelete={() => { deleteDriver(driver.id).catch((e) => setApiError(e.message)); }}
                  onToggle={() => { toggleDriver(driver.id, !driver.active).catch((e) => setApiError(e.message)); }}
                />
              )
            )
          )}
        </div>
      </div>

      {/* Info callout */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4 text-sm text-blue-700 space-y-1">
        <p className="font-bold text-blue-800">Driver access</p>
        <p>Drivers log in at <span className="font-mono font-semibold">/driver/login</span> using their email and password. They can only see orders assigned to them and update their own delivery status.</p>
      </div>
    </div>
  );
}
