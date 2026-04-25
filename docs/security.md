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

Waiter API routes do not re-check roles server-side — void and refund are gated client-side by `waiter.role === "senior"`. The waiter app is a trusted in-restaurant screen and not exposed to the public internet.

### Driver App (`/driver`)

| Mechanism | Detail |
|---|---|
| Credential | Email + password |
| Storage | `password_hash` (bcrypt) in the `drivers` table |
| Validation | Server-side via `POST /api/auth/driver` |
| Session | `localStorage` (browser-persisted) |

The `drivers` table is never accessible to the anon Supabase role — see RLS policy below.

### POS Terminal (`/pos`)

| Mechanism | Detail |
|---|---|
| Credential | 4-digit PIN stored in `localStorage` |
| Validation | Client-side only |
| Rationale | POS is a trusted, physically secured in-restaurant terminal |

### Customer Portal (`/`, `/account`)

| Mechanism | Detail |
|---|---|
| Credential | Email + plaintext password (demo system) |
| Storage | `password` column in `customers` table |
| Validation | Client-side check in AppContext `login()` |
| Note | For production, replace with a proper auth provider (Supabase Auth, NextAuth, etc.) |

---

## Supabase Row Level Security

RLS is **enabled on every table**. The anon key — which is exposed in the browser — can only read, and only on specific tables.

| Table | Anon SELECT | Anon INSERT | Anon UPDATE | Anon DELETE |
|---|---|---|---|---|
| `app_settings` | Yes | No | No | No |
| `categories` | Yes | No | No | No |
| `menu_items` | Yes | No | No | No |
| `customers` | Yes (no `password` col — see below) | No | No | No |
| `orders` | Yes | No | No | No |
| `drivers` | **No** (explicit deny policy) | No | No | No |

All write operations (orders, customers, refunds, status changes) go through Next.js API routes that use `SUPABASE_SERVICE_ROLE_KEY` — which bypasses RLS entirely and is never sent to the browser.

### Column-level security

```sql
revoke select (password) on customers from anon;
```

The `password` column on `customers` is revoked from the PostgREST anon role so it is never returned by any query made with the anon key. The service role (used in API routes) retains full access.

### Drivers — explicit deny policy

```sql
create policy "deny_anon_all" on drivers
  for all to anon
  using (false) with check (false);
```

Even with RLS enabled and no policies, Postgres defaults to deny. This explicit policy makes the intent unambiguous and silences the "RLS enabled, no policies" linter warning.

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
- Waiter routes — PIN-validated at the app level; trusted in-restaurant screen
- KDS status route — no sensitive data; trusted in-restaurant screen
- POS routes — POS manages its own staff auth; trusted terminal

### Order INSERT

Online orders are inserted via `POST /api/orders` (server-side, service role). The anon role has no INSERT on `orders`. This prevents clients from:
- Inserting orders with arbitrary statuses (e.g. `"delivered"`)
- Manipulating totals
- Bypassing coupon validation

### Customer INSERT

Customers are inserted via `POST /api/auth/register` (service role). The anon role has no INSERT on `customers`. This ensures:
- Email uniqueness is enforced server-side
- Passwords (demo plaintext) are never inserted client-side

---

## Sensitive Environment Variables

| Variable | Where used | Safe to expose? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Yes (anon key has limited access) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Yes (read-only with RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side API routes only | **No** — full DB access |
| `ADMIN_PASSWORD` | Server-side `lib/adminAuth.ts` only | **No** |

SMTP, Stripe, and PayPal credentials are stored in `app_settings` (Supabase, service role only) and are never sent to the browser in the settings response — they are read and used exclusively inside API routes.

---

## Production Hardening Checklist

- [ ] Set `ADMIN_PASSWORD` to a long, random string (≥ 32 chars)
- [ ] Rotate `SUPABASE_SERVICE_ROLE_KEY` if it was ever exposed
- [ ] Serve the app over HTTPS (cookie `Secure` flag is set automatically when `NODE_ENV=production`)
- [ ] Restrict Supabase project to your production domain in the CORS settings
- [ ] Replace plaintext customer password storage with Supabase Auth or NextAuth
- [ ] Enable Supabase database backups
- [ ] Set up Supabase Auth Rate Limiting to prevent brute-force on the anon key
