/**
 * Dojo sandbox check — runs the virtual-terminal scenarios against Dojo's real
 * sandbox (api.dojo.tech with an sk_sandbox_ key), through the same start
 * logic the POS routes use (lib/dojo/flow.ts). No app, database or POS login
 * needed: only DOJO_* settings in app/.env.local.
 *
 * Run:  npm run dojo:sandbox   (from app/)
 *
 * It refuses any key that isn't a sandbox key and never prints the key. It
 * prints what Dojo actually returns for each machine, so the simulator
 * (lib/dojo/mock.ts) can be kept in line, and exits with code 1 if a
 * must-pass check fails. Where the simulator only guessed Dojo's behaviour, a
 * difference is listed for updating the mock rather than counted as a failure.
 */

import { randomUUID } from "node:crypto";
import { createDojoClient, DojoApiError } from "../src/lib/dojo/client";
import { dojoConfig } from "../src/lib/dojo/config";
import { describeDojoError, type DojoOp } from "../src/lib/dojo/errors";
import { DojoStartError, startTerminalPayment } from "../src/lib/dojo/flow";
import { resolveSnapshot, type DojoGateway } from "../src/lib/dojo/gateway";
import type { DojoPaymentIntent, DojoSaleResult, DojoSessionSnapshot, DojoTerminalSession } from "../src/lib/dojo/types";

const AMOUNT = { value: 1000, currencyCode: "GBP" }; // £10.00, so a 10% tip is £1.00
const POLL_MS = 1000;
const SCENARIO_TIMEOUT_MS = 180_000;

type Expect = "paid" | "declined" | "expired" | "canceled" | "rejected";

