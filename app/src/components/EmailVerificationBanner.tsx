"use client";

import { useState } from "react";
import type { Customer } from "@/types";

/**
 * After the verification-enforcement change, login + register reject
 * unverified accounts, so this banner only ever appears for legacy
 * accounts created before the email_verified column existed. They are
 * grandfathered into login but should still verify — hence the banner.
 * No dismiss button: dismissing it would not unlock anything anyway.
 */
export default function EmailVerificationBanner({ currentUser }: { currentUser: Customer | null }) {
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);

  if (!currentUser || currentUser.emailVerified !== false) return null;

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
      <p className="text-amber-800 font-medium line-clamp-2">
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
      </div>
    </div>
  );
}
