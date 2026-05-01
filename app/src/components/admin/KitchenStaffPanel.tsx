"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import type { KitchenStaff, KitchenRole } from "@/types";
import {
  UserPlus, Pencil, Trash2, ChefHat,
  CheckCircle2, XCircle, Eye, EyeOff, Save, X,
  AlertCircle, ExternalLink,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "#dc2626", "#ea580c", "#d97706", "#16a34a",
  "#0891b2", "#2563eb", "#7c3aed", "#9333ea",
];

const ROLE_LABELS: Record<KitchenRole, string> = {
  chef:            "Chef",
  head_chef:       "Head Chef",
  kitchen_manager: "Kitchen Manager",
};

const ROLE_BADGE: Record<KitchenRole, string> = {
  chef:            "bg-orange-500/20 text-orange-300",
  head_chef:       "bg-red-500/20 text-red-300",
  kitchen_manager: "bg-purple-500/20 text-purple-300",
};

// ─── Staff Form ───────────────────────────────────────────────────────────────

const EMPTY: Omit<KitchenStaff, "id" | "createdAt"> = {
  name: "", pin: "", role: "chef", active: true, avatarColor: AVATAR_COLORS[0],
};

function StaffForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<typeof EMPTY>;
  onSave: (data: typeof EMPTY) => void;
  onCancel: () => void;
}) {
  const [form,    setForm]    = useState({ ...EMPTY, ...initial });
  const [errors,  setErrors]  = useState<Record<string, string>>({});
  const [showPin, setShowPin] = useState(false);

  function set<K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k as string]; return n; });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required.";
    if (!form.pin.trim())  e.pin  = "PIN is required.";
    else if (!/^\d{4,6}$/.test(form.pin)) e.pin = "PIN must be 4–6 digits.";
    if (Object.keys(e).length) { setErrors(e); return false; }
    return true;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Marco"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500"
        />
        {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
      </div>

      {/* PIN */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">PIN (4–6 digits)</label>
        <div className="relative">
          <input
            value={form.pin}
            onChange={(e) => set("pin", e.target.value.replace(/\D/g, "").slice(0, 6))}
            type={showPin ? "text" : "password"}
            placeholder="••••"
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
          onChange={(e) => set("role", e.target.value as KitchenRole)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
        >
          <option value="chef">Chef</option>
          <option value="head_chef">Head Chef</option>
          <option value="kitchen_manager">Kitchen Manager</option>
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

      {/* Active toggle */}
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
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          <Save size={14} /> Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function KitchenStaffPanel() {
  const { settings, updateSettings } = useApp();

  const staff = settings.kitchenStaff ?? [];

  const [adding,   setAdding]   = useState(false);
  const [editing,  setEditing]  = useState<KitchenStaff | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function handleAdd(data: Omit<KitchenStaff, "id" | "createdAt">) {
    const newMember: KitchenStaff = {
      ...data,
      id:        `k-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    updateSettings({ kitchenStaff: [...staff, newMember] });
    setAdding(false);
  }

  function handleEdit(data: Omit<KitchenStaff, "id" | "createdAt">) {
    if (!editing) return;
    updateSettings({
      kitchenStaff: staff.map((s) =>
        s.id === editing.id ? { ...s, ...data } : s
      ),
    });
    setEditing(null);
  }

  function handleDelete(id: string) {
    updateSettings({ kitchenStaff: staff.filter((s) => s.id !== id) });
    setDeleting(null);
  }

  function toggleActive(id: string) {
    updateSettings({
      kitchenStaff: staff.map((s) =>
        s.id === id ? { ...s, active: !s.active } : s
      ),
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold">Kitchen Staff</h2>
          <p className="text-gray-500 text-xs mt-0.5">
            {staff.length} staff · {staff.filter((s) => s.active).length} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/kitchen"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium px-3 py-2 rounded-xl transition"
          >
            <ExternalLink size={13} /> Open KDS
          </a>
          {!adding && !editing && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
            >
              <UserPlus size={15} /> Add Staff
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <UserPlus size={16} /> New Kitchen Staff Member
          </h3>
          <StaffForm
            onSave={handleAdd}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {/* Staff list */}
      <div className="space-y-3">
        {staff.length === 0 && !adding && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center">
            <ChefHat size={32} className="text-gray-700 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No kitchen staff yet. Add your first member above.</p>
          </div>
        )}

        {staff.map((member) => (
          <div key={member.id} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            {editing?.id === member.id ? (
              <div className="p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Pencil size={15} /> Edit {member.name}
                </h3>
                <StaffForm
                  initial={member}
                  onSave={handleEdit}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : deleting === member.id ? (
              <div className="p-4 flex items-center gap-3 bg-red-950/30 border-t border-red-900/40">
                <AlertCircle size={18} className="text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-sm flex-1">
                  Remove <strong>{member.name}</strong>? This cannot be undone.
                </p>
                <button
                  onClick={() => handleDelete(member.id)}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
                >
                  Delete
                </button>
                <button
                  onClick={() => setDeleting(null)}
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
                  style={{ backgroundColor: member.avatarColor }}
                >
                  {initials(member.name)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium text-sm">{member.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE[member.role]}`}>
                      {ROLE_LABELS[member.role]}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      member.active
                        ? "bg-green-500/20 text-green-300"
                        : "bg-gray-700 text-gray-400"
                    }`}>
                      {member.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="text-gray-500 text-xs mt-0.5">
                    PIN: {"•".repeat(member.pin.length)} · ID: {member.id}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => toggleActive(member.id)}
                    title={member.active ? "Deactivate" : "Activate"}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition"
                  >
                    {member.active
                      ? <CheckCircle2 size={16} className="text-green-400" />
                      : <XCircle      size={16} className="text-gray-600"  />
                    }
                  </button>
                  <button
                    onClick={() => { setEditing(member); setAdding(false); }}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-800 transition"
                  >
                    <Pencil size={15} className="text-gray-400" />
                  </button>
                  <button
                    onClick={() => setDeleting(member.id)}
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
        <strong className="block mb-1 text-white">How it works</strong>
        Kitchen staff log in at <code>/kitchen/login</code> using their PIN. Sessions are signed HMAC cookies
        valid for 30 days. PINs are stored in admin settings and validated server-side — never exposed
        in the browser&apos;s network tab. Each status update records the staff member&apos;s name in the order.
      </div>
    </div>
  );
}
