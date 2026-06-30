"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  UserPlus, Pencil, Trash2, PackageCheck,
  CheckCircle2, XCircle, Eye, EyeOff, Save, X,
  AlertCircle, ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
// Flat collection-staff record (no roles/permissions). `password` is form-only — the
// server never returns it.
interface CollectionStaff {
  id:          string;
  name:        string;
  email?:      string;
  active:      boolean;
  avatarColor: string;
  createdAt?:  string;
  password?:        string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "#f97316", "#ea580c", "#d97706", "#16a34a",
  "#0891b2", "#2563eb", "#7c3aed", "#dc2626",
];

// ─── Staff Form ───────────────────────────────────────────────────────────────

type StaffFormData = { name: string; password: string; active: boolean; avatarColor: string };
const EMPTY: StaffFormData = {
  name: "", password: "", active: true, avatarColor: AVATAR_COLORS[0],
};

function StaffForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<StaffFormData> & { id?: string };
  onSave: (data: StaffFormData) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [form,    setForm]    = useState<StaffFormData>({ ...EMPTY, ...initial });
  const [errors,  setErrors]  = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const inFlight = useRef(false);

  function set<K extends keyof StaffFormData>(k: K, v: StaffFormData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k as string]; return n; });
  }

  // In edit mode the password field stays blank by default — the server never
  // returns real passwords, so blank means "keep existing".
  const isEdit = Boolean(initial?.id);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required.";
    if (!isEdit && !form.password.trim()) e.password = "Password is required.";
    else if (form.password.trim() && form.password.trim().length < 6) e.password = "Password must be at least 6 characters.";
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
          placeholder="e.g. Priya"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500"
        />
        {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
      </div>

      {/* password */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Password (min 6 characters){isEdit ? " — leave blank to keep current" : ""}
        </label>
        <div className="relative">
          <input
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            type={showPassword ? "text" : "password"}
            placeholder={isEdit ? "Leave blank to keep current" : "Min 6 characters"}
            autoComplete="new-password"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pr-9 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
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

export default function CollectionStaffPanel() {
  // DB-backed via /api/admin/collection-staff. Each mutation calls the REST
  // endpoint and re-fetches the list. The password field in the form sends the
  // value to the server for bcrypt-hashing; it's never returned from GET.
  const [staff, setStaff] = useState<CollectionStaff[]>([]);

  const refreshStaff = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/collection-staff");
      if (!res.ok) return;
      const json = await res.json() as { ok: boolean; collectionStaff?: CollectionStaff[] };
      if (json.ok) setStaff(json.collectionStaff ?? []);
    } catch { /* ignore — UI keeps last good list */ }
  }, []);

  useEffect(() => { refreshStaff(); }, [refreshStaff]);

  const [adding,   setAdding]   = useState(false);
  const [editing,  setEditing]  = useState<CollectionStaff | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const togglingIds = useRef<Set<string>>(new Set());
  const deletingIds = useRef<Set<string>>(new Set());

  async function handleAdd(data: StaffFormData) {
    const res = await fetch("/api/admin/collection-staff", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data),
    });
    if (res.ok) {
      await refreshStaff();
      setAdding(false);
    }
  }

  async function handleEdit(data: StaffFormData) {
    if (!editing) return;
    // Strip password if blank so the server keeps the existing hash.
    const payload = { ...data, password: data.password?.trim() ? data.password : undefined };
    const res = await fetch(`/api/admin/collection-staff/${editing.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (res.ok) {
      await refreshStaff();
      setEditing(null);
    }
  }

  async function handleDelete(id: string) {
    if (deletingIds.current.has(id)) return;
    deletingIds.current.add(id);
    try {
      const res = await fetch(`/api/admin/collection-staff/${id}`, { method: "DELETE" });
      if (res.ok) {
        await refreshStaff();
        setDeleting(null);
      }
    } finally {
      deletingIds.current.delete(id);
    }
  }

  async function toggleActive(id: string) {
    if (togglingIds.current.has(id)) return;
    const member = staff.find((s) => s.id === id);
    if (!member) return;
    togglingIds.current.add(id);
    try {
      const res = await fetch(`/api/admin/collection-staff/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ active: !member.active }),
      });
      if (res.ok) await refreshStaff();
    } finally {
      togglingIds.current.delete(id);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900 font-semibold">Collection Staff</h2>
          <p className="text-gray-500 text-xs mt-0.5">
            {staff.length} staff · {staff.filter((s) => s.active).length} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/collection"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium px-3 py-2 rounded-xl transition"
          >
            <ExternalLink size={13} /> Open Collection
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
            <UserPlus size={16} /> New Collection Staff Member
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
            <PackageCheck size={32} className="text-gray-700 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No collection staff yet. Add your first member above.</p>
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
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      member.active
                        ? "bg-green-500/20 text-green-300"
                        : "bg-gray-700 text-gray-400"
                    }`}>
                      {member.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="text-gray-500 text-xs mt-0.5">
                    Password: •••• · ID: {member.id}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0 sm:gap-1.5 flex-shrink-0">
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
        Collection staff log in at <code>/collection/login</code> using their password to take pickup payments and
        complete handovers. Sessions are signed HMAC cookies; passwords are bcrypt-hashed and validated
        server-side — never exposed in the browser. Deactivating a member signs them out on their next request.
      </div>
    </div>
  );
}
