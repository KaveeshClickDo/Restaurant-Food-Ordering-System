"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/context/AppContext";
import type { EmailTemplate, EmailTemplateEvent } from "@/types";
import {
  EVENT_CONFIGS,
  TEMPLATE_VARS,
  applyVars,
  buildEmailDocument,
  buildPreviewVarMap,
  buildReservationPreviewVarMap,
  sendEmailViaApi,
} from "@/lib/emailTemplates";
import {
  Mail, Bold, Italic, Underline, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Minus, Undo2,
  CheckCircle, AlertTriangle, Loader2, Eye, Pencil,
  ToggleLeft, ToggleRight, Send, Variable, Strikethrough,
  Heading1, Heading2, CalendarDays, ShoppingBag,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Strips the classic XSS vectors from email preview HTML.
// User-supplied values are already HTML-escaped by escHtml() before reaching here;
// this is defense-in-depth against a malicious admin template.
function sanitizePreviewHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe\s*>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object\s*>/gi, "")
    .replace(/<embed\s[^>]*>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

function isReservationEvent(event: EmailTemplateEvent): boolean {
  return event.startsWith("reservation_");
}

const VAR_STYLE =
  "display:inline-block;background:#fef3c7;border:1px solid #f59e0b;" +
  "border-radius:4px;padding:0 5px;font-size:0.82em;font-family:monospace;" +
  "color:#92400e;cursor:default;user-select:none;margin:0 2px;line-height:1.6;";

function storageToDisplay(html: string): string {
  return html.replace(
    /\{\{([a-z_]+)\}\}/g,
    (_, v) =>
      `<span contenteditable="false" data-var="${v}" style="${VAR_STYLE}">{{${v}}}</span>`,
  );
}

function displayToStorage(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>("[data-var]").forEach((el) => {
    const varName = el.getAttribute("data-var") ?? "";
    el.replaceWith(document.createTextNode(`{{${varName}}}`));
  });
  return clone.innerHTML;
}

// ─── Rich text editor ─────────────────────────────────────────────────────────

interface RichEditorProps {
  editorKey: string;
  initialValue: string;
  onChange: (storageHtml: string) => void;
  varGroupFilter: string[];
}

function RichEditor({ editorKey, initialValue, onChange, varGroupFilter }: RichEditorProps) {
  const editorRef  = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = storageToDisplay(initialValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey]);

  function saveRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (editorRef.current?.contains(r.commonAncestorContainer)) {
        savedRange.current = r.cloneRange();
      }
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
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
      range = savedRange.current;
    } else if (sel && sel.rangeCount > 0) {
      range = sel.getRangeAt(0);
    }

    if (range && editor.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(span);
      const after = document.createRange();
      after.setStartAfter(span);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
      savedRange.current = after.cloneRange();
    } else {
      editor.appendChild(span);
      editor.appendChild(document.createTextNode(" "));
    }

    onChange(displayToStorage(editor));
  }

  const TB = ({
    onClick, title, children,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); saveRange(); }}
      onClick={onClick}
      title={title}
      className="w-7 h-7 flex items-center justify-center rounded-lg text-sm transition text-gray-500 hover:bg-gray-100 hover:text-gray-800"
    >
      {children}
    </button>
  );

  const filteredVars = TEMPLATE_VARS.filter((v) => varGroupFilter.includes(v.group));
  const varGroups = Object.entries(
    filteredVars.reduce<Record<string, typeof TEMPLATE_VARS>>((acc, v) => {
      (acc[v.group] ??= []).push(v);
      return acc;
    }, {}),
  );

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Formatting toolbar */}
      <div className="flex items-center gap-0.5 flex-wrap px-3 py-2 border-b border-gray-100 bg-gray-50">
        <TB onClick={() => exec("bold")}          title="Bold">          <Bold size={13} /></TB>
        <TB onClick={() => exec("italic")}        title="Italic">        <Italic size={13} /></TB>
        <TB onClick={() => exec("underline")}     title="Underline">     <Underline size={13} /></TB>
        <TB onClick={() => exec("strikeThrough")} title="Strikethrough"> <Strikethrough size={13} /></TB>

        <span className="w-px h-4 bg-gray-200 mx-1" />

        <TB onClick={() => exec("formatBlock", "<h1>")} title="Heading 1"><Heading1 size={14} /></TB>
        <TB onClick={() => exec("formatBlock", "<h2>")} title="Heading 2"><Heading2 size={14} /></TB>
        <TB onClick={() => exec("formatBlock", "<p>")}  title="Paragraph">
          <span className="text-[11px] font-semibold">P</span>
        </TB>

        <span className="w-px h-4 bg-gray-200 mx-1" />

        <TB onClick={() => exec("insertUnorderedList")} title="Bullet list">  <List size={13} /></TB>
        <TB onClick={() => exec("insertOrderedList")}   title="Numbered list"><ListOrdered size={13} /></TB>

        <span className="w-px h-4 bg-gray-200 mx-1" />

        <TB onClick={() => exec("justifyLeft")}   title="Align left">   <AlignLeft size={13} /></TB>
        <TB onClick={() => exec("justifyCenter")} title="Align center"> <AlignCenter size={13} /></TB>
        <TB onClick={() => exec("justifyRight")}  title="Align right">  <AlignRight size={13} /></TB>

        <span className="w-px h-4 bg-gray-200 mx-1" />

        <TB onClick={() => exec("insertHorizontalRule")} title="Divider"><Minus size={13} /></TB>
        <TB onClick={() => exec("removeFormat")}          title="Clear formatting"><Undo2 size={13} /></TB>
      </div>

      {/* Variable insertion — filtered by template category */}
      <div className="px-3 py-2 border-b border-gray-100 bg-amber-50">
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            <Variable size={13} className="text-amber-600" />
            <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Insert variable</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {varGroups.map(([group, vars]) => (
              <div key={group} className="flex flex-wrap gap-1">
                {vars.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    title={v.label}
                    onMouseDown={(e) => { e.preventDefault(); saveRange(); }}
                    onClick={() => insertVariable(v.name)}
                    className="text-[11px] bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-200 rounded-md px-2 py-0.5 font-mono transition"
                  >
                    {`{{${v.name}}}`}
                  </button>
                ))}
                <span className="w-px h-4 bg-amber-200 mx-0.5 self-center" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => { if (editorRef.current) onChange(displayToStorage(editorRef.current)); }}
        onKeyUp={saveRange}
        onMouseUp={saveRange}
        className="min-h-[280px] p-4 focus:outline-none text-sm leading-relaxed text-gray-800 prose prose-sm max-w-none"
        style={{ caretColor: "#ea580c" }}
      />
    </div>
  );
}

