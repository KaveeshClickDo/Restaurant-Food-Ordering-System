"use client";

/**
 * /unsubscribe?token=<contact token> — public marketing opt-out page.
 *
 * The human-facing half of the unsubscribe pair: the footer link in every
 * campaign email lands here, and a button click POSTs to /api/unsubscribe.
 * The extra click is deliberate — mail scanners prefetch GET links, and a
 * prefetch must never opt someone out. (Mail clients' native one-click
 * unsubscribe POSTs to the API directly per RFC 8058 and skips this page.)
 */

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, XCircle, Loader2, MailX } from "lucide-react";

type State = "confirm" | "working" | "done" | "error";

function UnsubscribeContent() {
  const params = useSearchParams();
  const token  = params.get("token")?.trim() ?? "";
  const [state, setState] = useState<State>(token ? "confirm" : "error");
  const inFlight = useRef(false);

  async function handleUnsubscribe() {
    if (inFlight.current) return;
    inFlight.current = true;
    setState("working");
    try {
      const res  = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" });
      const json = await res.json() as { ok: boolean };
      setState(json.ok ? "done" : "error");
    } catch {
      setState("error");
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] p-8 w-full max-w-sm text-center space-y-4">
      {state === "confirm" && (
        <>
          <MailX size={48} className="text-zinc-400 mx-auto" />
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">Unsubscribe from offers?</h1>
          <p className="text-zinc-500 text-sm">
            You&apos;ll stop receiving promotional emails from us. Booking confirmations
            and order receipts are not affected.
          </p>
          <button
            onClick={handleUnsubscribe}
            className="inline-block mt-2 bg-zinc-900 hover:bg-zinc-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition"
          >
            Yes, unsubscribe me
          </button>
          <Link href="/" className="block text-sm text-zinc-400 hover:text-zinc-600 transition">
            Keep receiving offers
          </Link>
        </>
      )}

      {state === "working" && (
        <>
          <Loader2 size={40} className="animate-spin text-zinc-400 mx-auto" />
          <p className="text-zinc-600 font-medium">Updating your preferences…</p>
        </>
      )}

      {state === "done" && (
        <>
          <CheckCircle2 size={48} className="text-green-500 mx-auto" />
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">You&apos;re unsubscribed</h1>
          <p className="text-zinc-500 text-sm">
            We won&apos;t send you any more promotional emails. Changed your mind?
            Just ask us next time you visit.
          </p>
          <Link href="/"
            className="inline-block mt-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition">
            Back to menu
          </Link>
        </>
      )}

      {state === "error" && (
        <>
          <XCircle size={48} className="text-red-400 mx-auto" />
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">Something went wrong</h1>
          <p className="text-zinc-500 text-sm">
            This unsubscribe link looks incomplete. Please use the link from the
            bottom of one of our emails, or contact us and we&apos;ll take care of it.
          </p>
          <Link href="/" className="block text-sm text-zinc-400 hover:text-zinc-600 transition mt-1">
            Back to menu
          </Link>
        </>
      )}
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="bg-white rounded-2xl border border-zinc-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)] p-8 w-full max-w-sm text-center">
            <Loader2 size={40} className="animate-spin text-zinc-400 mx-auto" />
            <p className="text-zinc-600 font-medium mt-4">Loading…</p>
          </div>
        }
      >
        <UnsubscribeContent />
      </Suspense>
    </div>
  );
}
