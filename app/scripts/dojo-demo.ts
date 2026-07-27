/**
 * Dojo mock demo — drives the whole Pay-at-Counter flow with NO Dojo account,
 * key, hardware, or running server. Proves the state machine + our snapshot
 * mapping end-to-end against the in-memory mock (lib/dojo/mock.ts), exercising
 * every outcome via the virtual-terminal id suffixes (Dojo-style).
 *
 * Run:  npm run dojo:demo   (from app/)   — uses tsx, no build needed.
 */

import { createDojoMock } from "../src/lib/dojo/mock";
import { resolveSnapshot } from "../src/lib/dojo/gateway";
import type { DojoGateway } from "../src/lib/dojo/gateway";
import type { DojoSessionSnapshot } from "../src/lib/dojo/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runSale(gw: DojoGateway, terminalId: string, label: string): Promise<void> {
  console.log(`\n═══ ${label}  (terminal ${terminalId}) ═══`);

  const pi = await gw.createPaymentIntent({
    amount: { value: 1250, currencyCode: "GBP" },
    reference: label,
    captureMode: "Auto",
  });
  console.log(`  → created payment intent ${pi.id} (£12.50)`);

  const session = await gw.createTerminalSession({
    terminalId, sessionType: "Sale", paymentIntentId: pi.id,
  });
  console.log(`  → opened terminal session ${session.id} [${session.status}]`);

  let snap: DojoSessionSnapshot = await resolveSnapshot(gw, session);
  let guard = 0;
  while (!snap.done && guard++ < 25) {
    await sleep(150); // mimic the ~1s POS poll cadence, sped up
    const s = await gw.getTerminalSession(session.id);
    if (s.status === "SignatureVerificationRequired") {
      console.log(`     · signature required → accepting`);
      await gw.submitSignature(session.id, true);
    }
    snap = await resolveSnapshot(gw, await gw.getTerminalSession(session.id));
    const note = snap.latestNotification ? ` — "${snap.latestNotification}"` : "";
    console.log(`     · status ${snap.status}${note}`);
  }

  if (snap.result) {
    console.log(`  ✅ SUCCESS — txn ${snap.result.transactionId}, auth ${snap.result.authCode}, ` +
      `${snap.result.cardScheme} ****${snap.result.cardLast4}`);
  } else {
    console.log(`  ⛔ ${snap.status} — ${snap.message ?? "(no message)"}`);
  }
}

async function runRefund(gw: DojoGateway): Promise<void> {
  console.log(`\n═══ Server-side refund ═══`);
  const pi = await gw.createPaymentIntent({ amount: { value: 1250, currencyCode: "GBP" }, reference: "refund-me", captureMode: "Auto" });
  // Capture it first via a successful terminal sale.
  const s = await gw.createTerminalSession({ terminalId: "tm_mock_success_SIP0", sessionType: "Sale", paymentIntentId: pi.id });
  for (let i = 0; i < 5; i++) { const cur = await gw.getTerminalSession(s.id); if (cur.status === "Captured") break; }
  const refund = await gw.createRefund({ paymentIntentId: pi.id, amount: 1250, refundReason: "Demo", idempotencyKey: "demo-1" });
  const after = await gw.getPaymentIntent(pi.id);
  console.log(`  → refund ${refund.refundId}; intent now ${after.status}`);
}

async function main(): Promise<void> {
  const gw = createDojoMock();
  const terminals = await gw.listTerminals(true);
  console.log(`Available mock terminals: ${terminals.map((t) => t.id).join(", ")}`);

  await runSale(gw, "tm_mock_success_SIP0", "Successful sale");
  await runSale(gw, "tm_mock_declined_DIP0", "Declined sale");
  await runSale(gw, "tm_mock_expired_TIP0", "Expired sale");
  await runSale(gw, "tm_mock_signature_SIS0", "Signature-verification sale");
  await runRefund(gw);

  console.log(`\nDone. This is exactly the flow the POS runs against DOJO_MODE=mock,`);
  console.log(`and the same one the real sandbox runs once DOJO_MODE=live + a key is set.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
