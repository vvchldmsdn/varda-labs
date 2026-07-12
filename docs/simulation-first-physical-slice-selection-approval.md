# Simulation First Physical Slice Selection Approval

Last updated: 2026-07-13

Status: approved by explicit user decision on 2026-07-13. This record approves
review ordering only. It does not approve a physical schema contract or any
implementation.

## Reviewed Artifact

| Field | Approved value |
| --- | --- |
| packet | `docs/simulation-first-physical-slice-selection-packet.md` |
| reviewed commit | `0174e24` |
| full commit | `0174e240ccd97e3fb6f575314e67418d60dfbeba` |
| approval date | `2026-07-13` |

The reviewed packet intentionally preserves its pre-approval status. This
separate record documents the later user decision without rewriting the exact
reviewed artifact.

## Approved Ordering

1. **First review target:** curated approved-vector persistence enters a later,
   separately reviewed docs-only physical schema-contract gate first.
2. **Separate later category:** immutable admitted run-input capture remains a
   distinct follow-up persistence category.

The two categories remain separate authorities. Their ordering does not permit
one category to store, infer, substitute, or authorize the other.

## Required Meaning

The curated approved-vector category is not:

- an observed current baseline;
- a default or current portfolio;
- a target policy;
- a recommendation, rebalance, or order authority;
- an immutable admitted run input;
- job state, partial output, path data, or result storage; or
- permission to use the recorded research vector at runtime.

A missing curated approval cannot fall back to current weights, target weights,
equal weights, legacy `weights_json`, a newest or singleton row, or another
owner, account, scenario, version, or revision.

## Explicitly Not Approved

This ordering decision does not approve:

- the contents of a physical schema contract;
- tables, columns, enums, types, FKs, checks, constraints, unique or partial
  indexes, triggers, functions, DDL, SQL, Drizzle declarations, migrations, or
  RLS;
- transaction or locking mechanisms, database reads or writes, repository
  code, cache behavior, seeds, imports, or backfills;
- auth/session integration, identity linking, app-user activation, tenant
  enforcement, or ownership mutation;
- runtime resolution or execution, providers, APIs, UI, jobs, or Cron; or
- optimizer, recommendation, rebalance, order, fee, tax, or cost behavior.

The later immutable admitted run-input category is not cancelled, merged, or
implicitly specified by this decision.

## Authorized Next Gate

The next candidate may be an **unapproved docs-only draft** of the curated
approved-vector physical schema contract. It must remain limited to reviewable
candidate shapes, invariants, transaction boundaries, explicit projections,
migration ordering, rollback behavior, and a no-data dry-run rehearsal plan.

Drafting that contract does not approve its contents. The draft must return for
explicit user review before any schema, migration, repository, database, auth,
runtime, API, UI, provider, job, Cron, seed, import, backfill, or RLS work.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
