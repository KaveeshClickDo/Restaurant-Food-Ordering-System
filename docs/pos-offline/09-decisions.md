# 09 · Decisions log

Append-only. Every non-obvious decision made during implementation goes
here with date + reason. Future-you (and future-me in another session)
reads this to understand *why* something is the way it is when the code
no longer makes it obvious.

Format: dated `## YYYY-MM-DD § short title` headings. Older entries
stay where they are; newer ones go on top.

---

## 2026-06-23 § Offline receipt numbers — `OFF<seq>` from 1000 + "OFFLINE SALE" label (single-terminal)

**Decision:** Offline sales get a readable `OFF<seq>` receipt number starting at
**1000** (mirrors online `R<seq>`, whose sequence also starts at 1000), and every
surface that shows a POS receipt badges offline sales **"OFFLINE SALE"**.

**Why:** the old offline format `OFF-<base36 timestamp>-<2 random>` was
collision-resistant but **unreadable** for customers/cashiers. The user only
runs a **single till for now**, so a simple device-local counter is enough — no
need for the multi-terminal `T<prefix>-<seq>` scheme (deferred; and if ever
added, the prefix must NOT be "T" because dine-in **tables** are labelled T1,
T2…). Research (Lightspeed et al.) confirms the industry pattern: a temporary,
distinct offline number reconciled on sync, receipt labelled "OFFLINE SALE".

**How it works:**
- `nextOfflineReceiptNo()` in [POSContext.tsx](../../app/src/context/POSContext.tsx)
  reads+bumps a persistent counter (`offline_receipt_seq` in the encrypted
  kv_cache, default 1000) → `OFF1000`, `OFF1001`, … Capacitor-only.
- Own namespace, so it never clashes with the server's `R` sequence; the
  `pos_sales.receipt_no` UNIQUE constraint is the backstop.
- `isOfflineSale(receiptNo)` ([components/pos/_utils.ts](../../app/src/components/pos/_utils.ts))
  = `receiptNo.startsWith("OFF")`. Drives the **"OFFLINE SALE"** label in the
  on-screen receipt ([ReceiptModal](../../app/src/components/pos/ReceiptModal.tsx)),
  the printed/HTML receipt ([_receipts.ts buildReceiptHtml](../../app/src/components/pos/_receipts.ts)),
  and **"OFFLINE"** badges in the admin POS Reports list + POS dashboard table.

**Edge case:** wiping app data resets the counter to 1000; a reused `OFF1000`
would then be rejected by the UNIQUE constraint on sync (that one sale fails to
upload — recoverable, never a duplicate). Acceptable for single-terminal.

## 2026-06-22 § Phase 4 offline PIN login — reuse the cookie, don't store the PIN

**Decision:** Offline login validates the PIN locally with bcrypt against a
cached hash, then **reuses the existing session cookie** (native cookie jar from
the last online login) for sync. We do NOT store the plaintext PIN and do NOT
mint a client-side session token.

- New `GET /api/pos/staff/credentials` returns **only the caller's own**
  `pin_hash` + `session_version` (session-gated, rate-limited 5/min).
- `POSContext.login()`: online success → also caches `{pinHash, sessionVersion}`
  keyed by staffId (`staff_credentials` in kv_cache, Capacitor-only). On a
  network failure it falls back to `offlineLogin()` → `bcrypt.compare` against
  the cached hash → `setCurrentStaff` from the cached picker.