// ─── Email preview ────────────────────────────────────────────────────────────

function EmailPreview({
  subject,
  body,
  settings,
  isReservation,
}: {
  subject: string;
  body: string;
  settings: ReturnType<typeof useApp>["settings"];
  isReservation: boolean;
}) {
  const vars = isReservation
    ? buildReservationPreviewVarMap(settings)
    : buildPreviewVarMap(settings);

  const resolvedSubject = applyVars(subject, vars);
  const resolvedBody    = applyVars(body,    vars);

  const restAddr = [
    settings.restaurant.addressLine1,
    settings.restaurant.city,
    settings.restaurant.postcode,
  ].filter(Boolean).join(", ");

  const html = buildEmailDocument(
    resolvedBody,
    settings.restaurant.name,
    restAddr,
    settings.restaurant.phone,
  );

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500 flex-shrink-0">Subject:</span>
        <span className="text-sm text-gray-800 font-medium">{resolvedSubject || <em className="text-gray-400">No subject</em>}</span>
      </div>
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-100 p-4">
        <div
          className="max-w-[600px] mx-auto"
          dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(html) }}
        />
      </div>
      <p className="text-[11px] text-gray-400 text-center">
        Preview uses sample data — actual emails will contain real {isReservation ? "reservation" : "order"} details.
      </p>
    </div>
  );
}

// ─── Test send widget ─────────────────────────────────────────────────────────

type SendState = "idle" | "sending" | "success" | "error";

