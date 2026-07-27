# Dojo Card Payments — Implementation & Runbook

Branch: **`feat/dojo-payments`** (off `main`).
Status: **BUILT + verified in mock mode.** `tsc --noEmit` ✓, `eslint` ✓, `next build` ✓
(all 8 routes registered), `npm run dojo:demo` exercises every outcome.
Companion: [dojo-integration-reference.md](./dojo-integration-reference.md) (the API facts).

The integration is **complete and testable today with no Dojo account** (mock mode).
Adding the sandbox key later, then the production key, is **env-only — no code change**.

---

## 0. Multi-surface update (2026-07-25) — READ THIS FIRST

The integration now covers **every card-payment surface**, with a **two-level flag**
and a **central payments table**. This supersedes the single-surface (POS-only)
description in the older sections below.

**Surfaces with the "Card machine (Dojo) vs Other (manual)" choice** (when the
feature is effectively on):
- POS menu sale (`SaleView` → `PaymentModal`)
- POS collection tab (`CollectionView`) and the standalone **collection staff app** (`/collection`)
- **Waiter** table settle (`BillView`)
- POS **gift-card** sale (`SellGiftCardModal`)
- POS **reservation / VIP booking** fee (`ReservationsView`)

Not touched (by design): online website (Stripe) and admin bill settle.

**Two-level flag** — `isDojoEffectivelyEnabled()` = env master (`DOJO_MODE`) **AND**
the admin toggle at **Admin → Integrations → Card Terminal** (stored in
`app_settings.data.dojoTerminal.enabled`). The admin toggle is **locked when env
is off** and can never turn the feature on without the env. Either off → the Dojo
option disappears everywhere and card pays the old manual way. Each surface reads
the effective flag from its own config endpoint (`/api/pos/dojo/config`,
`/api/waiter/config`, `/api/collection/auth`).

**One shared UI** — `components/pos/DojoChargePanel.tsx` renders the whole driven
flow (present card → PIN → signature → settle) and is reused by all surfaces;
`PaymentModal` also delegates to it.

**Central persistence** — every surface writes one row to the **`dojo_payments`**
table via `recordDojoPayment({ result, sourceType, sourceId, amount, staffId })`.
`sourceType` ∈ `pos_sale | collection | dine_in | gift_card | reservation`. The
earlier per-`pos_sales` `dojo_*` columns were **dropped** in favour of this
(migration drops them idempotently). The webhook reconciles `dojo_payments.status`.

Everything below (§1–§9) still describes the runtime flow correctly; only the
"persists dojo_* columns on pos_sales" wording and the POS-only scope are
superseded by this section.

---

## 1. What it does

