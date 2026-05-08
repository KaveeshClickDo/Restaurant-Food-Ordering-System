# Clean-up Audits

Read-only audit results for the Single-Restaurant-Food-Ordering-System project. Each markdown file documents findings for one audit step. **No code changes happen during audits** — these files are evidence we'll later use to plan refactors.

## Phases

1. **Phase 1 — Inventory & structure**
   - [01-folder-structure.md](./01-folder-structure.md) — Folder layout vs. industry standards
   - [02-large-files.md](./02-large-files.md) — God components / large file report
   - [03-dead-code-duplicates.md](./03-dead-code-duplicates.md) — Dead code & duplicate components
2. **Phase 2 — State & data flow**
   - [04-localstorage-audit.md](./04-localstorage-audit.md) — localStorage / sessionStorage usage classification
   - [05-context-bloat.md](./05-context-bloat.md) — Context provider bloat & split plan
3. **Phase 3 — Security**
   - [06-auth-authorization.md](./06-auth-authorization.md) — Auth coverage across all 67 API routes
   - [07-service-role-key.md](./07-service-role-key.md) — Service-role key exposure & RLS coverage
   - [08-input-validation.md](./08-input-validation.md) — Input validation & mass-assignment audit
   - [09-rate-limit-secrets.md](./09-rate-limit-secrets.md) — Rate-limit coverage, secret loading, log hygiene
   - [10-xss-injection.md](./10-xss-injection.md) — XSS / HTML injection / unsafe DOM sinks
4. **Phase 4 — API layer**
   - [11-api-consistency.md](./11-api-consistency.md) — Response shape, status codes, naming, method semantics
   - [12-query-efficiency.md](./12-query-efficiency.md) — N+1, atomicity, race conditions, indexes
5. **Phase 5 — Frontend quality**
   - [13-typescript-escape-hatches.md](./13-typescript-escape-hatches.md) — `any`, casts, `eslint-disable`, tsconfig posture
   - [14-client-server-boundary.md](./14-client-server-boundary.md) — `'use client'` overuse, useEffect-fetched data, RSC opportunities
6. **Phase 6 — Build & deploy hygiene**
   - [15-dependencies.md](./15-dependencies.md) — Outdated, advisories, unused, misplaced types
   - [16-env-parity.md](./16-env-parity.md) — `example.env` vs actual env-var reads, next.config posture

## How to use these audits

- **During audit phase:** read the findings, verify, push back on anything that looks wrong.
- **During refactor phase:** open the relevant audit md as the source of truth for what needs changing. Each finding is numbered so we can reference them in PRs/commits (e.g. "fixes 01-F3").
