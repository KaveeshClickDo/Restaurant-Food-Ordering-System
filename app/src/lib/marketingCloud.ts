/**
 * Client for the DirectDine Marketing API — the metered broadcast service.
 *
 * Broadcasts do NOT leave this server. The campaign sender hands each batch to
 * the Marketing API, which checks the restaurant's remaining email allowance
 * and sends via Amazon SES. That's what makes the allowance enforceable: the
 * count lives with DirectDine, not in a number this box could edit.
 *
 * Transactional email (orders, bookings, receipts, password resets) is a
 * different system entirely — it keeps using this restaurant's own Resend/SMTP
 * key via lib/emailSender.ts, so an unpaid marketing invoice can never stop an
 * order confirmation going out.
 *
 * Identity is the server's own IP: these calls are made server-to-server, so
 * the Marketing API sees this VPS's address and matches it to the branch it was
 * registered against. Nothing identifying is ever sent from the browser.
 *
 * Server-only — never import from a client component.
 */

export interface MarketingPackage {
  id: string;
  name: string;
  /** Emails included per billing period. */
  emails: number;
  /** Pre-formatted for display — the Marketing API owns pricing and currency. */
  priceLabel: string;
  blurb?: string;
}

/** This install has a live package. `remaining === 0` means out of credits:
 *  the composer still works, sending is what stops. */
export interface MarketingActive {
  state: "active";
  packageName: string;
  limit: number;
  used: number;
  remaining: number;
  /** ISO — when the allowance resets. */
  periodEnd: string;
  /** True when served from cache because the Marketing API was unreachable. */
  stale?: boolean;
}

/** Known install, no package bought yet — show the tiers. */
export interface MarketingNone {
  state: "none";
  packages: MarketingPackage[];
  /** Where the "buy" button sends them. Built by DirectDine, never hardcoded. */
  buyUrl: string;
  stale?: boolean;
}

/** Marketing API unreachable, or this install isn't registered with DirectDine. */
export interface MarketingUnavailable {
  state: "unavailable";
  reason: string;
}

export type MarketingStatus = MarketingActive | MarketingNone | MarketingUnavailable;

/** Normal freshness — a status this old is re-fetched. */
const FRESH_MS = 60_000;
/** How long a cached status may be served after the API starts failing. A
 *  short blip must not flip a paying customer's tab to a locked screen. */
const STALE_OK_MS = 15 * 60_000;

let cache: { at: number; status: MarketingStatus } | null = null;

export function marketingApiConfigured(): boolean {
  return Boolean(process.env.MARKETING_API_URL?.trim());
}

/**
 * Current entitlement for this install. Cached for a minute; on failure the
 * last good answer is served for up to fifteen minutes, flagged `stale`.
 *
 * Never throws — the UI always gets a status it can render.
 */
export async function getMarketingStatus(opts?: { force?: boolean }): Promise<MarketingStatus> {
  const now = Date.now();
  if (!opts?.force && cache && now - cache.at < FRESH_MS) return cache.status;

  try {
    const status = await fetchStatus();
    cache = { at: now, status };
    return status;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Marketing service unreachable.";
    // Serve the last good answer rather than locking a paying customer out
    // over a restart. Display only — sending is authorised by the API itself,
    // on every batch, so a stale "active" here can never grant free sends.
    if (cache && now - cache.at < STALE_OK_MS && cache.status.state !== "unavailable") {
      return { ...cache.status, stale: true };
    }
    console.error("marketingCloud status:", message);
    return { state: "unavailable", reason: message };
  }
}

/** Drop the cache — call after a purchase so the tab unlocks immediately. */
export function clearMarketingStatusCache(): void {
  cache = null;
}

/**
 * Gate for EVERY path that can send a broadcast — the interactive sender, the
 * test send, and the scheduled-campaign cron. Returns null when sending is
 * allowed, otherwise the error to hand back.
 *
 * Advisory only: the Marketing API re-checks the allowance on every batch, so
 * this exists to fail early with a readable message, not to enforce anything.
 * A campaign scheduled last week is checked HERE when it actually fires, not
 * when it was scheduled.
 */
