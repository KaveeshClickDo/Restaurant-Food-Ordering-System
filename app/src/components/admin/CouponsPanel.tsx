"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { Coupon, CouponType } from "@/types";
import {
  Tag, Plus, Pencil, Trash2, CheckCircle, X, Check,
  ToggleLeft, ToggleRight, AlertTriangle, Clock, Infinity,
  Percent, PoundSterling, ChevronDown, ChevronUp,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatValue(coupon: Coupon) {
  return coupon.type === "percentage"
    ? `${coupon.value}% off`
    : `£${coupon.value.toFixed(2)} off`;
}

function couponStatus(coupon: Coupon): "active" | "inactive" | "expired" | "exhausted" {
  if (!coupon.active) return "inactive";
  if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) return "expired";
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) return "exhausted";
  return "active";
}

function StatusBadge({ coupon }: { coupon: Coupon }) {
  const s = couponStatus(coupon);
  const styles = {
    active:    "bg-green-100 text-green-700 border-green-200",
    inactive:  "bg-gray-100 text-gray-500 border-gray-200",
    expired:   "bg-red-100 text-red-600 border-red-200",
    exhausted: "bg-amber-100 text-amber-700 border-amber-200",
  };
  const labels = { active: "Active", inactive: "Inactive", expired: "Expired", exhausted: "Limit reached" };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${styles[s]}`}>
      {s === "active" && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
      {labels[s]}
    </span>
  );
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Blank form state ─────────────────────────────────────────────────────────

type FormState = {
  code: string;
  type: CouponType;
  value: string;
  minOrderAmount: string;
  expiryDate: string;
  usageLimit: string;
  active: boolean;
};

function blankForm(base?: Coupon): FormState {
  return base
    ? {
        code: base.code,
        type: base.type,
        value: String(base.value),
        minOrderAmount: base.minOrderAmount > 0 ? String(base.minOrderAmount) : "",
        expiryDate: base.expiryDate ? base.expiryDate.slice(0, 10) : "",
        usageLimit: base.usageLimit > 0 ? String(base.usageLimit) : "",
        active: base.active,
      }
    : { code: "", type: "percentage", value: "", minOrderAmount: "", expiryDate: "", usageLimit: "", active: true };
}

function validateForm(f: FormState): string | null {
  const code = f.code.trim().toUpperCase();
  if (!code)                              return "Coupon code is required.";
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return "Code must be 2–20 characters (letters, numbers, dash, underscore).";
  const val = parseFloat(f.value);
  if (isNaN(val) || val <= 0)            return "Discount value must be a positive number.";
  if (f.type === "percentage" && val > 100) return "Percentage discount cannot exceed 100%.";
  const min = parseFloat(f.minOrderAmount);
  if (f.minOrderAmount && (isNaN(min) || min < 0)) return "Minimum order amount must be 0 or more.";
  const limit = parseInt(f.usageLimit);
  if (f.usageLimit && (isNaN(limit) || limit < 1)) return "Usage limit must be at least 1.";
  return null;
}

// ─── Create / Edit form ───────────────────────────────────────────────────────

function CouponForm({
  initial,
  existingCodes,
  onSave,
  onCancel,
}: {
  initial?: Coupon;
  existingCodes: string[];
  onSave: (data: Omit<Coupon, "id" | "usageCount" | "createdAt">) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(blankForm(initial));
  const [error, setError] = useState("");

  function p(patch: Partial<FormState>) {
    setForm((f) => ({ ...f, ...patch }));
    setError("");
  }

  function handleSubmit() {
    const err = validateForm(form);
    if (err) { setError(err); return; }

    const code = form.code.trim().toUpperCase();
    const isDuplicate = existingCodes
      .filter((c) => !initial || c !== initial.code)
      .includes(code);
    if (isDuplicate) { setError("A coupon with this code already exists."); return; }

    onSave({
      code,
      type: form.type,
      value: parseFloat(form.value),
      minOrderAmount: form.minOrderAmount ? parseFloat(form.minOrderAmount) : 0,
      expiryDate: form.expiryDate ? new Date(form.expiryDate).toISOString() : "",
      usageLimit: form.usageLimit ? parseInt(form.usageLimit) : 0,
      active: form.active,
    });
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-5 pb-5 pt-4 space-y-4">
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle size={14} className="flex-shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Code */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Coupon Code *</label>
          <input
            type="text"
            value={form.code}
            onChange={(e) => p({ code: e.target.value.toUpperCase().replace(/\s/g, "") })}
            placeholder="e.g. SAVE10"
            maxLength={20}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono tracking-widest uppercase placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition bg-white"
          />
          <p className="text-[11px] text-gray-400 mt-1">Letters, numbers, dash, underscore — 2–20 chars</p>
        </div>

        {/* Active toggle */}
        <div className="flex items-end gap-3 pb-0.5">
          <div className="flex-1">
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Status</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => p({ active: !form.active })}
                className={`transition-colors ${form.active ? "text-orange-500" : "text-gray-300 hover:text-gray-400"}`}
                role="switch" aria-checked={form.active}
              >
                {form.active ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
              </button>
              <span className={`text-sm font-semibold ${form.active ? "text-green-700" : "text-gray-400"}`}>
                {form.active ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>

        {/* Discount type */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Discount Type *</label>
          <div className="flex gap-2">
            {([
              { value: "percentage", label: "Percentage", icon: <Percent size={13} /> },
              { value: "fixed",      label: "Fixed (£)",  icon: <PoundSterling size={13} /> },
            ] as const).map(({ value, label, icon }) => (
              <button
                key={value}
                onClick={() => p({ type: value })}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border-2 text-sm font-semibold transition ${
                  form.type === value
                    ? "border-orange-500 bg-orange-50 text-orange-700"
                    : "border-gray-200 text-gray-600 hover:border-gray-300 bg-white"
                }`}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>

        {/* Discount value */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Discount Value * {form.type === "percentage" ? "(0–100%)" : "(£)"}
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
              {form.type === "percentage" ? "%" : "£"}
            </span>
            <input
              type="number"
              min="0"
              max={form.type === "percentage" ? 100 : undefined}
              step={form.type === "percentage" ? 1 : 0.01}
              value={form.value}
              onChange={(e) => p({ value: e.target.value })}
              placeholder={form.type === "percentage" ? "e.g. 10" : "e.g. 5.00"}
              className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition bg-white"
            />
          </div>
        </div>

        {/* Minimum order */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Minimum Order Amount (£)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">£</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.minOrderAmount}
              onChange={(e) => p({ minOrderAmount: e.target.value })}
              placeholder="e.g. 15.00 (leave blank for none)"
              className="w-full pl-8 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition bg-white"
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Leave blank for no minimum</p>
        </div>

        {/* Expiry date */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Expiry Date</label>
          <input
            type="date"
            value={form.expiryDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => p({ expiryDate: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition bg-white"
          />
          <p className="text-[11px] text-gray-400 mt-1">Leave blank to never expire</p>
        </div>

        {/* Usage limit */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Usage Limit</label>
          <input
            type="number"
            min="1"
            step="1"
            value={form.usageLimit}
            onChange={(e) => p({ usageLimit: e.target.value })}
            placeholder="e.g. 100 (leave blank for unlimited)"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition bg-white"
          />
          <p className="text-[11px] text-gray-400 mt-1">Leave blank for unlimited uses</p>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition"
        >
          <Check size={14} /> {initial ? "Update coupon" : "Create coupon"}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 border border-gray-200 text-gray-500 hover:text-gray-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Coupon row ───────────────────────────────────────────────────────────────

function CouponRow({
  coupon,
  existingCodes,
  onUpdate,
  onDelete,
  onToggle,
}: {
  coupon: Coupon;
  existingCodes: string[];
  onUpdate: (c: Coupon) => void;
  onDelete: () => void;
  onToggle: (active: boolean) => void;
}) {
  const [editing,    setEditing]    = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [expanded,  setExpanded]   = useState(false);
  const status = couponStatus(coupon);

  return (
    <div className={`rounded-2xl border-2 transition-colors overflow-hidden ${
      status === "active" ? "border-gray-100 bg-white" : "border-dashed border-gray-200 bg-gray-50/60"
    }`}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          coupon.type === "percentage" ? "bg-orange-100" : "bg-blue-100"
        }`}>
          {coupon.type === "percentage"
            ? <Percent size={16} className="text-orange-600" />
            : <PoundSterling size={16} className="text-blue-600" />}
        </div>

        {/* Code + value */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-gray-900 tracking-wider text-sm">{coupon.code}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              coupon.type === "percentage" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"
            }`}>{formatValue(coupon)}</span>
            <StatusBadge coupon={coupon} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
            {coupon.minOrderAmount > 0 && (
              <span>Min £{coupon.minOrderAmount.toFixed(2)}</span>
            )}
            <span className="flex items-center gap-1">
              {coupon.usageLimit > 0
                ? <><Clock size={10} /> {coupon.usageCount}/{coupon.usageLimit} uses</>
                : <><Infinity size={10} /> {coupon.usageCount} uses · unlimited</>}
            </span>
            {coupon.expiryDate && (
              <span className={new Date(coupon.expiryDate) < new Date() ? "text-red-400" : ""}>
                Expires {fmtDate(coupon.expiryDate)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Active toggle */}
          <button
            onClick={() => onToggle(!coupon.active)}
            className={`relative inline-flex items-center w-10 h-5 rounded-full transition-colors focus:outline-none ${
              coupon.active ? "bg-green-500" : "bg-gray-300"
            }`}
            role="switch" aria-checked={coupon.active}
          >
            <span className={`inline-block w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform ${
              coupon.active ? "translate-x-5" : "translate-x-0.5"
            }`} />
          </button>
          <button
            onClick={() => { setEditing((v) => !v); setExpanded(false); setConfirmDel(false); }}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-orange-100 hover:text-orange-600 text-gray-500 transition"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 transition"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded detail strip */}
      {expanded && !editing && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex gap-6 text-xs text-gray-600 flex-wrap">
            <span><span className="font-semibold">Type:</span> {coupon.type === "percentage" ? "Percentage" : "Fixed amount"}</span>
            <span><span className="font-semibold">Value:</span> {formatValue(coupon)}</span>
            <span><span className="font-semibold">Min order:</span> {coupon.minOrderAmount > 0 ? `£${coupon.minOrderAmount.toFixed(2)}` : "None"}</span>
            <span><span className="font-semibold">Limit:</span> {coupon.usageLimit > 0 ? `${coupon.usageLimit} uses` : "Unlimited"}</span>
            <span><span className="font-semibold">Used:</span> {coupon.usageCount} times</span>
            <span><span className="font-semibold">Expires:</span> {fmtDate(coupon.expiryDate)}</span>
          </div>
          {confirmDel ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600 font-semibold">Delete this coupon?</span>
              <button onClick={onDelete} className="text-xs bg-red-500 hover:bg-red-600 text-white font-bold px-3 py-1.5 rounded-lg transition">Yes, delete</button>
              <button onClick={() => setConfirmDel(false)} className="text-xs border border-gray-200 text-gray-500 font-semibold px-3 py-1.5 rounded-lg transition">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDel(true)}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 font-semibold border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition"
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <CouponForm
          initial={coupon}
          existingCodes={existingCodes}
          onSave={(data) => {
            onUpdate({ ...coupon, ...data });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function CouponsPanel() {
  const { coupons, addCoupon, updateCoupon, deleteCoupon, toggleCoupon } = useApp();
  const [creating, setCreating] = useState(false);
  const [saved,    setSaved]    = useState(false);

  const sorted    = [...coupons].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const activeCnt = coupons.filter((c) => couponStatus(c) === "active").length;
  const existingCodes = coupons.map((c) => c.code);

  function handleCreate(data: Omit<Coupon, "id" | "usageCount" | "createdAt">) {
    addCoupon({ ...data, id: crypto.randomUUID(), usageCount: 0, createdAt: new Date().toISOString() });
    setCreating(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Tag size={18} className="text-orange-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Coupon Codes</h2>
              <p className="text-xs text-gray-400">Create and manage discount coupons for customers</p>
            </div>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition ${
              creating
                ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                : saved
                ? "bg-green-100 text-green-700"
                : "bg-orange-500 hover:bg-orange-600 text-white"
            }`}
          >
            {creating ? <><X size={14} /> Cancel</> : saved ? <><CheckCircle size={14} /> Created!</> : <><Plus size={14} /> New coupon</>}
          </button>
        </div>

        {/* Create form */}
        {creating && (
          <CouponForm
            existingCodes={existingCodes}
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
          />
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total coupons",  value: coupons.length,                                        color: "text-gray-900" },
          { label: "Active",         value: activeCnt,                                              color: "text-green-700" },
          { label: "Inactive",       value: coupons.filter((c) => !c.active).length,                color: "text-gray-500" },
          { label: "Total redeemed", value: coupons.reduce((s, c) => s + c.usageCount, 0),          color: "text-orange-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3.5">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Coupon list */}
      {sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Tag size={22} className="text-gray-400" />
          </div>
          <p className="font-semibold text-gray-700">No coupons yet</p>
          <p className="text-sm text-gray-400 mt-1">Click <strong>New coupon</strong> above to create your first discount code.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((coupon) => (
            <CouponRow
              key={coupon.id}
              coupon={coupon}
              existingCodes={existingCodes}
              onUpdate={updateCoupon}
              onDelete={() => deleteCoupon(coupon.id)}
              onToggle={(active) => toggleCoupon(coupon.id, active)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
