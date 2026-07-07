"use client";

/**
 * Admin → Marketing (?tab=marketing).
 *
 * Broadcast-first layout modelled on Kit's flow:
 *   • Broadcasts (default view) — history with stats, or a get-started hero.
 *   • Audience — every captured contact, filters, tags, opt-ins.
 *   • Compose — a 3-step wizard: ① Who → ② Write (with quick-start templates)
 *     → ③ Review & send (test send, save draft, schedule, confirm-to-send).
 *
 * The file keeps its historical name (the tab id was reservation-customers);
 * the default export is the whole marketing surface.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "@/context/AppContext";
import type { ReservationCustomer, ContactSource } from "@/types";
import {
  Users, Search, Mail, Phone, Tag, FileDown, Bold, Italic, Underline,
  ChevronDown, ChevronUp, Loader2, RefreshCw, CheckCircle2, List, ListOrdered,
  ToggleLeft, ToggleRight, X, Plus, Star, Clock, UtensilsCrossed, Heading1, Heading2,
  ShoppingBag, Megaphone, Gift, Tablet, UserCheck, Send, Eye, Trash2, AlertTriangle,
  Receipt, CalendarCheck, ArrowLeft, ArrowRight, CalendarClock, FileEdit, Minus,
  Variable, Sparkles, PartyPopper, Pencil, Check,
} from "lucide-react";

// ─── Small helpers ────────────────────────────────────────────────────────────

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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

// ── Source metadata (chips + badges share one map) ───────────────────────────
const SOURCE_META: Record<ContactSource, { label: string; badge: string; active: string; icon: typeof Mail }> = {
  online_order: { label: "Online order",  badge: "bg-blue-50 text-blue-700 border-blue-200",       active: "bg-blue-100 text-blue-800 border-blue-400",       icon: ShoppingBag },
  reservation:  { label: "Reservation",   badge: "bg-teal-50 text-teal-700 border-teal-200",       active: "bg-teal-100 text-teal-800 border-teal-400",       icon: CalendarCheck },
  gift_card:    { label: "Gift card",     badge: "bg-purple-50 text-purple-700 border-purple-200", active: "bg-purple-100 text-purple-800 border-purple-400", icon: Gift },
  account:      { label: "Account",       badge: "bg-indigo-50 text-indigo-700 border-indigo-200", active: "bg-indigo-100 text-indigo-800 border-indigo-400", icon: UserCheck },
  pos:          { label: "POS / walk-in", badge: "bg-orange-50 text-orange-700 border-orange-200", active: "bg-orange-100 text-orange-800 border-orange-400", icon: Tablet },
  ebill:        { label: "E-bill",        badge: "bg-gray-100 text-gray-600 border-gray-300",      active: "bg-gray-200 text-gray-800 border-gray-400",       icon: Receipt },
};
const ALL_SOURCES = Object.keys(SOURCE_META) as ContactSource[];

function isRealEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.endsWith("@internal.local");
}
function isMailable(c: ReservationCustomer): boolean {
  return c.marketingOptIn && !c.unsubscribedAt && isRealEmail(c.email);
}

// ── Audience ─────────────────────────────────────────────────────────────────
type Audience =
  | { mode: "all" }
  | { mode: "sources"; sources: ContactSource[] }
  | { mode: "tags"; tags: string[] }
  | { mode: "selection"; ids: string[] };

/** Client-side mirror of the server resolveAudience — powers the live count. */
function resolveRecipients(contacts: ReservationCustomer[], audience: Audience): ReservationCustomer[] {
  const mailable = contacts.filter(isMailable);
  switch (audience.mode) {
    case "all":       return mailable;
    case "sources":   return mailable.filter((c) => (c.sources ?? []).some((s) => audience.sources.includes(s)));
    case "tags":      return mailable.filter((c) => c.tags.some((t) => audience.tags.includes(t)));
    case "selection": { const set = new Set(audience.ids); return mailable.filter((c) => set.has(c.id)); }
  }
}
function audienceLabel(a: Audience): string {
  switch (a.mode) {
    case "all":       return "All opted-in contacts";
    case "sources":   return a.sources.length ? `By source: ${a.sources.map((s) => SOURCE_META[s].label).join(", ")}` : "By source";
    case "tags":      return a.tags.length ? `By tag: ${a.tags.join(", ")}` : "By tag";
    case "selection": return `${a.ids.length} hand-picked contact${a.ids.length === 1 ? "" : "s"}`;
  }
}

// ── Rich text editor with {{name}}/{{email}} chips ───────────────────────────
const VAR_STYLE =
  "display:inline-block;background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;" +
  "padding:0 5px;font-size:0.82em;font-family:monospace;color:#92400e;cursor:default;" +
  "user-select:none;margin:0 2px;line-height:1.6;";
const BROADCAST_VARS = [
  { name: "name",  label: "Recipient's name" },
  { name: "email", label: "Recipient's email" },
];

