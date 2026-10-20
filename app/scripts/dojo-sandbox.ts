/**
 * Dojo sandbox check — runs the virtual-terminal scenarios against Dojo's real
 * sandbox (api.dojo.tech with an sk_sandbox_ key), through the same start
 * logic the POS routes use (lib/dojo/flow.ts). No app, database or POS login
 * needed: only DOJO_* settings in app/.env.local.
 *
 * Run:  npm run dojo:sandbox                        (from app/; everything)
 *       npm run dojo:sandbox -- refunds signature   (only those sections)
 * Sections: machines, signature, retry, paid, cancel, busy, unknown, wrongkey, refunds.
 *
 * It refuses any key that isn't a sandbox key and never prints the key. It
 * prints what Dojo actually returns (statuses with their timing, terminal
 * prompts, and any refused call), so the simulator (lib/dojo/mock.ts) can be
 * kept in line, and exits with code 1 if a must-pass check fails. A terminal
 * missing from the account is listed for Dojo rather than counted as a failure.
 */

import { randomUUID } from "node:crypto";
import { createDojoClient } from "../src/lib/dojo/client";
import { dojoConfig } from "../src/lib/dojo/config";
import { DojoApiError, describeDojoError, type DojoOp } from "../src/lib/dojo/errors";
import { DojoStartError, startTerminalPayment } from "../src/lib/dojo/flow";
import { resolveSnapshot, type DojoGateway } from "../src/lib/dojo/gateway";
import type { DojoPaymentIntent, DojoSaleResult, DojoSessionSnapshot, DojoTerminalSession } from "../src/lib/dojo/types";

const AMOUNT = { value: 1000, currencyCode: "GBP" }; // £10.00, so a 10% tip is £1.00
const POLL_MS = 1000;
const SCENARIO_TIMEOUT_MS = 180_000;

const SECTIONS = ["machines", "signature", "retry", "paid", "cancel", "busy", "unknown", "wrongkey", "refunds"] as const;
type Section = (typeof SECTIONS)[number];

type Expect = "paid" | "declined" | "expired" | "canceled" | "rejected";

const MACHINES: Array<{ tid: string; expect: Expect; signature?: boolean }> = [
  { tid: "VCMSEEKSIP0", expect: "paid" },
  { tid: "VCMSEEKSCN0", expect: "paid" },
  { tid: "VCMSEEKSIS0", expect: "paid", signature: true },
  { tid: "VCMSEEKDIS0", expect: "paid", signature: true },
  { tid: "VCMSEEKDIP0", expect: "declined" },
  { tid: "VCMSEEKUIP0", expect: "canceled" },
  { tid: "VCMSEEKTIP0", expect: "expired" },
  { tid: "VCMSEEKCIP0", expect: "canceled" },
  { tid: "VCMSEEKSIP1", expect: "paid" },
];

interface Run {
  label: string;
  /** Final session status, or "could not start". */
  status: string;
  result: DojoSaleResult | null;
  statuses: string[];
  prompts: string[];
  remarks: string[];
  seconds: number;
  error: string | null;
  paymentIntentId: string | null;
  alreadyPaid: boolean;
}

