# Dojo card terminal — how it works in this app

Status: **built, and tested on Dojo's sandbox.** All nine virtual terminals on our
account pass (2026-10-20, run again after a second review on 2026-10-21), along
with the go-live edge cases. Before the
accreditation session (UAT) with Dojo, two things remain: the refund screen, and
an end-to-end test of the till screens. See §9.

API facts: [dojo-integration-reference.md](./dojo-integration-reference.md)
(verified 2026-08-12 against the live docs **and** the OpenAPI spec, plus the
sandbox findings in §6a here).

Adding a sandbox key, then a production key, is **env-only — no code change**.

---

## 1. What it does

Turns the "Card" tender from a *manual record* (staff run a standalone machine,
then tap "Payment Received") into a *driven* payment: the till sends the amount,
the Dojo machine takes the card, and we store the real `transactionId` /
`authCode` / masked card against the order.

When the feature is off — the default — every surface behaves exactly as before.

---

## 2. The switch: two levels, both must be on

```
isDojoEffectivelyEnabled()  =  DOJO_MODE env master   AND   admin toggle
```

- **`DOJO_MODE`** (server env) is the master: `off` | `mock` | `live`.
- **Admin toggle** lives at **Admin → Integrations → Card Terminal**, stored in
  `app_settings.data.dojoTerminal.enabled`.

The admin toggle is **locked while the env is off** and can never turn the
feature on by itself. Either level off ⇒ the Dojo option disappears everywhere
and card reverts to manual. The session route enforces it too: with either level
off, a new payment can't be started, though one already under way can finish.

| `DOJO_MODE` | Key needed? | Behaviour |
|---|---|---|
| `off` (default) | no | hidden; manual card record, as today |
| `mock` | **no** | in-memory simulator; build and test every outcome with no Dojo account |
| `live` | **yes** | real `https://api.dojo.tech`; key prefix picks the environment (`sk_sandbox_` / `sk_prod_`) |

`live` without `DOJO_API_KEY` falls back to `off` — it never pretends to be live.
The API address is fixed in code (`config.ts`), so a typo can't send the key
elsewhere.

**Secrets are server-side only.** `DOJO_API_KEY` / `DOJO_WEBHOOK_SECRET` must
never be `NEXT_PUBLIC_` and never appear in `.env.capacitor`. The APK only calls
our own routes.

---

## 3. Where staff see it

When effectively enabled, choosing **Card** offers **"Card machine (Dojo)"** vs
**"Other"** on:

| Surface | Component | Flag comes from |
|---|---|---|
| POS till sale | `SaleView` → `PaymentModal` | `/api/pos/dojo/config` |
| POS collection tab + `/collection` app | `CollectionView`, `collection/page.tsx` → `PaymentModal` | `/api/collection/auth` |
| **Waiter** table settle | `BillView` | `/api/waiter/config` |
| POS gift-card sale | `SellGiftCardModal` | `/api/pos/dojo/config` |
| POS reservation / VIP fee | `ReservationsView` | `/api/pos/dojo/config` |

Untouched by design: the customer website (Stripe) and admin bill settle.

One shared component, `components/pos/DojoChargePanel.tsx`, renders the entire
driven flow (present card → PIN → signature → settle) for all five.

---

## 4. Runtime flow

```
DojoChargePanel ─▶ POST   /api/{pos|waiter}/dojo/sessions        create intent + open session
      │ poll 1.2s ▶ GET    /api/{pos|waiter}/dojo/sessions/{id}   until settled
      │ signature ▶ PUT    …/sessions/{id}/signature {accepted}
      │ cancel    ▶ PUT    …/sessions/{id}/cancel
      ▼ on success
the surface's own settle call ─▶ recordDojoPayment(...) ─▶ dojo_payments row
```

- **All Dojo calls are server-side** (route → `lib/dojo` gateway → Dojo). Card
  data never touches the tablet: no native SDK, no PCI scope on the device.
- `useDojoTerminal` drives the client state machine: `starting → processing →
  [signature] → success | declined | expired | canceled | error`, showing the
  terminal's own prompts to staff.
