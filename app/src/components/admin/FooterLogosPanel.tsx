"use client";

import { useRef, useState } from "react";
import { useApp } from "@/context/AppContext";
import type { FooterLogo } from "@/types";
import {
  ImageIcon, Link2, Plus, Trash2, ChevronUp, ChevronDown,
  Eye, EyeOff, Check, AlertCircle, Upload, X,
} from "lucide-react";

// ─── Add-logo form ────────────────────────────────────────────────────────────

type AddMode = "url" | "upload";

interface AddFormProps {
  onAdd: (logo: Omit<FooterLogo, "id" | "order">) => void;
}

function AddLogoForm({ onAdd }: AddFormProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode]         = useState<AddMode>("url");
  const [label, setLabel]       = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [href, setHref]         = useState("");
  const [preview, setPreview]   = useState("");
  const [imgError, setImgError] = useState(false);
  const [sizeWarn, setSizeWarn] = useState(false);
  const [error, setError]       = useState("");

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSizeWarn(file.size > 80_000); // warn if raw file > 80 KB
    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = ev.target?.result as string;
      setImageUrl(b64);
      setPreview(b64);
      setImgError(false);
    };
    reader.readAsDataURL(file);
  }

  function handleUrlChange(v: string) {
    setImageUrl(v);
    setPreview(v);
    setImgError(false);
  }

  function reset() {
    setLabel(""); setImageUrl(""); setHref("");
    setPreview(""); setImgError(false);
    setSizeWarn(false); setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function submit() {
    if (!imageUrl.trim()) { setError("Please provide an image URL or upload a file."); return; }
    if (!label.trim())    { setError("Please enter a label (used as alt text)."); return; }
    onAdd({ label: label.trim(), imageUrl, href: href.trim() || undefined, enabled: true });
    reset();
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <Plus size={18} className="text-orange-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Add logo</h3>
          <p className="text-xs text-gray-400 mt-0.5">Partner logos, payment badges, certifications, awards</p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(["url", "upload"] as AddMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setImageUrl(""); setPreview(""); setImgError(false); setSizeWarn(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {m === "url" ? <Link2 size={12} /> : <Upload size={12} />}
            {m === "url" ? "Image URL" : "Upload file"}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Left — image input */}
        <div className="space-y-3">
          {mode === "url" ? (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Image URL</label>
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Upload image</label>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed
                                border-gray-200 hover:border-orange-300 rounded-xl p-4 cursor-pointer
                                transition group">
                <Upload size={18} className="text-gray-300 group-hover:text-orange-400 transition" />
                <span className="text-xs text-gray-400 group-hover:text-orange-500 transition">
                  {imageUrl ? "Change file" : "Click to choose an image"}
                </span>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
              </label>
              {sizeWarn && (
                <p className="text-[11px] text-amber-600 mt-1.5 flex items-start gap-1">
                  <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
                  Large file — consider using a URL instead to save storage space.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Label <span className="text-gray-400">(alt text)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Visa, Halal Certified, TripAdvisor"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Link <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="url"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder="https://example.com"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>
        </div>

        {/* Right — preview */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-600">Preview</p>
          <div className="border border-gray-100 rounded-xl bg-gray-900 flex items-center
                          justify-center min-h-[140px] relative overflow-hidden">
            {preview && !imgError ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={preview}
                alt={label || "preview"}
                className="max-h-16 max-w-[80%] object-contain"
                onError={() => setImgError(true)}
              />
            ) : imgError ? (
              <div className="flex flex-col items-center gap-1.5 text-gray-500">
                <X size={20} />
                <p className="text-xs">Could not load image</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-gray-600">
                <ImageIcon size={20} />
                <p className="text-xs">Image preview</p>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400">
            Logos are displayed at up to 40 px tall on a dark footer background.
          </p>
        </div>
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          onClick={submit}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white
                     text-sm font-semibold px-5 py-2.5 rounded-xl transition"
        >
          <Plus size={15} /> Add logo
        </button>
      </div>
    </div>
  );
}

// ─── Logo row ─────────────────────────────────────────────────────────────────

interface LogoRowProps {
  logo: FooterLogo;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Partial<FooterLogo>) => void;
  onMove: (dir: "up" | "down") => void;
  onDelete: () => void;
}

function LogoRow({ logo, isFirst, isLast, onUpdate, onMove, onDelete }: LogoRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imgError, setImgError] = useState(false);

  return (
    <div className={`flex items-start gap-3 p-4 transition-colors rounded-xl ${
      logo.enabled ? "bg-white" : "bg-gray-50 opacity-60"
    }`}>
      {/* Thumbnail */}
      <div className="w-16 h-12 rounded-lg bg-gray-900 flex items-center justify-center
                      flex-shrink-0 overflow-hidden border border-gray-100">
        {!imgError && logo.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logo.imageUrl}
            alt={logo.label}
            className="max-h-8 max-w-full object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <ImageIcon size={14} className="text-gray-600" />
        )}
      </div>

      {/* Fields */}
      <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium text-gray-400 mb-1 uppercase tracking-wide">Label / alt text</label>
          <input
            type="text"
            value={logo.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-gray-400 mb-1 uppercase tracking-wide">Link (optional)</label>
          <input
            type="url"
            value={logo.href ?? ""}
            onChange={(e) => onUpdate({ href: e.target.value || undefined })}
            placeholder="https://…"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Reorder */}
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => onMove("up")}
            disabled={isFirst}
            className="w-6 h-6 flex items-center justify-center rounded text-gray-400
                       hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 transition"
          >
            <ChevronUp size={13} />
          </button>
          <button
            onClick={() => onMove("down")}
            disabled={isLast}
            className="w-6 h-6 flex items-center justify-center rounded text-gray-400
                       hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 transition"
          >
            <ChevronDown size={13} />
          </button>
        </div>

        {/* Visible toggle */}
        <button
          onClick={() => onUpdate({ enabled: !logo.enabled })}
          title={logo.enabled ? "Hide in footer" : "Show in footer"}
          className={`w-8 h-8 flex items-center justify-center rounded-lg transition ${
            logo.enabled
              ? "text-green-600 hover:bg-green-50"
              : "text-gray-400 hover:bg-gray-100"
          }`}
        >
          {logo.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onDelete}
              className="w-8 h-8 flex items-center justify-center rounded-lg
                         bg-red-50 text-red-500 hover:bg-red-100 transition"
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="w-8 h-8 flex items-center justify-center rounded-lg
                         text-gray-400 hover:bg-gray-100 transition"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg
                       text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function FooterLogosPanel() {
  const { settings, updateSettings } = useApp();
  const logos: FooterLogo[] = (settings.footerLogos ?? []).slice().sort((a, b) => a.order - b.order);
  const [saved, setSaved] = useState(false);

  function commit(next: FooterLogo[]) {
    const reordered = next.map((l, i) => ({ ...l, order: i }));
    updateSettings({ footerLogos: reordered });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function addLogo(data: Omit<FooterLogo, "id" | "order">) {
    const next = [...logos, { ...data, id: crypto.randomUUID(), order: logos.length }];
    commit(next);
  }

  function updateLogo(id: string, patch: Partial<FooterLogo>) {
    commit(logos.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function moveLogo(id: string, dir: "up" | "down") {
    const idx = logos.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const next = [...logos];
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    commit(next);
  }

  function deleteLogo(id: string) {
    commit(logos.filter((l) => l.id !== id));
  }

  const activeCount = logos.filter((l) => l.enabled).length;

  return (
    <div className="space-y-6">
      {/* Add form */}
      <AddLogoForm onAdd={addLogo} />

      {/* Logo list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Your logos</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {logos.length === 0
                ? "No logos added yet"
                : `${logos.length} logo${logos.length !== 1 ? "s" : ""} · ${activeCount} visible in footer`}
            </p>
          </div>
          {saved && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
              <Check size={13} /> Saved
            </span>
          )}
        </div>

        {logos.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <ImageIcon size={32} className="mx-auto mb-3 text-gray-200" />
            <p className="font-medium text-sm">No logos yet</p>
            <p className="text-xs mt-1">Add your first logo above to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 p-2">
            {logos.map((logo, i) => (
              <LogoRow
                key={logo.id}
                logo={logo}
                isFirst={i === 0}
                isLast={i === logos.length - 1}
                onUpdate={(patch) => updateLogo(logo.id, patch)}
                onMove={(dir) => moveLogo(logo.id, dir)}
                onDelete={() => deleteLogo(logo.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer preview */}
      {logos.filter((l) => l.enabled).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
          <h3 className="font-semibold text-gray-900 text-sm">Footer preview</h3>
          <div className="bg-gray-900 rounded-xl px-6 py-5 flex flex-wrap items-center justify-center gap-6">
            {logos
              .filter((l) => l.enabled)
              .map((logo) => (
                <div key={logo.id} className="flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logo.imageUrl}
                    alt={logo.label}
                    title={logo.label}
                    className="max-h-8 max-w-[120px] object-contain opacity-70"
                  />
                </div>
              ))}
          </div>
          <p className="text-xs text-gray-400">
            Logos appear in the footer between navigation links and the copyright line.
          </p>
        </div>
      )}
    </div>
  );
}
