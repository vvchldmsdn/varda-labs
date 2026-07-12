# Curated Approved-Vector Schema Implementation And Rehearsal Approval

Last updated: 2026-07-13

Status: approved by explicit user decision on 2026-07-13. This record approves
the reviewed implementation and rehearsal plan semantics only. It does not
authorize any implementation stage.

## Reviewed Artifact

| Field | Approved value |
| --- | --- |
| packet | `docs/simulation-curated-approved-vector-schema-implementation-rehearsal-packet.md` |
| reviewed commit | `59f0e64` |
| full commit | `59f0e64ddc97e62a8c5589a51e8c8b9015e7bfe4` |
| approval date | `2026-07-13` |

The reviewed packet intentionally preserves its pre-approval status. This
separate record documents the later user decision without rewriting the exact
reviewed artifact.

## Approved Plan Groups

Each group is approved independently.

1. **Three-stage approval split**
   - Stage I: local schema candidate, generated but unapplied migration,
     static tests, guarded rehearsal script, and local verification.
   - Stage II: separately approved rollback-only DDL rehearsal.
   - Stage III: separately approved empty migration and deployment.
   - Approval of one stage never authorizes the next.
2. **Exact Stage I file allowlist**
   - `src/db/schema.ts`
   - one generated `drizzle/0017_<tag>.sql`, matching snapshot, and one journal
     entry
   - `tests/simulation-curated-vector-schema.test.mjs`
   - one import in `tests/run.mjs`
   - `scripts/rehearse-curated-vector-schema.mjs`
   - one `package.json` rehearsal script
   - No runtime product, query, route, API, UI, auth, job, or simulation file.
3. **Exact Drizzle declaration candidates**
   - Three approved table exports and six inferred types.
   - Approved header, normalized vector-row, and lifecycle-event columns.
   - Four delete-restrict FKs, fifteen checks, three unique indexes, one regular
     replacement index, and the approved composite vector-row primary key.
   - Proposed constraint and index names remain within PostgreSQL's identifier
     limit.
4. **Generated SQL allowlist and hard rejections**
   - Three new tables only; no existing-table alteration or data mutation.
   - No destructive DDL, enum type, trigger, function, procedure, RLS, grant,
     role, managed auth reference, legacy/current/execution field, or hidden
     default.
   - Forbidden fields are checked as parsed identities rather than unsafe broad
     substring matches.
5. **Static test plan**
   - Source, generated SQL, and metadata shapes must match exactly.
   - Object names, columns, checks, FKs, indexes, partial predicate, zero-weight
     support, and explicit projections are frozen.
   - Tests prove no product/API/query import and perform no network or DB access.
6. **Rollback-rehearsal boundary**
   - Exact confirmation is required before reading a DB URL.
   - Reads are restricted to the candidate-table catalog and the
     `app_users.id` UUID primary-key catalog signature.
   - No app-user, identity, owner, tenant, session, RLS, product-row, or global
     database-readiness inspection is permitted.
   - The transaction runs allowlisted DDL, target-scoped catalog assertions,
     zero target-row checks, and an expected forced rollback with sanitized
     output.
   - Candidate 5-second lock and 30-second statement timeouts are Stage II DDL
     rehearsal safety guards only and may be amended at Stage II review. They
     do not select future writer lock, retry, timeout, or conflict policy.
7. **Command and deployment ordering**
   - Stage I creates a local review commit and does not push to the Vercel
     deployment branch.
   - Stage II proves rollback-only target-scoped equality and stops.
   - Stage III requires exactly one reviewed pending migration, applies and
     verifies it database-first, then pushes the already-tested declarations
     for deployment.
   - No stage claims tenant readiness, global DB equality, repository readiness,
     write readiness, runtime trust, or RLS isolation.
8. **Rollback, stop, legacy, and leakage conditions**
   - Any contract mismatch, deferred-policy inference, authority fallback,
     zero-row loss, hash drift, existing-object mutation, unallowlisted file or
     SQL, projection widening, runtime/auth coupling, or authority-row creation
     stops the slice.
   - Empty unused tables may be removed only after separate review and zero-row
     and zero-consumer proof, without `CASCADE`.
   - Once authority evidence exists, preserve it and repair forward.

## Deferred Decisions Preserved

This approval does not select or authorize:

- a maximum vector-row count;
- future approval-writer advisory-lock SQL, retry, transaction timeout, or
  typed conflict behavior;
- database role, trigger, function, or stored-procedure immutability controls;
- RLS or child-row policy behavior;
- repository, writer, runtime resolver, approval source, or product projection;
- seed, import, backfill, initial approval, revocation, supersession, or
  reapproval data; or
- immutable admitted run-input persistence.

## Explicitly Not Approved

This plan approval does not authorize:

- Stage I file edits, `db:generate`, tests, lint, build, or a local
  implementation commit;
- Stage II database connection or rollback rehearsal;
- Stage III `db:migrate`, production DDL, deployment, or smoke checks;
- repository, cache, resolver adapter, API, route, Server Action, page,
  component, admin control, provider, job, or Cron;
- auth/session activation, identity link, app-user mutation, tenant
  enforcement, owner mutation, or RLS; or
- any approval, vector, lifecycle, product, import, seed, backfill, or cleanup
  row write.

## Authorized Next Gate

The next candidate is a separate **Stage I local implementation approval**.
That approval may cover only the exact Stage I file allowlist and local
`db:generate`, `test`, `lint`, and `build` commands. It must keep the resulting
implementation commit local and must not connect to a DB, run rehearsal,
execute `db:migrate`, or push to the Vercel deployment branch.

Stage II and Stage III remain separate later approvals even if Stage I passes.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
