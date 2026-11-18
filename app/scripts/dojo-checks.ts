/**
 * Dojo checks that need no card machine and no network: DOJO_MODE, the staff
 * message for each Dojo error, the client's headers, time limits and request
 * log, the settings it needs, what the routes accept, the till's payment
 * reference and webhook signatures. The card machine itself is tested against
 * Dojo's real sandbox: `npm run dojo:sandbox` and `npm run dojo:routes`.
 *
 * Run:  npm run dojo:checks   (from app/)   — uses tsx, no build needed.
 * Prints a ✓/✗ line per check and exits with code 1 if any fails.
 */

import { createDojoClient } from "../src/lib/dojo/client";
import { dojoMode, isDojoEnabled, isDojoSandboxKey, missingDojoSettings } from "../src/lib/dojo/config";
import { DojoApiError, DojoConfigError, DojoDisabledError, describeDojoError, type DojoOp } from "../src/lib/dojo/errors";
import { dojoErrorResponse } from "../src/lib/dojo/respond";
import { getDojoGateway } from "../src/lib/dojo/select";
import { buildDojoSignature, verifyDojoSignature } from "../src/lib/dojo/webhook";
import { DojoCreateSessionSchema, DojoRefundSchema } from "../src/lib/schemas/dojo";
import { matchesShortSaleId, posSaleReference } from "../src/lib/posSaleRef";
import { uuid } from "../src/lib/uuid";

const AMOUNT = { value: 1250, currencyCode: "GBP" }; // £12.50
let failures = 0;

function check(ok: boolean, label: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures += 1;
}

/** Run `fn`; return the Dojo error it throws, or null if it doesn't. */
async function dojoError(fn: () => Promise<unknown>): Promise<DojoApiError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof DojoApiError) return e;
    throw e;
  }
}

