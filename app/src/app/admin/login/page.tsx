"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

/**
 * Dedicated admin login. Middleware redirects /admin/* here whenever the
 * admin_session cookie is missing/invalid; a successful sign-in sets the cookie
 * and sends the admin to /admin.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [showPwd, setShowPwd] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  // If already signed in, skip the form.
  useEffect(() => {
    fetch("/api/admin/auth")
      .then((r) => { if (r.ok) router.replace("/admin"); })
      .catch(() => { });
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setError("");
    setLoading(true);
    try {
      const r = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        router.replace("/admin");
      } else {
        const j = await r.json().catch(() => ({})) as { error?: string };
        setError(j.error ?? "Invalid password.");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-800 p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">Admin Login</h1>
            <p className="text-gray-500 text-xs mt-0.5">Enter your admin password to continue</p>
          </div>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="••••••••"
                autoFocus
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition"
              />
              <EyeToggle show={showPwd} onToggle={() => setShowPwd((v) => !v)} />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg py-2.5 transition"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {!process.env.NEXT_PUBLIC_ADMIN_CONFIGURED && (
          <p className="mt-4 text-gray-600 text-xs text-center">
            Set <code className="text-gray-500">ADMIN_PASSWORD</code> in <code className="text-gray-500">.env.local</code>
          </p>
        )}
      </div>
    </div>
  );
}

function EyeToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} tabIndex={-1}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition">
      {show ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  );
}