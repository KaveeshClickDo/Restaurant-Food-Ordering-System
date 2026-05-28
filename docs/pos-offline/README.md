# POS Offline-Capable Android — Planning Workspace

This folder holds the planning artifacts for adding offline-capable POS
functionality to the existing web `/pos`, delivered as an Android app via
the Capacitor wrapper that already exists in this repo.

The web `/pos` is **not** being rewritten. It continues to operate exactly
as it does today (Supabase as source of truth, online-only). The Android
build of the same Next.js codebase gains an offline mode behind a
`Capacitor.isNativePlatform()` runtime check.

## Reading order

Always start here. Open the docs below in numbered order.

| # | File | Purpose | Lifecycle |
|---|------|---------|-----------|
| 00 | [00-architecture.md](./00-architecture.md) | Dual-mode contract: web online-only / Android offline-capable. The single architectural decision everything else flows from. | Stable — change requires a 09 decision-log entry |
| 01 | [01-audit-call-graph.md](./01-audit-call-graph.md) | POS sale flow end-to-end with file paths and line refs. | Snapshot of current code |
| 02 | [02-audit-schema.md](./02-audit-schema.md) | Every table the POS reads/writes. Columns, indexes, sequences. | Snapshot of current schema |
| 03 | [03-audit-android.md](./03-audit-android.md) | Capacitor + Kotlin inventory. What works / what's broken / what depends on deleted code. | Snapshot — re-verify before phase 1 |
| 04 | [04-audit-coupling.md](./04-audit-coupling.md) | Who else reads `pos_sales` / `orders` / `pos_staff`. These are the regression risks. | Snapshot |
| 05 | [05-audit-dead-code.md](./05-audit-dead-code.md) | Code from the old localStorage POS still present but unreferenced. Cleanup candidates. | Snapshot — cleared by the cleanup PR |
| 06 | [06-schema-changes.md](./06-schema-changes.md) | Concrete SQL for additive schema changes (new columns, new tables, new indexes). | Living — appended per phase |
| 07 | [07-phases.md](./07-phases.md) | Phased work plan with acceptance criteria per phase. | Living — checked off as phases complete |
| 08 | `08-risk-register.md` | Every existing feature that could regress + the test that proves it didn't. | Living — appended as risks are discovered |
| 09 | `09-decisions.md` | Append-only decision log. Date + decision + reason. | Append-only |
| 10 | `10-test-plan.md` | Per-phase regression test scripts. Manual + automated where applicable. | Living — appended per phase |

Files 06 and 07 are now written. Files 08, 09, 10 are deferred — 09 is
opened on the first non-obvious decision during implementation; 08 and
10 are written as Phase 1 starts so they can name concrete test rows.

### Action logs (separate from the numbered planning docs)

| File | Purpose |
|------|---------|
| [phase-0-results.md](./phase-0-results.md) | Findings from the proof-of-life verifications. What works on the dev machine, what still needs hardware tests. |

## Discipline rules for this folder

1. **Every claim references actual code.** File paths and line numbers, not
   prose summaries. Prose goes stale; line refs stay useful and fail loudly
   when wrong.
2. **No comments-as-source-of-truth.** If a comment says X but the code does
   Y, the doc records what the code does. Comments are an audit signal, not
   evidence.
3. **No content lives in `README.md`.** This file is an index. Anything you
   want to write goes in a numbered doc.
4. **Numbered for sort order, not strict reading dependency** — but 00 is
   foundational and the audits (01–05) must be read before the plan (06–10)
   to avoid building on outdated assumptions.

## Project status

| Date | Phase | Status |
|------|-------|--------|
| 2026-05-28 | Planning kickoff | Audits 01–05 complete. Phase 0 software checks pass; hardware deferred to Phase 6. Plan docs 06 + 07 written. Ready to start Phase 1 implementation. |
