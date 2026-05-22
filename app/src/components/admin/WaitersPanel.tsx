"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WaiterStaff } from "@/types";
import {
  UserPlus, Pencil, Trash2, Users,
  CheckCircle2, XCircle, Eye, EyeOff, Save, X,
  AlertCircle,
} from "lucide-react";

// Table CRUD lives in the dedicated "Tables" panel (TableStatusPanel) so the
// admin manages dining tables and watches their live status from one place.
// This panel only handles waiter accounts now.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "#7c3aed", "#0891b2", "#16a34a", "#dc2626",
  "#ea580c", "#d97706", "#9333ea", "#0284c7",
];

// ─── Waiter Form ──────────────────────────────────────────────────────────────

const EMPTY_WAITER: Omit<WaiterStaff, "id" | "createdAt"> = {
  name: "", pin: "", role: "waiter", active: true, avatarColor: AVATAR_COLORS[0],
};

function WaiterForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<typeof EMPTY_WAITER> & { id?: string };
  onSave: (data: typeof EMPTY_WAITER) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [form, setForm]     = useState({ ...EMPTY_WAITER, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPin, setShowPin] = useState(false);
  // Guards against rapid double-click creating duplicate rows.
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  function set<K extends keyof typeof EMPTY_WAITER>(k: K, v: (typeof EMPTY_WAITER)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k as string]; return n; });
  }

  // In edit mode (initial.id set), PIN may be left blank to keep the existing
  // value — the server never returns real PINs to the browser, so there's no
  // way to pre-fill the field.
  const isEdit = Boolean(initial?.id);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required.";
    if (!isEdit && !form.pin.trim())  e.pin = "PIN is required.";
    else if (form.pin.trim() && !/^\d{4,6}$/.test(form.pin)) e.pin = "PIN must be 4–6 digits.";
    if (Object.keys(e).length) { setErrors(e); return false; }
    return true;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (inFlight.current) return;
    if (!validate()) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Alex"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500"
        />
        {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
      </div>

      {/* PIN */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          PIN (4–6 digits){isEdit ? " — leave blank to keep current" : ""}
        </label>
        <div className="relative">
          <input
            value={form.pin}
            onChange={(e) => set("pin", e.target.value.replace(/\D/g, "").slice(0, 6))}
            type={showPin ? "text" : "password"}
            placeholder={isEdit ? "Leave blank to keep current" : "••••"}
            inputMode="numeric"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-9 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500"
          />
          <button
            type="button"
            onClick={() => setShowPin((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {errors.pin && <p className="text-red-400 text-xs mt-1">{errors.pin}</p>}
      </div>

      {/* Role */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Role</label>
        <select
          value={form.role}
          onChange={(e) => set("role", e.target.value as "senior" | "waiter")}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
        >
          <option value="waiter">Waiter</option>
          <option value="senior">Senior / Head Waiter</option>
        </select>
      </div>

      {/* Avatar colour */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">Avatar Colour</label>
        <div className="flex gap-2 flex-wrap">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set("avatarColor", c)}
              className="w-7 h-7 rounded-full border-2 transition"
              style={{
                backgroundColor: c,
                borderColor: form.avatarColor === c ? "#fff" : "transparent",
                boxShadow: form.avatarColor === c ? `0 0 0 2px ${c}` : undefined,
              }}
            />
          ))}
        </div>
      </div>

      {/* Active */}
      <label className="flex items-center gap-2 cursor-pointer">
        <div
          onClick={() => set("active", !form.active)}
          className={`w-9 h-5 rounded-full transition relative flex-shrink-0 ${form.active ? "bg-green-500" : "bg-gray-600"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.active ? "translate-x-4" : "translate-x-0.5"}`} />
        </div>
        <span className="text-sm text-gray-300">{form.active ? "Active" : "Inactive"}</span>
      </label>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          <Save size={14} /> {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function WaitersPanel() {
  // DB-backed via /api/admin/waiters. Each mutation re-fetches; admin actions
  // are rare enough that optimistic updates aren't worth the complexity.
  const [waiters, setWaiters] = useState<WaiterStaff[]>([]);

  const refreshWaiters = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/waiters");
      if (!res.ok) return;
      const json = await res.json() as { ok: boolean; waiters?: WaiterStaff[] };
      if (json.ok) setWaiters(json.waiters ?? []);
    } catch { /* ignore — UI keeps last good list */ }
  }, []);

  useEffect(() => { refreshWaiters(); }, [refreshWaiters]);

  // Waiter state
  const [addingWaiter,   setAddingWaiter]   = useState(false);
  const [editingWaiter,  setEditingWaiter]  = useState<WaiterStaff | null>(null);
  const [deletingWaiter, setDeletingWaiter] = useState<string | null>(null);

  // ── Waiter CRUD ─────────────────────────────────────────────────────────────

  async function handleAddWaiter(data: Omit<WaiterStaff, "id" | "createdAt">) {
    const res = await fetch("/api/admin/waiters", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data),
    });
    if (res.ok) {
      await refreshWaiters();
      setAddingWaiter(false);
    }
  }

  async function handleEditWaiter(data: Omit<WaiterStaff, "id" | "createdAt">) {
    if (!editingWaiter) return;
    const res = await fetch(`/api/admin/waiters/${editingWaiter.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data),
    });
    if (res.ok) {
      await refreshWaiters();
      setEditingWaiter(null);
    }
  }

  // Per-row guards for toggle/delete double-clicks. Form submits already guard
  // themselves via the canonical inFlight pattern inside WaiterForm.
  const waiterRowInFlight = useRef<Set<string>>(new Set());

  async function handleDeleteWaiter(id: string) {
    if (waiterRowInFlight.current.has(id)) return;
    waiterRowInFlight.current.add(id);
    try {
      const res = await fetch(`/api/admin/waiters/${id}`, { method: "DELETE" });
      if (res.ok) {
        await refreshWaiters();
        setDeletingWaiter(null);
      }
    } finally {
      waiterRowInFlight.current.delete(id);
    }
  }

  async function toggleWaiterActive(id: string) {
    if (waiterRowInFlight.current.has(id)) return;
    const member = waiters.find((w) => w.id === id);
    if (!member) return;
    waiterRowInFlight.current.add(id);
    try {
      const res = await fetch(`/api/admin/waiters/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ active: !member.active }),
      });
      if (res.ok) await refreshWaiters();
    } finally {
      waiterRowInFlight.current.delete(id);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900 font-semibold">Waiter Accounts</h2>
          <p className="text-gray-500 text-xs mt-0.5">
            {waiters.length} staff · {waiters.filter((w) => w.active).length} active
          </p>
        </div>
        {!addingWaiter && !editingWaiter && (
          <button
            onClick={() => setAddingWaiter(true)}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            <UserPlus size={15} /> Add Staff
          </button>
        )}
      </div>

      {/* Add form */}
      {addingWaiter && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><UserPlus size={16} /> New Staff Member</h3>
          <WaiterForm
            onSave={handleAddWaiter}
            onCancel={() => setAddingWaiter(false)}
          />
        </div>
      )}

      {/* Staff list */}
      <div className="space-y-3">
        {waiters.length === 0 && !addingWaiter && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center">
            <Users size={32} className="text-gray-700 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No staff yet. Add your first waiter above.</p>
          </div>
        )}
        {waiters.map((waiter) => (
          <div key={waiter.id} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            {editingWaiter?.id === waiter.id ? (
              <div className="p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Pencil size={15} /> Edit {waiter.name}</h3>
                <WaiterForm
                  initial={waiter}
                  onSave={handleEditWaiter}
                  onCancel={() => setEditingWaiter(null)}
                />
              </div>
            ) : deletingWaiter === waiter.id ? (
              <div className="p-4 flex items-center gap-3 bg-red-950/30 border-t border-red-900/40">
                <AlertCircle size={18} className="text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-sm flex-1">Remove <strong>{waiter.name}</strong>? This cannot be undone.</p>
                <button
                  onClick={() => handleDeleteWaiter(waiter.id)}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                >
                  Delete
                </button>
                <button
                  onClick={() => setDeletingWaiter(null)}
                  className="text-gray-400 hover:text-white transition"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="p-4 flex items-center gap-3">
                {/* Avatar */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: waiter.avatarColor }}
                >
                  {initials(waiter.name)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium text-sm">{waiter.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      waiter.role === "senior"
                        ? "bg-purple-500/20 text-purple-300"
                        : "bg-blue-500/20 text-blue-300"
                    }`}>
                      {waiter.role === "senior" ? "Senior" : "Waiter"}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      waiter.active
                        ? "bg-green-500/20 text-green-300"
                        : "bg-gray-700 text-gray-400"
                    }`}>
                      {waiter.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="text-gray-500 text-xs mt-0.5">PIN: •••• · ID: {waiter.id}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0 sm:gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => toggleWaiterActive(waiter.id)}
                    title={waiter.active ? "Deactivate" : "Activate"}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition"
                  >
                    {waiter.active
                      ? <CheckCircle2 size={16} className="text-green-400" />
                      : <XCircle      size={16} className="text-gray-600"   />
                    }
                  </button>
                  <button
                    onClick={() => { setEditingWaiter(waiter); setAddingWaiter(false); }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition"
                  >
                    <Pencil size={15} className="text-gray-400" />
                  </button>
                  <button
                    onClick={() => setDeletingWaiter(waiter.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-500/10 transition"
                  >
                    <Trash2 size={15} className="text-gray-500 hover:text-red-400" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Info box */}
      <div className="bg-blue-950/60 border border-blue-700/60 rounded-xl p-4 text-blue-100 text-xs leading-relaxed">
        <strong className="block mb-1 text-white">PIN Security</strong>
        PINs are stored in admin settings and validated server-side at <code>/api/waiter/auth</code>.
        They are never exposed to the waiter app&apos;s network tab. Use unique PINs for each staff member.
      </div>
    </div>
  );
}
