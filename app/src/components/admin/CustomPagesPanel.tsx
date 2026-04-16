"use client";

import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import RichEditor from "@/components/admin/RichEditor";
import type { CustomPage } from "@/types";
import {
  Plus, Trash2, Check, ExternalLink, FileText,
  AlertCircle, Globe, EyeOff,
} from "lucide-react";

// ── Slug helpers ──────────────────────────────────────────────────────────────

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Character-count badge ─────────────────────────────────────────────────────

function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.length;
  const over = len > max;
  const near = len > max * 0.85;
  return (
    <span
      className={`text-xs tabular-nums ${
        over ? "text-red-500 font-semibold" : near ? "text-amber-500" : "text-gray-400"
      }`}
    >
      {len}/{max}
    </span>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center mb-4">
        <FileText size={24} className="text-orange-400" />
      </div>
      <h3 className="text-base font-semibold text-gray-800 mb-1">No custom pages yet</h3>
      <p className="text-sm text-gray-400 mb-5 max-w-xs">
        Create standalone pages like &ldquo;Our Story&rdquo;, &ldquo;Catering&rdquo;, or &ldquo;FAQ&rdquo; — they appear instantly at their own URL.
      </p>
      <button
        onClick={onCreate}
        className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
      >
        <Plus size={15} /> Create first page
      </button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function CustomPagesPanel() {
  const { settings, updateSettings } = useApp();
  const pages: CustomPage[] = settings.customPages ?? [];

  // Reserved slugs (footer pages + admin routes)
  const reservedSlugs = new Set([
    ...(settings.footerPages ?? []).map((p) => p.slug),
    "admin", "api",
  ]);

  const [selectedId, setSelectedId] = useState<string | null>(
    pages.length > 0 ? pages[0].id : null
  );
  const [draft, setDraft] = useState<CustomPage | null>(null);
  const [slugManual, setSlugManual] = useState(false); // true once user has edited slug by hand
  const [saved, setSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Load selected page into draft whenever selection changes
  useEffect(() => {
    if (selectedId === "new") {
      setDraft({
        id: crypto.randomUUID(),
        title: "",
        slug: "",
        content: "",
        seoTitle: "",
        seoDescription: "",
        published: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setSlugManual(false);
    } else {
      const page = pages.find((p) => p.id === selectedId) ?? null;
      setDraft(page ? { ...page } : null);
      setSlugManual(false);
    }
    setSaved(false);
    setDeleteConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function patchDraft(patch: Partial<CustomPage>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function handleTitleChange(title: string) {
    patchDraft({ title, ...(!slugManual ? { slug: toSlug(title) } : {}) });
  }

  function handleSlugChange(raw: string) {
    const slug = raw.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");
    setSlugManual(true);
    patchDraft({ slug });
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  function slugError(): string | null {
    if (!draft) return null;
    if (!draft.slug) return "Slug is required.";
    if (reservedSlugs.has(draft.slug)) return "This slug is reserved — choose a different one.";
    const conflict = pages.find((p) => p.slug === draft.slug && p.id !== draft.id);
    if (conflict) return `Slug already used by "${conflict.title}".`;
    return null;
  }

  const titleError = draft && !draft.title.trim() ? "Title is required." : null;
  const currentSlugError = slugError();
  const isValid = !titleError && !currentSlugError;

  // ── Save ────────────────────────────────────────────────────────────────────

  function savePage() {
    if (!draft || !isValid) return;
    const now = new Date().toISOString();
    const updated = { ...draft, updatedAt: now };

    const isNew = !pages.some((p) => p.id === draft.id);
    const newPages = isNew
      ? [...pages, updated]
      : pages.map((p) => (p.id === draft.id ? updated : p));

    updateSettings({ customPages: newPages });
    setDraft(updated);
    setSelectedId(updated.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  function deletePage() {
    if (!draft) return;
    const remaining = pages.filter((p) => p.id !== draft.id);
    updateSettings({ customPages: remaining });
    setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    setDeleteConfirm(false);
  }

  // ── Create new ─────────────────────────────────────────────────────────────

  function createNew() {
    setSelectedId("new");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (pages.length === 0 && selectedId !== "new") {
    return <EmptyState onCreate={createNew} />;
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex flex-col md:flex-row md:divide-x divide-gray-100" style={{ minHeight: 600 }}>

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <aside className="w-full md:w-56 flex-shrink-0 flex flex-col">
          <div className="px-3 pt-4 pb-2">
            <button
              onClick={createNew}
              className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-xl text-sm font-semibold transition"
            >
              <Plus size={14} /> New page
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-1 max-h-40 md:max-h-none">
            {selectedId === "new" && (
              <div className="mx-2 px-3 py-2.5 rounded-xl bg-orange-50 border border-orange-200 text-sm text-orange-700 font-semibold flex items-center gap-2">
                <FileText size={13} />
                <span className="truncate">Untitled page</span>
              </div>
            )}
            {pages.map((page) => (
              <button
                key={page.id}
                onClick={() => setSelectedId(page.id)}
                className={`w-full text-left flex items-center gap-2 px-4 py-2.5 transition text-sm ${
                  selectedId === page.id
                    ? "bg-orange-50 text-orange-600 font-semibold"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {page.published ? (
                  <Globe size={12} className="flex-shrink-0 text-green-500" />
                ) : (
                  <EyeOff size={12} className="flex-shrink-0 text-gray-400" />
                )}
                <span className="truncate">{page.title || "Untitled"}</span>
              </button>
            ))}
          </nav>

          <div className="px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              {pages.filter((p) => p.published).length} published · {pages.length} total
            </p>
          </div>
        </aside>

        {/* ── Editor ───────────────────────────────────────────────────────── */}
        {draft ? (
          <div className="flex-1 min-w-0 p-4 md:p-6 space-y-5 overflow-y-auto">

            {/* Title */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
                Page title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. Our Story"
                className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 ${
                  titleError ? "border-red-300 bg-red-50" : "border-gray-200"
                }`}
              />
              {titleError && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} /> {titleError}
                </p>
              )}
            </div>

            {/* Slug + publish row */}
            <div className="flex gap-3 flex-wrap items-start">
              <div className="flex-1 min-w-48">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
                  URL slug <span className="text-red-400">*</span>
                </label>
                <div className="flex items-center border rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-orange-300 bg-white border-gray-200">
                  <span className="px-3 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 h-full flex items-center py-2.5 select-none">
                    /
                  </span>
                  <input
                    type="text"
                    value={draft.slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="our-story"
                    className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
                  />
                </div>
                {currentSlugError ? (
                  <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle size={11} /> {currentSlugError}
                  </p>
                ) : draft.slug ? (
                  <p className="mt-1 text-xs text-gray-400">
                    Available at <span className="font-mono">/{draft.slug}</span>
                  </p>
                ) : null}
              </div>

              {/* Published toggle */}
              <div className="flex-shrink-0 pt-6">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <span
                    onClick={() => patchDraft({ published: !draft.published })}
                    className={`relative w-10 h-5.5 rounded-full transition-colors ${
                      draft.published ? "bg-green-500" : "bg-gray-300"
                    }`}
                    style={{ width: 40, height: 22 }}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${
                        draft.published ? "translate-x-[18px]" : ""
                      }`}
                      style={{ width: 18, height: 18 }}
                    />
                  </span>
                  <span className="text-sm font-medium text-gray-700">
                    {draft.published ? "Published" : "Draft"}
                  </span>
                </label>
              </div>

              {/* Preview link */}
              {draft.slug && !currentSlugError && pages.some((p) => p.id === draft.id) && (
                <div className="flex-shrink-0 pt-6">
                  <a
                    href={`/${draft.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-orange-500 transition py-1"
                  >
                    <ExternalLink size={12} /> Preview
                  </a>
                </div>
              )}
            </div>

            {/* Content */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
                Page content
              </label>
              <RichEditor
                editorKey={draft.id}
                initialValue={draft.content}
                onChange={(html) => patchDraft({ content: html })}
                minHeight={320}
              />
            </div>

            {/* SEO section */}
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-5 space-y-4">
              <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Globe size={14} className="text-gray-400" />
                SEO settings
              </h4>

              {/* Meta title */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Meta title
                  </label>
                  <CharCount value={draft.seoTitle} max={60} />
                </div>
                <input
                  type="text"
                  value={draft.seoTitle}
                  onChange={(e) => patchDraft({ seoTitle: e.target.value })}
                  placeholder={draft.title || "Page title shown in search results"}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Recommended: 50–60 characters. Leave blank to use the page title.
                </p>
              </div>

              {/* Meta description */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Meta description
                  </label>
                  <CharCount value={draft.seoDescription} max={160} />
                </div>
                <textarea
                  value={draft.seoDescription}
                  onChange={(e) => patchDraft({ seoDescription: e.target.value })}
                  placeholder="Brief description shown in search results…"
                  rows={3}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white resize-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Recommended: 120–160 characters.
                </p>
              </div>

              {/* SERP preview */}
              {(draft.title || draft.seoTitle || draft.seoDescription) && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Search preview</p>
                  <p className="text-[15px] font-medium text-blue-700 truncate leading-snug">
                    {draft.seoTitle || draft.title || "Page title"}
                  </p>
                  <p className="text-xs text-green-700 mt-0.5 mb-1">
                    yourdomain.com/{draft.slug || "slug"}
                  </p>
                  <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                    {draft.seoDescription || "No description set. Add a meta description to improve click-through rates from search engines."}
                  </p>
                </div>
              )}
            </div>

            {/* Timestamps */}
            {pages.some((p) => p.id === draft.id) && (
              <p className="text-xs text-gray-400">
                Created {new Date(draft.createdAt).toLocaleDateString()} ·{" "}
                Last updated {new Date(draft.updatedAt).toLocaleString()}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              {/* Delete */}
              {pages.some((p) => p.id === draft.id) ? (
                deleteConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-600 font-medium">Delete this page?</span>
                    <button
                      onClick={deletePage}
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition"
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold rounded-lg transition"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-600 transition"
                  >
                    <Trash2 size={14} /> Delete page
                  </button>
                )
              ) : (
                <span />
              )}

              {/* Save */}
              <button
                onClick={savePage}
                disabled={!isValid}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
                  saved
                    ? "bg-green-100 text-green-700"
                    : isValid
                    ? "bg-orange-500 hover:bg-orange-600 text-white"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
              >
                {saved ? <><Check size={14} /> Saved</> : "Save page"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            Select a page or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}
