# Dojo Pay-at-Counter — verified API reference

> **Provenance.** Every fact below was checked on **2026-08-12** against two
> independent sources:
> 1. the live HTML documentation pages under `https://docs.dojo.tech/` (the
>    Pay-at-Counter, manage-payments, development-resources and go-live sections), and
> 2. the machine-readable OpenAPI spec of record, `https://docs.dojo.tech/api/v3/bundled.json`.
>
> The `llms-*.txt` bundles were used only as a cross-check, never as the sole
> source — they are auto-generated and summarise some tables away. Where the two
> disagreed, the OpenAPI spec wins and the difference is called out below.
>
> Anything not stated here was not verified. Do not infer.

---

## 0. Two traps to avoid before you read anything else

**Trap 1 — `/pac/*` in the docs is a DIFFERENT product.** The pages under
`docs.dojo.tech/pac/` document the *Dojo-only Pay at Counter **WebSockets** API*:

| | This reference (what we use) | `/pac/*` (what we do NOT use) |
|---|---|---|
| Transport | HTTPS REST | WebSocket |
| Base URL | `https://api.dojo.tech` | `wss://api.dojo.tech/ws/v2/pac/epos` |
| Auth | `Basic <key>`, **not** base64 | `accountName:apiKey`, **base64-encoded** |

They share the name "Pay at Counter" and nothing else. Reading `/pac/` pages
while building this integration is the fastest way to get the auth wrong.

**Trap 2 — Pay at Table is the reverse direction.** "Pay at Table" / EPOS Data
has Dojo's products calling *into* our POS (capability registration, WebSocket).
We drive Dojo, so it does not apply. We want **Pay at Counter → Terminals API**.

---

## 1. Auth, base URL, versioning

- **Base URL:** `https://api.dojo.tech` — identical for sandbox and production.
  The **API key prefix** selects the environment: `sk_sandbox_…` vs `sk_prod_…`.
- **Auth header:** `Authorization: Basic <api_key>` — the literal word `Basic `,
  then the raw key. **Not base64-encoded**, despite the name. Verified against
  the api-keys page's worked example.
- **Version header:** `version`, `YYYY-MM-DD` scheme, **required on every call**.
  Published versions: **`2026-02-27`** (current, what we send), `2025-09-10`,
  `2024-02-05`, and `2022-04-07` (Payments API). Dojo never auto-upgrades you.
- **Content-Type:** `application/json`.
- **Key is location-bound.** Accounts are two-tier, Company → Location; each
  Location has its own sandbox and production keys.

### Per-endpoint headers (from the OpenAPI spec — this corrects earlier notes)

| Endpoint | `version` | `software-house-id` | `reseller-id` | `idempotencyKey` |
|---|---|---|---|---|
| `POST /payment-intents` | required | — | — | — |
| `GET /payment-intents/{id}` | required | — | — | — |
| `GET /terminals` | required | **required** | optional | — |
| `POST /terminal-sessions` | required | **required** | optional | — |
| `GET /terminal-sessions/{id}` | required | **required** | optional | — |
| `PUT /terminal-sessions/{id}/signature` | required | **required** | optional | — |
| `PUT /terminal-sessions/{id}/cancel` | required | **required** | optional | — |
| `POST /payment-intents/{id}/refunds` | required | — | — | **required** |

Notes:
- `reseller-id` is **optional**, not required as previously documented here. We
  send it anyway — harmless, and Dojo's own examples include it.
- The refund idempotency header is spelled `idempotencyKey` in the spec. HTTP
  header names are case-insensitive (RFC 9110), so our `IdempotencyKey` is
  equivalent — but it is **required**, so never omit it.
- Sandbox dummy ids `softwareHouse1` / `reseller1` are Dojo's public test values.
  Production values are assigned by Dojo during partner onboarding.

---

## 2. The sale flow

```
1. POST /payment-intents                    → create the charge
2. GET  /terminals?statuses=Available       → discover a machine (or use a configured TID)
3. POST /terminal-sessions                  → bind intent to terminal; this WAKES the machine
4. GET  /terminal-sessions/{id}   (poll ~1s) → watch status
   └ if SignatureVerificationRequired:
     PUT /terminal-sessions/{id}/signature {accepted}
5. GET  /payment-intents/{id}               → read final transactionId / authCode / card
```

**Step 1 — create intent.** `value` is in **minor units** (1000 = £10.00).
`captureMode: "Auto"` charges immediately (our case); `"Manual"` pre-authorises.

```json
{ "amount": { "value": 1000, "currencyCode": "GBP" },
  "reference": "Order-234", "captureMode": "Auto" }
```

**Step 3 — create session.** Exactly one of `sale` / `matchedRefund` /
`unlinkedRefund` must be present, and it must agree with `sessionType`:

```json
{ "terminalId": "tm_sandbox_65c5fe8a104a1222b2d8b968",
  "details": { "sessionType": "Sale",
               "sale": { "paymentIntentId": "pi_sandbox_G_FeegU8WESxtY_Nct8jqw" } } }
```

Spec detail (verified): `unlinkedRefund` takes `amount` (a `Money` object) and an
optional `cardholderNotPresent`; `matchedRefund` takes `paymentIntentId` plus an
**optional** `amount` for partial card-present refunds.

**Step 5 — final result.** On success `status: "Captured"` with `paymentDetails`
carrying `transactionId`, `authCode`, `message`, and `card` (masked
`cardNumber`, `cardType`, `entryMode`, `verificationMethod`). Persist these.

---

## 3. Session status machine

