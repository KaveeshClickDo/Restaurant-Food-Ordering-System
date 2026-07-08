"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import type { GiftCard, GiftCardTransaction, GiftCardStatus } from "@/types";
import {
  Gift, Plus, Search, Loader2, CheckCircle, AlertCircle, X,
  Ban, Mail, Eye, TrendingUp, Power, Printer,
} from "lucide-react";
import { buildGiftCardPrintHtml } from "./_giftCardPrint";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_STYLES: Record<GiftCardStatus, string> = {
  inactive: "bg-slate-100 text-slate-600 border-slate-300",
  active:   "bg-green-50 text-green-700 border-green-200",
  redeemed: "bg-gray-100 text-gray-500 border-gray-200",
  voided:   "bg-red-50 text-red-700 border-red-200",
  expired:  "bg-amber-50 text-amber-700 border-amber-200",
};

type StatusFilter = "all" | GiftCardStatus;

interface Toast { id: number; message: string; ok: boolean; }
let toastId = 0;

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function GiftCardsPanel() {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";

  const [cards,    setCards]    = useState<GiftCard[]>([]);
  const [stats,    setStats]    = useState({ total: 0, activeCount: 0, inactiveCount: 0, totalOutstanding: 0 });
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState<StatusFilter>("all");
  const [search,   setSearch]   = useState("");
  const [toasts,   setToasts]   = useState<Toast[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activateTarget, setActivateTarget] = useState<GiftCard | null>(null);

  function addToast(message: string, ok: boolean) {
    const id = ++toastId;
    setToasts((p) => [...p, { id, message, ok }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  }

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (search.trim())    params.set("search", search.trim());
      const res = await fetch(`/api/admin/gift-cards?${params}`);
      const json = await res.json() as { ok: boolean; giftCards?: GiftCard[]; stats?: typeof stats; error?: string };
      if (json.ok) {
        setCards(json.giftCards ?? []);
        if (json.stats) setStats(json.stats);
      } else {
        addToast(json.error ?? "Failed to load gift cards.", false);
      }
    } catch {
      addToast("Connection error.", false);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { void fetchCards(); }, [fetchCards]);

  // Open a print-ready window with the card artwork. Used for inactive cards so
  // they can be printed and displayed in store (the code is worthless until the
  // card is activated at the point of sale).
  function printCard(card: GiftCard) {
    const html = buildGiftCardPrintHtml(card, settings.restaurant, sym);
    const win = window.open("", "_blank", "width=560,height=760");
    if (!win) { addToast("Allow pop-ups to print the card.", false); return; }
    win.document.write(html);
    win.document.close();
  }

  // Per-row in-flight guard for resend/void.
  const rowInFlight = useRef<Set<string>>(new Set());

  async function resend(card: GiftCard) {
    if (rowInFlight.current.has(card.id)) return;
    rowInFlight.current.add(card.id);
    try {
      const res = await fetch(`/api/admin/gift-cards/${card.id}/resend`, { method: "POST" });
      const json = await res.json() as { ok: boolean; error?: string };
      addToast(json.ok ? `Resent to ${card.issuedToEmail}` : (json.error ?? "Failed to resend."), json.ok);
    } catch {
      addToast("Connection error.", false);
    } finally {
      rowInFlight.current.delete(card.id);
    }
  }

  const [voidTarget, setVoidTarget] = useState<GiftCard | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

  async function confirmVoid() {
    if (!voidTarget || !voidReason.trim()) return;
    setVoiding(true);
    try {
      const res = await fetch(`/api/admin/gift-cards/${voidTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        addToast(`${voidTarget.code} voided.`, true);
        setVoidTarget(null);
        setVoidReason("");
        void fetchCards();
      } else {
        addToast(json.error ?? "Failed to void.", false);
      }
    } catch {
      addToast("Connection error.", false);
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium pointer-events-auto ${t.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
            {t.ok ? <CheckCircle size={15} className="text-green-500" /> : <AlertCircle size={15} className="text-red-500" />}
            {t.message}
          </div>
        ))}
      </div>

      {/* Header + stats */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
              <Gift size={20} className="text-purple-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Gift Cards</h2>
              <p className="text-xs text-gray-500">
                {stats.total} cards · {stats.activeCount} active
                {stats.inactiveCount > 0 ? ` · ${stats.inactiveCount} inactive` : ""}
              </p>
            </div>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition shadow-sm shadow-orange-200"
          >
            <Plus size={16} /> Issue Card
          </button>
        </div>

        {/* Outstanding liability stat */}
        <div className="mt-4 bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <TrendingUp size={16} className="text-purple-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-purple-700 font-medium">Outstanding balance (liability)</p>
            <p className="text-lg font-bold text-purple-800 tabular-nums">{sym}{stats.totalOutstanding.toFixed(2)}</p>
          </div>
          <span className="text-[11px] text-purple-500 ml-auto max-w-[180px] text-right">Active card balances you still owe in goods</span>
        </div>

        {/* Filter pills */}
        <div className="flex gap-1.5 mt-4 flex-wrap">
          {(["all", "active", "inactive", "redeemed", "voided", "expired"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border capitalize ${filter === f ? "bg-orange-500 text-white border-orange-500" : "bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300"}`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by code, recipient email or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 transition"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
            <Loader2 size={20} className="animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Gift size={36} className="mb-3 text-gray-300" />
            <p className="text-sm font-medium">No gift cards found</p>
            <p className="text-xs mt-1">{search ? "Try a different search." : "Issue one or wait for the first online purchase."}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {cards.map((c) => (
              <div key={c.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold font-mono tracking-wider text-gray-900">{c.code}</span>
                    <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLES[c.status]}`}>
                      {c.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {c.issuedToEmail ?? "No recipient"}{c.issuedToName ? ` · ${c.issuedToName}` : ""} · issued {fmtDate(c.createdAt)}
                  </p>
                </div>

                <div className="flex items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-1 shrink-0 transition">
                    <button onClick={() => setDetailId(c.id)} title="View history" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition">
                      <Eye size={14} />
                    </button>
                    <button onClick={() => printCard(c)} title="Print card" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-slate-700 hover:bg-slate-100 transition">
                      <Printer size={14} />
                    </button>
                    {c.status === "inactive" && (
                      <button onClick={() => setActivateTarget(c)} className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 transition">
                        <Power size={13} /> Activate
                      </button>
                    )}
                    {c.issuedToEmail && c.status !== "voided" && (
                      <button onClick={() => void resend(c)} title="Resend email" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition">
                        <Mail size={14} />
                      </button>
                    )}
                    {c.status === "active" && (
                      <button onClick={() => { setVoidTarget(c); setVoidReason(""); }} title="Void card" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
                        <Ban size={14} />
                      </button>
                    )}
                  </div>
                  <div className="w-24 text-right shrink-0">
                    <p className="text-sm font-bold text-gray-900 tabular-nums">{sym}{c.balance.toFixed(2)}</p>
                    <p className="text-[10px] text-gray-400 tabular-nums">of {sym}{c.initialAmount.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <IssueCardModal sym={sym} onClose={() => setCreateOpen(false)} onIssued={() => { void fetchCards(); }} addToast={addToast} />
      )}
      {detailId && (
        <DetailModal id={detailId} sym={sym} onClose={() => setDetailId(null)} />
      )}
      {activateTarget && (
        <ActivateCardModal
          card={activateTarget}
          sym={sym}
          onClose={() => setActivateTarget(null)}
          onActivated={() => { setActivateTarget(null); void fetchCards(); }}
          addToast={addToast}
        />
      )}
      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center"><Ban size={18} className="text-red-500" /></div>
              <div>
                <h3 className="font-bold text-gray-900">Void gift card</h3>
                <p className="text-xs text-gray-500">Balance becomes unspendable.</p>
              </div>
            </div>
            <p className="text-sm text-gray-700 mb-3">Void <strong className="font-mono">{voidTarget.code}</strong> ({sym}{voidTarget.balance.toFixed(2)} remaining)? This can&apos;t be undone.</p>
            <input
              type="text"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Reason (required for audit)"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <div className="flex gap-3">
              <button onClick={() => setVoidTarget(null)} className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={() => void confirmVoid()} disabled={!voidReason.trim() || voiding} className="flex-1 px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold disabled:opacity-60">
                {voiding ? <Loader2 size={15} className="animate-spin mx-auto" /> : "Void"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Issue card modal ─────────────────────────────────────────────────────────

function IssueCardModal({ sym, onClose, onIssued, addToast }: {
  sym: string;
  onClose: () => void;
  onIssued: () => void;
  addToast: (m: string, ok: boolean) => void;
}) {
  const [mode, setMode] = useState<"sell" | "inactive">("sell");
  const [amount, setAmount] = useState("25");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const inactive = mode === "inactive";

  async function handleIssue() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { addToast("Enter a valid amount.", false); return; }
    if (!inactive && sendEmail && !email.trim()) { addToast("Email required to send the card.", false); return; }
    setIssuing(true);
    try {
      // Inactive cards go to a separate endpoint — no payment, no recipient, not
      // booked as income until activated at the point of sale.
      const res = inactive
        ? await fetch("/api/admin/gift-cards/inactive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: amt, notes: notes.trim() || undefined }),
          })
        : await fetch("/api/admin/gift-cards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: amt,
              paymentMethod,
              recipientEmail: email.trim() || undefined,
              recipientName:  name.trim() || undefined,
              personalMessage: message.trim() || undefined,
              notes: notes.trim() || undefined,
              sendEmail,
              marketingOptIn,
            }),
          });
      const json = await res.json() as { ok: boolean; code?: string; error?: string };
      if (json.ok && json.code) {
        setIssuedCode(json.code);
        onIssued();
      } else {
        addToast(json.error ?? "Failed to issue card.", false);
      }
    } catch {
      addToast("Connection error.", false);
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-base">{issuedCode ? (inactive ? "Inactive card created" : "Card issued") : "Issue gift card"}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>

        {issuedCode ? (
          <div className="px-6 py-6 text-center space-y-4">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto"><CheckCircle size={24} className="text-green-500" /></div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Gift card code</p>
              <p className="text-2xl font-bold font-mono tracking-wider text-gray-900 mt-1">{issuedCode}</p>
            </div>
            <p className="text-sm text-gray-500">
              {inactive
                ? "Not active yet — it holds no spendable balance until you activate it at the point of sale."
                : (sendEmail && email ? `Emailed to ${email}.` : "Hand this code to the recipient.")}
            </p>
            <button onClick={onClose} className="w-full px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold">Done</button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {/* Mode: sell now (active) vs pre-issue (inactive, activate later) */}
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "sell",     label: "Sell now",      hint: "Active · booked as income" },
                { key: "inactive", label: "Create inactive", hint: "No payment · activate at sale" },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={`px-3 py-2.5 rounded-xl border text-left transition ${
                    mode === m.key
                      ? "border-orange-500 bg-orange-50"
                      : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                  }`}
                >
                  <span className={`block text-sm font-semibold ${mode === m.key ? "text-orange-700" : "text-gray-700"}`}>{m.label}</span>
                  <span className="block text-[10px] text-gray-400 mt-0.5">{m.hint}</span>
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Amount ({sym})</label>
              <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            {inactive && (
              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Creates a card with a code but no balance to spend until you activate it at the counter. Safe to print and display — a copied code is worthless until sold.
              </p>
            )}
            {!inactive && (<>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Paid by</label>
              <div className="grid grid-cols-2 gap-2">
                {(["cash", "card"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={`px-3 py-2.5 rounded-xl border text-sm font-semibold capitalize transition ${
                      paymentMethod === m
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Card is sold for money — recorded as income on the Admin finance tab.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Recipient email {sendEmail && <span className="text-red-500">*</span>}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="recipient@example.com" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Recipient name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Personal message</label>
              <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional — appears in the email" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            </>)}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Internal note</label>
              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Goodwill — complaint #42" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            {!inactive && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="accent-orange-500" />
                <span className="text-sm text-gray-700">Email the card to the recipient</span>
              </label>
            )}
            {!inactive && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} className="accent-orange-500" />
                <span className="text-sm text-gray-700">Customer agrees to receive offers &amp; news by email</span>
              </label>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={() => void handleIssue()} disabled={issuing} className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
                {issuing && <Loader2 size={14} className="animate-spin" />} {inactive ? "Create Card" : "Issue Card"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Activate (sell) an inactive card ───────────────────────────────────────

function ActivateCardModal({ card, sym, onClose, onActivated, addToast }: {
  card: GiftCard;
  sym: string;
  onClose: () => void;
  onActivated: () => void;
  addToast: (m: string, ok: boolean) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [busy, setBusy] = useState(false);

  async function handleActivate() {
    if (!email.trim()) { addToast("Recipient email is required to activate.", false); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/gift-cards/${card.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod,
          recipientEmail: email.trim(),
          recipientName:  name.trim() || undefined,
          personalMessage: message.trim() || undefined,
          notes: notes.trim() || undefined,
          sendEmail,
          marketingOptIn,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        addToast(`${card.code} activated${sendEmail ? ` · emailed to ${email.trim()}` : ""}.`, true);
        onActivated();
      } else {
        addToast(json.error ?? "Failed to activate card.", false);
      }
    } catch {
      addToast("Connection error.", false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-base">Activate &amp; sell card</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-lg font-bold font-mono tracking-wider text-gray-900">{card.code}</p>
            <p className="text-xs text-slate-500 mt-0.5">Value {sym}{card.balance.toFixed(2)} · books as income on activation</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Paid by</label>
            <div className="grid grid-cols-2 gap-2">
              {(["cash", "card"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`px-3 py-2.5 rounded-xl border text-sm font-semibold capitalize transition ${
                    paymentMethod === m
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Recipient email <span className="text-red-500">*</span></label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="recipient@example.com" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Recipient name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Personal message</label>
            <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional — appears in the email" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Internal note</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="accent-orange-500" />
            <span className="text-sm text-gray-700">Email the card to the recipient</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} className="accent-orange-500" />
            <span className="text-sm text-gray-700">Customer agrees to receive offers &amp; news by email</span>
          </label>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
            <button onClick={() => void handleActivate()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />} Activate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail / transaction history modal ─────────────────────────────────────

function DetailModal({ id, sym, onClose }: { id: string; sym: string; onClose: () => void }) {
  const [card, setCard] = useState<GiftCard | null>(null);
  const [txns, setTxns] = useState<GiftCardTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/gift-cards/${id}`);
        const json = await res.json() as { ok: boolean; giftCard?: GiftCard; transactions?: GiftCardTransaction[] };
        if (json.ok) { setCard(json.giftCard ?? null); setTxns(json.transactions ?? []); }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-gray-100 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-base">Gift card detail</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"><X size={16} /></button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
        ) : !card ? (
          <div className="py-16 text-center text-gray-400 text-sm">Not found.</div>
        ) : (
          <div className="px-4 sm:px-6 py-5 space-y-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-2xl font-bold font-mono tracking-wider text-gray-900">{card.code}</p>
              <div className="flex items-center gap-4 mt-2 text-sm">
                <span className="text-gray-500">Balance <strong className="text-gray-900">{sym}{card.balance.toFixed(2)}</strong> / {sym}{card.initialAmount.toFixed(2)}</span>
                <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLES[card.status]}`}>{card.status}</span>
              </div>
              <div className="text-xs text-gray-500 mt-2 space-y-0.5">
                <p>Recipient: {card.issuedToEmail ?? "—"}{card.issuedToName ? ` (${card.issuedToName})` : ""}</p>
                <p>Issued: {fmtDate(card.createdAt)} · Expires: {fmtDate(card.expiresAt)}</p>
                {card.deliveredAt && <p>Email delivered: {fmtDate(card.deliveredAt)}</p>}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Transaction history</h4>
              <div className="space-y-2">
                {txns.length === 0 ? (
                  <p className="text-sm text-gray-400">No transactions.</p>
                ) : txns.map((t) => (
                  <div key={t.id} className="flex gap-2 items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-800 capitalize">{t.type}</p>
                      <p className="text-[11px] text-gray-400 truncate">{fmtDate(t.createdAt)}{t.notes ? ` · ${t.notes}` : ""}</p>
                    </div>
                    <span className={`text-sm font-bold tabular-nums shrink-0 ${t.amount >= 0 ? "text-green-600" : "text-gray-700"}`}>
                      {t.amount >= 0 ? "+" : "−"}{sym}{Math.abs(t.amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
