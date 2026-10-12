# Dojo card terminal — how it works in this app

Status: **built and working in mock mode; sandbox testing next.** The simulator
now mirrors the nine virtual terminals Dojo set up on our sandbox account, and
`npm run dojo:demo` checks every outcome plus the go-live edge cases.
API facts: [dojo-integration-reference.md](./dojo-integration-reference.md)
(verified 2026-08-12 against the live docs **and** the OpenAPI spec).

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
feature on by itself — that's the "toggle only if the envs exist" rule. Either
level off ⇒ the Dojo option disappears everywhere and card reverts to manual.

| `DOJO_MODE` | Key needed? | Behaviour |
|---|---|---|
| `off` (default) | no | hidden; manual card record, as today |
| `mock` | **no** | in-memory simulator; build and test every outcome with no Dojo account |
| `live` | **yes** | real `https://api.dojo.tech`; key prefix picks the environment (`sk_sandbox_` / `sk_prod_`) |

`live` without `DOJO_API_KEY` falls back to `off` — it never pretends to be live.

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
| POS collection tab + `/collection` app | `CollectionView` | `/api/collection/auth` |
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
recordDojoPayment(...) ─▶ dojo_payments row + the surface's own settle call
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
  whether the earlier attempt actually went through, and if so reports it as paid
  rather than charging again (`lib/dojo/flow.ts`).
- **Cancel** asks Dojo and keeps polling until Dojo reports `Canceled`. Once the
  card is in, Dojo refuses (422): staff see "too late to cancel" and the payment's
  real outcome still arrives. A payment screen can't be closed while a payment is
  live (`onActiveChange`); if it unmounts anyway, the hook cancels the session.
- **Errors before a payment starts** (wrong API key, busy, offline or unknown
  terminal) show a "Couldn't start" screen with a plain message
  (`lib/dojo/errors.ts`) and no "Record as paid", because nothing was charged.

### Surface boundary

The `/waiter` app must only call `/api/waiter/*`. So the waiter has its own
`/api/waiter/dojo/sessions[...]` routes gated on a **waiter** session, while the
POS family uses `/api/pos/dojo/*` gated on any staff session. Both are thin auth
wrappers over the same `lib/dojo/sessionHandlers.ts`, so the flows cannot drift.
The client picks its routes with `<DojoChargePanel scope="waiter" />`.

---

## 5. Persistence

Every surface writes one row to **`dojo_payments`** via
`recordDojoPayment({ result, sourceType, sourceId, amount, staffId })`, where
`sourceType` ∈ `pos_sale | collection | dine_in | gift_card | reservation`.

One central table keeps "all card-machine takings" reporting and refund lookup in
one place instead of `dojo_*` columns spread across five tables. (An earlier
iteration did the latter; `schema.sql` drops those columns idempotently.)

The webhook reconciles `dojo_payments.status` and dedupes via `dojo_events`.

Apply with `cd app && npm run db:migrate` — idempotent, safe to re-run.

---

## 6. Test it now (no Dojo account)

```bash
cd app
npm run dojo:demo        # every terminal + retry, cancel, busy, refunds; exits 1 on a failure
```

In the UI: set `DOJO_MODE=mock`, `npm run dev`, open `/pos` or `/waiter`, take a
card payment. The mock's terminals copy the virtual terminals Dojo set up on our
sandbox account, with the same TIDs. Pin one with `DOJO_TERMINAL_ID`, which takes
a TID or a Dojo terminal id (`tm_…`), so the same value works in mock and live:

| `DOJO_TERMINAL_ID` | Outcome |
|---|---|
| `VCMSEEKSIP0` | chip & PIN, approved |
| `VCMSEEKSCN0` | contactless with device verification, approved |
| `VCMSEEKSIS0` | signature verification |
| `VCMSEEKDIS0` | signature, then declined |
| `VCMSEEKDIP0` | declined |
| `VCMSEEKUIP0` | unsuccessful |
| `VCMSEEKTIP0` | timed out (`Expired`, result unknown) |
| `VCMSEEKCIP0` | cancelled on the machine |
| `VCMSEEKSIP1` | approved with a 10% tip |

What the mock returns for UIP0 and DIS0 (`Declined`) is our guess until the
sandbox shows Dojo's real statuses.

---

## 7. Going live

**Sandbox:** `DOJO_MODE=live`, `DOJO_API_KEY=sk_sandbox_…`, keep the dummy
`DOJO_SOFTWARE_HOUSE_ID=softwareHouse1`, and pin a virtual terminal by its TID
(e.g. `DOJO_TERMINAL_ID=VCMSEEKSIP0`). Restart after each change. Dojo's virtual
terminals give you every outcome without hardware.

**Production:** pass Dojo's QA checklist (a working refund path is mandatory —
the API supports server-side and card-present refunds, but no screen calls them
yet), then `sk_prod_…` plus the Dojo-assigned `software-house-id`, and repoint
webhooks.

**Android POS needs no rebuild** for sandbox↔prod, because it is all server-side.
The APK only had to ship the UI once.

---

## 8. Files

**Core — `app/src/lib/dojo/`** (server-side unless noted)
`config.ts` (mode + env), `effectiveFlag.ts` (env AND admin toggle),
`gateway.ts` (interface + snapshot/result mappers), `client.ts` (real HTTP),
`mock.ts` (simulator), `index.ts` (gateway selector), `flow.ts` (starting a
payment: terminal by TID, intent reuse, already-paid check), `sessionHandlers.ts`
(shared route logic), `recordPayment.ts`, `webhook.ts` (HMAC), `errors.ts`
(Dojo error → staff message), `respond.ts` (error→HTTP + minor units),
`types.ts`, `posApi.ts` (**client-side** fetchers, `apiBase()`-aware).

**Routes** — `api/pos/dojo/{config,terminals,sessions,sessions/[id],
sessions/[id]/signature,sessions/[id]/cancel,refunds,webhook}` and
`api/waiter/dojo/sessions{,/[id],/[id]/signature,/[id]/cancel}`;
`api/admin/dojo/status`.

**UI** — `components/pos/DojoChargePanel.tsx`, `useDojoTerminal.ts`,
`PaymentModal.tsx`, `SaleView.tsx`, `CollectionView.tsx`,
`SellGiftCardModal.tsx`, `ReservationsView.tsx`,
`components/waiter/BillView.tsx`, `components/admin/IntegrationsPanel.tsx`.

**Schema** — `dojo_payments`, `dojo_events` in `supabase/schema.sql`.

---

## 9. Known gaps (deliberate)

- **Split cash+card:** the card leg still uses the manual confirm.
- **Pre-auth (Manual capture):** `captureMode` can be sent, but nothing calls
  `POST /payment-intents/{id}/captures`, so a pre-auth could be started and
  never settled. Both the capture call and a bar-tab UI are missing. Dojo's
  checklist marks pre-auth `[Optional]`.
- **Cashback and `itemLines`:** not implemented.
- **Gratuity:** a tip the customer adds on the card machine is recorded
  (`dojo_payments.tip_amount`, with Dojo's `total_amount`) and shown on the
  approval screen, but the sale's own totals and reports don't include it yet.
  Tips agreed at the table are still part of the amount sent to the terminal.
- **MOTO (`cardHolderNotPresent`):** the flag reaches the wire, but no surface
  sets it.
- **Receipt:** `ReceiptModal` does not yet print the captured scheme/last-4/auth,
  though `dojo_payments` holds them.
- **Refund UI:** refunds exist as an API route (`canIssueRefund`-gated), but no
  screen calls it yet, and there is no card-present refund screen. Dojo requires
  a working refund path before production.
