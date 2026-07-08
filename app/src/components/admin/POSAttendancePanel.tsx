"use client";

/**
 * Attendance & Wages — sub-tab of /admin?tab=pos-staff.
 *
 * Long-period POS clock records (not just today): per-staff shifts, hours and
 * wages (hours × the hourly rate captured on the staff row), an expandable
 * per-entry detail, CSV export for payroll, and an admin repair action that
 * closes a forgotten open entry (which otherwise accrues unbounded hours AND
 * blocks that person's next clock-in).
 *
 * Wage figures count COMPLETED entries only — an open shift shows as
 * "in progress" and joins payroll once it's closed, so the payable number
 * never shrinks when someone clocks out.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clock, Download, RefreshCw, ChevronDown, ChevronUp, AlertTriangle, Banknote,
} from "lucide-react";
import { useApp } from "@/context/AppContext";

interface ClockEntry {
  id: string;
  staffId: string;
  staffName: string;
  clockIn: string;
  clockOut?: string;
  totalMinutes?: number;
  notes?: string;
}

interface StaffMeta {
  id: string;
  name: string;
  role: string;
  active: boolean;
  hourlyRate?: number;
  avatarColor: string;
}

type Period = "today" | "yesterday" | "week" | "month" | "last30" | "custom";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today",     label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week",      label: "This Week" },
  { id: "month",     label: "This Month" },
  { id: "last30",    label: "Last 30 Days" },
  { id: "custom",    label: "Custom" },
];

function getDateRange(period: Period, customStart: string, customEnd: string): [Date, Date] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (period) {
    case "today": return [today, endOfToday];
    case "yesterday": {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      const ye = new Date(today); ye.setMilliseconds(-1);
      return [y, ye];
    }
    case "week": {
      const w = new Date(today); w.setDate(w.getDate() - 6);
      return [w, endOfToday];
    }
    case "month": return [new Date(today.getFullYear(), today.getMonth(), 1), endOfToday];
    case "last30": { const l = new Date(today); l.setDate(l.getDate() - 29); return [l, endOfToday]; }
    case "custom": return [
      customStart ? new Date(customStart) : new Date(0),
      customEnd ? new Date(customEnd + "T23:59:59") : endOfToday,
    ];
  }
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const fmtHours = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;
const initials = (name: string) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export default function POSAttendancePanel() {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";

  const [entries, setEntries] = useState<ClockEntry[]>([]);
  const [staff, setStaff] = useState<StaffMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [period, setPeriod] = useState<Period>("week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [startDate, endDate] = useMemo(
    () => getDateRange(period, customStart, customEnd),
    [period, customStart, customEnd],
  );

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError("");
    try {
      const params = new URLSearchParams({
        from: startDate.toISOString(),
        to: endDate.toISOString(),
      });
      const res = await fetch(`/api/admin/pos-clock?${params}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; entries?: ClockEntry[]; staff?: StaffMeta[]; error?: string };
      if (!res.ok || !json.ok) { setError(json.error ?? "Failed to load attendance."); return; }
      setEntries(json.entries ?? []);
      setStaff(json.staff ?? []);
    } catch {
      setError("Connection error.");
    } finally {
      setLoaded(true);
      if (isRefresh) setRefreshing(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { void load(); }, [load]);

  // Close a forgotten open entry (admin repair). Guarded server-side, so a
  // race with the staff member's own clock-out just 409s harmlessly.
  const closingIds = useRef<Set<string>>(new Set());
  async function closeEntry(id: string) {
    if (closingIds.current.has(id)) return;
    closingIds.current.add(id);
    try {
      const res = await fetch(`/api/admin/pos-clock/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) setError(json.error ?? "Could not close the entry.");
      await load(true);
    } finally {
      closingIds.current.delete(id);
    }
  }

  // ── Per-staff aggregation ───────────────────────────────────────────────────
  const rows = useMemo(() => {
    const byStaff = new Map<string, ClockEntry[]>();
    for (const e of entries) {
      const list = byStaff.get(e.staffId) ?? [];
      list.push(e);
      byStaff.set(e.staffId, list);
    }
    const metaById = new Map(staff.map((s) => [s.id, s]));

    return Array.from(byStaff.entries()).map(([staffId, list]) => {
      const meta = metaById.get(staffId);
      const completed = list.filter((e) => e.clockOut);
      const open = list.filter((e) => !e.clockOut);
      const minutes = completed.reduce((s, e) => s + (e.totalMinutes ?? 0), 0);
      const rate = meta?.hourlyRate;
      const wage = rate != null ? parseFloat(((minutes / 60) * rate).toFixed(2)) : null;
      return {
        staffId,
        name: meta?.name ?? list[0].staffName,
        role: meta?.role ?? "—",
        avatarColor: meta?.avatarColor ?? "#475569",
        shifts: completed.length,
        openCount: open.length,
        minutes,
        rate,
        wage,
        entries: list,
      };
    }).sort((a, b) => b.minutes - a.minutes);
  }, [entries, staff]);

  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  const totalWages = rows.reduce((s, r) => s + (r.wage ?? 0), 0);
  const openTotal = rows.reduce((s, r) => s + r.openCount, 0);

  // ── CSV export (payroll) ────────────────────────────────────────────────────
  function exportCSV() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(`# POS Attendance - ${startDate.toLocaleDateString("en-GB")} - ${endDate.toLocaleDateString("en-GB")}`);
    lines.push(["Staff", "Role", "Completed Shifts", "Hours", `Hourly Rate (${sym})`, `Wage (${sym})`, "Open Entries"].map(esc).join(","));
    for (const r of rows) {
      lines.push([r.name, r.role, r.shifts, (r.minutes / 60).toFixed(2), r.rate?.toFixed(2) ?? "", r.wage?.toFixed(2) ?? "", r.openCount].map(esc).join(","));
    }
    lines.push(["TOTAL", "", rows.reduce((s, r) => s + r.shifts, 0), (totalMinutes / 60).toFixed(2), "", totalWages.toFixed(2), openTotal].map(esc).join(","));
    lines.push("");
    lines.push(["Staff", "Date", "Clock In", "Clock Out", "Minutes", "Notes"].map(esc).join(","));
    for (const e of entries) {
      lines.push([e.staffName, fmtDate(e.clockIn), fmtTime(e.clockIn), e.clockOut ? fmtTime(e.clockOut) : "OPEN", e.totalMinutes ?? "", e.notes ?? ""].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `pos-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Period picker + actions */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${period === p.id ? "bg-orange-500 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
            >
              {p.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => void load(true)} disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs font-medium hover:text-white transition disabled:opacity-50">
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={exportCSV} disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition disabled:opacity-50">
              <Download size={13} /> Export CSV
            </button>
          </div>
        </div>
        {period === "custom" && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-orange-500" />
            <span className="text-gray-500 text-xs">to</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-orange-500" />
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3">
          <AlertTriangle size={15} className="text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Totals strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <Clock size={16} className="text-blue-400 mb-2" />
          <p className="text-white text-lg font-bold">{fmtHours(totalMinutes)}</p>
          <p className="text-gray-500 text-xs">Total hours (completed)</p>
        </div>
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <Banknote size={16} className="text-green-400 mb-2" />
          <p className="text-white text-lg font-bold">{sym}{totalWages.toFixed(2)}</p>
          <p className="text-gray-500 text-xs">Total wages</p>
        </div>
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <AlertTriangle size={16} className={openTotal > 0 ? "text-amber-400 mb-2" : "text-gray-600 mb-2"} />
          <p className="text-white text-lg font-bold">{openTotal}</p>
          <p className="text-gray-500 text-xs">Still clocked in</p>
        </div>
      </div>

      {/* Per-staff table */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
        {!loaded ? (
          <div className="p-8 text-center text-gray-500 text-sm">Loading attendance…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <Clock size={32} className="text-gray-700 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No clock entries in this period.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {rows.map((r) => (
              <div key={r.staffId}>
                <button
                  onClick={() => setExpanded(expanded === r.staffId ? null : r.staffId)}
                  className="w-full p-4 flex items-center gap-3 hover:bg-gray-800/40 transition text-left"
                >
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: r.avatarColor }}>
                    {initials(r.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{r.name} <span className="text-gray-500 text-xs capitalize">· {r.role}</span></p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {r.shifts} shift{r.shifts !== 1 ? "s" : ""}
                      {r.openCount > 0 && <span className="text-amber-400"> · {r.openCount} in progress</span>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-white text-sm font-bold tabular-nums">{fmtHours(r.minutes)}</p>
                    <p className="text-xs tabular-nums mt-0.5">
                      {r.wage != null
                        ? <span className="text-green-400 font-semibold">{sym}{r.wage.toFixed(2)}</span>
                        : <span className="text-gray-600">no rate set</span>}
                      {r.rate != null && <span className="text-gray-500"> · {sym}{r.rate}/hr</span>}
                    </p>
                  </div>
                  {expanded === r.staffId ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                </button>

                {expanded === r.staffId && (
                  <div className="px-4 pb-4">
                    <div className="bg-gray-950/60 rounded-xl border border-gray-800 divide-y divide-gray-800/60">
                      {r.entries.map((e) => (
                        <div key={e.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-300 text-xs font-medium">{fmtDate(e.clockIn)}</p>
                            <p className="text-gray-500 text-xs mt-0.5">
                              In {fmtTime(e.clockIn)} {e.clockOut ? `· Out ${fmtTime(e.clockOut)}` : ""}
                              {e.notes ? ` · ${e.notes}` : ""}
                            </p>
                          </div>
                          {e.clockOut ? (
                            <span className="text-gray-300 text-xs font-semibold tabular-nums">{fmtHours(e.totalMinutes ?? 0)}</span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <span className="flex items-center gap-1 text-[10px] bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded-full font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> in progress
                              </span>
                              <button
                                onClick={() => void closeEntry(e.id)}
                                title="Close this entry now (forgot to clock out)"
                                className="text-[10px] font-bold bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 px-2 py-1 rounded-lg transition"
                              >
                                Close entry
                              </button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-gray-600 text-xs">
        Wages = completed hours × the hourly rate on each staff profile. Open shifts join payroll once closed —
        use &quot;Close entry&quot; if someone forgot to clock out.
      </p>
    </div>
  );
}
