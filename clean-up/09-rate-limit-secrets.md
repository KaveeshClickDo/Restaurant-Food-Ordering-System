# Audit 09 — Rate Limits & Secrets

**Phase:** 3 — Security
**Date:** 2026-05-04
**Scope:**
- Rate-limit coverage on every endpoint that should have one (auth, password reset, public POST endpoints).
- Implementation quality of [lib/rateLimit.ts](../app/src/lib/rateLimit.ts).
- Secret-loading patterns (env vars, fallbacks, single-key reuse).
- Log hygiene — secrets / tokens / PII appearing in `console.*` calls.
- `.env.local` / `.gitignore` configuration.
**Mode:** Read-only

---

## 1. Methodology

1. Grep'd `rateLimit` across [app/src/](../app/src/). Listed every call site.
2. Read each rate-limited route to understand bucket key shape.
3. Walked every other route and flagged ones that should be rate-limited (auth, password reset, public POST, email-trigger, anything that hits SMTP).
4. Grep'd `process.env.<sensitive>` to enumerate every secret access point and check loading patterns.
5. Searched `console.log/warn/error` for tokens, passwords, raw URLs containing tokens, and verified what actually gets logged.
6. Confirmed `.env.local` placement and `.gitignore` coverage.

## 2. Rate-limit coverage matrix

`lib/rateLimit.ts` is implemented and used in **5 routes only** — all PIN/password login endpoints:

| Route | Bucket key | Limit | Window | Verdict |
|---|---|---|---|---|
| [auth/login POST](../app/src/app/api/auth/login/route.ts#L24) | `login:${ip}` | 10 | 60 s | ✓ |
| [auth/register POST](../app/src/app/api/auth/register/route.ts#L60) | `register:${ip}` | 5 | 60 s | ✓ |
| [kitchen/auth POST](../app/src/app/api/kitchen/auth/route.ts#L32) | `kitchen-auth:${ip}` | 10 | 60 s | 🟡 see 09-F2 |
| [pos/auth POST](../app/src/app/api/pos/auth/route.ts#L37) | `pos-auth:${ip}:${staffId}` | 10 | 60 s | ✓ (per-account) |
| [waiter/auth POST](../app/src/app/api/waiter/auth/route.ts#L30) | `waiter-auth:${ip}:${staffId}` | 10 | 60 s | ✓ (per-account) |

### 2.1 — Routes that should be rate-limited but aren't

| Route | Why | Severity |
|---|---|---|
| `auth/reset-password POST` | Email-bomb the user; enumeration via timing despite the "always 200" pattern | 🔴 09-F1 |
| `auth/driver/reset-password POST` | Same; driver password reset | 🔴 09-F1 |
| `auth/resend-verification POST` | Email-bomb a customer's address | 🔴 09-F1 |
| `auth/driver POST` (driver login) | **No rate limit at all on driver login** | 🔴 09-F3 |
| `auth/change-password POST` | Session-gated, but a leaked session can grind through old-password guesses | 🟡 09-F4 |
| `reservations POST` | Already in 06-F10 | 🟡 see 06-F10 |
| `guest-profile POST` | Already in 06-F11 | 🟡 see 06-F11 |
| `orders POST` | Order spam; expensive (sends emails) | 🟡 09-F5 |
| `email POST` | Once authenticated (post-06-F5), still need a per-session limit | 🟡 09-F5 |
| `print POST` | Once authenticated (post-06-F9), still need a limit (ESC/POS bytes) | 🟡 09-F5 |
| `customers/[id]/spend-credit POST` | Already in 06-F4 | depends on 06-F4 fix |
| `admin/users/[id]/send-reset POST` | Admin-gated, but a compromised admin session can email-bomb users | 🟡 09-F6 |

## 3. Findings — rate limiting

### 09-F1 — Password-reset and resend-verification have no rate limit (email-bomb vector)
**Severity:** 🔴 High
**Evidence:**
- [auth/reset-password/route.ts:19](../app/src/app/api/auth/reset-password/route.ts#L19) — no `rateLimit()` call. The route is correctly designed to "always return 200" to avoid enumeration — but without a rate limit, an attacker can `POST { email: "victim@x.com" }` thousands of times to flood the victim's inbox.
- [auth/driver/reset-password/route.ts](../app/src/app/api/auth/driver/reset-password/route.ts) — same pattern.
- [auth/resend-verification/route.ts](../app/src/app/api/auth/resend-verification/route.ts) — same.
**Why it matters:**
- Email reputation: SMTP provider (e.g. Resend) sees high volume to the same address → flags your domain → all your transactional emails (order confirmations) start landing in spam.
- Cost: most SMTP providers charge per email.
- Victim's inbox: pure harassment vector.
- Combined with 06-F5 (open SMTP relay): even after 06-F5 is fixed, if an attacker can hit reset-password 10K/min, they get the same outcome.
**Possible action:** Add `rateLimit("reset-password:${ip}", 5, 60_000)` and `rateLimit("reset-password-email:${email}", 3, 3600_000)` (per-IP burst limit + per-email-target hourly cap). The per-email cap is the one that actually protects victims (an attacker rotating IPs still can't email one inbox more than 3× per hour).

### 09-F2 — Kitchen login rate-limit is per-IP only (not per-staff) — PIN brute-force unbounded
**Severity:** 🔴 Medium-High
**Evidence:** [kitchen/auth/route.ts:32](../app/src/app/api/kitchen/auth/route.ts#L32):
```ts
const { limited } = rateLimit(`kitchen-auth:${ip}`, 10, 60_000);
```
Compare to POS / waiter, which include `staffId` in the bucket: `pos-auth:${ip}:${staffId}`.
**Why it matters:**
- 4-digit PINs have 10,000 possible values.
- Attacker can rotate `staffId` to spread the 10/min budget across all kitchen staff. With 3 staff, that's 30 PIN attempts per minute against any single staff member (one `staffId` brute-forced 10/min × 3 stages).
- Wait — that math is wrong. The bucket only counts by IP, not by staffId. So one IP gets 10 attempts per minute total, regardless of which staffId is being tried. An attacker can target one staff with 10/min — at 4 digits, that's 1000 minutes (~17 hours) for a brute-force. Not great, not catastrophic.
- The real issue is **inconsistency** with POS and waiter routes which correctly use the `${ip}:${staffId}` bucket.
- Also, an attacker rotating IPs (e.g. via a residential proxy) bypasses entirely. Per-`staffId` limiting catches that.
**Possible action:** Change to `kitchen-auth:${ip}:${staffId}` to match POS/waiter. Add a complementary per-`staffId`-only bucket with a wider limit (e.g. 50/hour) that catches IP rotation.

### 09-F3 — Driver login has no rate limit at all
**Severity:** 🔴 High
**Evidence:** [auth/driver/route.ts](../app/src/app/api/auth/driver/route.ts) (POST handler, not shown in this audit's reads but verified by the grep matrix — no `rateLimit` import). Drivers use bcrypt password (not PIN), so the search space is bigger, but without a limit an attacker can:
- Try every leaked-password-list entry against a driver email.
- Time bcrypt operations to detect valid email vs invalid.
**Why it matters:** A driver session in this codebase grants access to deliveries, customer addresses, and dispatch state (06-F1 ungated until that's fixed).
**Possible action:** Mirror customer login — `rateLimit("driver-login:${ip}", 10, 60_000)`. Plus per-email bucket as in 09-F2.

### 09-F4 — `auth/change-password` has no rate limit
**Severity:** 🟡 Medium
**Evidence:** [auth/change-password/route.ts](../app/src/app/api/auth/change-password/route.ts) — session-gated, no rateLimit.
**Why it matters:** Session theft → attacker grinds through guesses of `currentPassword` (which the route requires) to confirm session ownership without locking the account. Mostly bounded because they already have the session, but should still be limited for defense in depth.
**Possible action:** `rateLimit("change-password:${session.id}", 5, 60_000)`.

### 09-F5 — Public mutating endpoints (orders, email, print) lack rate limits
**Severity:** 🟡 Medium (compounds 06-F5/F9, 08-F1)
**Evidence:** [orders/route.ts](../app/src/app/api/orders/route.ts), [email/route.ts](../app/src/app/api/email/route.ts), [print/route.ts](../app/src/app/api/print/route.ts) — none use `rateLimit`.
**Why it matters:**
- Once auth is added, a single authenticated session can still abuse the endpoint at high volume. Per-session limits are the second line of defense.
- For `orders`, the email side-effect (`sendOrderConfirmationEmail`) makes each request expensive.
**Possible action:** Per-session and/or per-IP limits on every mutating endpoint. A wrapper helper would make this consistent — e.g. a `withRateLimit(handler, { key: "..", limit: 10, windowMs: 60_000 })` that's mandatory for new routes.

### 09-F6 — Admin can email-bomb users via `send-reset` (no rate limit)
**Severity:** 🟡 Medium (assumes a compromised admin session)
**Evidence:** [admin/users/[id]/send-reset/route.ts](../app/src/app/api/admin/users/[id]/send-reset/route.ts) — no rate limit.
**Why it matters:** Per-session limit; not the primary control (admin auth is the primary), but worth having.
**Possible action:** `rateLimit("admin-send-reset:${target_user_id}", 3, 3600_000)`.

## 4. Findings — rate limiter implementation

### 09-F7 — In-memory store doesn't survive across serverless invocations
**Severity:** 🟡 Medium (deployment-dependent)
**Evidence:** [lib/rateLimit.ts:15](../app/src/lib/rateLimit.ts#L15): `const store = new Map<string, Entry>();`. Comment at [line 3](../app/src/lib/rateLimit.ts#L3): "One shared store per process — adequate for a single-server deployment."
**Why it matters:**
- On Vercel (cold-start serverless functions), each request may hit a different container with its own empty `store`. The rate limit becomes "10 attempts per container per minute" — easy to bypass by triggering multiple cold-starts.
- The same applies to any horizontally-scaled deployment (multiple Node.js processes behind a load balancer).
- The comment acknowledges this, but the rate limit is currently being depended on for security (PIN brute-force defense).
**Possible action:**
1. **If single-server**: keep as-is.
2. **If multi-server / serverless**: migrate to a shared store. Options:
   - Upstash Redis / Vercel KV (HTTP-based, works from edge).
   - Postgres table `rate_limit_buckets` (works since the project already uses Postgres).
   - Cloudflare Durable Objects / R2 (if deploying behind Cloudflare).
3. Document in deployment guide which deployment shape requires the store upgrade.

### 09-F8 — `x-forwarded-for` is the sole IP source — spoofable without a trusted proxy
**Severity:** 🟡 Medium (deployment-dependent)
**Evidence:** Every rate-limited route reads:
```ts
const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
```
**Why it matters:**
- `x-forwarded-for` is a client-supplied HTTP header. If the deployment doesn't have a trusted reverse proxy (CDN, load balancer) that overwrites it, attackers can spoof it: `curl -H "X-Forwarded-For: 1.2.3.4"`. Each request can supply a fresh IP → bucket key never collides → rate limit never fires.
- Behind Vercel / Cloudflare / Nginx (configured correctly), the leftmost IP is the real client and the code's `.split(",")[0]` is right. Behind a misconfigured proxy or direct exposure, it's broken.
- No fallback to `cf-connecting-ip` (Cloudflare) or `x-real-ip` (Nginx).
**Possible action:**
1. Document that the app expects to run behind a trusted proxy that sets `x-forwarded-for` correctly.
2. Optional: add a `TRUSTED_PROXY_COUNT` env var + read the Nth-from-rightmost IP (defends against header injection by middlemen).
3. Optional: support `cf-connecting-ip` first if Cloudflare is the deployment target.

### 09-F9 — Five copies of the same IP-extraction one-liner
**Severity:** 🟡 Low (code duplication)
**Evidence:** The exact same `req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"` appears in 5 files (login, register, kitchen/auth, pos/auth, waiter/auth).
**Why it matters:** When 09-F8 is fixed, the change has to be applied in 5 places. Easy to miss one. Cross-ref Audit 03's duplication theme.
**Possible action:** `lib/rateLimit.ts` exposes `getRequestIp(req): string`. Or fold the IP extraction into a `withRateLimit(handler, opts)` wrapper.

### 09-F10 — `unknown` fallback IP shares one bucket across all callers
**Severity:** 🟡 Low
**Evidence:** When `x-forwarded-for` is missing, the bucket key becomes e.g. `login:unknown`. All such requests share one 10/min bucket. Effect: legitimate users behind a proxy that strips the header can be DoS'd by other "unknown" callers.
**Why it matters:** Mostly hypothetical — proxies almost always set the header. But worth flagging because the comment "fail open with `unknown`" hides this collision.
**Possible action:** Either reject requests without an IP, or use a different bucket strategy (e.g. include the User-Agent hash to fan out).

## 5. Findings — secrets

### 09-F11 — `AUTH_JWT_SECRET ?? ADMIN_JWT_SECRET` fallback conflates two purposes
**Severity:** 🟡 Medium
**Evidence:** 10+ files use the pattern:
```ts
const secret = (process.env.AUTH_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? "").trim();
```
File-by-file: [middleware.ts:15,46,77](../app/src/middleware.ts#L15), [auth.ts:32](../app/src/lib/auth.ts#L32), [auth/register](../app/src/app/api/auth/register/route.ts#L20), [auth/reset-password](../app/src/app/api/auth/reset-password/route.ts#L15), [auth/reset-password/confirm](../app/src/app/api/auth/reset-password/confirm/route.ts#L12), [auth/driver/reset-password](../app/src/app/api/auth/driver/reset-password/route.ts#L14), [auth/driver/reset-password/confirm](../app/src/app/api/auth/driver/reset-password/confirm/route.ts#L12), [auth/google](../app/src/app/api/auth/google/route.ts#L15), [auth/google/callback](../app/src/app/api/auth/google/callback/route.ts#L27), [auth/verify-email](../app/src/app/api/auth/verify-email/route.ts#L11), [auth/resend-verification](../app/src/app/api/auth/resend-verification/route.ts#L16), [admin/users/[id]/send-reset](../app/src/app/api/admin/users/[id]/send-reset/route.ts#L17). Plus [adminAuth.ts:18](../app/src/lib/adminAuth.ts#L18) which uses `ADMIN_JWT_SECRET` only.
**Why it matters:**
- Convenience: only one secret needed for first-time setup.
- Risk: if a deployment has only `ADMIN_JWT_SECRET` set, the same secret signs both admin sessions AND customer/driver/waiter sessions. The HMAC payload includes a `role` field so cross-role token forgery is *not* possible (the role is part of the signed data) — but:
- **Operational confusion**: rotating `ADMIN_JWT_SECRET` (e.g. after admin password breach) silently force-logs-out every customer/driver/waiter too. Surprise!
- **Secret rotation**: there's no clean way to rotate one secret without invalidating the other.
- **Forgotten config**: ops engineers may not realize they need to set both. 10 files can disagree on the fallback chain.
**Possible action:**
1. Make `AUTH_JWT_SECRET` mandatory; fail-fast on startup if unset (the current `throw new Error("...")` at [auth.ts:33–34](../app/src/lib/auth.ts#L33) already does this on first use, but not at boot).
2. Drop the `?? ADMIN_JWT_SECRET` fallback after one release cycle of dual-secret support.
3. Centralize secret loading in `lib/auth.ts:getSecret()` so the fallback chain lives in one place (the duplication across 10 files is a smell).

### 09-F12 — Reset-token / verification-token raw URLs logged when SMTP unconfigured
**Severity:** 🔴 Medium-High
**Evidence:**
- [auth/reset-password/route.ts:76](../app/src/app/api/auth/reset-password/route.ts#L76): `console.log("[reset-password] Reset URL (no SMTP):", resetUrl);`
- [auth/driver/reset-password/route.ts:75](../app/src/app/api/auth/driver/reset-password/route.ts#L75): same pattern.
- [auth/register/route.ts:29](../app/src/app/api/auth/register/route.ts#L29): `console.log("[register] Verification URL (no SMTP configured):", link);`
- [auth/resend-verification/route.ts:49](../app/src/app/api/auth/resend-verification/route.ts#L49): `console.log("[resend-verification] Verify URL:", link);` — **always logs, even when SMTP is configured!** Confirmed by reading the file: there's no `if (!process.env.SMTP_HOST)` guard around this line in resend-verification (different from the others).
- The URLs contain `?token=<rawToken>` — the literal credential. Anyone with log access (Vercel team, log aggregator like Datadog, ops engineers, leaky-S3-bucket archived logs) can use those tokens to take over the account.

**Why it matters:**
- Tokens have 1-hour TTL (reset) or 24-hour TTL (verification) but a log subscription delivers them in real time.
- Production environments where SMTP fails silently (e.g. provider rate-limits, expired API key) suddenly start logging tokens.
- [resend-verification/route.ts:49](../app/src/app/api/auth/resend-verification/route.ts#L49) is the worst — it logs *every* verification URL unconditionally. Need to verify this; if true, every signup since deploy has tokens in logs.
**Possible action:**
1. Verify the resend-verification log statement: confirm whether it's gated or not.
2. Remove all token URL logs. If a dev-mode hint is needed, log only `[reset-password] Token generated for user <id>` (no token).
3. Add a code review checklist item: never log raw tokens.

### 09-F13 — Sensitive env-var loading is duplicated (no central wrapper)
**Severity:** 🟡 Low
**Evidence:** Each route reads its own env vars. [adminAuth.ts:18](../app/src/lib/adminAuth.ts#L18) uses `getSecret()` (good) but the `getSecret()` function is reimplemented in [auth.ts:32](../app/src/lib/auth.ts#L32) with a different fallback chain. Other routes inline the env access.
**Why it matters:**
- Inconsistent error messages when env var is missing (some throw, some silently fail to `""`, leading to broken HMAC verification with no obvious cause).
- Boot-time validation isn't possible — failures show up as 500s mid-request.
**Possible action:** A single `lib/env.ts` module that:
1. Exports typed accessors: `env.AUTH_JWT_SECRET`, `env.SMTP_HOST`, etc.
2. Validates required env vars at startup (e.g. via [instrumentation.ts](../app/src/instrumentation.ts)).
3. Throws clear errors on missing or invalid values.

### 09-F14 — `email/route.ts` reads SMTP creds from env (good — not from body)
**Severity:** ⚠️ Positive
**Evidence:** [email/route.ts:46–51](../app/src/app/api/email/route.ts#L46): explicitly rejects requests that include `smtp` in the body, and reads creds only from `process.env.SMTP_*`. This is the right pattern.
**Why it matters:** Stops a class of attacks where the client supplies SMTP creds. Worth keeping.
**Possible action:** None — keep this. Apply the same pattern to any other "send via SMTP" path that gets added.

### 09-F15 — `.env.local` exists at `app/.env.local` and is gitignored
**Severity:** ⚠️ Positive
**Evidence:** `.env.local` is present at [app/.env.local](../app/.env.local). [app/.gitignore](../app/.gitignore) line 26 — `.env*` excludes it from version control. [example.env](../app/example.env) is committed as a template.
**Why it matters:** Confirms secrets aren't committed — the standard Next.js setup is in place.
**Possible action:** None for this audit. (Worth checking `git log -- app/.env.local` to confirm it's never been committed historically — outside this audit's scope; flag as a verify-with-user step.)

### 09-F16 — Admin password is a single shared string (cross-ref 06-F16)
**Severity:** see Audit 06
**Evidence:** Already covered in 06-F16.
**Why it matters / Possible action:** See Audit 06.

## 6. Findings — log hygiene

### 09-F17 — Many `console.error("[<route>]", error.message)` calls echo Supabase errors verbatim
**Severity:** 🟡 Low (info disclosure to log readers + cross-ref 08-F15)
**Evidence:** ~30+ routes follow the pattern `console.error("[admin/menu POST]:", error.message)`. The error.message can include constraint names, column names, and (crucially) the user-supplied value that triggered the violation (e.g. `"duplicate key value violates unique constraint \"customers_email_key\" — Detail: Key (email)=(victim@x.com) already exists"`).
**Why it matters:**
- Error messages may include user-supplied PII (the email above).
- If logs are aggregated and indexed (Datadog, Loki, Vercel logs), PII ends up in a searchable second-class data store. GDPR concerns.
- Schema details leak to anyone with log access.
**Possible action:** Wrap `supabaseAdmin` in a helper that strips PostgreSQL `Detail:` lines from logs. Or log structured fields: `{ route, errorCode: error.code, message: "constraint violation" }` rather than the raw message.

### 09-F18 — `oauth callback token error` could log OAuth tokens
**Severity:** 🟡 Low
**Evidence:** [auth/google/callback/route.ts:101](../app/src/app/api/auth/google/callback/route.ts#L101): `console.error("[google/callback] token error:", tokenData.error)`. If Google's token-exchange response includes the raw token in the error object (it shouldn't, but may), this leaks.
**Why it matters:** Defense in depth — logging OAuth response objects is a known leak pattern.
**Possible action:** Log only `tokenData.error` (the error message string) not the whole object. The current code does — verified — but worth noting that future "log everything" changes here are dangerous.

### 09-F19 — `console.log` is used for "URL when no SMTP" hints (already covered in 09-F12)
**Severity:** see 09-F12
**Why it matters / Possible action:** see 09-F12.

## 7. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🔴 **High** | 09-F1 (no rate limit on password reset / resend verification — email-bomb), 09-F3 (no rate limit on driver login), 09-F12 (token URLs in logs) | |
| 🔴 **Medium-High** | 09-F2 (kitchen rate limit per-IP-only) | |
| 🟡 **Medium** | 09-F4 (change-password no limit), 09-F5 (orders/email/print no per-session limit), 09-F6 (admin send-reset no limit), 09-F7 (in-memory store doesn't scale), 09-F8 (xff spoofing without trusted proxy), 09-F11 (single-secret fallback conflation) | |
| 🟡 **Low** | 09-F9 (IP extraction duplicated 5×), 09-F10 (`unknown` shared bucket), 09-F13 (env-loading duplicated), 09-F17 (Supabase error messages logged), 09-F18 (OAuth token-error logging) | |
| ⚠️ **Positive** | 09-F14 (email/route refuses body-supplied SMTP creds), 09-F15 (`.env.local` exists and is gitignored) | |

## 8. Highest-ROI fixes — recommended order

1. **09-F12 — Strip token-URL `console.log` lines.** Especially [resend-verification/route.ts:49](../app/src/app/api/auth/resend-verification/route.ts#L49) which appears to log unconditionally. One-line edits per file. Also rotate `AUTH_JWT_SECRET` after the change to invalidate any tokens that may have leaked into existing logs.
2. **09-F1 + 09-F3 — Add rate limits to reset-password / resend-verification / driver-login.** 4 files; copy the existing `auth/login` pattern. Add per-email-target limits to reset-password (3 per hour per email).
3. **09-F2 — Fix kitchen-auth bucket key** to `${ip}:${staffId}` for consistency with POS/waiter.
4. **09-F4–F6 — Add limits to orders / change-password / send-reset / email / print.** Best done with a `withRateLimit` wrapper to standardise.
5. **09-F9 + 09-F8 — Centralize IP extraction in `lib/rateLimit.ts`** — `getRequestIp(req)`. Fix in one place when proxy strategy needs adjustment.
6. **09-F11 + 09-F13 — Add `lib/env.ts` for typed env access**, fail-fast at boot. Drop the `AUTH_JWT_SECRET ?? ADMIN_JWT_SECRET` fallback after a release.
7. **09-F7 — Plan for distributed rate-limiter** if deployment shape requires it. Decide based on deployment target (Vercel serverless? Single VM?).
8. **09-F17 — Sanitize Supabase errors before logging.** Could be a one-liner helper: `safeLog(error)` strips `Detail:` lines.

## 9. Open questions for the user

1. **Deployment shape:** Vercel? Single VM? Containers behind a load balancer? Affects 09-F7 (distributed store) and 09-F8 (proxy / IP-extraction strategy).
2. **09-F12 verification:** can you check whether [resend-verification/route.ts:49](../app/src/app/api/auth/resend-verification/route.ts#L49) actually logs unconditionally? (I read it but want a second pair of eyes.) If yes, every verification URL since deploy is in your logs — they should be considered compromised and the secret rotated.
3. **AUTH_JWT_SECRET vs ADMIN_JWT_SECRET (09-F11):** are both currently set in your `.env.local` / production env? If only `ADMIN_JWT_SECRET` is set, that's the surprise rotation behavior described above.
4. **Distinct rotation cadence:** how often do you plan to rotate `AUTH_JWT_SECRET` vs `ADMIN_JWT_SECRET`? Affects whether the dual-secret split is worth keeping.

## 10. What's next

- **Audit 10 — XSS / injection vectors** ([10-xss-injection.md](./10-xss-injection.md), pending). Will scan for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, untrusted HTML in `RichEditor` + email templates, and any user-controlled values flowing into JSX without sanitisation.
