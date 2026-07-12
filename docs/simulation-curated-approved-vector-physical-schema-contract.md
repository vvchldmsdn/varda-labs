# Curated Approved-Vector Physical Schema Contract

Last updated: 2026-07-13

Status: `docs_only_draft_for_review_not_approved`

This document proposes a physical Postgres shape for curated approved-vector
authority. It does not authorize schema declarations, generated SQL,
migrations, database access, repositories, runtime use, APIs, UI, jobs, or data
writes.

## Decision Boundary

The approved ordering selects curated approved-vector persistence as the first
physical schema-contract review target. This draft answers only:

> Can one normalized, owner-scoped Postgres shape preserve immutable approval
> revisions, canonical vector rows, and audited lifecycle transitions without
> becoming current holdings, execution input, job state, or result storage?

The answer proposed for review is three separate tables:

1. approval revision headers;
2. canonical vector rows; and
3. append-only lifecycle events.

This is a candidate design, not an implementation approval.

## Approved Semantics Preserved

The candidate shape must preserve these already-approved meanings:

- the exact logical identity is `(canonicalOwnerUserId,
  portfolioPathPolicyId, gate0ApprovalCommit, scenarioId, scenarioVersion)`;
- approval content and vector rows are immutable per revision;
- every explicit zero-bps row remains stored;
- one exact identity has zero or one current `approved` revision;
- only `approved -> revoked` and `approved -> superseded` are allowed;
- terminal revisions are never reactivated, rewritten, or deleted;
- identical-vector reapproval creates a higher immutable revision;
- approval, supersession, and reapproval serialize per exact identity;
- lifecycle state and lifecycle audit evidence change in one transaction;
- no duplicate JSON vector authority and no `is_current` column exist; and
- application owner filtering remains mandatory even if RLS is added later.

## Candidate Naming

The proposed table names are:

```text
simulation_scenario_approval_revisions
simulation_scenario_approval_vector_rows
simulation_scenario_approval_lifecycle_events
```

Names are part of this review candidate only. They do not create a schema or
reserve a migration number.

## Candidate Header Table

`simulation_scenario_approval_revisions` represents one immutable approval
revision plus its controlled current lifecycle state.

| Column | Candidate type | Null | Meaning |
| --- | --- | --- | --- |
| `id` | `uuid` | no | Server-generated physical revision id and primary key. |
| `owner_user_id` | `uuid` | no | Logical `canonicalOwnerUserId`; FK to `app_users.id`. |
| `portfolio_path_policy_id` | `varchar(100)` | no | Canonical policy descriptor. |
| `gate0_approval_commit` | `varchar(40)` | no | Lowercase full Git commit bound by the approved policy. |
| `scenario_id` | `varchar(100)` | no | Exact canonical scenario selector. |
| `scenario_version` | `varchar(100)` | no | Exact canonical scenario version. |
| `approval_revision` | `integer` | no | Positive server-owned revision number. |
| `scenario_vector_hash` | `varchar(71)` | no | Canonical `sha256:` vector hash. |
| `approved_at` | `timestamptz` | no | Server-owned canonical approval instant. |
| `lifecycle_status` | `varchar(20)` | no | `approved`, `revoked`, or `superseded`. |
| `terminal_at` | `timestamptz` | yes | Revocation or supersession instant; null while approved. |

`owner_user_id` is deliberately non-null from table creation because this is a
new authority table with no legacy owner population. It maps to the logical
canonical owner and has no legacy owner-string sibling or fallback. The
candidate FK uses `ON DELETE RESTRICT`.

The table has no account selector, display name, current price, FX value,
as-of date, target, current weight, job status, result status, JSON vector,
`is_current`, `created_by_id`, email, provider subject, or secret-shaped field.

### Header Checks

Candidate database checks are:

- policy id, scenario id, and scenario version match the existing descriptor
  form `[A-Za-z0-9][A-Za-z0-9._:-]{0,99}` exactly, with no trimming or case
  rewrite at read time;
- Gate 0 commit matches exactly 40 lowercase hexadecimal characters;
- vector hash matches `sha256:` followed by 64 lowercase hexadecimal
  characters;
- approval revision is greater than zero;
- lifecycle status is one of the three approved values; and
- `approved` requires null `terminal_at`, while `revoked` or `superseded`
  requires `terminal_at >= approved_at`.

No default is proposed for lifecycle status. A future write contract must name
the intended state explicitly rather than inheriting a database default.

### Header Indexes

Candidate indexes are:

1. a unique index on the exact logical identity plus `approval_revision`;
2. a partial unique index on the exact logical identity where
   `lifecycle_status = 'approved'`; and
