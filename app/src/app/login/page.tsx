"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/context/AppContext";
import { User, Mail, Phone, Lock, Eye, EyeOff, ChevronLeft } from "lucide-react";

type Tab = "login" | "register" | "forgot" | "reset";

export default function LoginPage() {
  const { currentUser, login, register, logout } = useApp();
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab]  = useState<Tab>(() => {
    const action = searchParams.get("action");
    if (action === "reset") return "reset";
    if (action === "register") return "register";
    return "login";
  });
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error,   setError]     = useState("");
  const [success, setSuccess]   = useState("");

  const [loginForm,    setLoginForm]    = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [forgotEmail,  setForgotEmail]  = useState("");
  const [resetForm,    setResetForm]    = useState({
    email:    searchParams.get("email") ?? "",
    token:    searchParams.get("token") ?? "",
    password: "", confirm: "",
  });

  // Redirect logged-in users to account page
  useEffect(() => {
    if (currentUser) router.replace("/account");
  }, [currentUser, router]);

  function switchTab(t: Tab) { setTab(t); setError(""); setSuccess(""); setShowPwd(false); }

  // ── Login ─────────────────────────────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const ok = await login(loginForm.email, loginForm.password);
      if (!ok) setError("Incorrect email or password.");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Register ──────────────────────────────────────────────────────────────
  async function handleRegister(e: React.FormEvent) {
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

  // ── Forgot password ────────────────────────────────────────────────────────
  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      setSuccess("If that email is registered, a reset link has been sent. Check your inbox.");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Reset password ────────────────────────────────────────────────────────
  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (resetForm.password !== resetForm.confirm) { setError("Passwords do not match."); return; }
    if (resetForm.password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetForm.email, token: resetForm.token, password: resetForm.password }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setSuccess("Password updated. You can now sign in.");
        setTimeout(() => switchTab("login"), 2000);
      } else {
        setError(json.error ?? "Invalid or expired reset link.");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition";
  const btnCls   = "w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-sm";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      {/* Back to home */}
      <div className="w-full max-w-md mb-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition">
          <ChevronLeft size={16} /> Back to menu
        </Link>
      </div>

      <div className="bg-white rounded-2xl w-full max-w-md shadow-lg overflow-hidden">
        {/* Tabs */}
        {(tab === "login" || tab === "register") && (
          <div className="flex border-b border-gray-100">
            {(["login", "register"] as const).map((t) => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className={`flex-1 py-4 text-sm font-semibold transition-colors ${
                  tab === t
                    ? "text-orange-500 border-b-2 border-orange-500"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {t === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
        )}

        {(tab === "forgot" || tab === "reset") && (
          <div className="flex items-center gap-2 px-6 pt-5">
            <button onClick={() => switchTab("login")} className="text-gray-400 hover:text-gray-700 transition">
              <ChevronLeft size={20} />
            </button>
            <h2 className="text-base font-bold text-gray-800">
              {tab === "forgot" ? "Forgot password" : "Set new password"}
            </h2>
          </div>
        )}

        <div className="p-6">
          {/* ── Login ──────────────────────────────────────────────────────── */}
          {tab === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <Field label="Email address" icon={<Mail size={15} />}>
                <input type="email" required value={loginForm.email}
                  onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="jane@example.com" className={inputCls} />
              </Field>
              <Field label="Password" icon={<Lock size={15} />}>
                <input type={showPwd ? "text" : "password"} required value={loginForm.password}
                  onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••" className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition" />
                <EyeToggle show={showPwd} onToggle={() => setShowPwd((v) => !v)} />
              </Field>
              {error   && <p className="text-red-500 text-xs">{error}</p>}
              <button type="submit" disabled={loading} className={btnCls}>
                {loading ? "Signing in…" : "Sign in"}
              </button>
              <div className="flex justify-between text-xs text-gray-400">
                <button type="button" onClick={() => switchTab("register")} className="text-orange-500 font-semibold hover:underline">
                  Create account
                </button>
                <button type="button" onClick={() => switchTab("forgot")} className="hover:underline">
                  Forgot password?
                </button>
              </div>
            </form>
          )}

          {/* ── Register ───────────────────────────────────────────────────── */}
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
                  placeholder="Min. 6 characters" className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition" />
                <EyeToggle show={showPwd} onToggle={() => setShowPwd((v) => !v)} />
              </Field>
              <Field label="Confirm password" icon={<Lock size={15} />}>
                <input type={showPwd ? "text" : "password"} required value={registerForm.confirm}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, confirm: e.target.value }))}
                  placeholder="••••••••" className={inputCls} />
              </Field>
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <button type="submit" disabled={loading} className={btnCls}>
                {loading ? "Creating account…" : "Create account"}
              </button>
              <p className="text-center text-xs text-gray-400">
                Already have an account?{" "}
                <button type="button" onClick={() => switchTab("login")} className="text-orange-500 font-semibold hover:underline">
                  Sign in
                </button>
              </p>
            </form>
          )}

          {/* ── Forgot password ────────────────────────────────────────────── */}
          {tab === "forgot" && (
            <form onSubmit={handleForgot} className="space-y-4 mt-4">
              <p className="text-sm text-gray-500">Enter your email and we&apos;ll send a reset link if the account exists.</p>
              <Field label="Email address" icon={<Mail size={15} />}>
                <input type="email" required value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="jane@example.com" className={inputCls} />
              </Field>
              {error   && <p className="text-red-500 text-xs">{error}</p>}
              {success && <p className="text-green-600 text-xs">{success}</p>}
              <button type="submit" disabled={loading} className={btnCls}>
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}

          {/* ── Reset password ──────────────────────────────────────────────── */}
          {tab === "reset" && (
            <form onSubmit={handleReset} className="space-y-4 mt-4">
              <Field label="New password" icon={<Lock size={15} />}>
                <input type={showPwd ? "text" : "password"} required value={resetForm.password}
                  onChange={(e) => setResetForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Min. 6 characters" className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition" />
                <EyeToggle show={showPwd} onToggle={() => setShowPwd((v) => !v)} />
              </Field>
              <Field label="Confirm password" icon={<Lock size={15} />}>
                <input type={showPwd ? "text" : "password"} required value={resetForm.confirm}
                  onChange={(e) => setResetForm((f) => ({ ...f, confirm: e.target.value }))}
                  placeholder="••••••••" className={inputCls} />
              </Field>
              {error   && <p className="text-red-500 text-xs">{error}</p>}
              {success && <p className="text-green-600 text-xs">{success}</p>}
              <button type="submit" disabled={loading} className={btnCls}>
                {loading ? "Updating…" : "Set new password"}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Signed-in state (shouldn't normally render — redirect above handles it) */}
      {currentUser && (
        <div className="mt-6 text-center text-sm text-gray-500">
          Signed in as <strong>{currentUser.email}</strong>.{" "}
          <button onClick={() => logout()} className="text-orange-500 font-semibold hover:underline">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ── Small shared sub-components ───────────────────────────────────────────────

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>
        {children}
      </div>
    </div>
  );
}

function EyeToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
    >
      {show ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  );
}
