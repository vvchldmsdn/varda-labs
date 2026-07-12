# Curated Approved-Vector Schema Implementation And Rehearsal Packet

Last updated: 2026-07-13

Status: `docs_only_draft_for_review_not_approved`

This packet proposes the exact local files, Drizzle declarations, generated-SQL
allowlist, static tests, rollback rehearsal, migration order, deployment checks,
and stop conditions for the approved curated-vector physical schema contract.

It does not authorize any file edit, command execution, database connection,
DDL, migration, repository, runtime use, or data write.

## Approved Inputs

This packet is bounded by:

- `docs/simulation-curated-approved-vector-physical-schema-contract.md` at
  reviewed commit `7085b7cd01f6b03a3b9da47ab786507def279c11`;
- `docs/simulation-curated-approved-vector-physical-schema-approval.md`;
- `docs/simulation-approved-scenario-vector-storage-model-decision-packet.md`;
- `docs/simulation-scenario-vector-resolver-approval-source-trust-boundary-contract.md`;
  and
- `docs/simulation-first-physical-slice-selection-approval.md`.

No lower-level artifact may widen those approvals.

## Deferred Inputs Remain Deferred

This implementation packet does not choose or simulate:

- a maximum vector-row count;
- advisory-lock serialization SQL;
- retry, timeout, or typed-conflict policy;
- database role, trigger, function, or stored-procedure immutability controls;
- RLS or child-row policy behavior;
- a writer, repository, runtime resolver adapter, or approval source; or
- seed, import, backfill, initial approval, revocation, supersession, or
  reapproval data.

The rollback rehearsal validates empty-schema atomicity only. It must not claim
to validate future write-contract lock, retry, conflict, hash, lifecycle, or
tenant behavior.

## Staged Approval Model

The implementation must be split into three later explicit approvals.

### Stage I: Local Schema Candidate

May later authorize only:

- reviewed `src/db/schema.ts` declarations and inferred types;
- one generated but unapplied Drizzle migration and metadata;
- one static migration/schema test and `tests/run.mjs` registration;
- one rollback-rehearsal script and package-script entry that cannot run without
  an exact confirmation argument; and
- local `npm run test`, `npm run lint`, and `npm run build`.

Stage I does not authorize a production database connection, rehearsal, or
migration application.

### Stage II: Rollback-Only Rehearsal

May later authorize one explicit production or approved preview connection that
executes the exact reviewed DDL in a transaction, checks only catalog shape and
empty target tables, raises the expected marker, rolls back, and proves before
and after state equality.

Stage II performs no approval-row DML and does not authorize migration apply.

### Stage III: Empty Migration And Deployment

May later authorize the exact reviewed migration against production, verify the
three new tables are empty, and then deploy the matching code. It still does
not authorize a repository, writer, data row, runtime resolver, API, UI, or RLS.

Approval of one stage never implies approval of the next.

## Stage I File Allowlist

Only these candidate file changes are permitted by a future Stage I approval:

| File | Candidate change |
| --- | --- |
| `src/db/schema.ts` | Add `primaryKey` import, three table declarations, and six inferred select/insert types. |
| `drizzle/0017_<generated-tag>.sql` | One generated, unapplied migration containing only the approved empty schema. |
| `drizzle/meta/0017_snapshot.json` | Generated Drizzle metadata for the same schema. |
| `drizzle/meta/_journal.json` | One generated journal entry only. |
| `tests/simulation-curated-vector-schema.test.mjs` | Static schema and generated-SQL allowlist tests; no DB connection. |
| `tests/run.mjs` | Register exactly the new static test. |
| `scripts/rehearse-curated-vector-schema.mjs` | Explicit-confirmation rollback-only catalog rehearsal. |
| `package.json` | Add one `rehearse:curated-vector-schema` script. |

The generated migration tag is unknown until `npm run db:generate`. The
implementation must stop if the next journal index is not `17` or generation
touches any additional migration snapshot or historical migration.

No page, route, component, query, API, auth, provider, import, job, Cron, or
simulation calculation file is in the allowlist.

## Exact Drizzle Declaration Candidate

The declarations belong in `src/db/schema.ts` after the identity tables and
before product data tables. They are not imported by any runtime module in this
slice.