// Token regex shared by the chip renderer: plain `{{name}}` or with a
// Kit-style fallback `{{name | "friend"}}`. The full inner text is kept in
// data-var so displayToStorage round-trips the fallback intact.
const TOKEN_RE = /\{\{\s*([a-z_]+(?:\s*\|\s*"[^"]*")?)\s*\}\}/g;

function storageToDisplay(html: string): string {
  if (typeof document === "undefined") return html;
  const root = document.createElement("div");
  root.innerHTML = html;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (/\{\{[^{}]+\}\}/.test((node as Text).nodeValue ?? "")) targets.push(node as Text);
  }
  for (const textNode of targets) {
    const text = textNode.nodeValue ?? "";
    const frag = document.createDocumentFragment();
    const re = new RegExp(TOKEN_RE.source, "g");
    let lastIdx = 0, m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
      const span = document.createElement("span");
      span.contentEditable = "false";
      span.setAttribute("data-var", m[1]);
      span.setAttribute("style", VAR_STYLE);
      span.textContent = `{{${m[1]}}}`;
      frag.appendChild(span);
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return root.innerHTML;
}
function displayToStorage(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>("[data-var]").forEach((el) => {
    el.replaceWith(document.createTextNode(`{{${el.getAttribute("data-var") ?? ""}}}`));
  });
  return clone.innerHTML;
}

function BroadcastEditor({ editorKey, initialValue, onChange }: {
  editorKey: string; initialValue: string; onChange: (html: string) => void;
}) {
  const editorRef  = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = storageToDisplay(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey]);

  function saveRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (editorRef.current?.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange();
    }
  }
  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    if (editorRef.current) onChange(displayToStorage(editorRef.current));
  }
  function insertVariable(varName: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const span = document.createElement("span");
    span.contentEditable = "false";
    span.setAttribute("data-var", varName);
    span.setAttribute("style", VAR_STYLE);
    span.textContent = `{{${varName}}}`;
    const sel = window.getSelection();
    let range: Range | null = null;
    if (savedRange.current && editor.contains(savedRange.current.commonAncestorContainer)) {
      sel?.removeAllRanges(); sel?.addRange(savedRange.current); range = savedRange.current;
    } else if (sel && sel.rangeCount > 0) range = sel.getRangeAt(0);
    if (range && editor.contains(range.commonAncestorContainer)) {
      range.deleteContents(); range.insertNode(span);
      const after = document.createRange(); after.setStartAfter(span); after.collapse(true);
      sel?.removeAllRanges(); sel?.addRange(after); savedRange.current = after.cloneRange();
    } else {
      editor.appendChild(span); editor.appendChild(document.createTextNode(" "));
    }
    onChange(displayToStorage(editor));
  }

  const TB = ({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
    <button type="button" onMouseDown={(e) => { e.preventDefault(); saveRange(); }} onClick={onClick} title={title}
      className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition">
      {children}
    </button>
  );

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center gap-0.5 flex-wrap px-3 py-2 border-b border-gray-100 bg-gray-50">
        <TB onClick={() => exec("bold")} title="Bold"><Bold size={13} /></TB>
        <TB onClick={() => exec("italic")} title="Italic"><Italic size={13} /></TB>
        <TB onClick={() => exec("underline")} title="Underline"><Underline size={13} /></TB>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <TB onClick={() => exec("formatBlock", "<h1>")} title="Heading 1"><Heading1 size={14} /></TB>
        <TB onClick={() => exec("formatBlock", "<h2>")} title="Heading 2"><Heading2 size={14} /></TB>
        <TB onClick={() => exec("formatBlock", "<p>")} title="Paragraph"><span className="text-[11px] font-semibold">P</span></TB>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <TB onClick={() => exec("insertUnorderedList")} title="Bullet list"><List size={13} /></TB>
        <TB onClick={() => exec("insertOrderedList")} title="Numbered list"><ListOrdered size={13} /></TB>
        <span className="w-px h-4 bg-gray-200 mx-1" />
        <TB onClick={() => exec("createLink", prompt("Link URL:") || undefined)} title="Insert link"><span className="text-[11px] font-semibold underline">Link</span></TB>
        <TB onClick={() => exec("insertHorizontalRule")} title="Divider"><Minus size={13} /></TB>
      </div>
      <div className="px-3 py-2 border-b border-gray-100 bg-amber-50 flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
          <Variable size={13} className="text-amber-600" /> Personalise
        </span>
        {BROADCAST_VARS.map((v) => (
          <button key={v.name} type="button" title={v.label}
            onMouseDown={(e) => { e.preventDefault(); saveRange(); }} onClick={() => insertVariable(v.name)}
            className="text-[11px] bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-200 rounded-md px-2 py-0.5 font-mono transition">
            {`{{${v.name}}}`}
          </button>
        ))}
        <button type="button" title='Name with a fallback — shows your chosen word when we have no name for a contact'
          onMouseDown={(e) => { e.preventDefault(); saveRange(); }}
          onClick={() => {
            const fb = (prompt('If we don’t have their name, show:', "friend") ?? "").replace(/["{}]/g, "").trim();
            if (fb) insertVariable(`name | "${fb}"`);
          }}
          className="text-[11px] bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-200 rounded-md px-2 py-0.5 font-mono transition">
          {'{{name | "…"}}'}
        </button>
        <span className="text-[11px] text-amber-600">— real name, or your fallback word when there isn&apos;t one</span>
      </div>
      <div ref={editorRef} contentEditable suppressContentEditableWarning
        onInput={() => { if (editorRef.current) onChange(displayToStorage(editorRef.current)); }}
        onKeyUp={saveRange} onMouseUp={saveRange}
        className="min-h-80 p-4 focus:outline-none text-sm leading-relaxed text-gray-800 prose prose-sm max-w-none"
        style={{ caretColor: "#ea580c" }} />
    </div>
  );
}

// ── Email preview ────────────────────────────────────────────────────────────
function previewHtml(body: string, restaurantName: string): string {
  // Fallback-tolerant: `{{name}}` and `{{name | "friend"}}` both preview as
  // the sample name (real fallback resolution happens at send time).
  return body
    .replace(/\{\{\s*name\s*(?:\|[^}]*)?\}\}/g, "Alex")
    .replace(/\{\{\s*email\s*(?:\|[^}]*)?\}\}/g, "alex@example.com")
    .replace(/\{\{\s*restaurant_name\s*(?:\|[^}]*)?\}\}/g, restaurantName)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

function EmailPreview({ subject, previewText, body, brandColor, restaurantName }: {
  subject: string; previewText: string; body: string; brandColor: string; restaurantName: string;
}) {
  return (
    <div className="bg-gray-100 rounded-xl p-4 overflow-hidden">
      <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 mb-3">
        <p className="text-sm font-semibold text-gray-900 truncate">{subject || "(no subject yet)"}</p>
        <p className="text-xs text-gray-500 truncate">
          <span className="text-gray-700">{restaurantName}</span>
          {previewText && <span className="text-gray-400"> — {previewText}</span>}
        </p>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-w-md mx-auto">
        <div style={{ background: brandColor }} className="px-5 py-4 text-center">
          <span className="text-white font-bold text-sm">{restaurantName}</span>
        </div>
        <div className="p-5 text-sm text-gray-800 rich-content prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: previewHtml(body, restaurantName) || '<p style="color:#9ca3af">Your message will appear here…</p>' }} />
        <div className="px-5 pb-5">
          <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-3">
            You&apos;re receiving this because you&apos;ve ordered, dined, or bought a gift card.{" "}
            <span className="underline">Unsubscribe</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Quick-start templates ─────────────────────────────────────────────────────
interface Template { emoji: string; name: string; subject: string; preview: string; body: string }
const TEMPLATES: Template[] = [
  {
    emoji: "🎉", name: "Weekend offer",
    subject: 'A weekend treat for you, {{name | "friend"}} 🎉',
    preview: "This weekend only — something special is waiting",
    body: '<h2>Weekend special 🎉</h2><p>Hi {{name | "there"}},</p><p>This weekend only — enjoy <strong>20% off</strong> your order with us. Dinner in or takeaway night, we\'ve got you covered.</p><p>Just show this email when you order.</p><p>See you soon!</p>',
  },
  {
    emoji: "🍽️", name: "New on the menu",
    subject: 'Fresh on the menu — come try it, {{name | "friend"}}',
    preview: "Our kitchen has been busy. You'll want to see this.",
    body: '<h2>Something new is cooking 🍽️</h2><p>Hi {{name | "there"}},</p><p>We\'ve just added new dishes to the menu and we think you\'re going to love them.</p><p>Be one of the first to try them — order online or book a table.</p><p>Hungry yet?</p>',
  },
  {
    emoji: "💜", name: "We miss you",
    subject: 'We miss you, {{name | "friend"}}',
    preview: "It's been a while — here's a little something to bring you back",
    body: '<h2>It\'s been a while 💜</h2><p>Hi {{name | "there"}},</p><p>We noticed you haven\'t visited in a bit — and we\'d love to see you again.</p><p>Here\'s <strong>10% off your next order</strong>, just for coming back. Show this email when you order.</p><p>Hope to see you soon!</p>',
  },
  {
    emoji: "🎁", name: "Gift cards",
    subject: "The easiest gift? Dinner. 🎁",
    preview: "Gift cards for the food-lovers in your life",
    body: '<h2>Give the gift of a great meal 🎁</h2><p>Hi {{name | "there"}},</p><p>Stuck for a gift idea? Our gift cards are perfect for birthdays, thank-yous, or just because.</p><p>Pick any amount, add a personal message, and we\'ll email it straight to them.</p><p>Find them on our website.</p>',
  },
  {
    emoji: "📣", name: "Announcement",
    subject: 'Big news from us, {{name | "friend"}} 📣',
    preview: "We've got something exciting to share",
    body: '<h2>We\'ve got news 📣</h2><p>Hi {{name | "there"}},</p><p>Write your announcement here — new opening hours, a special event, live music night, or anything else your customers should know about.</p><p>Thanks for being part of our story.</p>',
  },
];

// ─── Reservation history row ──────────────────────────────────────────────────
interface HistoryEntry { id: string; date: string; time: string; table_label: string; party_size: number; status: string; note?: string; }
function HistoryRow({ r }: { r: HistoryEntry }) {
  const badge = STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-600 border-gray-200";
  const [y, mo, d] = r.date.split("-").map(Number);
  const dateLabel = new Date(y, mo - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-800">{dateLabel}</span>
          <span className="text-xs text-gray-500 flex items-center gap-1"><Clock size={10} /> {fmt12(r.time)}</span>
          <span className="text-xs text-gray-500 flex items-center gap-1"><UtensilsCrossed size={10} /> {r.table_label}</span>
          <span className="text-xs text-gray-500 flex items-center gap-1"><Users size={10} /> {r.party_size}</span>
        </div>
        {r.note && <p className="text-xs text-amber-700 italic mt-0.5 truncate">&ldquo;{r.note}&rdquo;</p>}
      </div>
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize shrink-0 ${badge}`}>
        {r.status.replace("_", " ")}
      </span>
    </div>
  );
}

function SourceBadges({ sources }: { sources: ContactSource[] }) {
  if (!sources?.length) return null;
  return <>{sources.map((s) => {
    const meta = SOURCE_META[s]; if (!meta) return null; const Icon = meta.icon;
    return <span key={s} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${meta.badge}`}><Icon size={9} /> {meta.label}</span>;
  })}</>;
}

