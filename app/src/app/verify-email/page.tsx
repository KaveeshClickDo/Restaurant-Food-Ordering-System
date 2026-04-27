"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams }               from "next/navigation";
import Link                              from "next/link";
import { CheckCircle2, XCircle, Loader2, Mail } from "lucide-react";

type State = "verifying" | "success" | "already" | "error";

function VerifyEmailContent() {
  const params = useSearchParams();
  const [state, setState] = useState<State>("verifying");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = params.get("token");
    const email = params.get("email");

    if (!token || !email) {
      setState("error");
      setError("Missing verification link parameters. Please use the link from the email.");
      return;
    }

    fetch("/api/auth/verify-email", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ token, email }),
    })
      .then((r) => r.json())
      .then((json: { ok: boolean; alreadyVerified?: boolean; error?: string }) => {
        if (json.ok) {
          setState(json.alreadyVerified ? "already" : "success");
        } else {
          setState("error");
          setError(json.error ?? "Verification failed.");
        }
      })
      .catch(() => {
        setState("error");
        setError("Connection error. Please try again.");
      });
  }, [params]);

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm text-center space-y-4">
      {state === "verifying" && (
        <>
          <Loader2 size={40} className="animate-spin text-orange-400 mx-auto" />
          <p className="text-gray-600 font-medium">Verifying your email…</p>
        </>
      )}

      {state === "success" && (
        <>
          <CheckCircle2 size={48} className="text-green-500 mx-auto" />
          <h1 className="text-xl font-bold text-gray-900">Email verified!</h1>
          <p className="text-gray-500 text-sm">Your email address has been confirmed. You&apos;re all set.</p>
          <Link
            href="/"
            className="inline-block mt-2 bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition"
          >
            Back to menu
          </Link>
        </>
      )}

      {state === "already" && (
        <>
          <CheckCircle2 size={48} className="text-blue-400 mx-auto" />
          <h1 className="text-xl font-bold text-gray-900">Already verified</h1>
          <p className="text-gray-500 text-sm">Your email address was already confirmed.</p>
          <Link
            href="/"
            className="inline-block mt-2 bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition"
          >
            Back to menu
          </Link>
        </>
      )}

      {state === "error" && (
        <>
          <XCircle size={48} className="text-red-400 mx-auto" />
          <h1 className="text-xl font-bold text-gray-900">Verification failed</h1>
          <p className="text-red-500 text-sm">{error}</p>
          <p className="text-gray-400 text-xs">Links expire after 24 hours.</p>
          <ResendButton />
          <Link href="/" className="block text-sm text-gray-400 hover:text-gray-600 transition mt-1">
            Back to menu
          </Link>
        </>
      )}
    </div>
  );
}

function ResendButton() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleResend() {
    setState("sending");
    try {
      const res  = await fetch("/api/auth/resend-verification", { method: "POST" });
      const json = await res.json() as { ok: boolean };
      setState(json.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <p className="flex items-center justify-center gap-1.5 text-green-600 text-sm font-medium">
        <Mail size={15} /> New link sent — check your inbox
      </p>
    );
  }

  return (
    <button
      onClick={handleResend}
      disabled={state === "sending"}
      className="inline-flex items-center gap-1.5 text-sm text-orange-500 hover:text-orange-700 font-semibold disabled:opacity-50 transition"
    >
      {state === "sending" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
      {state === "sending" ? "Sending…" : state === "error" ? "Failed — try again" : "Resend verification email"}
    </button>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm text-center">
            <Loader2 size={40} className="animate-spin text-orange-400 mx-auto" />
            <p className="text-gray-600 font-medium mt-4">Loading…</p>
          </div>
        }
      >
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}