### Import Delta

Add only `primaryKey` from `drizzle-orm/pg-core`. Existing `check`,
`foreignKey`, `index`, `integer`, `pgTable`, `timestamp`, `uniqueIndex`, `uuid`,
`varchar`, and `sql` imports are reused.

### Header Export

Candidate export:

```text
simulationScenarioApprovalRevisions
  -> simulation_scenario_approval_revisions
```

Exact columns:

| TypeScript field | SQL column | Drizzle candidate |
| --- | --- | --- |
| `id` | `id` | `uuid`, random default, primary key |
| `ownerUserId` | `owner_user_id` | `uuid`, non-null |
| `portfolioPathPolicyId` | `portfolio_path_policy_id` | `varchar(100)`, non-null |
| `gate0ApprovalCommit` | `gate0_approval_commit` | `varchar(40)`, non-null |
| `scenarioId` | `scenario_id` | `varchar(100)`, non-null |
| `scenarioVersion` | `scenario_version` | `varchar(100)`, non-null |
| `approvalRevision` | `approval_revision` | `integer`, non-null |
| `scenarioVectorHash` | `scenario_vector_hash` | `varchar(71)`, non-null |
| `approvedAt` | `approved_at` | `timestamp with time zone`, non-null, no default |
| `lifecycleStatus` | `lifecycle_status` | `varchar(20)`, non-null, no default |
| `terminalAt` | `terminal_at` | `timestamp with time zone`, nullable |

Exact constraint and index names proposed for review:

```text
sim_scenario_approval_revisions_owner_user_fk
sim_scenario_approval_revisions_policy_id_check
sim_scenario_approval_revisions_gate0_commit_check
sim_scenario_approval_revisions_scenario_id_check
sim_scenario_approval_revisions_scenario_version_check
sim_scenario_approval_revisions_revision_check
sim_scenario_approval_revisions_vector_hash_check
sim_scenario_approval_revisions_lifecycle_status_check
sim_scenario_approval_revisions_terminal_state_check
sim_scenario_approval_revisions_identity_revision_unique
sim_scenario_approval_revisions_current_unique
```

Every proposed name is under PostgreSQL's 63-byte identifier limit.

The owner FK references `appUsers.id` with `ON DELETE RESTRICT`. The descriptor,
commit, hash, revision, lifecycle, and terminal-time checks exactly implement
the approved contract. The identity-revision unique index covers:

```text
(owner_user_id,
 portfolio_path_policy_id,
 gate0_approval_commit,
 scenario_id,
 scenario_version,
 approval_revision)
```

The current unique index uses the same first five fields with the exact partial
predicate `lifecycle_status = 'approved'`.

There is no separate owner index because both approved unique indexes begin
with `owner_user_id`. There is no scenario-id-only or timestamp-order index.

### Vector-Row Export

Candidate export:

```text
simulationScenarioApprovalVectorRows
  -> simulation_scenario_approval_vector_rows
```

Exact columns:

| TypeScript field | SQL column | Drizzle candidate |
| --- | --- | --- |
| `approvalRevisionId` | `approval_revision_id` | `uuid`, non-null |
| `market` | `market` | `varchar(20)`, non-null |
| `currency` | `currency` | `varchar(10)`, non-null |
| `ticker` | `ticker` | `varchar(50)`, non-null |
| `weightBps` | `weight_bps` | `integer`, non-null |

Exact names:

```text
sim_scenario_approval_vector_rows_pk
sim_scenario_approval_vector_rows_revision_fk
sim_scenario_approval_vector_rows_market_check
sim_scenario_approval_vector_rows_currency_check
sim_scenario_approval_vector_rows_ticker_check
sim_scenario_approval_vector_rows_weight_check
```

The composite primary key is
`(approval_revision_id, market, currency, ticker)`. The parent FK uses
`ON DELETE RESTRICT`. Identity checks require market lowercase and trimmed,
currency/ticker uppercase and trimmed, and all three non-empty. Weight is an
integer from zero through 10,000 inclusive.

No child UUID, ordinal, `asset_id`, account, display name, JSON, target, current
weight, price, FX, quantity, or market value is added.

### Lifecycle-Event Export

Candidate export:

