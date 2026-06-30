"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePOS } from "@/context/POSContext";
import { POSStaff } from "@/types/pos";
import { Delete, Lock, ChefHat, AlertCircle, Eye, EyeOff } from "lucide-react";
import CollectionFooter from "@/components/collection/CollectionFooter";

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function POSLoginPage() {
  const router = useRouter();
  const { staff, login, loginWithPin, isPinEnrolled, currentStaff, settings } = usePOS();
  const [selectedStaff, setSelectedStaff] = useState<POSStaff | null>(null);
  // "pin" only when this tablet has the staff member enrolled; otherwise password.
  const [mode, setMode] = useState<"password" | "pin">("password");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Mount guard prevents SSR/client hydration mismatch from localStorage reads
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && currentStaff) router.replace("/pos");
  }, [mounted, currentStaff, router]);

  const activeStaff = staff.filter((s) => s.active);

  async function selectStaff(member: POSStaff) {
    setSelectedStaff(member);
    setPin("");
    setPassword("");
    setError("");
    setMode("password");
    // Tablet + enrolled (cached PIN hash + device token) → offer the PIN pad.
    if (await isPinEnrolled(member.id)) setMode("pin");
  }

  function backToPicker() {
    setSelectedStaff(null);
    setPin("");
    setPassword("");
    setError("");
  }

  // ── PIN path (enrolled tablet) ──────────────────────────────────────────────
  async function submitPin(p: string) {
    if (!selectedStaff || submitting) return;
    setSubmitting(true);
    try {
      const res = await loginWithPin(selectedStaff.id, p);
      if (res.ok) {
        router.push("/pos");
        return;
      }
      if (res.reason === "locked") {
        setMode("password");
        setError("Too many PIN attempts. Please sign in with your password.");
        setPin("");
      } else if (res.reason === "needs_password") {
        setMode("password");
        setError("Session expired. Please sign in with your password.");
        setPin("");
      } else {
        setShaking(true);
        setError("Incorrect PIN. Please try again.");
        setPin("");
        setTimeout(() => setShaking(false), 600);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function pressDigit(d: string) {
    if (pin.length >= 6 || submitting) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 6) setTimeout(() => submitPin(next), 100);
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
    setError("");
  }

  const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  // ── Password path (website, or tablet first login / re-auth) ──────────────────
  async function attemptPasswordLogin(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (!selectedStaff || submitting) return;
    if (password.trim().length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const ok = await login(selectedStaff.id, password);
      if (ok) {
        router.push("/pos");
      } else {
        setShaking(true);
        setError("Incorrect password. Please try again.");
        setPassword("");
        setTimeout(() => setShaking(false), 600);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Render a dark placeholder during SSR / before hydration to avoid mismatch
  if (!mounted) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen h-full bg-slate-950 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6 select-none ">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/30">
            <ChefHat size={24} className="text-white" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">POS Terminal</p>
            <h1 className="text-xl font-bold text-white">{settings.businessName}</h1>
          </div>
        </div>

        {!selectedStaff ? (
          // ── Staff selector ────────────────────────────────────────────────
          <div className="w-full max-w-lg">
            {activeStaff.length === 0 ? (
              <div className="text-center bg-slate-900/60 border border-slate-800 rounded-2xl p-8 space-y-3">
                <Lock size={28} className="text-slate-500 mx-auto" />
                <h2 className="text-white font-semibold">POS not configured</h2>
                <p className="text-slate-400 text-sm leading-relaxed">
                  No active staff accounts are set up yet.
                  Ask your admin to add POS staff under <span className="text-slate-200">Admin → POS Staff</span>.
                </p>
              </div>
            ) : (
              <>
                <p className="text-center text-slate-400 text-sm mb-6">Select your profile to continue</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {activeStaff.map((member) => (
                    <button
                      key={member.id}
                      onClick={() => selectStaff(member)}
                      className="flex flex-col items-center gap-3 p-3 md:p-6 rounded-2xl bg-slate-800/60 border border-slate-700/50 hover:border-orange-500/60 hover:bg-slate-800 active:scale-95 transition-all duration-150 group"
                    >
                      <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg group-hover:scale-105 transition-transform"
                        style={{ backgroundColor: member.avatarColor }}
                      >
                        {getInitials(member.name)}
                      </div>
                      <div className="text-center">
                        <p className="text-white font-semibold text-sm">{member.name}</p>
                        <p className="text-slate-400 text-xs capitalize mt-0.5">{member.role}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="text-center text-slate-600 text-xs mt-8">
              {settings.location} · POS v1.0
            </p>
          </div>
        ) : mode === "pin" ? (
          // ── PIN entry (enrolled tablet) ───────────────────────────────────
          <div className="w-full max-w-xs">
            <button
              onClick={backToPicker}
              className="flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-8 transition-colors"
            >
              ← Back
            </button>

            <div className="flex flex-row items-center justify-center gap-4 mb-8">
              <div
                className="w-15 h-15 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-xl"
                style={{ backgroundColor: selectedStaff.avatarColor }}
              >
                {getInitials(selectedStaff.name)}
              </div>
              <div>
                <p className="text-white font-bold text-lg">{selectedStaff.name}</p>
                <p className="text-slate-400 text-sm capitalize">{selectedStaff.role}</p>
              </div>
            </div>

            {/* PIN dots */}
            <div className={`flex justify-center gap-3 mb-6 ${shaking ? "animate-[shake_0.5s_ease-in-out]" : ""}`}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${pin.length > i
                    ? "bg-orange-500 border-orange-500 scale-110"
                    : "bg-transparent border-slate-600"
                    }`}
                />
              ))}
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-5">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            {/* PIN pad */}
            <div className="grid grid-cols-3 gap-3">
              {PAD.map((d, i) => {
                if (d === "") return <div key={i} />;
                if (d === "⌫") {
                  return (
                    <button
                      key={i}
                      onClick={backspace}
                      className="h-16 rounded-2xl bg-slate-700/60 hover:bg-slate-700 active:scale-95 text-slate-300 flex items-center justify-center transition-all"
                    >
                      <Delete size={20} />
                    </button>
                  );
                }
                return (
                  <button
                    key={i}
                    onClick={() => pressDigit(d)}
                    className="h-16 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-orange-500 active:scale-95 text-white font-bold text-xl transition-all border border-slate-700/50 hover:border-slate-600 shadow-sm"
                  >
                    {d}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => { setMode("password"); setError(""); setPin(""); }}
              className="w-full text-center text-slate-500 hover:text-slate-300 text-xs mt-6 transition-colors"
            >
              Use password instead
            </button>
          </div>
        ) : (
          // ── Password entry (website, first tablet login, or re-auth) ──────
          <form onSubmit={attemptPasswordLogin} className="w-full max-w-xs">
            <button
              type="button"
              onClick={backToPicker}
              className="flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-8 transition-colors"
            >
              ← Back
            </button>

            <div className="flex flex-row items-center justify-center gap-4 mb-8">
              <div
                className="w-15 h-15 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-xl"
                style={{ backgroundColor: selectedStaff.avatarColor }}
              >
                {getInitials(selectedStaff.name)}
              </div>
              <div>
                <p className="text-white font-bold text-lg">{selectedStaff.name}</p>
                <p className="text-slate-400 text-sm capitalize">{selectedStaff.role}</p>
              </div>
            </div>

            <div className={`mb-5 ${shaking ? "animate-[shake_0.5s_ease-in-out]" : ""}`}>
              <label className="block text-xs text-slate-400 mb-2 text-center">Enter your password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  autoFocus
                  autoComplete="current-password"
                  placeholder="Password"
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
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-5">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || password.trim().length < 6}
              className="w-full h-14 rounded-2xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base transition-all active:scale-95"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>

            <div className="flex items-center justify-center gap-2 mt-6 text-slate-600 text-xs">
              <Lock size={11} />
              <span>Password protected terminal</span>
            </div>
          </form>
        )}

        <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 50%, 90% { transform: translateX(-8px); }
          30%, 70% { transform: translateX(8px); }
        }
      `}</style>
      </div>
      <CollectionFooter />
    </div>
  );
}
