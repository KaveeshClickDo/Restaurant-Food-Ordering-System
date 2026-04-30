"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/context/AppContext";
import {
  User, Mail, Phone, Lock, Eye, EyeOff, ChevronLeft,
  AlertCircle, CheckCircle, Loader2, KeyRound,
} from "lucide-react";

type Tab = "login" | "register" | "forgot" | "reset";

function LoginContent() {
  const { currentUser, login, register, logout } = useApp();
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<Tab>(() => {
    const action = searchParams.get("action");
    if (action === "reset")    return "reset";
    if (action === "register") return "register";
    if (action === "forgot")   return "forgot";
    return "login";
  });

  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [isAuthError, setIsAuthError] = useState(false);

  const [loginForm,    setLoginForm]    = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [forgotEmail,  setForgotEmail]  = useState(() => searchParams.get("email") ?? "");
  const [resetForm,    setResetForm]    = useState({
    email:    searchParams.get("email") ?? "",
    token:    searchParams.get("token") ?? "",
    password: "", confirm: "",
  });

  useEffect(() => {
    if (currentUser) router.replace("/account");
  }, [currentUser, router]);

  function switchTab(t: Tab) {
    setTab(t); setError(""); setSuccess(""); setShowPwd(false); setIsAuthError(false);
  }

  function goToForgot() {
    setForgotEmail(loginForm.email);
    switchTab("forgot");
  }

  async function handleLogin(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(""); setIsAuthError(false); setLoading(true);
    try {
      const ok = await login(loginForm.email, loginForm.password);
      if (!ok) { setError("Incorrect email or password."); setIsAuthError(true); }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: { preventDefault(): void }) {
    e.preventDefault();
    setError("");
    if (registerForm.password !== registerForm.confirm) { setError("Passwords do not match."); return; }
    if (registerForm.password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    try {
      const result = await register(
        registerForm.name, registerForm.email, registerForm.phone, registerForm.password,
      );
      if (!result.success) setError(result.error ?? "Registration failed.");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await fetch("/api/auth/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      setSuccess("sent");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: { preventDefault(): void }) {
    e.preventDefault();
    setError("");
    if (resetForm.password !== resetForm.confirm) { setError("Passwords do not match."); return; }
    if (resetForm.password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    try {
      const res  = await fetch("/api/auth/reset-password/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetForm.email, token: resetForm.token, password: resetForm.password }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) { setSuccess("done"); } else { setError(json.error ?? "Invalid or expired reset link."); }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls    = "w-full pl-9 pr-4 py-2.5 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 transition bg-white";
  const pwdInputCls = "w-full pl-9 pr-10 py-2.5 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 transition bg-white";
  const btnCls      = "w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition text-sm flex items-center justify-center gap-2";

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md mb-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 transition">
          <ChevronLeft size={16} /> Back to menu
        </Link>
      </div>

      <div className="bg-white rounded-2xl w-full max-w-md shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] border border-zinc-200/70 overflow-hidden">

        {/* Tab bar */}
        {(tab === "login" || tab === "register") && (
          <div className="flex border-b border-zinc-100">
            {(["login", "register"] as const).map((t) => (
              <button key={t} onClick={() => switchTab(t)}
                className={`flex-1 py-4 text-sm font-semibold transition-colors ${
                  tab === t ? "text-zinc-900 border-b-2 border-zinc-900" : "text-zinc-400 hover:text-zinc-600"
                }`}>
                {t === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
        )}

        {/* Back header (forgot / reset) */}
        {(tab === "forgot" || tab === "reset") && (
          <div className="flex items-center gap-3 px-6 pt-5 pb-1">
            <button onClick={() => switchTab("login")}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition">
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-2">
              <KeyRound size={16} className="text-zinc-700" />
              <h2 className="text-base font-semibold text-zinc-800 tracking-tight">
                {tab === "forgot" ? "Reset your password" : "Set new password"}
              </h2>
            </div>
          </div>
        )}

        <div className="p-6">

          {/* Login form */}
          {tab === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <Field label="Email address" icon={<Mail size={15} />}>
                <input type="email" required value={loginForm.email}
                  onChange={(e) => { setLoginForm((f) => ({ ...f, email: e.target.value })); setError(""); setIsAuthError(false); }}
                  placeholder="jane@example.com" autoComplete="username" className={inputCls} />
              </Field>

              <Field label="Password" icon={<Lock size={15} />}>
                <input type={showPwd ? "text" : "password"} required value={loginForm.password}
                  onChange={(e) => { setLoginForm((f) => ({ ...f, password: e.target.value })); setError(""); setIsAuthError(false); }}
                  placeholder="••••••••" autoComplete="current-password" className={pwdInputCls} />
                <EyeToggle show={showPwd} onToggle={() => setShowPwd((v) => !v)} />
              </Field>

              {error && (
                isAuthError ? (
                  <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-red-700">{error}</p>
                      <p className="text-xs text-red-500 mt-0.5">
                        Can&apos;t remember it?{" "}
                        <button type="button" onClick={goToForgot}
                          className="font-bold underline underline-offset-2 hover:text-red-700 transition">
                          Reset your password
                        </button>
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-600">{error}</p>
                  </div>
                )
              )}

              <button type="submit" disabled={loading} className={btnCls}>
                {loading ? <><Loader2 size={15} className="animate-spin" /> Signing in…</> : "Sign in"}
              </button>

              <div className="flex items-center justify-between text-xs">
                <button type="button" onClick={() => switchTab("register")} className="text-zinc-700 font-semibold hover:underline">
                  Create account
                </button>
                <button type="button" onClick={goToForgot} className="text-zinc-400 hover:text-zinc-700 transition hover:underline">
                  Forgot password?
                </button>
              </div>
            </form>
          )}

          {/* Register form */}
          {tab === "register" && (
            <form onSubmit={handleRegister} className="space-y-4">
              <Field label="Full name" icon={<User size={15} />}>
                <input type="text" required value={registerForm.name}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Smith" className={inputCls} />
              </Field>
              <Field label="Email address" icon={<Mail size={15} />}>
                <input type="email" required value={registerForm.email}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="jane@example.com" className={inputCls} />
              </Field>
              <Field label="Phone (optional)" icon={<Phone size={15} />}>
                <input type="tel" value={registerForm.phone}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+44 7700 900000" className={inputCls} />
              </Field>
              <Field label="Password" icon={<Lock size={15} />}>
                <input type={showPwd ? "text" : "password"} required value={registerForm.password}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Min. 6 characters" className={pwdInputCls} />
                <EyeToggle show={showPwd} onToggle={() => setShowPwd((v) => !v)} />
              </Field>
              <Field label="Confirm password" icon={<Lock size={15} />}>
                <input type={showPwd ? "text" : "password"} required value={registerForm.confirm}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, confirm: e.target.value }))}
                  placeholder="••••••••" className={inputCls} />
              </Field>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading} className={btnCls}>
                {loading ? <><Loader2 size={15} className="animate-spin" /> Creating account…</> : "Create account"}
              </button>
              <p className="text-center text-xs text-zinc-400">
                Already have an account?{" "}
                <button type="button" onClick={() => switchTab("login")} className="text-zinc-700 font-semibold hover:underline">
                  Sign in
                </button>
              </p>
            </form>
          )}

          {/* Forgot password */}
          {tab === "forgot" && (
            success === "sent" ? (
              <div className="space-y-5 mt-2">
                <div className="flex flex-col items-center text-center gap-3 py-4">
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle size={28} className="text-green-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-900 text-base">Check your inbox</p>
                    <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
                      If <span className="font-semibold text-zinc-700">{forgotEmail}</span> is registered,
                      a reset link has been sent. It expires in 1 hour.
                    </p>
                  </div>
                </div>
                <p className="text-center text-xs text-zinc-400">
                  Didn&apos;t receive it?{" "}
                  <button type="button" onClick={() => setSuccess("")} className="text-zinc-700 font-semibold hover:underline">
                    Send again
                  </button>
                </p>
                <button type="button" onClick={() => switchTab("login")} className={btnCls}>Back to sign in</button>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="space-y-4 mt-2">
                <p className="text-sm text-zinc-500 leading-relaxed">
                  Enter your email and we&apos;ll send a reset link valid for{" "}
                  <span className="font-semibold text-zinc-700">1 hour</span>.
                </p>
                <Field label="Email address" icon={<Mail size={15} />}>
                  <input type="email" required value={forgotEmail}
                    onChange={(e) => { setForgotEmail(e.target.value); setError(""); }}
                    placeholder="jane@example.com" autoFocus autoComplete="username" className={inputCls} />
                </Field>
                {error && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-600">{error}</p>
                  </div>
                )}
                <button type="submit" disabled={loading || !forgotEmail} className={btnCls}>
                  {loading ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : "Send reset link"}
                </button>
              </form>
            )
          )}

          {/* Reset password */}
          {tab === "reset" && (
            success === "done" ? (
              <div className="space-y-5 mt-2">
                <div className="flex flex-col items-center text-center gap-3 py-4">
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle size={28} className="text-green-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-900 text-base">Password updated!</p>
                    <p className="text-sm text-zinc-500 mt-1">You can now sign in with your new password.</p>
                  </div>
                </div>
                <button type="button" onClick={() => switchTab("login")} className={btnCls}>Sign in</button>
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-4 mt-2">
                <p className="text-sm text-zinc-500 leading-relaxed">Choose a new password for your account.</p>
                <Field label="New password" icon={<Lock size={15} />}>
                  <input type={showPwd ? "text" : "password"} required value={resetForm.password}
                    onChange={(e) => { setResetForm((f) => ({ ...f, password: e.target.value })); setError(""); }}
                    placeholder="Min. 6 characters" autoFocus autoComplete="new-password" className={pwdInputCls} />
                  <EyeToggle show={showPwd} onToggle={() => setShowPwd((v) => !v)} />
                </Field>
                <Field label="Confirm new password" icon={<Lock size={15} />}>
                  <input type={showPwd ? "text" : "password"} required value={resetForm.confirm}
                    onChange={(e) => { setResetForm((f) => ({ ...f, confirm: e.target.value })); setError(""); }}
                    placeholder="••••••••" autoComplete="new-password" className={inputCls} />
                </Field>
                {error && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-600">{error}</p>
                  </div>
                )}
                <button type="submit" disabled={loading || !resetForm.password || !resetForm.confirm} className={btnCls}>
                  {loading ? <><Loader2 size={15} className="animate-spin" /> Updating…</> : "Set new password"}
                </button>
              </form>
            )
          )}
        </div>
      </div>

      {currentUser && (
        <div className="mt-6 text-center text-sm text-zinc-500">
          Signed in as <strong>{currentUser.email}</strong>.{" "}
          <button onClick={() => logout()} className="text-zinc-700 font-semibold hover:underline">Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-500 mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">{icon}</span>
        {children}
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
