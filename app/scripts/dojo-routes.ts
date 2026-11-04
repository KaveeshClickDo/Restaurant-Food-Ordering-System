/**
 * Dojo route check — drives the card machine routes the way the tablet does,
 * against Dojo's real sandbox (virtual terminals). Complements dojo:sandbox,
 * which calls the payment logic (lib/dojo/flow.ts) directly.
 *
 * It starts a local HTTP server that hands requests straight to the shared
 * route handlers (lib/dojo/sessionHandlers), skipping only the login gate each
 * route has (the till's routes act as for a POS login, which may key in a
 * card), and calls it with the tablet's own request helper
 * (lib/dojo/posApi), polling like useDojoTerminal. So it tests: tablet helper →
 * route handlers → payment logic → Dojo, and the answers the screens read.
 *
 * The admin switch is read from the database; a stand-in database here
 * answers that one query, so no real database is touched and the switch can
 * be turned off. Needs only DOJO_* settings with a sandbox key.
 *
 * Run:  npm run dojo:routes   (from app/; about 4 minutes)
 * Exits with code 1 if a check fails. Never prints the key.
 */

// First: the stand-in database, set before any app code reads its settings.
import { STAND_IN_DB_PORT as DB_PORT } from "./dojo-routes-env";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  handleCreateSession, handleGetSession, handleSignSession, handleCancelSession, handleListTerminals,
} from "../src/lib/dojo/sessionHandlers";
import {
  createDojoSession, getDojoSession, signDojoSession, cancelDojoSession, listDojoTerminals,
  type CreateDojoSessionBody, type DojoRequestError, type DojoScope,
} from "../src/lib/dojo/posApi";
import { createDojoClient } from "../src/lib/dojo/client";
import { dojoConfig } from "../src/lib/dojo/config";
import { posSaleReference } from "../src/lib/posSaleRef";
import { uuid } from "../src/lib/uuid";
import type { DojoSessionSnapshot } from "../src/lib/dojo/types";

const POLL_MS = 1200; // the tablet's rate
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures += 1;
}
const dojo = createDojoClient();

// ── Stand-in database: answers the admin switch query (app_settings) ────────
let adminEnabled = true;
let dbQueries = 0;
function startDb(): Promise<http.Server> {
  const db = http.createServer((req, res) => {
    dbQueries += 1;
    const row = { data: { dojoTerminal: { enabled: adminEnabled } } };
    const single = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(single ? row : [row]));
  });
  return new Promise((resolve) => db.listen(DB_PORT, "127.0.0.1", () => resolve(db)));
}

// ── Local server: the route handlers, without the login gate ────────────────
function startServer(): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const request = new Request(url, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks).toString("utf8"),
    });
    // The handlers take a NextRequest but only read its JSON body.
    const asNext = request as unknown as Parameters<typeof handleCreateSession>[0];
    let out: Response;
    const m = url.pathname.match(/^\/api\/(pos|waiter)\/dojo\/(sessions|terminals)(?:\/([^/]+)(?:\/(signature|cancel))?)?$/);
    if (!m) out = Response.json({ ok: false, error: "no route" }, { status: 404 });
    else if (m[2] === "terminals") out = await handleListTerminals(url.searchParams.get("available") === "1");
    else {
      const id = m[3] ? decodeURIComponent(m[3]) : "";
      const action = m[4];
      if (!id && req.method === "POST") out = await handleCreateSession(asNext, { allowKeyed: m[1] === "pos" });
      else if (id && !action && req.method === "GET") out = await handleGetSession(id);
      else if (id && action === "signature" && req.method === "PUT") out = await handleSignSession(asNext, id);
      else if (id && action === "cancel" && req.method === "PUT") out = await handleCancelSession(id);
      else out = Response.json({ ok: false, error: "method" }, { status: 405 });
    }
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(await out.text());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ── Tablet-like driving ─────────────────────────────────────────────────────
interface Outcome {
  snap: DojoSessionSnapshot | null;
  /** Every status the tablet saw, in order. */
  seen: string[];
  seconds: number;
  notes: string[];
  error?: DojoRequestError;
  paymentIntentId: string | null;
  terminalSessionId: string | null;
  terminalId: string | null;
  test?: boolean;
}

