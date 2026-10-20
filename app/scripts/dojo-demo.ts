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

import { DojoApiError, describeDojoError, type DojoOp } from "../src/lib/dojo/errors";
import { DojoStartError, startTerminalPayment, type StartPaymentResult } from "../src/lib/dojo/flow";
import { resolveSnapshot, type DojoGateway } from "../src/lib/dojo/gateway";
import { createDojoMock } from "../src/lib/dojo/mock";
import type { DojoSessionSnapshot } from "../src/lib/dojo/types";
import { buildDojoSignature, verifyDojoSignature } from "../src/lib/dojo/webhook";

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

async function virtualTerminals(gw: DojoGateway): Promise<string | null> {
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

  let paidIntent: string | null = null;
  for (const c of cases) {
    const snap = await finish(gw, await sale(gw, c.tid), c.signature);
    check(snap.done && c.ok(snap), `${c.tid}: ${c.expect} [${snap.status}]`);
    if (c.tid === "VCMSEEKSIP0" && snap.result) paidIntent = snap.result.paymentIntentId;
  }
  return paidIntent;
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
}

async function alreadyPaid(gw: DojoGateway, paidIntent: string | null): Promise<void> {
  console.log("\n── Retry of a payment that already went through ──");
  if (!paidIntent) { check(false, "needs the approved VCMSEEKSIP0 sale from above"); return; }
  const again = await sale(gw, "VCMSEEKSIP0", paidIntent);
  check(again.terminalId === null && again.snapshot.done && again.snapshot.result?.paymentIntentId === paidIntent,
    "reported as paid; no second charge is started");

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

async function refunds(gw: DojoGateway): Promise<void> {
  console.log("\n── Server-side refunds ──");
  const snap = await finish(gw, await sale(gw, "VCMSEEKSIP0"));
  const pi = snap.result!.paymentIntentId;
  await gw.createRefund({ paymentIntentId: pi, amount: 500, refundReason: "Demo", idempotencyKey: "demo-part" });
  check((await gw.getPaymentIntent(pi)).status === "Captured", "a partial refund leaves the intent Captured");
  await gw.createRefund({ paymentIntentId: pi, amount: 750, refundReason: "Demo", idempotencyKey: "demo-rest" });
  check((await gw.getPaymentIntent(pi)).status === "Refunded", "refunding the rest marks it Refunded");

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

  const paidIntent = await virtualTerminals(gw);
  await signatureEdges(gw);
  await retryAfterDecline(gw);
  await alreadyPaid(gw, paidIntent);
  await cancelling(gw);
  await unavailableTerminals(gw);
  staffMessages();
  await refunds(gw);
  webhookSignatures();

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