export async function marketingSendBlockedReason(): Promise<{ error: string; status: number } | null> {
  if (!marketingApiConfigured()) {
    return { error: "Broadcast sending isn't set up on this site yet.", status: 503 };
  }
  const status = await getMarketingStatus();
  switch (status.state) {
    case "active":
      return status.remaining > 0
        ? null
        : { error: "No emails left in this period's allowance.", status: 402 };
    case "none":
      return { error: "This site doesn't have an email package yet.", status: 402 };
    case "unavailable":
      return { error: status.reason, status: 503 };
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

/** One fully-rendered email. We render here rather than sending a template for
 *  the Marketing API to fill in: the unsubscribe link and tracking pixel are
 *  unique per recipient and built from this restaurant's own data, so keeping
 *  all of that in one place is worth the extra bytes on the wire. */
export interface MarketingMessage {
  /** email_campaign_recipients.id — doubles as the idempotency key, so a
   *  retried batch is recognised and never charged twice. */
  ref: string;
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

export type RejectReason =
  /** Hard-bounced or complained before — permanently undeliverable. Free. */
  | "suppressed"
  /** Malformed address. Free. */
  | "invalid"
  /** Allowance ran out part-way through the batch. NOT attempted — leave the
   *  recipient pending so it goes out after a top-up. */
  | "no_allowance"
  /** Test sends only — the daily test quota is used up. Free, so capped. */
  | "rate_limited"
  /** Attempted and failed at the provider. */
  | "failed";

export interface MarketingSendResult {
  accepted: { ref: string; messageId?: string }[];
  rejected: { ref: string; reason: RejectReason; detail?: string }[];
  /** True when the allowance ran out mid-batch. */
  outOfAllowance: boolean;
  /** Emails left after this batch. */
  remaining: number;
}

/**
 * Hand one batch of rendered emails to the Marketing API, which checks the
 * allowance, sends via Amazon SES, and counts what it sent.
 *
 * THROWS on transport failure — deliberately. The caller must not mark any
 * recipient when it can't know what happened; leaving them pending means the
 * batch is simply retried, which the idempotency keys make safe.
 */
export async function sendMarketingBatch(args: {
  /** Campaign id, or "test" for a preview send. */
  campaignRef: string;
  /** Display name on the From header. The address itself is ours. */
  fromName: string;
  messages: MarketingMessage[];
  /** Preview to the admin's own address: doesn't touch the allowance, but is
   *  capped per day by the Marketing API so it can't be used as free sending. */
  test?: boolean;
}): Promise<MarketingSendResult> {
  if (args.messages.length === 0) {
    return { accepted: [], rejected: [], outOfAllowance: false, remaining: 0 };
  }
  if (!marketingApiConfigured()) {
    throw new Error("MARKETING_API_URL is not set.");
  }
  return stubSend(args.messages);
}

// TODO(amazon-ses): real transport.
//   const res = await fetch(`${process.env.MARKETING_API_URL}/v1/send`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify(args),
//   });
//   if (!res.ok && res.status !== 402) throw new Error(`Marketing API ${res.status}`);
//   return await res.json() as MarketingSendResult;
//
/** Development stand-in. `MARKETING_STUB=out` refuses the whole batch so the
 *  pause-and-resume path can be exercised without a real allowance. */
function stubSend(messages: MarketingMessage[]): MarketingSendResult {
  if ((process.env.MARKETING_STUB ?? "active").trim() === "out") {
    return {
      accepted: [],
      rejected: messages.map((m) => ({ ref: m.ref, reason: "no_allowance" as const })),
      outOfAllowance: true,
      remaining: 0,
    };
  }
  console.log(`[marketing/stub] would send ${messages.length} email(s) via SES`);
  return {
    accepted: messages.map((m) => ({ ref: m.ref, messageId: `stub-${m.ref}` })),
    rejected: [],
    outOfAllowance: false,
    remaining: 1_840,
  };
}

// ── Transport ────────────────────────────────────────────────────────────────
// TODO(amazon-ses): replace the stub with the real HTTP call once the Marketing
// API contract is agreed. The shape above is the contract — everything that
// consumes it is already written against these types, so the swap is local to
// this function.
//
//   const res = await fetch(`${process.env.MARKETING_API_URL}/v1/status`, {
//     headers: { "X-Install-Secret": process.env.MARKETING_API_SECRET ?? "" },
//     cache: "no-store",
//   });
//
async function fetchStatus(): Promise<MarketingStatus> {
  if (!marketingApiConfigured()) {
    return { state: "unavailable", reason: "MARKETING_API_URL is not set." };
  }
  return stubStatus();
}

/**
 * Development stand-in for the Marketing API. Drive it with MARKETING_STUB:
 *   active (default) · out · none · unavailable
 * Delete this function when the real transport lands.
 */
function stubStatus(): MarketingStatus {
  switch ((process.env.MARKETING_STUB ?? "active").trim()) {
    case "none":
      return {
        state: "none",
        buyUrl: "https://admin.directdine.tech/portal/marketing",
        packages: [
          { id: "starter", name: "Starter", emails: 2_000,  priceLabel: "£10 / month", blurb: "Plenty for a monthly newsletter." },
          { id: "growth",  name: "Growth",  emails: 10_000, priceLabel: "£25 / month", blurb: "Weekly offers to a bigger list." },
          { id: "pro",     name: "Pro",     emails: 50_000, priceLabel: "£60 / month", blurb: "Several campaigns a week." },
        ],
      };
    case "out":
      return {
        state: "active", packageName: "Starter", limit: 2_000, used: 2_000, remaining: 0,
        periodEnd: new Date(Date.now() + 11 * 864e5).toISOString(),
      };
    case "unavailable":
      return { state: "unavailable", reason: "Marketing service is unreachable." };
    default:
      return {
        state: "active", packageName: "Starter", limit: 2_000, used: 160, remaining: 1_840,
        periodEnd: new Date(Date.now() + 11 * 864e5).toISOString(),
      };
  }
}