async function pay(
  body: CreateDojoSessionBody & Record<string, unknown>,
  opts: { scope?: DojoScope; sign?: boolean; cancelAtOnce?: boolean; cancelAfterCard?: boolean } = {},
): Promise<Outcome> {
  const t0 = Date.now();
  const notes: string[] = [];
  const seen: string[] = [];
  const saw = (s: DojoSessionSnapshot) => {
    const label = s.done ? `${s.status} (done${s.result ? ", paid" : ""})` : s.status;
    if (seen[seen.length - 1] !== label) seen.push(label);
  };
  const scope = opts.scope ?? "pos";
  let started;
  try {
    started = await createDojoSession(body, scope);
  } catch (e) {
    const err = e as DojoRequestError;
    return { snap: null, seen, seconds: 0, notes, error: err, paymentIntentId: err.paymentIntentId ?? null, terminalSessionId: null, terminalId: null };
  }
  let snap = started.snapshot;
  saw(snap);
  const id = started.terminalSessionId;
  let signed = false;
  let cancelSent = false;
  const sendCancel = async (why: string) => {
    cancelSent = true;
    try {
      snap = (await cancelDojoSession(id!, scope)).snapshot;
      saw(snap);
      notes.push(`cancel ${why}: accepted (${snap.status})`);
    } catch (e) {
      const err = e as DojoRequestError;
      notes.push(`cancel ${why}: refused, code ${err.code} (HTTP ${err.httpStatus})`);
    }
  };
  if (id && opts.cancelAtOnce) await sendCancel("straight away");
  let errors = 0;
  while (id && !snap.done && Date.now() - t0 < 200_000) {
    await sleep(POLL_MS);
    try {
      if (snap.status === "SignatureVerificationRequired" && opts.sign !== undefined && !signed) {
        signed = true;
        snap = (await signDojoSession(id, opts.sign, scope)).snapshot;
        saw(snap);
        continue;
      }
      snap = (await getDojoSession(id, scope)).snapshot;
      saw(snap);
      errors = 0;
      if (opts.cancelAfterCard && !cancelSent && snap.latestNotification && snap.latestNotification !== "PresentCard") {
        await sendCancel(`once the card was in (prompt "${snap.latestNotification}")`);
      }
    } catch (e) {
      notes.push(`poll error: ${(e as Error).message}`);
      if (++errors >= 8) break;
    }
  }
  return {
    snap, seen, seconds: Math.round((Date.now() - t0) / 100) / 10, notes,
    paymentIntentId: started.paymentIntentId, terminalSessionId: started.terminalSessionId,
    terminalId: started.terminalId, test: started.test,
  };
}

const describe = (o: Outcome) => o.error
  ? `could not start: code ${o.error.code}, HTTP ${o.error.httpStatus}, "${o.error.message}"`
  : `${o.snap?.status} in ${o.seconds}s${o.snap?.result ? `, auth ${o.snap.result.authCode}` : ""}`;
const show = (o: Outcome) => {
  if (o.seen.length) console.log(`      tablet saw: ${o.seen.join(" → ")}`);
  for (const n of o.notes) console.log(`      ${n}`);
};
/** Exactly one snapshot claimed the payment was over, and it was the last. */
const settledOnce = (o: Outcome) =>
  o.seen.filter((s) => s.includes("(done")).length === 1 && (o.seen[o.seen.length - 1] ?? "").includes("(done");