function TestSendWidget({
  subject,
  body,
  settings,
  isReservation,
}: {
  subject: string;
  body: string;
  settings: ReturnType<typeof useApp>["settings"];
  isReservation: boolean;
}) {
  const [email,     setEmail]     = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState("");

  async function handleSend() {
    if (!email.trim()) return;
    setSendState("sending");
    setSendError("");

    const vars = isReservation
      ? buildReservationPreviewVarMap(settings)
      : buildPreviewVarMap(settings);

    const resolvedSubject = applyVars(subject, vars);
    const resolvedBody    = applyVars(body,    vars);
    const restAddr = [
      settings.restaurant.addressLine1,
      settings.restaurant.city,
      settings.restaurant.postcode,
    ].filter(Boolean).join(", ");
    const html = buildEmailDocument(
      resolvedBody,
      settings.restaurant.name,
      restAddr,
      settings.restaurant.phone,
    );

    const result = await sendEmailViaApi({ to: email.trim(), subject: resolvedSubject, html });

    if (result.ok) {
      setSendState("success");
      setTimeout(() => setSendState("idle"), 5000);
    } else {
      setSendState("error");
      setSendError(result.error ?? "Unknown error");
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Send size={14} className="text-gray-400" />
        <span className="text-sm font-semibold text-gray-700">Send test email</span>
      </div>

      {sendState === "success" && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
          <CheckCircle size={13} className="text-green-600 flex-shrink-0" />
          <p className="text-xs text-green-700 font-semibold">Test email sent successfully!</p>
        </div>
      )}
      {sendState === "error" && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 break-all font-mono">{sendError}</p>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="test@example.com"
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
        />
        <button
          onClick={handleSend}
          disabled={!email.trim() || sendState === "sending"}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sendState === "sending"
            ? <><Loader2 size={13} className="animate-spin" /> Sending…</>
            : <><Send size={13} /> Send</>
          }
        </button>
      </div>
    </div>
  );
}

// ─── Sidebar section ──────────────────────────────────────────────────────────

