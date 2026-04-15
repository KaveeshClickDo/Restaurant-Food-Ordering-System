"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import type { MenuLink } from "@/types";
import {
  Plus, Trash2, ChevronUp, ChevronDown,
  Eye, EyeOff, Link2, GripVertical, Monitor, AlignJustify,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Location = "header" | "footer";

interface PageOption {
  label: string;
  href: string;
  group: "Custom Pages" | "Footer Pages";
}

// ── Add-link form ─────────────────────────────────────────────────────────────

function AddLinkForm({
  options,
  usedHrefs,
  onAdd,
  onCancel,
}: {
  options: PageOption[];
  usedHrefs: Set<string>;
  onAdd: (label: string, href: string) => void;
  onCancel: () => void;
}) {
  const available = options.filter((o) => !usedHrefs.has(o.href));
  const [selected, setSelected] = useState(available[0]?.href ?? "");
  const [label, setLabel] = useState(available[0]?.label ?? "");

  function handleSelectChange(href: string) {
    setSelected(href);
    const opt = options.find((o) => o.href === href);
    if (opt) setLabel(opt.label);
  }

  if (available.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400 text-center">
        All available pages are already in this menu.
      </div>
    );
  }

  return (
    <div className="mt-3 bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Add page to menu</p>

      {/* Page picker */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Page</label>
        <select
          value={selected}
          onChange={(e) => handleSelectChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
        >
          {/* Group by type */}
          {(["Custom Pages", "Footer Pages"] as const).map((group) => {
            const grouped = available.filter((o) => o.group === group);
            if (!grouped.length) return null;
            return (
              <optgroup key={group} label={group}>
                {grouped.map((o) => (
                  <option key={o.href} value={o.href}>
                    {o.label} ({o.href})
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </div>

      {/* Label override */}
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Display label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nav label"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300"
        />
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition"
        >
          Cancel
        </button>
        <button
          disabled={!selected || !label.trim()}
          onClick={() => onAdd(label.trim(), selected)}
          className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-100 disabled:text-gray-400 text-white text-sm font-semibold rounded-xl transition"
        >
          Add to menu
        </button>
      </div>
    </div>
  );
}

// ── Single menu link row ──────────────────────────────────────────────────────

function LinkRow({
  link,
  isFirst,
  isLast,
  onMove,
  onToggle,
  onLabelChange,
  onRemove,
}: {
  link: MenuLink;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: "up" | "down") => void;
  onToggle: () => void;
  onLabelChange: (v: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(link.label);

  function commitLabel() {
    if (labelDraft.trim()) onLabelChange(labelDraft.trim());
    else setLabelDraft(link.label);
    setEditing(false);
  }

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition ${
        link.active
          ? "bg-white border-gray-200"
          : "bg-gray-50 border-gray-100 opacity-60"
      }`}
    >
      {/* Grip visual */}
      <GripVertical size={14} className="text-gray-300 flex-shrink-0 cursor-grab" />

      {/* Up/Down */}
      <div className="flex flex-col gap-0.5">
        <button
          onClick={() => onMove("up")}
          disabled={isFirst}
          className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30 transition"
        >
          <ChevronUp size={12} className="text-gray-500" />
        </button>
        <button
          onClick={() => onMove("down")}
          disabled={isLast}
          className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30 transition"
        >
          <ChevronDown size={12} className="text-gray-500" />
        </button>
      </div>

      {/* Label — click to edit */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => { if (e.key === "Enter") commitLabel(); if (e.key === "Escape") { setLabelDraft(link.label); setEditing(false); } }}
            className="w-full px-2 py-1 text-sm border border-orange-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        ) : (
          <button
            onClick={() => { setLabelDraft(link.label); setEditing(true); }}
            className="text-sm font-medium text-gray-800 hover:text-orange-600 transition text-left truncate w-full"
            title="Click to rename"
          >
            {link.label}
          </button>
        )}
        <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1 truncate">
          <Link2 size={10} />
          {link.href}
        </p>
      </div>

      {/* Active toggle */}
      <button
        onClick={onToggle}
        title={link.active ? "Hide from menu" : "Show in menu"}
        className={`p-1.5 rounded-lg transition ${
          link.active ? "text-green-600 hover:bg-green-50" : "text-gray-400 hover:bg-gray-100"
        }`}
      >
        {link.active ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>

      {/* Remove */}
      <button
        onClick={onRemove}
        title="Remove from menu"
        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ── Section (one per location) ────────────────────────────────────────────────

function MenuSection({
  location,
  icon: Icon,
  title,
  description,
  links,
  pageOptions,
  onChange,
}: {
  location: Location;
  icon: React.ElementType;
  title: string;
  description: string;
  links: MenuLink[];
  pageOptions: PageOption[];
  onChange: (updated: MenuLink[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  const sorted = [...links].sort((a, b) => a.order - b.order);
  const usedHrefs = new Set(links.map((l) => l.href));

  function rebuildOrders(items: MenuLink[]): MenuLink[] {
    return items.map((l, i) => ({ ...l, order: i }));
  }

  function handleMove(id: string, dir: "up" | "down") {
    const idx = sorted.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const next = [...sorted];
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(rebuildOrders(next));
  }

  function handleToggle(id: string) {
    onChange(links.map((l) => (l.id === id ? { ...l, active: !l.active } : l)));
  }

  function handleLabelChange(id: string, label: string) {
    onChange(links.map((l) => (l.id === id ? { ...l, label } : l)));
  }

  function handleRemove(id: string) {
    onChange(links.filter((l) => l.id !== id));
  }

  function handleAdd(label: string, href: string) {
    const newLink: MenuLink = {
      id: crypto.randomUUID(),
      label,
      href,
      location,
      order: sorted.length,
      active: true,
    };
    onChange([...links, newLink]);
    setAdding(false);
  }

  const activeCount = links.filter((l) => l.active).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      {/* Section header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Icon size={17} className="text-orange-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{description}</p>
          </div>
        </div>
        <span className="flex-shrink-0 text-xs font-semibold text-gray-400 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">
          {activeCount} visible · {links.length} total
        </span>
      </div>

      {/* Empty state */}
      {sorted.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center">
          <p className="text-sm text-gray-400">No links yet.</p>
          <button
            onClick={() => setAdding(true)}
            className="mt-2 text-xs text-orange-500 hover:underline font-medium"
          >
            Add your first link
          </button>
        </div>
      )}

      {/* Link list */}
      {sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((link, idx) => (
            <LinkRow
              key={link.id}
              link={link}
              isFirst={idx === 0}
              isLast={idx === sorted.length - 1}
              onMove={(dir) => handleMove(link.id, dir)}
              onToggle={() => handleToggle(link.id)}
              onLabelChange={(v) => handleLabelChange(link.id, v)}
              onRemove={() => handleRemove(link.id)}
            />
          ))}
        </div>
      )}

      {/* Add form */}
      {adding ? (
        <AddLinkForm
          options={pageOptions}
          usedHrefs={usedHrefs}
          onAdd={handleAdd}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 text-sm text-orange-500 hover:text-orange-700 font-semibold transition"
        >
          <Plus size={14} /> Add page to {location} menu
        </button>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function MenuLinksPanel() {
  const { settings, updateSettings } = useApp();
  const links: MenuLink[] = settings.menuLinks ?? [];

  // Build the page pool from published custom pages + footer pages
  const pageOptions: PageOption[] = [
    ...(settings.customPages ?? [])
      .filter((p) => p.published)
      .map((p) => ({ label: p.title, href: `/${p.slug}`, group: "Custom Pages" as const })),
    ...(settings.footerPages ?? [])
      .filter((p) => p.enabled)
      .map((p) => ({ label: p.title, href: `/${p.slug}`, group: "Footer Pages" as const })),
  ];

  function handleSectionChange(location: Location, updated: MenuLink[]) {
    // Merge this location's updated links with the other location's links unchanged
    const other = links.filter((l) => l.location !== location);
    updateSettings({ menuLinks: [...other, ...updated] });
  }

  const headerLinks = links.filter((l) => l.location === "header");
  const footerLinks = links.filter((l) => l.location === "footer");

  return (
    <div className="space-y-6">
      {/* Info callout */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 text-sm text-blue-700">
        <strong>How it works:</strong> Add published custom pages or enabled footer pages to either menu. Drag the up/down arrows to reorder, click the eye icon to show/hide a link, and click a label to rename it. Changes apply instantly on the frontend.
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MenuSection
          location="header"
          icon={Monitor}
          title="Header Navigation"
          description="Links shown in the top navigation bar"
          links={headerLinks}
          pageOptions={pageOptions}
          onChange={(updated) => handleSectionChange("header", updated)}
        />

        <MenuSection
          location="footer"
          icon={AlignJustify}
          title="Footer Navigation"
          description="Links shown in the site footer"
          links={footerLinks}
          pageOptions={pageOptions}
          onChange={(updated) => handleSectionChange("footer", updated)}
        />
      </div>

      {/* Preview tip */}
      {links.length > 0 && (
        <p className="text-xs text-gray-400 text-center">
          View the live site to see your menu changes — they apply without saving.
        </p>
      )}
    </div>
  );
}