async function main(): Promise<void> {
  if (!dojoConfig().apiKey.startsWith("sk_sandbox_")) {
    console.error("Put a Dojo SANDBOX key in app/.env.local (DOJO_API_KEY=sk_sandbox_…). This script only runs against the sandbox.");
    process.exit(2);
  }
  if (!dojoConfig().softwareHouseId) {
    console.error("Put our software-house-id in app/.env.local (DOJO_SOFTWARE_HOUSE_ID=…, see example.env).");
    process.exit(2);
  }
  const db = await startDb();
  const server = await startServer();
  process.env.NEXT_PUBLIC_API_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  console.log("Dojo route check: tablet helper → route handlers → Dojo sandbox (login gate skipped).\n");

  console.log("── The machine picker's list ──");
  const list = await listDojoTerminals();
  const tids = list.terminals.map((t) => t.tid);
  check(list.test && ["VCMSEEKSIP0", "VCMSEEKSCN0", "VCMSEEKSIS0", "VCMSEEKDIP0"].every((t) => tids.includes(t)),
    `${list.terminals.length} machines with their status, test flag ${list.test}`);

  console.log("\n── Till sale, as the till sends it ──");
  const tillRef = posSaleReference(uuid());
  const till = await pay({ amount: 10, reference: tillRef, description: tillRef, terminalId: "VCMSEEKSIP0" });
  show(till);
  check(!till.error && settledOnce(till) && !!till.snap?.result?.authCode && till.test === true, `${tillRef}: ${describe(till)}`);
  check(dbQueries > 0, "the admin switch was read (from the stand-in database)");
  if (till.paymentIntentId) {
    const pi = await dojo.getPaymentIntent(till.paymentIntentId);
    check(pi.reference === tillRef && pi.amount.value === 1000 && pi.status === "Captured",
      `Dojo holds reference "${pi.reference}", £${(pi.amount.value / 100).toFixed(2)}, ${pi.status}`);
  }

  console.log("\n── A screen without a reference ──");
  const noRef = await pay({ amount: 10, terminalId: "VCMSEEKSCN0" });
  const noRefPi = noRef.paymentIntentId ? await dojo.getPaymentIntent(noRef.paymentIntentId) : null;
  check(!noRef.error && !!noRef.snap?.result && noRefPi?.reference === "Card sale", `${describe(noRef)}; Dojo holds "${noRefPi?.reference}"`);

  console.log("\n── A request trying to open a refund or a pre-auth ──");
  const sneaky = await pay(
    { amount: 10, reference: "dojo-routes sneaky", terminalId: "VCMSEEKSCN0", sessionType: "UnlinkedRefund", captureMode: "Manual" },
    { cancelAtOnce: true },
  );
  show(sneaky);
  const sneakySession = sneaky.terminalSessionId ? await dojo.getTerminalSession(sneaky.terminalSessionId) : null;
  const sneakyPi = sneaky.paymentIntentId ? await dojo.getPaymentIntent(sneaky.paymentIntentId) : null;
  check(sneakySession?.details?.sessionType === "Sale" && sneakyPi?.captureMode === "Auto",
    `opened as a ${sneakySession?.details?.sessionType} with ${sneakyPi?.captureMode} capture`);
  check(!sneaky.error && sneaky.snap?.status === "Canceled" && !sneaky.snap.result && settledOnce(sneaky),
    `cancel from the till before the card: ${describe(sneaky)}`);

  console.log("\n── Signature: accept, reject, and a late decision ──");
  const sigOk = await pay({ amount: 10, reference: "dojo-routes sig ok", terminalId: "VCMSEEKSIS0" }, { sign: true });
  check(!!sigOk.snap?.result?.authCode && settledOnce(sigOk), `VCMSEEKSIS0 accepted: ${describe(sigOk)}`);
  if (sigOk.terminalSessionId) {
    try {
      await signDojoSession(sigOk.terminalSessionId, false);
      check(false, "a late rejection was accepted");
    } catch (e) {
      const err = e as DojoRequestError;
      check(err.code === "rejected", `a late rejection is refused: code ${err.code} (HTTP ${err.httpStatus})`);
    }
  }
  const sigNo = await pay({ amount: 10, reference: "dojo-routes sig no", terminalId: "VCMSEEKDIS0" }, { sign: false });
  check(sigNo.snap?.status === "SignatureVerificationRejected" && !sigNo.snap.result, `VCMSEEKDIS0 rejected: ${describe(sigNo)}`);

  console.log("\n── Declined, the tablet's retry on another machine, then a retry after it's paid ──");
  const declined = await pay({ amount: 10, reference: "dojo-routes retry", terminalId: "VCMSEEKDIP0" });
  check(declined.snap?.status === "Declined" && !declined.snap.result, `VCMSEEKDIP0: ${describe(declined)}`);
  const retried = await pay({ amount: 10, reference: "dojo-routes retry", terminalId: "VCMSEEKSIP0", paymentIntentId: declined.paymentIntentId ?? undefined });
  check(!!retried.snap?.result && retried.paymentIntentId === declined.paymentIntentId, `same payment, another machine: ${describe(retried)}`);
  const again = await pay({ amount: 10, reference: "dojo-routes retry", terminalId: "VCMSEEKSIP0", paymentIntentId: declined.paymentIntentId ?? undefined });
  check(again.terminalId === null && !!again.snap?.done && again.terminalSessionId === retried.terminalSessionId,
    "retry after it was paid: no new charge, the paid session is reported");

  console.log("\n── Tip added on the machine ──");
  const tip = await pay({ amount: 10, reference: "dojo-routes tip", terminalId: "VCMSEEKSIP1" });
  check(tip.snap?.result?.tipAmount === 1 && tip.snap.result.totalAmount === 11, `VCMSEEKSIP1: ${describe(tip)}, tip £${tip.snap?.result?.tipAmount}`);

  console.log("\n── Busy and unknown machines ──");
  const held = await createDojoSession({ amount: 10, reference: "dojo-routes busy 1", terminalId: "VCMSEEKSIP0" });
  const second = await pay({ amount: 10, reference: "dojo-routes busy 2", terminalId: "VCMSEEKSIP0" });
  check(second.error?.code === "terminal_busy" && second.error.httpStatus === 409 && !!second.error.paymentIntentId,
    `second sale while the machine is busy: ${describe(second)}`);
  if (held.terminalSessionId) {
    try { await cancelDojoSession(held.terminalSessionId); } catch { /* it finishes by itself */ }
    for (let i = 0; i < 30; i++) { await sleep(POLL_MS); if ((await getDojoSession(held.terminalSessionId)).snapshot.done) break; }
  }
  const unknown = await pay({ amount: 10, reference: "dojo-routes unknown", terminalId: "VCMSEEKXXX0" });
  check(unknown.error?.code === "terminal_unavailable" && unknown.error.httpStatus === 404, `unknown TID: ${describe(unknown)}`);

  console.log("\n── Cancel after the card is in ──");
  const late = await pay({ amount: 10, reference: "dojo-routes late cancel", terminalId: "VCMSEEKSIP0" }, { cancelAfterCard: true });
  show(late);
  const finalPaid = !!late.snap?.done && !!late.snap.result;
  const finalCanceled = !!late.snap?.done && late.snap.status === "Canceled" && !late.snap.result;
  check(!late.error && (finalPaid || finalCanceled) && settledOnce(late), `one consistent final result: ${describe(late)}`);
  if (late.paymentIntentId) {
    const pi = await dojo.getPaymentIntent(late.paymentIntentId);
    check(finalPaid ? pi.status === "Captured" : pi.status !== "Captured", `matches the payment at Dojo (intent ${pi.status})`);
  }

  console.log("\n── Timed out on the machine (about 90 seconds) ──");
  const expired = await pay({ amount: 10, reference: "dojo-routes expired", terminalId: "VCMSEEKTIP0" });
  check(expired.snap?.status === "Expired" && !expired.snap.result && !!expired.snap.message, `VCMSEEKTIP0: ${describe(expired)}`);

  console.log("\n── The waiter's routes (same handlers) ──");
  const waiter = await pay({ amount: 10, reference: "Table 5 #ORD-ROUTES", terminalId: "VCMSEEKSCN0" }, { scope: "waiter" });
  check(!!waiter.snap?.result, `waiter sale: ${describe(waiter)}`);

  console.log("\n── Keyed payment (a phone booking's VIP fee) ──");
  const keyed = await pay({ amount: 10, reference: "VIP T5", terminalId: "VCMSEEKSIP0", cardHolderNotPresent: true });
  show(keyed);
  const keyedPi = keyed.paymentIntentId ? await dojo.getPaymentIntent(keyed.paymentIntentId) : null;
  check(!keyed.error && !!keyed.snap?.result && settledOnce(keyed) && keyedPi?.cardHolderNotPresent === true,
    `till: ${describe(keyed)}; Dojo holds it as card not present (${keyedPi?.cardHolderNotPresent})`);
  const waiterKeyed = await pay(
    { amount: 10, reference: "dojo-routes waiter keyed", terminalId: "VCMSEEKSCN0", cardHolderNotPresent: true },
    { scope: "waiter" },
  );
  check(waiterKeyed.error?.code === "rejected" && waiterKeyed.error.httpStatus === 403 && !waiterKeyed.error.paymentIntentId,
    `the waiter's routes refuse it before Dojo: ${describe(waiterKeyed)}`);

  console.log("\n── Admin switch turned off ──");
  adminEnabled = false;
  const off = await pay({ amount: 10, reference: "dojo-routes off", terminalId: "VCMSEEKSIP0" });
  check(off.error?.code === "disabled" && off.error.httpStatus === 503, `a new payment is refused before Dojo: ${describe(off)}`);
  if (waiter.terminalSessionId) {
    const poll = await getDojoSession(waiter.terminalSessionId).then((r) => r.snapshot.status, (e: Error) => `error: ${e.message}`);
    check(poll === "Captured", `a payment already under way can still be polled (${poll})`);
  }
  adminEnabled = true;

  console.log("\n── Bad requests ──");
  try {
    await createDojoSession({ amount: -5 });
    check(false, "a negative amount was accepted");
  } catch (e) {
    check((e as DojoRequestError).httpStatus === 400, `a negative amount is refused before Dojo (HTTP ${(e as DojoRequestError).httpStatus})`);
  }
  try {
    await getDojoSession("ts_sandbox_000000000000000000000000");
    check(false, "an unknown session was found");
  } catch (e) {
    const err = e as DojoRequestError;
    check(err.code === "rejected" && err.httpStatus >= 400 && err.httpStatus < 500, `polling an unknown session: code ${err.code} (HTTP ${err.httpStatus})`);
  }

  server.close();
  db.close();
  console.log(failures === 0 ? "\nAll route checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