const SIDEBAR_GROUPS = [
  {
    label: "Order Emails",
    icon: ShoppingBag,
    filter: (e: EmailTemplateEvent) => e.startsWith("order_"),
  },
  {
    label: "Reservation Emails",
    icon: CalendarDays,
    filter: (e: EmailTemplateEvent) => e.startsWith("reservation_"),
  },
];

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function EmailTemplatesPanel() {
  const { settings, updateSettings } = useApp();
  const templates = settings.emailTemplates ?? [];

  const [selectedEvent, setSelectedEvent] = useState<EmailTemplateEvent>("order_confirmation");
  const [activeView,    setActiveView]    = useState<"edit" | "preview">("edit");
  const [saved,         setSaved]         = useState(false);

  const isResv = isReservationEvent(selectedEvent);

  const currentTemplate = templates.find((t) => t.event === selectedEvent);
  const [subject, setSubject] = useState(currentTemplate?.subject ?? "");
  const [body,    setBody]    = useState(currentTemplate?.body    ?? "");
  const [enabled, setEnabled] = useState(currentTemplate?.enabled ?? true);

  const loadTemplate = useCallback((t: EmailTemplate | undefined) => {
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
    setEnabled(t.enabled);
    setActiveView("edit");
    setSaved(false);
  }, []);

  useEffect(() => {
    loadTemplate(templates.find((t) => t.event === selectedEvent));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEvent]);

  function handleSave() {
    const updated = templates.map((t) =>
      t.event === selectedEvent
        ? { ...t, subject, body, enabled, lastModified: new Date().toISOString() }
        : t,
    );
    updateSettings({ emailTemplates: updated });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const cfg = EVENT_CONFIGS.find((c) => c.event === selectedEvent)!;
  const enabledCount = templates.filter((t) => t.enabled).length;

  // Variable groups shown in the editor depend on the template category
  const varGroupFilter = isResv
    ? ["Customer", "Reservation", "Restaurant"]
    : ["Customer", "Order", "Restaurant"];

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-4 flex items-center gap-4">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Mail size={20} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-gray-900">Email Templates</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {enabledCount} of {templates.length} templates enabled
          </p>
        </div>
        <span className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 flex-shrink-0">
          SMTP via env vars
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ── Template list (sidebar) ── */}
        <div className="w-full lg:w-60 flex-shrink-0 space-y-4">
          {SIDEBAR_GROUPS.map(({ label, icon: Icon, filter }) => {
            const groupEvents = EVENT_CONFIGS.filter((c) => filter(c.event));
            return (
              <div key={label}>
                <div className="flex items-center gap-1.5 px-1 mb-2">
                  <Icon size={11} className="text-gray-400" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {groupEvents.map((c) => {
                    const t = templates.find((x) => x.event === c.event);
                    const active = c.event === selectedEvent;
                    return (
                      <button
                        key={c.event}
                        onClick={() => setSelectedEvent(c.event)}
                        className={`w-full text-left px-3.5 py-3 rounded-xl border-2 transition ${
                          active
                            ? "border-orange-500 bg-orange-50"
                            : "border-gray-100 bg-white hover:border-gray-200"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <span className="text-base flex-shrink-0 mt-0.5">{c.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold truncate ${active ? "text-orange-700" : "text-gray-800"}`}>
                              {c.name}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t?.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                              <span className="text-[10px] text-gray-400">{t?.enabled ? "Enabled" : "Disabled"}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Editor / Preview ── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Panel header */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">{cfg?.emoji}</span>
                <div>
                  <p className="font-bold text-gray-900 text-sm">{cfg?.name}</p>
                  <p className="text-xs text-gray-400">{cfg?.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Enable toggle */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500">
                    {enabled ? "Enabled" : "Disabled"}
                  </span>
                  <button
                    onClick={() => setEnabled((v) => !v)}
                    className={`flex items-center transition ${enabled ? "text-green-500" : "text-gray-300 hover:text-gray-400"}`}
                  >
                    {enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                  </button>
                </div>
                {/* Edit / Preview tabs */}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  {(["edit", "preview"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setActiveView(v)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                        activeView === v
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {v === "edit" ? <Pencil size={11} /> : <Eye size={11} />}
                      {v === "edit" ? "Edit" : "Preview"}
                    </button>
                  ))}
                </div>
                {/* Save */}
                <button
                  onClick={handleSave}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-semibold text-xs transition-all ${
                    saved
                      ? "bg-green-100 text-green-700"
                      : "bg-orange-500 hover:bg-orange-600 text-white"
                  }`}
                >
                  {saved ? <><CheckCircle size={13} /> Saved!</> : "Save template"}
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {activeView === "edit" ? (
                <>
                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Subject line
                    </label>
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder={
                        isResv
                          ? "e.g. Your reservation {{booking_ref}} is confirmed"
                          : "e.g. Your order {{order_id}} has been confirmed"
                      }
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">
                      Variables like{" "}
                      <code className="bg-gray-100 px-1 rounded">
                        {isResv ? "{{booking_ref}}" : "{{order_id}}"}
                      </code>{" "}
                      are replaced with real values when sent.
                    </p>
                  </div>

                  {/* Body editor */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                      Email body
                    </label>
                    <RichEditor
                      editorKey={selectedEvent}
                      initialValue={body}
                      onChange={setBody}
                      varGroupFilter={varGroupFilter}
                    />
                  </div>
                </>
              ) : (
                <EmailPreview
                  subject={subject}
                  body={body}
                  settings={settings}
                  isReservation={isResv}
                />
              )}
            </div>
          </div>

          {/* Test send */}
          <TestSendWidget
            subject={subject}
            body={body}
            settings={settings}
            isReservation={isResv}
          />

          {/* Variable reference */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-900">Variable reference</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {isResv
                  ? "Reservation variables available for this template"
                  : "Order variables available for this template"}
              </p>
            </div>
            <div className="p-5">
              {Object.entries(
                TEMPLATE_VARS
                  .filter((v) => varGroupFilter.includes(v.group))
                  .reduce<Record<string, typeof TEMPLATE_VARS>>((acc, v) => {
                    (acc[v.group] ??= []).push(v);
                    return acc;
                  }, {}),
              ).map(([group, vars]) => (
                <div key={group} className="mb-4 last:mb-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{group}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {vars.map((v) => (
                      <div key={v.name} className="flex items-center gap-2 py-1">
                        <code className="text-[11px] bg-amber-50 border border-amber-200 text-amber-800 rounded px-1.5 py-0.5 font-mono flex-shrink-0">
                          {`{{${v.name}}}`}
                        </code>
                        <span className="text-xs text-gray-500 truncate">{v.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
