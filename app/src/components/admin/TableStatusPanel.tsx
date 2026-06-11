"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import type { Reservation, DiningTable, FloorPlan } from "@/types";
import { uploadFloorPlanImage, floorPlanSizeError } from "@/lib/uploadImage";
import { resolveFloorPlans, effectiveFloorId } from "@/lib/floorPlans";
import {
  UtensilsCrossed, Users, Clock, LogIn, LogOut,
  Loader2, RefreshCw, CheckCircle2, XCircle, CalendarDays,
  Plus, Pencil, Trash2, AlertCircle, X, Save, EyeOff, Crown,
  ImagePlus, Map as MapIcon, LayoutGrid, Layers,
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
  label: "", seats: 4, section: "Main Hall", active: true, isVip: false, vipPrice: 0,
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
  const { settings } = useApp();
  const currencySymbol = settings.currency?.symbol ?? "£";
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
    if (form.isVip && !((form.vipPrice ?? 0) > 0)) {
      e.vipPrice = "A VIP table needs a booking fee greater than 0.";
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

      {/* VIP table — premium styling + a non-refundable booking fee charged at
          reservation time. Turning it off clears the fee. */}
      <div className={`rounded-xl border p-3 transition ${form.isVip ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-gray-50"}`}>
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            onClick={() => set("isVip", !form.isVip)}
            className={`w-9 h-5 rounded-full transition relative flex-shrink-0 ${form.isVip ? "bg-amber-500" : "bg-gray-300"}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isVip ? "translate-x-4" : "translate-x-0.5"}`} />
          </div>
          <span className="text-sm text-gray-700 flex items-center gap-1.5">
            <Crown size={14} className={form.isVip ? "text-amber-500" : "text-gray-400"} />
            VIP table
          </span>
        </label>

        {form.isVip && (
          <div className="mt-3">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Booking fee</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">{currencySymbol}</span>
              <input
                type="number" min={0} step="0.01"
                value={form.vipPrice ?? 0}
                placeholder="0.00"
                onChange={(e) => set("vipPrice", e.target.value === "" ? ("" as unknown as number) : parseFloat(e.target.value))}
                onBlur={() => {
                  if (form.vipPrice === ("" as unknown as number) || isNaN(Number(form.vipPrice))) {
                    set("vipPrice", 0);
                  }
                }}
                className="w-full bg-white border border-gray-200 rounded-xl pl-7 pr-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition"
              />
            </div>
            <p className="text-[11px] text-gray-500 mt-1">Charged (non-refundable) when this table is reserved.</p>
            {errors.vipPrice && <p className="text-red-500 text-xs mt-1">{errors.vipPrice}</p>}
          </div>
        )}
      </div>

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
  const { settings } = useApp();
  const currencySymbol = settings.currency?.symbol ?? "£";
  const { table, state, reservation: res } = info;
  const s = STATE_STYLES[state];
  const vipChip = table.isVip ? (
    <span className="inline-flex items-center gap-1 text-amber-700">
      <Crown size={11} className="text-amber-500" /> VIP · {currencySymbol}{(table.vipPrice ?? 0).toFixed(2)}
    </span>
  ) : null;

  async function act(fn: () => Promise<void>) {
    setActioning(true);
    await fn();
    setActioning(false);
  }

  // EDIT MODE: Use a floating Absolute Popover here
  // This prevents the tall edit form from stretching the other cards in the grid row.
  if (isEditing) {
    return (
      <div className="relative h-full w-full">
        {/* Invisible ghost card: Allows the grid row height to size naturally based on the OTHER normal cards */}
        <div className="opacity-0 pointer-events-none h-full rounded-2xl border-2 p-4">
          <div className="h-24 w-full"></div>
        </div>

        {/* Floating Edit Form: Hovers over the grid, overlapping downwards smoothly */}
        <div className="absolute top-0 left-0 w-full z-30 rounded-2xl border-2 border-gray-200 bg-white p-4 h-fit">
          <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm min-w-0" >
            <Pencil size={14} className="flex-shrink-0" /> 
            <span className="truncate" title={table.label} >Edit {table.label}</span>
          </h4>
          <TableForm
            initial={table}
            existingLabels={existingLabelsForEdit}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
          />
        </div>
      </div>
    );
  }

  // Delete confirmation swaps the card into a destructive prompt.
  if (isDeleting) {
    return (
      <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 flex items-center gap-3">
        <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
        <p className="text-red-700 text-sm flex-1 min-w-0 leading-tight">Remove table <strong className="block truncate" title={table.label}>{table.label}?</strong></p>
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
    <div className={`rounded-2xl border-2 p-3 sm:p-4 flex flex-col gap-3 transition h-full ${s.card}`}>
      {/* Table header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5 sm:gap-2">
        <div className="min-w-0 flex-1"> 
          <div className="flex items-center gap-2 min-w-0">
            {table.isVip
              ? <Crown size={14} className="text-amber-500" />
              : <UtensilsCrossed size={14} className="text-orange-500" />}
            <span className="font-bold text-gray-900 text-base truncate" title={table.label}>
              {table.label}
            </span>
          </div>
          <div className="flex sm:hidden items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Users size={11} /> {table.seats} seats</span>
            {table.section && <span>{table.section}</span>}
            {vipChip}
          </div>
        </div>
        <span className={`inline-flex text-center items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full ${s.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>
      <div className="hidden sm:flex items-center gap-3 mt-1 text-xs text-gray-500">
        <span className="flex items-center gap-1"><Users size={11} /> {table.seats} seats</span>
        {table.section && <span>{table.section}</span>}
        {vipChip}
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
        <div className="flex justify-center py-1 mt-auto">
          <Loader2 size={16} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="flex gap-2 mt-auto">
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
          {state === "occupied" && !res && (
            // Seated walk-in (active order, no reservation) — frees when the
            // waiter settles the bill, so there's no check-out here.
            <div className="w-full flex items-center justify-center gap-1.5 text-blue-500 text-xs py-1">
              <UtensilsCrossed size={13} /> In service
            </div>
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
        </div>
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

// ─── Floor-plan editor ──────────────────────────────────────────────────────
// Multiple named floor plans ("Ground Floor", "Rooftop", …). Each floor has its
// own image + marker size; a table is dragged onto exactly one floor. Positions
// are saved as a 0..1 fraction of the image so they scale to any screen on the
// customer booking map, where the floors appear as a selector.

function FloorPlanEditor({
  tables,
  plans,
  uploading,
  onPlansChange,
  onUpload,
  onSaveCoords,
}: {
  tables: DiningTable[];
  plans: FloorPlan[];
  uploading: boolean;
  /** Persist the full floor-plan list (add / rename / delete / scale / image). */
  onPlansChange: (plans: FloorPlan[]) => void;
  onUpload: (floorId: string, file: File) => void;
  onSaveCoords: (id: string, posX: number | null, posY: number | null, floorId: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(plans[0]?.id ?? null);
  const [dragId, setDragId]     = useState<string | null>(null);
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr]           = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const moved = useRef(false);

  // Keep the active tab valid as floors are added / deleted.
  useEffect(() => {
    if (!plans.some((p) => p.id === activeId)) setActiveId(plans[0]?.id ?? null);
  }, [plans, activeId]);

  const activePlan = plans.find((p) => p.id === activeId) ?? null;
  const imageUrl   = activePlan?.imageUrl ?? "";

  // Floor-name draft — committed on blur / Enter so settings aren't persisted
  // on every keystroke.
  const [nameDraft, setNameDraft] = useState(activePlan?.name ?? "");
  useEffect(() => { setNameDraft(activePlan?.name ?? ""); setConfirmingDelete(false); setSelected(null); }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live marker-size preview for the active floor. Updates instantly while
  // dragging the slider; persisted (onPlansChange) only on release.
  const markerScale = activePlan?.markerScale ?? 1;
  const [scale, setScale] = useState(markerScale);
  useEffect(() => { setScale(markerScale); }, [markerScale]);
  const mSize  = Math.round(44 * scale);
  const mFont  = Math.max(8, Math.round(11 * scale));
  const mCrown = Math.max(7, Math.round(10 * scale));

  function posOf(t: DiningTable): { x: number; y: number } | null {
    if (localPos[t.id]) return localPos[t.id];
    if (t.posX != null && t.posY != null) return { x: t.posX, y: t.posY };
    return null;
  }

  // The floor a table sits on, with legacy (null) assignments resolved to the
  // first plan. Tables pointing at a deleted floor return to the tray.
  function floorOf(t: DiningTable): string | null {
    if (posOf(t) === null) return null;
    const id = effectiveFloorId(t.floorId, plans);
    return plans.some((p) => p.id === id) ? id : null;
  }

  const active   = tables.filter((t) => t.active);
  const placed   = active.filter((t) => floorOf(t) === activeId && activeId !== null);
  const unplaced = active.filter((t) => floorOf(t) === null);
  const placedCountOn = (floorId: string) => active.filter((t) => floorOf(t) === floorId).length;

  function clientToNorm(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";               // allow re-selecting the same file
    if (!file || !activePlan) return;
    const sizeErr = floorPlanSizeError(file);
    if (sizeErr) { setErr(sizeErr); return; }
    setErr("");
    onUpload(activePlan.id, file);
  }

  // ── Floor management ──────────────────────────────────────────────────────

  function addFloor() {
    const name = plans.length === 0 ? "Main Floor" : `Floor ${plans.length + 1}`;
    const plan: FloorPlan = { id: crypto.randomUUID(), name, imageUrl: "", markerScale: 1 };
    onPlansChange([...plans, plan]);
    setActiveId(plan.id);
  }

  function commitName() {
    if (!activePlan) return;
    const name = nameDraft.trim();
    if (!name || name === activePlan.name) { setNameDraft(activePlan.name); return; }
    onPlansChange(plans.map((p) => (p.id === activePlan.id ? { ...p, name } : p)));
  }

  function deleteActiveFloor() {
    if (!activePlan) return;
    // Tables on this floor (including inactive ones, and legacy rows that
    // resolve to it) go back to the tray so they can't ghost onto another floor.
    for (const t of tables) {
      if (t.posX != null && t.posY != null && effectiveFloorId(t.floorId, plans) === activePlan.id) {
        onSaveCoords(t.id, null, null, null);
      }
    }
    onPlansChange(plans.filter((p) => p.id !== activePlan.id));
    setConfirmingDelete(false);
  }

  // Pointer-capture keeps move/up on the grabbed marker even if the cursor
  // outruns it. moved guards a click-without-drag from saving a no-op.
  function onMarkerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(id);
    setSelected(id);
    moved.current = false;
  }
  function onMarkerMove(e: React.PointerEvent, id: string) {
    if (dragId !== id) return;
    moved.current = true;
    setLocalPos((p) => ({ ...p, [id]: clientToNorm(e.clientX, e.clientY) }));
  }
  function onMarkerUp(e: React.PointerEvent, id: string) {
    if (dragId !== id) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragId(null);
    const pos = localPos[id];
    // Always stamp the active floor id so legacy (null) placements migrate on
    // their first move.
    if (moved.current && pos && activeId) onSaveCoords(id, pos.x, pos.y, activeId);
  }

  // No floors yet — first-run empty state.
  if (plans.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 gap-3 bg-white rounded-2xl border-2 border-dashed border-gray-200 text-center">
        <Layers size={32} className="text-gray-300" />
        <p className="font-semibold text-gray-600">No floor plans yet</p>
        <p className="text-sm text-gray-400 max-w-sm">Create a floor (e.g. “Ground Floor” or “Rooftop”), upload a picture or diagram of it, then drag your tables onto it. Customers pick a floor when booking.</p>
        <button
          onClick={addFloor}
          className="mt-1 flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
        >
          <Plus size={15} /> Add your first floor
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Floor tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {plans.map((p) => {
          const isActive = p.id === activeId;
          const count = placedCountOn(p.id);
          return (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition ${
                isActive
                  ? "bg-orange-500 text-white border-orange-500 shadow-sm shadow-orange-200"
                  : "bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600"
              }`}
            >
              <Layers size={13} className={isActive ? "text-white" : "text-gray-400"} />
              <span className="max-w-[10rem] truncate" title={p.name}>{p.name}</span>
              {count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/25 text-white" : "bg-gray-100 text-gray-500"}`}>
                  {count}
                </span>
              )}
              {!p.imageUrl && (
                <span title="No image uploaded yet — hidden from customers" className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-white/70" : "bg-amber-400"}`} />
              )}
            </button>
          );
        })}
        <button
          onClick={addFloor}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-dashed border-gray-300 text-gray-500 hover:border-orange-400 hover:text-orange-600 transition"
        >
          <Plus size={14} /> Add floor
        </button>
      </div>

      {/* Active floor toolbar */}
      {activePlan && (confirmingDelete ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700 flex-1 min-w-[12rem]">
            Delete <strong className="break-all">{activePlan.name}</strong>? Its tables go back to the “not placed” tray.
          </p>
          <button
            onClick={deleteActiveFloor}
            className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
          >
            Delete floor
          </button>
          <button onClick={() => setConfirmingDelete(false)} className="text-gray-400 hover:text-gray-600 transition">
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-2.5">
          {/* Rename — commits on blur / Enter */}
          <div className="flex items-center gap-1.5 flex-1 min-w-[11rem] max-w-xs">
            <Pencil size={13} className="text-gray-400 flex-shrink-0" />
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              maxLength={40}
              aria-label="Floor name"
              className="w-full bg-transparent border-b border-transparent hover:border-gray-200 focus:border-orange-400 text-sm font-semibold text-gray-800 px-0.5 py-1 focus:outline-none transition"
            />
          </div>

          <label className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-3.5 py-2 rounded-xl cursor-pointer transition">
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
            {imageUrl ? "Replace image" : "Upload image"}
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
          </label>
          {imageUrl && (
            <button
              onClick={() => onPlansChange(plans.map((p) => (p.id === activePlan.id ? { ...p, imageUrl: "" } : p)))}
              className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:border-red-200 transition"
            >
              <X size={14} /> Remove image
            </button>
          )}
          <button
            onClick={() => setConfirmingDelete(true)}
            title="Delete this floor"
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:border-red-200 transition"
          >
            <Trash2 size={14} /> Delete floor
          </button>
          {imageUrl && (
            <span className="text-xs text-gray-400 ml-auto">{placed.length} placed · {unplaced.length} to place</span>
          )}
        </div>
      ))}

      {/* Table-marker size — per floor, applies to the customer map too */}
      {activePlan && imageUrl && (
        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
          <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">Table size</span>
          <input
            type="range" min={0.5} max={2.5} step={0.1} value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            onPointerUp={() => onPlansChange(plans.map((p) => (p.id === activePlan.id ? { ...p, markerScale: scale } : p)))}
            onTouchEnd={() => onPlansChange(plans.map((p) => (p.id === activePlan.id ? { ...p, markerScale: scale } : p)))}
            onKeyUp={() => onPlansChange(plans.map((p) => (p.id === activePlan.id ? { ...p, markerScale: scale } : p)))}
            className="flex-1 max-w-xs accent-orange-500 cursor-pointer"
          />
          <span className="text-xs text-gray-400 w-10 text-right tabular-nums">{Math.round(scale * 100)}%</span>
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{err}</span>
          <button onClick={() => setErr("")} className="text-red-500 hover:text-red-700 transition"><X size={14} /></button>
        </div>
      )}

      {!imageUrl ? (
        <div className="flex flex-col items-center py-16 gap-3 bg-white rounded-2xl border-2 border-dashed border-gray-200 text-center">
          <MapIcon size={32} className="text-gray-300" />
          <p className="font-semibold text-gray-600">No image for {activePlan?.name ?? "this floor"} yet</p>
          <p className="text-sm text-gray-400 max-w-xs">Upload a picture or diagram of this floor, then drag your tables onto it. Customers will see it when booking. Until then this floor stays hidden.</p>
        </div>
      ) : (
        <>
          {/* Canvas — centered and height-capped so a large upload doesn't dominate
              the panel. The ref box is inline-block so it shrinks to the rendered
              image, keeping the percentage-based marker coordinates aligned to it. */}
          <div className="flex justify-center">
          <div ref={containerRef} className="relative inline-block max-w-full rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={`${activePlan?.name ?? "Floor"} plan`} className="block w-auto h-auto max-w-full max-h-[60vh] pointer-events-none" draggable={false} />
            {placed.map((t) => {
              const p = posOf(t)!;
              const isSel = selected === t.id;
              return (
                <div
                  key={t.id}
                  onPointerDown={(e) => onMarkerDown(e, t.id)}
                  onPointerMove={(e) => onMarkerMove(e, t.id)}
                  onPointerUp={(e) => onMarkerUp(e, t.id)}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 touch-none cursor-grab active:cursor-grabbing ${dragId === t.id ? "z-20" : "z-10"}`}
                >
                  <div
                    style={{ width: mSize, height: mSize, fontSize: mFont }}
                    className={`flex flex-col items-center justify-center rounded-full border-2 shadow font-bold ${
                    t.isVip ? "bg-amber-100 border-amber-400 text-amber-800" : "bg-white border-orange-400 text-orange-700"
                  } ${isSel ? "ring-2 ring-offset-1 ring-blue-400" : ""}`}>
                    {t.isVip && <Crown size={mCrown} className="text-amber-500" />}
                    <span className="leading-none truncate px-0.5" style={{ maxWidth: mSize - 6 }}>{t.label}</span>
                  </div>
                  {isSel && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => { setSelected(null); setLocalPos((p2) => { const n = { ...p2 }; delete n[t.id]; return n; }); onSaveCoords(t.id, null, null, null); }}
                      title="Remove from map"
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          </div>
          <p className="text-xs text-gray-400">Drag a table to reposition it. Tap a placed table, then ✕ to take it off the map. A table can only sit on one floor.</p>

          {/* Unplaced tray — tables not on ANY floor */}
          {unplaced.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tables not placed on a floor</p>
              <div className="flex flex-wrap gap-2">
                {unplaced.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { if (!activeId) return; setSelected(t.id); onSaveCoords(t.id, 0.5, 0.5, activeId); }}
                    className="flex items-center gap-1.5 border border-dashed border-gray-300 rounded-xl px-3 py-1.5 text-sm text-gray-600 hover:border-orange-400 hover:text-orange-600 transition"
                  >
                    {t.isVip && <Crown size={12} className="text-amber-500" />}
                    <Plus size={12} /> {t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">Click a table to drop it on the centre of {activePlan?.name ?? "this floor"}, then drag it where it belongs.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function TableStatusPanel() {
  const { settings, updateSettings } = useApp();

  // The full DB list (including inactive tables) is the source of truth for
  // the unified card grid. Each mutation re-fetches and pushes the fresh list
  // into AppContext so other consumers (ReservationsPanel, POS, etc.) live-
  // update without a page refresh.
  const [allTables, setAllTables] = useState<DiningTable[]>([]);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  // Table ids occupied by an active dine-in order (seated walk-in, no reservation
  // row) — merged into the live state so this panel matches the waiter grid.
  const [orderOccupiedIds, setOrderOccupiedIds] = useState<Set<string>>(new Set());
  const [loadingRes, setLoadingRes] = useState(true);
  const [filterSection, setFilterSection] = useState("");

  // Grid (cards) vs. Floor Plan (drag-to-place map editor).
  const [view, setView] = useState<"grid" | "map">("grid");
  const [uploadingPlan, setUploadingPlan] = useState(false);
  // Named floor plans (legacy single-image settings fold into a one-element list).
  const floorPlans = resolveFloorPlans(settings.reservationSystem);
  // Latest reservationSystem block for async callbacks (an upload finishing
  // after a rename must not clobber it with the settings captured at click time).
  const rsRef = useRef(settings.reservationSystem);
  useEffect(() => { rsRef.current = settings.reservationSystem; }, [settings.reservationSystem]);

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

  // Snapshot of last server response so silent polls can skip setState when
  // nothing changed. Was the actual cause of the "page refreshing all the
  // time" flicker in Bug #25 — the Refresh button icon was spinning every 8s
  // because setLoadingRes(true) fired on every poll tick.
  const lastResKey = useRef<string>("");

  const fetchToday = useCallback(async (isInitial = false) => {
    // Only show the spinner on mount / manual refresh, not on background polls.
    if (isInitial) setLoadingRes(true);
    try {
      const params = new URLSearchParams({ from: todayStr(), to: todayStr() });
      // Reservations + live order-occupancy in parallel; handled independently.
      const [res, occRes] = await Promise.all([
        fetch(`/api/admin/reservations?${params}`),
        fetch(`/api/admin/table-occupancy`),
      ]);
      const json = await res.json() as { ok: boolean; reservations?: Reservation[] };
      if (json.ok) {
        const next = json.reservations ?? [];
        const key = JSON.stringify(next);
        if (key !== lastResKey.current) {
          lastResKey.current = key;
          setReservations(next);
        }
      }
      if (occRes.ok) {
        const occ = await occRes.json() as { ok: boolean; occupiedTableIds?: string[] };
        if (occ.ok && Array.isArray(occ.occupiedTableIds)) {
          setOrderOccupiedIds(new Set(occ.occupiedTableIds));
        }
      }
    } catch (err) {
      console.error("TableStatusPanel fetch:", err);
    } finally {
      if (isInitial) setLoadingRes(false);
    }
  }, []);

  useEffect(() => { refreshTables(); fetchToday(true); }, [refreshTables, fetchToday]);

  // Poll every 8 s — anon supabase realtime no longer fires after RLS revoke.
  // Silent (no spinner flicker) and skipped when the tab is hidden.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchToday();
    }, 8_000);
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

  // ── Floor-plan editor ───────────────────────────────────────────────────────

  // Persist the floor-plan list into reservationSystem settings (shallow merge —
  // updateSettings replaces top-level keys, so spread the existing block). The
  // legacy single-image fields mirror the first floor that has an image so any
  // reader still on them keeps working.
  const persistPlans = useCallback((plans: FloorPlan[]) => {
    const first = plans.find((p) => p.imageUrl);
    updateSettings({
      reservationSystem: {
        ...rsRef.current,
        floorPlans:           plans,
        floorPlanImageUrl:    first?.imageUrl ?? "",
        floorPlanMarkerScale: first?.markerScale ?? 1,
      },
    });
  }, [updateSettings]);

  async function handleUploadFloorPlan(floorId: string, file: File) {
    setTableError("");
    setUploadingPlan(true);
    try {
      const url = await uploadFloorPlanImage(file);
      // Re-resolve from the latest settings — the admin may have renamed or
      // added floors while the upload was in flight.
      const current = resolveFloorPlans(rsRef.current);
      persistPlans(current.map((p) => (p.id === floorId ? { ...p, imageUrl: url } : p)));
    } catch (err) {
      setTableError(err instanceof Error ? err.message : "Failed to upload floor plan.");
    } finally {
      setUploadingPlan(false);
    }
  }

  // Save a table's map position + floor (or nulls to take it off the map).
  // Optimistic local update first, then PATCH; refresh syncs context so the
  // customer map and other panels pick up the change.
  async function saveTableCoords(id: string, posX: number | null, posY: number | null, floorId: string | null) {
    setAllTables((prev) => prev.map((t) => (t.id === id ? { ...t, posX, posY, floorId } : t)));
    try {
      const res = await fetch(`/api/admin/dining-tables/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ posX, posY, floorId }),
      });
      if (!res.ok) setTableError("Failed to save table position.");
    } catch {
      setTableError("Failed to save table position.");
    } finally {
      refreshTables();
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

    // Seated walk-in (active dine-in order, no reservation row) is also occupied
    // — no reservation, so the card shows occupied without a check-out action.
    if (orderOccupiedIds.has(tableId)) return { state: "occupied" };

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

        <div className="flex flex-wrap items-center gap-2">
          {/* Grid ↔ Floor-plan toggle */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setView("grid")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                view === "grid" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <LayoutGrid size={14} /> Grid
            </button>
            <button
              onClick={() => setView("map")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                view === "map" ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <MapIcon size={14} /> Floor Plan
            </button>
          </div>
          {view === "grid" && (
            <button
              onClick={() => fetchToday(true)}
              disabled={loadingRes}
              className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition"
            >
              <RefreshCw size={14} className={loadingRes ? "animate-spin" : ""} />
              Refresh
            </button>
          )}
          {view === "grid" && !addingTable && !editingTable && (
            <button
              onClick={() => setAddingTable(true)}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition shadow-sm shadow-orange-200"
            >
              <Plus size={15} /> Add Table
            </button>
          )}
        </div>
      </div>

      {/* Inline error banner (shared by both views) */}
      {tableError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{tableError}</span>
          <button onClick={() => setTableError("")} className="text-red-500 hover:text-red-700 transition">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Floor-plan editor view */}
      {view === "map" ? (
        <FloorPlanEditor
          tables={allTables}
          plans={floorPlans}
          uploading={uploadingPlan}
          onPlansChange={persistPlans}
          onUpload={handleUploadFloorPlan}
          onSaveCoords={saveTableCoords}
        />
      ) : (
      <>
      {/* Grid view */}

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
        <div className="flex flex-col items-center py-16 gap-3 bg-white rounded-2xl border border-gray-200 text-center">
          <CalendarDays size={32} className="text-gray-300" />
          <p className="font-semibold text-gray-600">No tables in this section</p>
          <p className="text-sm text-gray-400">Pick another section or clear the filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 max-w-sm mx-auto sm:max-w-none">
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
      </>
      )}
    </div>
  );
}
