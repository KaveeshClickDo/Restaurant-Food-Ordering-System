"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import type { Reservation, DiningTable } from "@/types";
import {
  UtensilsCrossed, Users, Clock, LogIn, LogOut,
  Loader2, RefreshCw, CheckCircle2, XCircle, CalendarDays,
  Plus, Pencil, Trash2, AlertCircle, X, Save, EyeOff,
} from "lucide-react";

// One unified panel for both live table status AND CRUD. Each card shows the
// current state (free / reserved / occupied / done / inactive) plus admin
// actions (edit / toggle active / delete). Inactive tables are dimmed and
// don't carry a live state — they're hidden from the customer flow.

// ─── Types ────────────────────────────────────────────────────────────────────

type LiveState = "free" | "reserved" | "occupied" | "done";
type TableState = LiveState | "inactive";

interface TableInfo {
  // Wraps the DB row with the live state resolved from today's reservations.
  // Cards consume `table` for actions (edit/delete) and `state` for the badge.
  table: DiningTable;
  state: TableState;
  reservation?: Reservation;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmt12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

function fmtTs(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const STATE_STYLES: Record<TableState, {
  card: string;
  badge: string;
  label: string;
  dot: string;
}> = {
  free:     { card: "bg-white border-gray-200",       badge: "bg-gray-100 text-gray-500",   label: "Free",     dot: "bg-gray-300"  },
  reserved: { card: "bg-amber-50 border-amber-300",   badge: "bg-amber-100 text-amber-700", label: "Reserved", dot: "bg-amber-400" },
  occupied: { card: "bg-blue-50 border-blue-400",     badge: "bg-blue-100 text-blue-700",   label: "Occupied", dot: "bg-blue-500"  },
  done:     { card: "bg-teal-50 border-teal-300",     badge: "bg-teal-100 text-teal-700",   label: "Done",     dot: "bg-teal-500"  },
  inactive: { card: "bg-gray-50 border-gray-200 opacity-60", badge: "bg-gray-200 text-gray-500", label: "Inactive", dot: "bg-gray-400" },
};

// ─── Table Form (Add / Edit) ──────────────────────────────────────────────────

const EMPTY_TABLE: Omit<DiningTable, "id" | "number"> = {
  label: "", seats: 4, section: "Main Hall", active: true,
};

const SECTIONS = ["Main Hall", "Terrace", "Bar", "Private Dining", "Garden"];

function TableForm({
  initial,
  existingLabels,
  onSave,
  onCancel,
}: {
  initial?: Partial<typeof EMPTY_TABLE>;
  /** Labels of OTHER tables (excluding the one being edited) — used to block duplicates. */
  existingLabels: string[];
  onSave: (data: typeof EMPTY_TABLE) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [form, setForm]     = useState({ ...EMPTY_TABLE, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  function set<K extends keyof typeof EMPTY_TABLE>(k: K, v: (typeof EMPTY_TABLE)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k as string]; return n; });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    const trimmedLabel = form.label.trim();
    if (!trimmedLabel)        e.label   = "Label is required.";
    if (!form.section.trim()) e.section = "Section is required.";
    if (form.seats < 1)       e.seats   = "Must have at least 1 seat.";
    if (trimmedLabel && existingLabels.some((l) => l.trim().toLowerCase() === trimmedLabel.toLowerCase())) {
      e.label = "Another table already uses this label.";
    }
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
      await onSave({ ...form, label: form.label.trim(), section: form.section.trim() });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Table Label</label>
          <input
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder="e.g. T1, Bar 2, Terrace A"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
          />
          {errors.label && <p className="text-red-500 text-xs mt-1">{errors.label}</p>}
        </div>

        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Seats</label>
          <input
            type="number" min={1} max={20}
            value={form.seats}
            onChange={(e) => set("seats", parseInt(e.target.value) || 1)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
          />
          {errors.seats && <p className="text-red-500 text-xs mt-1">{errors.seats}</p>}
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Section</label>
          <div className="flex gap-2 flex-wrap mb-2">
            {SECTIONS.map((s) => (
              <button
                key={s} type="button"
                onClick={() => set("section", s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition border ${
                  form.section === s
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300"
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
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
          />
          {errors.section && <p className="text-red-500 text-xs mt-1">{errors.section}</p>}
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <div
          onClick={() => set("active", !form.active)}
          className={`w-9 h-5 rounded-full transition relative flex-shrink-0 ${form.active ? "bg-green-500" : "bg-gray-300"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.active ? "translate-x-4" : "translate-x-0.5"}`} />
        </div>
        <span className="text-sm text-gray-700">{form.active ? "Active" : "Inactive"}</span>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          <Save size={14} /> {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-semibold px-4 py-2 rounded-lg transition border border-gray-200"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Unified table card ───────────────────────────────────────────────────────

function TableCard({
  info,
  onCheckIn,
  onCheckOut,
  onEdit,
  onToggleActive,
  onAskDelete,
  isEditing,
  isDeleting,
  existingLabelsForEdit,
  onSaveEdit,
  onCancelEdit,
  onConfirmDelete,
  onCancelDelete,
}: {
  info: TableInfo;
  onCheckIn:       (resId: string) => Promise<void>;
  onCheckOut:      (resId: string) => Promise<void>;
  onEdit:          (table: DiningTable) => void;
  onToggleActive:  (table: DiningTable) => Promise<void>;
  onAskDelete:     (table: DiningTable) => void;
  isEditing:       boolean;
  isDeleting:      boolean;
  existingLabelsForEdit: string[];
  onSaveEdit:      (data: Omit<DiningTable, "id" | "number">) => Promise<void>;
  onCancelEdit:    () => void;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete:  () => void;
}) {
  const [actioning, setActioning] = useState(false);
  const { table, state, reservation: res } = info;
  const s = STATE_STYLES[state];

  async function act(fn: () => Promise<void>) {
    setActioning(true);
    await fn();
    setActioning(false);
  }

  // Edit mode swaps the entire card body for the form.
  if (isEditing) {
    return (
      <div className="rounded-2xl border-2 border-gray-200 bg-white p-4">
        <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm">
          <Pencil size={14} /> Edit {table.label}
        </h4>
        <TableForm
          initial={table}
          existingLabels={existingLabelsForEdit}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      </div>
    );
  }

  // Delete confirmation swaps the card into a destructive prompt.
  if (isDeleting) {
    return (
      <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 flex items-center gap-3">
        <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
        <p className="text-red-700 text-sm flex-1">Remove table <strong>{table.label}</strong>?</p>
        <button
          onClick={() => void onConfirmDelete()}
          className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
        >
          Delete
        </button>
        <button onClick={onCancelDelete} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border-2 p-3 sm:p-4 flex flex-col gap-3 transition ${s.card}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-2">
        <div>
          <div className="flex items-center gap-2">
            <UtensilsCrossed size={14} className="text-orange-500" />
            <span className="font-bold text-gray-900 text-base">{table.label}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Users size={11} /> {table.seats} seats</span>
            {table.section && <span>{table.section}</span>}
          </div>
        </div>
        <span className={`inline-flex text-center items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full ${s.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>

      {/* Reservation detail (only when there is one) */}
      {res && (
        <div className="bg-white/70 rounded-xl px-3 py-2 space-y-1">
          <p className="font-semibold text-gray-800 text-sm truncate">{res.customerName}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Clock size={10} /> {fmt12(res.time)}</span>
            <span className="flex items-center gap-1"><Users size={10} /> {res.partySize} guests</span>
            {res.checkedInAt && (
              <span className="flex items-center gap-1 text-blue-600">
                <LogIn size={10} /> in {fmtTs(res.checkedInAt)}
              </span>
            )}
            {res.checkedOutAt && (
              <span className="flex items-center gap-1 text-teal-600">
                <LogOut size={10} /> out {fmtTs(res.checkedOutAt)}
              </span>
            )}
          </div>
          {res.note && (
            <p className="text-xs text-amber-700 italic truncate">&ldquo;{res.note}&rdquo;</p>
          )}
        </div>
      )}

      {/* Status action row (check-in / check-out) */}
      {actioning ? (
        <div className="flex justify-center py-1">
          <Loader2 size={16} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {state === "reserved" && res && (
            <button
              onClick={() => act(() => onCheckIn(res.id))}
              className="w-full flex items-center justify-center gap-1.5 bg-blue-500 hover:bg-blue-600 active:scale-95 text-white text-xs font-semibold py-2 rounded-xl transition-all"
            >
              <LogIn size={13} /> Check In
            </button>
          )}
          {state === "occupied" && res && (
            <button
              onClick={() => act(() => onCheckOut(res.id))}
              className="w-full flex items-center justify-center gap-1.5 bg-teal-500 hover:bg-teal-600 active:scale-95 text-white text-xs font-semibold py-2 rounded-xl transition-all"
            >
              <LogOut size={13} /> Check Out
            </button>
          )}
          {state === "free" && (
            <div className="w-full flex items-center justify-center gap-1.5 text-gray-400 text-xs py-1">
              <CheckCircle2 size={13} /> Available
            </div>
          )}
          {state === "done" && (
            <div className="w-full flex items-center justify-center gap-1.5 text-teal-600 text-xs py-1">
              <CheckCircle2 size={13} /> Freed
            </div>
          )}
          {state === "inactive" && (
            <div className="w-full flex items-center justify-center gap-1.5 text-gray-400 text-xs py-1">
              <EyeOff size={13} /> Hidden from the floor
            </div>
          )}
        </>
      )}

      {/* Admin action footer — edit / toggle active / delete */}
      <div className="flex items-center justify-end gap-1 pt-1 border-t border-black/5">
        <button
          onClick={() => act(() => onToggleActive(table))}
          title={table.active ? "Deactivate" : "Activate"}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 transition"
        >
          {table.active
            ? <CheckCircle2 size={14} className="text-green-500" />
            : <XCircle      size={14} className="text-gray-400"  />
          }
        </button>
        <button
          onClick={() => onEdit(table)}
          title="Edit table"
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blue-50 transition"
        >
          <Pencil size={13} className="text-gray-500 hover:text-blue-600" />
        </button>
        <button
          onClick={() => onAskDelete(table)}
          title="Delete table"
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 transition"
        >
          <Trash2 size={13} className="text-gray-500 hover:text-red-600" />
        </button>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function TableStatusPanel() {
  const { updateSettings } = useApp();

  // The full DB list (including inactive tables) is the source of truth for
  // the unified card grid. Each mutation re-fetches and pushes the fresh list
  // into AppContext so other consumers (ReservationsPanel, POS, etc.) live-
  // update without a page refresh.
  const [allTables, setAllTables] = useState<DiningTable[]>([]);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loadingRes, setLoadingRes] = useState(true);
  const [filterSection, setFilterSection] = useState("");

  // Add / edit / delete state
  const [addingTable,   setAddingTable]   = useState(false);
  const [editingTable,  setEditingTable]  = useState<DiningTable | null>(null);
  const [deletingTable, setDeletingTable] = useState<string | null>(null);
  const [tableError,    setTableError]    = useState<string>("");
  const tableRowInFlight = useRef<Set<string>>(new Set());

  const refreshTables = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/dining-tables");
      if (!res.ok) return;
      const json = await res.json() as { ok: boolean; tables?: DiningTable[] };
      if (json.ok) {
        const fresh = json.tables ?? [];
        setAllTables(fresh);
        updateSettings({ diningTables: fresh });
      }
    } catch { /* ignore — UI keeps last good list */ }
  }, [updateSettings]);

  const fetchToday = useCallback(async () => {
    setLoadingRes(true);
    try {
      const params = new URLSearchParams({ from: todayStr(), to: todayStr() });
      const res = await fetch(`/api/admin/reservations?${params}`);
      const json = await res.json() as { ok: boolean; reservations?: Reservation[] };
      if (json.ok) setReservations(json.reservations ?? []);
    } catch (err) {
      console.error("TableStatusPanel fetch:", err);
    } finally {
      setLoadingRes(false);
    }
  }, []);

  useEffect(() => { refreshTables(); fetchToday(); }, [refreshTables, fetchToday]);

  // Poll every 8 s — anon supabase realtime no longer fires after RLS revoke.
  useEffect(() => {
    const id = setInterval(fetchToday, 8_000);
    return () => clearInterval(id);
  }, [fetchToday]);

  // ── Tables CRUD ─────────────────────────────────────────────────────────────

  async function handleAddTable(data: Omit<DiningTable, "id" | "number">) {
    setTableError("");
    const res = await fetch("/api/admin/dining-tables", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (res.ok && json.ok) {
      await refreshTables();
      setAddingTable(false);
    } else {
      setTableError(json.error ?? "Failed to add table.");
    }
  }

  async function handleEditTable(data: Omit<DiningTable, "id" | "number">) {
    if (!editingTable) return;
    setTableError("");
    const res = await fetch(`/api/admin/dining-tables/${editingTable.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
    if (res.ok && json.ok) {
      await refreshTables();
      setEditingTable(null);
    } else {
      setTableError(json.error ?? "Failed to update table.");
    }
  }

  async function handleDeleteTable(id: string) {
    if (tableRowInFlight.current.has(id)) return;
    tableRowInFlight.current.add(id);
    setTableError("");
    try {
      const res = await fetch(`/api/admin/dining-tables/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        await refreshTables();
        setDeletingTable(null);
      } else {
        setTableError(json.error ?? "Failed to delete table.");
        setDeletingTable(null);
      }
    } finally {
      tableRowInFlight.current.delete(id);
    }
  }

  async function toggleTableActive(table: DiningTable) {
    if (tableRowInFlight.current.has(table.id)) return;
    tableRowInFlight.current.add(table.id);
    try {
      const res = await fetch(`/api/admin/dining-tables/${table.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ active: !table.active }),
      });
      if (res.ok) await refreshTables();
    } finally {
      tableRowInFlight.current.delete(table.id);
    }
  }

  // ── Reservation actions ─────────────────────────────────────────────────────

  const actionInFlight = useRef<Set<string>>(new Set());

  async function handleCheckIn(resId: string) {
    if (actionInFlight.current.has(resId)) return;
    actionInFlight.current.add(resId);
    try {
      await fetch(`/api/admin/reservations/${resId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "checked_in" }),
      });
      setReservations((prev) =>
        prev.map((r) => r.id === resId ? { ...r, status: "checked_in", checkedInAt: new Date().toISOString() } : r)
      );
    } finally {
      actionInFlight.current.delete(resId);
    }
  }

  async function handleCheckOut(resId: string) {
    if (actionInFlight.current.has(resId)) return;
    actionInFlight.current.add(resId);
    try {
      await fetch(`/api/admin/reservations/${resId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "checked_out" }),
      });
      setReservations((prev) =>
        prev.map((r) => r.id === resId ? { ...r, status: "checked_out", checkedOutAt: new Date().toISOString() } : r)
      );
    } finally {
      actionInFlight.current.delete(resId);
    }
  }

  // ── Resolve a live state for each table ─────────────────────────────────────

  function resolveLive(tableId: string): { state: LiveState; reservation?: Reservation } {
    // Priority: occupied > reserved > done > free
    const occupied = reservations.find((r) => r.tableId === tableId && r.status === "checked_in");
    if (occupied) return { state: "occupied", reservation: occupied };

    const reserved = reservations.find(
      (r) => r.tableId === tableId && (r.status === "pending" || r.status === "confirmed"),
    );
    if (reserved) return { state: "reserved", reservation: reserved };

    const done = reservations.find((r) => r.tableId === tableId && r.status === "checked_out");
    if (done) return { state: "done", reservation: done };

    return { state: "free" };
  }

  const tableInfoList: TableInfo[] = allTables
    .filter((t) => !filterSection || t.section === filterSection)
    .map((t) => {
      if (!t.active) {
        return { table: t, state: "inactive" as TableState };
      }
      const { state, reservation } = resolveLive(t.id);
      return { table: t, state, reservation };
    });

  const sections = [...new Set(allTables.map((t) => t.section).filter(Boolean))];

  const counts = {
    free:     tableInfoList.filter((t) => t.state === "free").length,
    reserved: tableInfoList.filter((t) => t.state === "reserved").length,
    occupied: tableInfoList.filter((t) => t.state === "occupied").length,
    done:     tableInfoList.filter((t) => t.state === "done").length,
    inactive: tableInfoList.filter((t) => t.state === "inactive").length,
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-row gap-3">
          <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <UtensilsCrossed size={20} className="text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900">Tables</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {allTables.length} total · {counts.occupied} occupied · {counts.reserved} reserved · {counts.free} free
              {counts.inactive > 0 && ` · ${counts.inactive} inactive`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchToday}
            disabled={loadingRes}
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition"
          >
            <RefreshCw size={14} className={loadingRes ? "animate-spin" : ""} />
            Refresh
          </button>
          {!addingTable && !editingTable && (
            <button
              onClick={() => setAddingTable(true)}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition shadow-sm shadow-orange-200"
            >
              <Plus size={15} /> Add Table
            </button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Free",     value: counts.free,     bg: "bg-gray-50",  border: "border-gray-200",  text: "text-gray-800"  },
          { label: "Reserved", value: counts.reserved, bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
          { label: "Occupied", value: counts.occupied, bg: "bg-blue-50",  border: "border-blue-200",  text: "text-blue-700"  },
          { label: "Done",     value: counts.done,     bg: "bg-teal-50",  border: "border-teal-200",  text: "text-teal-700"  },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3.5`}>
            <div className={`text-2xl font-bold ${s.text}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Legend + section filter */}
      <div className="flex items-center gap-3 flex-wrap">
        {(["free", "reserved", "occupied", "done", "inactive"] as TableState[]).map((st) => (
          <span key={st} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={`w-2 h-2 rounded-full ${STATE_STYLES[st].dot}`} />
            {STATE_STYLES[st].label}
          </span>
        ))}
        {sections.length > 1 && (
          <select
            value={filterSection}
            onChange={(e) => setFilterSection(e.target.value)}
            className="ml-auto border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-orange-400 transition"
          >
            <option value="">All sections</option>
            {sections.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* Inline error banner */}
      {tableError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{tableError}</span>
          <button onClick={() => setTableError("")} className="text-red-500 hover:text-red-700 transition">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Add form */}
      {addingTable && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm">
            <UtensilsCrossed size={15} className="text-orange-500" /> New Table
          </h3>
          <TableForm
            existingLabels={allTables.map((t) => t.label)}
            onSave={handleAddTable}
            onCancel={() => setAddingTable(false)}
          />
        </div>
      )}

      {/* Unified table grid */}
      {allTables.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 bg-white rounded-2xl border border-gray-200">
          <CalendarDays size={32} className="text-gray-300" />
          <p className="font-semibold text-gray-600">No tables yet</p>
          <p className="text-sm text-gray-400">Click <strong>Add Table</strong> to create your first one.</p>
        </div>
      ) : tableInfoList.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 bg-white rounded-2xl border border-gray-200">
          <CalendarDays size={32} className="text-gray-300" />
          <p className="font-semibold text-gray-600">No tables in this section</p>
          <p className="text-sm text-gray-400">Pick another section or clear the filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
          {tableInfoList.map((info) => (
            <TableCard
              key={info.table.id}
              info={info}
              onCheckIn={handleCheckIn}
              onCheckOut={handleCheckOut}
              onEdit={(t) => { setEditingTable(t); setAddingTable(false); }}
              onToggleActive={toggleTableActive}
              onAskDelete={(t) => setDeletingTable(t.id)}
              isEditing={editingTable?.id === info.table.id}
              isDeleting={deletingTable === info.table.id}
              existingLabelsForEdit={allTables.filter((t) => t.id !== info.table.id).map((t) => t.label)}
              onSaveEdit={handleEditTable}
              onCancelEdit={() => setEditingTable(null)}
              onConfirmDelete={() => handleDeleteTable(info.table.id)}
              onCancelDelete={() => setDeletingTable(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