```text
simulationScenarioApprovalLifecycleEvents
  -> simulation_scenario_approval_lifecycle_events
```

Exact columns:

| TypeScript field | SQL column | Drizzle candidate |
| --- | --- | --- |
| `id` | `id` | `uuid`, random default, primary key |
| `approvalRevisionId` | `approval_revision_id` | `uuid`, non-null |
| `eventSequence` | `event_sequence` | `integer`, non-null |
| `auditVersion` | `audit_version` | `varchar(50)`, non-null |
| `transitionKind` | `transition_kind` | `varchar(32)`, non-null |
| `previousStatus` | `previous_status` | `varchar(20)`, nullable |
| `resultingStatus` | `resulting_status` | `varchar(20)`, non-null |
| `transitionedAt` | `transitioned_at` | `timestamp with time zone`, non-null |
| `replacementRevisionId` | `replacement_revision_id` | `uuid`, nullable |

Exact names:

```text
sim_scenario_approval_events_revision_fk
sim_scenario_approval_events_replacement_fk
sim_scenario_approval_events_revision_sequence_unique
sim_scenario_approval_events_replacement_idx
sim_scenario_approval_events_sequence_check
sim_scenario_approval_events_audit_version_check
sim_scenario_approval_events_transition_shape_check
```

Both revision FKs reference the header and use `ON DELETE RESTRICT`. The unique
index covers `(approval_revision_id, event_sequence)`. The replacement index is
non-unique and covers the nullable replacement FK.

Checks require event sequence one or two, exact audit version
`scenario_vector_approval_audit_v1`, and one of the three approved transition
shapes. Cross-row effective-time equality, same identity/content, and higher
replacement revision remain future write/repository checks, not a trigger.

### Inferred Types

Candidate exports at the end of `src/db/schema.ts`:

```text
SimulationScenarioApprovalRevision
NewSimulationScenarioApprovalRevision
SimulationScenarioApprovalVectorRow
NewSimulationScenarioApprovalVectorRow
SimulationScenarioApprovalLifecycleEvent
NewSimulationScenarioApprovalLifecycleEvent
```

No runtime module imports these types in Stage I.

## Generated SQL Allowlist

The generated migration must be inspected before any DB connection. It may
contain only:

- three `CREATE TABLE` statements for the exact approved names;
- three primary keys;
- fifteen approved check constraints;
- four FKs: header owner, vector parent, event parent, event replacement;
- three unique indexes: exact identity/revision, partial current, and
  event/revision sequence;
- one regular replacement-revision index; and
- Drizzle statement breakpoints.

The migration may reference `app_users` only as the target of the owner FK. It
must not alter `app_users` or any existing table.

### Hard SQL Rejections

Static tests must reject:

