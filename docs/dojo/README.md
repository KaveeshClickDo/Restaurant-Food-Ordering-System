# Dojo card terminal — how it works in this app

Status: **built and working in mock mode.** `tsc --noEmit` ✓, `eslint` ✓,
`next build` ✓, `npm run dojo:demo` exercises every outcome.
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
  mandates this). **Declined** ⇒ Retry / Back. **Signature** ⇒ Accept / Reject,
  with Dojo auto-accepting after 80s.

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
npm run dojo:demo        # success / declined / expired / signature / refund
```

In the UI: set `DOJO_MODE=mock`, `npm run dev`, open `/pos` or `/waiter`, take a
card payment. The mock picks its outcome from the terminal id suffix, mirroring
Dojo's real sandbox virtual terminals — pin one with `DOJO_TERMINAL_ID`:

| Pinned id | Outcome |
|---|---|
| `tm_mock_success_SIP0` | approved |
| `tm_mock_declined_DIP0` | declined |
| `tm_mock_expired_TIP0` | expired (unknown result) |
| `tm_mock_signature_SIS0` | signature verification |

---

## 7. Going live

**Sandbox:** `DOJO_MODE=live`, `DOJO_API_KEY=sk_sandbox_…`, keep the dummy
`DOJO_SOFTWARE_HOUSE_ID=softwareHouse1`. Restart. Dojo's virtual terminals give
you every outcome without hardware.

**Production:** pass Dojo's QA checklist (a working refund path is mandatory —
we have both server-side and card-present), then `sk_prod_…` plus the
Dojo-assigned `software-house-id`, and repoint webhooks.

**Android POS needs no rebuild** for sandbox↔prod, because it is all server-side.
The APK only had to ship the UI once.

---

## 8. Files

**Core — `app/src/lib/dojo/`** (server-side unless noted)
`config.ts` (mode + env), `effectiveFlag.ts` (env AND admin toggle),
`gateway.ts` (interface + snapshot/result mappers), `client.ts` (real HTTP),
`mock.ts` (simulator), `index.ts` (gateway selector), `sessionHandlers.ts`
(shared route logic), `recordPayment.ts`, `webhook.ts` (HMAC), `respond.ts`
(error→HTTP + minor units), `types.ts`, `posApi.ts` (**client-side** fetchers,
`apiBase()`-aware).

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
- **Pre-auth (Manual capture):** gateway and routes support `captureMode` and
  captures; there is no bar-tab UI.
- **Receipt:** `ReceiptModal` does not yet print the captured scheme/last-4/auth,
  though `dojo_payments` holds them.
- **Refund UI:** refunds exist as an API route (`canIssueRefund`-gated); there is
  no dedicated card-present refund screen.
