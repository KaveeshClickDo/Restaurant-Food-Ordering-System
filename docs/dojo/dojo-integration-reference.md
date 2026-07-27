# Dojo Pay-at-Counter Integration Reference

> Compiled from Dojo's **authoritative** LLM docs (`docs.dojo.tech/llms-*.txt`, auto-generated
> from their live documentation), read in full on 2026-07-24. Source files:
> `llms-core-concepts.txt`, `llms-inperson-pac.txt`, `llms-payment-intents.txt`.
> Machine-readable spec of record: https://docs.dojo.tech/api/v3/bundled.json
>
> This is the reference for **our** use case: our POS/EPOS drives a physical Dojo card
> terminal to take a card-present payment. It is **not** the "Pay at Table / EPOS Data"
> model (that's the reverse direction — Dojo's own products driving our POS — which we do
> not need).

---

## 1. Which integration model we use

Dojo has two directions. We only need the first:

| Model | Who calls whom | For us? |
|---|---|---|
| **Pay at Counter (Terminals API)** | **Our POS → Dojo** REST API drives a Dojo card machine | ✅ **This one** |
| Pay at Table / EPOS Data API | Dojo products call **into** our POS (capability registration, WebSocket) | ❌ Not needed |

**Card data never touches our app or tablet.** The physical Dojo terminal handles the card;
we only send an amount and read back a result. No native SDK, no PCI scope on the device.

---

## 2. Auth & environment (identical for sandbox and production)

- **Base URL:** `https://api.dojo.tech` — **same for sandbox and production**. The **API key prefix** decides the environment (`sk_sandbox_…` vs `sk_prod_…`).
- **Auth header:** `Authorization: Basic <api_key>` — the literal word `Basic ` then the key. **Do NOT base64-encode** (this is not standard Basic auth).
- **Version header (required on every call):** `version: 2026-02-27` (YYYY-MM-DD scheme; Dojo never auto-upgrades you — you change it yourself).
- **Content-Type:** `application/json`
- **Terminal endpoints also require:** `software-house-id` and `reseller-id` headers.
  - Sandbox dummy values: `softwareHouse1` / `reseller1` (public, documented).
  - Production: real values **assigned by Dojo** during partner onboarding.
- **Key is location-bound.** Dojo accounts are two-tier: **Company → Location**. Each Location has its own sandbox + prod keys. Pick the right location before generating a key.

---

## 3. The complete Sale flow (verified from docs, real bodies)

```
1. POST /payment-intents                       → create charge (amount, currency, ref)
2. GET  /terminals?statuses=Available          → find a card machine (or use known id)
3. POST /terminal-sessions                      → bind intent to terminal (starts the machine)
4. GET  /terminal-sessions/{id}  (poll ~1s)     → watch status until terminal state
   └ if status = SignatureVerificationRequired:
     PUT /terminal-sessions/{id}/signature {accepted:true|false}
5. GET  /payment-intents/{id}                   → read final transactionId / authCode / card
```

### Step 1 — Create payment intent
`POST /payment-intents`
```json
{
  "amount": { "value": 1000, "currencyCode": "GBP" },
  "reference": "Order-234",
  "description": "Card terminal sale for table 12",
  "captureMode": "Auto"
}
```
- `value` is **minor units** (1000 = £10.00).
- `captureMode: "Auto"` = charge immediately (our normal case). `"Manual"` = pre-auth/tab, capture later.
- Response has `id` (`pi_...`), `status: "Created"`, `paymentLink`, empty `paymentEvents` / `terminalSessionHistory`.