- `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `COPY`, or `TRUNCATE`;
- `DROP`, `RENAME`, `ALTER COLUMN`, `SET DEFAULT`, `SET NOT NULL`, `CASCADE`,
  `CREATE TYPE`, trigger, function, procedure, policy, RLS, grant, or revoke;
- any `ALTER TABLE` whose subject is not one of the three new tables;
- `neon_auth`, legacy owner fields, `created_by_id`, account, `asset_id`,
  `weights_json`, JSON/JSONB, email, provider subject, token, password, secret,
  API key, job, result, path, seed, horizon, price, FX, target, or current-weight
  columns; and
- any default for approved time, lifecycle status, terminal time, event time,
  transition kind, or audit version.

Forbidden fields are checked as parsed column or object identities, not as
unbounded substring matches. For example, the approved
`portfolio_path_policy_id` contains `path` but is not a path artifact column.
Statement-level destructive keywords still use token-boundary checks.

Generation stops if the migration changes an existing migration file, produces
more than one new migration, or the active Drizzle snapshot does not match the
three declarations.

## Static Test Contract

Candidate test file:
`tests/simulation-curated-vector-schema.test.mjs`.

It follows the existing `tenant-expand-migration.test.mjs` pattern and performs
no network or DB access.

### Schema Assertions

- exactly three approved `pgTable` exports exist;
- the exact SQL table names and column allowlists match;
- `owner_user_id` is non-null and references `app_users`, not `neon_auth`;
- the vector table has the approved composite primary key;
- all four FKs use delete restriction;
- the exact checks and indexes exist once;
- the partial unique index uses only the exact identity and approved predicate;
- explicit zero weight remains allowed;
- no forbidden field, JSON vector, `is_current`, child owner duplicate, account,
  asset FK, or ordinal occurs inside the three declaration blocks; and
- exactly six inferred types are exported.

### Migration Assertions

- exactly three approved tables are created;
- exact column type/null/default shape matches the declarations;
- exact check, FK, primary, unique, and regular index name sets match;
- statement subjects remain in the allowlist;
- no existing table is altered;
- no DML or hard-rejected SQL appears; and
- schema source, migration SQL, and Drizzle metadata describe the same objects.

### Boundary Assertions

The test also scans product/API/query files to prove Stage I adds no import of
the three new table exports. This prevents an empty schema change from silently
becoming a read or write path.

`tests/run.mjs` receives one import for this test and no other change.

## Rollback-Rehearsal Script Contract

Candidate script:
`scripts/rehearse-curated-vector-schema.mjs`.

It must fail before reading a database URL unless its arguments are exactly:

```text
--confirm-rollback-rehearsal
```

It loads `.env.local`, prefers `DATABASE_URL_UNPOOLED`, and otherwise uses
`DATABASE_URL`. It reads only the exact generated migration path pinned after
Stage I review.

### Preflight

Before starting the transaction, the script must prove:

- the current tenant phase is one of the separately approved existing states;
- `app_users` exists, without requiring an active identity or changing a user;
- none of the three candidate tables exists;
- the generated migration still passes the same statement allowlist; and
- existing public table names and selected row-count evidence are captured for
  exact before/after comparison.

It must not require `app_users` to be empty, infer a canonical owner, or inspect
legacy owner strings.

### Transaction

The transaction performs only:

1. `SET LOCAL lock_timeout = '5s'`;
2. `SET LOCAL statement_timeout = '30s'`;
3. each allowlisted generated DDL statement;
4. catalog assertions for exact tables, columns, nullability, types, defaults,
   PKs, checks, FKs, indexes, and partial-index predicate;
5. assertions that all three new tables have zero rows and existing selected
   row counts did not change; and
6. an expected exception with a unique rollback marker.

There is no approval, owner, vector, event, auth, product, or fixture DML.
Constraint behavior fixtures remain local/static until a later separately
approved isolated-database test gate.

### Postflight

After observing only the expected marker, the script rereads boundary state and
requires exact equality with preflight. Its output is a sanitized JSON summary:

```text
rehearsal
committed: false
expectedRollbackObserved: true
databaseSideEffects: false
statementsExercised
catalogBefore
catalogAfter
```

It must not print a database URL, owner UUID, environment value, raw SQL error,
provider/session value, hash, vector row, or secret-shaped value.

Any unexpected error is rethrown after sanitizing user-facing output; it is not
mistaken for successful rollback.

## Candidate Package Script

The only package addition is:

```text
rehearse:curated-vector-schema
  -> node --no-warnings scripts/rehearse-curated-vector-schema.mjs