- **Expired** ⇒ result unknown ⇒ offer "Record as paid" or "Retry" (Dojo
  mandates this). Before showing it, the server checks the payment intent: if
  Dojo shows the money was taken, the sale completes as paid instead.
  **Declined** ⇒ Retry / Back. **Signature** ⇒ Accept / Reject, with Dojo
  auto-accepting after 80s.
- **Retry reuses the payment intent** (Dojo's checklist). The server first checks
  whether the earlier attempt for the same amount actually went through, and if
  so reports it as paid rather than charging again (`lib/dojo/flow.ts`). An
  earlier intent for a different amount is never reused.
- **Cancel** asks Dojo and keeps polling until Dojo reports `Canceled`. Once the
  card is in, Dojo refuses (422): staff see "too late to cancel" and the payment's
  real outcome still arrives. A payment screen can't be closed while a payment is
  live (`onActiveChange`); if it unmounts anyway, the hook cancels the session.
- **Errors before a payment starts** show a "Couldn't start" screen with a plain
  message (`lib/dojo/errors.ts`) and no "Record as paid". It says "Nothing was
  charged" only when Dojo refused before any session began (wrong API key,
  unknown or offline terminal, a request Dojo rejected, or the switch is off).
  For a busy machine, a timeout or an unexpected error it tells staff to check
  the machine's screen, because the machine may be showing an earlier try of
  the same payment.
- **Sales only:** the payment routes start sales with automatic capture and
  nothing else. A `sessionType` or `captureMode` in the request body is dropped,
  so no screen can open a refund or a pre-auth through them.
- **Timeouts:** each call to Dojo gives up after 15s, which counts as a network
  problem (result unknown). The tablet waits up to 20s for a poll, signature or
  cancel, and 90s to start a payment. Starting can take up to four Dojo calls,
  so the tablet's limit is longer than the server's: it never gives up on a
  session the server did open.
- **Test mode:** on the simulator or a sandbox key, the payment screen shows a
  "Test mode — no real money moves" badge (the start response carries `test`).

### Surface boundary

The `/waiter` app must only call `/api/waiter/*`. So the waiter has its own
`/api/waiter/dojo/sessions[...]` routes gated on a **waiter** session, while the
POS family uses `/api/pos/dojo/*` gated on a **POS or collection** session
(`getTillStaffSession` in `lib/auth.ts`); kitchen, driver and admin logins can't
drive the machine. Both are thin auth wrappers over the same
`lib/dojo/sessionHandlers.ts`, so the flows cannot drift. The client picks its
routes with `<DojoChargePanel scope="waiter" />`.

---

## 5. Persistence

Every surface writes one row to **`dojo_payments`** via
`recordDojoPayment({ result, sourceType, sourceId, amount, staffId })`, where
`sourceType` ∈ `pos_sale | collection | dine_in | gift_card | reservation` and
`amount` is what the server worked out for the sale.

The result comes from the till, so `recordDojoPayment` reads the payment intent
back from Dojo and stores **Dojo's** status, card, tip and total. A payment Dojo
doesn't show as taken, or a charge that differs from the sale, is logged. If Dojo
can't be read, the till's copy is stored rather than losing the record.

One central table keeps "all card-machine takings" reporting and refund lookup in
one place instead of `dojo_*` columns spread across five tables. (An earlier
iteration did the latter; `schema.sql` drops those columns idempotently.)

The webhook reconciles `dojo_payments.status` and dedupes via `dojo_events`; if
the update fails it un-marks the event and returns 500, so Dojo's retry applies
it. The refund route also updates the status after a refund.

Apply with `cd app && npm run db:migrate` — idempotent, safe to re-run.

---

## 6. Test it now (no Dojo account)

```bash
cd app
npm run dojo:demo        # every terminal + retry, cancel, busy, timeouts, refunds, webhook signatures; exits 1 on a failure
```

In the UI: set `DOJO_MODE=mock`, `npm run dev`, open `/pos` or `/waiter`, take a
card payment. The mock's terminals copy the virtual terminals Dojo set up on our
sandbox account, with the same TIDs. Pin one with `DOJO_TERMINAL_ID`, which takes
a TID or a Dojo terminal id (`tm_…`), so the same value works in mock and live:

