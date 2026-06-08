"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Monitor, Loader2, Lock } from "lucide-react";

/**
 * Customer Display unlock screen.
 *
 * Flow on mount:
 *   • already authed            → straight to /customer-display
 *   • no password set (open)    → auto-grant a session, then to /customer-display
 *   • password set, not authed  → show the password form
 *
 * Middleware redirects /customer-display here whenever the display session
 * cookie is missing/invalid; this page is the only public entry point.
 */
export default function CustomerDisplayLoginPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "form">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const checkedRef = useRef(false);

  async function grant(pw?: string): Promise<boolean> {
    const res = await fetch("/api/customer-display/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw ?? "" }),
    });
    return res.ok;
  }

  // Decide what to show / do on mount.
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    (async () => {
      try {
        const r = await fetch("/api/customer-display/auth", { cache: "no-store" });
        const j = (await r.json()) as { ok: boolean; protected: boolean; authed: boolean };
        if (j.authed) { router.replace("/customer-display"); return; }
        if (!j.protected) {
          // Open display — grant a session transparently and go through.
          if (await grant()) { router.replace("/customer-display"); return; }
        }
        setPhase("form");
      } catch {
        setPhase("form");
      }
    })();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !password) return;
    setSubmitting(true);
    setError("");
    try {
      if (await grant(password)) {
        router.replace("/customer-display");
      } else {
        setError("Incorrect password.");
        setPassword("");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col items-center justify-center p-6 gap-8">
      {/* Branding */}
      <div className="text-center">
        <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Monitor size={28} className="text-white" />
        </div>
        <h1 className="text-white text-2xl font-black">Customer Display</h1>
        <p className="text-gray-400 text-sm mt-1">Enter the display password to continue</p>
      </div>

      {phase === "checking" ? (
        <Loader2 size={28} className="text-orange-500 animate-spin" />
      ) : (
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="Display password"
              className="w-full pl-10 pr-4 py-3 rounded-2xl bg-gray-900 border border-gray-700 text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 transition"
            />
          </div>

          {error && <p className="text-red-400 text-sm text-center font-medium">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full py-3 rounded-2xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition flex items-center justify-center gap-2"
          >
            {submitting ? <><Loader2 size={18} className="animate-spin" /> Unlocking…</> : "Unlock display"}
          </button>
        </form>
      )}

      <p className="text-gray-600 text-xs text-center max-w-xs">
        This screen stays unlocked until the admin changes the display password.
      </p>
    </div>
  );
}