### Step 2 — Find an available terminal
`GET /terminals?statuses=Available` → array; take `[].id` (`tm_...`).
- Do **not** hard-code the terminal id (Dojo QA requires discovery or configurable TID).
- Note: `terminalId` (Dojo's id) ≠ `tid` (8-digit hardware id on the device).

### Step 3 — Create terminal session
`POST /terminal-sessions`
```json
{
  "terminalId": "tm_sandbox_65c5fe8a104a1222b2d8b968",
  "details": {
    "sessionType": "Sale",
    "sale": { "paymentIntentId": "pi_sandbox_G_FeegU8WESxtY_Nct8jqw" }
  }
}
```
- Creating the session **auto-initiates** the linked payment intent and wakes the machine.
- Response starts at `status: "InitiateRequested"`, with `expireAt` and `statusEvents[]`.
- `sessionType`: `"Sale"` | `"MatchedRefund"` (both need `paymentIntentId`) | `"UnlinkedRefund"` (needs `amount`, no intent).

### Step 4 — Poll until terminal state
`GET /terminal-sessions/{id}` every ~1s. Keep polling while status ∈ `InitiateRequested`, `Initiated`, `CancelRequested`. Stop on a terminal state (see §4).
- `notificationEvents[]` carry screen prompts to show staff: `PresentCard`, `PleaseWait`, `EnterPin`, `RemoveCard`, etc.

### Step 5 — Read the final result
`GET /payment-intents/{id}` → on success `status: "Captured"` and `paymentDetails`:
```json
"paymentDetails": {
  "transactionId": "19e4535e-ef6e-48e2-90be-d2b313c1cefd",
  "transactionDateTime": "2024-07-25T08:49:20Z",
  "message": "DEPOSITED",
  "authCode": "123456",
  "card": {
    "cardNumber": "44565300****1096",
    "cardType": "VISA",
    "entryMode": "Contactless",
    "verificationMethod": "Pin"
  }
}
```
Store `transactionId`, `authCode`, masked `cardNumber`, `cardType` against our order.

---

## 4. Terminal-session statuses (the state machine)

| Status | Meaning | Poll action |
|---|---|---|
| `InitiateRequested` | Sent to terminal, awaiting confirm | keep polling |
| `Initiated` | Terminal ready, awaiting card | keep polling |
| `Authorized` | Pre-auth done (Manual mode) — needs later capture | stop; capture later |
| `Captured` | **Success**, funds captured | stop ✅ |
| `SignatureVerificationRequired` | Need operator to accept/reject signature | call signature endpoint |
| `SignatureVerificationAccepted` | Signature accepted → captured | stop ✅ |
| `SignatureVerificationRejected` | Signature rejected → reversed | stop ❌ |
| `CancelRequested` | Cancel sent, awaiting confirm | keep polling |
| `Canceled` | Session cancelled (no payment) | stop |
| `Declined` | Card issuer declined | stop ❌ (reuse the intent to retry) |
| `Expired` | Terminal/API disconnect — **result unknown** | stop → see §7 |

> `Refunded` and `Reversed` are **payment-intent** states, not terminal-session states.

**Signature 80-second rule:** after `SignatureVerificationRequired`, the operator has **80 seconds** to `PUT …/signature`. If no decision is sent, Dojo **finalises as accepted** and the sale proceeds. A late reject after timeout does nothing — the sale already succeeded. Design the UI around this.

---

## 5. Capture modes

- **Auto** (our default): captured immediately on card present. `Created → Captured`.
- **Manual (pre-auth / tab):** `Created → Authorized`, then:
  - Top up: `POST /payment-intents/{id}/amount` (repeatable before capture).
  - Settle: `POST /payment-intents/{id}/captures` with `{ "amount": 2000 }` → returns `captureId`.
  - If not captured within **7 days**, it auto-reverses.
  - Bills over £100 require Chip & PIN or device verification (not contactless).

---

## 6. Refunds, reversal, cancel — 4 tools, know which to use

| Action | Endpoint | When |
|---|---|---|
| **Cancel** | `DELETE /payment-intents/{id}` | Intent still `Created` (never authorised). Frees it. |
| **Cancel session** | `PUT /terminal-sessions/{id}/cancel` | Before card is presented. `→ CancelRequested → Canceled`. Fails once a card is presented (incl. failed attempts). Note it's **PUT**, session is not deleted. |
| **Reversal** | `POST /payment-intents/{id}/reversal` | Same-day/near (Auto: within 7 days of payment; Manual: while `Authorized`). Full amount only. Returns `reversalId`. |
| **Refund (server-side)** | `POST /payment-intents/{id}/refunds` | After capture, customer **not present**. Full or partial, multiple allowed up to original. Needs `IdempotencyKey` header. Returns `refundId`; intent → `Refunded` (full) or stays `Captured` (partial). |
| **Refund (card-present)** | `POST /terminal-sessions` with `sessionType: "MatchedRefund"` (+ original `paymentIntentId`) or `"UnlinkedRefund"` (+ `amount`, no intent) | Customer + card present at the terminal. |

**Go-live requirement:** Dojo **mandates at least one working refund path** in the integration before approving production.

Refund request body:
```json
{ "amount": 1000, "refundReason": "Demo refund", "notes": "Customer returned order" }
```

---

## 7. Error handling & the `Expired` case (required by QA)

| HTTP | Cause | POS should |
|---|---|---|
| 400 | Bad request | Fix payload before release |
| 401 | Invalid API key | Clear "check your API key" message (esp. self-install) |
| 404 | Terminal offline/unknown TID | Tell staff to check the device |
| 422 | e.g. cancel outside "Insert Card" phase | Continue prior request; explain why |

**`Expired`** = API↔terminal disconnect mid-transaction; **result genuinely unknown**. POS must show a dialog telling staff to **check the card machine screen/receipt**, and offer to **manually record as paid** or **retry**. Don't silently assume failure.

---

## 8. Webhooks (recommended, alternative/supplement to polling)

- Subscribe: `POST /webhooks` `{ "events": ["payment_intent.status_updated"], "url": "https://…" }`. URL must be **public HTTPS**.
- List event types: `GET /webhooks/events`. Manage secrets: `GET/POST/PUT/DELETE /webhooks/secrets`.
- **Payment-intent events:** `payment_intent.created`, `payment_intent.status_updated`, `payment_intent.send-receipt`. Payload `data`: `{ paymentIntentId, paymentStatus, captureMode }`. `paymentStatus` ∈ `Created|Authorized|Captured|Reversed|Refunded|Canceled`.
- **Terminal-session events:** `terminal_session.created`, `terminal_session.status_updated`, `terminal_session.signature_verification_required`, `terminal_session.notification`. Payload `data`: `{ terminalSessionId, state, terminalId, sessionType, paymentIntentId, paymentDetails{cardScheme,maskedPan,authCode} }`. **Delivered in order per session.**
- **Delivery:** any `2xx` = accepted; `4xx/5xx` = retried up to **12 times** with exponential backoff. **Handle idempotently** (at-least-once; if both webhook + capability registered, events arrive twice).
- **Signature verification (required):** each webhook has a `Dojo-Signature` header (case-insensitive). Compute `HMAC-SHA256(rawBody, secret.value)`, format as `sha256=` + uppercase hex bytes joined by `-`, compare with constant-time equality. **Use the raw request body** (no reformatting).

```py
digest = hmac.new(secret.encode(), raw_body, sha256).digest()
expected = "sha256=" + "-".join(f"{b:02X}" for b in digest)
hmac.compare_digest(header, expected)
```

---

## 9. Sandbox testing — NO physical hardware needed ✅

**Decisive finding:** sandbox provides **virtual terminals**. Use a terminal whose **TID ends in a magic suffix** to force outcomes:

| TID suffix | Forced outcome |
|---|---|
| `SIP0` | Success via insert/PIN **and** signature-verification sale path |
| `DIP0` | **Declined** |
| `TIP0` | **Expired** |
| `SIS0` | Refund requiring signature verification |

So the full happy path, declines, expiry, signature accept/reject, and refunds are all testable **remotely, with only a sandbox API key** — no Dojo Go required for development.

- **Test cards:** Dojo issues physical POS test cards for in-person; virtual test card numbers exist for online. Sandbox-only.
- The public sandbox key in the docs is shared/public — **generate your own private sandbox key** in the Developer Portal for real testing (don't send PII with the public one).
- For webhook testing before a public endpoint exists: webhook.site or ngrok.

---

## 10. Go-live checklist (Dojo QA gate)

Dojo requires a QA pass before production. Notable items:
- API key is **configurable, never hard-coded**; wrong key shows a clear error.
- Terminal discovery via `GET /terminals` or a configurable TID (not hard-coded).
- Payment intent create (Auto; Manual optional), retrieve final result, cancel, list/search.
- MOTO/card-not-present: `cardHolderNotPresent: true` skips "Present Card" → key entry.
- At least one **refund** path working (mandated).
- Handle all terminal outcomes incl. `Declined`, `Expired`, signature (accept/reject/timeout), cancel-from-POS and cancel-from-PDQ, busy terminal.
- Poll `GET /terminal-sessions` ~once per second; surface `notificationEvents` to staff.
- Provide API version + min POS version to Dojo during QA.

**Sandbox → production is then just:** swap `sk_sandbox_` → `sk_prod_`, swap dummy `software-house-id`/`reseller-id` → Dojo-assigned values, point webhooks at the prod URL. **No code change.**

---

## 11. How this maps to OUR app

- **All Dojo calls are server-side** — they live in our Next.js `/api/*` routes (server → `api.dojo.tech`). The Android POS keeps calling our server; **no APK rebuild** for the backend. Only the POS "Pay on terminal" button/waiting UI needs to ship once in the bundle (flag-gated).
- **Env vars (server-side secrets, never `NEXT_PUBLIC_`, never in `.env.capacitor`):**
  ```bash
  DOJO_API_BASE=https://api.dojo.tech
  DOJO_API_KEY=sk_sandbox_xxx          # the only secret to obtain; sk_prod_ later
  DOJO_API_VERSION=2026-02-27
  DOJO_SOFTWARE_HOUSE_ID=softwareHouse1  # sandbox dummy; real in prod
  DOJO_RESELLER_ID=reseller1             # sandbox dummy; real in prod
  DOJO_WEBHOOK_SECRET=whsec_xxx          # if using webhooks
  # terminal id discovered at runtime via GET /terminals
  ```
- **Feature flag = presence of `DOJO_API_KEY`** (per tenant). Absent → button hidden, app behaves exactly as today (cash/card record only).
- **DB columns to add** on the order/payment: `dojo_payment_intent_id`, `dojo_terminal_session_id`, `transaction_id`, `auth_code`, `card_last4`, `card_type`, `dojo_status`.
- **Adapter with `mock | sandbox | live` mode** → we can build 90% now against a mock, then flip to sandbox when the key arrives, then prod. Same code throughout.
- **Multi-tenant:** each restaurant = its own Dojo Company/Location account, own key(s), own terminal(s), own server env. Turn Dojo on per tenant.

---

## 12. Commercial gate (not code)

- Can build/test in **sandbox** with just a sandbox key (obtain via the restaurant's Dojo account / partner onboarding; developer sign-up is not fully self-serve like Stripe).
- Going **live** needs: the merchant onboarded by Dojo, Dojo-assigned `software-house-id`/`reseller-id`, a physical Dojo terminal, and passing Dojo QA.
- Partner/tech contact: `partnertech@dojo.tech`. Portal: https://developer.dojo.tech. Sample code: https://github.com/dojo-engineering/dojo-samples.
</invoke>