```

The package command has no default confirmation flag. Running it without the
exact flag fails closed before any DB connection.

## Stage I Command Order

After separate Stage I approval, the local-only order is:

1. confirm clean worktree and current migration index `16`;
2. edit only the Stage I allowlist;
3. run `npm run db:generate` once;
4. capture and review the generated `0017` tag, SQL, snapshot, and journal;
5. finalize the static test's exact migration path and object allowlists;
6. run `npm run test`;
7. run `npm run lint`;
8. run `npm run build`;
9. rerun `git diff --check` and an exact changed-file allowlist;
10. create one local review commit only after all checks pass; and
11. do not push that implementation commit to the Vercel deployment branch.

Stage I must not run `db:migrate`, the rehearsal command, a catalog query, a
provider call, or any script with a production write path. The local commit is
the exact artifact reviewed for Stages II and III.

## Stage II Rehearsal Order

After separate Stage II approval:

1. verify the deployed application still has no import of the new tables;
2. rerun local static tests against the exact committed migration;
3. run the rehearsal once with the exact confirmation argument;
4. verify expected rollback and exact before/after equality;
5. rerun production read-only health and row-count audits; and
6. stop and report evidence.

Do not run `db:migrate` or deploy a writer in Stage II.

## Stage III Migration And Deployment Order

After separate Stage III approval:

1. revalidate the exact Stage II commit and clean worktree;
2. rerun `npm run test`, `npm run lint`, and `npm run build`;
3. prove the target migration journal has exactly the reviewed `0017` migration
   pending and no other pending migration;
4. run `npm run db:migrate` once against the reviewed target;
5. verify all three tables, constraints, and indexes and prove all three tables
   have zero rows;
6. verify existing product table counts, auth/tenant state, and product route
   behavior are unchanged;
7. push the already-tested local implementation commit to the deployment
   branch and wait for deployment;
8. verify no API/RSC/product projection exposes new owner or approval fields;
9. rerun read-only deployment smoke; and
10. stop without creating a repository, writer, or approval row.

Vercel auto-deploys on the deployment-branch push, so the exact migration must
be applied and verified before that push. The previously deployed code ignores
the new empty tables, and the new declarations remain unimported by runtime
code.

## Rollback And Stop Conditions

### Stage I

Discard or amend generated local files if any allowlist or test fails. Do not
connect to a DB to diagnose a static mismatch.

### Stage II

Only the expected forced rollback is success. Stop on a lock timeout,
unexpected SQL error, catalog mismatch, preexisting candidate table, row-count
drift, tenant-state drift, or failure to prove exact postflight equality.

### Stage III Before Any Authority Row

If migration succeeds but deployment must be rolled back, old code may continue
because it ignores the empty tables. Dropping empty tables requires a separate
review, zero-row and zero-consumer proof, reverse dependency order, and no
`CASCADE`.

### After Any Future Authority Row

Drop, truncate, delete, rewrite, or rollback migration is forbidden. Disable
the later consumer/writer and use a separately reviewed forward repair.

### Global Stop Conditions

Stop the entire slice if any evidence shows:

- mismatch with reviewed contract commit `7085b7c`;
- a deferred policy filled implicitly;
- authority fallback, current/latest/singleton lookup, or legacy ownership;
- loss of a zero row or change to canonical identity/hash semantics;
- existing table or row mutation;
- unallowlisted SQL object or file;
- product/API/UI projection widening;
- auth/session/RLS or runtime coupling; or
- any approval, vector, or lifecycle row creation.

## Legacy And Leakage Audit

The static tests and review must prove the implementation contains no authority
path from:

- Base44 owner strings, `created_by_id`, email, provider subject, Basic Auth,
  account selector, asset membership, or singleton state;
- `weights_json`, current holdings, target weights, prices, FX, as-of values,
  seed, horizon, matrix/draw hashes, job/chunk state, partial diagnostics,
  paths, results, or optimizer output; or
- Markdown, Git history, fixtures, environment values, raw request data, or a
  secret-shaped field.

The canonical owner FK is a referential prerequisite only. Empty table creation
does not prove tenant readiness, repository readiness, write readiness, runtime
trust, or RLS isolation.

## Review Decisions

The user should approve, amend, reject, or defer:

1. the three-stage approval split;
2. the exact Stage I file allowlist;
3. the Drizzle fields and exact constraint/index name candidates;
4. the generated SQL allowlist and hard rejections;
5. the static schema/migration/boundary tests;
6. the rollback-rehearsal preflight, transaction, output, and confirmation
   guard;
7. the Stage I, II, and III command/deployment ordering; and
8. rollback, stop, legacy, and projection-leakage conditions.

Approval of this packet would approve the implementation and rehearsal plan
only. It would not approve Stage I file edits or commands, Stage II DB
rehearsal, Stage III migration/deployment, or any repository, writer, auth,
runtime, API, UI, job, Cron, seed, import, backfill, or RLS work.

## Explicit Non-Actions

This draft does not:

- edit schema, tests, scripts, package metadata, or Drizzle files;
- run `db:generate`, test, lint, build, rehearsal, or migration commands;
- connect to or query a database;
- add repository, resolver, route, API, UI, provider, job, or Cron behavior;
- create or mutate an app user, identity, owner, approval, vector, event, or
  product row; or
- authorize immutable admitted run-input persistence.

This Markdown packet is review evidence only. It is not imported by code and
is not a runtime trust source.
