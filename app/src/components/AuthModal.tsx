"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, User, Mail, Phone, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { useApp } from "@/context/AppContext";

interface Props {
  initialTab?: "login" | "register";
  onClose: () => void;
}

export default function AuthModal({ initialTab = "login", onClose }: Props) {
  const { login, register } = useApp();
  const router = useRouter();

  const [tab,          setTab]          = useState<"login" | "register">(initialTab);
  const [showPassword, setShowPassword] = useState(false);
  const [error,        setError]        = useState("");
  const [isAuthError,  setIsAuthError]  = useState(false);
  const [loading,      setLoading]      = useState(false);

  const [loginForm,    setLoginForm]    = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });

  async function handleLogin(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(""); setIsAuthError(false); setLoading(true);
    try {
      const ok = await login(loginForm.email, loginForm.password);
      if (ok) {
        onClose();
      } else {
        setError("Incorrect email or password.");
        setIsAuthError(true);
      }
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
      const result = await register(registerForm.name, registerForm.email, registerForm.phone, registerForm.password);
      if (result.success) { onClose(); } else { setError(result.error ?? "Registration failed."); }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function switchTab(t: "login" | "register") {
    setTab(t); setError(""); setIsAuthError(false); setShowPassword(false);
  }

  function goToForgot() {
    onClose();
    const email = loginForm.email.trim();
    const url   = email
      ? `/login?action=forgot&email=${encodeURIComponent(email)}`
      : "/login?action=forgot";
    router.push(url);
  }

  const inputCls = "w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition z-10"
        >
          <X size={16} />
        </button>

        {/* Tabs */}
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

        <div className="p-6">
          {/* ── Login form ──────────────────────────────────────────────────── */}
          {tab === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email address</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email" required value={loginForm.email}
                    onChange={(e) => { setLoginForm((f) => ({ ...f, email: e.target.value })); setError(""); setIsAuthError(false); }}
                    placeholder="jane@example.com"
                    autoComplete="username"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600">Password</label>
                  <button
                    type="button"
                    onClick={goToForgot}
                    className="text-xs text-gray-400 hover:text-orange-500 transition"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"} required value={loginForm.password}
                    onChange={(e) => { setLoginForm((f) => ({ ...f, password: e.target.value })); setError(""); setIsAuthError(false); }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Error — contextual callout with reset link on auth failure */}
              {error && (
                isAuthError ? (
                  <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-red-700">{error}</p>
                      <p className="text-xs text-red-500 mt-0.5">
                        Can&apos;t remember it?{" "}
                        <button
                          type="button"
                          onClick={goToForgot}
                          className="font-bold underline underline-offset-2 hover:text-red-700 transition"
                        >
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

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-sm"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>

              <p className="text-center text-xs text-gray-400">
                No account?{" "}
                <button type="button" onClick={() => switchTab("register")} className="text-orange-500 font-semibold hover:underline">
                  Create one
                </button>
              </p>
            </form>
          )}

          {/* ── Register form ────────────────────────────────────────────────── */}
          {tab === "register" && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Full name</label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text" required value={registerForm.name}
                    onChange={(e) => setRegisterForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Jane Smith" className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email address</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email" required value={registerForm.email}
                    onChange={(e) => setRegisterForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="jane@example.com" className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone number</label>
                <div className="relative">
                  <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="tel" value={registerForm.phone}
                    onChange={(e) => setRegisterForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+44 7700 900000" className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"} required value={registerForm.password}
                    onChange={(e) => setRegisterForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Min. 6 characters"
                    className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                  />
                  <button
                    type="button" tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Confirm password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"} required value={registerForm.confirm}
                    onChange={(e) => setRegisterForm((f) => ({ ...f, confirm: e.target.value }))}
                    placeholder="••••••••" className={inputCls}
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition text-sm"
              >
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
        </div>
      </div>
    </div>
  );
}
