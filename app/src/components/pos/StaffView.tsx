"use client";

import { useRef, useState, useEffect } from "react";
import { usePOS } from "@/context/POSContext";
import { useConnectivity } from "@/lib/connectivity";
import { POSStaff } from "@/types/pos";
import {
  UserPlus, Clock, Timer, ToggleRight, ToggleLeft, Pencil, Trash2, X, ClockIcon,
  EyeOff,
  Eye,
} from "lucide-react";
import { fmtTime, getInitials } from "./_utils";

export default function StaffView() {
  const { staff, addPosStaff, updatePosStaff, deletePosStaff,
    clockEntries, clockIn, clockOut, isClocked, currentStaff, settings } = usePOS();
  const { isOnline } = useConnectivity();
  const sym = settings.currencySymbol;
  const [showAdd, setShowAdd] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: "", email: "", role: "cashier" as "admin" | "manager" | "cashier", password: "", hourlyRate: "" });
  const COLORS = ["#7c3aed", "#0891b2", "#16a34a", "#dc2626", "#ea580c", "#0284c7", "#9333ea", "#be185d"];
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 10000); return () => clearInterval(id); }, []);

  // Edit state
  const [editingStaff, setEditingStaff] = useState<POSStaff | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", email: "", role: "cashier" as "admin" | "manager" | "cashier", password: "", hourlyRate: "" });

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Inline two-stage confirm for deactivation — toggleActive turns
  // destructive when the operator is disabling someone (especially admin),
  // so we require an explicit second click before sending the PATCH.
  const [deactivateConfirm, setDeactivateConfirm] = useState<string | null>(null);

  // In-flight guards — save/add are global, toggle/delete are per-row so two
  // different rows can mutate in parallel.
  const addInFlight = useRef(false);
  const saveInFlight = useRef(false);
  const deleteInFlight = useRef<Set<string>>(new Set());
  const toggleInFlight = useRef<Set<string>>(new Set());
  const clockInFlight = useRef(false);
  const [addBusy, setAddBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [clockBusy, setClockBusy] = useState(false);

  // Double-click guard for the self clock-in/out button (QA #32). Without
  // this a rapid second click fires a second API request that 409s/404s.
  async function toggleClock(staffId: string, currentlyClocked: boolean) {
    if (!isOnline) return; // read-only offline (server write)
    if (clockInFlight.current) return;
    clockInFlight.current = true;
    setClockBusy(true);
    try {
      if (currentlyClocked) await clockOut(staffId);
      else await clockIn(staffId);
    } finally {
      clockInFlight.current = false;
      setClockBusy(false);
    }
  }

  async function addStaff() {
    if (addInFlight.current) return;
    if (!newStaff.name.trim() || newStaff.password.trim().length < 6) return;
    addInFlight.current = true;
    setAddBusy(true);
    try {
      const result = await addPosStaff({
        name: newStaff.name.trim(),
        email: newStaff.email,
        role: newStaff.role,
        password: newStaff.password,
        hourlyRate: parseFloat(newStaff.hourlyRate) || undefined,
        avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
      if (!result.ok) return;
      setNewStaff({ name: "", email: "", role: "cashier", password: "", hourlyRate: "" });
      setShowAdd(false);
    } finally {
      addInFlight.current = false;
      setAddBusy(false);
    }
  }

  function openEdit(member: POSStaff) {
    // password field starts blank: the server never returns real passwords to the
    // browser, and saveEdit sends "" to mean "keep existing".
    setEditingStaff(member);
    setEditDraft({ name: member.name, email: member.email ?? "", role: member.role, password: "", hourlyRate: member.hourlyRate?.toString() ?? "" });
  }

  async function saveEdit() {
    if (saveInFlight.current) return;
    if (!editingStaff || !editDraft.name.trim()) return;
    if (editDraft.password && editDraft.password.trim().length < 6) return;
    saveInFlight.current = true;
    setSaveBusy(true);
    try {
      // Role is intentionally omitted — the API rejects role/permission
      // changes from any non-website-admin session, so in-POS edits must not
      // include them even when the value is unchanged.
      const result = await updatePosStaff(editingStaff.id, {
        name: editDraft.name.trim(),
        email: editDraft.email,
        password: editDraft.password || undefined, // "" → omit, server keeps existing
        hourlyRate: parseFloat(editDraft.hourlyRate) || undefined,
      });
      if (!result.ok) return;
      setEditingStaff(null);
    } finally {
      saveInFlight.current = false;
      setSaveBusy(false);
    }
  }

  async function deleteStaff(staffId: string) {
    if (deleteInFlight.current.has(staffId)) return;
    deleteInFlight.current.add(staffId);
    try {
      const result = await deletePosStaff(staffId);
      if (!result.ok) return;
      setDeleteConfirm(null);
    } finally {
      deleteInFlight.current.delete(staffId);
    }
  }

  async function toggleActive(staffId: string) {
    if (!isOnline) return; // read-only offline (server write)
    if (toggleInFlight.current.has(staffId)) return;
    const member = staff.find((s) => s.id === staffId);
    if (!member) return;
    // Deactivation requires an explicit confirm (matches the inline pattern
    // used for delete) — activating an inactive member is fine immediately.
    if (member.active && deactivateConfirm !== staffId) {
      setDeactivateConfirm(staffId);
      return;
    }
    setDeactivateConfirm(null);
    toggleInFlight.current.add(staffId);
    try {
      await updatePosStaff(staffId, { active: !member.active });
    } finally {
      toggleInFlight.current.delete(staffId);
    }
  }

  // Today's clock entries
  const today = new Date().toDateString();
  const todayEntries = clockEntries.filter((e) => new Date(e.clockIn).toDateString() === today);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <h2 className="text-white font-bold text-xl">Staff Management</h2>
          <button onClick={() => setShowAdd(true)} disabled={!isOnline} className={`flex items-center gap-2 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors ${isOnline ? "bg-orange-500 hover:bg-orange-400" : "bg-slate-700 opacity-50 cursor-not-allowed"}`}>
            <UserPlus size={16} /> Add Staff
          </button>
        </div>
        {!isOnline && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
            <p className="text-amber-300 text-xs">Read-only while offline — staff changes need an internet connection. Reconnect to add or edit staff.</p>
          </div>
        )}

        {/* Clock in/out panel — the API is session-scoped (cannot clock another
            staff member in/out without payroll forgery), so only the currently
            logged-in cashier sees an action button. Everyone else's tile is
            read-only status. */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 sm:p-5">
          <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2"><Clock size={16} className="text-orange-400" /> Today&apos;s Attendance</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {staff.filter((s) => s.active).map((member) => {
              const clocked = isClocked(member.id);
              const lastEntry = [...clockEntries].reverse().find((e) => e.staffId === member.id && new Date(e.clockIn).toDateString() === today);
              const minutesWorked = lastEntry
                ? clocked
                  ? Math.floor((Date.now() - new Date(lastEntry.clockIn).getTime()) / 60000)
                  : (lastEntry.totalMinutes ?? 0)
                : null;
              const isSelf = currentStaff?.id === member.id;

              return (
                <div key={member.id} className="bg-slate-700/50 border border-slate-600 rounded-xl p-4 flex flex-wrap items-center gap-3">
                  <div className="flex flex-row gap-3 items-center">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-bold text-[13px] sm:text-sm text-white flex-shrink-0" style={{ backgroundColor: member.avatarColor }}>
                      {getInitials(member.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold">
                        {member.name}
                        {isSelf && <span className="ml-2 text-[10px] text-orange-400 font-semibold uppercase tracking-wide">You</span>}
                      </p>
                      <p className="text-slate-400 text-xs capitalize">{member.role}</p>
                      {minutesWorked !== null && (
                        <p className="text-slate-400 text-xs mt-0.5 flex items-center gap-1 flex-shrink-0">
                          <Timer size={10} /> {Math.floor(minutesWorked / 60)}h {minutesWorked % 60}m {clocked ? "(ongoing)" : ""}
                        </p>
                      )}
                    </div>
                  </div>

                  {isSelf ? (
                    <button
                      onClick={() => { void toggleClock(member.id, clocked); }}
                      disabled={clockBusy}
                      className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed ${clocked
                        ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                        : "bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30"
                        }`}
                    >
                      {clockBusy ? "…" : clocked ? "Clock Out" : "Clock In"}
                    </button>
                  ) : (
                    <span className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${clocked
                      ? "bg-green-500/10 text-green-400 border border-green-500/20"
                      : "bg-slate-600/40 text-slate-400 border border-slate-600"
                      }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${clocked ? "bg-green-400 animate-pulse" : "bg-slate-500"}`} />
                      {clocked ? "Clocked in" : "Off"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Staff list */}
        <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h3 className="text-white font-semibold text-sm">All Staff Members</h3>
          </div>
          <div className="divide-y divide-slate-700/50">
            {staff.map((member) => (
              <div key={member.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-row gap-4">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-bold text-[13px] sm:text-sm text-white flex-shrink-0 opacity-100" style={{ backgroundColor: member.avatarColor, opacity: member.active ? 1 : 0.5 }}>
                    {getInitials(member.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-semibold ${member.active ? "text-white" : "text-slate-500"}`}>{member.name}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize ${member.role === "admin" ? "bg-purple-500/20 text-purple-400" :
                        member.role === "manager" ? "bg-blue-500/20 text-blue-400" :
                          "bg-slate-600 text-slate-400"
                        }`}>{member.role}</span>
                    </div>
                    <p className="text-slate-400 text-xs mt-0.5">{member.email} · Password: ••••••</p>
                    {member.hourlyRate && <p className="text-slate-500 text-xs">{sym}{member.hourlyRate}/hr</p>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isClocked(member.id) && (
                    <span className="flex items-center gap-1 text-[10px] bg-green-500/20 text-green-400 px-2 py-1 rounded-full font-semibold">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Clocked in
                    </span>
                  )}
                  {deactivateConfirm === member.id ? (
                    <span className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1">
                      <span className="text-amber-300 text-[11px] font-semibold">Deactivate?</span>
                      <button
                        onClick={() => toggleActive(member.id)}
                        className="text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 px-2 py-0.5 rounded"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setDeactivateConfirm(null)}
                        className="text-slate-400 hover:text-white"
                        aria-label="Cancel deactivate"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => toggleActive(member.id)}
                      disabled={member.id === currentStaff?.id}
                      title={member.id === currentStaff?.id ? "Cannot deactivate yourself" : ""}
                      className={`transition-colors ${member.id === currentStaff?.id ? "opacity-30 cursor-not-allowed" : "hover:text-orange-400"}`}
                    >
                      {member.active
                        ? <ToggleRight size={24} className="text-green-400" />
                        : <ToggleLeft size={24} className="text-slate-500" />}
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(member)}
                    disabled={!isOnline}
                    title={!isOnline ? "Reconnect to edit" : "Edit staff member"}
                    className="text-slate-400 hover:text-orange-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(member.id)}
                    disabled={!isOnline || member.id === currentStaff?.id}
                    title={member.id === currentStaff?.id ? "Cannot delete yourself" : "Delete staff member"}
                    className={`transition-colors ${member.id === currentStaff?.id ? "opacity-50 cursor-not-allowed" : "text-slate-400 hover:text-red-400"}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Clock history */}
        {todayEntries.length > 0 && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4 flex items-center gap-2"><ClockIcon size={16} className="text-slate-400" /> Today&apos;s Clock Entries</h3>
            <div className="space-y-2">
              {todayEntries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-slate-700/50 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0">
                    {getInitials(entry.staffName)}
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-sm font-medium">{entry.staffName}</p>
                    <p className="text-slate-400 text-xs">In: {fmtTime(entry.clockIn)} {entry.clockOut ? `· Out: ${fmtTime(entry.clockOut)}` : "· Still clocked in"}</p>
                  </div>
                  {entry.totalMinutes !== undefined && (
                    <p className="text-slate-300 text-sm font-semibold">{Math.floor(entry.totalMinutes / 60)}h {entry.totalMinutes % 60}m</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add staff modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Add Staff Member</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Full Name *</label>
                <input value={newStaff.name} onChange={(e) => setNewStaff((p) => ({ ...p, name: e.target.value }))} placeholder="Staff name"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Email</label>
                <input value={newStaff.email} onChange={(e) => setNewStaff((p) => ({ ...p, email: e.target.value }))} placeholder="email@example.com"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Role</label>
                <div className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-300 text-sm flex items-center justify-between">
                  <span>Cashier</span>
                  <span className="text-[10px] text-slate-500">Manager / Admin: set from admin panel</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Password (min 6) *</label>
                <div className="relative">
                  <input type={showPwd ? "text" : "password"} value={newStaff.password} onChange={(e) => setNewStaff((p) => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                  <EyeToggle show={showPwd} onToggle={() => setShowPwd((v) => !v)} />
                </div>

              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Hourly Rate ({sym})</label>
                <input type="number" step="0.5" value={newStaff.hourlyRate} onChange={(e) => setNewStaff((p) => ({ ...p, hourlyRate: e.target.value }))} placeholder="10.00"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShowAdd(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={addStaff} disabled={addBusy || !newStaff.name.trim() || newStaff.password.trim().length < 6}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{addBusy ? "Saving…" : "Add"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit staff modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">Edit Staff Member</h3>
              <button onClick={() => setEditingStaff(null)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Full Name *</label>
                <input value={editDraft.name} onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Staff name"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Email</label>
                <input value={editDraft.email} onChange={(e) => setEditDraft((p) => ({ ...p, email: e.target.value }))} placeholder="email@example.com"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Role</label>
                <div className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-300 text-sm flex items-center justify-between">
                  <span className="capitalize">{editDraft.role}</span>
                  <span className="text-[10px] text-slate-500">Change role from admin panel</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Password (min 6)</label>
                <input type="password" value={editDraft.password} onChange={(e) => setEditDraft((p) => ({ ...p, password: e.target.value }))} placeholder="Leave blank to keep current"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Hourly Rate ({sym})</label>
                <input type="number" step="0.5" value={editDraft.hourlyRate} onChange={(e) => setEditDraft((p) => ({ ...p, hourlyRate: e.target.value }))} placeholder="10.00"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setEditingStaff(null)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={saveBusy || !editDraft.name.trim() || (editDraft.password.trim().length > 0 && editDraft.password.trim().length < 6)}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{saveBusy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-5 shadow-2xl text-center">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={22} className="text-red-400" />
            </div>
            <h3 className="text-white font-bold mb-1">Delete Staff Member?</h3>
            <p className="text-slate-400 text-sm mb-5">
              {staff.find((s) => s.id === deleteConfirm)?.name} will be permanently removed. This cannot be undone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={() => deleteStaff(deleteConfirm)} className="py-3 rounded-xl bg-red-500 hover:bg-red-400 text-white font-semibold text-sm transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EyeToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} tabIndex={-1}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition">
      {show ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  );
}