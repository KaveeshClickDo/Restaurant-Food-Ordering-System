"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users, Plus, Search, Pencil, Key, Mail, Trash2,
  X, CheckCircle, AlertCircle, Loader2,
  Truck, UtensilsCrossed, UserCircle2, ChevronDown,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ManagedUser {
  id: string;
  type: "admin" | "customer" | "driver" | "waiter";
  name: string;
  email?: string;
  phone?: string;
  active: boolean;
  createdAt?: string;
  emailVerified?: boolean;
  pin?: string;
  waiterRole?: "senior" | "waiter";
  avatarColor?: string;
  vehicleInfo?: string;
  notes?: string;
}

type FilterRole = "all" | "admin" | "customer" | "driver" | "waiter";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

function roleColor(type: ManagedUser["type"], waiterRole?: "senior" | "waiter"): string {
  switch (type) {
    case "admin":    return "bg-purple-100 text-purple-700 border-purple-200";
    case "customer": return "bg-blue-100 text-blue-700 border-blue-200";
    case "driver":   return "bg-orange-100 text-orange-700 border-orange-200";
    case "waiter":
      return waiterRole === "senior"
        ? "bg-indigo-100 text-indigo-700 border-indigo-200"
        : "bg-teal-100 text-teal-700 border-teal-200";
  }
}

function roleLabel(type: ManagedUser["type"], waiterRole?: "senior" | "waiter"): string {
  switch (type) {
    case "admin":    return "Admin";
    case "customer": return "Customer";
    case "driver":   return "Driver";
    case "waiter":   return waiterRole === "senior" ? "Senior Staff" : "Waiter";
  }
}

function avatarBg(type: ManagedUser["type"], color?: string): string {
  if (type === "waiter" && color) return color;
  switch (type) {
    case "admin":    return "#a855f7";
    case "customer": return "#3b82f6";
    case "driver":   return "#f97316";
    case "waiter":   return "#14b8a6";
  }
}

const ROLE_FILTER_TABS: { id: FilterRole; label: string }[] = [
  { id: "all",      label: "All"           },
  { id: "admin",    label: "Admin"         },
  { id: "customer", label: "Customers"     },
  { id: "driver",   label: "Drivers"       },
  { id: "waiter",   label: "Staff/Waiters" },
];

const AVATAR_COLOR_OPTIONS = [
  "#f97316", "#ef4444", "#8b5cf6", "#3b82f6", "#14b8a6",
  "#22c55e", "#f59e0b", "#ec4899", "#64748b", "#0ea5e9",
];

// ── Toast ─────────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  message: string;
  ok: boolean;
}

let toastId = 0;

// ── Main component ────────────────────────────────────────────────────────────

