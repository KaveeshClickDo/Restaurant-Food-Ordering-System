/**
 * Dojo simulator check — runs every virtual-terminal scenario through the same
 * start logic the POS routes use (lib/dojo/flow.ts) against the in-memory mock
 * (lib/dojo/mock.ts). No Dojo account, key, hardware, database or running
 * server needed.
 *
 * Run:  npm run dojo:demo   (from app/)   — uses tsx, no build needed.
 * Prints a ✓/✗ line per check and exits with code 1 if any scenario ends
 * differently from what Dojo's go-live checklist expects.
 */

import { createDojoClient } from "../src/lib/dojo/client";
import { missingDojoSettings } from "../src/lib/dojo/config";
import { DojoApiError, DojoConfigError, describeDojoError, type DojoOp } from "../src/lib/dojo/errors";
import { DojoStartError, startTerminalPayment, type StartPaymentResult } from "../src/lib/dojo/flow";
import { dojoErrorResponse } from "../src/lib/dojo/respond";
import { resolveSnapshot, type DojoGateway } from "../src/lib/dojo/gateway";
import { createDojoMock } from "../src/lib/dojo/mock";
import type { DojoSaleResult, DojoSessionSnapshot } from "../src/lib/dojo/types";
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

function sale(gw: DojoGateway, terminal: string, paymentIntentId?: string): Promise<StartPaymentResult> {
  return startTerminalPayment(gw, { sessionType: "Sale", amount: AMOUNT, reference: "demo", terminal, paymentIntentId });
}

/** Poll like the POS until the session settles, answering a signature check with `signature`. */
async function finish(gw: DojoGateway, started: StartPaymentResult, signature?: boolean): Promise<DojoSessionSnapshot> {
  const id = started.terminalSessionId!;
  let snap = started.snapshot;
  for (let i = 0; i < 20 && !snap.done; i++) {
    const session = snap.status === "SignatureVerificationRequired" && signature !== undefined
      ? await gw.submitSignature(id, signature)
      : await gw.getTerminalSession(id);
    snap = await resolveSnapshot(gw, session);
  }
  return snap;
}

/** Run `fn`; return the Dojo error it throws (unwrapped) and any intent it handed back. */
async function dojoError(fn: () => Promise<unknown>): Promise<{ err: DojoApiError; paymentIntentId: string | null } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e instanceof DojoStartError ? e.original : e;
    if (!(err instanceof DojoApiError)) throw e;
    return { err, paymentIntentId: e instanceof DojoStartError ? e.paymentIntentId : null };
  }
}

