# Security Model

---

## Authentication by Portal

### Admin Dashboard (`/admin`)

| Mechanism | Detail |
|---|---|
| Credential | `ADMIN_PASSWORD` environment variable |
| Comparison | `crypto.timingSafeEqual` — prevents timing attacks |
| Session | Signed JWT in an httpOnly, SameSite=Lax, Secure (production) cookie |
| Expiry | 24 hours (`COOKIE_MAX_AGE`) |
| Route guard | Every admin API route calls `isAdminAuthenticated()` before processing |

Login: `POST /api/admin/auth` → sets `admin_session` cookie.
Session check: `GET /api/admin/auth` → returns `{ ok: true/false }`.
Logout: `DELETE /api/admin/auth` → clears cookie.

### Waiter App (`/waiter`)

| Mechanism | Detail |
|---|---|
| Credential | 4-digit PIN stored in `app_settings.waiters[].pin` |
| Validation | Server-side only via `POST /api/waiter/auth` |
| Client exposure | `/api/waiter/config` returns staff profiles **without** `pin` fields |
| Session | In-memory React state (cleared on page refresh) |

Waiter API routes do not re-check roles server-side — void and refund are gated client-side by `waiter.role === "senior"`. The waiter app is a trusted in-restaurant screen.

### Driver App (`/driver`)

| Mechanism | Detail |
|---|---|
| Credential | Email + password |
| Storage | `password_hash` (bcrypt, cost factor 10) in the `drivers` table |
| Validation | Server-side via `POST /api/auth/driver` |
| Session | Signed HMAC JWT in an httpOnly, SameSite=Lax, Secure (production) cookie (`driver_session`) |
| Route protection | `middleware.ts` checks the cookie on every `/driver` request; unauthenticated requests are redirected to `/driver/login` |

Logout: `POST /api/auth/driver/logout` → clears the `driver_session` cookie.
The `drivers` table is never accessible to the anon Supabase role — see RLS policy below.

### POS Terminal (`/pos`)

| Mechanism | Detail |
|---|---|
| Credential | 4-digit PIN stored in `localStorage` |
| Validation | Client-side only |
| Rationale | POS is a trusted, physically secured in-restaurant terminal |

### Customer Portal (`/`, `/login`)

| Mechanism | Detail |
|---|---|
| Credential | Email + bcrypt password (cost factor 10) |
| Storage | `password_hash` column in `customers` table |
| Validation | Server-side only via `POST /api/auth/login` |
| Session | Signed HMAC JWT in an httpOnly, SameSite=Lax, Secure (production) cookie (`customer_session`) |
| Expiry | 30 days |
| Route protection | `middleware.ts` redirects unauthenticated `/account` requests to `/login` |

HMAC signing uses `AUTH_JWT_SECRET`. Session tokens carry `{ id, role: "customer" }`.

**Google OAuth** — customers can also authenticate via Google OAuth 2.0 (authorization code flow):
1. `GET /api/auth/google` — generates a CSRF state (random bytes + HMAC signature), stores it in a short-lived httpOnly cookie, and redirects to Google's consent screen
2. `GET /api/auth/google/callback` — validates the CSRF state, exchanges the authorization code for an access token, fetches the Google profile, and finds or creates a customer account; issues the same `customer_session` cookie as password login

Google OAuth requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` env vars.

**Email verification** — new accounts receive a verification email; a banner is displayed on the customer portal until the email is confirmed. The `email_verified` flag is set on the `customers` table.

**Password reset** — initiated via `POST /api/auth/reset-password`; a time-limited signed token is emailed to the customer.

Registration: `POST /api/auth/register`.
Session refresh: `GET /api/auth/me`.
Logout: `POST /api/auth/logout`.
Resend verification: `POST /api/auth/resend-verification`.

---

## Supabase Row Level Security

RLS is **enabled on every table**. The anon key — which is exposed in the browser — can only read, and only on specific tables.

| Table | Anon SELECT | Anon INSERT | Anon UPDATE | Anon DELETE |
|---|---|---|---|---|
| `app_settings` | Yes | No | No | No |
| `categories` | Yes | No | No | No |
| `menu_items` | Yes | No | No | No |
| `customers` | Yes (no `password`/`password_hash` col — see below) | No | No | No |
| `orders` | Yes | No | No | No |
| `drivers` | **No** (explicit deny policy) | No | No | No |
| `reservation_customers` | **No** | No | No | No |

All write operations (orders, customers, refunds, status changes, guest profiles) go through Next.js API routes that use `SUPABASE_SERVICE_ROLE_KEY` — which bypasses RLS entirely and is never sent to the browser.

### Column-level security

```sql
revoke select (password)      on customers from anon;
revoke select (password_hash) on customers from anon;
```

The `password` and `password_hash` columns on `customers` are revoked from the PostgREST anon role so they are never returned by any query made with the anon key.

### Drivers — explicit deny policy

```sql
create policy "deny_anon_all" on drivers
  for all to anon
  using (false) with check (false);
