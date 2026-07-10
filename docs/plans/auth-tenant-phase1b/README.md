# Phase 1B Non-Active Drafts

These files are review artifacts only.

- They are outside `src/db/schema.ts` and `drizzle/`.
- `drizzle.config.ts` cannot discover or apply them.
- Files ending in `.sql.txt` are intentionally not migration files.
- No command in this folder is approved for production execution.
- The exact staged order is documented in
  `docs/auth-tenant-phase1b-migration-plan.md`.

Contents:

| File | Purpose |
| --- | --- |
| `target-schema-delta.ts.txt` | Exact final Drizzle additions/constraint shapes for review |
| `01-expand.sql.txt` | Expand-only DDL draft |
| `02-guarded-backfill.sql.txt` | Parameterized transaction body for a future guarded command |
| `03-contract.sql.txt` | Bodies for separately reviewed custom constraint, validation, cutover, and rename migrations |
| `backfill-command-contract.md` | CLI safety, dry-run, manifest, logging, and rerun contract |

The drafts deliberately contain no real owner UUID, provider subject, legacy
owner value, credential, token, or secret.
