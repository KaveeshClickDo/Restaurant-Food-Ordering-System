# 01 · Audit — POS sale call graph

End-to-end trace of a single POS sale from "cashier taps Pay" to "kitchen
ticket appears", based on the actual code in the current commit. No
comments-as-truth — every claim references a verified code path.

## Top-level flow

```
[ User taps "Pay" in SaleView ]
            │
            ▼
[ POSContext.completeSale (async) ]
            │
            ▼
[ POST /api/pos/sales (route.ts) ]
            │
            ├──► requirePosSession()           (auth gate)
            ├──► parseBody(PosSaleCreateSchema) (Zod validation)
            ├──► requirePosPermission("canApplyDiscount") (if discount > 0)
            ├──► Server recomputes subtotal + total, rejects if drift > 5p
            ├──► Idempotency pre-check on body.id    → 200 + duplicate=true
            ├──► Menu items validation               → 400 if any item gone
            ├──► decrementStock() [RPC: decrement_stock_atomic] → 409 if short
            ├──► Gift card lookup + clamp            → 400 if code bad
            ├──► INSERT pos_sales (receipt_no via pos_receipt_seq default)
            │        └─ on 23505 (dup id race): restoreStock + return duplicate
            │        └─ on other error: restoreStock + 500
            ├──► redeemGiftCardForRow (awaited)
            └──► pushToKDS() → INSERT orders row (KDS feed) — fire-and-await
            │
            ▼
[ JSON response: { ok, sale, kds } ]
            │
            ▼
[ POSContext.completeSale post-process ]
            │
            ├──► setSales([sale, ...prev])           (local cache)
            ├──► loyalty point bump + PATCH /api/pos/customers/[id]  (fire-and-forget)
            └──► clearCart()
            │
            ▼
[ SaleView shows ReceiptModal ]
```

## Hop-by-hop, with file:line refs

### Hop 1 — UI tap

