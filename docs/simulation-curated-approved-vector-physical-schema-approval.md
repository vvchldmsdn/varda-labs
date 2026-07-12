# Curated Approved-Vector Physical Schema Approval

Last updated: 2026-07-13

Status: approved by explicit user decision on 2026-07-13. This record approves
the reviewed physical schema contract semantics only. It does not authorize
schema code, DDL, migration execution, database access, or runtime use.

## Reviewed Artifact

| Field | Approved value |
| --- | --- |
| contract | `docs/simulation-curated-approved-vector-physical-schema-contract.md` |
| reviewed commit | `7085b7c` |
| full commit | `7085b7cd01f6b03a3b9da47ab786507def279c11` |
| approval date | `2026-07-13` |

The reviewed contract intentionally preserves its pre-approval status. This
separate record documents the later user decision without rewriting the exact
reviewed artifact.

## Approved Contract Groups

Each group is approved independently.

1. **Three-table boundary and names**
   - `simulation_scenario_approval_revisions`
   - `simulation_scenario_approval_vector_rows`
   - `simulation_scenario_approval_lifecycle_events`
   - Curated approval authority remains separate from admitted run inputs,
     jobs, results, observed holdings, explicit commands, and optimizer output.
2. **Approval header identity and current uniqueness**
   - Non-null canonical owner relationship to `app_users.id` with delete
     restriction.
   - Exact policy, Gate 0 commit, scenario id/version, approval revision,
     vector hash, approval time, lifecycle state, and terminal time fields.
   - Unique exact identity plus revision and a partial unique current approval
     per exact identity.
   - No account, JSON vector, `is_current`, legacy owner, current valuation, or
     execution-state field.
3. **Normalized canonical vector rows**
   - Composite identity by approval revision, market, currency, and ticker.
   - Integer weights from zero through 10,000 bps with explicit zero rows
     preserved.
   - No `asset_id`, account, ordinal, display name, JSON, current weight, or
     target weight.
4. **Append-only lifecycle evidence**
   - Sequence 1 records explicit approval; sequence 2 records the one possible
     revocation or supersession.
   - Supersession binds the old terminal state, old terminal event,
     replacement approval, and replacement creation event to one exact
     server-owned effective instant.
   - The replacement has the same exact identity and approved content, a
     higher revision, and is the one current approved revision at commit.
   - Reapproval after revocation uses a separate new approval instant.
5. **Enforcement responsibility**
   - Database constraints own FKs, row shape, checks, exact revision
     uniqueness, current cardinality, instrument uniqueness, and event shape.
   - A future write/repository contract owns tenant capability, complete
     10,000-bps total, hash recomputation, atomicity, monotonic revisions,
     content immutability, lifecycle coherence, and fail-closed state mapping.
6. **Transaction semantics**
   - Initial approval, revocation, identical-vector supersession, and
     reapproval are atomic and serialize on the full exact identity.
   - Partial authority is never visible and a failed transaction changes
     nothing.
   - The direction of transaction-scoped identity serialization is approved;
     exact advisory-lock SQL and retry behavior remain deferred.
7. **Repository projection boundary**
   - Future reads begin with server-derived tenant capability and apply owner
     plus the full exact selector.
   - Explicit projections assemble only bounded approval evidence for the pure
     resolver.
   - Owner ids, physical ids, raw events, terminal history, legacy values,
     provider/session data, and audit internals remain server-only.
8. **Additive migration and rollback boundaries**
   - A future first schema slice is three empty additive tables only.
   - Generated SQL is allowlisted, rehearsed transactionally with catalog
     assertions and forced rollback, then applied database-first before code
     references the new tables.
   - Empty unused tables may be rolled back only after zero-row and
     zero-consumer proof, in dependency order, without `CASCADE`.
   - Once authority evidence exists it is preserved and repaired forward.

## Explicit Deferred Decisions

This approval does not select:

- a maximum vector-row count;
- exact advisory-lock serialization SQL;
- retry, timeout, or typed-conflict implementation;
- database role, trigger, function, or stored-procedure immutability controls;
- exact constraint and index names beyond the approved semantics;
- RLS policy behavior or child-row policy strategy; or
- a writer, initial approval, seed, import, backfill, or data source.

Those items require later contracts and explicit review.

## Cross-Authority Exclusions

The approved physical contract does not make curated vectors equivalent to:

- observed current baselines, default portfolios, current holdings, target
  policies, recommendations, rebalances, or orders;
- immutable admitted run inputs, simulation parameters, matrix/draw bindings,
  job state, partial diagnostics, paths, or result artifacts; or
- Base44 `weights_json`, owner strings, account selectors, asset rows, latest
  records, singleton records, Markdown, Git history, or environment values.

There is no fallback from missing curated approval evidence to any other
authority.

## Explicitly Not Approved

This decision does not authorize:

- edits to `src/db/schema.ts`, Drizzle metadata, migration SQL, tests, or
  package scripts;
- DDL generation or application, database connection, reads, writes, or
  transactional rehearsal;
- repository, cache, resolver adapter, route, Server Action, API, page,
  component, admin control, job, or Cron;
- auth/session activation, identity linking, app-user changes, tenant
  enforcement, ownership mutation, or RLS;
- provider calls, runtime simulation, optimizer, recommendation, rebalance,
  order, fee, tax, or cost behavior; or
- seed, import, backfill, cleanup, revocation, supersession, or approval-row
  creation.

## Authorized Next Gate

The next candidate may be an **unapproved docs-only implementation and
rehearsal packet** for the three empty additive tables. It may enumerate exact
Drizzle declarations, generated-SQL allowlists, constraint/index candidates,
test fixtures, migration ordering, dry-run catalog assertions, deployment
checks, and rollback stop conditions.

That packet must return for explicit approval before any code, schema, DDL,
migration, database, repository, auth, runtime, API, UI, provider, job, Cron,
seed, import, backfill, or RLS action.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