let failures = 0;
/** Account set-up to raise with Dojo (not a failure of our code). */
const dojoQuestions: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dedupe = (xs: string[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

function newRun(label: string): Run {
  return {
    label, status: "", result: null, statuses: [], prompts: [], remarks: [],
    seconds: 0, error: null, paymentIntentId: null, alreadyPaid: false,
  };
}

function check(ok: boolean, label: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures += 1;
}

function errorText(e: unknown, op: DojoOp): string {
  const err = e instanceof DojoStartError ? e.original : e;
  if (err instanceof DojoApiError) return `Dojo ${err.status} → ${describeDojoError(err, op).code}: ${err.message}`;
  return e instanceof Error ? e.message : String(e);
}

function matches(run: Run, expect: Expect): boolean {
  if (run.error) return false;
  switch (expect) {
    case "paid": return run.result !== null;
    case "declined": return !run.result && run.status === "Declined";
    case "expired": return !run.result && run.status === "Expired";
    case "canceled": return !run.result && run.status === "Canceled";
    case "rejected": return !run.result && run.status === "SignatureVerificationRejected";
  }
}

function describeRun(run: Run): string {
  if (run.error) return `${run.status}: ${run.error}`;
  const r = run.result;
  const base = `${run.status} in ${run.seconds}s`;
  if (!r) return base;
  const card = r.cardScheme ? `${r.cardScheme} ****${r.cardLast4 ?? "????"}` : "no card details";
  const tip = r.tipAmount ? `, tip £${r.tipAmount.toFixed(2)}` : "";
  return `${base}, auth ${r.authCode ?? "none"}, ${card}${tip}`;
}

function report(run: Run, expect: Expect): void {
  check(matches(run, expect), `${run.label}: ${describeRun(run)}`);
  details(run);
}

function details(run: Run): void {
  if (run.statuses.length) console.log(`      statuses: ${run.statuses.join(" → ")}`);
  if (run.prompts.length) console.log(`      prompts:  ${run.prompts.join(", ")}`);
  for (const r of run.remarks) console.log(`      ${r}`);
}

/** Status changes with seconds since the session opened, from Dojo's own timestamps. */
function timeline(session: DojoTerminalSession): string[] {
  const events = session.statusEvents;
  if (events.length === 0) return [];
  const start = Date.parse(events[0].createdAt);
  const out: string[] = [];
  let last = "";
  for (const e of events) {
    if (e.status === last) continue;
    last = e.status;
    const dt = Math.round((Date.parse(e.createdAt) - start) / 1000);
    out.push(out.length === 0 || Number.isNaN(dt) ? e.status : `${e.status} (+${dt}s)`);
  }
  return out;
}

/** Poll a started session like the POS does until it settles. */
async function follow(
  gw: DojoGateway,
  run: Run,
  sessionId: string,
  first: DojoSessionSnapshot,
  t0: number,
  signature?: boolean,
): Promise<void> {
  let snap = first;
  let session: DojoTerminalSession | null = null;
  let signed = false;
  let errors = 0;
  while (!snap.done && Date.now() - t0 < SCENARIO_TIMEOUT_MS) {
    await sleep(POLL_MS);
    const signing = snap.status === "SignatureVerificationRequired" && signature !== undefined && !signed;
    try {
      if (signing) {
        signed = true;
        session = await gw.submitSignature(sessionId, signature);
        run.remarks.push(`signature ${signature ? "accepted" : "rejected"} by the POS after ${Math.round((Date.now() - t0) / 1000)}s`);
      } else {
        session = await gw.getTerminalSession(sessionId);
      }
      snap = await resolveSnapshot(gw, session);
      errors = 0;
    } catch (e) {
      if (signing) run.remarks.push(`signature call refused: ${errorText(e, "signature")}`);
      else if (errors === 0) run.remarks.push(`poll failed, retrying: ${errorText(e, "poll")}`);
      if (++errors >= 5) { run.error = errorText(e, "poll"); break; }
    }
  }
  if (!snap.done && !run.error) {
    run.error = `no final result after ${SCENARIO_TIMEOUT_MS / 1000}s (last status ${snap.status})`;
  }
  run.status = snap.status;
  run.result = snap.result;
  if (session) {
    run.statuses = timeline(session);
    run.prompts = dedupe(session.notificationEvents.map((n) => n.notificationType));
  }
}

async function runSale(
  gw: DojoGateway,
  label: string,
  terminal: string,
  opts: {
    signature?: boolean;
    paymentIntentId?: string;
    cancelAtOnce?: boolean;
    sessionType?: "Sale" | "MatchedRefund" | "UnlinkedRefund";
  } = {},
): Promise<Run> {
  const t0 = Date.now();
  const run = newRun(label);

  try {
    const started = await startTerminalPayment(gw, {
      sessionType: opts.sessionType ?? "Sale",
      amount: AMOUNT,
      reference: `sandbox-${label}`.slice(0, 60),
      description: `Sandbox check: ${label}`,
      terminal,
      paymentIntentId: opts.paymentIntentId,
    });
    run.paymentIntentId = started.paymentIntentId;

    if (started.terminalId === null) {
      // An earlier attempt on this intent was already paid: no session was opened.
      run.alreadyPaid = true;
      run.status = started.snapshot.status;
      run.result = started.snapshot.result;
    } else if (started.terminalSessionId) {
      if (opts.cancelAtOnce) {
        try {
          await gw.cancelTerminalSession(started.terminalSessionId);
          run.remarks.push("cancel sent straight after the session opened");
        } catch (e) {
          run.remarks.push(`cancel refused: ${errorText(e, "cancel")}`);
        }
      }
      await follow(gw, run, started.terminalSessionId, started.snapshot, t0, opts.signature);
    }
  } catch (e) {
    run.status = "could not start";
    run.error = errorText(e, "create");
    run.paymentIntentId = e instanceof DojoStartError ? e.paymentIntentId : null;
  }

  run.seconds = Math.round((Date.now() - t0) / 100) / 10;
  return run;
}

async function waitForIntent(
  gw: DojoGateway,
  id: string,
  done: (pi: DojoPaymentIntent) => boolean,
): Promise<DojoPaymentIntent> {
  let pi = await gw.getPaymentIntent(id);
  for (let i = 0; i < 15 && !done(pi); i++) {
    await sleep(POLL_MS);
    pi = await gw.getPaymentIntent(id);
  }
  return pi;
}

/** A fresh approved sale, for the sections that need one. */
async function approvedSale(gw: DojoGateway, label: string): Promise<Run | null> {
  const run = await runSale(gw, label, "VCMSEEKSIP0");
  if (run.result) return run;
  check(false, `couldn't get an approved sale (${label}): ${describeRun(run)}`);
  return null;
}

/** Lists the account's terminals; returns their TIDs, or null if we can't go on. */
async function connection(gw: DojoGateway): Promise<Set<string> | null> {
  console.log("── Connection ──");
  try {
    const terminals = await gw.listTerminals(false);
    check(true, `API key accepted; ${terminals.length} terminal(s) on the account`);
    for (const t of terminals) console.log(`      ${t.properties?.tid ?? "(no tid)"}  ${t.id}  ${t.status}`);

    const tids = new Set(terminals.map((t) => (t.properties?.tid ?? "").toUpperCase()).filter((tid) => tid !== ""));
    const missing = MACHINES.filter((m) => !tids.has(m.tid)).map((m) => m.tid);
    if (missing.length === MACHINES.length && terminals.length > 0) {
      check(false, "no terminal has a TID where we read it (properties.tid); the first one as Dojo sent it:");
      console.log(`      ${JSON.stringify(terminals[0])}`);
      return null;
    }
    if (missing.length === 0) {
      check(true, "all 9 virtual terminals found by TID");
    } else {
      console.log(`  ! not on this account: ${missing.join(", ")} (skipped below)`);
      dojoQuestions.push(`Please add ${missing.join(", ")} to our sandbox account; it's on the list of virtual terminals you sent.`);
    }
    return tids;
  } catch (e) {
    check(false, `couldn't list terminals: ${errorText(e, "terminals")}`);
    return null;
  }
}

async function machines(gw: DojoGateway, onAccount: Set<string>): Promise<void> {
  console.log("\n── Each virtual terminal (a £10.00 sale) ──");
  for (const m of MACHINES) {
    if (!onAccount.has(m.tid)) {
      console.log(`  - ${m.tid}: skipped, not on the account`);
      continue;
    }
    const run = await runSale(gw, m.tid, m.tid, { signature: m.signature });
    report(run, m.expect);
    if (m.tid === "VCMSEEKSIP1" && run.result) {
      check((run.result.tipAmount ?? 0) > 0, `the tip added on the machine is recorded (£${(run.result.tipAmount ?? 0).toFixed(2)})`);
    }
  }
}

async function signature(gw: DojoGateway): Promise<void> {
  console.log("\n── Signature rejected by staff ──");
  report(await runSale(gw, "VCMSEEKSIS0, rejected", "VCMSEEKSIS0", { signature: false }), "rejected");

  console.log("\n── VCMSEEKDIS0 (\"declined signature\"): staff decide, as on SIS0 ──");
  report(await runSale(gw, "VCMSEEKDIS0, accepted", "VCMSEEKDIS0", { signature: true }), "paid");
  report(await runSale(gw, "VCMSEEKDIS0, rejected", "VCMSEEKDIS0", { signature: false }), "rejected");
}

async function retry(gw: DojoGateway): Promise<void> {
  console.log("\n── Retry after a decline reuses the payment intent ──");
  const first = await runSale(gw, "VCMSEEKDIP0, 1st try", "VCMSEEKDIP0");
  report(first, "declined");
  if (!first.paymentIntentId) return;
  const again = await runSale(gw, "VCMSEEKDIP0, retry", "VCMSEEKDIP0", { paymentIntentId: first.paymentIntentId });
  check(!again.error && again.paymentIntentId === first.paymentIntentId,
    `Dojo accepts a new session on the same intent${again.error ? `: ${again.error}` : ""}`);
  const other = await runSale(gw, "another card", "VCMSEEKSIP0", { paymentIntentId: first.paymentIntentId });
  check(!!other.result && other.paymentIntentId === first.paymentIntentId,
    `a later attempt is approved on that same intent${other.error ? `: ${other.error}` : ""}`);
}

async function paid(gw: DojoGateway): Promise<void> {
  console.log("\n── Retry of a payment that already went through ──");
  const sale = await approvedSale(gw, "sale to retry");
  if (!sale?.result) return;
  const again = await runSale(gw, "retry after paid", "VCMSEEKSIP0", { paymentIntentId: sale.result.paymentIntentId });
  check(again.alreadyPaid && again.result?.authCode === sale.result.authCode,
    again.alreadyPaid
      ? `reported as paid with the original approval (auth ${again.result?.authCode}); no second charge started`
      : `expected "already paid", got ${describeRun(again)}`);
}

async function cancel(gw: DojoGateway): Promise<void> {
  console.log("\n── Cancel from the POS straight away ──");
  const run = await runSale(gw, "VCMSEEKSIP0, cancel", "VCMSEEKSIP0", { cancelAtOnce: true });
  const tooLate = run.remarks.some((r) => r.includes("cancel_too_late"));
  check(matches(run, "canceled") || (tooLate && !!run.result),
    tooLate ? `cancel was too late and the payment carried on: ${describeRun(run)}` : describeRun(run));
  details(run);
}

async function busy(gw: DojoGateway): Promise<void> {
  console.log("\n── Busy machine (two sales at once on VCMSEEKSCN0) ──");
  const t0 = Date.now();
  try {
    const held = await startTerminalPayment(gw, { sessionType: "Sale", amount: AMOUNT, reference: "sandbox-busy-1", terminal: "VCMSEEKSCN0" });
    const second = await runSale(gw, "second sale", "VCMSEEKSCN0");
    check(second.error?.includes("terminal_busy") ?? false,
      second.error ? `the second sale is refused: ${second.error}` : `not refused: Dojo ran a second session (${describeRun(second)})`);
    if (held.terminalSessionId) await follow(gw, newRun("first sale"), held.terminalSessionId, held.snapshot, t0);
  } catch (e) {
    check(false, `couldn't start the first sale: ${errorText(e, "create")}`);
  }
}

async function unknown(gw: DojoGateway): Promise<void> {
  console.log("\n── Unknown machine ──");
  const run = await runSale(gw, "unknown terminal id", "tm_sandbox_000000000000000000000000");
  check(!!run.error, run.error ? `refused: ${run.error}` : `accepted?! ${describeRun(run)}`);
}

async function wrongKey(gw: DojoGateway): Promise<void> {
  console.log("\n── Wrong API key ──");
  const realKey = process.env.DOJO_API_KEY ?? "";
  process.env.DOJO_API_KEY = `${realKey}x`;
  try {
    await gw.listTerminals(false);
    check(false, "a wrong key was accepted");
  } catch (e) {
    const err = e instanceof DojoApiError ? e : null;
    check(!!err && describeDojoError(err, "terminals").code === "auth", `refused: ${errorText(e, "terminals")}`);
  } finally {
    process.env.DOJO_API_KEY = realKey;
  }
}

/** Dojo's processing failure for API refunds of terminal payments on the sandbox. */
const SANDBOX_REFUND_FAILURE = "Your refund request was not successful";

/**
 * Refunds. The payment intent refund is Dojo's recommended method; on the
 * sandbox it fails for terminal payments, and Dojo confirmed (2026-10-13) that
 * this is a sandbox limitation and a correct request is enough for
 * accreditation. So here it must reach Dojo's processing and fail only there:
 * any other error means our request is wrong. Card-present refunds work on the
 * sandbox; a matched refund carries the amount so the intent shows Refunded.
 */
async function refunds(gw: DojoGateway): Promise<void> {
  console.log("\n── Refund without the card (payment intent refund, Dojo's recommended method) ──");
  const remote = await approvedSale(gw, "sale to refund remotely");
  if (remote?.result) {
    const pi = remote.result.paymentIntentId;
    try {
      await gw.createRefund({ paymentIntentId: pi, amount: 300, refundReason: "Sandbox check", idempotencyKey: randomUUID() });
      const part = await waitForIntent(gw, pi, (i) => (i.refundedAmount ?? 0) >= 300);
      check(part.status === "Captured", `£3.00 refunded: intent ${part.status}, refundedAmount ${part.refundedAmount ?? 0}`);
      await gw.createRefund({ paymentIntentId: pi, amount: 700, refundReason: "Sandbox check", idempotencyKey: randomUUID() });
      const full = await waitForIntent(gw, pi, (i) => i.status === "Refunded");
      check(full.status === "Refunded", `the remaining £7.00 refunded: intent ${full.status}`);
    } catch (e) {
      const text = errorText(e, "refund");
      check(text.includes(SANDBOX_REFUND_FAILURE),
        text.includes(SANDBOX_REFUND_FAILURE)
          ? `request accepted, then failed at processing as Dojo said it does on the sandbox: ${text}`
          : `refused for another reason, so our request may be wrong: ${text}`);
    }
  }

  console.log("\n── Refunds on the card machine (customer and card present) ──");
  const sale = await approvedSale(gw, "sale to refund on the machine");
  if (sale?.result) {
    const pi = sale.result.paymentIntentId;
    const matched = await runSale(gw, "matched refund of that sale", "VCMSEEKSIP0", { sessionType: "MatchedRefund", paymentIntentId: pi });
    check(!matched.error && matched.status === "Captured", `matched refund: ${matched.error ?? `${matched.status} in ${matched.seconds}s`}`);
    details(matched);
    const after = await waitForIntent(gw, pi, (i) => i.status === "Refunded");
    check(after.status === "Refunded",
      `the sale's payment intent then shows ${after.status}, refundedAmount ${after.refundedAmount ?? 0}`);
  }
  const unlinked = await runSale(gw, "unlinked refund (£10.00)", "VCMSEEKSIP0", { sessionType: "UnlinkedRefund" });
  check(!unlinked.error && unlinked.status === "Captured", `unlinked refund: ${unlinked.error ?? `${unlinked.status} in ${unlinked.seconds}s`}`);
  details(unlinked);
}

async function main(): Promise<void> {
  const cfg = dojoConfig();
  if (!cfg.apiKey.startsWith("sk_sandbox_")) {
    console.error("Put a Dojo SANDBOX key in app/.env.local:  DOJO_API_KEY=sk_sandbox_…");
    console.error("This script only runs against the sandbox.");
    process.exit(2);
  }
  const asked = process.argv.slice(2);
  const unknownSections = asked.filter((a) => !(SECTIONS as readonly string[]).includes(a));
  if (unknownSections.length) {
    console.error(`Unknown section(s): ${unknownSections.join(", ")}. Choose from: ${SECTIONS.join(", ")}.`);
    process.exit(2);
  }
  const wants = (s: Section) => asked.length === 0 || asked.includes(s);

  console.log(`Dojo sandbox check: ${cfg.baseUrl}, API version ${cfg.version}, software-house-id ${cfg.softwareHouseId}`);
  console.log("Real calls to Dojo's sandbox; no real money moves.\n");

  const gw = createDojoClient();
  const onAccount = await connection(gw);
  if (!onAccount) {
    console.log(`\nStopped: fix the connection first. ${failures} check(s) failed.`);
    process.exit(1);
  }
  if (wants("machines")) await machines(gw, onAccount);
  if (wants("signature")) await signature(gw);
  if (wants("retry")) await retry(gw);
  if (wants("paid")) await paid(gw);
  if (wants("cancel")) await cancel(gw);
  if (wants("busy")) await busy(gw);
  if (wants("unknown")) await unknown(gw);
  if (wants("wrongkey")) await wrongKey(gw);
  if (wants("refunds")) await refunds(gw);

  if (dojoQuestions.length) {
    console.log("\nAsk Dojo:");
    for (const q of dojoQuestions) console.log(`  - ${q}`);
  }
  console.log(failures === 0 ? "\nAll must-pass checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