| `DOJO_TERMINAL_ID` | Outcome (as the sandbox returns it) |
|---|---|
| `VCMSEEKSIP0` | chip & PIN, approved (`Captured`) |
| `VCMSEEKSCN0` | contactless with device verification, approved |
| `VCMSEEKSIS0` | signature check: accept → approved (session stays `SignatureVerificationAccepted`), reject → `SignatureVerificationRejected` |
| `VCMSEEKDIS0` | same as SIS0 — the staff decision decides |
| `VCMSEEKDIP0` | `Declined` |
| `VCMSEEKUIP0` | "unsuccessful": ends `Canceled`, after the card prompts |
| `VCMSEEKTIP0` | timed out: `Expired` after about 90 seconds |
| `VCMSEEKCIP0` | cancelled on the machine: `Canceled`, after the card prompts |
| `VCMSEEKSIP1` | approved with a 10% tip (`tipsAmount`) |

### 6a. Sandbox results

`npm run dojo:sandbox` runs the same scenarios against Dojo's real sandbox. It
needs only `DOJO_API_KEY=sk_sandbox_…` in `app/.env.local`, refuses any other
key, and takes sections: `npm run dojo:sandbox -- refunds signature`.

What it shows (first run 2026-10-12; all nine terminals 2026-10-20; full re-run
2026-10-21):
- The key, the `softwareHouse1` id and the terminal TIDs (`properties.tid`) work.
  On 2026-10-21 the account also listed a tenth terminal, TID `62410185`,
  Offline. It isn't one of the virtual terminals; finding a machine
  automatically only ever picks an Available one, so it's skipped.
- Every terminal's outcome, signature accept/reject, retrying a declined card on
  the same intent, the already-paid check, cancel from the POS, a busy terminal
  (409), an unknown terminal (404) and a wrong key (401) behave as the code
  expects. VCMSEEKSIP1's £1.00 tip on £10.00 is recorded.