3. no global scenario id, newest-row, timestamp-order, or singleton lookup
   index intended to bypass owner-first exact selection.

The partial unique index is the database guarantee for zero-or-one current
approval. Application validation cannot replace it.

## Candidate Vector-Row Table

`simulation_scenario_approval_vector_rows` stores one canonical instrument row
for one approval revision.

| Column | Candidate type | Null | Meaning |
| --- | --- | --- | --- |
| `approval_revision_id` | `uuid` | no | FK to the header, `ON DELETE RESTRICT`. |
| `market` | `varchar(20)` | no | Trimmed lowercase canonical market. |
| `currency` | `varchar(10)` | no | Trimmed uppercase canonical currency. |
| `ticker` | `varchar(50)` | no | Trimmed uppercase canonical ticker. |
| `weight_bps` | `integer` | no | Integer weight from 0 through 10,000 inclusive. |

The candidate primary key is:

```text
(approval_revision_id, market, currency, ticker)
```

This prevents duplicate canonical identities within a revision. It also avoids
an unnecessary child-row UUID and a client-controlled row ordinal. Canonical
order is always `market`, `currency`, then `ticker`; stored insertion order is
not authority.

The row table deliberately has:

- no `asset_id` FK, because a curated instrument need not be a current holding
  or an existing owner asset row;
- no account, quantity, price, FX, market value, target, current weight, or
  display name;
- no JSON payload or duplicate vector hash; and
- no deletion cascade.

Database checks require non-empty normalized identity fields and
`weight_bps between 0 and 10000`. Policy-specific supported markets and
currencies remain a canonical serializer/write-contract responsibility rather
than a global database enum that would require DDL for every future expansion.

The complete row set must be non-empty, sum to exactly 10,000 bps, preserve
zero rows, and recompute to the stored scenario vector hash. Those are
cross-row and canonicalization invariants enforced by the future write and
repository contracts, not by a complex database trigger in this schema slice.
A finite maximum vector-row count must also be selected by a later write
resource policy; this schema draft does not invent that number or store a
mutable capacity field on the approval header.

## Candidate Lifecycle-Event Table

`simulation_scenario_approval_lifecycle_events` stores append-only evidence for
creation and the single possible terminal transition.

| Column | Candidate type | Null | Meaning |
| --- | --- | --- | --- |
| `id` | `uuid` | no | Server-generated event primary key. |
| `approval_revision_id` | `uuid` | no | FK to the affected header, `ON DELETE RESTRICT`. |
| `event_sequence` | `integer` | no | `1` for approval creation, `2` for a terminal transition. |
| `audit_version` | `varchar(50)` | no | Exact `scenario_vector_approval_audit_v1`. |
| `transition_kind` | `varchar(32)` | no | `explicit_approval`, `revocation`, or `supersession`. |
| `previous_status` | `varchar(20)` | yes | Null for creation; otherwise `approved`. |
| `resulting_status` | `varchar(20)` | no | Resulting approved or terminal status. |
| `transitioned_at` | `timestamptz` | no | Server-owned canonical transition instant. |
| `replacement_revision_id` | `uuid` | yes | Replacement header for supersession only. |

The candidate unique key is
`(approval_revision_id, event_sequence)`. A candidate coherence check allows
only:

```text
sequence 1: explicit_approval, previous null, resulting approved,
            replacement null
sequence 2: revocation, previous approved, resulting revoked,
            replacement null
sequence 2: supersession, previous approved, resulting superseded,
            replacement non-null and different from the affected revision
```

Both revision references use `ON DELETE RESTRICT`. The database FK proves that
a replacement exists, while the future transaction/repository validation must
prove it has the same exact identity, a higher revision, and the same approved
content required by the existing supersession contract.

Actor profile, email, provider subject, Basic Auth identity, request body,
free-form note, raw audit document, token, and header values are excluded. A
future actor-audit model requires its own auth review and is not inferred here.

The physical event does not duplicate `approval_revision` or `approved_at`.
The server-only audit assembly obtains the revision from the parent and requires
the sequence-1 `transitioned_at` to equal the parent's `approved_at`. A terminal
event time must equal the parent's `terminal_at`. This retains the logical audit
envelope without creating independently drifting duplicate authority columns.

One supersession transaction uses one server-owned canonical effective instant:

```text
old.terminal_at
= old sequence-2 transitioned_at
= replacement.approved_at
= replacement sequence-1 transitioned_at
```

The replacement is created in that transaction, has the same exact identity
and approved content, has a higher revision, and is the one current approved
revision at commit. This equality does not apply to a later reapproval after
revocation; that revision uses its own new approval instant.

## Database And Application Enforcement

### Database-Enforceable Candidates

