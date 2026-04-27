"use client";

import { useState } from "react";
import type { Customer } from "@/types";

export default function EmailVerificationBanner({ currentUser }: { currentUser: Customer | null }) {
  const [dismissed, setDismissed] = useState(false);
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);

  if (!currentUser || currentUser.emailVerified !== false || dismissed) return null;

  async function handleResend() {
    setSending(true);
    try {
      await fetch("/api/auth/resend-verification", { method: "POST" });
      setSent(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="w-full bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-3 text-sm z-40">
      <p className="text-amber-800 font-medium">
        Please verify your email address. Check your inbox for the confirmation link.
      </p>
      <div className="flex items-center gap-3 flex-shrink-0">
        {sent ? (
          <span className="text-green-700 font-semibold text-xs">Email sent!</span>
        ) : (
          <button
            onClick={handleResend}
            disabled={sending}
            className="text-amber-700 font-semibold hover:text-amber-900 disabled:opacity-50 text-xs underline underline-offset-2 transition"
          >
            {sending ? "Sending…" : "Resend email"}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-500 hover:text-amber-700 font-bold text-base leading-none transition"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
