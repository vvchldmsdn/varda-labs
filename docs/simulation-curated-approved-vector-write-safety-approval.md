# Curated Approved-Vector Write-Safety Semantics Approval

Last updated: 2026-07-13

Status: approved by explicit user decision on 2026-07-13. This record approves
the reviewed docs-only write-safety semantics only. It does not authorize
schema, migration, database access, repository, auth runtime, writer, API, UI,
data admission, or operator mode.

## Reviewed Artifact

| Field | Approved value |
| --- | --- |
| contract | `docs/simulation-curated-approved-vector-write-safety-decision-packet.md` |
| reviewed commit | `c0a2f58` |
| full commit | `c0a2f584e167f153db0dedb6cfc418d76b2fc5bd` |
| approval date | `2026-07-13` |

The reviewed packet intentionally retains its pre-approval draft status. This
separate record preserves the later user decision without rewriting the exact
artifact that was reviewed.

## Approved Semantics

The user explicitly approved this bundle:

1. A curated source vector contains at least one and at most 64 canonical
   rows, counting every explicit zero-bps row.
   - An over-limit vector is rejected without truncation, row removal,
     renormalization, fallback, or splitting.
   - This is not an execution joint-universe, matrix, optimizer, path, or UI
     cap.
2. Exact approval identity is the tuple:
   - canonical owner user id;
   - portfolio-path policy id;
   - Gate 0 approval commit;
   - scenario id; and
   - scenario version.
3. Exact-identity lock input is versioned, domain-separated, fixed-order, and
   UTF-8 byte-length-prefixed before PostgreSQL
   `hashtextextended(..., 0)` transaction advisory serialization.
   - Advisory serialization does not replace full-identity database predicates
     or unique invariants.
4. Admission uses PostgreSQL `READ COMMITTED`, mandatory exact-identity
   transaction advisory serialization, and transaction-time revalidation.
5. Every authorized challenge transition from `pending` to a terminal state
   uses the same serialization boundary:
   - approval consumption;
   - server-time expiry;
   - same-owner cancellation;
   - policy or Gate 0 drift invalidation;
   - separately reviewed security invalidation; and
   - competing-challenge conflict.
   Only the first committed terminal transition wins.
6. Local writer safety guards are:
   - 2-second lock timeout;
   - 8-second per-SQL-statement timeout; and
   - zero automatic writer retries.
   These values are not an end-to-end runtime SLA or the earlier DDL-rehearsal
   timeout policy.
7. Confirmed rollback, unknown commit visibility, committed receipt recovery,
   busy, conflict, unusable challenge, temporary unavailability, rejection,
   and committed outcome remain distinct typed meanings.
   - No timeout, transport failure, or ambiguous result may be inferred as a
     successful approval.

## Explicitly Not Approved

This decision does not authorize:

- challenge or receipt schema, DDL, migration, row lock, compare-and-set, or
  persistence;
- any database read, write, seed, import, backfill, cleanup, or approval row;
- a planner implementation, repository, transaction, writer, lock SQL,
  timeout handler, retry loop, or runtime adapter;
- auth/session integration, identity linking, user activation, RLS, or
  operator authentication;
- API routes, Server Actions, pages, components, admin controls, jobs, or
  Cron; or
- simulation execution, optimizer use, recommendation, rebalance, or order
  behavior.

## Authorized Next Review

The next artifact may be an unapproved docs-only contract for a synthetic-only,
I/O-free conditional admission planner. That planner must:

- consume normalized in-memory synthetic evidence only;
- return conditional static eligibility or deterministic blockers;
- keep runtime trust `not_ready`;
- never establish `TenantContext`, durable database state, lock ownership,
  receipt recovery, revision allocation, or commit authority; and
- never be exposed as a production dry-run, API result, UI promise, or
  authorization fact.

That contract must return for explicit review before helper, test, schema,
database, repository, auth, runtime, API, UI, job, seed, import, backfill, or
operator work.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
