"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import type { WaiterStaff, DiningTable } from "@/types";
import {
  UserPlus, Pencil, Trash2, Users, UtensilsCrossed,
  CheckCircle2, XCircle, Eye, EyeOff, Save, X, Plus,
  LayoutGrid, AlertCircle,
} from "lucide-react";

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
  existingIds,
  onSave,
  onCancel,
}: {
  initial?: Partial<typeof EMPTY_WAITER> & { id?: string };
  existingIds: string[];
  onSave: (data: typeof EMPTY_WAITER) => void;
  onCancel: () => void;
}) {
  const [form, setForm]     = useState({ ...EMPTY_WAITER, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPin, setShowPin] = useState(false);

  function set<K extends keyof typeof EMPTY_WAITER>(k: K, v: (typeof EMPTY_WAITER)[K]) {
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
          placeholder="e.g. Alex"
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

// ─── Table Form ───────────────────────────────────────────────────────────────

const EMPTY_TABLE: Omit<DiningTable, "id"> = {
  number: 1, label: "", seats: 4, section: "Main Hall", active: true,
};

const SECTIONS = ["Main Hall", "Terrace", "Bar", "Private Dining", "Garden"];

function TableForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<typeof EMPTY_TABLE>;
  onSave: (data: typeof EMPTY_TABLE) => void;
  onCancel: () => void;
}) {
  const [form, setForm]     = useState({ ...EMPTY_TABLE, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof typeof EMPTY_TABLE>(k: K, v: (typeof EMPTY_TABLE)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k as string]; return n; });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.label.trim())   e.label   = "Label is required.";
    if (!form.section.trim()) e.section = "Section is required.";
    if (form.seats < 1)       e.seats   = "Must have at least 1 seat.";
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
      <div className="grid grid-cols-2 gap-3">
        {/* Label */}
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-gray-400 mb-1">Table Label</label>
          <input
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder="e.g. T1, Bar 2, Terrace A"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500"
          />
          {errors.label && <p className="text-red-400 text-xs mt-1">{errors.label}</p>}
        </div>

        {/* Table number */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Number</label>
          <input
            type="number"
            min={1}
            value={form.number}
            onChange={(e) => set("number", parseInt(e.target.value) || 1)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Seats */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Seats</label>
          <input
            type="number"
            min={1}
            max={20}
            value={form.seats}
            onChange={(e) => set("seats", parseInt(e.target.value) || 1)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
          />
          {errors.seats && <p className="text-red-400 text-xs mt-1">{errors.seats}</p>}
        </div>

        {/* Section */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">Section</label>
          <div className="flex gap-2 flex-wrap mb-1">
            {SECTIONS.map((s) => (
              <button
                key={s} type="button"
                onClick={() => set("section", s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  form.section === s
                    ? "bg-orange-500 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <input
            value={form.section}
            onChange={(e) => set("section", e.target.value)}
            placeholder="Or type a custom section…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500"
          />
          {errors.section && <p className="text-red-400 text-xs mt-1">{errors.section}</p>}
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

type PanelTab = "staff" | "tables";

export default function WaitersPanel() {
  const { settings, updateSettings } = useApp();

  const waiters = settings.waiters ?? [];
  const tables  = settings.diningTables ?? [];

  const [panelTab, setPanelTab] = useState<PanelTab>("staff");

  // Waiter state
  const [addingWaiter,   setAddingWaiter]   = useState(false);
  const [editingWaiter,  setEditingWaiter]  = useState<WaiterStaff | null>(null);
  const [deletingWaiter, setDeletingWaiter] = useState<string | null>(null);

  // Table state
  const [addingTable,   setAddingTable]   = useState(false);
  const [editingTable,  setEditingTable]  = useState<DiningTable | null>(null);
  const [deletingTable, setDeletingTable] = useState<string | null>(null);

  // ── Waiter CRUD ─────────────────────────────────────────────────────────────

  function handleAddWaiter(data: Omit<WaiterStaff, "id" | "createdAt">) {
    const newWaiter: WaiterStaff = {
      ...data,
      id: `w-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    updateSettings({ waiters: [...waiters, newWaiter] });
    setAddingWaiter(false);
  }

  function handleEditWaiter(data: Omit<WaiterStaff, "id" | "createdAt">) {
    if (!editingWaiter) return;
    updateSettings({
      waiters: waiters.map((w) =>
        w.id === editingWaiter.id ? { ...w, ...data } : w
      ),
    });
    setEditingWaiter(null);
  }

  function handleDeleteWaiter(id: string) {
    updateSettings({ waiters: waiters.filter((w) => w.id !== id) });
    setDeletingWaiter(null);
  }

  function toggleWaiterActive(id: string) {
    updateSettings({
      waiters: waiters.map((w) => w.id === id ? { ...w, active: !w.active } : w),
    });
  }

  // ── Table CRUD ───────────────────────────────────────────────────────────────

  function handleAddTable(data: Omit<DiningTable, "id">) {
    const newTable: DiningTable = { ...data, id: `tbl-${Date.now()}` };
    updateSettings({ diningTables: [...tables, newTable] });
    setAddingTable(false);
  }

  function handleEditTable(data: Omit<DiningTable, "id">) {
    if (!editingTable) return;
    updateSettings({
      diningTables: tables.map((t) =>
        t.id === editingTable.id ? { ...t, ...data } : t
      ),
    });
    setEditingTable(null);
  }

  function handleDeleteTable(id: string) {
    updateSettings({ diningTables: tables.filter((t) => t.id !== id) });
    setDeletingTable(null);
  }

  function toggleTableActive(id: string) {
    updateSettings({
      diningTables: tables.map((t) => t.id === id ? { ...t, active: !t.active } : t),
    });
  }

  // ── Group tables by section ───────────────────────────────────────────────

  const sections = Array.from(new Set(tables.map((t) => t.section)));

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-xl w-fit">
        {([
          { id: "staff",  label: "Staff",  icon: Users          },
          { id: "tables", label: "Tables", icon: LayoutGrid },
        ] as { id: PanelTab; label: string; icon: React.ComponentType<{ size?: number }> }[]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPanelTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              panelTab === id
                ? "bg-orange-500 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* ── STAFF TAB ──────────────────────────────────────────────────────── */}
      {panelTab === "staff" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-white font-semibold">Waiter Accounts</h2>
              <p className="text-gray-500 text-xs mt-0.5">{waiters.length} staff · {waiters.filter((w) => w.active).length} active</p>
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
                existingIds={waiters.map((w) => w.id)}
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
                      existingIds={waiters.filter((w) => w.id !== waiter.id).map((w) => w.id)}
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
                      <p className="text-gray-500 text-xs mt-0.5">PIN: {"•".repeat(waiter.pin.length)} · ID: {waiter.id}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
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
      )}

      {/* ── TABLES TAB ─────────────────────────────────────────────────────── */}
      {panelTab === "tables" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-white font-semibold">Dining Tables</h2>
              <p className="text-gray-500 text-xs mt-0.5">{tables.length} tables · {tables.filter((t) => t.active).length} active</p>
            </div>
            {!addingTable && !editingTable && (
              <button
                onClick={() => setAddingTable(true)}
                className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
              >
                <Plus size={15} /> Add Table
              </button>
            )}
          </div>

          {/* Add form */}
          {addingTable && (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><UtensilsCrossed size={16} /> New Table</h3>
              <TableForm
                onSave={handleAddTable}
                onCancel={() => setAddingTable(false)}
              />
            </div>
          )}

          {/* Tables list grouped by section */}
          {tables.length === 0 && !addingTable ? (
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center">
              <LayoutGrid size={32} className="text-gray-700 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">No tables yet. Add your first table above.</p>
            </div>
          ) : sections.map((section) => (
            <div key={section} className="space-y-2">
              <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest px-1">{section}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {tables.filter((t) => t.section === section).map((table) => (
                  <div key={table.id} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                    {editingTable?.id === table.id ? (
                      <div className="p-5">
                        <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                          <Pencil size={15} /> Edit {table.label}
                        </h4>
                        <TableForm
                          initial={table}
                          onSave={handleEditTable}
                          onCancel={() => setEditingTable(null)}
                        />
                      </div>
                    ) : deletingTable === table.id ? (
                      <div className="p-4 flex items-center gap-3 bg-red-950/30">
                        <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                        <p className="text-red-300 text-xs flex-1">Remove table <strong>{table.label}</strong>?</p>
                        <button
                          onClick={() => handleDeleteTable(table.id)}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg"
                        >
                          Delete
                        </button>
                        <button onClick={() => setDeletingTable(null)} className="text-gray-400 hover:text-white">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="p-3 flex items-center gap-3">
                        {/* Table number badge */}
                        <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center flex-shrink-0 text-white font-bold ${table.active ? "bg-gray-700" : "bg-gray-800"}`}>
                          <span className="text-xs leading-none">{table.label}</span>
                          <span className="text-[10px] text-gray-400">{table.seats}👤</span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium">Table {table.label}</p>
                          <p className="text-gray-500 text-xs">{table.seats} seats · {table.section}</p>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleTableActive(table.id)}
                            title={table.active ? "Deactivate" : "Activate"}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-800 transition"
                          >
                            {table.active
                              ? <CheckCircle2 size={14} className="text-green-400" />
                              : <XCircle      size={14} className="text-gray-600"  />
                            }
                          </button>
                          <button
                            onClick={() => { setEditingTable(table); setAddingTable(false); }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-800 transition"
                          >
                            <Pencil size={13} className="text-gray-400" />
                          </button>
                          <button
                            onClick={() => setDeletingTable(table.id)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/10 transition"
                          >
                            <Trash2 size={13} className="text-gray-500 hover:text-red-400" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