// ─── Contact card ─────────────────────────────────────────────────────────────
function ContactCard({ customer, onSave, selected, onToggleSelect }: {
  customer: ReservationCustomer;
  onSave: (id: string, patch: { notes?: string; tags?: string[]; marketingOptIn?: boolean }) => Promise<void>;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(customer.notes);
  const [tags, setTags] = useState<string[]>(customer.tags);
  const [optIn, setOptIn] = useState(customer.marketingOptIn);
  const [tagInput, setTagInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = notes !== customer.notes || JSON.stringify(tags) !== JSON.stringify(customer.tags) || optIn !== customer.marketingOptIn;
  const saveInFlight = useRef(false);

  async function loadHistory() {
    if (history.length > 0) return;
    setLoadingHist(true);
    try {
      const res = await fetch(`/api/admin/reservation-customers/${customer.id}/reservations`);
      const json = await res.json() as { ok: boolean; reservations?: HistoryEntry[] };
      if (json.ok) setHistory(json.reservations ?? []);
    } finally { setLoadingHist(false); }
  }
  function toggleExpand() { setExpanded((v) => !v); if (!expanded) loadHistory(); }
  async function save() {
    if (saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true);
    try { await onSave(customer.id, { notes, tags, marketingOptIn: optIn }); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    finally { saveInFlight.current = false; setSaving(false); }
  }
  function addTag(tag: string) { const t = tag.trim(); if (!t || tags.includes(t)) return; setTags((p) => [...p, t]); setTagInput(""); }
  function removeTag(tag: string) { setTags((p) => p.filter((x) => x !== tag)); }

  return (
    <div className={`bg-white rounded-xl border overflow-hidden transition ${selected ? "border-orange-400 ring-1 ring-orange-200" : "border-gray-200 hover:border-gray-300"}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(customer.id)}
          className="w-4 h-4 accent-orange-500 shrink-0 cursor-pointer" aria-label={`Select ${customer.name}`} />
        <button onClick={toggleExpand} className="flex-1 min-w-0 text-left flex items-center gap-4">
          <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
            <span className="text-orange-700 font-bold text-sm">{customer.name.charAt(0).toUpperCase() || "?"}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm">{customer.name || "(no name)"}</span>
              {!customer.marketingOptIn && <span className="text-[10px] font-semibold bg-red-50 border border-red-200 text-red-600 px-1.5 py-0.5 rounded-full">Unsubscribed</span>}
              <SourceBadges sources={customer.sources} />
              {customer.tags.map((tag) => <span key={tag} className="text-[10px] font-semibold bg-orange-50 border border-orange-200 text-orange-700 px-1.5 py-0.5 rounded-full">{tag}</span>)}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
              <span className="flex items-center gap-1"><Mail size={10} />{customer.email}</span>
              {customer.phone && <span className="flex items-center gap-1"><Phone size={10} />{customer.phone}</span>}
              {customer.visitCount > 0 && <span className="flex items-center gap-1"><Star size={10} className="text-orange-400" />{customer.visitCount} visit{customer.visitCount !== 1 ? "s" : ""}</span>}
            </div>
          </div>
          <div className="text-gray-400 shrink-0">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-5 bg-gray-50/50">
          <div className="flex items-start justify-between bg-white rounded-xl border border-gray-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Marketing emails</p>
              <p className="text-xs text-gray-400 mt-0.5">{optIn ? "Will receive broadcasts" : "Opted out — excluded from all broadcasts"}</p>
            </div>
            <button onClick={() => setOptIn((v) => !v)} className={`flex items-center transition ${optIn ? "text-green-500" : "text-gray-300 hover:text-gray-400"}`}>
              {optIn ? <ToggleRight size={30} /> : <ToggleLeft size={30} />}
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5"><Tag size={11} /> Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 text-xs bg-orange-50 border border-orange-200 text-orange-700 px-2.5 py-1 rounded-full font-medium">
                  {tag}<button onClick={() => removeTag(tag)} className="hover:text-red-600 transition ml-0.5"><X size={10} /></button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESET_TAGS.filter((t) => !tags.includes(t)).map((t) => (
                <button key={t} onClick={() => addTag(t)} className="text-[11px] text-gray-500 hover:text-orange-600 border border-dashed border-gray-300 hover:border-orange-300 px-2 py-0.5 rounded-full transition">+ {t}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); } }}
                placeholder="Custom tag…" className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-400 transition" />
              <button onClick={() => addTag(tagInput)} disabled={!tagInput.trim()} className="flex shrink-0 items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:text-orange-600 hover:border-orange-300 transition disabled:opacity-40"><Plus size={13} /> Add</button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Notes</p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Preferences, dietary needs, follow-ups…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-400 transition resize-none" />
          </div>

          {dirty && (
            <button onClick={save} disabled={saving} className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-all ${saved ? "bg-green-100 text-green-700" : "bg-orange-500 hover:bg-orange-600 text-white"}`}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <CheckCircle2 size={13} /> : null}
              {saving ? "Saving…" : saved ? "Saved!" : "Save changes"}
            </button>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Reservation history</p>
            {loadingHist ? <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-orange-500" /></div>
              : history.length === 0 ? <p className="text-sm text-gray-400 py-2">No reservation history.</p>
              : <div className="bg-white rounded-xl border border-gray-100 px-4 py-1 divide-y divide-gray-50">{history.map((r) => <HistoryRow key={r.id} r={r} />)}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ Campaign types ═══════════════════════════════════════════════════════════
interface Campaign {
  id: string; subject: string; previewText: string; status: string; audience: Audience;
  scheduledAt?: string; totalRecipients: number; sentCount: number; failedCount: number;
  skippedCount: number; openedCount: number; createdAt: string; completedAt?: string;
}
const CAMPAIGN_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  draft:     { label: "Draft",     cls: "bg-gray-100 text-gray-600 border-gray-300",   dot: "bg-gray-400" },
  scheduled: { label: "Scheduled", cls: "bg-blue-50 text-blue-700 border-blue-200",    dot: "bg-blue-500" },
  sending:   { label: "Sending…",  cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500 animate-pulse" },
  sent:      { label: "Sent",      cls: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
  cancelled: { label: "Cancelled", cls: "bg-red-50 text-red-600 border-red-200",       dot: "bg-red-400" },
};

// ─── Main panel ───────────────────────────────────────────────────────────────
type View = "broadcasts" | "audience" | "compose";

export default function ReservationCustomersPanel() {
  const { settings } = useApp();
  const brandColor = settings.colors?.primaryColor?.trim() || "#f97316";
  const restaurantName = settings.receiptSettings?.restaurantName?.trim() || settings.restaurant?.name || "Restaurant";

  const [customers, setCustomers] = useState<ReservationCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("broadcasts");

  // Audience filters + selection
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterOptIn, setFilterOptIn] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<Set<ContactSource>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Broadcast state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composeInitial, setComposeInitial] = useState<{ subject: string; previewText: string; body: string; audience: Audience; startStep: 1 | 2 } | null>(null);

  const lastDataKey = useRef<string>("");

  const fetchCustomers = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const res = await fetch("/api/admin/reservation-customers");
      const json = await res.json() as { ok: boolean; customers?: ReservationCustomer[] };
      if (json.ok) {
        const next = json.customers ?? [];
        const key = JSON.stringify(next);
        if (key !== lastDataKey.current) { lastDataKey.current = key; setCustomers(next); }
      }
    } catch (err) { console.error("MarketingPanel fetch:", err); }
    finally { if (isInitial) setLoading(false); }
  }, []);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/campaigns");
      const json = await res.json() as { ok: boolean; campaigns?: Campaign[] };
      if (json.ok) setCampaigns(json.campaigns ?? []);
    } catch (err) { console.error("campaigns fetch:", err); }
  }, []);

  useEffect(() => { fetchCustomers(true); fetchCampaigns(); }, [fetchCustomers, fetchCampaigns]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (view === "audience") fetchCustomers();
      if (view === "broadcasts") { fetchCampaigns(); fetchCustomers(); }
    }, 10_000);
    return () => clearInterval(id);
  }, [fetchCustomers, fetchCampaigns, view]);

  async function handleSave(id: string, patch: { notes?: string; tags?: string[]; marketingOptIn?: boolean }) {
    const res = await fetch(`/api/admin/reservation-customers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    if (res.ok) setCustomers((prev) => prev.map((c) => c.id === id ? {
      ...c,
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.marketingOptIn !== undefined ? { marketingOptIn: patch.marketingOptIn } : {}),
    } : c));
  }

  const allTags = [...new Set(customers.flatMap((c) => c.tags))].sort();
  const reachableCount = customers.filter(isMailable).length;

  // ── Open composer ───────────────────────────────────────────────────────────
  function newBroadcast(fromSelection: boolean) {
    const ids = [...selected].filter((id) => customers.find((c) => c.id === id && isMailable(c)));
    setEditingId(null);
    setComposeInitial({
      subject: "", previewText: "", body: "",
      audience: fromSelection && ids.length > 0 ? { mode: "selection", ids } : { mode: "all" },
      startStep: 1,
    });
    setView("compose");
  }
  async function resumeDraft(id: string) {
    try {
      const res = await fetch(`/api/admin/campaigns/${id}`);
      const json = await res.json() as { ok: boolean; campaign?: { subject: string; previewText: string; bodyHtml: string; audience: Audience } };
      if (json.ok && json.campaign) {
        setEditingId(id);
        setComposeInitial({ subject: json.campaign.subject, previewText: json.campaign.previewText, body: json.campaign.bodyHtml, audience: json.campaign.audience, startStep: 2 });
        setView("compose");
      }
    } catch (err) { console.error("resumeDraft:", err); }
  }

  if (view === "compose" && composeInitial) {
    return (
      <ComposeWizard
        key={editingId ?? "new"}
        contacts={customers} allTags={allTags} brandColor={brandColor} restaurantName={restaurantName}
        editingId={editingId} initial={composeInitial}
        onExit={() => { setView("broadcasts"); setComposeInitial(null); setEditingId(null); setSelected(new Set()); fetchCampaigns(); }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-row gap-3 items-center">
          <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center shrink-0"><Megaphone size={20} className="text-orange-600" /></div>
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900">Marketing</h2>
            <p className="text-xs text-gray-500 mt-0.5">Send offers and news to everyone who&apos;s ordered, booked, or bought from you.</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          <button onClick={() => setView("broadcasts")} className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${view === "broadcasts" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            <Send size={14} /> Broadcasts
          </button>
          <button onClick={() => setView("audience")} className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${view === "audience" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            <Users size={14} /> Audience
            <span className="text-[10px] bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">{customers.length}</span>
          </button>
        </div>
      </div>

      {view === "broadcasts" ? (
        <BroadcastsHome
          campaigns={campaigns} reachableCount={reachableCount} loading={loading}
          onNew={() => newBroadcast(false)} onResume={resumeDraft} onChanged={fetchCampaigns}
        />
      ) : (
        <AudienceSection
          customers={customers} loading={loading}
          search={search} setSearch={setSearch}
          filterTag={filterTag} setFilterTag={setFilterTag} allTags={allTags}
          filterOptIn={filterOptIn} setFilterOptIn={setFilterOptIn}
          sourceFilter={sourceFilter} setSourceFilter={setSourceFilter}
          selected={selected} setSelected={setSelected}
          onSave={handleSave} onRefresh={() => fetchCustomers(true)}
          onBroadcastToSelection={() => newBroadcast(true)}
        />
      )}
    </div>
  );
}

// ═══ Broadcasts home ══════════════════════════════════════════════════════════
function BroadcastsHome({ campaigns, reachableCount, loading, onNew, onResume, onChanged }: {
  campaigns: Campaign[]; reachableCount: number; loading: boolean;
  onNew: () => void; onResume: (id: string) => void; onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function del(id: string) {
    setDeleting(id);
    try { await fetch(`/api/admin/campaigns/${id}`, { method: "DELETE" }); onChanged(); }
    finally { setDeleting(null); setConfirmDelete(null); }
  }

  const sentCampaigns = campaigns.filter((c) => c.status === "sent");
  const totalSent = sentCampaigns.reduce((s, c) => s + c.sentCount, 0);
  const totalOpened = sentCampaigns.reduce((s, c) => s + c.openedCount, 0);
  const avgOpenRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : null;

  if (loading && campaigns.length === 0) {
    return <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-orange-500" /></div>;
  }

  // ── First-time hero ─────────────────────────────────────────────────────────
  if (campaigns.length === 0) {
    return (
      <div className="bg-gradient-to-br from-orange-50 via-amber-50 to-white border border-orange-100 rounded-2xl px-8 py-12 text-center">
        <div className="w-14 h-14 rounded-2xl bg-orange-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-200">
          <PartyPopper size={26} className="text-white" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900">Send your first broadcast</h3>
        <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
          {reachableCount > 0
            ? <>You have <span className="font-bold text-orange-600">{reachableCount} customers</span> ready to hear from you. A weekend offer, a new dish, a friendly hello — it takes two minutes.</>
            : <>As customers order, book tables, and buy gift cards, their emails collect here automatically — then you can reach them all in one go.</>}
        </p>

        <div className="grid sm:grid-cols-3 gap-3 max-w-2xl mx-auto mt-8 text-left">
          {[
            { icon: Users,  title: "1 · Pick who",   desc: "Everyone, or filter by tags and where they came from." },
            { icon: Pencil, title: "2 · Write it",   desc: "Start from a ready-made template and make it yours." },
            { icon: Send,   title: "3 · Send it",    desc: "Test it on yourself first, then send now or schedule." },
          ].map((s) => (
            <div key={s.title} className="bg-white/80 border border-orange-100 rounded-xl p-4">
              <s.icon size={18} className="text-orange-500 mb-2" />
              <p className="text-sm font-bold text-gray-800">{s.title}</p>
              <p className="text-xs text-gray-500 mt-1">{s.desc}</p>
            </div>
          ))}
        </div>

        <button onClick={onNew} className="mt-8 inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold px-7 py-3 rounded-xl text-sm transition shadow-lg shadow-orange-200">
          <Sparkles size={16} /> Create your first broadcast
        </button>
      </div>
    );
  }

  // ── History ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Reachable audience", value: reachableCount, hint: "opted-in contacts" },
          { label: "Broadcasts sent", value: sentCampaigns.length, hint: `${totalSent} emails delivered` },
          { label: "Average open rate", value: avgOpenRate === null ? "—" : `${avgOpenRate}%`, hint: "across sent broadcasts" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-2xl font-bold text-gray-900">{s.value}</div>
            <div className="text-xs font-medium text-gray-600 mt-0.5">{s.label}</div>
            <div className="text-[11px] text-gray-400">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Your broadcasts</p>
        <button onClick={onNew} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-xl text-sm transition">
          <Sparkles size={15} /> New broadcast
        </button>
      </div>

      <div className="space-y-2.5">
        {campaigns.map((c) => {
          const st = CAMPAIGN_STATUS[c.status] ?? CAMPAIGN_STATUS.draft;
          const openRate = c.sentCount > 0 ? Math.round((c.openedCount / c.sentCount) * 100) : null;
          const editable = c.status === "draft" || c.status === "scheduled";
          return (
            <div key={c.id} className="bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-gray-300 transition">
              <div className="flex flex-wrap items-center gap-4">
                <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm truncate">{c.subject || "(no subject)"}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {c.status === "scheduled" && c.scheduledAt ? <>Scheduled for <span className="font-medium text-blue-600">{fmtDateTime(c.scheduledAt)}</span> · {audienceLabel(c.audience)}</>
                      : c.status === "sent" && c.completedAt ? <>Sent {fmtDateTime(c.completedAt)} · to {c.sentCount} people</>
                      : c.status === "sending" ? <>Sending now… {c.sentCount}/{c.totalRecipients}</>
                      : <>Draft · saved {fmtDateTime(c.createdAt)} · {audienceLabel(c.audience)}</>}
                  </p>
                </div>

                {(c.status === "sent" || c.status === "sending") && (
                  <div className="flex items-center gap-5 text-center shrink-0">
                    <div><div className="text-sm font-bold text-gray-800">{c.sentCount}</div><div className="text-[10px] text-gray-400 uppercase">sent</div></div>
                    <div><div className="text-sm font-bold text-emerald-700">{openRate === null ? "—" : `${openRate}%`}</div><div className="text-[10px] text-gray-400 uppercase">opened</div></div>
                    {c.failedCount > 0 && <div><div className="text-sm font-bold text-red-600">{c.failedCount}</div><div className="text-[10px] text-gray-400 uppercase">failed</div></div>}
                  </div>
                )}

                <div className="flex items-center gap-1.5 shrink-0">
                  {editable && (
                    <button onClick={() => onResume(c.id)} className="flex items-center gap-1 text-sm text-orange-600 hover:bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 transition">
                      <FileEdit size={13} /> {c.status === "draft" ? "Continue" : "Edit"}
                    </button>
                  )}
                  {c.status !== "sending" && (
                    confirmDelete === c.id ? (
                      <button onClick={() => del(c.id)} disabled={deleting === c.id} className="flex items-center gap-1 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg px-2.5 py-1.5 transition">
                        {deleting === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Sure?
                      </button>
                    ) : (
                      <button onClick={() => { setConfirmDelete(c.id); setTimeout(() => setConfirmDelete((v) => v === c.id ? null : v), 4000); }} className="text-gray-300 hover:text-red-500 transition p-1.5" title="Delete">
                        <Trash2 size={15} />
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══ Audience section ═════════════════════════════════════════════════════════
function AudienceSection(props: {
  customers: ReservationCustomer[]; loading: boolean;
  search: string; setSearch: (v: string) => void;
  filterTag: string; setFilterTag: (v: string) => void; allTags: string[];
  filterOptIn: boolean; setFilterOptIn: (fn: (v: boolean) => boolean) => void;
  sourceFilter: Set<ContactSource>; setSourceFilter: (fn: (v: Set<ContactSource>) => Set<ContactSource>) => void;
  selected: Set<string>; setSelected: (fn: (v: Set<string>) => Set<string>) => void;
  onSave: (id: string, patch: { notes?: string; tags?: string[]; marketingOptIn?: boolean }) => Promise<void>;
  onRefresh: () => void;
  onBroadcastToSelection: () => void;
}) {
  const {
    customers, loading, search, setSearch, filterTag, setFilterTag, allTags,
    filterOptIn, setFilterOptIn, sourceFilter, setSourceFilter,
    selected, setSelected, onSave, onRefresh, onBroadcastToSelection,
  } = props;

  const filtered = customers.filter((c) => {
    if (filterOptIn && !c.marketingOptIn) return false;
    if (filterTag && !c.tags.includes(filterTag)) return false;
    if (sourceFilter.size > 0 && !(c.sources ?? []).some((s) => sourceFilter.has(s))) return false;
    if (search) { const q = search.toLowerCase(); return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q); }
    return true;
  });

  const reachableCount = customers.filter(isMailable).length;
  const unsubCount = customers.filter((c) => !c.marketingOptIn).length;
  const sourceCounts = ALL_SOURCES.reduce((acc, s) => { acc[s] = customers.filter((c) => (c.sources ?? []).includes(s)).length; return acc; }, {} as Record<ContactSource, number>);

  const filteredMailableIds = filtered.filter(isMailable).map((c) => c.id);
  const allFilteredSelected = filteredMailableIds.length > 0 && filteredMailableIds.every((id) => selected.has(id));

  function toggleSource(s: ContactSource) { setSourceFilter((p) => { const n = new Set(p); if (n.has(s)) n.delete(s); else n.add(s); return n; }); }
  function toggleSelect(id: string) { setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function toggleSelectAll() {
    setSelected((prev) => { const n = new Set(prev); if (allFilteredSelected) filteredMailableIds.forEach((id) => n.delete(id)); else filteredMailableIds.forEach((id) => n.add(id)); return n; });
  }

  function exportCsv() {
    const header = ["Name", "Email", "Phone", "Sources", "Opted in", "Unsubscribed", "Tags", "Notes"];
    const rows = filtered.map((c) => [c.name, c.email, c.phone, (c.sources ?? []).map((s) => SOURCE_META[s]?.label ?? s).join("; "), c.marketingOptIn ? "Yes" : "No", c.unsubscribedAt ? fmtDate(c.unsubscribedAt) : "", c.tags.join("; "), c.notes.replace(/\n/g, " ")]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `marketing-contacts-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Compact stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "All contacts", value: customers.length, cls: "text-gray-900" },
          { label: "Reachable", value: reachableCount, cls: "text-emerald-600" },
          { label: "Unsubscribed", value: unsubCount, cls: "text-red-500" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* One combined filter card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-45 border border-gray-200 rounded-xl px-3 py-2">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input type="text" placeholder="Search name, email, or phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full text-sm focus:outline-none placeholder-gray-400" />
          </div>
          {allTags.length > 0 && (
            <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition">
              <option value="">All tags</option>{allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <button onClick={() => setFilterOptIn((v) => !v)} className={`flex items-center gap-1.5 border rounded-xl px-3 py-2 text-sm font-medium transition ${filterOptIn ? "bg-green-50 border-green-300 text-green-700" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}><Mail size={13} /> Opted-in only</button>
          <button onClick={exportCsv} disabled={filtered.length === 0} className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:border-gray-300 transition disabled:opacity-40"><FileDown size={14} /> CSV</button>
          <button onClick={onRefresh} disabled={loading} className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition" title="Refresh"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Came from:</span>
          {ALL_SOURCES.map((s) => {
            const meta = SOURCE_META[s]; const Icon = meta.icon; const active = sourceFilter.has(s);
            return (
              <button key={s} onClick={() => toggleSource(s)}
                className={`flex items-center gap-1.5 border rounded-full px-3 py-1 text-xs font-semibold transition ${active ? meta.active : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                <Icon size={11} /> {meta.label}<span className="text-[10px] opacity-70">{sourceCounts[s]}</span>
              </button>
            );
          })}
          {sourceFilter.size > 0 && <button onClick={() => setSourceFilter(() => new Set())} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-1"><X size={12} /> Clear</button>}
        </div>
      </div>

      {/* Select-all row */}
      {filtered.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer px-1">
          <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="w-4 h-4 accent-orange-500" />
          Select all reachable in this view ({filteredMailableIds.length})
        </label>
      )}

      {/* List */}
      {loading ? <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-orange-500" /></div>
        : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3 text-center bg-white rounded-2xl border border-gray-200">
            <Users size={32} className="text-gray-300" />
            <p className="font-semibold text-gray-600">No contacts found</p>
            <p className="text-sm text-gray-400 max-w-xs">{customers.length === 0 ? "Emails collect here automatically when customers order online, book a table, buy a gift card, or ask for an e-bill." : "Nothing matches the current filters."}</p>
          </div>
        ) : (
          <div className="space-y-3">{filtered.map((c) => <ContactCard key={c.id} customer={c} onSave={onSave} selected={selected.has(c.id)} onToggleSelect={toggleSelect} />)}</div>
        )}

      {/* Floating action bar when contacts are selected */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 inset-x-0 z-40 flex justify-center pointer-events-none px-4">
          <div className="pointer-events-auto bg-gray-900 text-white rounded-full shadow-2xl pl-5 pr-2 py-2 flex items-center gap-4">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <button onClick={onBroadcastToSelection} className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-full px-4 py-1.5 transition">
              <Send size={13} /> Send them a broadcast
            </button>
            <button onClick={() => setSelected(() => new Set())} className="text-gray-400 hover:text-white transition p-1.5" title="Clear selection"><X size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ Compose wizard — ① Who → ② Write → ③ Review & send ══════════════════════
type SendPhase =
  | { phase: "idle" }
  | { phase: "sending"; done: number; total: number }
  | { phase: "done"; sent: number; failed: number; skipped: number }
  | { phase: "error"; message: string };

const STEPS = [
  { n: 1, label: "Who" },
  { n: 2, label: "Write" },
  { n: 3, label: "Review & send" },
] as const;

function ComposeWizard({ contacts, allTags, brandColor, restaurantName, editingId: initialEditingId, initial, onExit }: {
  contacts: ReservationCustomer[]; allTags: string[]; brandColor: string; restaurantName: string;
  editingId: string | null;
  initial: { subject: string; previewText: string; body: string; audience: Audience; startStep: 1 | 2 };
  onExit: () => void;
}) {
  const { settings, updateSettings } = useApp();
  const savedTemplates = settings.broadcastTemplates ?? [];
  const [step, setStep] = useState<1 | 2 | 3>(initial.startStep);
  const [subject, setSubject] = useState(initial.subject);
  const [previewText, setPreviewText] = useState(initial.previewText);
  const [body, setBody] = useState(initial.body);
  const [audience, setAudience] = useState<Audience>(initial.audience);
  const [editingId, setEditingId] = useState<string | null>(initialEditingId);
  const [editorVersion, setEditorVersion] = useState(0);

  const [testTo, setTestTo] = useState("");
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [send, setSend] = useState<SendPhase>({ phase: "idle" });
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [confirmArm, setConfirmArm] = useState(false);
  const inFlight = useRef(false);
  const editorKeyBase = useRef(initialEditingId ?? `new-${Date.now()}`).current;

  const recipients = resolveRecipients(contacts, audience);
  const total = recipients.length;
  const busy = send.phase === "sending" || savingDraft;

  const bodyHasText = body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim().length > 0;
  const step1Done = total > 0;
  const step2Done = subject.trim().length > 0 && bodyHasText;
  const canSend = step1Done && step2Done;

  function applyStarter(s: { subject: string; preview: string; body: string }) {
    if (bodyHasText && !window.confirm("Replace your current message with this template?")) return;
    setSubject(s.subject);
    setPreviewText(s.preview);
    setBody(s.body);
    setEditorVersion((v) => v + 1);
  }

  function saveAsTemplate() {
    const name = (prompt("Name this template (e.g. Monthly offer):") ?? "").trim();
    if (!name) return;
    const next = [
      ...savedTemplates,
      { id: crypto.randomUUID(), name, subject, previewText, body, createdAt: new Date().toISOString() },
    ];
    updateSettings({ broadcastTemplates: next });
  }

  function deleteTemplate(id: string) {
    if (!window.confirm("Delete this saved template?")) return;
    updateSettings({ broadcastTemplates: savedTemplates.filter((t) => t.id !== id) });
  }

  /** Create the draft on first persist, PATCH thereafter. Returns the id. */
  async function persist(): Promise<string | null> {
    try {
      if (!editingId) {
        const res = await fetch("/api/admin/campaigns", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, bodyHtml: body, previewText, audience }),
        });
        const json = await res.json() as { ok: boolean; id?: string; error?: string };
        if (!json.ok || !json.id) throw new Error(json.error ?? "Could not save.");
        setEditingId(json.id);
        return json.id;
      }
      const res = await fetch(`/api/admin/campaigns/${editingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, bodyHtml: body, previewText, audience }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Could not save.");
      return editingId;
    } catch (e) { setSend({ phase: "error", message: e instanceof Error ? e.message : "Save failed." }); return null; }
  }

  async function saveDraft() {
    if (busy) return; setSavingDraft(true); setSend({ phase: "idle" });
    const id = await persist();
    setSavingDraft(false);
    if (id) { setDraftSaved(true); setTimeout(() => setDraftSaved(false), 2500); }
  }

  async function sendTest() {
    if (!testTo.trim() || !canSend) return;
    setTestState("sending");
    try {
      const res = await fetch("/api/admin/campaigns/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, bodyHtml: body, previewText, to: testTo.trim() }),
      });
      const json = await res.json() as { ok: boolean };
      setTestState(json.ok ? "sent" : "error");
    } catch { setTestState("error"); }
    finally { setTimeout(() => setTestState("idle"), 3000); }
  }

  async function sendNow() {
    if (inFlight.current || busy || !canSend) return;
    inFlight.current = true;
    setSend({ phase: "sending", done: 0, total });
    const id = await persist();
    if (!id) { inFlight.current = false; return; }
    try {
      for (;;) {
        const res = await fetch(`/api/admin/campaigns/${id}/send`, { method: "POST" });
        const json = await res.json() as { ok: boolean; done?: boolean; error?: string; totals?: { sent: number; failed: number; skipped: number } };
        if (!json.ok) { setSend({ phase: "error", message: json.error ?? "Sending failed." }); return; }
        const t = json.totals ?? { sent: 0, failed: 0, skipped: 0 };
        if (json.done) { setSend({ phase: "done", sent: t.sent, failed: t.failed, skipped: t.skipped }); return; }
        setSend({ phase: "sending", done: t.sent + t.failed + t.skipped, total });
      }
    } catch { setSend({ phase: "error", message: "Connection error while sending." }); }
    finally { inFlight.current = false; }
  }

  async function schedule() {
    if (busy || !scheduleAt || !canSend) return;
    const id = await persist();
    if (!id) return;
    const res = await fetch(`/api/admin/campaigns/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledAt: new Date(scheduleAt).toISOString() }),
    });
    const json = await res.json() as { ok: boolean };
    if (json.ok) setScheduled(true);
  }

  const minSchedule = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16);

  // ── Terminal screens ────────────────────────────────────────────────────────
  if (send.phase === "done") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center"><PartyPopper size={30} className="text-green-600" /></div>
        <h3 className="text-2xl font-bold text-gray-900">Broadcast sent!</h3>
        <p className="text-sm text-gray-500">{send.sent} delivered{send.failed > 0 && ` · ${send.failed} failed`}{send.skipped > 0 && ` · ${send.skipped} skipped`}</p>
        <p className="text-xs text-gray-400">Open rates will appear on the Broadcasts page as people read it.</p>
        <button onClick={onExit} className="mt-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition">Back to broadcasts</button>
      </div>
    );
  }
  if (scheduled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center"><CalendarClock size={30} className="text-blue-600" /></div>
        <h3 className="text-2xl font-bold text-gray-900">Scheduled ✓</h3>
        <p className="text-sm text-gray-500">Going to {total} contact{total !== 1 ? "s" : ""} on {fmtDateTime(new Date(scheduleAt).toISOString())}.</p>
        <button onClick={onExit} className="mt-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition">Back to broadcasts</button>
      </div>
    );
  }
  if (send.phase === "sending") {
    const pct = send.total > 0 ? Math.min(100, Math.round((send.done / send.total) * 100)) : 5;
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <Loader2 size={36} className="animate-spin text-orange-500" />
        <h3 className="text-xl font-bold text-gray-900">Sending your broadcast…</h3>
        <div className="w-full max-w-sm bg-gray-100 rounded-full h-3 overflow-hidden">
          <div className="bg-orange-500 h-3 rounded-full transition-all duration-500" style={{ width: `${Math.max(5, pct)}%` }} />
        </div>
        <p className="text-sm text-gray-500">{send.done} of {send.total} sent — keep this page open.</p>
      </div>
    );
  }

  // ── Wizard chrome ──────────────────────────────────────────────────────────
  const stepReachable = (n: number) => n === 1 || (n === 2 && step1Done) || (n === 3 && step1Done && step2Done);

  return (
    <div className="space-y-5">
      {/* Top bar: back · stepper · save draft */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
        <button onClick={onExit} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition"><ArrowLeft size={16} /> Exit</button>

        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex items-center">
              <button
                onClick={() => stepReachable(s.n) && setStep(s.n as 1 | 2 | 3)}
                disabled={!stepReachable(s.n)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold transition ${
                  step === s.n ? "bg-orange-500 text-white"
                  : stepReachable(s.n) ? "text-gray-600 hover:bg-gray-100"
                  : "text-gray-300 cursor-not-allowed"}`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  step === s.n ? "bg-white/25 text-white"
                  : (s.n === 1 && step1Done) || (s.n === 2 && step2Done) ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-500"}`}>
                  {(s.n === 1 && step1Done && step !== 1) || (s.n === 2 && step2Done && step !== 2) ? <Check size={11} /> : s.n}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-gray-200 mx-0.5" />}
            </div>
          ))}
        </div>

        <button onClick={saveDraft} disabled={busy} className={`flex items-center gap-1.5 text-sm font-medium transition disabled:opacity-50 ${draftSaved ? "text-green-600" : "text-gray-400 hover:text-gray-700"}`}>
          {savingDraft ? <Loader2 size={14} className="animate-spin" /> : draftSaved ? <CheckCircle2 size={14} /> : <FileEdit size={14} />}
          {draftSaved ? "Saved" : "Save draft"}
        </button>
      </div>

      {send.phase === "error" && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-2.5 text-sm"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {send.message}</div>
      )}

      {/* ── STEP 1: WHO ── */}
      {step === 1 && (
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="text-center">
            <h3 className="text-xl font-bold text-gray-900">Who should get this email?</h3>
            <p className="text-sm text-gray-500 mt-1">Only opted-in contacts are ever emailed — unsubscribes are always respected.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {([
              { mode: "all",       icon: Users,     title: "Everyone",       desc: "All opted-in contacts" },
              { mode: "sources",   icon: Tag,       title: "By source",      desc: "Where their email came from" },
              { mode: "tags",      icon: Star,      title: "By tag",         desc: "VIPs, regulars, birthdays…" },
              { mode: "selection", icon: UserCheck, title: "Hand-picked",    desc: "Choose them in Audience" },
            ] as const).map((opt) => {
              const active = audience.mode === opt.mode;
              return (
                <button key={opt.mode}
                  onClick={() => setAudience(opt.mode === "all" ? { mode: "all" } : opt.mode === "sources" ? { mode: "sources", sources: audience.mode === "sources" ? audience.sources : [] } : opt.mode === "tags" ? { mode: "tags", tags: audience.mode === "tags" ? audience.tags : [] } : { mode: "selection", ids: audience.mode === "selection" ? audience.ids : [] })}
                  className={`text-left rounded-2xl border-2 p-4 transition ${active ? "border-orange-400 bg-orange-50" : "border-gray-200 bg-white hover:border-orange-200"}`}>
                  <opt.icon size={18} className={active ? "text-orange-600" : "text-gray-400"} />
                  <p className={`text-sm font-bold mt-2 ${active ? "text-orange-800" : "text-gray-800"}`}>{opt.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                </button>
              );
            })}
          </div>

          {audience.mode === "sources" && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap gap-1.5">
              {ALL_SOURCES.map((s) => {
                const meta = SOURCE_META[s]; const on = audience.sources.includes(s);
                return <button key={s} onClick={() => setAudience({ mode: "sources", sources: on ? audience.sources.filter((x) => x !== s) : [...audience.sources, s] })}
                  className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition ${on ? meta.active : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"}`}>{meta.label}</button>;
              })}
            </div>
          )}
          {audience.mode === "tags" && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap gap-1.5">
              {allTags.length === 0 ? <p className="text-xs text-gray-400">No tags yet — add tags to contacts in the Audience view first.</p> : allTags.map((t) => {
                const on = audience.tags.includes(t);
                return <button key={t} onClick={() => setAudience({ mode: "tags", tags: on ? audience.tags.filter((x) => x !== t) : [...audience.tags, t] })}
                  className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition ${on ? "bg-orange-100 border-orange-400 text-orange-800" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"}`}>{t}</button>;
              })}
            </div>
          )}
          {audience.mode === "selection" && audience.ids.length === 0 && (
            <p className="text-sm text-gray-500 text-center bg-white border border-gray-200 rounded-2xl p-4">
              Go to the <span className="font-semibold">Audience</span> view, tick the contacts you want, then press &ldquo;Send them a broadcast&rdquo;.
            </p>
          )}

          {/* Live reach banner */}
          <div className={`rounded-2xl border px-5 py-4 flex items-center gap-4 ${total > 0 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
            {total > 0 ? (
              <>
                <div className="flex -space-x-2 shrink-0">
                  {recipients.slice(0, 5).map((r) => (
                    <div key={r.id} className="w-8 h-8 rounded-full bg-white border-2 border-emerald-200 flex items-center justify-center text-xs font-bold text-emerald-700">
                      {(r.name || r.email).charAt(0).toUpperCase()}
                    </div>
                  ))}
                  {total > 5 && <div className="w-8 h-8 rounded-full bg-emerald-600 border-2 border-emerald-200 flex items-center justify-center text-[10px] font-bold text-white">+{total - 5}</div>}
                </div>
                <p className="text-sm text-emerald-800"><span className="font-bold">{total} {total === 1 ? "person" : "people"}</span> will get this email.</p>
              </>
            ) : (
              <p className="text-sm text-amber-700 flex items-center gap-2"><AlertTriangle size={15} /> No one matches yet — pick at least one option above.</p>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setStep(2)} disabled={!step1Done} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition disabled:opacity-40">
              Next: write your message <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: WRITE ── */}
      {step === 2 && (
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="text-center">
            <h3 className="text-xl font-bold text-gray-900">Write your message</h3>
            <p className="text-sm text-gray-500 mt-1">Start from a template or write your own — {"{{name}}"} becomes each customer&apos;s real name.</p>
          </div>

          {/* Quick starts — your saved templates first, then the built-ins */}
          <div className="flex flex-wrap gap-2 justify-center">
            {savedTemplates.map((t) => (
              <span key={t.id} className="flex items-center bg-orange-50 border border-orange-200 rounded-full pl-3.5 pr-1.5 py-1 text-xs font-semibold text-orange-700">
                <button onClick={() => applyStarter({ subject: t.subject, preview: t.previewText, body: t.body })}
                  className="flex items-center gap-1.5 hover:text-orange-900 transition" title="Use this template">
                  <Star size={11} className="fill-orange-400 text-orange-400" /> {t.name}
                </button>
                <button onClick={() => deleteTemplate(t.id)} className="ml-1.5 p-0.5 text-orange-300 hover:text-red-500 transition" title="Delete template">
                  <X size={11} />
                </button>
              </span>
            ))}
            {TEMPLATES.map((t) => (
              <button key={t.name} onClick={() => applyStarter({ subject: t.subject, preview: t.preview, body: t.body })}
                className="flex items-center gap-1.5 bg-white border border-gray-200 hover:border-orange-300 hover:bg-orange-50 rounded-full px-3.5 py-1.5 text-xs font-semibold text-gray-600 hover:text-orange-700 transition">
                <span>{t.emoji}</span> {t.name}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Subject line</label>
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A little treat from us, {{name}} 🎁"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:border-orange-400 transition" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Preview text <span className="text-gray-400 font-normal">— the grey snippet shown in the inbox (optional)</span></label>
              <input type="text" value={previewText} onChange={(e) => setPreviewText(e.target.value)} placeholder="Show this email for 20% off this weekend"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition" />
            </div>
          </div>

          <BroadcastEditor editorKey={`${editorKeyBase}-v${editorVersion}`} initialValue={body} onChange={setBody} />

          <div className="flex justify-between items-center gap-3 flex-wrap">
            <button onClick={() => setStep(1)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition"><ArrowLeft size={15} /> Back</button>
            <div className="flex items-center gap-3">
              <button onClick={saveAsTemplate} disabled={!step2Done}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-orange-600 transition disabled:opacity-40" title="Save subject + message to reuse next time">
                <Star size={14} /> Save as template
              </button>
              <button onClick={() => setStep(3)} disabled={!step2Done} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition disabled:opacity-40">
                Next: review &amp; send <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 3: REVIEW & SEND ── */}
      {step === 3 && (
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            {/* Summary */}
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
              {[
                { label: "To", value: `${audienceLabel(audience)} — ${total} ${total === 1 ? "person" : "people"}`, edit: 1 as const },
                { label: "Subject", value: subject || "(no subject)", edit: 2 as const },
                { label: "Preview text", value: previewText || "—", edit: 2 as const },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide w-24 shrink-0">{row.label}</span>
                  <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{row.value}</span>
                  <button onClick={() => setStep(row.edit)} className="text-xs text-orange-600 hover:underline shrink-0">Edit</button>
                </div>
              ))}
            </div>

            {/* Test send */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Eye size={14} /> Send yourself a test first</p>
              <p className="text-xs text-gray-400">Exactly what your customers will receive — check it on your phone.</p>
              <div className="flex gap-2">
                <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com"
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400 transition" />
                <button onClick={sendTest} disabled={!testTo.trim() || !canSend || testState === "sending"} className="flex shrink-0 items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 hover:border-orange-300 hover:text-orange-600 transition disabled:opacity-40">
                  {testState === "sending" ? <Loader2 size={13} className="animate-spin" /> : testState === "sent" ? <CheckCircle2 size={13} className="text-green-600" /> : <Send size={13} />}
                  {testState === "sent" ? "Sent!" : testState === "error" ? "Failed" : "Send test"}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
              <button
                onClick={() => { if (!confirmArm) { setConfirmArm(true); setTimeout(() => setConfirmArm(false), 6000); } else { setConfirmArm(false); sendNow(); } }}
                disabled={!canSend || busy}
                className={`w-full flex items-center justify-center gap-2 font-bold px-4 py-3.5 rounded-xl text-sm transition disabled:opacity-50 ${confirmArm ? "bg-orange-700 hover:bg-orange-800 text-white" : "bg-orange-500 hover:bg-orange-600 text-white"}`}>
                <Send size={16} />
                {confirmArm ? `Yes — send to ${total} ${total === 1 ? "person" : "people"} now` : "Send now"}
              </button>
              {confirmArm && <p className="text-[11px] text-center text-gray-400">Click again to confirm, or wait to cancel.</p>}

              <button onClick={() => setShowSchedule((v) => !v)} disabled={!canSend || busy}
                className="w-full flex items-center justify-center gap-2 border border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold px-4 py-2.5 rounded-xl text-sm transition disabled:opacity-50">
                <CalendarClock size={15} /> {showSchedule ? "Hide scheduling" : "Schedule for later"}
              </button>
              {showSchedule && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-2">
                  <input type="datetime-local" min={minSchedule} value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                    className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 bg-white" />
                  <button onClick={schedule} disabled={!scheduleAt || !canSend} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50">
                    Schedule broadcast
                  </button>
                  <p className="text-[11px] text-blue-500">Needs the campaign cron set up on the server (docs/marketing/SCHEDULING.md).</p>
                </div>
              )}
            </div>

            <button onClick={() => setStep(2)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition"><ArrowLeft size={15} /> Back to writing</button>
          </div>

          {/* Live preview */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider"><Eye size={13} /> What they&apos;ll see</div>
            <div className="lg:sticky lg:top-4">
              <EmailPreview subject={subject} previewText={previewText} body={body} brandColor={brandColor} restaurantName={restaurantName} />
              <p className="text-[11px] text-gray-400 mt-2">Shown with sample data — each customer gets their own name.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