```

The same pattern applies to `reservation_customers`.

---

## Middleware Route Protection

`middleware.ts` enforces authentication on protected routes at the edge:

| Route pattern | Required session cookie | Redirect on failure |
|---|---|---|
| `/driver/*` | `driver_session` | `/driver/login` |
| `/account` | `customer_session` | `/login` |

The middleware reads and verifies the HMAC-signed session cookie using `lib/auth.ts`; no database call is made.

---

## API Route Security

### Which key is used where

| Context | Supabase client | Key |
|---|---|---|
| Browser components / AppContext | `supabase` (from `lib/supabase.ts`) | Anon key — read-only |
| Next.js API routes | `supabaseAdmin` (from `lib/supabaseAdmin.ts`) | Service role key — full access |

### Admin API guard

```typescript
// lib/adminAuth.ts
export async function isAdminAuthenticated(): Promise<boolean>

// Usage in every admin route:
if (!(await isAdminAuthenticated())) return unauthorizedResponse();
```

Routes that bypass this guard are intentionally public:
- Customer auth routes (`/api/auth/*`) — self-service flows; inputs validated server-side
- Waiter routes — PIN-validated at the app level; trusted in-restaurant screen
- KDS status route — no sensitive data; trusted in-restaurant screen
- POS routes — POS manages its own staff auth; trusted terminal
- `/api/ping` — returns 204 only; no data disclosed
- `/api/guest-profile` — anon customer flow; accepts only name, email, phone, orderTotal; cannot read or delete data

### Order INSERT

Online orders are inserted via `POST /api/orders` (server-side, service role). The anon role has no INSERT on `orders`. This prevents clients from:
- Inserting orders with arbitrary statuses (e.g. `"delivered"`)
- Manipulating totals
- Bypassing coupon validation

### Customer authentication routes

All customer auth routes (`/api/auth/login`, `/api/auth/register`, `/api/auth/reset-password`, etc.) use the service role key server-side and perform all sensitive operations (bcrypt compare, token generation, email dispatch) in the server runtime — never in the browser.

### Guest Profile Upsert

`POST /api/guest-profile` is intentionally unauthenticated — it is called from the browser after a guest checkout completes. It can only **upsert** a profile by email; it accepts only four fields (`name`, `email`, `phone`, `orderTotal`); invalid or missing email returns a 400 error; the `reservation_customers` table has no anon SELECT, so data cannot be read back through the API.

---

## Session Token Implementation

`lib/auth.ts` implements the shared HMAC session token system used by both customer and driver sessions:

```typescript
// Create a signed token: base64url(payload) + "." + HMAC_SHA256
createSessionToken({ id, role }): string

// Verify and decode a token; returns null if invalid or tampered
verifySessionToken(token): { id, role } | null

// Set the session cookie on a NextResponse
setSessionCookie(res, cookieName, token)

// Cookie names
COOKIE_CUSTOMER = "customer_session"
COOKIE_DRIVER   = "driver_session"
```

The secret is read from `AUTH_JWT_SECRET` (falls back to `ADMIN_JWT_SECRET` for backwards compatibility).

---

## Sensitive Environment Variables

| Variable | Where used | Safe to expose? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Yes (anon key has limited access) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Yes (read-only with RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side API routes only | **No** — full DB access |
| `ADMIN_PASSWORD` | Server-side `lib/adminAuth.ts` only | **No** |
| `AUTH_JWT_SECRET` | Server-side `lib/auth.ts` only | **No** — signs all customer/driver sessions |
| `NEXT_PUBLIC_SITE_URL` | Server-side OAuth callback URL | Yes (public site URL) |
| `GOOGLE_CLIENT_ID` | Server-side OAuth routes | Yes (public client ID) |
| `GOOGLE_CLIENT_SECRET` | Server-side OAuth routes only | **No** |

SMTP, Stripe, and PayPal credentials are stored in `app_settings` (Supabase, service role only) and are never sent to the browser.

---

## Production Hardening Checklist

- [ ] Set `ADMIN_PASSWORD` to a long, random string (≥ 32 chars)
- [ ] Set `AUTH_JWT_SECRET` to a long, random string (≥ 32 chars); rotate if exposed
- [ ] Rotate `SUPABASE_SERVICE_ROLE_KEY` if it was ever exposed
- [ ] Serve the app over HTTPS (`cookie Secure` flag is set automatically when `NODE_ENV=production`)
- [ ] Restrict Supabase project to your production domain in CORS settings
- [ ] Enable Supabase database backups
- [ ] Set up Supabase Auth Rate Limiting to prevent brute-force on the anon key
- [ ] Add a Google OAuth redirect URI allowlist in the Google Cloud Console (`{SITE_URL}/api/auth/google/callback` only)
- [ ] Review `/api/guest-profile` rate limiting if spam submissions are a concern
- [ ] Review `/api/auth/register` rate limiting to prevent account enumeration
