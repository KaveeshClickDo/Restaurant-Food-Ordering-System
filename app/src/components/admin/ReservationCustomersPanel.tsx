"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import type { ReservationCustomer, ContactSource } from "@/types";
import {
  Users, Search, Mail, Phone, Tag, FileDown,
  ChevronDown, ChevronUp, Loader2, RefreshCw, CheckCircle2,
  ToggleLeft, ToggleRight, X, Plus, Star, Clock, UtensilsCrossed,
  ShoppingBag, TrendingUp, Megaphone, Send, Gift, Tablet, UserCheck,
  Receipt, CalendarCheck, AlertTriangle,
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

// ─── Source metadata ────────────────────────────────────────────────────────
// One place that maps a capture channel to its label, colour, and icon —
// used by the filter chips, the per-contact badges, and the CSV export.

// `badge` styles the small per-contact chips; `active` is the pressed state of
// a source filter chip. Both are full literal class strings (no runtime
// construction) so Tailwind's scanner always emits them.
const SOURCE_META: Record<ContactSource, { label: string; badge: string; active: string; icon: typeof Mail }> = {
  online_order: { label: "Online order",  badge: "bg-blue-50 text-blue-700 border-blue-200",     active: "bg-blue-100 text-blue-800 border-blue-400",     icon: ShoppingBag },
  reservation:  { label: "Reservation",   badge: "bg-teal-50 text-teal-700 border-teal-200",     active: "bg-teal-100 text-teal-800 border-teal-400",     icon: CalendarCheck },
  gift_card:    { label: "Gift card",     badge: "bg-purple-50 text-purple-700 border-purple-200", active: "bg-purple-100 text-purple-800 border-purple-400", icon: Gift },
  account:      { label: "Account",       badge: "bg-indigo-50 text-indigo-700 border-indigo-200", active: "bg-indigo-100 text-indigo-800 border-indigo-400", icon: UserCheck },
  pos:          { label: "POS / walk-in", badge: "bg-orange-50 text-orange-700 border-orange-200", active: "bg-orange-100 text-orange-800 border-orange-400", icon: Tablet },
  ebill:        { label: "E-bill",        badge: "bg-gray-100 text-gray-600 border-gray-300",    active: "bg-gray-200 text-gray-800 border-gray-400",     icon: Receipt },
};

const ALL_SOURCES = Object.keys(SOURCE_META) as ContactSource[];

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCsv(customers: ReservationCustomer[], sym: string) {
  const header = ["Name", "Email", "Phone", "Sources", "Reservations", "Online Orders", `Total Spend (${sym})`, "First Activity", "Last Order", "Last Reservation", "Marketing Opt-in", "Tags", "Notes"];
  const rows = customers.map((c) => [
    c.name,
    c.email,
    c.phone,
    (c.sources ?? []).map((s) => SOURCE_META[s]?.label ?? s).join("; "),
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
  a.download = `marketing-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Source badges ────────────────────────────────────────────────────────────

function SourceBadges({ sources }: { sources: ContactSource[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <>
      {sources.map((s) => {
        const meta = SOURCE_META[s];
        if (!meta) return null;
        const Icon = meta.icon;
        return (
          <span key={s} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${meta.badge}`}>
            <Icon size={9} /> {meta.label}
          </span>
        );
      })}
    </>
  );
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

