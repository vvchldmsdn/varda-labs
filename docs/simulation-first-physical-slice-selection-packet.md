# Simulation First Physical Slice Selection Packet

Last updated: 2026-07-13

Status: `docs_only_draft_for_review_not_approved`

This packet recommends which logical persistence category should enter a later
physical schema-contract review first. It does not select tables, columns,
constraints, migrations, repositories, database operations, runtime behavior,
APIs, or UI.

## Decision Question

Which separately approved logical category should be the first candidate for a
future physical schema contract?

1. curated approved-vector persistence; or
2. immutable admitted run-input capture.

The categories must remain separate regardless of ordering. Selecting a first
review target does not authorize either implementation.

## Approved Inputs To This Review

This packet relies on these existing decisions without widening them:

- `docs/simulation-approved-scenario-vector-storage-model-decision-packet.md`
  already approves the curated storage basis and lifecycle semantics:
  immutable approval header, normalized vector rows, explicit zero-bps rows,
  same-transaction lifecycle audit, no duplicate JSON authority, no
  `is_current`, terminal lifecycle transitions, exact-identity serialization,
  and a future database-enforced zero-or-one current approval invariant;
- `docs/simulation-execution-input-authority-approval.md` approves separation
  between curated approvals and immutable admitted run inputs; and
- `docs/simulation-scenario-vector-resolver-approval-source-trust-boundary-contract.md`
  keeps Markdown, Git, request values, current holdings, and singleton/newest
  rows outside runtime approval authority.

Those decisions approve semantics only. They do not approve a physical schema
or runtime trust source.

## Option A: Curated Approved-Vector Persistence First

The first later schema-contract review would cover only the physical
representation of the already-approved curated authority:

- immutable approval revisions;
- normalized canonical vector rows;
- lifecycle state and append-only lifecycle audit coherence;
- exact owner-scoped approval identity;
- zero-or-one current approved revision per exact identity; and
- minimized owner-first repository projections as a future boundary.

It would not store observed holdings, explicit one-off commands, optimizer
candidates, admitted run inputs, execution parameters, job progress, partial
results, paths, result summaries, or recommendations.

### Advantages

- The storage basis and lifecycle semantics are already explicitly approved.
- The category has a narrow authority purpose independent of simulation
  horizon, path count, bootstrap, carry, current valuation, or result storage.
- Its integrity requirements can be reviewed without turning an approval row
  into mutable job state or execution input.
- It establishes a future authoritative source boundary before an orchestrator
  can accidentally treat Markdown, request input, or a hash match as approval.

### Remaining Gates

Even if selected first, A still requires separate review and approval for:

- candidate tables, columns, types, constraints, indexes, and migration order;
- transaction and concurrency mechanisms that implement the approved
  lifecycle semantics;
- owner-aware repository reads and writes;
- auth/session-derived `TenantContext` integration and later RLS defense;
- dry-run and rollback plans; and
- any initial approval write, seed, import, or backfill.

## Option B: Immutable Admitted Run-Input Capture First

The first later schema-contract review would instead cover an immutable record
of one fully admitted execution input, including its source evidence,
projection, matrix and stochastic bindings, and server-authorized parameters.

### Advantages

- It directly supports replay and distinguishes admitted execution evidence
  from mutable job state.
- It can eventually support observed, curated, explicit-user, and optimizer
  sources through source-specific evidence bindings.

### Current Blockers

B is not ready to enter physical schema review first because the following
inputs remain deliberately deferred:

- the owner-scoped current-position read adapter and exact eligible evidence
  kinds;
- observed-baseline position, price, and FX service-date mapping and maximum
  carry values;
- maximum component-position count;
- production horizon, path count, seed, bootstrap, cost, timeout, memory,
  concurrency, retry, and retention values; and
- authenticated tenant/runtime integration.

Choosing a physical shape before those policies exist would encourage generic
JSON or mixed-state storage that combines source evidence, parameters, job
progress, and results. It could also reintroduce legacy-style mutable
`weights_json`, current-like snapshot fallback, or owner/account ambiguity.

## Recommendation

Select **Option A, curated approved-vector persistence, as the first physical
schema-contract review target**.

This recommendation is about ordering only. It does not:

- make a curated scenario the current portfolio, target policy, product
  default, recommendation, or order instruction;
- approve the recorded research vector for runtime use;
- permit fallback from a missing curated approval to current weights, target
  weights, equal weights, legacy JSON, or another owner/version;
- authorize any schema or implementation; or
- cancel Option B. Immutable admitted run-input capture remains a separate
  later category after its deferred source and parameter policies are fixed.

## Legacy Exclusions Preserved

Neither future category may copy legacy ambiguity into a new authority model.
The following are not curated approval authority or admitted run-input
authority by themselves:

- legacy owner strings, body/header owner overrides, or account labels;
- mutable `weights_json`, asset blobs, or current-holding snapshots;
- seed, as-of date, job/chunk status, and partial results mixed into an approval
  record; or
- delete-and-replace shard state, newest/singleton lookup, or implicit default
  vectors.

## Review Decision

The user may approve, amend, reject, or defer this recommendation.

Approval would mean only:

> Curated approved-vector persistence is the first candidate for a separately
> reviewed docs-only physical schema contract. Immutable admitted run-input
> capture remains a separate later category.

Approval would not approve the later schema contract itself.

## Explicit Non-Actions

This packet does not authorize or implement:

- schema, table, column, enum, FK, check, unique or partial index, trigger,
  function, DDL, SQL, Drizzle declaration, migration, or RLS;
- transaction code, lock strategy, repository, cache, database read or write;
- auth provider, session adapter, identity link, app-user activation, or
  ownership enforcement;
- resolver integration, execution orchestration, provider call, job, Cron,
  seed, import, backfill, or cleanup;
- API, Server Action, route, page, component, control, or client payload; or
- simulation execution, optimizer, recommendation, rebalance, or order logic.

This Markdown packet is review evidence only. It is not imported by code and
is not a runtime trust source.