- owner FK to `app_users.id` with delete restriction;
- parent-child FKs with delete restriction;
- normalized non-empty field checks;
- commit, hash, descriptor, status, timestamp, and weight shape checks;
- positive revision and event-sequence checks;
- unique exact identity plus revision;
- partial unique current approval per exact identity;
- unique instrument identity per revision; and
- lifecycle-event row-shape coherence.

### Future Write/Repository Invariants

- active, server-derived `TenantContext` owns every operation;
- a complete vector is non-empty and totals exactly 10,000 bps;
- canonical serialization recomputes the exact stored hash;
- all rows and the creation event commit atomically with the header;
- revisions increase within one exact identity;
- all revisions of one exact identity retain the same vector and hash;
- changed policy, Gate 0 commit, selector, or vector uses a new scenario
  version rather than a hidden revision;
- lifecycle header and append-only event evidence agree;
- creation-event time equals `approved_at`, terminal-event time equals
  `terminal_at`, and a supersession replacement has the same exact identity
  with a higher revision;
- one supersession effective instant is shared by the old terminal state, old
  terminal event, replacement approval, and replacement creation event;
- terminal rows and all approval content are never rewritten or deleted;
- repository states are classified without fallback; and
- only explicit minimized projections cross into pure resolver code.

The first additive schema migration would create no writer. Until a separate
write contract is approved, application code has no insert, update, delete, or
lifecycle transition path for these tables. This draft does not claim that
checks alone enforce content immutability against an unrestricted database
owner; database-role, trigger, or stored-procedure protection remains a later
write-security decision.

## Future Transaction Boundaries

This section describes required observable behavior, not approved SQL.

### Exact-Identity Serialization

Initial approval, supersession, revocation, and reapproval must acquire one
transaction-scoped serialization capability derived from the full exact
identity. A Postgres transaction advisory lock over a versioned canonical
identity digest is the current candidate. A hash collision may cause harmless
extra contention, while unique constraints remain the correctness backstop.

The exact lock serialization, SQL function, retry policy, and typed conflict
mapping remain part of the later write contract.

### Initial Approval

One transaction must:

1. validate tenant capability, selector, complete vector, policy compatibility,
   canonical rows, and recomputed hash;
2. serialize the exact identity and prove no current revision exists;
3. choose a positive revision greater than all history for that identity;
4. insert the header, every row including zero-bps rows, and sequence-1
   creation event; and
5. commit once, exposing no draft or partial authority.

### Revocation

One transaction must lock the exact identity and current header, prove it is
approved, update only lifecycle status and terminal time, append the sequence-2
revocation event, and commit. A failure leaves the approval unchanged.

### Identical-Vector Supersession

One transaction must prove identical policy, Gate 0 commit, selector, rows,
and hash; allocate one server-owned canonical effective instant; terminalize
the old current header at that instant; insert the higher approved header with
the same `approved_at`; append the old header's supersession event referencing
that new header at the same instant; insert all new rows and the new creation
event at the same instant; and commit. The old partial-current predicate must be
released before the new approved header is inserted, while the replacement
header must exist before the old event can reference it. Any failure rolls back
both sides.

### Reapproval After Revocation

The revoked record remains terminal. One transaction may insert a higher
immutable revision with the same approved content and a new creation event. It
never updates or reactivates the revoked revision. This is a separate approval
decision, so its `approved_at` is not required to equal the earlier
revocation's `terminal_at`.

No failed writer may retry with a different owner, selector, revision, vector,
or lifecycle intent.

## Repository Projection Boundary

A future repository accepts only a server-derived `TenantContext` and exact
scenario selector. The owner predicate is applied together with policy, Gate 0
commit, scenario id, and scenario version before loading a current revision.

Server-only assembly may load explicit fields from the header, ordered vector
rows, and the bounded lifecycle events. It must never use whole-row
`select()` or `returning()` at a product boundary.

The pure resolver receives only the minimized existing evidence shape:

```text
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
canonicalVector
scenarioVectorHash
approvalRevision
approvedAt
lifecycleStatus
auditStatus
```

Owner ids, physical row ids, terminal history, replacement ids, raw events,
legacy data, provider/session data, and audit internals remain server-only.
There is no API, RSC, page, or client projection in this schema contract.

## Migration Ordering Candidate

Because all three tables are new and no data source is approved, the candidate
rollout is additive and empty:

1. explicitly approve this docs-only contract or an amended revision;
2. add only the three reviewed Drizzle declarations and infer types;
3. generate one migration and review its exact SQL and metadata snapshot;
4. reject any SQL outside the three tables, their candidate constraints,
   indexes, and FKs;
5. rehearse the exact DDL in one transaction with lock and statement timeouts,
   catalog assertions, and a forced rollback;
