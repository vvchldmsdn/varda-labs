# Curated Approved-Vector Self-Confirmation Semantics Approval

Last updated: 2026-07-13

Status: approved by explicit user decision on 2026-07-13. This record approves
the reviewed docs-only semantics only. It does not authorize schema, migration,
database access, repository, auth runtime, writer, API, UI, or operator mode.

## Reviewed Artifact

| Field | Approved value |
| --- | --- |
| contract | `docs/simulation-curated-approved-vector-actor-confirmation-audit-decision-packet.md` |
| reviewed commit | `3b9239e` |
| full commit | `3b9239e0f2325fd20e6bafb233eecd57fd8a6b56` |
| approval date | `2026-07-13` |

The reviewed packet intentionally retains its pre-approval draft status. This
separate record preserves the later user decision without rewriting the exact
artifact that was reviewed.

## Approved Semantics

The user explicitly approved this bundle:

1. The first future actor mode is `tenant_self_approval_v1`.
   - A verified active `TenantContext` must resolve the canonical actor and
     canonical owner to the same app user.
   - Operator approval remains disabled and is not a fallback.
2. The pre-commit confirmation challenge is a server-minted exact instance.
   - It is valid for exactly 10 minutes over `[issuedAt, expiresAt)` using
     server time.
   - There is no grace period, refresh, extension, or terminal-state reuse.
3. The challenge `pending -> consumed` transition, committed receipt,
   approval header, complete normalized vector rows, and initial lifecycle
   event are one atomic approval transaction.
   - A rollback leaves neither `consumed` state nor a committed receipt.
4. A committed receipt may return the same sanitized outcome only for the
   same consumed challenge after a new active verified session resolves to the
   same canonical owner.
   - A challenge handle is lookup material, not bearer read authority.
5. `expired`, `invalidated`, and `conflicted` challenges are terminal, create
   no committed receipt, and cannot be reused.
   - A later attempt requires a new canonical review and a new challenge.
   - Historical terminal challenges do not prevent a later valid review.
6. A malformed, unknown, cross-owner, or unauthorized request cannot consume,
   invalidate, conflict, or reveal a legitimate challenge.

## Explicitly Not Approved

This decision does not authorize:

- challenge or receipt tables, columns, indexes, constraints, DDL, or
  migration;
- a database read, write, seed, import, backfill, cleanup, or approval row;
- a repository, planner, transaction, writer, lock, timeout, retry, or runtime
  trust adapter;
- auth/session integration, identity linking, user activation, RLS, or
  operator authentication;
- API routes, Server Actions, pages, components, admin controls, jobs, or
  Cron; or
- simulation execution, optimizer use, recommendation, rebalance, or order
  behavior.

## Authorized Next Review

The next artifact may be an unapproved docs-only write-safety decision packet
covering:

1. a finite source-vector row cap;
2. exact-identity lock derivation and transaction isolation;
3. bounded lock and statement timeouts;
4. no-retry or bounded-retry behavior; and
5. typed busy, conflict, rollback, and committed-replay outcomes.

That packet must return for explicit review. It cannot implement or authorize
any schema, database, repository, auth, runtime, API, UI, job, seed, import,
backfill, or operator behavior.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