function CustomerCard({ customer, onSave, sym, selected, onToggleSelect }: { sym: string;
  customer: ReservationCustomer;
  onSave: (id: string, patch: { notes?: string; tags?: string[]; marketingOptIn?: boolean }) => Promise<void>;
  selected: boolean;
  onToggleSelect: (id: string) => void;
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

  const saveInFlight = useRef(false);

  async function save() {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    try {
      await onSave(customer.id, { notes, tags, marketingOptIn: optIn });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
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

  const unsubscribed = !customer.marketingOptIn;

  return (
    <div className={`bg-white rounded-xl border overflow-hidden transition ${selected ? "border-orange-400 ring-1 ring-orange-200" : "border-gray-200 hover:border-gray-300"}`}>
      {/* Summary row */}
      <div className="flex items-center gap-3 px-4 py-4">
        {/* Selection checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(customer.id)}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 accent-orange-500 flex-shrink-0 cursor-pointer"
          aria-label={`Select ${customer.name}`}
        />

        <button onClick={toggleExpand} className="flex-1 min-w-0 text-left flex items-center gap-4">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
            <span className="text-orange-700 font-bold text-sm">
              {customer.name.charAt(0).toUpperCase() || "?"}
            </span>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm">{customer.name || "(no name)"}</span>
              {unsubscribed && (
                <span className="text-[10px] font-semibold bg-red-50 border border-red-200 text-red-600 px-1.5 py-0.5 rounded-full">
                  Unsubscribed
                </span>
              )}
              <SourceBadges sources={customer.sources} />
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
                <span className="flex items-center gap-1 text-emerald-600"><TrendingUp size={10} />{sym}{customer.totalSpend.toFixed(2)} spent</span>
              )}
            </div>
          </div>

          {/* Expand icon */}
          <div className="text-gray-400 flex-shrink-0">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-5 bg-gray-50/50">

          {/* Marketing opt-in toggle */}
          <div className="flex items-start justify-between bg-white rounded-xl border border-gray-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Marketing Communications</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {optIn ? "Will receive promotional campaigns" : "Opted out — excluded from all campaigns"}
              </p>
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
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-400 transition"
              />
              <button
                onClick={() => addTag(tagInput)}
                disabled={!tagInput.trim()}
                className="flex shrink-0 items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-orange-600 hover:border-orange-300 transition disabled:opacity-40"
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
                  <div className="text-lg font-bold text-emerald-700">{sym}{customer.totalSpend.toFixed(2)}</div>
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

// ─── Campaign composer modal ────────────────────────────────────────────────

type SendState =
  | { phase: "idle" }
  | { phase: "sending"; sent: number; total: number }
  | { phase: "done"; sent: number; failed: number; skipped: number }
  | { phase: "error"; message: string };

function CampaignComposer({ recipients, onClose }: {
  recipients: ReservationCustomer[];
  onClose: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body,    setBody]    = useState("");
  const [testTo,  setTestTo]  = useState("");
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [send, setSend] = useState<SendState>({ phase: "idle" });
  const inFlight = useRef(false);

  const total = recipients.length;

  async function sendTest() {
    if (!testTo.trim() || !subject.trim() || !body.trim()) return;
    setTestState("sending");
    try {
      const res = await fetch("/api/admin/campaigns/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, bodyHtml: body, to: testTo.trim() }),
      });
      const json = await res.json() as { ok: boolean };
      setTestState(json.ok ? "sent" : "error");
      setTimeout(() => setTestState("idle"), 3000);
    } catch {
      setTestState("error");
      setTimeout(() => setTestState("idle"), 3000);
    }
  }

  async function launch() {
    if (inFlight.current) return;
    if (!subject.trim() || !body.trim() || total === 0) return;
    inFlight.current = true;
    setSend({ phase: "sending", sent: 0, total });
    try {
      // 1. Create the campaign + freeze the recipient snapshot.
      const createRes = await fetch("/api/admin/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject, bodyHtml: body,
          contactIds: recipients.map((r) => r.id),
        }),
      });
      const created = await createRes.json() as { ok: boolean; id?: string; totalRecipients?: number; error?: string };
      if (!created.ok || !created.id) {
        setSend({ phase: "error", message: created.error ?? "Could not create the campaign." });
        return;
      }

      // 2. Drain the queue batch by batch until done.
      const campaignId = created.id;
      const realTotal = created.totalRecipients ?? total;
      for (;;) {
        const res = await fetch(`/api/admin/campaigns/${campaignId}/send`, { method: "POST" });
        const json = await res.json() as {
          ok: boolean; done?: boolean; error?: string;
          totals?: { sent: number; failed: number; skipped: number };
        };
        if (!json.ok) {
          setSend({ phase: "error", message: json.error ?? "Sending failed partway through." });
          return;
        }
        const t = json.totals ?? { sent: 0, failed: 0, skipped: 0 };
        if (json.done) {
          setSend({ phase: "done", sent: t.sent, failed: t.failed, skipped: t.skipped });
          return;
        }
        setSend({ phase: "sending", sent: t.sent + t.failed + t.skipped, total: realTotal });
      }
    } catch {
      setSend({ phase: "error", message: "Connection error while sending." });
    } finally {
      inFlight.current = false;
    }
  }

  const busy = send.phase === "sending";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center">
              <Megaphone size={18} className="text-orange-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Compose campaign</h3>
              <p className="text-xs text-gray-500">{total} recipient{total !== 1 ? "s" : ""} selected</p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy} className="text-gray-400 hover:text-gray-600 disabled:opacity-40">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        {send.phase === "done" ? (
          <div className="px-6 py-10 text-center space-y-3">
            <CheckCircle2 size={44} className="text-green-500 mx-auto" />
            <h4 className="text-lg font-bold text-gray-900">Campaign sent</h4>
            <p className="text-sm text-gray-500">
              {send.sent} delivered
              {send.failed > 0 && ` · ${send.failed} failed`}
              {send.skipped > 0 && ` · ${send.skipped} skipped (opted out)`}
            </p>
            <button onClick={onClose} className="mt-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition">
              Done
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {send.phase === "error" && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2.5 text-sm">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /> {send.message}
              </div>
            )}

            {/* Token hint */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
              Personalise with <code className="font-mono bg-white px-1 rounded border border-amber-200">{"{{name}}"}</code> and <code className="font-mono bg-white px-1 rounded border border-amber-200">{"{{email}}"}</code>. An unsubscribe link is added automatically.
            </div>

            {/* Subject */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={busy}
                placeholder="A little treat from us, {{name}} 🎁"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition disabled:bg-gray-50"
              />
            </div>

            {/* Body */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Message (HTML supported)</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
                rows={9}
                placeholder={"<p>Hi {{name}},</p>\n<p>This weekend only — 20% off your next visit. Just show this email.</p>"}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-orange-400 transition resize-none disabled:bg-gray-50"
              />
            </div>

            {/* Test send */}
            <div className="border border-gray-200 rounded-xl px-3 py-3 space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Send a test first</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  disabled={busy}
                  placeholder="you@example.com"
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition"
                />
                <button
                  onClick={sendTest}
                  disabled={busy || !testTo.trim() || !subject.trim() || !body.trim() || testState === "sending"}
                  className="flex shrink-0 items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 hover:border-orange-300 hover:text-orange-600 transition disabled:opacity-40"
                >
                  {testState === "sending" ? <Loader2 size={13} className="animate-spin" />
                    : testState === "sent" ? <CheckCircle2 size={13} className="text-green-600" />
                    : <Send size={13} />}
                  {testState === "sent" ? "Sent!" : testState === "error" ? "Failed" : "Test"}
                </button>
              </div>
            </div>

            {/* Launch */}
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-gray-400">
                Only opted-in contacts are emailed. Opted-out contacts in your selection are skipped automatically.
              </p>
            </div>
            <button
              onClick={launch}
              disabled={busy || !subject.trim() || !body.trim() || total === 0}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-3 rounded-xl text-sm transition disabled:opacity-50"
            >
              {busy ? (
                <><Loader2 size={16} className="animate-spin" /> Sending… {send.phase === "sending" ? `${send.sent}/${send.total}` : ""}</>
              ) : (
                <><Send size={16} /> Send to {total} contact{total !== 1 ? "s" : ""}</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ReservationCustomersPanel() {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const [customers,    setCustomers]    = useState<ReservationCustomer[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState("");
  const [filterTag,    setFilterTag]    = useState("");
  const [filterOptIn,  setFilterOptIn]  = useState(false);
  const [sourceFilter, setSourceFilter] = useState<Set<ContactSource>>(new Set());
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [composing,    setComposing]    = useState(false);

  const lastDataKey = useRef<string>("");

  const fetchCustomers = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const res  = await fetch("/api/admin/reservation-customers");
      const json = await res.json() as { ok: boolean; customers?: ReservationCustomer[] };
      if (json.ok) {
        const next = json.customers ?? [];
        const key = JSON.stringify(next);
        if (key !== lastDataKey.current) {
          lastDataKey.current = key;
          setCustomers(next);
        }
      }
    } catch (err) {
      console.error("MarketingContactsPanel fetch:", err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCustomers(true); }, [fetchCustomers]);

  // Poll every 10s, silent, only when visible. Pause while composing so the
  // list underneath can't shift mid-send.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible" || composing) return;
      fetchCustomers();
    }, 10_000);
    return () => clearInterval(id);
  }, [fetchCustomers, composing]);

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

  const allTags = [...new Set(customers.flatMap((c) => c.tags))].sort();

  const filtered = customers.filter((c) => {
    if (filterOptIn  && !c.marketingOptIn)          return false;
    if (filterTag    && !c.tags.includes(filterTag)) return false;
    if (sourceFilter.size > 0 && !(c.sources ?? []).some((s) => sourceFilter.has(s))) return false;
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

  function toggleSource(s: ContactSource) {
    setSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // "Select all" operates on the filtered, mailable set.
  const filteredMailableIds = filtered.filter((c) => c.marketingOptIn).map((c) => c.id);
  const allFilteredSelected = filteredMailableIds.length > 0 && filteredMailableIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredMailableIds.forEach((id) => next.delete(id));
      else                     filteredMailableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  // Recipients for a campaign: the explicit selection if any, else the whole
  // filtered mailable set. Opted-out are excluded here AND re-checked server-side.
  const selectedContacts = customers.filter((c) => selected.has(c.id) && c.marketingOptIn);
  const campaignRecipients = selectedContacts.length > 0
    ? selectedContacts
    : filtered.filter((c) => c.marketingOptIn);

  const optInCount = customers.filter((c) => c.marketingOptIn).length;

  // Per-source counts for the chip labels.
  const sourceCounts = ALL_SOURCES.reduce((acc, s) => {
    acc[s] = customers.filter((c) => (c.sources ?? []).includes(s)).length;
    return acc;
  }, {} as Record<ContactSource, number>);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-row gap-3">
          <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Megaphone size={20} className="text-orange-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900">Marketing Contacts</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Every customer email captured across the app — online orders, reservations, gift cards, POS, and e-bills.
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {customers.length} contacts · {optInCount} opted in for marketing
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => exportCsv(filtered, sym)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:border-gray-300 transition disabled:opacity-40"
          >
            <FileDown size={14} /> Export CSV
          </button>
          <button
            onClick={() => fetchCustomers(true)}
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
          { label: "Total contacts",    value: customers.length,                                                    bg: "bg-gray-50",    border: "border-gray-200",   text: "text-gray-800"   },
          { label: "Online orders",     value: customers.reduce((s, c) => s + (c.orderCount ?? 0), 0),             bg: "bg-blue-50",    border: "border-blue-200",   text: "text-blue-700"   },
          { label: "Total revenue",     value: `${sym}${customers.reduce((s, c) => s + (c.totalSpend ?? 0), 0).toFixed(2)}`, bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" },
          { label: "Marketing opt-in",  value: optInCount,                                                          bg: "bg-green-50",   border: "border-green-200",  text: "text-green-700"  },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3.5`}>
            <div className={`text-xl font-bold ${s.text}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Source filter chips */}
      <div className="flex flex-wrap gap-2">
        {ALL_SOURCES.map((s) => {
          const meta = SOURCE_META[s];
          const Icon = meta.icon;
          const active = sourceFilter.has(s);
          return (
            <button
              key={s}
              onClick={() => toggleSource(s)}
              className={`flex items-center gap-1.5 border rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                active ? meta.active : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              <Icon size={12} /> {meta.label}
              <span className="text-[10px] opacity-70">{sourceCounts[s]}</span>
            </button>
          );
        })}
        {sourceFilter.size > 0 && (
          <button onClick={() => setSourceFilter(new Set())} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2">
            <X size={12} /> Clear
          </button>
        )}
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
          onClick={() => setFilterOptIn((v) => !v)}
          className={`flex items-center gap-1.5 border rounded-xl px-3 py-2 text-sm font-medium transition ${
            filterOptIn
              ? "bg-green-50 border-green-300 text-green-700"
              : "border-gray-200 text-gray-500 hover:border-gray-300"
          }`}
        >
          <Mail size={13} />
          Opted-in only
        </button>
      </div>

      {/* Selection / campaign bar */}
      <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 accent-orange-500"
            />
            Select all opted-in ({filteredMailableIds.length})
          </label>
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <X size={12} /> Clear {selected.size} selected
            </button>
          )}
        </div>
        <button
          onClick={() => setComposing(true)}
          disabled={campaignRecipients.length === 0}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl text-sm transition disabled:opacity-50"
        >
          <Megaphone size={15} />
          Compose campaign
          <span className="bg-white/25 rounded-full px-2 py-0.5 text-xs">{campaignRecipients.length}</span>
        </button>
      </div>

      {/* Contact list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-orange-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 text-center bg-white rounded-2xl border border-gray-200">
          <Megaphone size={32} className="text-gray-300" />
          <p className="font-semibold text-gray-600">No contacts found</p>
          <p className="text-sm text-gray-400 max-w-xs">
            {customers.length === 0
              ? "Contacts are captured automatically whenever a customer gives an email — online orders, reservations, gift cards, POS, or e-bills."
              : "No contacts match the current filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <CustomerCard
              key={c.id}
              customer={c}
              onSave={handleSave}
              sym={sym}
              selected={selected.has(c.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      {composing && (
        <CampaignComposer
          recipients={campaignRecipients}
          onClose={() => { setComposing(false); fetchCustomers(); }}
        />
      )}
    </div>
  );
}