[app/src/components/pos/SaleView.tsx:55-66](../../app/src/components/pos/SaleView.tsx#L55-L66)

```ts
async function handlePaymentComplete(
  method, payments, cashTendered, giftCard,
) {
  const { sale, error } = await completeSale(method, payments, cashTendered, giftCard);
  if (!sale) {
    alert(error ?? "Couldn't save the sale to the server. Check your network and try again.");
    return;
  }
  setShowPayment(false);
  setShowMobileCart(false);
  setCompletedSale(sale);                              // ← opens ReceiptModal
}
```

`completeSale` comes from `usePOS()` ([POSContext.tsx:1247](../../app/src/context/POSContext.tsx#L1247)).

### Hop 2 — Client side completeSale

[app/src/context/POSContext.tsx:962-1096](../../app/src/context/POSContext.tsx#L962-L1096)

Key behavior:

| Step | Line | What it does |
|------|------|--------------|
| Compute subtotal/discount/tax/total locally | 973-981 | Same formula the server will recompute. Rounded to 2dp with `round2()` before send. |
| Build payload | 988-1015 | `receiptNo` is **omitted** — the server allocates it. `id` is a client UUID for idempotency. |
| POST `/api/pos/sales` | 1020 | `await` — *blocks* until response. No local fallback. |
| Treat 200 or 409 as success | 1027-1030 | 409 = idempotent duplicate (outbox replay scenario, even though the outbox is gone today). |
| On any other failure | 1034-1043 | Return `{ sale: null, error }`. **No local persistence.** |
| `setSales([sale, ...prev])` | 1052 | Only after the DB write is durable. |
| Loyalty bump | 1054-1084 | Optimistic in-memory + fire-and-forget PATCH. Tolerable to fail. |
| `clearCart()` | 1094 | Resets cart. |

**Critical for offline plan**: this whole function is online-only by
construction. The server allocates the receipt number; the client has no
way to mint one. Offline mode has to either pre-allocate a receipt range
or use a per-terminal scheme — discussed in `00-architecture.md`.

### Hop 3 — Server side, route entry + auth

[app/src/app/api/pos/sales/route.ts:79-95](../../app/src/app/api/pos/sales/route.ts#L79-L95)

```ts
export async function POST(req: NextRequest) {
  const gate = await requirePosSession();          // ← cookie check + pos_staff lookup
  if (!gate.ok) return gate.response;
  const session = gate.staff;

  const parsed = await parseBody(req, PosSaleCreateSchema);  // ← Zod validation
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data as unknown as Partial<POSSale> & { kitchenNote?: string };

  if ((body.discountAmount ?? 0) > 0) {
    const discountGate = await requirePosPermission("canApplyDiscount");
    if (!discountGate.ok) return discountGate.response;
  }
```

- `requirePosSession` ([posPermissions.ts:94-103](../../app/src/lib/posPermissions.ts#L94-L103)) reads
  the `pos_staff_session` cookie via `getPosSession()` then looks up the
  `pos_staff` row by id. Returns 401 if either step fails.
- `parseBody(req, PosSaleCreateSchema)` defined in [schemas/pos.ts:18-49](../../app/src/lib/schemas/pos.ts#L18-L49)
  — accepts a permissive cart shape via `.passthrough()`, requires `id`
  and non-empty `items`.
- Discount perm gate: only `canApplyDiscount` operators may submit a
  discount > 0.

### Hop 4 — Totals recompute (anti-tamper)

[app/src/app/api/pos/sales/route.ts:104-148](../../app/src/app/api/pos/sales/route.ts#L104-L148)

- Server recomputes `subtotal` from `items` via `cartLineTotal()`.
- Computes `total = subtotal − discount + tip + (taxInclusive ? 0 : tax)`.
- Hard caps discount to ≤ subtotal (+1p tolerance).
- Rejects with 400 if claimed subtotal or total drifts by more than 5p.

### Hop 5 — Idempotency pre-check

[app/src/app/api/pos/sales/route.ts:155-161](../../app/src/app/api/pos/sales/route.ts#L155-L161)

```ts
if (body.id) {
  const { data: existing } = await supabaseAdmin
    .from("pos_sales").select("*").eq("id", body.id).maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true, sale: rowToSale(existing) }, { status: 200 });
  }
}
```

The comment on this block explicitly says: *"The POS outbox replays
sales after transient failures."* — i.e. the **server is already
prepared for an outbox-based offline mode that the client side no
longer has.** This is one of the half-broken seams the audit flags.

### Hop 6 — Menu item validation

[app/src/app/api/pos/sales/route.ts:177-224](../../app/src/app/api/pos/sales/route.ts#L177-L224)

For every line with a `productId`, looks up the row in `menu_items`
and rejects with 400 if:
- Row is missing (admin deleted it)
- `active = false`
- `channels` doesn't include `"in_store"` (online-only)
- `track_stock = false` AND `stock_status = "out_of_stock"` (manual OOS)

**Offline implication**: this validation cannot run on the client when
offline. Offline sales must accept the cached menu state and reconcile
on sync — see policy in `07-phases.md` (Phase 3).

### Hop 7 — Atomic stock decrement

[app/src/app/api/pos/sales/route.ts:226-237](../../app/src/app/api/pos/sales/route.ts#L226-L237) calls
[stockMutation.ts:58-91](../../app/src/lib/stockMutation.ts#L58-L91):

```ts
const { error } = await supabaseAdmin.rpc("decrement_stock_atomic", { p_items: payload });
```

The Postgres function (`decrement_stock_atomic`) wraps all per-line
decrements in a single transaction. On insufficient stock it raises
P0001 with details; the route returns 409.

**Offline implication**: decrement happens server-side. Offline sales
will hit this only on sync. Race condition: another online sale between
the offline write and the sync could leave the offline sale failing
stock check. Policy required (oversell allowed vs. reject).

### Hop 8 — Gift card lookup + clamp

[app/src/app/api/pos/sales/route.ts:249-266](../../app/src/app/api/pos/sales/route.ts#L249-L266) calls
helpers in [giftCardValidation.ts](../../app/src/lib/giftCardValidation.ts):
- `lookupActiveGiftCard(code)` — DB lookup, validates active status.
- `clampGiftCardAmount(...)` — caps the claimed redeem to min(balance, total, requested).

**Offline implication**: cannot validate gift cards offline against
live balance. Options: (a) cache balances at sync and accept best-effort
or (b) disable gift card tender offline. Recommended (b) — simpler and
matches the user's "you can't unsell food" pragmatism elsewhere.

### Hop 9 — INSERT pos_sales

[app/src/app/api/pos/sales/route.ts:268-322](../../app/src/app/api/pos/sales/route.ts#L268-L322)

- Receipt number filled by DB default: `'R' || nextval('pos_receipt_seq')` — see
  [schema.sql:470](../../supabase/schema.sql#L470).
- `staff_id` / `staff_name` are taken from `session`, not body (body is
  ignored — anti-tamper).
- On 23505 (duplicate id): restoreStock + return 409 with the existing
  row. The duplicate id race window is between the pre-check (hop 5) and
  this insert.
- On any other error: restoreStock + 500.

### Hop 10 — Gift card redeem

[app/src/app/api/pos/sales/route.ts:330-338](../../app/src/app/api/pos/sales/route.ts#L330-L338)

Awaited — balance is debited before responding. Idempotent on
`(giftCardId, posSaleId)` so an outbox replay doesn't double-debit.

### Hop 11 — KDS push (fire-and-await)

[app/src/app/api/pos/sales/route.ts:344, 350-418](../../app/src/app/api/pos/sales/route.ts#L350-L418)

`pushToKDS(sale, kitchenNote)`:

- Upserts the sentinel `pos-walk-in` customer (idempotent).
- Builds an `orders` row with `fulfillment: "collection"` and a structured
  `note` containing `[POS]` marker, customer, staff, receipt no.
- INSERTs into `orders`. On duplicate (23505) treats as success — outbox
  replay would re-insert otherwise.
- On any other failure, returns `{ ok: false, error }` to the caller —
  surfaced in the `kds` field of the API response. The sale is **not**
  rolled back; the audit/tax record is the legal source of truth.

### Hop 12 — Response → client

The route returns `{ ok: true, sale, kds }`. The client uses `sale` to
open `ReceiptModal`. The `kds` field is currently not surfaced in the
UI; KDS failures are silently logged.

## What this flow assumes that breaks offline

Numbered items match the "three correctness problems" in `00-architecture.md`.

| Assumption | Code reference | Breaks offline? | Required fix |
|---|---|---|---|
| 1. Receipt number is server-allocated | [schema.sql:470, 481](../../supabase/schema.sql#L470) | Yes | Per-terminal receipt scheme + DB schema change |
| 2. Stock decrement is server-side atomic | [route.ts:234](../../app/src/app/api/pos/sales/route.ts#L234), [stockMutation.ts:62](../../app/src/lib/stockMutation.ts#L62) | Yes | Cache last-known stock locally, reconcile on sync, oversell policy |
| 3. Gift card lookup hits live balance | [route.ts:256](../../app/src/app/api/pos/sales/route.ts#L256) | Yes | Disable gift card tender offline (recommended) |
| 4. Menu validation requires live menu_items | [route.ts:181-184](../../app/src/app/api/pos/sales/route.ts#L181) | Yes (best-effort offline) | Accept cached menu, reconcile on sync |
| 5. PIN check requires `pos_staff` row read | [posPermissions.ts:34-40](../../app/src/lib/posPermissions.ts#L34-L40) | Yes | Cache `pin_hash` + permissions locally, validate locally for offline |
| 6. Loyalty PATCH is fire-and-forget | [POSContext.tsx:1079-1083](../../app/src/context/POSContext.tsx#L1079-L1083) | No | Already tolerant — queue it the same as the sale |
| 7. KDS push is server-to-server | [route.ts:408](../../app/src/app/api/pos/sales/route.ts#L408) | No (server handles it on sync) | None — runs server-side at sync time naturally |
| 8. `pos_sales` row has client-supplied id | [route.ts:155-161](../../app/src/app/api/pos/sales/route.ts#L155-L161) | No — already ID-driven | Already idempotent; no change |
| 9. Server is already coded to accept replays | [route.ts:151-154 comment](../../app/src/app/api/pos/sales/route.ts#L150-L154) | No | **Confirms the architecture intent**: the server-side outbox protocol exists; the client side just needs to be reconnected |

## Half-broken seams found during this audit

These are referenced in `03-audit-android.md` but called out here because
they showed up while tracing the call graph:

1. **Server expects an outbox; client has no outbox.** Route.ts
   comments and the 200+409 dual-success path are designed for an
   offline outbox client. The client posts synchronously and bails on
   failure ([POSContext.tsx:1043-1050](../../app/src/context/POSContext.tsx#L1043-L1050)). The
   server's idempotent-by-id design is unused.
2. **Android workers post to `/api/pos/sales` from SharedPreferences.**
   [OutboxSyncWorker.kt:88-96](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/OutboxSyncWorker.kt#L88-L96)
   reads `pos_outbox` from native SharedPreferences and posts to the same
   endpoint. The web app no longer writes to `pos_outbox` (the file
   `posOutbox.ts` was deleted in commit `242be44`). So:
   - Web: writes nothing to the outbox; posts directly and fails offline.
   - Android: WebView writes nothing to `pos_outbox` either, so SharedPreferences
     stays empty, and OutboxSyncWorker drains an empty queue every 15 minutes.

## What ports to offline cleanly

These pieces require **no architectural change** to support offline —
they already work as long as the offline path can call them or store
them locally:

- Cart math, modifier resolution, line totals (`cartLineTotal`).
- Receipt HTML rendering (`_receipts.ts` / `buildReceiptHtml`).
- Discount + tip UI math.
- Native printer plugins (BT / USB / TCP) via `capacitorBridge.ts`.
- Local connectivity probe (`useConnectivity` → `/api/ping`).

These are the pieces the offline mode reuses **without modification**.
