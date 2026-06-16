"use client";

/**
 * Admin → Displays → Digital Signage.
 *
 * Manages the digital menu boards: create displays, each with its own public
 * URL (/display/<slug>), and attach poster images. One image → a static
 * fullscreen poster; several → an auto-looping slideshow. Self-contained — talks
 * straight to /api/admin/signage (not AppContext), mirroring DriversPanel.
 *
 * The poster manager (upload / reorder / enable / delete) mirrors
 * FooterLogosPanel; uploads go through uploadSignageImage().
 */

import { useEffect, useRef, useState } from "react";
import { uploadSignageImage, signageSizeError } from "@/lib/uploadImage";
import {
  Monitor, Plus, Trash2, Copy, ExternalLink, QrCode, Check, X, Upload,
  Eye, EyeOff, ChevronUp, ChevronDown, ChevronRight, AlertCircle, Power,
  Loader2, Image as ImageIcon, Clock,
} from "lucide-react";

// ─── Types (client-safe mirror of the API response) ──────────────────────────

interface Slide {
  id: string;
  imageUrl: string;
  order: number;
  enabled: boolean;
}

interface Display {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  slides: Slide[];
  intervalMs: number;
  transition: "fade" | "none";
  fit: "contain" | "cover";
  background: string;
  createdAt: string;
  updatedAt: string;
}

type Patch = Partial<{
  name: string;
  slug: string;
  active: boolean;
  slides: { id: string; imageUrl: string; order: number; enabled: boolean }[];
  intervalMs: number;
  transition: "fade" | "none";
  fit: "contain" | "cover";
  background: string;
}>;

// ─── Public URL helper ────────────────────────────────────────────────────────

