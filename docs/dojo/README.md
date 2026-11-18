# Dojo card terminal — how it works in this app

Status: **built, and tested on Dojo's sandbox.** All nine virtual terminals on our
account pass (2026-10-20, run again after a second review on 2026-10-21, and on
2026-10-22 with the payment reference fix), along with the go-live edge cases.
On 2026-10-23 the refund screen, the card machine picker and the save retry were
added, and every screen's payment ran end to end (real logins, real routes, a
test database, the sandbox). On 2026-10-28 keyed payments (MOTO) were added for
a phone booking's VIP fee (§3). Before the accreditation session (UAT) with
Dojo, click through the screens in a browser. The script for both is
[UAT.md](./UAT.md); open items are in §9.

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

**Keyed payments (MOTO)**, for a **phone booking's VIP fee** only: its card
choice also offers **Key in card**. The guest reads out their card details and
staff type them into the card machine (`cardHolderNotPresent: true`, so the
machine skips "Present card"; `<DojoChargePanel keyed />`). Nowhere else, on
purpose: on every other screen the customer is there with the card, and a
keyed payment has no chip & PIN check, so a fraudulent one usually ends as a
chargeback the restaurant pays. The server holds to it: only the till's
`/api/pos/dojo/sessions` with a POS login takes the flag; the waiter's routes
and the collection login get a 403.

---

## 4. Runtime flow

```
DojoChargePanel ─▶ GET    /api/{pos|waiter}/dojo/terminals       the machine picker's list
                ─▶ POST   /api/{pos|waiter}/dojo/sessions        create intent + open session
      │ poll 1s   ▶ GET    /api/{pos|waiter}/dojo/sessions/{id}   until settled
      │ signature ▶ PUT    …/sessions/{id}/signature {accepted}
      │ cancel    ▶ PUT    …/sessions/{id}/cancel
      ▼ on success
the surface's own settle call ─▶ recordDojoPayment(...) ─▶ dojo_payments row
      ▲ failed? "Try saving again" repeats it with the same result (no new charge)
```

- **Choosing the machine:** each tablet remembers its card machine, per surface
  (browser storage). With one machine online it's used straight away; with
  several and none remembered, staff pick one (TID, with Ready / Busy /
  Offline). In test mode the picker always shows, because testers switch
  between the virtual terminals. Result screens offer "Use another"; a retry
  on another machine reuses the payment intent, which Dojo accepts.
- **Approved, then the save fails:** the panel keeps the approved result and
  shows "Paid, but not saved yet" with the reason and **Try saving again**,
  which repeats the surface's save with the same result: the card is never
  charged again. The screen can't be closed meanwhile; "Leave without saving"
  asks first and says the payment stays with Dojo. A save route that finds the
  payment already recorded for its kind of record answers "saved" (the first
  try went through and only its reply was lost), so a retry can't refuse or
  save twice (`isDojoPaymentRecorded`; the till's sale id already does this).

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
  earlier intent for a different amount is never reused, and neither is a
  keyed one for a card-present retry (or the other way round). **Back** then
  Card machine reuses it too: each paying screen keeps its payment's intent in
  a ref (`intentMemory`, one per sale / bill / booking / card) that outlives
  the panel, and clears it once that payment is saved.
- **Cancel** asks Dojo and keeps polling until Dojo reports the result. Once the
  card is in, Dojo may refuse (422; staff see "too late to cancel"), or accept
  the cancel and still take the payment (the sandbox did, 2026-10-22; staff see
  "Cancel sent… wait for the result"). Either way the payment's real outcome
  arrives and is what the till shows. A payment screen can't be closed while a
  payment is live (`onActiveChange`); if it unmounts anyway, the hook cancels
  the session.
- **Errors before a payment starts** show a "Couldn't start" screen with a plain
  message (`lib/dojo/errors.ts`) and no "Record as paid". It says "Nothing was
  charged" only when Dojo refused before any session began (wrong API key,
  unknown or offline terminal, a request Dojo rejected, or the switch is off).
  For a busy machine, a timeout or an unexpected error it tells staff to check
  the machine's screen, because the machine may be showing an earlier try of
  the same payment.
- **Sales only:** the payment routes start sales with automatic capture and
  nothing else. A `sessionType` or `captureMode` in the request body is dropped,
  so no screen can open a refund or a pre-auth through them. A keyed sale
  (`cardHolderNotPresent`) is taken only on the till's route (§3).