Turns the POS "Card" tender from a *manual record* ("staff runs a standalone
machine, then taps Payment Received") into a *driven* payment on an integrated
**Dojo** card terminal: the till sends the amount, the machine takes the card, and
we record the real `transactionId` / `authCode` / card details on the sale.

When the feature is **off** (default), the POS behaves exactly as before. It's
gated per tenant by a single server flag, so one restaurant can use Dojo while
others are untouched.

---

## 2. The three modes (one flag)

Set `DOJO_MODE` in the **server** env (`app/.env.local` in dev; the systemd
service env in prod). See `app/example.env` for the full block.

| `DOJO_MODE` | Needs a key? | What happens |
|---|---|---|
| `off` (default) | no | Feature hidden. POS records card manually (today's behaviour). |
| `mock` | **no** | In-memory simulator. Build + test the whole flow with no account. |
| `live` | **yes** | Real `https://api.dojo.tech`. Key prefix picks env: `sk_sandbox_` → sandbox, `sk_prod_` → production. |

Cutover path (no code changes between them):
```
build/dev now:  DOJO_MODE=mock
sandbox test:   DOJO_MODE=live   DOJO_API_KEY=sk_sandbox_…   (+ real software-house-id/reseller-id if Dojo issued them)
production:     DOJO_MODE=live   DOJO_API_KEY=sk_prod_…       + Dojo-assigned software-house-id/reseller-id
```

**Secrets are server-side only.** `DOJO_API_KEY` / `DOJO_WEBHOOK_SECRET` must never
be `NEXT_PUBLIC_` and never go in `.env.capacitor` — the APK only calls our
`/api/pos/dojo/*` routes.

---

## 3. How the flow works (runtime)

```
POS PaymentModal ──▶ POST /api/pos/dojo/sessions      (create intent + open terminal session)
       │  poll ~1.2s ─▶ GET  /api/pos/dojo/sessions/{id}    (until settled)
       │  if signature ─▶ PUT /api/pos/dojo/sessions/{id}/signature {accepted}
       │  on cancel ─────▶ PUT /api/pos/dojo/sessions/{id}/cancel
       ▼ on success
completeSale(..., dojo) ──▶ POST /api/pos/sales   (persists dojo_* columns on pos_sales)
```

- All Dojo API calls happen **server-side** (routes → `lib/dojo` gateway → Dojo).
  Card data never touches the tablet; no native SDK; no PCI scope on the device.
- The POS UI drives a small state machine (`useDojoTerminal`): `starting →
  processing → [signature] → success | declined | expired | error`, showing the
  terminal's on-screen prompts (Present card / Enter PIN / …) to staff.
- **Expired** = result unknown → the UI offers "Record as paid" or "Retry"
  (Dojo's mandated fallback). **Declined** → Retry / Back. **Signature** →
  Accept / Reject (Dojo auto-accepts after 80s if no decision).
- Refunds: server-side via `POST /api/pos/dojo/refunds` (gated `canIssueRefund`),
  or card-present via a `MatchedRefund`/`UnlinkedRefund` session.
- Webhook (`POST /api/pos/dojo/webhook`) is a supplementary audit/reconcile path,
  authenticated by the `Dojo-Signature` HMAC and deduped via `dojo_events`.

---

## 4. Test it NOW (mock mode, no account)

**A. Headless demo** — proves the state machine end-to-end:
```
cd app
npm run dojo:demo        # runs success / declined / expired / signature / refund
```

**B. In the POS UI:**
1. In `app/.env.local` set `DOJO_MODE=mock`.
2. `npm run dev`, open `/pos`, log in, add items, take payment → **Card**.
3. The modal now drives a mock terminal: you'll see "Present card / Enter PIN"
   then **Approved**, and the sale is saved with mock `transactionId`/`authCode`.
4. To see the other outcomes, the mock picks the result from the terminal id
   suffix (like Dojo's real virtual terminals). Auto-discovery uses the first
   terminal (success); to force a specific outcome, pin it:
   `DOJO_TERMINAL_ID=tm_mock_declined_DIP0` (also `_TIP0` expired, `_SIS0` signature).

Turn it off again: `DOJO_MODE=off` → POS is exactly as before.

---

## 5. Cutover to sandbox (when the key arrives)

1. Get a **sandbox** key (`sk_sandbox_…`) via the restaurant's Dojo Developer
   Portal / partner onboarding (see reference §12).
2. Server env:
   ```
   DOJO_MODE=live
   DOJO_API_KEY=sk_sandbox_xxxxx
   # keep the sandbox dummy ids unless Dojo issued real ones:
   DOJO_SOFTWARE_HOUSE_ID=softwareHouse1
   DOJO_RESELLER_ID=reseller1
   ```
3. Restart the server. Run the same POS flow. Dojo's sandbox **virtual terminals**
   (TID suffixes `SIP0`/`DIP0`/`TIP0`/`SIS0`) let you test success/decline/expiry/
   signature **without hardware** — pin one via `DOJO_TERMINAL_ID` or select from
   `GET /api/pos/dojo/terminals`.
4. (Optional) Webhooks: add an endpoint in the Portal pointing at
   `https://<host>/api/pos/dojo/webhook`, put its secret in `DOJO_WEBHOOK_SECRET`.

## 6. Cutover to production

1. Complete Dojo QA / go-live checklist (reference §10) — refund path is mandatory
   (we have both server-side and card-present).
2. Server env: `DOJO_API_KEY=sk_prod_…` plus the **Dojo-assigned**
   `DOJO_SOFTWARE_HOUSE_ID` / `DOJO_RESELLER_ID`. Point webhooks at prod.
3. Physical Dojo terminal paired to the merchant account. Restart. Done.

**Android POS:** because it's all server-side, the installed APK needs **no
rebuild** for sandbox↔prod. The one-time APK rebuild is only to ship the
"Send to card machine" UI itself (already on this branch).

---

## 7. Files (what was added / changed)

**Core library — `app/src/lib/dojo/`** (server-side unless noted)
- `types.ts` — Dojo wire types + the trimmed DTOs sent to the client.
- `config.ts` — `DOJO_MODE` resolution + config from env (the feature flag).
- `gateway.ts` — `DojoGateway` interface + snapshot/result mappers.
- `client.ts` — real HTTP client for `api.dojo.tech`.
- `mock.ts` — in-memory simulator (virtual terminals, all outcomes).
- `index.ts` — `getDojoGateway()` selects mock/live by mode.
- `webhook.ts` — HMAC-SHA256 signature verification.
- `respond.ts` — error→HTTP mapping + minor-unit helper.
- `posApi.ts` — **client-side** fetchers (use `apiBase()`; types only).

**Routes — `app/src/app/api/pos/dojo/`**
- `config`, `terminals`, `sessions`, `sessions/[id]`, `sessions/[id]/signature`,
  `sessions/[id]/cancel`, `refunds`, `webhook`.

**POS UI**
- `components/pos/useDojoTerminal.ts` — client state-machine hook.
- `components/pos/PaymentModal.tsx` — driven card flow (gated by `dojoEnabled`).
- `components/pos/SaleView.tsx` — passes the flag + Dojo result through.
- `context/POSContext.tsx` — `dojoEnabled` flag + `completeSale(..., dojo)`.

**Schema / DB**
- `lib/schemas/dojo.ts` — route body schemas.
- `lib/schemas/pos.ts` — `PosSaleCreateSchema` gains an optional `dojo` object.
- `app/src/app/api/pos/sales/route.ts` — persists the `dojo_*` columns.
- `supabase/schema.sql` — `pos_sales.dojo_*` columns + `dojo_events` table
  (idempotent; apply with `npm run db:migrate`).

**Tooling / docs**
- `scripts/dojo-demo.ts` + `npm run dojo:demo`.
- `app/example.env` (DOJO block), `.env.capacitor.example` (warning).
- `docs/dojo/dojo-integration-reference.md`, this file.

---

## 8. Deliberate scope / follow-ups

Fully implemented for the **main till Card tender** (SaleView). Intentional
follow-ups (not blockers; today's manual behaviour applies where not wired):
- **Split (cash+card)**: the card leg still uses the manual confirm. Driving the
  terminal for a split's card portion is a clean next step on top of this.
- **CollectionView / Dine-in settle**: reuse the same hook to drive their
  PaymentModal instances.
- **Receipt**: `ReceiptModal` could show the captured card scheme/last-4/auth
  (already persisted on `pos_sales`).
- **Pre-auth (Manual capture)**: adapter + routes support `captureMode`/captures;
  no UI yet (bar-tab style tabs).

---

## 9. Apply the DB migration

The new columns/table are idempotent additions to `supabase/schema.sql`:
```
cd app && npm run db:migrate
```
Safe to re-run. Existing rows get NULL `dojo_*` (unchanged behaviour).