- **Reconnect / invalidation is already handled** by the existing 15s
  `checkSession()` poll: it GETs `/api/pos/auth` with the jar cookie, which the
  server validates against the live `session_version` + `active`. So an
  admin PIN reset or deactivation forces a re-login on reconnect with no new
  code. The offline window is the only exposure (bounded; plan 4.2 #5).

**Why reuse-cookie over a client session token:** the queued-sale drain POSTs
`/api/pos/sales` which requires the httpOnly cookie. Reusing the jar cookie
means sync "just works" on reconnect (within the 8h cookie life). If the cookie
expired during a long outage, the reconnect probe 401s → online re-login →
fresh cookie. No plaintext PIN ever persisted.

**Deferred (follow-ups, not blocking the flow):**
- `pendingRevalidation` gate on destructive actions (void/refund) until the
  first online revalidation — those already fail offline (server-only), so low
  risk; add before multi-cashier production.
- **Encrypt the on-device credentials table** with a device-bound key (Android
  Keystore). v1 stores the bcrypt hash in plain SQLite; a 6-digit PIN is
  brute-forceable against a stolen hash DB given time. Required before a real
  customer release. See 07-phases § 4.3.

## 2026-06-22 § getDbSettings() hoist is NOT needed — keep the server fetch (it's the offline first-paint fallback)

**Decision:** Leave [layout.tsx](../../app/src/app/layout.tsx) `getDbSettings()`
as-is (server-side, runs at build time for the Capacitor export). Do **not**
hoist it client-side as 07-phases.md § 1.5.1/1.5.5 proposed.

**Why the plan's two premises were both wrong:**
1. *"Static export fails because of the root-layout server fetch."* It
   doesn't — `npm run build:capacitor` succeeds with `getDbSettings()` in
   place (a build-time fetch is normal SSG; `revalidate` is ignored
   gracefully under export). Verified 2026-06-22.
2. *"Hoisting fixes offline settings."* It doesn't. The POS reads tax
   rate / VAT mode / currency from `appSettings` (AppContext), and
   [AppContext.tsx:692-703](../../app/src/context/AppContext.tsx#L692-L703)
   already re-fetches `app_settings` from Supabase **client-side on every
   mount**, overwriting the baked `initialData`. So:
   - **Online** bundled APK → AppContext refetch corrects settings anyway;
     the hoist changes nothing.
   - **Offline** cold-start → a client-side hoist fetch would *also* fail
     (no network); real offline settings come from Phase 1.6's SQLite
     `settings_snapshot`, not from the layout.

**Bonus — keeping it is strictly better for offline:** with
`getDbSettings()` left in, the export bakes the *real* build-time settings
as the offline first-paint fallback (until Phase 1.6's live cache lands).
Hoisting would replace that with hard-coded defaults → wrong VAT on a cold
offline boot. So the "optional refinement" is actually a mild regression
for the offline goal; dropped from the Phase 1.5 remaining list.

**Caveat:** the build environment should have `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` set during `build:capacitor` so the baked
fallback is real settings, not defaults. If absent, getDbSettings returns
null → defaults baked (harmless online, suboptimal offline pre-1.6).

## 2026-06-22 § Capacitor static export: route quarantine + single gated next.config (not a separate config file)

**Decision:** The Capacitor static export is produced by
[scripts/build-capacitor.mjs](../../app/scripts/build-capacitor.mjs)
(run via `npm run build:capacitor`), which temporarily moves every
`src/app` entry except the POS routes into `.cap-quarantine/`, runs
`CAPACITOR_BUILD=1 next build`, then restores them (try/finally; also
self-heals on startup). The export options (`output:"export"`,
`trailingSlash:true`, `images.unoptimized`, and dropping
`rewrites()`/`headers()`) live in the existing
[next.config.ts](../../app/next.config.ts) gated by `CAPACITOR_BUILD`,
**not** in a separate `next.config.capacitor.ts` as 07-phases.md
originally sketched.

**Why:**
- `output:"export"` is global — Next tries to export *every* route and
  hard-fails on the first of the ~80 `/api/*` route handlers
  (`Page "/api/…" is missing "generateStaticParams()"`). There is no
  built-in "export only these routes" flag, so the non-POS routes must
  physically leave the build graph. Quarantine-and-restore is the
  least-bad mechanism; git is the safety net (all quarantined dirs are
  committed, so `git checkout -- src/app` always recovers).
- A single env-gated `next.config.ts` is simpler and less drift-prone
  than a second config file (Next has no first-class "use this other
  config" switch; you'd juggle file renames). One file, one
  `CAPACITOR_BUILD` flag, both builds verified.

**Verified 2026-06-22:**
- `npm run build` (web) → `/pos` `○ Static`, `width=device-width`.
- `npm run build:capacitor` → exports only `/pos` + `/pos/login` to
  `out/pos/index.html` + `out/pos/login/index.html`, both `○ Static`,
  viewport `initial-scale=0.6` baked in. Routes restored cleanly
  (`git status` clean afterward).

**Still open before the bundle is a working APK:**
- ~~`apiBase()` wiring~~ **DONE 2026-06-22.** All 47 POS-tree `/api/*`
  fetches now go through `apiBase()` ([lib/apiBase.ts](../../app/src/lib/apiBase.ts)):
  `""` on web (same-origin, unchanged), and the build-time
  `NEXT_PUBLIC_API_BASE_URL` (from `CAPACITOR_SERVER_URL`) in the
  Capacitor build. Verified the URL is inlined into the export bundle.
- ~~`capacitor.config.ts` bundled mode~~ **DONE 2026-06-22.** Config is
  now dual-mode: `CAPACITOR_SERVER_URL` set → server mode (dev
  hot-reload), unset → bundled mode (`webDir:"out"`, offline APK). The
  apiBase URL for bundled builds comes from a separate `CAPACITOR_API_URL`
  (build:capacitor) so it can't accidentally re-enable server mode.
  Remaining is the off-machine step: `npx cap sync android` + APK build.
- Optional: hoist `getDbSettings()` client-side so the APK doesn't bake
  build-time settings (non-blocking — export already succeeds).

## 2026-06-22 § CORRECTION: server-side UA detection in the root layout blocks static export — move Capacitor branches to build-time

**Decision:** Capacitor-only behaviour that affects the initial HTML
(currently just the viewport) must branch at **build time**, not per
request. [layout.tsx](../../app/src/app/layout.tsx) `generateViewport()`
no longer calls `headers().get("user-agent")`; it reads a build-time env
flag (`CAPACITOR_BUILD`) instead. The Capacitor static-export build sets
it; the web build leaves it unset and keeps `width: device-width`.

**Why this corrects the 2026-06-03 viewport entry:** That entry called
the UA-detection pattern (`appendUserAgent: "RestaurantPOS"` →
`headers().get("user-agent")` in a server component) "the blueprint for
*all* future Capacitor-only behaviour." That guidance is **wrong for any
build we intend to statically export.** Reading `headers()` is a Next.js
*dynamic function*: calling it anywhere in the root layout opts **every
route** into per-request server rendering (`ƒ Dynamic`), which makes
`output: "export"` impossible. Phase 0 verified `/pos` was `○ Static`;
the 2026-06-03 viewport fix silently flipped the whole app to `ƒ` —
unnoticed because the app was running in Capacitor **server mode** at the
time, where dynamic rendering is harmless. It only becomes a blocker at
**Phase 1.5** (bundled static assets for true offline cold-start).

It was a correct fix for server mode, made before the static-export goal
was in scope, and the cross-phase conflict was never recorded. This entry
records it.

**How to apply:**
- Capacitor-only logic in the **root layout / metadata / viewport** →
  gate on `process.env.CAPACITOR_BUILD` (build-time), never `headers()`.
- Capacitor-only logic in **client components** → keep using
  `isCapacitorAndroid()` (`Capacitor.isNativePlatform()`); that's
  client-runtime and does not affect static-ness.
- Never call `headers()`, `cookies()`, or `draftMode()` from the root
  layout subtree that the Capacitor export depends on.
- The wide viewport (`initialScale: 0.6`) is unchanged in behaviour — it
  now ships baked into the Capacitor build instead of being chosen per
  request. The `appendUserAgent: "RestaurantPOS"` token stays useful for
  *server-side logging* of Capacitor hits, just not for viewport gating.

**Still open (full Phase 1.5):** the root layout's `getDbSettings()`
fetch is fine for a normal web build but must be hoisted out of the
server render for a true `output: "export"` build (it would otherwise
bake build-time settings into the APK). Tracked in
[07-phases.md § 1.5.5](./07-phases.md). This entry only removes the
`headers()` blocker; the export-config + getDbSettings hoist is the
remaining 1.5 work.

## 2026-06-03 § Receipt mint timing: `OFF-…` minted INSIDE the offline fallback only, not upfront

**Decision:** [POSContext.completeSale](../../app/src/context/POSContext.tsx)
no longer mints an `OFF-…` provisional receipt before the network POST.
The online path POSTs to `/api/pos/sales` with **no `receiptNo`** field;
the server allocates `R<seq>` from `pos_receipt_seq`. The `OFF-…`
provisional is minted **only** inside the offline-fallback branch
(network/5xx failure) right before `enqueueSale`.

**Why:** On 2026-06-02 the Capacitor APK was tested online and every
sale came back with an `OFF-…` receipt instead of the expected `R<seq>`.
Root cause: the old code minted the provisional upfront and put it in
the payload regardless of network state. The server's POST handler
respects `body.receiptNo` if present (used by the outbox drain to
preserve identity across retries), so a "happily online" sale was being
recorded with an offline-shaped receipt. The fix decouples mint timing
from network outcome: provisional minting is a fallback concern, not a
setup concern.

**How to apply:**
- Online Capacitor sales → server-allocated `R<seq>` (matches web).
- Offline Capacitor sales → client-minted `OFF-…` carried by the outbox.
- Outbox drain at reconnect → server sees `body.receiptNo = "OFF-…"`,
  preserves it (so the cashier's printed receipt still matches the DB
  row). It does NOT reallocate — that would break audit continuity.
- Idempotency UUID (`body.id`) is always client-supplied (online and
  offline) so retries are idempotent regardless of receipt source.
- Tested: online sale → `R12`. Offline sale → `OFF-LJZ8K2-A7`.
  Reconnect drain → row in `pos_sales` with `OFF-…` receipt preserved.

**Caveat:** when Phase 2 introduces per-terminal sequences
(`T<prefix>-<seq>`), the offline path will mint a *real* terminal
sequence locally (via the cached counter) rather than the `OFF-…`
provisional. The mint-only-when-offline pattern from this fix stays —
only the format string changes.

## 2026-06-03 § Capacitor viewport: `initialScale: 0.6` for phone landscape; tablet should bump to 0.8–0.9

**Decision:** [app/src/app/layout.tsx](../../app/src/app/layout.tsx)
exports a `generateViewport()` that detects Capacitor via the
`RestaurantPOS` User-Agent token and returns `initialScale: 0.6` with
`userScalable: false`. Web (and Chrome PWA) keep the default
`width: "device-width", initialScale: 1`.

**Why:** Phone landscape (Xiaomi Redmi tested 2026-06-02) reports
854×384 CSS pixels — the cart panel + payment buttons + summary section
overflow vertically at `initialScale: 1`. The user explicitly wanted
the same desktop layout, scaled down, not a responsive mobile reflow.
Several alternatives tried:
- CSS `zoom: 0.6` on `<html>` → left empty space below the content.
- `viewport width=1920` → ignored by WebView until `useWideViewPort`
  was set (see next entry).
- `viewport width=1920 + initial-scale=0.6` → caused horizontal scroll
  because visual width 1920·0.6 = 1152 > 854 device width.
- `initial-scale=0.6` alone → WebView auto-fits to device width at
  that scale; this works.

**How to apply:**
- Phone deployments use `0.6` (current).
- Tablet deployments (10–11" landscape, ~1280×800 CSS) should bump
  this to `0.8–0.9`. Suggest adding a `RestaurantPOS/tablet` UA token
  in [capacitor.config.ts](../../app/capacitor.config.ts) when we ship
  tablet builds, and branching on that token in `generateViewport()`.
- Do NOT set `viewport width=…` for Capacitor — let the WebView
  auto-fit at the chosen scale.
- The UA-detection pattern (`appendUserAgent: "RestaurantPOS"` →
  `headers().get("user-agent")` in a server component) is the
  blueprint for *all* future Capacitor-only behaviour. Reuse it
  before reaching for `Capacitor.isNativePlatform()` (which is
  client-only).

## 2026-06-03 § Android WebView quirks blocking the Capacitor APK bring-up

**Decision:** Three WebView/Android quirks bit us during APK bring-up
and are now baked into the repo (live `app/android/` plus mirrored to
`app/android-src/` so `android-setup.sh` re-runs don't lose them):

1. **`useWideViewPort` defaults to `false`** —
   [MainActivity.kt:46-47](../../app/android/app/src/main/java/com/restaurant/pos/MainActivity.kt#L46-L47)
   now sets `bridge.webView.settings.useWideViewPort = true` and
   `loadWithOverviewMode = true` after `super.onCreate`. Without
   these, the WebView silently ignores `<meta viewport>` width/scale
   directives and renders at device-width.
2. **Next.js auto-fills `initialScale: 1` if you don't specify it** —
   our `generateViewport()` must return an *explicit* `initialScale`
   value, even if it's the default. Omitting it caused our Capacitor
   `0.6` value to be clobbered.
3. **`<domain>` in `network_security_config.xml` is exact-host match,
   not CIDR** — listing `192.168.1.0` does NOT match `192.168.1.16`.
   We switched to a permissive
   [base-config cleartextTrafficPermitted="true"](../../app/android/app/src/main/res/xml/network_security_config.xml)
   ([android-src copy](../../app/android-src/app/src/main/res/xml/network_security_config.xml)).
   Production URLs are HTTPS so this doesn't downgrade them; dev URLs
   and LAN printer sockets all work.

**Why:** Bug-by-bug debugging on 2026-06-02 ate most of a session. See
[SESSION-LOG-2026-06-02.md](./SESSION-LOG-2026-06-02.md) for the full
11-row table including the upstream causes (`crypto.randomUUID` not
available on HTTP LAN, `ClassNotFoundException` from missing Kotlin
plugin, etc.).

**How to apply:**
- The `android-setup.sh` script now also patches the root
  [android/build.gradle](../../app/android/build.gradle) with
  `classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25'` and
  the module [android/app/build.gradle](../../app/android/app/build.gradle)
  with `apply plugin: 'kotlin-android'`. Without these the .kt files
  silently aren't compiled and the WebView crashes on launch with
  `ClassNotFoundException: MainActivity`.
- `crypto.randomUUID()` is gated on a secure context (HTTPS or
  localhost). HTTP LAN dev URLs hit a runtime `is not a function`
  error. The repo uses
  [app/src/lib/uuid.ts](../../app/src/lib/uuid.ts) (Math.random
  fallback). All 16 client files were swept on 2026-06-02. Future
  client code MUST use the `uuid()` helper, not `crypto.randomUUID`
  directly.

---

## 2026-05-29 § Card payment offline ALLOWED — POS is bookkeeping only, terminal is standalone

**Decision:** Card and split (cash + card) payments are now ✅ allowed
in every offline state. Gift card stays ❌ blocked offline.

**Why:** A grep audit of the entire `app/src/` tree on 2026-05-29
returned zero matches for any card-reader integration vendor
(`stripe.terminal`, `cardReader`, `ingenico`, `verifone`, `sumup`,
`paymentTerminal`). [api/pos/sales/route.ts:285](../../app/src/app/api/pos/sales/route.ts#L285)
stores `payment_method: body.paymentMethod ?? "cash"` as a plain string
— no Stripe SDK call, no authorisation step. The Card screen in
[PaymentModal.tsx:280-291](../../app/src/components/pos/PaymentModal.tsx#L280-L291)
literally says *"Present card to terminal"* with a "Payment Received"
confirmation button — confirming the architecture: the cashier hands a
**standalone card terminal** to the customer, the terminal authorises
on its own connection, the cashier records the result on the POS.
Nothing in this flow requires POS-side internet.

The previous "card requires internet" stance (in PaymentModal +
[earlier 11-offline-scope.md](./11-offline-scope.md) + the Android
offline banner) was based on conflating the POS-card flow with the
website checkout's Stripe-card flow. Two completely different paths;
only the website needs Stripe online.

**How to apply:**
- `PaymentModal.tsx`: card + split buttons no longer carry
  `disabled={isOffline}`. Top banner copy updated to "confirm card on
  terminal before tapping Payment Received." Gift card input now gated
  on `isOffline`.
- `pos/page.tsx`: Android offline banner copy updated to "cash and
  card sales will queue."
- [11-offline-scope.md](./11-offline-scope.md): Card and Split rows
  flipped from ❌ to ✅ across columns B/C/D. Gift card stays ❌.
- **Operational rule** (in receipt training / cashier handbook): in
  offline mode, the cashier MUST verify the standalone terminal beeped
  approved before tapping "Payment Received" — same expectation as
  online, but worth calling out for offline because no automated
  retry/refund path exists if a card is incorrectly marked as paid.

**Caveat for the future:** if the restaurant ever upgrades to an
integrated card terminal (Stripe Terminal SDK, Square Reader SDK,
etc.) that the POS commands directly, the offline scope flips back —
because then a POS-side call is required to authorise. That is a
schema / route change at that time; documented here so we don't forget
the assumption.

## 2026-05-29 § Scale-thinking docs 11/12/13 added before Phase 1.5 lands

**Decision:** Three new planning docs ship before any more code:
[11-offline-scope.md](./11-offline-scope.md),
[12-sync-protocol.md](./12-sync-protocol.md), and
[13-conflict-resolution.md](./13-conflict-resolution.md).

**Why:** The user pushed back on the Phase 1 + bundled-mode (1.5)
direction with three valid questions — "what's allowed offline, how do
we sync, how do we resolve conflicts." The plan had partial answers
spread across multiple docs but no consolidated authoritative source.
Several real conflict cases (customer concurrent edits, deactivated
cashier mid-shift, clock drift, multi-tablet swaps, partial-sync
reports) had no documented policy.

**How to apply:** Every new offline-touching feature must trace to a
row in 11 (is it allowed?), a section in 12 (how does it sync?), and —
if it can collide with another mutation — a case in 13 (what wins?).
PR reviewers reject changes that introduce offline behaviour not
grounded in 11-13.

## 2026-05-29 § Customer profile fields use LWW; loyalty + spend are DERIVED

**Decision:** Customer name/email/phone/notes/tags use Last-Write-Wins
keyed on `client_created_at`, with the server rejecting out-of-order
patches with 409 (per [13 § Case 1](./13-conflict-resolution.md)).
`loyalty_points`, `totalSpend`, `visit_count`, `last_visit` are computed
server-side from the `pos_sales + orders` aggregate — no client write
to these is trusted.

**Why:** Derived columns make the "two cashiers offline bump loyalty"
case unconflict-able by construction. LWW for profile fields is honest
about losing data sometimes but matches user expectation ("the most
recent edit wins") and never silently merges.

## 2026-05-29 § Offline sales by a deactivated cashier ACCEPT-AND-FLAG

**Decision:** Sales queued by a cashier who was deactivated by admin
during the offline window sync normally on reconnect, but get
`pos_sales.staff_was_active = false` stamped server-side at insert
time. Per [13 § Case 2](./13-conflict-resolution.md).

**Why:** The cash was real, the food was served. Rejecting the sales
creates a worse inventory/cash mismatch than admin auditing the
deactivated cashier's last shift. The flag column gives full audit
visibility without losing money.

## 2026-05-29 § Long-offline tablet hard caps: 24h soft, 7d hard

**Decision:** Tiered stale-cache policy per
[13 § Case 6](./13-conflict-resolution.md). 0-24h business-as-usual.
24-72h soft banner. 72h-7d hard menu refusal. >7d offline PIN
refusal.

**Why:** "Tablet works offline forever" is a worse failure than
"tablet refuses to ring sales until it reconnects." Hard caps force a
fresh sync at a reasonable cadence and prevent admin from accidentally
deploying a tablet that's silently been running on week-old prices.

## 2026-05-29 § Partial-coverage reports show a banner, don't silently lie

**Decision:** Dashboard / POS Reports detects unsynced terminals and
shows a persistent banner naming each by label and `last_sync_at`. Per
[13 § Case 7](./13-conflict-resolution.md). Admin can override with a
recorded `admin_acknowledged_partial` flag that lands in any printed
report's footer.

**Why:** A manager making a banking decision on incomplete totals is
the kind of operational mistake offline POS has historically caused.
The banner makes the gap unmistakable. The override-with-record
pattern lets admin proceed without losing the audit trail.

## 2026-05-29 § Capacitor stays in server-URL mode for Phase 1 (not bundled assets)

**Decision:** [capacitor.config.ts](../../app/capacitor.config.ts) keeps
its `server.url` block pointing at the deployed Next.js URL. We are NOT
switching to bundled-asset mode (which would require `output: "export"`
and copying `app/.next/server/app/pos*.html` into Android assets).

**Why:** Phase 0 confirmed bundled mode is *mechanically possible* — the
`/pos` routes prerender as static HTML. But the switch carries non-zero
risk (root layout's server-side `getDbSettings()` becomes a build-time
fetch; static export is a project-wide flag that affects every other
route; a second `next.config.capacitor.ts` plus a separate build step
would be needed). Phase 1's first goal is "offline sales work on
Android"; bundled assets only matter for "tablet survives a cold start
with no internet." The service worker registered in Phase 5 covers most
of the cold-start case for browser PWA users; Capacitor's webview is
expected to cache the URL via its own webview cache after first load.

**How to apply:** Phase 1's APK requires internet on first launch to
load the `/pos` page. After first launch the Android WebView caches
HTML/CSS/JS automatically. If real-world testing shows the cache is
unreliable inside the Capacitor WebView, the bundled-mode switch is the
next move (still additive — the JS-side outbox / SQLite / per-terminal
work in Phase 1 all carry forward unchanged).

## 2026-05-29 § WorkManager background workers deferred from Phase 1

**Decision:** [OutboxSyncWorker.kt](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/OutboxSyncWorker.kt) and
[MenuSyncWorker.kt](../../app/android-src/app/src/main/java/com/restaurant/pos/sync/MenuSyncWorker.kt) stay
in the repo but are NOT scheduled by `MainActivity.kt`. The new
`MainActivity.kt` registers the three printer plugins and immediately
calls `super.onCreate(savedInstanceState)` — no `scheduleBackgroundSync()`.

**Why:**
1. The dominant offline scenario is "cashier rings up offline sales,
   reconnects, drain runs." The JS-side `drainOutbox()` in
   [pos/page.tsx](../../app/src/app/pos/page.tsx) handles this every
   time `isOnline` flips true. Phase 1 ships a working offline POS
   without a background worker.
2. The existing worker code reads `pos_outbox` from
   `SharedPreferences`, which is a different store from the Capacitor
   SQLite database. Wiring it correctly requires the worker to either
   open the SQLite file directly (path is plugin-version-specific and
   fragile) or trigger a JS-side drain via `evaluateJavascript` (only
   works when the WebView is alive — defeats the purpose).
3. Rather than ship broken-or-half-broken background sync, we ship no
   background sync and revisit in a later phase with a clean
   implementation.

**How to apply:** Closed-app sync (WebView dead, sales queued in SQLite,
network restored) doesn't happen in Phase 1. Worst case is sync delay —
the queue drains the moment the app is reopened. Documented as a known
limitation; not a data-loss path.

## 2026-05-29 § Provisional `OFF-…` receipt format for Phase 1 offline sales

**Decision:** Offline-minted receipts in Phase 1 use
`OFF-<base36-timestamp>-<2-char-random>` (e.g. `OFF-LJZ8K2-A7`). The
client mints this in
[POSContext.completeSale](../../app/src/context/POSContext.tsx) when
`isCapacitorAndroid()` returns true, before the network POST.

**Why:** Phase 1 doesn't yet have terminal registration on the tablet
(the routes exist from step 1 but the tablet doesn't bind to a terminal
on first launch — that's Phase 2). Without a terminal `prefix`, we
can't produce a `T1-1042`-style number. The `OFF-…` format is:
- Visually distinguishable on a receipt — admin can spot Phase-1
  offline rows immediately
- Globally unique with overwhelming probability (timestamp ms + random
  suffix) so two tablets can't collide
- Replaced wholesale by Phase 2's `T<prefix>-<seq>` scheme without
  any data migration (old rows keep their `OFF-…` numbers in history)

**How to apply:** Phase 2 swaps the mint logic for per-terminal seq.
Old Phase-1 rows in `pos_sales` keep their `OFF-…` receipts forever as
audit history — this is fine, they're a tiny set during the pilot.

## 2026-05-29 § 4xx server responses are NOT queued by the outbox

**Decision:** [posOutbox.drainOutbox](../../app/src/lib/posOutbox.ts)
marks any 4xx response (400/401/403/etc.) as `failed` rather than
`pending`. The
[POSContext.completeSale](../../app/src/context/POSContext.tsx) fallback
only enqueues when there's no `serverError` (i.e. only on network /
5xx failures).

**Why:** 4xx means the request will fail the same way on every retry
— bad payload, no permission, validation gate. Queuing it would burn
attempts and surface a "Sync stuck" UI to a cashier who can't actually
fix the underlying problem. Surfacing the error immediately to the
cashier matches existing online behaviour.

**How to apply:** When a cashier sees the alert *"'Burger' is no
longer available on the menu"* offline, the sale is NOT queued. The
cashier removes the item from the cart and rings up the rest. Phase 3
(oversell policy) may relax this for the specific "stock conflict at
sync time" case.

## 2026-05-28 § Phase 1 schema patch — applied directly to supabase/schema.sql (no separate migration file)

**Decision:** The Phase 1 schema changes (new table `pos_terminals` and
three new columns on `pos_sales`) were appended directly to
`supabase/schema.sql` rather than created as a separate migration file
like `migrations/0001_pos_terminals.sql`.

**Why:** The project does not use a versioned migration system. There
is no `supabase/migrations/` directory; `schema.sql` is run idempotently
via `node migrate.mjs` ([app/package.json:10](../../app/package.json#L10)).
Every change uses `if not exists` / `add column if not exists`, so
re-running the file against an existing DB is a no-op for unchanged
blocks. A separate migration file would set a precedent that doesn't
match the repo's actual workflow.

**How to apply:** verify the additions render correctly with
`psql -f supabase/schema.sql` against a staging DB, or run
`npm run db:migrate` from `app/` if `.env.local` points at a sandbox.

## 2026-05-28 § `pos_terminals.prefix` format enforced application-side, not in DB CHECK

**Decision:** The `pos_terminals.prefix` column is plain `text` with
**no** `CHECK (prefix ~ '^[A-Z0-9]{1,4}$')` constraint at the DB level.
The format `1–4 chars [A-Z0-9]` is validated by the
`POST /api/pos/terminals` route handler (to be written in Phase 1.1
after this commit).

**Why:** A DB-level CHECK would force every future change to the prefix
rules through a migration. Real-world POS terminals sometimes need
exceptions (a customer wants `BAR-2` or wants lowercase), and the route
handler is the right place for that flexibility. The DB still enforces
the only invariant that matters for correctness: uniqueness among
active terminals (`uniq_pos_terminals_prefix_active`).

## 2026-05-28 § `pos_terminals.id` uses `gen_random_uuid()::text`, not `bigserial`

**Decision:** Primary key is a text UUID, matching `pos_staff`,
`pos_sales`, `pos_clock_entries`. Not a numeric `bigserial`.

**Why:** Consistency with the rest of the POS subsystem. The `id` is
used in FK lookups, not in human-facing labels (that's what `prefix`
is for), so the surrogate UUID is invisible in the UI. Numeric ids would
leak terminal count to anyone who can guess sequential ids.

## 2026-05-28 § `pos_sales.terminal_id` uses `ON DELETE SET NULL`, not `CASCADE`

**Decision:** The foreign key from `pos_sales.terminal_id` to
`pos_terminals.id` is `ON DELETE SET NULL`.

**Why:** Sale records are an audit and tax artifact. Deleting a
terminal must not destroy the sales it produced. `SET NULL` preserves
the row and severs the link; the admin "POS Reports" panel will show
"(deleted terminal)" for these rows — same pattern as
`orders.customer_id` ([schema.sql:147](../../supabase/schema.sql#L147)
*"ON DELETE SET NULL"* with the comment *"when admin deletes a customer
we must preserve the order row ... for financial audit."*).

## 2026-05-28 § `pos_sales.synced_at` defaults to `now()` rather than NULL

**Decision:** New column `pos_sales.synced_at timestamptz default now()`.

**Why:** Online web POS sales insert without touching this column; the
default fires and `synced_at = created_at` semantically. Existing reads
that don't know about the column continue working. Offline-synced rows
get the timestamp at sync time, which is the moment they hit the server
— exactly what "synced_at" should mean.

**Alternative considered:** NULL default with the sync route stamping
`synced_at` explicitly. Rejected because it would force every existing
sale row to be NULL forever, breaking any future "show terminals with
sync lag > N hours" query that assumes the column is populated.

## 2026-05-28 § `pos_sales.client_created_at` left nullable

**Decision:** No default. Column is NULL for online web POS sales;
populated for offline tablet sales.

**Why:** Online sales don't have a meaningful "client time" distinct
from `created_at`. Backfilling them with `created_at` would be lying
about provenance. NULL means "this was an online sale, the canonical
time is `created_at`"; non-NULL means "this was a tablet sale, the
canonical time for tax/reporting is `client_created_at`."

## 2026-05-28 § RLS for `pos_terminals` follows the existing pos_* convention

**Decision:** `pos_terminals` gets `enable row level security` in the
upper RLS block (line 880-ish) and a single `deny_anon_all` policy in
the lower policies block (line 950-ish). No nuanced policies.

**Why:** Same posture as `pos_staff`, `pos_sales`, `pos_clock_entries`.
service_role bypasses RLS automatically; anon/authenticated are denied.
Every read goes through service-role API routes. Future per-role
policies (admin can edit terminal, cashier cannot) are enforced in the
route handlers, not at RLS.
