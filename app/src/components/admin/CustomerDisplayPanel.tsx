"use client";

/**
 * Admin → Displays → Customer Display.
 *
 * Sets / changes / removes the password that gates the public /customer-display
 * order board. The hash is stored server-side (display_auth table) via a
 * dedicated admin endpoint — NOT in the settings blob, which the anon client
 * reads. Saving or removing the password logs out every live display screen.
 *
 * Moved here from the Operations panel so all screen-facing surfaces live under
 * the Displays section; the logic is unchanged.
 */

import { useEffect, useState } from "react";
import {
  Monitor, Lock, Eye, EyeOff, Info, AlertCircle, Loader2, Trash2, CheckCircle2,
} from "lucide-react";

export default function CustomerDisplayPanel() {
  const [loading, setLoading]   = useState(true);
  const [isSet, setIsSet]       = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [show, setShow]         = useState(false);
  const [error, setError]       = useState("");
  const [saved, setSaved]       = useState("");
  const [busy, setBusy]         = useState(false);

  useEffect(() => {
    fetch("/api/admin/display-password", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok: boolean; set: boolean } | null) => { if (j?.ok) setIsSet(j.set); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setError(""); setSaved("");
    if (password.length < 4) { setError("Password must be at least 4 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/display-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) { setError(j.error ?? "Failed to save password."); return; }
      setIsSet(true);
      setPassword(""); setConfirm("");
      setSaved("Password saved — all display screens have been signed out.");
      setTimeout(() => setSaved(""), 4000);
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setError(""); setSaved("");
    setBusy(true);
    try {
      const r = await fetch("/api/admin/display-password", { method: "DELETE" });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) { setError(j.error ?? "Failed to remove password."); return; }
      setIsSet(false);
      setPassword(""); setConfirm("");
      setSaved("Password removed — the display is now open to anyone.");
      setTimeout(() => setSaved(""), 4000);
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Monitor size={18} className="text-blue-600 flex-shrink-0" />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-gray-900">Customer Display Access</h2>
          <p className="text-xs text-gray-400">Password-protect the public order board at <code className="font-mono bg-gray-100 px-1 rounded">/customer-display</code></p>
        </div>
        {!loading && (
          <span className={`ml-auto flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
            isSet ? "bg-green-50 border border-green-200 text-green-700" : "bg-amber-50 border border-amber-200 text-amber-700"
          }`}>
            {isSet ? <><Lock size={12} /> Protected</> : <><Eye size={12} /> Open</>}
          </span>
        )}
      </div>

      <div className="p-6 space-y-5">
        {/* Status note */}
        <div className={`flex items-start gap-3 rounded-xl px-4 py-3 ${isSet ? "bg-green-50 border border-green-100" : "bg-amber-50 border border-amber-100"}`}>
          <Info size={15} className={`flex-shrink-0 mt-0.5 ${isSet ? "text-green-500" : "text-amber-500"}`} />
          <p className={`text-xs leading-relaxed ${isSet ? "text-green-700" : "text-amber-700"}`}>
            {isSet
              ? "A password is set. Each display screen must enter it once; the screen then stays unlocked until you change or remove the password here."
              : "No password is set — anyone who opens the display URL can view the live order board. Set a password to lock it down."}
          </p>
        </div>

        {/* Password fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">{isSet ? "New password" : "Password"}</label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="At least 4 characters"
                className="w-full pl-3 pr-9 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
              />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Confirm password</label>
            <input
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(""); }}
              placeholder="Re-enter password"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
            />
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} /> {error}</p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={busy || !password}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition flex items-center gap-2"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            {isSet ? "Change password" : "Set password"}
          </button>
          {isSet && (
            <button
              onClick={handleRemove}
              disabled={busy}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 text-sm font-semibold rounded-xl transition"
            >
              <Trash2 size={14} /> Remove password
            </button>
          )}
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <CheckCircle2 size={16} /> {saved}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