export default function UserManagementPanel() {
  const [users,       setUsers]       = useState<ManagedUser[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [filterRole,  setFilterRole]  = useState<FilterRole>("all");
  const [search,      setSearch]      = useState("");
  const [toasts,      setToasts]      = useState<Toast[]>([]);

  // ── Modals ────────────────────────────────────────────────────────────────
  const [createOpen,        setCreateOpen]        = useState(false);
  const [editUser,          setEditUser]          = useState<ManagedUser | null>(null);
  const [passwordUser,      setPasswordUser]      = useState<ManagedUser | null>(null);
  const [deleteUser,        setDeleteUser]        = useState<ManagedUser | null>(null);
  const [deleteConfirming,  setDeleteConfirming]  = useState(false);
  const [resetSending,      setResetSending]      = useState<string | null>(null);

  // ── Toast helpers ─────────────────────────────────────────────────────────
  function addToast(message: string, ok: boolean) {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, ok }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  // ── Data fetch ────────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to load users.");
      const json = await res.json() as { ok: boolean; users?: ManagedUser[] };
      setUsers(json.users ?? []);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to load users.", false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = users.filter((u) => {
    if (filterRole !== "all" && u.type !== filterRole) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        u.name.toLowerCase().includes(q) ||
        (u.email?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  // ── Toggle active status ──────────────────────────────────────────────────
  async function toggleActive(user: ManagedUser) {
    if (user.type === "admin") return;

    // Optimistic update
    setUsers((prev) =>
      prev.map((u) => u.id === user.id ? { ...u, active: !u.active } : u),
    );

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: user.type, active: !user.active }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) {
        // Revert on failure
        setUsers((prev) =>
          prev.map((u) => u.id === user.id ? { ...u, active: user.active } : u),
        );
        addToast(json.error ?? "Failed to update status.", false);
      }
    } catch {
      setUsers((prev) =>
        prev.map((u) => u.id === user.id ? { ...u, active: user.active } : u),
      );
      addToast("Connection error.", false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteUser) return;
    setDeleteConfirming(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteUser.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: deleteUser.type }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== deleteUser.id));
        addToast(`${deleteUser.name} deleted.`, true);
        setDeleteUser(null);
      } else {
        addToast(json.error ?? "Failed to delete.", false);
      }
    } catch {
      addToast("Connection error.", false);
    } finally {
      setDeleteConfirming(false);
    }
  }

  // ── Send reset email ──────────────────────────────────────────────────────
  async function sendReset(user: ManagedUser) {
    if (!user.email) { addToast("No email address on file.", false); return; }
    setResetSending(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/send-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: user.type, email: user.email }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        addToast(`Reset link sent to ${user.email}`, true);
      } else {
        addToast(json.error ?? "Failed to send reset email.", false);
      }
    } catch {
      addToast("Connection error.", false);
    } finally {
      setResetSending(null);
    }
  }

  // ── Counts ────────────────────────────────────────────────────────────────
  const counts: Record<FilterRole, number> = {
    all:      users.length,
    admin:    users.filter((u) => u.type === "admin").length,
    customer: users.filter((u) => u.type === "customer").length,
    driver:   users.filter((u) => u.type === "driver").length,
    waiter:   users.filter((u) => u.type === "waiter").length,
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Toasts ──────────────────────────────────────────────────────── */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium pointer-events-auto transition-all
              ${t.ok
                ? "bg-green-50 border-green-200 text-green-800"
                : "bg-red-50 border-red-200 text-red-800"}`}
          >
            {t.ok
              ? <CheckCircle size={15} className="text-green-500 flex-shrink-0" />
              : <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
            }
            {t.message}
          </div>
        ))}
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
              <Users size={20} className="text-orange-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">All Users</h2>
              <p className="text-xs text-gray-500">{users.length} total accounts</p>
            </div>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition shadow-sm shadow-orange-200"
          >
            <Plus size={16} />
            Create User
          </button>
        </div>

        {/* Role filter tabs */}
        <div className="flex gap-1.5 mt-4 flex-wrap">
          {ROLE_FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterRole(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border
                ${filterRole === tab.id
                  ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                  : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300"}`}
            >
              {tab.label}
              <span className={`ml-1.5 ${filterRole === tab.id ? "text-orange-100" : "text-gray-400"}`}>
                {counts[tab.id]}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── User list ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Loading users…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <UserCircle2 size={36} className="mb-3 text-gray-300" />
            <p className="text-sm font-medium">No users found</p>
            <p className="text-xs mt-1">{search ? "Try a different search term." : "Create a user to get started."}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                onToggleActive={toggleActive}
                onEdit={() => setEditUser(user)}
                onPassword={() => setPasswordUser(user)}
                onSendReset={() => sendReset(user)}
                onDelete={() => setDeleteUser(user)}
                resetSending={resetSending === user.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { void fetchUsers(); }}
          addToast={addToast}
        />
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => { void fetchUsers(); }}
          addToast={addToast}
        />
      )}

      {passwordUser && (
        <ChangePasswordModal
          user={passwordUser}
          onClose={() => setPasswordUser(null)}
          addToast={addToast}
        />
      )}

      {deleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Delete user</h3>
                <p className="text-xs text-gray-500">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-gray-700 mb-5">
              Are you sure you want to delete <strong>{deleteUser.name}</strong>?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteUser(null)}
                className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmDelete()}
                disabled={deleteConfirming}
                className="flex-1 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition disabled:opacity-60"
              >
                {deleteConfirming ? <Loader2 size={15} className="animate-spin mx-auto" /> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── UserRow ───────────────────────────────────────────────────────────────────

function UserRow({
  user,
  onToggleActive,
  onEdit,
  onPassword,
  onSendReset,
  onDelete,
  resetSending,
}: {
  user: ManagedUser;
  onToggleActive: (u: ManagedUser) => Promise<void>;
  onEdit: () => void;
  onPassword: () => void;
  onSendReset: () => void;
  onDelete: () => void;
  resetSending: boolean;
}) {
  const initials = getInitials(user.name);
  const bg       = avatarBg(user.type, user.avatarColor);

  return (
    <div className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition group">
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-sm font-bold shadow-sm"
        style={{ backgroundColor: bg }}
      >
        {initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 truncate">{user.name}</span>
          <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${roleColor(user.type, user.waiterRole)}`}>
            {roleLabel(user.type, user.waiterRole)}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          {user.type === "waiter"
            ? `PIN: ${user.pin ?? "••••"}`
            : user.email ?? "No email"}
          {user.phone ? ` · ${user.phone}` : ""}
        </p>
      </div>

      {/* Status badge — clickable for non-admin */}
      <button
        onClick={() => void onToggleActive(user)}
        disabled={user.type === "admin"}
        title={user.type === "admin" ? "Admin is always active" : user.active ? "Click to deactivate" : "Click to activate"}
        className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition flex-shrink-0
          ${user.type === "admin" ? "cursor-default" : "cursor-pointer hover:opacity-80"}
          ${user.active
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-gray-50 text-gray-500 border-gray-200"}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${user.active ? "bg-green-500" : "bg-gray-400"}`} />
        {user.active ? "Active" : "Inactive"}
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
        {/* Edit */}
        {user.type !== "admin" && (
          <button
            onClick={onEdit}
            title="Edit user"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
          >
            <Pencil size={14} />
          </button>
        )}

        {/* Change password */}
        {user.type !== "admin" && (
          <button
            onClick={onPassword}
            title={user.type === "waiter" ? "Change PIN" : "Change password"}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition"
          >
            <Key size={14} />
          </button>
        )}

        {/* Send reset email */}
        {(user.type === "customer" || user.type === "driver") && (
          <button
            onClick={onSendReset}
            disabled={resetSending}
            title="Send reset email"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition disabled:opacity-50"
          >
            {resetSending
              ? <Loader2 size={14} className="animate-spin" />
              : <Mail size={14} />
            }
          </button>
        )}

        {/* Delete */}
        {user.type !== "admin" && (
          <button
            onClick={onDelete}
            title="Delete user"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── CreateUserModal ───────────────────────────────────────────────────────────

function CreateUserModal({
  onClose,
  onCreated,
  addToast,
}: {
  onClose: () => void;
  onCreated: () => void;
  addToast: (msg: string, ok: boolean) => void;
}) {
  const [type,        setType]        = useState<"customer" | "driver" | "waiter">("customer");
  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [phone,       setPhone]       = useState("");
  const [password,    setPassword]    = useState("");
  const [pin,         setPin]         = useState("");
  const [waiterRole,  setWaiterRole]  = useState<"waiter" | "senior">("waiter");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLOR_OPTIONS[0]);
  const [vehicleInfo, setVehicleInfo] = useState("");
  const [notes,       setNotes]       = useState("");
  const [active,      setActive]      = useState(true);
  const [loading,     setLoading]     = useState(false);
  const [errors,      setErrors]      = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim())         e.name = "Name is required.";
    if (type !== "waiter") {
      if (!email.trim())      e.email = "Email is required.";
    }
    if (type === "driver") {
      if (!phone.trim())      e.phone = "Phone is required.";
    }
    if (type !== "waiter") {
      if (!password)          e.password = "Password is required.";
      else if (password.length < 6) e.password = "Min 6 characters.";
    } else {
      if (!pin)               e.pin = "PIN is required.";
      else if (!/^\d{4}$/.test(pin)) e.pin = "PIN must be exactly 4 digits.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = { type, name, active };
      if (type !== "waiter") { body.email = email; body.password = password; }
      if (phone)        body.phone       = phone;
      if (type === "waiter")  { body.pin = pin; body.waiterRole = waiterRole; body.avatarColor = avatarColor; }
      if (vehicleInfo)  body.vehicleInfo = vehicleInfo;
      if (notes)        body.notes       = notes;

      const res  = await fetch("/api/admin/users", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        addToast(`${name} created successfully.`, true);
        onCreated();
        onClose();
      } else {
        addToast(json.error ?? "Failed to create user.", false);
      }
    } catch {
      addToast("Connection error.", false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalWrapper title="Create User" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">

        {/* Type selector */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Role</label>
          <div className="grid grid-cols-3 gap-2">
            {(["customer", "driver", "waiter"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border transition capitalize
                  ${type === t
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300"}`}
              >
                {t === "customer" && <UserCircle2 size={13} />}
                {t === "driver"   && <Truck size={13} />}
                {t === "waiter"   && <UtensilsCrossed size={13} />}
                {t === "waiter" ? "Staff" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <FormField label="Name" error={errors.name} required>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={inputCls(!!errors.name)} />
        </FormField>

        {type !== "waiter" && (
          <FormField label="Email" error={errors.email} required>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className={inputCls(!!errors.email)} />
          </FormField>
        )}

        <FormField label="Phone" error={errors.phone} required={type === "driver"}>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900000" className={inputCls(!!errors.phone)} />
        </FormField>

        {type !== "waiter" && (
          <FormField label="Password" error={errors.password} required>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" className={inputCls(!!errors.password)} />
          </FormField>
        )}

        {type === "waiter" && (
          <>
            <FormField label="PIN (4 digits)" error={errors.pin} required>
              <input type="text" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" className={inputCls(!!errors.pin)} />
            </FormField>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Staff Role</label>
              <div className="relative">
                <select value={waiterRole} onChange={(e) => setWaiterRole(e.target.value as "waiter" | "senior")} className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-500 pr-8">
                  <option value="waiter">Waiter</option>
                  <option value="senior">Senior Staff</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Avatar Color</label>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAvatarColor(c)}
                    className={`w-7 h-7 rounded-full border-2 transition ${avatarColor === c ? "border-gray-900 scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {type === "driver" && (
          <>
            <FormField label="Vehicle Info">
              <input type="text" value={vehicleInfo} onChange={(e) => setVehicleInfo(e.target.value)} placeholder="e.g. Red Honda Civic – AB12 CDE" className={inputCls(false)} />
            </FormField>
            <FormField label="Notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes…" rows={2} className={`${inputCls(false)} resize-none`} />
            </FormField>
          </>
        )}

        {/* Active toggle */}
        <div className="flex items-center justify-between py-1">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Active</label>
          <ToggleSwitch checked={active} onChange={setActive} />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button type="submit" disabled={loading} className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />}
            Create User
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// ── EditUserModal ─────────────────────────────────────────────────────────────

function EditUserModal({
  user,
  onClose,
  onSaved,
  addToast,
}: {
  user: ManagedUser;
  onClose: () => void;
  onSaved: () => void;
  addToast: (msg: string, ok: boolean) => void;
}) {
  const [name,        setName]        = useState(user.name);
  const [email,       setEmail]       = useState(user.email ?? "");
  const [phone,       setPhone]       = useState(user.phone ?? "");
  const [active,      setActive]      = useState(user.active);
  const [waiterRole,  setWaiterRole]  = useState<"waiter" | "senior">(user.waiterRole ?? "waiter");
  const [avatarColor, setAvatarColor] = useState(user.avatarColor ?? AVATAR_COLOR_OPTIONS[0]);
  const [pin,         setPin]         = useState("");
  const [vehicleInfo, setVehicleInfo] = useState(user.vehicleInfo ?? "");
  const [notes,       setNotes]       = useState(user.notes ?? "");
  const [loading,     setLoading]     = useState(false);
  const [errors,      setErrors]      = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required.";
    if (user.type !== "waiter" && !email.trim()) e.email = "Email is required.";
    if (user.type === "waiter" && pin && !/^\d{4}$/.test(pin)) e.pin = "PIN must be exactly 4 digits.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = { type: user.type, name, active };
      if (user.type !== "waiter") { body.email = email; body.phone = phone; }
      if (user.type === "waiter")  { body.waiterRole = waiterRole; body.avatarColor = avatarColor; if (pin) body.pin = pin; }
      if (user.type === "driver") { body.vehicleInfo = vehicleInfo; body.notes = notes; }

      const res  = await fetch(`/api/admin/users/${user.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        addToast(`${name} updated.`, true);
        onSaved();
        onClose();
      } else {
        addToast(json.error ?? "Failed to update.", false);
      }
    } catch {
      addToast("Connection error.", false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalWrapper title={`Edit ${user.type === "waiter" ? "Staff" : user.type === "driver" ? "Driver" : "Customer"}`} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">

        <FormField label="Name" error={errors.name} required>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={inputCls(!!errors.name)} />
        </FormField>

        {user.type !== "waiter" && (
          <>
            <FormField label="Email" error={errors.email} required>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className={inputCls(!!errors.email)} />
            </FormField>
            <FormField label="Phone">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7700 900000" className={inputCls(false)} />
            </FormField>
          </>
        )}

        {user.type === "waiter" && (
          <>
            <FormField label="PIN (4 digits — leave blank to keep current)" error={errors.pin}>
              <input type="text" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Leave blank to keep current" className={inputCls(!!errors.pin)} />
            </FormField>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Staff Role</label>
              <div className="relative">
                <select value={waiterRole} onChange={(e) => setWaiterRole(e.target.value as "waiter" | "senior")} className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-500 pr-8">
                  <option value="waiter">Waiter</option>
                  <option value="senior">Senior Staff</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Avatar Color</label>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAvatarColor(c)}
                    className={`w-7 h-7 rounded-full border-2 transition ${avatarColor === c ? "border-gray-900 scale-110" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {user.type === "driver" && (
          <>
            <FormField label="Vehicle Info">
              <input type="text" value={vehicleInfo} onChange={(e) => setVehicleInfo(e.target.value)} placeholder="e.g. Red Honda Civic – AB12 CDE" className={inputCls(false)} />
            </FormField>
            <FormField label="Notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes…" rows={2} className={`${inputCls(false)} resize-none`} />
            </FormField>
          </>
        )}

        <div className="flex items-center justify-between py-1">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Active</label>
          <ToggleSwitch checked={active} onChange={setActive} />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button type="submit" disabled={loading} className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />}
            Save Changes
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// ── ChangePasswordModal ───────────────────────────────────────────────────────

function ChangePasswordModal({
  user,
  onClose,
  addToast,
}: {
  user: ManagedUser;
  onClose: () => void;
  addToast: (msg: string, ok: boolean) => void;
}) {
  const isWaiter  = user.type === "waiter";
  const [value,   setValue]   = useState("");
  const [confirm, setConfirm] = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError("");

    if (isWaiter) {
      if (!/^\d{4}$/.test(value)) { setError("PIN must be exactly 4 digits."); return; }
    } else {
      if (value.length < 6) { setError("Password must be at least 6 characters."); return; }
      if (value !== confirm) { setError("Passwords do not match."); return; }
    }

    setLoading(true);
    try {
      const body = isWaiter
        ? { type: user.type, pin: value }
        : { type: user.type, password: value };

      const res  = await fetch(`/api/admin/users/${user.id}/set-password`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        addToast(isWaiter ? "PIN updated." : "Password updated.", true);
        onClose();
      } else {
        setError(json.error ?? "Failed to update.");
      }
    } catch {
      setError("Connection error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalWrapper title={isWaiter ? "Change PIN" : "Change Password"} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <p className="text-sm text-gray-600">
          {isWaiter
            ? `Set a new 4-digit PIN for ${user.name}.`
            : `Set a new password for ${user.name}.`}
        </p>

        {isWaiter ? (
          <FormField label="New PIN (4 digits)" error={error}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={value}
              onChange={(e) => { setValue(e.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }}
              placeholder="1234"
              className={inputCls(!!error)}
              autoFocus
            />
          </FormField>
        ) : (
          <>
            <FormField label="New Password" error={error}>
              <input
                type="password"
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(""); }}
                placeholder="Min 6 characters"
                className={inputCls(!!error)}
                autoFocus
              />
            </FormField>
            <FormField label="Confirm Password">
              <input
                type="password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                placeholder="Repeat new password"
                className={inputCls(false)}
              />
            </FormField>
          </>
        )}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button type="submit" disabled={loading} className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />}
            {isWaiter ? "Update PIN" : "Update Password"}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function ModalWrapper({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-base">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function FormField({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function inputCls(hasError: boolean): string {
  return `w-full bg-gray-50 border rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition ${hasError ? "border-red-300 bg-red-50" : "border-gray-200"}`;
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? "bg-orange-500" : "bg-gray-200"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}