function publicUrl(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/display/${slug}`;
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function SignagePanel() {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [newName, setNewName]   = useState("");
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId]     = useState<string | null>(null);
  const [qrFor, setQrFor]       = useState<Display | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/signage", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || !json.ok) { setError(json.error || "Failed to load displays."); return; }
        setDisplays(json.displays as Display[]);
      } catch {
        if (alive) setError("Failed to load displays.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // ── Mutations ───────────────────────────────────────────────────────────────
  async function createDisplay() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/signage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error || "Could not create display."); return; }
      setDisplays((prev) => [...prev, json.display as Display]);
      setNewName("");
      setExpandedId((json.display as Display).id);
    } catch {
      setError("Could not create display.");
    } finally {
      setCreating(false);
    }
  }

  // PATCH a display and merge the canonical row from the response into state.
  async function patchDisplay(id: string, patch: Patch): Promise<boolean> {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/signage/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error || "Could not save changes."); return false; }
      setDisplays((prev) => prev.map((d) => (d.id === id ? (json.display as Display) : d)));
      return true;
    } catch {
      setError("Could not save changes.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function deleteDisplay(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/signage/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json.error || "Could not delete display."); return; }
      setDisplays((prev) => prev.filter((d) => d.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch {
      setError("Could not delete display.");
    } finally {
      setBusyId(null);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Monitor size={18} className="text-orange-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">New display</h3>
            <p className="text-xs text-gray-400 mt-0.5">Each display gets its own public URL to open fullscreen on a TV.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createDisplay(); }}
            placeholder="e.g. Lunch Offers, Main Menu Board"
            maxLength={80}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
          <button
            onClick={createDisplay}
            disabled={!newName.trim() || creating}
            className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition"
          >
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Create
          </button>
        </div>
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
          <AlertCircle size={14} className="flex-shrink-0" /> {error}
        </p>
      )}

      {/* Display list */}
      {displays.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center text-gray-400">
          <Monitor size={32} className="mx-auto mb-3 text-gray-200" />
          <p className="font-medium text-sm">No displays yet</p>
          <p className="text-xs mt-1">Create your first display above to get a public TV URL.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {displays.map((d) => (
            <DisplayCard
              key={d.id}
              display={d}
              expanded={expandedId === d.id}
              busy={busyId === d.id}
              onToggleExpand={() => setExpandedId((cur) => (cur === d.id ? null : d.id))}
              onPatch={(patch) => patchDisplay(d.id, patch)}
              onDelete={() => deleteDisplay(d.id)}
              onShowQr={() => setQrFor(d)}
            />
          ))}
        </div>
      )}

      {qrFor && <QrModal display={qrFor} onClose={() => setQrFor(null)} />}
    </div>
  );
}

// ─── Display card ─────────────────────────────────────────────────────────────

interface DisplayCardProps {
  display: Display;
  expanded: boolean;
  busy: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Patch) => Promise<boolean>;
  onDelete: () => void;
  onShowQr: () => void;
}

function DisplayCard({ display, expanded, busy, onToggleExpand, onPatch, onDelete, onShowQr }: DisplayCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = publicUrl(display.slug);
  const enabledCount = display.slides.filter((s) => s.enabled).length;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — the field is still selectable */ }
  }

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${display.active ? "border-gray-100" : "border-gray-200"}`}>
      {/* Header */}
      <div className="flex items-center gap-3 p-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${display.active ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-400"}`}>
          <Monitor size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{display.name}</h3>
            {display.active
              ? <span className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">LIVE</span>
              : <span className="text-[10px] font-bold text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">OFF</span>}
            {busy && <Loader2 size={12} className="animate-spin text-gray-400" />}
          </div>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {display.slides.length} image{display.slides.length !== 1 ? "s" : ""}
            {display.slides.length > 0 && ` · ${enabledCount} shown`}
            {display.slides.length > 1 ? " · slideshow" : display.slides.length === 1 ? " · single poster" : ""}
          </p>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={copyLink} title="Copy link" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
            {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
          </button>
          <button onClick={onShowQr} title="Show QR code" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
            <QrCode size={15} />
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" title="Open display" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-orange-600 hover:bg-orange-50 transition">
            <ExternalLink size={15} />
          </a>
          <button
            onClick={onToggleExpand}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition"
            title={expanded ? "Collapse" : "Manage"}
          >
            {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          </button>
        </div>
      </div>

      {/* Public URL strip */}
      <button
        onClick={copyLink}
        className="w-full text-left px-4 pb-3 -mt-1 flex items-center gap-2 group"
        title="Click to copy"
      >
        <span className="text-[11px] font-mono text-gray-500 truncate bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 group-hover:border-orange-200 transition flex-1">
          {url}
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 sm:p-6 space-y-6 bg-gray-50/40">
          <PosterManager display={display} onPatch={onPatch} />
          <SettingsSection display={display} onPatch={onPatch} />

          {/* Delete */}
          <div className="flex justify-end pt-2 border-t border-gray-100">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Delete this display and its URL?</span>
                <button onClick={onDelete} className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
                  <Check size={13} /> Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-red-500 hover:text-red-600 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-red-50 transition">
                <Trash2 size={14} /> Delete display
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Poster manager (upload + grid) ──────────────────────────────────────────

function PosterManager({ display, onPatch }: { display: Display; onPatch: (p: Patch) => Promise<boolean> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  const slides = display.slides.slice().sort((a, b) => a.order - b.order);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (fileRef.current) fileRef.current.value = "";
    if (files.length === 0) return;

    // Validate all first so one bad file doesn't leave a half-applied batch.
    for (const f of files) {
      const err = signageSizeError(f);
      if (err) { setUploadErr(err); return; }
    }

    setUploading(true);
    setUploadErr("");
    try {
      const urls: string[] = [];
      for (const f of files) urls.push(await uploadSignageImage(f));
      const base = slides.length;
      const added = urls.map((u, i) => ({ id: crypto.randomUUID(), imageUrl: u, order: base + i, enabled: true }));
      await onPatch({ slides: [...slides, ...added] });
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function move(id: string, dir: "up" | "down") {
    const idx = slides.findIndex((s) => s.id === id);
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= slides.length) return;
    const next = slides.slice();
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onPatch({ slides: next.map((s, i) => ({ ...s, order: i })) });
  }

  function toggle(id: string) {
    onPatch({ slides: slides.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)) });
  }

  function remove(id: string) {
    onPatch({ slides: slides.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })) });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800">Posters</h4>
        <label className="flex items-center gap-1.5 bg-white border border-gray-200 hover:border-orange-300 text-gray-700 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition">
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? "Uploading…" : "Add images"}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} disabled={uploading} />
        </label>
      </div>

      {uploadErr && (
        <p className="flex items-center gap-1.5 text-xs text-red-600"><AlertCircle size={12} /> {uploadErr}</p>
      )}

      {slides.length === 0 ? (
        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 hover:border-orange-300 rounded-xl py-10 cursor-pointer transition group bg-white">
          <ImageIcon size={22} className="text-gray-300 group-hover:text-orange-400 transition" />
          <span className="text-xs text-gray-400 group-hover:text-orange-500 transition">Click to add poster images (up to 5 MB each)</span>
          <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} disabled={uploading} />
        </label>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {slides.map((s, i) => (
            <div key={s.id} className={`relative rounded-xl overflow-hidden border bg-gray-900 group ${s.enabled ? "border-gray-200" : "border-gray-200 opacity-50"}`}>
              <div className="aspect-video flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.imageUrl} alt="" className="max-h-full max-w-full object-contain" />
              </div>
              {/* Order badge */}
              <span className="absolute top-1.5 left-1.5 text-[10px] font-bold text-white bg-black/60 rounded px-1.5 py-0.5">#{i + 1}</span>
              {/* Controls */}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 p-1.5 bg-gradient-to-t from-black/70 to-transparent">
                <div className="flex gap-0.5">
                  <button onClick={() => move(s.id, "up")} disabled={i === 0} className="w-6 h-6 flex items-center justify-center rounded bg-white/15 text-white hover:bg-white/30 disabled:opacity-30 transition"><ChevronUp size={13} /></button>
                  <button onClick={() => move(s.id, "down")} disabled={i === slides.length - 1} className="w-6 h-6 flex items-center justify-center rounded bg-white/15 text-white hover:bg-white/30 disabled:opacity-30 transition"><ChevronDown size={13} /></button>
                </div>
                <div className="flex gap-0.5">
                  <button onClick={() => toggle(s.id)} title={s.enabled ? "Hide" : "Show"} className="w-6 h-6 flex items-center justify-center rounded bg-white/15 text-white hover:bg-white/30 transition">
                    {s.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button onClick={() => remove(s.id)} title="Delete" className="w-6 h-6 flex items-center justify-center rounded bg-white/15 text-white hover:bg-red-500 transition"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-400">
        {slides.length > 1
          ? "Multiple images play as a looping slideshow."
          : slides.length === 1
            ? "A single image shows as a static fullscreen poster."
            : "Add one image for a static poster, or several for a slideshow."}
      </p>
    </div>
  );
}

// ─── Settings section ─────────────────────────────────────────────────────────

function SettingsSection({ display, onPatch }: { display: Display; onPatch: (p: Patch) => Promise<boolean> }) {
  const [name, setName] = useState(display.name);
  const [slug, setSlug] = useState(display.slug);
  const [seconds, setSeconds] = useState(Math.round(display.intervalMs / 1000));

  // Keep local fields in sync when the server returns a canonical value
  // (e.g. slug normalized / de-duplicated).
  useEffect(() => { setName(display.name); }, [display.name]);
  useEffect(() => { setSlug(display.slug); }, [display.slug]);
  useEffect(() => { setSeconds(Math.round(display.intervalMs / 1000)); }, [display.intervalMs]);

  function commitName() {
    const v = name.trim();
    if (v && v !== display.name) onPatch({ name: v }); else setName(display.name);
  }
  function commitSlug() {
    const v = slug.trim();
    if (v && v !== display.slug) onPatch({ slug: v }); else setSlug(display.slug);
  }
  function commitSeconds() {
    const clamped = Math.min(60, Math.max(3, seconds || 8));
    setSeconds(clamped);
    if (clamped * 1000 !== display.intervalMs) onPatch({ intervalMs: clamped * 1000 });
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-gray-800">Settings</h4>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            maxLength={80}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>

        {/* Slug */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Public URL</label>
          <div className="flex items-stretch rounded-xl border border-gray-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-orange-300">
            <span className="text-[11px] text-gray-400 px-2.5 flex items-center bg-gray-50 border-r border-gray-200 whitespace-nowrap">/display/</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              onBlur={commitSlug}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="flex-1 px-2.5 py-2.5 text-sm focus:outline-none min-w-0"
            />
          </div>
        </div>

        {/* Active */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Status</label>
          <button
            onClick={() => onPatch({ active: !display.active })}
            className={`flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border text-sm font-semibold transition ${
              display.active
                ? "bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
            }`}
          >
            <Power size={15} /> {display.active ? "Live - visible on TVs" : "Off - screen blanked"}
          </button>
        </div>

        {/* Seconds per slide */}
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Clock size={12} /> Seconds per image</label>
          <input
            type="number"
            min={3}
            max={60}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
            onBlur={commitSeconds}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            disabled={display.slides.filter((s) => s.enabled).length < 2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 disabled:bg-gray-100 disabled:text-gray-400"
          />
          <p className="text-[10px] text-gray-400 mt-1">Only applies to slideshows (2+ images).</p>
        </div>

        {/* Transition */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Transition</label>
          <select
            value={display.transition}
            onChange={(e) => onPatch({ transition: e.target.value as "fade" | "none" })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            <option value="fade">Cross-fade</option>
            <option value="none">Instant cut</option>
          </select>
        </div>

        {/* Fit */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Image fit</label>
          <select
            value={display.fit}
            onChange={(e) => onPatch({ fit: e.target.value as "contain" | "cover" })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            <option value="contain">Contain - show whole poster (letterbox)</option>
            <option value="cover">Cover - fill screen (may crop)</option>
          </select>
        </div>

        {/* Background */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Background</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={display.background}
              onChange={(e) => onPatch({ background: e.target.value })}
              className="w-12 h-10 rounded-lg border border-gray-200 bg-white cursor-pointer"
            />
            <span className="text-xs text-gray-500 font-mono">{display.background}</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Shows behind letterboxed posters.</p>
        </div>
      </div>
    </div>
  );
}

// ─── QR modal ─────────────────────────────────────────────────────────────────

function QrModal({ display, onClose }: { display: Display; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const url = publicUrl(display.slug);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mod = await import("qrcode");
        const toDataURL = mod.toDataURL ?? mod.default?.toDataURL;
        const png = await toDataURL(url, { width: 320, margin: 2 });
        if (alive) setDataUrl(png);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [url]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-xs w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 text-sm truncate">{display.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
        </div>
        <div className="flex items-center justify-center min-h-[240px]">
          {failed ? (
            <p className="text-xs text-red-500">Could not generate QR code.</p>
          ) : dataUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={dataUrl} alt={`QR code for ${display.name}`} className="w-60 h-60" />
          ) : (
            <Loader2 size={22} className="animate-spin text-gray-300" />
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-4 break-all font-mono">{url}</p>
        <p className="text-xs text-gray-500 mt-2">Scan with the TV browser or a phone to open the display.</p>
      </div>
    </div>
  );
}
