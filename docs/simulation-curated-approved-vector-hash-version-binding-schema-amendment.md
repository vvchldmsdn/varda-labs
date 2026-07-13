# Curated Approved-Vector Hash-Version Binding Schema Amendment

Recorded: 2026-07-13

Status: `docs_only_draft_for_review_not_approved`

This amendment closes one persistence ambiguity in the deployed empty curated
approval schema. It does not authorize a schema change, migration, database
access, repository, writer, approval row, runtime admission, API, or UI.

## Problem

`simulation_scenario_approval_revisions` stores `scenario_vector_hash`, but it
does not durably identify the serializer and canonicalization policy that
produced that hash. The `sha256:` prefix identifies only the digest algorithm.
It cannot distinguish `simulation_scenario_vector_hash_v1` from
`simulation_scenario_vector_hash_v2`.

The hash-version decision freezes v1 as legacy provenance and requires an
explicit durable binding before any v2 approval row may be persisted. Neither
the portfolio path policy, Gate 0 commit, scenario version, nor digest text may
be used to infer that binding.

## Minimal Physical Delta

The only proposed table change is:

| Table | Column | Type | Null | Default |
| --- | --- | --- | --- | --- |
| `simulation_scenario_approval_revisions` | `scenario_vector_hash_version` | `varchar(64)` | no | none |

The column must have this exact check:

```sql
"scenario_vector_hash_version" = 'simulation_scenario_vector_hash_v2'
```

The proposed constraint name is:

```text
sim_scenario_approval_revisions_vector_hash_version_check
```

V1 is deliberately not accepted by the new empty authority table. Existing v1
fixtures and evidence remain untouched legacy provenance. A future v3 would
require an explicit contract and constraint change; it must not be admitted by
loosening this check to an arbitrary non-empty string.

## Identity And Lifecycle Semantics

The hash version is immutable content provenance for one approval revision. It
does not become part of the owner-scoped scenario selector, revision allocator,
partial-current uniqueness key, advisory-lock identity, or lifecycle state.

No existing primary key, foreign key, unique index, regular index, vector-row
constraint, or lifecycle-event constraint changes. Explicit 0-bps rows,
canonical row order, the 64-row cap, and exact 10,000-bps total remain
unchanged.

## Repository Boundary

A future repository must explicitly select and return both:

```text
scenarioVectorHashVersion
scenarioVectorHash
```

Before recalculating or comparing a digest, the runtime must reject an
unsupported or missing version. It may dispatch only to the implementation
named by the stored version. Whole-row selection and implicit v2 defaults are
not allowed.

The existing `simulation_scenario_vector_resolver_v1` is explicitly ineligible
for v2 rows. Its frozen hash path uses
`simulation_scenario_vector_hash_v1`; it must require that exact version and
reject a missing or different version before hash validation. A future v2
repository adapter may not erase the stored version to fit that legacy port. A
separately reviewed version-aware resolver path is required before any v2 row
can become runtime evidence.

## Confirmation Boundary

Durable storage and tenant confirmation must bind the same hash version. A
future v2 challenge, approval-envelope digest, consumed confirmation record,
and receipt must all include `scenarioVectorHashVersion` alongside
`scenarioVectorHash`. Existing confirmation evidence without that field is
ineligible for v2 approval admission and cannot be upgraded by inference.

The synthetic planner already models this field, but synthetic evidence does
not authorize a production confirmation adapter. The production challenge and
receipt path remains blocked until its separately reviewed contract and
storage model preserve the version binding end to end.

## Migration Safety Boundary

The deployed `0017_workable_jimmy_woo` migration is immutable and must not be
edited. Any implementation must generate one later additive migration.

Before applying that migration, a SELECT-only preflight must prove:

1. `0017_workable_jimmy_woo` is already applied and no unexpected pending
   migration exists;
2. all three curated approval tables still contain zero rows;
3. `scenario_vector_hash_version` does not already exist; and
4. the existing 0017 constraints and indexes still match the deployed
   close-out evidence.

The migration may add only the reviewed column and exact check constraint. It
must contain no default, DML, backfill, value inference, trigger, function,
index change, table rewrite outside PostgreSQL's required empty-table catalog
operation, or unrelated schema change.

If the approval header contains any row, the migration must stop for a separate
data review. It must not label existing hashes as v1 or v2. The non-null column
without a default also provides a database-level fail-closed guard against
silently upgrading a non-empty table.

## Verification For A Later Approved Implementation

A later implementation approval should cover one bounded sequence:

1. update the Drizzle declaration with the one column and check;
2. generate exactly one migration;
3. inspect generated SQL and metadata for the allowlist above;
4. run focused schema tests plus full test, lint, and build;
5. run a transaction-scoped forced-rollback rehearsal against the target;
6. repeat the zero-row and migration-journal preflight; and
7. apply once, verify the column and constraint, then confirm all three tables
   remain empty.

Production application remains a separate explicit approval boundary. No
approval writer or v2 persistence is ready merely because this column exists.

## Decision Requested

Approve or reject only this minimal durable hash-version binding and its
fail-closed empty-table migration semantics. Implementation, migration,
repository, auth, runtime, API, UI, and data writes remain outside this draft.