6. prove before/after catalog and existing-row counts are identical;
7. apply the migration database-first while the deployed application has no
   references to the new tables;
8. verify all three tables are empty and existing product routes and row counts
   are unchanged; and
9. deploy the matching Drizzle declarations without adding repository or
   writer imports.

A regular transactional migration is the candidate. The tables are empty, so
`CONCURRENTLY` and `NOT VALID` add complexity without benefit. No existing
table or column is altered; the new header merely references the already
existing `app_users` table.

Migration generation, rehearsal, application, and deployment remain
unapproved by this draft.

## No-Data Dry-Run Rehearsal Plan

The future rehearsal must default to no persistent changes and must not call a
provider or write product data.

### Static SQL Allowlist

The generated migration must contain only:

- three `CREATE TABLE` statements;
- the owner and parent/replacement FKs;
- reviewed checks, primary/unique constraints, and regular indexes; and
- Drizzle statement breakpoints and metadata required for the migration.

It must contain no DML, existing-table column change, drop, truncate, cascade,
RLS, policy, grant, role, `neon_auth` reference, legacy owner field, account,
JSON vector, seed, import, backfill, secret, token, email, or provider subject.

### Rollback Rehearsal

The exact DDL may later be executed in one transaction with short lock and
statement timeouts. In-transaction catalog assertions must confirm table,
column, nullability, type, FK, check, unique, and partial-index predicates.
An expected exception then forces rollback.

The rehearsal performs no approval-row DML. Constraint behavior fixtures run
only in an isolated test database or future separately approved rollback-only
fixture gate. Production before/after evidence must show identical catalog,
existing row counts, and zero new persisted rows.

## Rollback Boundaries

| Stage | Candidate rollback |
| --- | --- |
| Docs-only draft | Revise or remove the draft; no runtime effect. |
| Generated but unapplied migration | Discard the generated candidate after review; no DB effect. |
| Transactional rehearsal | Forced rollback; catalog and rows remain identical. |
| Applied empty schema before consumers | Drop the three empty tables in child/event/header order only after proving zero rows and zero consumers; never use `CASCADE`. |
| After any future authority row exists | Do not drop, truncate, delete, or rewrite approval evidence; disable the unapproved consumer/writer and use a separately reviewed forward repair. |

No rollback changes `app_users`, existing owner assignments, auth identities,
product data, Base44 evidence, or managed provider schemas.

## Legacy And Cross-Authority Exclusions

The candidate tables do not accept or infer authority from:

- Base44 `owner_id`, `created_by_id`, email, provider subject, Basic Auth, or a
  machine secret;
- account selectors, current holdings, asset rows, prices, FX, quantities,
  market values, current weights, target weights, ISA policy, or
  `weights_json`;
- observed baseline evidence, explicit user commands, optimizer candidates, or
  immutable admitted run inputs;
- as-of dates, matrix or draw hashes, seed, horizon, block length, cost,
  resource parameters, job/chunk state, partial diagnostics, paths, result
  summaries, or artifacts;
- research approval Markdown, Git history, fixtures, environment values,
  latest rows, or singleton lookup; or
- hidden fallback, interpolation, default vectors, row pruning, or deletion and
  replacement.

Legacy ids or JSON may not be added even as authoritative migration columns.
Any future non-authoritative migration provenance requires a separate review
and cannot replace normalized rows or omit explicit zero weights.

## Review Decisions

The user should approve, amend, reject, or defer each group independently:

1. the three-table boundary and candidate names;
2. the header columns, exact identity, checks, and partial current unique;
3. the composite-key vector rows with no `asset_id`, account, JSON, or ordinal;
4. the append-only two-event lifecycle shape and replacement reference;
5. database versus future write/repository enforcement responsibility;
6. transaction behavior and exact-identity serialization direction;
7. minimized repository projection and server-only fields; and
8. additive migration, no-data rehearsal, and rollback boundaries.

Approval of this document would approve only the physical schema contract. It
would not approve Drizzle edits, generated SQL, migration application, database
reads or writes, repository code, auth, runtime, API, UI, provider, job, Cron,
seed, import, backfill, or RLS.

## Explicit Non-Actions

This draft does not:

- edit `src/db/schema.ts`, Drizzle metadata, migration SQL, or package scripts;
- connect to or query production Postgres;
- create, update, revoke, supersede, import, seed, or backfill an approval;
- add a repository, resolver adapter, route, Server Action, page, component,
  job, Cron, provider, or runtime execution path;
- activate auth/session identity, ownership enforcement, or RLS;
- expose any new product or admin response; or
- authorize B, the immutable admitted run-input physical category.

This Markdown draft is review evidence only. It is not imported by code and is
not a runtime trust source.
