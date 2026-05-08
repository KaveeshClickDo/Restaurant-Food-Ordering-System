"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams }    from "next/navigation";
import Link                              from "next/link";
import { useApp }                        from "@/context/AppContext";
import { Truck, Eye, EyeOff, AlertCircle, CheckCircle, Loader2 } from "lucide-react";

// ── Inner component (uses useSearchParams — must be inside Suspense) ──────────

function DriverLoginInner() {
  const { driverLogin, settings } = useApp();
  const router       = useRouter();
  const searchParams = useSearchParams();

  // Determine initial mode from URL params
  const urlAction = searchParams.get("action");
  const urlToken  = searchParams.get("token");
  const urlEmail  = searchParams.get("email");

  type Mode = "login" | "forgot" | "reset";
  const initialMode: Mode = urlAction === "reset" && urlToken ? "reset" : "login";

  const [mode, setMode] = useState<Mode>(initialMode);

  // ── Login state ─────────────────────────────────────────────────────────
  const [loginEmail,    setLoginEmail]    = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPwd,       setShowPwd]       = useState(false);
  const [loginError,    setLoginError]    = useState("");
  const [loginLoading,  setLoginLoading]  = useState(false);

  // ── Forgot password state ────────────────────────────────────────────────
  const [forgotEmail,   setForgotEmail]   = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent,    setForgotSent]    = useState(false);
  const [forgotError,   setForgotError]   = useState("");

  // ── Reset password state ─────────────────────────────────────────────────
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm,  setResetConfirm]  = useState("");
  const [showReset,     setShowReset]     = useState(false);
  const [resetLoading,  setResetLoading]  = useState(false);
  const [resetDone,     setResetDone]     = useState(false);
  const [resetError,    setResetError]    = useState("");

  // Redirect handled by middleware (valid driver_session cookie → /driver).
  // No client-side redirect here to avoid a stale-localStorage redirect loop.

  // ── Login submit ─────────────────────────────────────────────────────────
  async function handleLogin(e: { preventDefault(): void }) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const ok = await driverLogin(loginEmail.trim(), loginPassword);
      if (ok) {
        router.replace("/driver");
      } else {
        setLoginError("Invalid email or password, or your account is inactive.");
      }
    } catch {
      setLoginError("Connection error. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  }

  // ── Forgot password submit ───────────────────────────────────────────────
  async function handleForgot(e: { preventDefault(): void }) {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    try {
      await fetch("/api/auth/driver/reset-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: forgotEmail.trim() }),
      });
      // Always show success — endpoint never reveals whether email exists
      setForgotSent(true);
    } catch {
      setForgotError("Connection error. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  }

  // ── Reset password submit ────────────────────────────────────────────────
  async function handleReset(e: { preventDefault(): void }) {
    e.preventDefault();
    setResetError("");

    if (resetPassword.length < 6) {
      setResetError("Password must be at least 6 characters.");
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError("Passwords do not match.");
      return;
    }

    setResetLoading(true);
    try {
      const res  = await fetch("/api/auth/driver/reset-password/confirm", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          email:    urlEmail ?? "",
          token:    urlToken ?? "",
          password: resetPassword,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setResetDone(true);
      } else {
        setResetError(json.error ?? "Invalid or expired reset link.");
      }
    } catch {
      setResetError("Connection error. Please try again.");
    } finally {
      setResetLoading(false);
    }
  }

  const restaurantName = settings.restaurant.name;

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-500/30">
            <Truck size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-white">Driver Portal</h1>
          <p className="text-gray-400 text-sm mt-1">{restaurantName}</p>
        </div>

        {/* ── Login form ────────────────────────────────────────────────── */}
        {mode === "login" && (
          <div className="bg-gray-800 rounded-2xl p-6 shadow-2xl border border-gray-700">
            <h2 className="text-white font-bold text-lg mb-5">Sign in to your account</h2>

            <form onSubmit={(e) => void handleLogin(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">
                  Email address
                </label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => { setLoginEmail(e.target.value); setLoginError(""); }}
                  placeholder="jane@example.com"
                  required
                  autoComplete="username"
                  className="w-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? "text" : "password"}
                    value={loginPassword}
                    onChange={(e) => { setLoginPassword(e.target.value); setLoginError(""); }}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="w-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                    tabIndex={-1}
                  >
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {loginError && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2.5">
                  <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-300 text-xs leading-snug">{loginError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loginLoading || !loginEmail || !loginPassword}
                className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-orange-500/20 mt-1"
              >
                {loginLoading ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <button
              onClick={() => setMode("forgot")}
              className="mt-4 w-full text-center text-xs text-gray-500 hover:text-orange-400 transition"
            >
              Forgot password?
            </button>
          </div>
        )}

        {/* ── Forgot password form ──────────────────────────────────────── */}
        {mode === "forgot" && (
          <div className="bg-gray-800 rounded-2xl p-6 shadow-2xl border border-gray-700">
            <h2 className="text-white font-bold text-lg mb-1">Reset your password</h2>
            <p className="text-gray-400 text-sm mb-5">
              Enter your email and we will send you a reset link.
            </p>

            {forgotSent ? (
              <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3.5">
                <CheckCircle size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-green-300 text-sm font-semibold">Check your email</p>
                  <p className="text-green-400/80 text-xs mt-0.5 leading-snug">
                    If an account exists for that email, a reset link has been sent.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={(e) => void handleForgot(e)} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => { setForgotEmail(e.target.value); setForgotError(""); }}
                    placeholder="jane@example.com"
                    required
                    autoFocus
                    className="w-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                  />
                </div>

                {forgotError && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2.5">
                    <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-300 text-xs leading-snug">{forgotError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={forgotLoading || !forgotEmail}
                  className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-orange-500/20"
                >
                  {forgotLoading
                    ? <Loader2 size={16} className="animate-spin mx-auto" />
                    : "Send reset link"}
                </button>
              </form>
            )}

            <button
              onClick={() => { setMode("login"); setForgotSent(false); setForgotError(""); }}
              className="mt-4 w-full text-center text-xs text-gray-500 hover:text-orange-400 transition"
            >
              Back to sign in
            </button>
          </div>
        )}

        {/* ── Set new password form ─────────────────────────────────────── */}
        {mode === "reset" && (
          <div className="bg-gray-800 rounded-2xl p-6 shadow-2xl border border-gray-700">
            <h2 className="text-white font-bold text-lg mb-1">Set new password</h2>
            <p className="text-gray-400 text-sm mb-5">
              Choose a new password for your driver account.
            </p>

            {resetDone ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3.5">
                  <CheckCircle size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-green-300 text-sm font-semibold">Password updated!</p>
                    <p className="text-green-400/80 text-xs mt-0.5 leading-snug">
                      You can now sign in with your new password.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setMode("login")}
                  className="w-full bg-orange-500 hover:bg-orange-400 text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-orange-500/20"
                >
                  Sign in
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleReset(e)} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">
                    New password
                  </label>
                  <div className="relative">
                    <input
                      type={showReset ? "text" : "password"}
                      value={resetPassword}
                      onChange={(e) => { setResetPassword(e.target.value); setResetError(""); }}
                      placeholder="Min 6 characters"
                      required
                      autoFocus
                      autoComplete="new-password"
                      className="w-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowReset((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                      tabIndex={-1}
                    >
                      {showReset ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wide">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    value={resetConfirm}
                    onChange={(e) => { setResetConfirm(e.target.value); setResetError(""); }}
                    placeholder="Repeat new password"
                    required
                    autoComplete="new-password"
                    className="w-full bg-gray-700 border border-gray-600 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
                  />
                </div>

                {resetError && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2.5">
                    <AlertCircle size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-300 text-xs leading-snug">{resetError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={resetLoading || !resetPassword || !resetConfirm}
                  className="w-full bg-orange-500 hover:bg-orange-400 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-orange-500/20"
                >
                  {resetLoading
                    ? <Loader2 size={16} className="animate-spin mx-auto" />
                    : "Set new password"}
                </button>
              </form>
            )}
          </div>
        )}

        <p className="text-center text-gray-600 text-xs mt-6">
          Not a driver?{" "}
          <Link href="/" className="text-orange-500 hover:text-orange-400 font-semibold transition">
            Back to menu
          </Link>
        </p>
      </div>
    </div>
  );
}

// ── Page export (wraps inner in Suspense for useSearchParams) ─────────────────

export default function DriverLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <DriverLoginInner />
    </Suspense>
  );
}