| Status | Meaning | Action |
|---|---|---|
| `InitiateRequested` | sent to terminal | keep polling |
| `Initiated` | awaiting card | keep polling |
| `Authorized` | pre-auth done (Manual) | stop; capture later |
| `Captured` | **success** | stop ✅ |
| `SignatureVerificationRequired` | operator must decide | call the signature endpoint |
| `SignatureVerificationAccepted` | accepted → captured | stop ✅ |
| `SignatureVerificationRejected` | rejected → reversed | stop ❌ |
| `CancelRequested` | cancel sent | keep polling |
| `Canceled` | cancelled, no payment | stop |
| `Declined` | issuer declined | stop ❌ — **reuse the intent** to retry |
| `Expired` | disconnect — **result unknown** | stop → §5 |

`Refunded` / `Reversed` are **payment-intent** states, not session states.
`notificationEvents[]` carry screen prompts (`PresentCard`, `EnterPin`,
`RemoveCard`, …) that the go-live checklist requires you to show staff.

**The 80-second signature rule.** After `SignatureVerificationRequired` the
operator has 80 seconds. With no decision, Dojo **finalises as accepted** and the
sale proceeds (`Captured` for auto-capture, `Authorized` for manual). A rejection
sent after the timeout does nothing — the sale already succeeded. The UI must not
promise staff that a late reject will undo the payment.

---

## 4. Refund, reversal, cancel — four different tools

| Action | Call | When |
|---|---|---|
| Cancel intent | `DELETE /payment-intents/{id}` | still `Created`, never authorised |
| Cancel session | `PUT /terminal-sessions/{id}/cancel` | before the card is presented; **PUT**, not DELETE — the session is not deleted |
| Reversal | `POST /payment-intents/{id}/reversal` | same-day-ish, full amount only |
| Refund (remote) | `POST /payment-intents/{id}/refunds` | after capture, customer absent; full or partial; needs `idempotencyKey` |
| Refund (card present) | `POST /terminal-sessions` with `MatchedRefund` or `UnlinkedRefund` | customer + card at the machine |

**Go-live gate:** Dojo mandates **at least one working refund path** before
approving production.

---

## 5. Errors and the `Expired` case

| HTTP | Cause | POS must |
|---|---|---|
| 400 | bad request | fix before release |
| 401 | invalid key | clear "check your API key" message |
| 404 | terminal offline / unknown TID | tell staff to check the device |
| 422 | e.g. cancelling after card presented | explain, continue the prior request |

**`Expired` is not a failure.** It means the API↔terminal link dropped and the
result is genuinely unknown. The checklist requires a dialogue telling staff to
**check the card machine screen**, then offering **record as paid** or **retry**.
Never silently treat it as declined.

---

## 6. Sandbox testing — no hardware needed

The `/development-resources/testing` page only covers **online** test cards and
says Dojo issues *physical* POS test cards. The virtual-terminal trick is
documented elsewhere: in the **Pay at Counter go-live checklist** test tables,
which repeatedly say "using a Virtual Machine with `TID` ending in …".

| TID suffix | Forced outcome |
|---|---|
| `SIP0` | success (chip/PIN) **and** the signature-verification path |
| `DIP0` | declined |
| `TIP0` | expired |
| `SIS0` | refund requiring signature verification |

So happy path, decline, expiry, signature accept/reject/timeout and refunds are
all testable with only a sandbox key. Generate your **own** sandbox key — the one
in the public docs is shared.

---

## 7. Go-live checklist (Dojo QA gate)

- API key **configurable, never hard-coded**; a wrong key shows a clear error.
- Terminal discovery via `GET /terminals` or a configurable TID — **never hard-coded**.
- Create intent (Auto; Manual optional), retrieve, cancel, list/search.
- MOTO: `cardHolderNotPresent: true` skips "Present Card" → key entry.
- **At least one refund path** (mandatory), full and partial.
- Handle every outcome: declined (and intent reuse), expired, signature
  accept/reject/80s-timeout, cancel from POS **and** from the PDQ, busy terminal.
- Poll `GET /terminal-sessions/{id}` ~once per second and surface
  `notificationEvents` to staff.
- Report the API version and minimum POS version to Dojo.

Sandbox → production is env-only: swap the key prefix, swap the dummy
`software-house-id` for the Dojo-assigned value, repoint webhooks.

---

## 8. Webhooks

- Subscribe: `POST /webhooks` `{ "events": [...], "url": "https://…" }` (public HTTPS).
- Payment-intent events: `payment_intent.created`, `payment_intent.status_updated`,
  `payment_intent.send-receipt`.
- Terminal-session events: `terminal_session.created`, `.status_updated`,
  `.signature_verification_required`, `.notification`. Ordered per session.
- Delivery: any `2xx` = accepted; `4xx`/`5xx` retried up to **12 times** with
  exponential backoff. **At least once — handle idempotently.**
- **Signature (verified byte-for-byte):** header `Dojo-Signature`
  (case-insensitive). Compute `HMAC-SHA256(rawBody, secret)`, then format as
  `sha256=` + **uppercase** hex bytes **joined by `-`**:

  ```
  sha256=4B-49-F8-FE-25-A7-E6-7D-00-4F-A7-9C-F8-0B-63-00-C7-77-B4-F2-2D-E5-E1-22-84-FA-04-18-50-A1-76-FD
  ```

  Hash the **raw** body — never re-serialise the parsed JSON. Compare in
  constant time.

---

## 9. Commercial gate (not code)

Sandbox needs only a sandbox key, obtained through the restaurant's Dojo account
or partner onboarding (not self-serve like Stripe). Production needs the merchant
onboarded, Dojo-assigned `software-house-id`, a physical terminal, and a QA pass.
Partner contact `partnertech@dojo.tech`; portal `https://developer.dojo.tech`;
samples `https://github.com/dojo-engineering/dojo-samples`.
