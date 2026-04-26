"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { ReservationCustomer } from "@/types";
import {
  Users, Search, Mail, Phone, CalendarDays, Tag, FileDown,
  ChevronDown, ChevronUp, Loader2, RefreshCw, CheckCircle2,
  ToggleLeft, ToggleRight, X, Plus, Star, Clock, UtensilsCrossed,
  ShoppingBag, TrendingUp,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmt12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

const STATUS_BADGE: Record<string, string> = {
  pending:     "bg-amber-50 text-amber-700 border-amber-200",
  confirmed:   "bg-green-50 text-green-700 border-green-200",
  checked_in:  "bg-blue-50 text-blue-700 border-blue-200",
  checked_out: "bg-teal-50 text-teal-700 border-teal-200",
  cancelled:   "bg-red-50 text-red-700 border-red-200",
  no_show:     "bg-gray-100 text-gray-600 border-gray-300",
};

const PRESET_TAGS = ["VIP", "Regular", "Birthday", "Anniversary", "Vegetarian", "Allergy", "Corporate", "Follow up"];

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCsv(customers: ReservationCustomer[]) {
  const header = ["Name", "Email", "Phone", "Reservations", "Online Orders", "Total Spend (£)", "First Activity", "Last Order", "Last Reservation", "Marketing Opt-in", "Tags", "Notes"];
  const rows = customers.map((c) => [
    c.name,
    c.email,
    c.phone,
    c.visitCount,
    c.orderCount ?? 0,
    (c.totalSpend ?? 0).toFixed(2),
    fmtDate(c.firstVisitAt),
    fmtDate(c.lastOrderAt),
    fmtDate(c.lastVisitAt),
    c.marketingOptIn ? "Yes" : "No",
    c.tags.join("; "),
    c.notes.replace(/\n/g, " "),
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `reservation-customers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Reservation history row ──────────────────────────────────────────────────

interface HistoryEntry {
  id: string;
  date: string;
  time: string;
  table_label: string;
  party_size: number;
  status: string;
  note?: string;
  checked_in_at?: string;
  checked_out_at?: string;
}

function HistoryRow({ r }: { r: HistoryEntry }) {
  const badge = STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-600 border-gray-200";
  const [y, mo, d] = r.date.split("-").map(Number);
  const dateLabel = new Date(y, mo - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-800">{dateLabel}</span>
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Clock size={10} /> {fmt12(r.time)}
          </span>
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <UtensilsCrossed size={10} /> {r.table_label}
          </span>
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Users size={10} /> {r.party_size}
          </span>
        </div>
        {r.note && <p className="text-xs text-amber-700 italic mt-0.5 truncate">&ldquo;{r.note}&rdquo;</p>}
      </div>
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize flex-shrink-0 ${badge}`}>
        {r.status.replace("_", " ")}
      </span>
    </div>
  );
}

// ─── Customer card ────────────────────────────────────────────────────────────

function CustomerCard({ customer, onSave }: {
  customer: ReservationCustomer;
  onSave: (id: string, patch: { notes?: string; tags?: string[]; marketingOptIn?: boolean }) => Promise<void>;
}) {
  const [expanded,   setExpanded]   = useState(false);
  const [notes,      setNotes]      = useState(customer.notes);
  const [tags,       setTags]       = useState<string[]>(customer.tags);
  const [optIn,      setOptIn]      = useState(customer.marketingOptIn);
  const [tagInput,   setTagInput]   = useState("");
  const [history,    setHistory]    = useState<HistoryEntry[]>([]);
  const [loadingHist,setLoadingHist]= useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const dirty = notes !== customer.notes || JSON.stringify(tags) !== JSON.stringify(customer.tags) || optIn !== customer.marketingOptIn;

  async function loadHistory() {
    if (history.length > 0) return;
    setLoadingHist(true);
    try {
      const res  = await fetch(`/api/admin/reservation-customers/${customer.id}/reservations`);
      const json = await res.json() as { ok: boolean; reservations?: HistoryEntry[] };
      if (json.ok) setHistory(json.reservations ?? []);
    } finally {
      setLoadingHist(false);
    }
  }

  function toggleExpand() {
    setExpanded((v) => !v);
    if (!expanded) loadHistory();
  }

  async function save() {
    setSaving(true);
    await onSave(customer.id, { notes, tags, marketingOptIn: optIn });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function addTag(tag: string) {
    const t = tag.trim();
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((x) => x !== tag));
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 transition">
      {/* Summary row */}
      <button
        onClick={toggleExpand}
        className="w-full text-left px-5 py-4 flex items-center gap-4"
      >
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
          <span className="text-orange-700 font-bold text-sm">
            {customer.name.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{customer.name}</span>
            {customer.marketingOptIn && (
              <span className="text-[10px] font-semibold bg-green-50 border border-green-200 text-green-700 px-1.5 py-0.5 rounded-full">
                Marketing
              </span>
            )}
            {customer.tags.map((tag) => (
              <span key={tag} className="text-[10px] font-semibold bg-orange-50 border border-orange-200 text-orange-700 px-1.5 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1"><Mail size={10} />{customer.email}</span>
            {customer.phone && <span className="flex items-center gap-1"><Phone size={10} />{customer.phone}</span>}
            {customer.visitCount > 0 && (
              <span className="flex items-center gap-1"><Star size={10} className="text-orange-400" />{customer.visitCount} reservation{customer.visitCount !== 1 ? "s" : ""}</span>
            )}
            {customer.orderCount > 0 && (
              <span className="flex items-center gap-1 text-blue-600"><ShoppingBag size={10} />{customer.orderCount} order{customer.orderCount !== 1 ? "s" : ""}</span>
            )}
            {customer.totalSpend > 0 && (
              <span className="flex items-center gap-1 text-emerald-600"><TrendingUp size={10} />£{customer.totalSpend.toFixed(2)} spent</span>
            )}
            {(customer.lastOrderAt || customer.lastVisitAt) && (
              <span className="flex items-center gap-1">
                <CalendarDays size={10} />Last: {fmtDate(customer.lastOrderAt ?? customer.lastVisitAt)}
              </span>
            )}
          </div>
        </div>

        {/* Expand icon */}
        <div className="text-gray-400 flex-shrink-0">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-5 bg-gray-50/50">

          {/* Marketing opt-in toggle */}
          <div className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Marketing Communications</p>
              <p className="text-xs text-gray-400 mt-0.5">Customer has agreed to receive offers and promotions</p>
            </div>
            <button
              onClick={() => setOptIn((v) => !v)}
              className={`flex items-center transition ${optIn ? "text-green-500" : "text-gray-300 hover:text-gray-400"}`}
            >
              {optIn ? <ToggleRight size={30} /> : <ToggleLeft size={30} />}
            </button>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
              <Tag size={11} /> Tags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 text-xs bg-orange-50 border border-orange-200 text-orange-700 px-2.5 py-1 rounded-full font-medium">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-600 transition ml-0.5">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            {/* Preset tags */}
            <div className="flex flex-wrap gap-1">
              {PRESET_TAGS.filter((t) => !tags.includes(t)).map((t) => (
                <button
                  key={t}
                  onClick={() => addTag(t)}
                  className="text-[11px] text-gray-500 hover:text-orange-600 border border-dashed border-gray-300 hover:border-orange-300 px-2 py-0.5 rounded-full transition"
                >
                  + {t}
                </button>
              ))}
            </div>
            {/* Custom tag input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); } }}
                placeholder="Custom tag…"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-400 transition"
              />
              <button
                onClick={() => addTag(tagInput)}
                disabled={!tagInput.trim()}
                className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-orange-600 hover:border-orange-300 transition disabled:opacity-40"
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Dietary requirements, preferences, follow-up reminders…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition resize-none"
            />
          </div>

          {/* Save button */}
          {dirty && (
            <button
              onClick={save}
              disabled={saving}
              className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-all ${
                saved ? "bg-green-100 text-green-700" : "bg-orange-500 hover:bg-orange-600 text-white"
              }`}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CheckCircle2 size={13} /> : null}
              {saving ? "Saving…" : saved ? "Saved!" : "Save changes"}
            </button>
          )}

          {/* Online order summary */}
          {(customer.orderCount > 0 || customer.totalSpend > 0) && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                <ShoppingBag size={11} /> Online Orders
              </p>
              <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex flex-wrap gap-4">
                <div>
                  <div className="text-lg font-bold text-blue-700">{customer.orderCount}</div>
                  <div className="text-xs text-gray-400">order{customer.orderCount !== 1 ? "s" : ""} placed</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-emerald-700">£{customer.totalSpend.toFixed(2)}</div>
                  <div className="text-xs text-gray-400">total spend</div>
                </div>
                {customer.lastOrderAt && (
                  <div>
                    <div className="text-sm font-semibold text-gray-700">{fmtDate(customer.lastOrderAt)}</div>
                    <div className="text-xs text-gray-400">last order</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reservation history */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Reservation History</p>
            {loadingHist ? (
              <div className="flex justify-center py-4">
                <Loader2 size={18} className="animate-spin text-orange-500" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No reservation history yet.</p>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 px-4 py-1 divide-y divide-gray-50">
                {history.map((r) => <HistoryRow key={r.id} r={r} />)}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ReservationCustomersPanel() {
  const [customers,    setCustomers]    = useState<ReservationCustomer[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState("");
  const [filterTag,    setFilterTag]    = useState("");
  const [filterOptIn,  setFilterOptIn]  = useState(false);
  const [filterOrders, setFilterOrders] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/admin/reservation-customers");
      const json = await res.json() as { ok: boolean; customers?: ReservationCustomer[] };
      if (json.ok) setCustomers(json.customers ?? []);
    } catch (err) {
      console.error("ReservationCustomersPanel fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  useEffect(() => {
    const ch = supabase
      .channel("reservation-customers-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservation_customers" }, fetchCustomers)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchCustomers]);

  async function handleSave(
    id: string,
    patch: { notes?: string; tags?: string[]; marketingOptIn?: boolean },
  ) {
    const res = await fetch(`/api/admin/reservation-customers/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(patch),
    });
    if (res.ok) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                ...(patch.notes           !== undefined ? { notes:          patch.notes }           : {}),
                ...(patch.tags            !== undefined ? { tags:           patch.tags }            : {}),
                ...(patch.marketingOptIn  !== undefined ? { marketingOptIn: patch.marketingOptIn }  : {}),
              }
            : c
        )
      );
    }
  }

  // All unique tags across all customers
  const allTags = [...new Set(customers.flatMap((c) => c.tags))].sort();

  const filtered = customers.filter((c) => {
    if (filterOptIn  && !c.marketingOptIn)        return false;
    if (filterOrders && (c.orderCount ?? 0) === 0) return false;
    if (filterTag    && !c.tags.includes(filterTag)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const optInCount = customers.filter((c) => c.marketingOptIn).length;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-4 flex items-center gap-4">
        <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Users size={20} className="text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-gray-900">Guest Profiles</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {customers.length} guests · {optInCount} opted in for marketing
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:border-gray-300 transition disabled:opacity-40"
          >
            <FileDown size={14} /> Export CSV
          </button>
          <button
            onClick={fetchCustomers}
            disabled={loading}
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total guests",      value: customers.length,                                                    bg: "bg-gray-50",    border: "border-gray-200",   text: "text-gray-800"   },
          { label: "Online orders",     value: customers.reduce((s, c) => s + (c.orderCount ?? 0), 0),             bg: "bg-blue-50",    border: "border-blue-200",   text: "text-blue-700"   },
          { label: "Total revenue",     value: `£${customers.reduce((s, c) => s + (c.totalSpend ?? 0), 0).toFixed(2)}`, bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" },
          { label: "Marketing opt-in",  value: optInCount,                                                          bg: "bg-green-50",   border: "border-green-200",  text: "text-green-700"  },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3.5`}>
            <div className={`text-xl font-bold ${s.text}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[180px] border border-gray-200 rounded-xl px-3 py-2">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm focus:outline-none placeholder-gray-400"
          />
        </div>

        {allTags.length > 0 && (
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition"
          >
            <option value="">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}

        <button
          onClick={() => setFilterOrders((v) => !v)}
          className={`flex items-center gap-1.5 border rounded-xl px-3 py-2 text-sm font-medium transition ${
            filterOrders
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "border-gray-200 text-gray-500 hover:border-gray-300"
          }`}
        >
          <ShoppingBag size={13} />
          Has online orders
        </button>

        <button
          onClick={() => setFilterOptIn((v) => !v)}
          className={`flex items-center gap-1.5 border rounded-xl px-3 py-2 text-sm font-medium transition ${
            filterOptIn
              ? "bg-green-50 border-green-300 text-green-700"
              : "border-gray-200 text-gray-500 hover:border-gray-300"
          }`}
        >
          <Mail size={13} />
          Marketing opt-in only
        </button>
      </div>

      {/* Customer list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-orange-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 text-center bg-white rounded-2xl border border-gray-200">
          <Users size={32} className="text-gray-300" />
          <p className="font-semibold text-gray-600">No guest profiles found</p>
          <p className="text-sm text-gray-400 max-w-xs">
            {customers.length === 0
              ? "Profiles are created automatically when customers place an online order or check in to a reservation."
              : "No profiles match the current filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <CustomerCard key={c.id} customer={c} onSave={handleSave} />
          ))}
        </div>
      )}
    </div>
  );
}