- **Timeouts:** each call to Dojo gives up after 15s, which counts as a network
  problem (result unknown); a refund gets 45s, because the sandbox took about
  14.5s to answer each one (2026-11-04), and 45s stays under nginx's usual 60s.
  A refund with no answer tells staff it may still go through and to check
  Dojo's portal before trying again. The tablet waits up to 20s for a poll, signature or
  cancel, and 90s to start a payment. Starting can take up to four Dojo calls,
  so the tablet's limit is longer than the server's: it never gives up on a
  session the server did open.
- **Test mode:** on the simulator or a sandbox key, the payment screen shows a
  "Test mode — no real money moves" badge (the start response carries `test`).
- **Payment reference:** Dojo requires one, 1–60 characters. Each screen names
  what is paid for, with nothing secret or personal:

  | Screen | Reference in Dojo |
  |---|---|
  | POS till sale | `POS sale 3F9A2C1B` (the sale's short id) |
  | Collection | `Collection ORD-A1B2C3D4` |
  | Waiter | `Table 5 #ORD-A1B2C3D4` (the bill's first order, as tickets print it) |
  | Reservation fee | `VIP <table>` |
  | Gift card sale | `Gift card ending 4TPB` (never the whole code: it spends like cash) |

  The server cuts a reference to 60 characters and sends `Card sale` if a
  screen sends none (`paymentReference` in `flow.ts`). For the till's short id,
  the till makes the sale's id when the payment screen opens (a fresh one each
  time) and saves the sale under it (`lib/posSaleRef.ts`). Searching that id,
  or pasting the whole reference, finds the sale in the POS dashboard and the
  admin POS reports. A Dojo payment whose id matches no sale was charged but
  never saved.

### Refunds

Dojo requires at least one working refund path; ours is the till's **Void &
Refund** (POS dashboard). For a sale paid on the card machine, its refund
option reads "To card" and names the card; the refund is a payment intent
refund (Dojo's recommended method), full or partial:

1. `PATCH /api/pos/sales/[id]` checks `canVoidSale` and `canIssueRefund`, and
   caps the amount at what was paid.
2. It sends the refund to Dojo **first** (`lib/dojo/refund.ts`). If Dojo
   refuses, nothing is voided and the screen shows Dojo's reason.
3. Only then is the sale voided, as before.

Each Void & Refund screen sends one `refundRequestId`, Dojo's idempotency key,
on every retry, and a sale already refunded through Dojo is never refunded
again (an earlier try whose void didn't save just saves the void). Every
refund is recorded in `dojo_refunds` with who issued it. On the sandbox, Dojo
refuses refunds of card machine payments ("Your refund request was not
successful"), which Dojo confirmed is expected; the screen explains that in
test mode. On the simulator the refund succeeds.

**Tips and split sales.** A tip the customer added on the card machine was paid
too, so a refund can include it: the screens start at sale + tip and say so.
A refund comes out of the sale first; anything above is tip, recorded in
`card_tip_refunded` so `refund_amount` stays within `total` and "net kept"
stays right. For a split sale, "To card" sends the card part plus the tip to
Dojo and the rest is handed back in cash (the banner says how much of each).

**Other screens** use the same helper, Dojo first, with the screen's
`refundRequestId`:

| Screen | Route | Which payment |
|---|---|---|
| Waiter app refund (senior staff) | `POST /api/waiter/refund` | the bill's, via `orders.dojo_payment_intent_id` |
| POS dashboard → Dine-In → Refund | `POST /api/pos/orders/dine-in/refund` | the same (any order of the bill) |
| Admin → Online Refunds → Original payment method | `POST /api/admin/orders/[id]/refund` | a collection order's (the refund record's id is the key) |

Dine-in refunds share `lib/dineInRefund.ts`. Settling a bill on the card
machine stamps the payment on every order of the bill, so any of them can be
refunded to the card; bills settled before that fall back to the anchor's
`dojo_payments` row. In admin, a refund that makes the order fully refunded
also returns the tip, and the form waits for the answer: if Dojo refuses, the
order is put back and the reason shows. Gift card sales and VIP fees have no
refund screen (the VIP fee is non-refundable by design).

The standalone `POST /api/pos/dojo/refunds` uses the same helper too.

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
it. A refund also updates the status, and is recorded in **`dojo_refunds`**
(amount, reason, Dojo's refund id, the request id it was sent with, who issued
it, and the intent's status afterwards).

Apply with `cd app && npm run db:migrate` — idempotent, safe to re-run.

---

## 6. Test it now (no Dojo account)

```bash
cd app
npm run dojo:demo        # every terminal + retry, cancel, busy, timeouts, keyed payments, refunds, webhook signatures; exits 1 on a failure
```

With a sandbox key, two more (both exit 1 on a failure):

```bash
npm run dojo:sandbox     # the payment logic against Dojo's real sandbox: every virtual terminal, refunds, …
npm run dojo:routes      # the routes as the tablet calls them (login gate skipped, stand-in database)
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
- A payment needs a `reference` of 1–60 characters; without one Dojo refuses it
  (2026-10-21). The `references` section checks the till's `POS sale …`, a
  screen that sends none, and one that's too long.
- On 2026-10-22 a signature payment stayed `SignatureVerificationAccepted` for
  about 90 seconds before Dojo captured it (session then `Captured`); before,
  the capture followed at once. The till keeps waiting until it's captured.
- A **keyed payment** (`cardHolderNotPresent: true`) is accepted and captured,
  and the intent keeps the flag. But the virtual machines ignore it: SIP0
  still asked to present a card and for the PIN, and reported chip & PIN
  (2026-10-28). So the card number screen only shows on a real machine. The
  `keyed` section checks that the flag reaches Dojo.

Dojo's other answers (2026-10-13): terminal gratuity is optional for
accreditation; the physical test device isn't needed for any checklist item.
Accreditation is booked through the "Partner UAT Session" link Dojo sent.

---

## 7. Going live

**Sandbox:** `DOJO_MODE=live`, `DOJO_API_KEY=sk_sandbox_…`,
`DOJO_SOFTWARE_HOUSE_ID=SL750Q59` (ours, assigned by Dojo on 2026-11-04), and
restart. Pick a virtual terminal on the payment screen (test mode always shows
the picker), or pin one for the whole server by its TID (e.g.
`DOJO_TERMINAL_ID=VCMSEEKSIP0`). Dojo's virtual terminals give you every outcome
without hardware.

**The software-house-id is required in live mode.** There is no built-in
fallback: without `DOJO_SOFTWARE_HOUSE_ID`, every call to Dojo is refused before
it is sent (`DojoConfigError`, so nothing is created or charged). Staff see "The
card machine isn't set up correctly. Ask an admin to check the Dojo settings.",
and Admin → Integrations → Card Terminal names the missing setting.

**It goes on every call.** Dojo's spec asks for `software-house-id` only on the
terminal endpoints, but Dojo asked (UAT feedback, 2026-11-04) for it on all
payment intent and terminal session calls, so `client.ts` sends it, and
`reseller-id`, on every request. `DOJO_LOG_REQUESTS=1` prints each call in the
server log (method, path, headers with the key shown only by its prefix,
status, time, Dojo's id), which is how to show Dojo what we send.

**Production:** pass Dojo's UAT (script: [UAT.md](./UAT.md)); the refund path it
needs is the till's Void & Refund (§4 Refunds). Then `sk_prod_…` with the same
software-house-id, and repoint webhooks.

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
`recordPayment.ts` (verified write to `dojo_payments`; `isDojoPaymentRecorded`
for retried saves), `refund.ts` (payment intent refunds, recorded in
`dojo_refunds`), `webhook.ts` (HMAC),
`errors.ts` (error types + staff messages), `respond.ts` (error→HTTP + minor
units), `types.ts`, `posApi.ts` (**client-side** fetchers, `apiBase()`-aware,
with timeouts). Request bodies: `lib/schemas/dojo.ts`. The POS-family login
check: `getTillStaffSession` in `lib/auth.ts`. The till's sale reference and
its search: `lib/posSaleRef.ts` (used by `SaleView`, `context/POSContext.tsx`
`completeSale`, `DashboardView` and `components/admin/POSReportsPanel.tsx`).

**Routes** — `api/pos/dojo/{config,terminals,sessions,sessions/[id],
sessions/[id]/signature,sessions/[id]/cancel,refunds,sales/[id],webhook}` and
`api/waiter/dojo/{terminals,sessions,sessions/[id],sessions/[id]/signature,
sessions/[id]/cancel}`; `api/admin/dojo/status`. Settle routes that record a
Dojo payment (each treats an already-recorded payment as saved):
`api/pos/sales`, `api/waiter/settle`, `api/pos/orders/[id]/settle` and
`api/collection/orders/[id]/settle` (via `lib/collectionOrders.ts`),
`api/pos/gift-cards/[id]/activate`, `api/pos/reservations`. Void & Refund with
the card refund: `api/pos/sales/[id]` (PATCH).

**UI** — `components/pos/DojoChargePanel.tsx` (machine picker, payment, save
retry, keyed entry), `useDojoTerminal.ts`, `PaymentModal.tsx`, `SaleView.tsx`,
`CollectionView.tsx`, `app/collection/page.tsx`, `SellGiftCardModal.tsx`,
`ReservationsView.tsx` (Key in card on phone bookings), `components/waiter/BillView.tsx`,
`components/pos/dashboard/VoidSaleModal.tsx` (refund to card),
`components/admin/IntegrationsPanel.tsx`.

**Checks** — `app/scripts/dojo-demo.ts` (simulator), `app/scripts/dojo-sandbox.ts`
(real sandbox, payment logic), `app/scripts/dojo-routes.ts` (real sandbox,
through the routes). The UAT script: [UAT.md](./UAT.md).

**Schema** — `dojo_payments`, `dojo_events`, `dojo_refunds` in
`supabase/schema.sql`.

---

## 9. Known gaps

- **A sale the server can't accept after the card was charged:** the save
  retry (§4) covers a dropped connection, but a sale the server refuses for
  good (say an item went off the menu meanwhile) keeps failing. Staff then
  "Leave without saving" and refund it in Dojo or record it by hand. Checking
  the sale with the server before sending it to the machine would avoid that.
- **A start that times out after Dojo opened the session:** the machine can
  show the payment while the till says "Couldn't start". Retrying is safe (it
  reuses the intent, and reports it as paid if the customer paid), but taking
  the money another way is not, so staff must check the machine first. Rare: it
  needs a Dojo call to take over 15s.
- **Refunds on the card machine itself:** every refund screen uses a payment
  intent refund (§4 Refunds); no route opens a refund on the machine (matched
  or unlinked). It would need its own `canIssueRefund` gate, and its own
  handling of the session result, which is sale-shaped with an empty
  `paymentIntentId`. Gift card sales and VIP fees have no refund screen.
- **A refund retry after Dojo refused:** the same screen resends the same
  idempotency key, and Dojo answers from its record of the first try (about
  90ms against 14s, sandbox 2026-11-04), so it isn't a fresh attempt; opening
  the screen again is. Open question for Dojo: should a retry after a refusal
  use a new key?
- **Webhook order:** the webhook stores each event's status as it arrives.
  Dojo can deliver events late or out of order, so a late `Captured` could
  overwrite `Refunded`. When webhooks are set up, store the intent's current
  status read from Dojo instead.
- **Split cash+card:** on the till, the card part goes to the card machine
  (amounts, then Card machine / Other). On the collection screens a split's
  card part still uses the manual confirm (`splitOnCardMachine` is till-only):
  the collection save and admin refunds expect the card to pay the whole order.
- **Pre-auth (Manual capture):** not offered. The routes always use automatic
  capture; `flow.ts` and the gateway still take `captureMode`, but nothing calls
  `POST /payment-intents/{id}/captures`, so both the capture call and a bar-tab
  UI are missing. Dojo's checklist marks pre-auth `[Optional]`.
- **Cashback and `itemLines`:** not implemented.
- **Gratuity:** a tip the customer adds on the card machine is recorded
  (`dojo_payments.tip_amount`, with Dojo's `total_amount`) and shown on the
  approval screen. It's kept apart from the total, from Dojo's record of the
  payment, on the till sale (`pos_sales.card_tip_amount`) and on dine-in and
  collection orders (`orders.card_tip_amount`, a bill's anchor order). The
  receipts (till, waiter, POS dine-in, collection, admin; screen, print and
  thermal) show "Tip on card machine" and "Card total"; the transaction list
  shows "+£x tip on card"; the CSV exports have their own column; and the Tips
  cards on the POS dashboard, POS Reports and admin POS Reports include them
  ("incl. £x on card machine"; never in revenue or Net Sales). Refunds can give
  it back (§4 Refunds). Gift card sales and VIP fees have no receipt; their tip
  is only in `dojo_payments`. Tips agreed at the table are still part of the
  amount sent to the terminal.
- **MOTO (`cardHolderNotPresent`):** offered only for a phone booking's VIP
  fee (§3), by choice. The sandbox's virtual machines don't show card number
  entry (§6a), so that screen hasn't been seen on a machine yet.
- **Card on receipts:** the till receipt (screen, print, email, thermal) shows
  "VISA ****1234 · Auth 123456" under the card line, read from `dojo_payments`
  (`lib/dojo/cardDetails.ts`, batched). The waiter, collection and admin order
  receipts don't show the card yet.
- **A gift card spent before the card payment is saved:** the gift card part of
  a sale is taken off only after the card machine has charged the rest. If the
  same card is spent elsewhere in between, the sale is refused ("Gift card
  balance changed") although the card payment went through: the screen shows
  "Paid, but not saved yet" with that reason, and staff take the difference
  another way or refund. Holding the gift card amount before charging the
  machine would close it; that's a decision still to make.