const MACHINES: Array<{ tid: string; expect: Expect; signature?: boolean; guess?: boolean }> = [
  { tid: "VCMSEEKSIP0", expect: "paid" },
  { tid: "VCMSEEKSCN0", expect: "paid" },
  { tid: "VCMSEEKSIS0", expect: "paid", signature: true },
  { tid: "VCMSEEKDIS0", expect: "declined", signature: true, guess: true },
  { tid: "VCMSEEKDIP0", expect: "declined" },
  { tid: "VCMSEEKUIP0", expect: "declined", guess: true },
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
const mockUpdates: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dedupe = (xs: string[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

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

function report(run: Run, expect: Expect, guess = false): void {
  const ok = matches(run, expect);
  if (guess && !ok && !run.error) {
    console.log(`  ! ${run.label}: ${describeRun(run)} (the simulator guessed ${expect})`);
    mockUpdates.push(`${run.label}: Dojo returned ${run.status}${run.result ? " with a payment" : ""}; the mock assumes ${expect}`);
  } else {
    check(ok, `${run.label}: ${describeRun(run)}`);
  }
  if (run.statuses.length) console.log(`      statuses: ${run.statuses.join(" → ")}`);
  if (run.prompts.length) console.log(`      prompts:  ${run.prompts.join(", ")}`);
  for (const r of run.remarks) console.log(`      ${r}`);
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
    try {
      if (snap.status === "SignatureVerificationRequired" && signature !== undefined && !signed) {
        signed = true;
        session = await gw.submitSignature(sessionId, signature);
      } else {
        session = await gw.getTerminalSession(sessionId);
      }
      snap = await resolveSnapshot(gw, session);
      errors = 0;
    } catch (e) {
      if (++errors >= 5) { run.error = errorText(e, "poll"); break; }
    }
  }
  if (!snap.done && !run.error) {
    run.error = `no final result after ${SCENARIO_TIMEOUT_MS / 1000}s (last status ${snap.status})`;
  }
  run.status = snap.status;
  run.result = snap.result;
  if (session) {
    run.statuses = dedupe(session.statusEvents.map((e) => e.status));
    run.prompts = dedupe(session.notificationEvents.map((n) => n.notificationType));
  }
}

async function runSale(
  gw: DojoGateway,
  label: string,
  terminal: string,
  opts: { signature?: boolean; paymentIntentId?: string; cancelAtOnce?: boolean } = {},
): Promise<Run> {
  const t0 = Date.now();
  const run: Run = {
    label, status: "", result: null, statuses: [], prompts: [], remarks: [],
    seconds: 0, error: null, paymentIntentId: null, alreadyPaid: false,
  };

  try {
    const started = await startTerminalPayment(gw, {
      sessionType: "Sale",
      amount: AMOUNT,
      reference: `sandbox-${label}`.slice(0, 60),
      description: `Sandbox check: ${label}`,
      terminal,
      paymentIntentId: opts.paymentIntentId,
    });
    run.paymentIntentId = started.paymentIntentId;

    if (!started.terminalSessionId) {
      // An earlier attempt on this intent was already paid: nothing was started.
      run.alreadyPaid = true;
      run.status = started.snapshot.status;
      run.result = started.snapshot.result;
    } else {
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

async function connection(gw: DojoGateway): Promise<boolean> {
  console.log("── Connection ──");
  try {
    const terminals = await gw.listTerminals(false);
    check(true, `API key accepted; ${terminals.length} terminal(s) on the account`);
    for (const t of terminals) console.log(`      ${t.properties?.tid ?? "(no tid)"}  ${t.id}  ${t.status}`);

    const tids = new Set(terminals.map((t) => t.properties?.tid?.toUpperCase()));
    const missing = MACHINES.filter((m) => !tids.has(m.tid));
    if (missing.length === MACHINES.length && terminals.length > 0) {
      check(false, "no terminal has a TID where we read it (properties.tid); the first one as Dojo sent it:");
      console.log(`      ${JSON.stringify(terminals[0])}`);
      return false;
    }
    check(missing.length === 0, missing.length === 0
      ? "all 9 virtual terminals found by TID"
      : `missing from the account: ${missing.map((m) => m.tid).join(", ")}`);
    return true;
  } catch (e) {
    check(false, `couldn't list terminals: ${errorText(e, "terminals")}`);
    return false;
  }
}

async function machines(gw: DojoGateway): Promise<string | null> {
  console.log("\n── Each virtual terminal (a £10.00 sale) ──");
  let paidIntent: string | null = null;
  for (const m of MACHINES) {
    const run = await runSale(gw, m.tid, m.tid, { signature: m.signature });
    report(run, m.expect, m.guess);
    if (m.tid === "VCMSEEKSIP0" && run.result) paidIntent = run.result.paymentIntentId;
    if (m.tid === "VCMSEEKSIP1" && run.result) {
      check((run.result.tipAmount ?? 0) > 0, `the tip added on the machine is recorded (£${(run.result.tipAmount ?? 0).toFixed(2)})`);
    }
  }
  return paidIntent;
}

async function edgeCases(gw: DojoGateway, paidIntent: string | null): Promise<void> {
  console.log("\n── Signature rejected by staff ──");
  report(await runSale(gw, "VCMSEEKSIS0, rejected", "VCMSEEKSIS0", { signature: false }), "rejected");

  console.log("\n── Retry after a decline reuses the payment intent ──");
  const first = await runSale(gw, "VCMSEEKDIP0, 1st try", "VCMSEEKDIP0");
  report(first, "declined");
  if (first.paymentIntentId) {
    const retry = await runSale(gw, "VCMSEEKDIP0, retry", "VCMSEEKDIP0", { paymentIntentId: first.paymentIntentId });
    check(!retry.error && retry.paymentIntentId === first.paymentIntentId,
      `Dojo accepts a new session on the same intent${retry.error ? `: ${retry.error}` : ""}`);
    const other = await runSale(gw, "another card", "VCMSEEKSIP0", { paymentIntentId: first.paymentIntentId });
    check(!!other.result && other.paymentIntentId === first.paymentIntentId,
      `a later attempt is approved on that same intent${other.error ? `: ${other.error}` : ""}`);
  }

  console.log("\n── Retry of a payment that already went through ──");
  if (paidIntent) {
    const again = await runSale(gw, "retry after paid", "VCMSEEKSIP0", { paymentIntentId: paidIntent });
    check(again.alreadyPaid && !!again.result,
      again.alreadyPaid ? "reported as paid; no second charge started" : `expected "already paid", got ${describeRun(again)}`);
  } else {
    check(false, "needs the approved VCMSEEKSIP0 sale from above");
  }

  console.log("\n── Cancel from the POS straight away ──");
  const cancelled = await runSale(gw, "VCMSEEKSIP0, cancel", "VCMSEEKSIP0", { cancelAtOnce: true });
  const tooLate = cancelled.remarks.some((r) => r.includes("cancel_too_late"));
  check(matches(cancelled, "canceled") || (tooLate && !!cancelled.result),
    tooLate ? `cancel was too late and the payment carried on: ${describeRun(cancelled)}` : describeRun(cancelled));
  for (const r of cancelled.remarks) console.log(`      ${r}`);

  console.log("\n── Busy machine (two sales at once on VCMSEEKSCN0) ──");
  const t0 = Date.now();
  const holder: Run = {
    label: "first sale", status: "", result: null, statuses: [], prompts: [], remarks: [],
    seconds: 0, error: null, paymentIntentId: null, alreadyPaid: false,
  };
  try {
    const held = await startTerminalPayment(gw, { sessionType: "Sale", amount: AMOUNT, reference: "sandbox-busy-1", terminal: "VCMSEEKSCN0" });
    const second = await runSale(gw, "second sale", "VCMSEEKSCN0");
    check(second.error?.includes("terminal_busy") ?? false,
      second.error ? `the second sale is refused: ${second.error}` : `not refused: Dojo ran a second session (${describeRun(second)})`);
    if (held.terminalSessionId) await follow(gw, holder, held.terminalSessionId, held.snapshot, t0);
  } catch (e) {
    check(false, `couldn't start the first sale: ${errorText(e, "create")}`);
  }

  console.log("\n── Unknown machine ──");
  const unknown = await runSale(gw, "unknown terminal id", "tm_sandbox_000000000000000000000000");
  check(!!unknown.error, unknown.error ? `refused: ${unknown.error}` : `accepted?! ${describeRun(unknown)}`);

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

  console.log("\n── Server-side refunds (on a new approved sale) ──");
  const sale = await runSale(gw, "sale to refund", "VCMSEEKSIP0");
  if (!sale.result) {
    check(false, `couldn't get an approved sale to refund: ${describeRun(sale)}`);
    return;
  }
  const pi = sale.result.paymentIntentId;
  try {
    await gw.createRefund({ paymentIntentId: pi, amount: 300, refundReason: "Sandbox check", idempotencyKey: randomUUID() });
    const part = await waitForIntent(gw, pi, (i) => (i.refundedAmount ?? 0) >= 300);
    check(part.status === "Captured", `£3.00 refunded: intent ${part.status}, refundedAmount ${part.refundedAmount ?? 0}`);
    await gw.createRefund({ paymentIntentId: pi, amount: 700, refundReason: "Sandbox check", idempotencyKey: randomUUID() });
    const full = await waitForIntent(gw, pi, (i) => i.status === "Refunded");
    check(full.status === "Refunded", `the remaining £7.00 refunded: intent ${full.status}`);
  } catch (e) {
    check(false, `refund failed: ${errorText(e, "refund")}`);
  }
}

async function main(): Promise<void> {
  const cfg = dojoConfig();
  if (!cfg.apiKey.startsWith("sk_sandbox_")) {
    console.error("Put a Dojo SANDBOX key in app/.env.local:  DOJO_API_KEY=sk_sandbox_…");
    console.error("This script only runs against the sandbox.");
    process.exit(2);
  }
  console.log(`Dojo sandbox check: ${cfg.baseUrl}, API version ${cfg.version}, software-house-id ${cfg.softwareHouseId}`);
  console.log("Real calls to Dojo's sandbox; no real money moves.\n");

  const gw = createDojoClient();
  if (!(await connection(gw))) {
    console.log(`\nStopped: fix the connection first. ${failures} check(s) failed.`);
    process.exit(1);
  }
  const paidIntent = await machines(gw);
  await edgeCases(gw, paidIntent);

  if (mockUpdates.length) {
    console.log("\nUpdate the simulator (lib/dojo/mock.ts) to match:");
    for (const u of mockUpdates) console.log(`  - ${u}`);
  }
  console.log(failures === 0 ? "\nAll must-pass checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
