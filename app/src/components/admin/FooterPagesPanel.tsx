"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import RichEditor from "@/components/admin/RichEditor";
import type { FooterPage } from "@/types";
import { Check, ExternalLink } from "lucide-react";

export default function FooterPagesPanel() {
  const { settings, updateSettings } = useApp();

  const pages: FooterPage[] = settings.footerPages ?? [];
  const [selectedSlug, setSelectedSlug] = useState<string>(pages[0]?.slug ?? "");
  const [drafts, setDrafts] = useState<Record<string, FooterPage>>(() =>
    Object.fromEntries(pages.map((p) => [p.slug, { ...p }]))
  );
  const [copyright, setCopyright] = useState(settings.footerCopyright ?? "");
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [copyrightSaved, setCopyrightSaved] = useState(false);

  const selected = drafts[selectedSlug];

  function updateDraft(slug: string, patch: Partial<FooterPage>) {
    setDrafts((prev) => ({ ...prev, [slug]: { ...prev[slug], ...patch } }));
  }

  function savePage(slug: string) {
    const draft = drafts[slug];
    if (!draft) return;
    const updated = pages.map((p) =>
      p.slug === slug ? { ...draft, lastModified: new Date().toISOString() } : p
    );
    updateSettings({ footerPages: updated });
    setSavedSlug(slug);
    setTimeout(() => setSavedSlug(null), 2000);
  }

  function saveCopyright() {
    updateSettings({ footerCopyright: copyright });
    setCopyrightSaved(true);
    setTimeout(() => setCopyrightSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Copyright */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Footer Copyright Text</h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={copyright}
            onChange={(e) => setCopyright(e.target.value)}
            placeholder={`© ${new Date().getFullYear()} ${settings.restaurant.name}. All rights reserved.`}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <button
            onClick={saveCopyright}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
              copyrightSaved
                ? "bg-green-100 text-green-700"
                : "bg-orange-500 hover:bg-orange-600 text-white"
            }`}
          >
            {copyrightSaved ? <><Check size={14} /> Saved</> : "Save"}
          </button>
        </div>
      </div>

      {/* Pages editor */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex flex-col md:flex-row md:divide-x divide-gray-100">
          {/* Sidebar */}
          <aside className="w-full md:w-52 flex-shrink-0 flex flex-col">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 pt-3 pb-2">Pages</p>
            <nav className="max-h-40 md:max-h-none overflow-y-auto">
            {pages.map((page) => {
              const draft = drafts[page.slug];
              return (
                <button
                  key={page.slug}
                  onClick={() => setSelectedSlug(page.slug)}
                  className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 transition text-sm ${
                    selectedSlug === page.slug
                      ? "bg-orange-50 text-orange-600 font-semibold"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className="truncate">{draft?.title || page.title}</span>
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      draft?.enabled ? "bg-green-400" : "bg-gray-300"
                    }`}
                  />
                </button>
              );
            })}
            </nav>
          </aside>

          {/* Editor */}
          <div className="flex-1 min-w-0 p-4 md:p-6 space-y-4">
            {selected ? (
              <>
                {/* Title + controls row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="text"
                    value={selected.title}
                    onChange={(e) => updateDraft(selectedSlug, { title: e.target.value })}
                    className="flex-1 min-w-40 px-3 py-2 text-sm font-semibold border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />

                  {/* Enabled toggle */}
                  <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-600">
                    <span
                      onClick={() => updateDraft(selectedSlug, { enabled: !selected.enabled })}
                      className={`relative w-9 h-5 rounded-full transition-colors ${
                        selected.enabled ? "bg-green-500" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          selected.enabled ? "translate-x-4" : ""
                        }`}
                      />
                    </span>
                    {selected.enabled ? "Visible in footer" : "Hidden"}
                  </label>

                  {/* Preview link */}
                  <a
                    href={`/${selectedSlug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-orange-500 transition"
                  >
                    <ExternalLink size={12} />
                    Preview
                  </a>

                  {/* Save */}
                  <button
                    onClick={() => savePage(selectedSlug)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                      savedSlug === selectedSlug
                        ? "bg-green-100 text-green-700"
                        : "bg-orange-500 hover:bg-orange-600 text-white"
                    }`}
                  >
                    {savedSlug === selectedSlug ? <><Check size={14} /> Saved</> : "Save page"}
                  </button>
                </div>

                {/* Rich editor */}
                <RichEditor
                  editorKey={selectedSlug}
                  initialValue={selected.content}
                  onChange={(html) => updateDraft(selectedSlug, { content: html })}
                  minHeight={400}
                />

                <p className="text-xs text-gray-400">
                  Last modified:{" "}
                  {selected.lastModified && new Date(selected.lastModified).getTime() > 0
                    ? new Date(selected.lastModified).toLocaleString()
                    : "Never saved"}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-400">Select a page to edit.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