- **Refund by payment intent** (Dojo's recommended method) fails on the sandbox
  for terminal payments: "Your refund request was not successful. Status:
  Failed." Dojo confirmed (2026-10-13) this is a sandbox limitation and that a
  correct request is enough for accreditation, so the check requires the
  request to pass Dojo's validation and fail only there. A reversal fails too.
- **Matched refunds** (card present) work, but the intent is only marked
  `Refunded` when the request carries `amount`. The schema says it's optional;
  Dojo's own example sends it, and so do we (`client.ts`). Unlinked refunds work.
- A payment intent's `terminalSessionHistory` holds a copy of each session at
  every status change, oldest first (seen 2026-10-21). The already-paid check
  takes the latest successful sale session from it.

Dojo's other answers (2026-10-13): terminal gratuity is optional for
accreditation; the physical test device isn't needed for any checklist item.
Accreditation is booked through the "Partner UAT Session" link Dojo sent.

---

## 7. Going live

**Sandbox:** `DOJO_MODE=live`, `DOJO_API_KEY=sk_sandbox_…`, keep the dummy
`DOJO_SOFTWARE_HOUSE_ID=softwareHouse1`, and pin a virtual terminal by its TID
(e.g. `DOJO_TERMINAL_ID=VCMSEEKSIP0`). Restart after each change. Dojo's virtual
terminals give you every outcome without hardware.

**Production:** pass Dojo's UAT, which needs a working refund path: the refund
route (payment intent refund, Dojo's recommendation) is ready, the screen isn't
yet. Then `sk_prod_…` plus the Dojo-assigned `software-house-id`, and repoint
webhooks.

**Android POS needs no rebuild** for sandbox↔prod, because it is all server-side.
The APK only had to ship the UI once.

---

## 8. Files

**Core — `app/src/lib/dojo/`** (server-side unless noted)
`index.ts` (server entry point), `config.ts` (mode + env), `effectiveFlag.ts`
(env AND admin toggle), `select.ts` (mock or real client by `DOJO_MODE`),
`gateway.ts` (interface + snapshot/result mappers), `client.ts` (real HTTP),
`mock.ts` (simulator), `flow.ts` (starting a payment: terminal by TID, intent
reuse, already-paid check), `sessionHandlers.ts` (shared route logic),
`recordPayment.ts` (verified write to `dojo_payments`), `webhook.ts` (HMAC),
`errors.ts` (error types + staff messages), `respond.ts` (error→HTTP + minor
units), `types.ts`, `posApi.ts` (**client-side** fetchers, `apiBase()`-aware,
with timeouts). Request bodies: `lib/schemas/dojo.ts`. The POS-family login
check: `getTillStaffSession` in `lib/auth.ts`.

**Routes** — `api/pos/dojo/{config,terminals,sessions,sessions/[id],
sessions/[id]/signature,sessions/[id]/cancel,refunds,webhook}` and
`api/waiter/dojo/sessions{,/[id],/[id]/signature,/[id]/cancel}`;
`api/admin/dojo/status`. Settle routes that record a Dojo payment:
`api/pos/sales`, `api/waiter/settle`, `api/pos/orders/[id]/settle` and
`api/collection/orders/[id]/settle` (via `lib/collectionOrders.ts`),
`api/pos/gift-cards/[id]/activate`, `api/pos/reservations`.

**UI** — `components/pos/DojoChargePanel.tsx`, `useDojoTerminal.ts`,
`PaymentModal.tsx`, `SaleView.tsx`, `CollectionView.tsx`, `app/collection/page.tsx`,
`SellGiftCardModal.tsx`, `ReservationsView.tsx`,
`components/waiter/BillView.tsx`, `components/admin/IntegrationsPanel.tsx`.

**Checks** — `app/scripts/dojo-demo.ts` (simulator), `app/scripts/dojo-sandbox.ts`
(real sandbox).

**Schema** — `dojo_payments`, `dojo_events` in `supabase/schema.sql`.

---

## 9. Known gaps

- **Approved, then saving fails:** if the card machine approves but the
  surface's save then fails, trying again starts a new card payment, so the
  customer can be charged twice. The POS till queues network failures offline,
  but a sale the server rejects (e.g. an item no longer available) has already
  been charged. Fix before go-live: keep the approved result and retry the save
  without charging, and check the sale before sending it to the machine.
- **A start that times out after Dojo opened the session:** the machine can
  show the payment while the till says "Couldn't start". Retrying is safe (it
  reuses the intent, and reports it as paid if the customer paid), but taking
  the money another way is not, so staff must check the machine first. Rare: it
  needs a Dojo call to take over 15s.
- **Refund UI:** the refund route is ready (payment intent refund, Dojo's
  recommendation; `canIssueRefund`-gated; a `requestId` is required, one per
  refund and resent on retries, so a retry can't refund twice), but no screen
  calls it yet. Dojo requires a working refund path before production. The
  route doesn't record who issued a refund; the screen's work should add that.
  No route opens a refund on the card machine (matched or unlinked): it would
  need its own `canIssueRefund` gate, and its own handling of the session
  result, which is sale-shaped with an empty `paymentIntentId`.
- **Webhook order:** the webhook stores each event's status as it arrives.
  Dojo can deliver events late or out of order, so a late `Captured` could
  overwrite `Refunded`. When webhooks are set up, store the intent's current
  status read from Dojo instead.
- **Split cash+card:** the card leg still uses the manual confirm.
- **Pre-auth (Manual capture):** not offered. The routes always use automatic
  capture; `flow.ts` and the gateway still take `captureMode`, but nothing calls
  `POST /payment-intents/{id}/captures`, so both the capture call and a bar-tab
  UI are missing. Dojo's checklist marks pre-auth `[Optional]`.
- **Cashback and `itemLines`:** not implemented.
- **Gratuity:** a tip the customer adds on the card machine is recorded
  (`dojo_payments.tip_amount`, with Dojo's `total_amount`) and shown on the
  approval screen, but the sale's own totals and reports don't include it yet.
  Tips agreed at the table are still part of the amount sent to the terminal.
- **MOTO (`cardHolderNotPresent`):** the flag reaches the wire, but no surface
  sets it.
- **Receipt:** `ReceiptModal` does not yet print the captured scheme/last-4/auth,
  though `dojo_payments` holds them.
- **Payment reference:** the POS till uses the assigned customer's name as the
  Dojo payment reference, so names show in Dojo's portal. A sale or receipt
  number would identify the payment without that. (A gift card sale sends only
  the last four characters of the card's code, because the code can be spent
  like cash.)