/** Run `fn` with some env vars set (undefined = unset), then put them back. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
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

async function virtualTerminals(gw: DojoGateway): Promise<DojoSaleResult | null> {
  console.log("\n── Each virtual terminal, picked by its TID ──");
  const cases: Array<{ tid: string; signature?: boolean; expect: string; ok: (s: DojoSessionSnapshot) => boolean }> = [
    { tid: "VCMSEEKSIP0", expect: "approved, card details saved", ok: (s) => !!s.result?.authCode },
    { tid: "VCMSEEKSCN0", expect: "approved (contactless)", ok: (s) => !!s.result?.authCode },
    { tid: "VCMSEEKSIS0", signature: true, expect: "signature accepted, approved with card details", ok: (s) => !!s.result?.authCode },
    { tid: "VCMSEEKDIS0", signature: true, expect: "signature accepted, approved (as SIS0)", ok: (s) => !!s.result?.authCode },
    { tid: "VCMSEEKDIP0", expect: "declined", ok: (s) => !s.result && s.status === "Declined" },
    { tid: "VCMSEEKUIP0", expect: "unsuccessful, ends cancelled", ok: (s) => !s.result && s.status === "Canceled" },
    { tid: "VCMSEEKTIP0", expect: "timed out, result unconfirmed", ok: (s) => !s.result && s.status === "Expired" },
    { tid: "VCMSEEKCIP0", expect: "cancelled on the machine", ok: (s) => !s.result && s.status === "Canceled" },
    { tid: "VCMSEEKSIP1", expect: "approved with a £1.25 tip recorded", ok: (s) => s.result?.tipAmount === 1.25 && s.result?.totalAmount === 13.75 },
  ];

  let paid: DojoSaleResult | null = null;
  for (const c of cases) {
    const snap = await finish(gw, await sale(gw, c.tid), c.signature);
    check(snap.done && c.ok(snap), `${c.tid}: ${c.expect} [${snap.status}]`);
    if (c.tid === "VCMSEEKSIP0" && snap.result) paid = snap.result;
  }
  return paid;
}

async function signatureEdges(gw: DojoGateway): Promise<void> {
  console.log("\n── Signature edge cases ──");
  const rejected = await finish(gw, await sale(gw, "VCMSEEKSIS0"), false);
  check(rejected.done && !rejected.result && rejected.status === "SignatureVerificationRejected",
    `rejected by staff, nothing recorded [${rejected.status}]`);

  const started = await sale(gw, "VCMSEEKSIS0");
  const approved = await finish(gw, started, true);
  const late = await dojoError(() => gw.submitSignature(started.terminalSessionId!, false));
  check(!!approved.result && late !== null && describeDojoError(late.err, "signature").code === "rejected",
    "a rejection after the sale settled is refused; the sale stays approved");
}

async function retryAfterDecline(gw: DojoGateway): Promise<void> {
  console.log("\n── Retry after a decline reuses the payment intent ──");
  const first = await sale(gw, "VCMSEEKDIP0");
  await finish(gw, first);
  const second = await sale(gw, "VCMSEEKDIP0", first.paymentIntentId!);
  check(second.paymentIntentId === first.paymentIntentId, "the second attempt uses the same intent");
  await finish(gw, second);
  const third = await sale(gw, "VCMSEEKSIP0", first.paymentIntentId!);
  const snap = await finish(gw, third);
  check(third.paymentIntentId === first.paymentIntentId && !!snap.result,
    "another card on a third attempt is approved on that same intent");
  const fourth = await sale(gw, "VCMSEEKSIP0", first.paymentIntentId!);
  check(fourth.terminalId === null && fourth.terminalSessionId === third.terminalSessionId,
    "retrying once more reports the approved attempt, not the declined ones");
}

async function alreadyPaid(gw: DojoGateway, paid: DojoSaleResult | null): Promise<void> {
  console.log("\n── Retry of a payment that already went through ──");
  if (!paid) { check(false, "needs the approved VCMSEEKSIP0 sale from above"); return; }
  const paidIntent = paid.paymentIntentId;
  const again = await sale(gw, "VCMSEEKSIP0", paidIntent);
  check(again.terminalId === null && again.snapshot.done && again.snapshot.result?.paymentIntentId === paidIntent
    && again.terminalSessionId === paid.terminalSessionId,
    "reported as paid with the session that took the money; no second charge is started");

  // A paid intent for a different amount is another payment: it must not make
  // this one look paid.
  const other = await startTerminalPayment(gw, {
    sessionType: "Sale", amount: { value: 999, currencyCode: "GBP" }, terminal: "VCMSEEKSIP0", paymentIntentId: paidIntent,
  });
  check(other.terminalId !== null && other.paymentIntentId !== paidIntent,
    "a different amount starts a new payment instead of reusing the paid one");
  await finish(gw, other);
}

async function cancelling(gw: DojoGateway): Promise<void> {
  console.log("\n── Cancelling from the POS ──");
  const early = await sale(gw, "VCMSEEKSIP0");
  const earlyId = early.terminalSessionId!;
  await gw.getTerminalSession(earlyId); // Initiated: waiting for the card
  const requested = await gw.cancelTerminalSession(earlyId);
  check(requested.status === "CancelRequested", "before the card: Dojo accepts the cancel");
  const cancelled = await finish(gw, { ...early, snapshot: await resolveSnapshot(gw, requested) });
  check(cancelled.status === "Canceled" && !cancelled.result, `polling then shows it cancelled [${cancelled.status}]`);

  const late = await sale(gw, "VCMSEEKSIP0");
  const lateId = late.terminalSessionId!;
  await gw.getTerminalSession(lateId); // Initiated
  await gw.getTerminalSession(lateId); // card presented
  const refused = await dojoError(() => gw.cancelTerminalSession(lateId));
  check(refused !== null && describeDojoError(refused.err, "cancel").code === "cancel_too_late",
    "after the card: the cancel is refused as too late");
  const carriedOn = await finish(gw, late);
  check(!!carriedOn.result, `the payment carries on and is approved [${carriedOn.status}]`);
}

async function unavailableTerminals(gw: DojoGateway): Promise<void> {
  console.log("\n── Busy and unknown card machines ──");
  const first = await sale(gw, "VCMSEEKSIP0");
  const busy = await dojoError(() => sale(gw, "VCMSEEKSIP0"));
  check(busy !== null && describeDojoError(busy.err, "create").code === "terminal_busy",
    "a second sale on a busy machine is refused as busy");
  check(busy?.paymentIntentId != null, "the refused attempt hands back its intent for the retry");
  await finish(gw, first);

  const unknown = await dojoError(() => sale(gw, "VCMSEEKXXX0"));
  check(unknown !== null && describeDojoError(unknown.err, "create").code === "terminal_unavailable",
    "an unknown TID is reported as unreachable");
}

function staffMessages(): void {
  console.log("\n── Staff messages for Dojo errors ──");
  const cases: Array<[number, DojoOp, string]> = [
    [401, "create", "auth"],
    [404, "create", "terminal_unavailable"],
    [409, "create", "terminal_busy"],
    [422, "cancel", "cancel_too_late"],
    [0, "poll", "network"],
    [503, "create", "network"],
  ];
  for (const [status, op, code] of cases) {
    const d = describeDojoError(new DojoApiError(status, "test", null), op);
    check(d.code === code, `${op} ${status} → ${d.code}: "${d.message}"`);
  }
  check(describeDojoError(new DojoApiError(401, "test", null), "create").httpStatus === 502,
    "a bad API key is not passed on as a 401 (the staff login is fine)");
}

/** The real client's handling of a call Dojo never answers (fetch stubbed, so no waiting). */
async function noAnswer(): Promise<void> {
  console.log("\n── Dojo not answering ──");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;
  try {
    await withEnv({ DOJO_SOFTWARE_HOUSE_ID: "demo-software-house" }, async () => {
      const timedOut = await dojoError(() => createDojoClient().getTerminalSession("ts_demo"));
      check(timedOut !== null && timedOut.err.status === 0 && describeDojoError(timedOut.err, "poll").code === "network",
        `a call that times out counts as a network problem, so the result stays unknown: "${timedOut?.err.message}"`);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Live mode without DOJO_SOFTWARE_HOUSE_ID: every call is refused before it reaches Dojo. */
async function missingSoftwareHouseId(): Promise<void> {
  console.log("\n── A missing software-house-id ──");
  const live = { DOJO_MODE: "live", DOJO_API_KEY: "sk_sandbox_demo" };
  await withEnv({ ...live, DOJO_SOFTWARE_HOUSE_ID: undefined }, async () => {
    check(missingDojoSettings().join() === "DOJO_SOFTWARE_HOUSE_ID", "live mode reports DOJO_SOFTWARE_HOUSE_ID as missing");
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { calls += 1; throw new Error("the demo makes no network calls"); }) as typeof fetch;
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
  await withEnv({ ...live, DOJO_SOFTWARE_HOUSE_ID: "demo-software-house" }, async () => {
    check(missingDojoSettings().length === 0, "with it set, nothing is missing");
  });
}

/** Dojo needs a reference of 1–60 characters; the till's names its sale. */
async function references(gw: DojoGateway): Promise<void> {
  console.log("\n── Payment references ──");
  const refused = await dojoError(() => gw.createPaymentIntent({ amount: AMOUNT, reference: "" }));
  check(refused !== null && refused.err.status === 400 && describeDojoError(refused.err, "create").code === "rejected",
    `like Dojo, the simulator refuses a payment with no reference: "${refused?.err.message}"`);

  const startWith = async (reference: string | undefined) => {
    const started = await startTerminalPayment(gw, { sessionType: "Sale", amount: AMOUNT, reference, terminal: "VCMSEEKSIP0" });
    await finish(gw, started);
    return (await gw.getPaymentIntent(started.paymentIntentId!)).reference ?? "";
  };
  check(await startWith(undefined) === "Card sale", "a screen that sends no reference still gets paid, as \"Card sale\"");
  check((await startWith("x".repeat(80))).length === 60, "a reference over 60 characters is cut to 60");

  const saleId = uuid();
  const tillRef = posSaleReference(saleId);
  check(await startWith(tillRef) === tillRef && /^POS sale [0-9A-F]{8}$/.test(tillRef),
    `the till's reference names its sale: "${tillRef}"`);
  check(matchesShortSaleId(saleId, tillRef) && matchesShortSaleId(saleId, tillRef.slice(-8).toLowerCase())
    && !matchesShortSaleId(uuid(), tillRef) && !matchesShortSaleId(saleId, "P"),
    "the sales search finds the sale from it, pasted whole or as the 8 characters; not from 1 character");
}

/** Keyed payments (MOTO): the flag reaches Dojo, and a retry stays in its mode. */
async function keyed(gw: DojoGateway): Promise<void> {
  console.log("\n── Keyed payments (MOTO, card not present) ──");
  const keyedSale = (terminal: string, paymentIntentId?: string) => startTerminalPayment(gw, {
    sessionType: "Sale", amount: AMOUNT, reference: "VIP T5", terminal, paymentIntentId, cardHolderNotPresent: true,
  });
  const started = await keyedSale("VCMSEEKSIP0");
  const snap = await finish(gw, started);
  check(!!snap.result && (await gw.getPaymentIntent(started.paymentIntentId!)).cardHolderNotPresent === true,
    "a keyed payment is approved, and Dojo holds it as card not present");
  const present = await sale(gw, "VCMSEEKSIP0");
  await finish(gw, present);
  check((await gw.getPaymentIntent(present.paymentIntentId!)).cardHolderNotPresent !== true,
    "a card-present payment isn't marked keyed");

  const declined = await keyedSale("VCMSEEKDIP0");
  await finish(gw, declined);
  const retried = await keyedSale("VCMSEEKSIP0", declined.paymentIntentId!);
  check(retried.paymentIntentId === declined.paymentIntentId && !!(await finish(gw, retried)).result,
    "a keyed retry after a decline reuses its intent and is approved");

  const declinedAgain = await keyedSale("VCMSEEKDIP0");
  await finish(gw, declinedAgain);
  const switched = await sale(gw, "VCMSEEKSIP0", declinedAgain.paymentIntentId!);
  check(switched.paymentIntentId !== declinedAgain.paymentIntentId,
    "a card-present retry of a keyed attempt gets an intent of its own");
  await finish(gw, switched);

  const body = DojoCreateSessionSchema.safeParse({ amount: 12.5, cardHolderNotPresent: true });
  check(body.success && body.data.cardHolderNotPresent === true, "the payment routes take the keyed flag");
}

/** What the routes take from a screen (lib/schemas/dojo.ts). */
function routeBodies(): void {
  console.log("\n── What the routes accept ──");
  const start = DojoCreateSessionSchema.safeParse({ amount: 12.5, sessionType: "UnlinkedRefund", captureMode: "Manual" });
  check(start.success && !("sessionType" in start.data) && !("captureMode" in start.data),
    "a refund session or manual capture sent to the payment routes is dropped: they only start sales");
  const refund = DojoRefundSchema.safeParse({ paymentIntentId: "pi_demo", amount: 5 });
  check(!refund.success, "a server refund without a requestId (its idempotency key) is refused");
}

async function refunds(gw: DojoGateway): Promise<void> {
  console.log("\n── Server-side refunds ──");
  const snap = await finish(gw, await sale(gw, "VCMSEEKSIP0"));
  const pi = snap.result!.paymentIntentId;
  await gw.createRefund({ paymentIntentId: pi, amount: 500, refundReason: "Demo", idempotencyKey: "demo-part" });
  check((await gw.getPaymentIntent(pi)).status === "Captured", "a partial refund leaves the intent Captured");
  await gw.createRefund({ paymentIntentId: pi, amount: 750, refundReason: "Demo", idempotencyKey: "demo-rest" });
  check((await gw.getPaymentIntent(pi)).status === "Refunded", "refunding the rest marks it Refunded");
  const again = await dojoError(() => gw.createRefund({ paymentIntentId: pi, amount: 100, idempotencyKey: "demo-after" }));
  check(again !== null && describeDojoError(again.err, "refund").code === "rejected",
    "a refund on a fully refunded payment is refused");

  const other = (await finish(gw, await sale(gw, "VCMSEEKSIP0"))).result!.paymentIntentId;
  const once = await gw.createRefund({ paymentIntentId: other, amount: 400, idempotencyKey: "demo-twice" });
  const twice = await gw.createRefund({ paymentIntentId: other, amount: 400, idempotencyKey: "demo-twice" });
  check(once.refundId === twice.refundId && (await gw.getPaymentIntent(other)).refundedAmount === 400,
    "the same refund sent twice (same requestId) refunds once");
  const over = await dojoError(() => gw.createRefund({ paymentIntentId: other, amount: 900, idempotencyKey: "demo-over" }));
  check(over !== null && describeDojoError(over.err, "refund").code === "rejected",
    "refunding more than is left of the payment is refused");

  console.log("\n── Card-present (matched) refunds ──");
  // Through flow.ts, as the routes do: the amount is sent, so the intent updates.
  const paid = await finish(gw, await sale(gw, "VCMSEEKSIP0"));
  const matched = await startTerminalPayment(gw, {
    sessionType: "MatchedRefund", amount: AMOUNT, terminal: "VCMSEEKSIP0", paymentIntentId: paid.result!.paymentIntentId,
  });
  const refunded = await finish(gw, matched);
  const after = await gw.getPaymentIntent(paid.result!.paymentIntentId);
  check(refunded.status === "Captured" && after.status === "Refunded",
    `with the amount: the session completes and the intent shows Refunded [${after.status}]`);

  // Without the amount the sandbox leaves the intent untouched; the mock copies that.
  const paid2 = await finish(gw, await sale(gw, "VCMSEEKSIP0"));
  const bare = await gw.createTerminalSession({
    terminalId: "tm_mock_VCMSEEKSIP0", sessionType: "MatchedRefund", paymentIntentId: paid2.result!.paymentIntentId,
  });
  await finish(gw, { terminalId: bare.terminalId, paymentIntentId: null, terminalSessionId: bare.id, snapshot: await resolveSnapshot(gw, bare) });
  const untouched = await gw.getPaymentIntent(paid2.result!.paymentIntentId);
  check(untouched.status === "Captured" && (untouched.refundedAmount ?? 0) === 0,
    "without the amount: the intent stays Captured with nothing refunded, as on the sandbox");
}

function webhookSignatures(): void {
  console.log("\n── Webhook signature check ──");
  const saved = process.env.DOJO_WEBHOOK_SECRET;
  const body = JSON.stringify({ id: "evt_demo", event: "payment_intent.status_updated" });
  try {
    process.env.DOJO_WEBHOOK_SECRET = "demo-secret";
    const good = buildDojoSignature(body, "demo-secret");
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
  const gw = createDojoMock();
  const terminals = await gw.listTerminals(false);
  console.log(`Mock terminals: ${terminals.map((t) => t.properties?.tid).join(", ")}`);

  const paid = await virtualTerminals(gw);
  await signatureEdges(gw);
  await retryAfterDecline(gw);
  await alreadyPaid(gw, paid);
  await cancelling(gw);
  await unavailableTerminals(gw);
  staffMessages();
  await noAnswer();
  await missingSoftwareHouseId();
  await references(gw);
  await keyed(gw);
  routeBodies();
  await refunds(gw);
  webhookSignatures();

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
