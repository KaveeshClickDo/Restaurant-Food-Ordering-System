"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, ArrowLeft, ChevronRight, Loader2, Eye, EyeOff } from "lucide-react";
import type { KitchenStaff } from "@/types";
import CollectionFooter from "@/components/collection/CollectionFooter";

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

type LoginStep = "staff" | "password";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KitchenLoginPage() {
  const router = useRouter();

  const [allStaff, setAllStaff] = useState<Omit<KitchenStaff, "password">[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<LoginStep>("staff");
  const [target, setTarget] = useState<Omit<KitchenStaff, "password"> | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // If already signed in, skip the login flow and go straight to /kitchen.
  // The GET does a DB-backed session check, so a stale/expired cookie simply
  // leaves the form in place instead of redirecting.
  useEffect(() => {
    fetch("/api/kitchen/auth")
      .then((r) => { if (r.ok) router.replace("/kitchen"); })
      .catch(() => { });
  }, [router]);

  // Load staff list on mount
  useEffect(() => {
    fetch("/api/kitchen/config")
      .then((r) => r.json())
      .then((d: { ok: boolean; staff?: Omit<KitchenStaff, "password">[] }) => {
        if (d.ok && d.staff) setAllStaff(d.staff);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  async function submit(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (!target || submitting) return;
    if (password.trim().length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/kitchen/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: target.id, password }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) {
        router.replace("/kitchen");
      } else {
        setError(data.error || "Incorrect password — try again");
        setPassword("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function selectStaff(s: Omit<KitchenStaff, "password">) {
    setTarget(s);
    setPassword("");
    setError("");
    setStep("password");
  }

  function roleLabel(role: KitchenStaff["role"]) {
    const map: Record<KitchenStaff["role"], string> = {
      chef: "Chef",
      head_chef: "Head Chef",
      kitchen_manager: "Kitchen Manager",
    };
    return map[role] ?? role;
  }

  return (
    <div className="min-h-screen h-full bg-slate-950 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-8">
        {/* Branding */}
        <div className="text-center">
          <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ChefHat size={28} className="text-white" />
          </div>
          <h1 className="text-white text-2xl font-black">Kitchen Login</h1>
          <p className="text-slate-400 text-sm mt-1">Select your name then enter your password</p>
        </div>

        {step === "staff" ? (
          /* Staff grid */
          <div className="w-full max-w-sm space-y-3">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="text-orange-500 animate-spin" />
              </div>
            ) : allStaff.length === 0 ? (
              <p className="text-slate-500 text-center text-sm">No kitchen staff configured.</p>
            ) : (
              allStaff.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectStaff(s)}
                  className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-2xl px-5 py-4 transition-all"
                >
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
                    style={{ backgroundColor: s.avatarColor }}
                  >
                    {initials(s.name)}
                  </div>
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-white font-bold truncate">{s.name}</p>
                    <p className="text-slate-400 text-xs truncate">{roleLabel(s.role)}</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-500 ml-auto flex-shrink-0" />
                </button>
              ))
            )}
          </div>
        ) : (
          /* Password entry */
          <form onSubmit={submit} className="w-full max-w-sm space-y-6">
            <button
              type="button"
              onClick={() => { setStep("staff"); setPassword(""); setError(""); }}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition text-sm"
            >
              <ArrowLeft size={14} /> Back
            </button>

            {/* Who */}
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ backgroundColor: target?.avatarColor }}
              >
                {initials(target?.name ?? "")}
              </div>
              <div className="text-left flex-1 min-w-0">
                <p className="text-white font-semibold truncate">{target?.name}</p>
                <p className="text-slate-400 text-xs truncate">{target ? roleLabel(target.role) : ""}</p>
              </div>
            </div>

            {/* Password field */}
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                autoFocus
                autoComplete="current-password"
                placeholder="Enter your password"
                className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 pr-11 text-white text-center text-lg tracking-wide outline-none focus:border-orange-500 placeholder-slate-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || password.trim().length < 6}
              className="w-full h-14 rounded-2xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base transition-all active:scale-95 flex items-center justify-center"
            >
              {submitting ? <Loader2 size={20} className="animate-spin" /> : "Sign in"}
            </button>
          </form>
        )}
      </div>
      <CollectionFooter />
    </div>
  );
}