/** Run `fn` with some env vars set (undefined = unset), then put them back. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  };
  apply(vars);
  try {
    await fn();
  } finally {
    apply(saved);
  }
}

async function modes(): Promise<void> {
  console.log("\n── DOJO_MODE ──");
  const key = "sk_sandbox_test";
  await withEnv({ DOJO_MODE: undefined, DOJO_API_KEY: key }, () => check(dojoMode() === "off", "not set: off"));
  await withEnv({ DOJO_MODE: "live", DOJO_API_KEY: key }, () => check(dojoMode() === "live" && isDojoEnabled(), "live with a key: on"));
  await withEnv({ DOJO_MODE: "live", DOJO_API_KEY: undefined }, () => check(dojoMode() === "off", "live without a key: off, it never pretends to be live"));
  await withEnv({ DOJO_MODE: "mock", DOJO_API_KEY: undefined }, () => {
    let refused = false;
    try {
      getDojoGateway();
    } catch (e) {
      refused = e instanceof DojoDisabledError;
    }
    check(dojoMode() === "off" && !isDojoEnabled() && refused, "the old DOJO_MODE=mock counts as off, and no gateway opens");
  });
  await withEnv({ DOJO_API_KEY: key }, () => check(isDojoSandboxKey(), "an sk_sandbox_ key is test mode"));
  await withEnv({ DOJO_API_KEY: "sk_prod_test" }, () => check(!isDojoSandboxKey(), "an sk_prod_ key is not"));
}

function staffMessages(): void {
  console.log("\n── Staff messages for Dojo errors ──");
  const cases: Array<[number, DojoOp, string]> = [
    [401, "create", "auth"],
    [404, "create", "terminal_unavailable"],
    [409, "create", "terminal_busy"],
    [400, "create", "rejected"],
    [422, "cancel", "cancel_too_late"],
    [422, "signature", "rejected"],
    [404, "poll", "rejected"],
    [0, "poll", "network"],
    [503, "create", "network"],
    [400, "refund", "rejected"],
    [422, "refund", "rejected"],
  ];
  for (const [status, op, code] of cases) {
    const d = describeDojoError(new DojoApiError(status, "test", null), op);
    check(d.code === code, `${op} ${status} → ${d.code}: "${d.message}"`);
  }
  check(describeDojoError(new DojoApiError(401, "test", null), "create").httpStatus === 502,
    "a bad API key is not passed on as a 401 (the staff login is fine)");
}

/** The client's handling of a call Dojo never answers (fetch stubbed, so no waiting). */
async function noAnswer(): Promise<void> {
  console.log("\n── Dojo not answering ──");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;
  try {
    await withEnv({ DOJO_SOFTWARE_HOUSE_ID: "test-software-house" }, async () => {
      const timedOut = await dojoError(() => createDojoClient().getTerminalSession("ts_test"));
      check(timedOut !== null && timedOut.status === 0 && describeDojoError(timedOut, "poll").code === "network",
        `a call that times out counts as a network problem, so the result stays unknown: "${timedOut?.message}"`);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Live mode without DOJO_SOFTWARE_HOUSE_ID: every call is refused before it reaches Dojo. */
async function missingSoftwareHouseId(): Promise<void> {
  console.log("\n── A missing software-house-id ──");
  const live = { DOJO_MODE: "live", DOJO_API_KEY: "sk_sandbox_test" };
  await withEnv({ ...live, DOJO_SOFTWARE_HOUSE_ID: undefined }, async () => {
    check(missingDojoSettings().join() === "DOJO_SOFTWARE_HOUSE_ID", "live mode reports DOJO_SOFTWARE_HOUSE_ID as missing");
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { calls += 1; throw new Error("these checks make no network calls"); }) as typeof fetch;
    try {
      const err = await createDojoClient().listTerminals(false).then(() => null, (e: unknown) => e);
      check(err instanceof DojoConfigError && calls === 0,
        `refused before calling Dojo: "${err instanceof Error ? err.message : String(err)}"`);
      const res = dojoErrorResponse(err, "create");
      const body = await res.json() as { code?: string; error?: string };
      check(res.status === 503 && body.code === "config", `the till is told (HTTP ${res.status}): "${body.error}"`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
  await withEnv({ ...live, DOJO_SOFTWARE_HOUSE_ID: "test-software-house" }, () => {
    check(missingDojoSettings().length === 0, "with it set, nothing is missing");
  });
}

/** Dojo's UAT ask: our software-house-id on every payment intent and terminal
 *  session call. And the request log (DOJO_LOG_REQUESTS=1) never prints the key. */
async function headersOnEveryCall(): Promise<void> {
  console.log("\n── Our software-house-id on every call ──");
  const sent: Array<{ call: string; headers: Record<string, string> }> = [];
  const logged: string[] = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://api.dojo.tech", "");
    sent.push({ call: `${init?.method ?? "GET"} ${path}`, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(path.startsWith("/terminals") ? "[]" : JSON.stringify({ id: "pi_test" }), { status: 200 });
  }) as typeof fetch;
  try {
    await withEnv(
      { DOJO_SOFTWARE_HOUSE_ID: "test-software-house", DOJO_API_KEY: "sk_sandbox_test-secret-key", DOJO_LOG_REQUESTS: "1" },
      async () => {
        console.log = (...args: unknown[]) => { logged.push(args.join(" ")); };
        const c = createDojoClient();
        await c.createPaymentIntent({ amount: AMOUNT, reference: "test" });
        await c.getPaymentIntent("pi_test");
        await c.createRefund({ paymentIntentId: "pi_test", amount: 500, idempotencyKey: "test-refund" });
        await c.listTerminals(false);
        await c.createTerminalSession({ terminalId: "tm_test", sessionType: "Sale", paymentIntentId: "pi_test" });
        await c.getTerminalSession("ts_test");
        await c.submitSignature("ts_test", true);
        await c.cancelTerminalSession("ts_test");
      },
    );
  } finally {
    console.log = realLog;
    globalThis.fetch = realFetch;
  }
  const without = sent.filter((r) =>
    r.headers["software-house-id"] !== "test-software-house" || r.headers["reseller-id"] !== "test-software-house");
  check(sent.length === 8 && without.length === 0,
    `${sent.length} kinds of call, each with software-house-id and reseller-id`
      + (without.length ? `; missing on ${without.map((r) => r.call).join(", ")}` : ""));
  check(logged.length > 0 && logged.some((l) => l.includes("software-house-id: test-software-house"))
      && !logged.some((l) => l.includes("test-secret-key")),
    `the request log shows the header, never the key: "${logged[0] ?? ""}"`);
}

/** A refund gets 45 s to answer (the sandbox took 14.5 s), every other call
 *  15 s; a refund with no answer tells staff it may still go through. */
async function timeLimits(): Promise<void> {
  console.log("\n── Time limits ──");
  const limits: Record<string, number> = {};
  let pending = "";
  const realFetch = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ((ms: number) => { limits[pending] = ms; return new AbortController().signal; }) as typeof AbortSignal.timeout;
  globalThis.fetch = (async () => new Response(JSON.stringify({ id: "pi_test" }), { status: 200 })) as typeof fetch;
  try {
    await withEnv({ DOJO_SOFTWARE_HOUSE_ID: "test-software-house", DOJO_API_KEY: "sk_sandbox_test" }, async () => {
      const c = createDojoClient();
      pending = "refund";  await c.createRefund({ paymentIntentId: "pi_test", amount: 500, idempotencyKey: "test-refund" });
      pending = "payment"; await c.createPaymentIntent({ amount: AMOUNT, reference: "test" });
      pending = "session"; await c.getTerminalSession("ts_test");
    });
  } finally {
    AbortSignal.timeout = realTimeout;
    globalThis.fetch = realFetch;
  }
  check(limits.refund === 45_000 && limits.payment === 15_000 && limits.session === 15_000,
    `a refund waits ${(limits.refund ?? 0) / 1000}s; a payment and a status check ${(limits.payment ?? 0) / 1000}s and ${(limits.session ?? 0) / 1000}s`);
  const refundTimeout = describeDojoError(new DojoApiError(0, "timed out", null), "refund");
  check(refundTimeout.code === "network" && /may still go through/.test(refundTimeout.message),
    `a refund with no answer: "${refundTimeout.message}"`);
}

/** The till's payment reference names its sale, and the sales search finds it. */
function tillReference(): void {
  console.log("\n── The till's payment reference ──");
  const saleId = uuid();
  const tillRef = posSaleReference(saleId);
  check(/^POS sale [0-9A-F]{8}$/.test(tillRef), `it names the sale: "${tillRef}"`);
  check(matchesShortSaleId(saleId, tillRef) && matchesShortSaleId(saleId, tillRef.slice(-8).toLowerCase())
    && !matchesShortSaleId(uuid(), tillRef) && !matchesShortSaleId(saleId, "P"),
    "the sales search finds the sale from it, pasted whole or as the 8 characters; not from 1 character");
}

/** What the routes take from a screen (lib/schemas/dojo.ts). */
function routeBodies(): void {
  console.log("\n── What the routes accept ──");
  const start = DojoCreateSessionSchema.safeParse({ amount: 12.5, sessionType: "UnlinkedRefund", captureMode: "Manual" });
  check(start.success && !("sessionType" in start.data) && !("captureMode" in start.data),
    "a refund session or manual capture sent to the payment routes is dropped: they only start sales");
  const keyed = DojoCreateSessionSchema.safeParse({ amount: 12.5, cardHolderNotPresent: true });
  check(keyed.success && keyed.data.cardHolderNotPresent === true, "the payment routes take the keyed flag");
  const refund = DojoRefundSchema.safeParse({ paymentIntentId: "pi_test", amount: 5 });
  check(!refund.success, "a server refund without a requestId (its idempotency key) is refused");
}

function webhookSignatures(): void {
  console.log("\n── Webhook signature check ──");
  const saved = process.env.DOJO_WEBHOOK_SECRET;
  const body = JSON.stringify({ id: "evt_test", event: "payment_intent.status_updated" });
  try {
    process.env.DOJO_WEBHOOK_SECRET = "test-secret";
    const good = buildDojoSignature(body, "test-secret");
    check(/^sha256=([0-9A-F]{2}-){31}[0-9A-F]{2}$/.test(good), "the signature has Dojo's format (sha256= + uppercase hex joined by -)");
    check(verifyDojoSignature(body, good), "a correctly signed body is accepted");
    check(!verifyDojoSignature(body + " ", good), "a body changed after signing is refused");
    check(!verifyDojoSignature(body, buildDojoSignature(body, "other-secret")), "a signature made with another secret is refused");
    check(!verifyDojoSignature(body, null), "a request without a signature is refused");
    delete process.env.DOJO_WEBHOOK_SECRET;
    check(!verifyDojoSignature(body, good), "with no secret configured, everything is refused");
  } finally {
    if (saved === undefined) delete process.env.DOJO_WEBHOOK_SECRET;
    else process.env.DOJO_WEBHOOK_SECRET = saved;
  }
}

async function main(): Promise<void> {
  await modes();
  staffMessages();
  await noAnswer();
  await missingSoftwareHouseId();
  await headersOnEveryCall();
  await timeLimits();
  tillReference();
  routeBodies();
  webhookSignatures();

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
