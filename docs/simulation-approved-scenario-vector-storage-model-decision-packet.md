# Approved Scenario Vector Storage-Model Decision Packet

Last updated: 2026-07-12

Status: `docs_only_unapproved_decision_packet`.

Decision status: `awaiting_explicit_approval`.

Recommended model:
`normalized_immutable_approval_header_and_vector_rows_with_transactional_terminal_state_and_append_only_lifecycle_audit`.

## Purpose

This packet compares storage models for a future server-owned approved scenario
vector authority. It records a varda-labs recommendation without creating a
schema, repository, migration, runtime adapter, or approval row.

The logical owner, selector, lifecycle, repository states, and pure resolver
contract are already defined in:

- `docs/simulation-scenario-vector-resolver-approval-source-trust-boundary-contract.md`;
- `docs/simulation-scenario-vector-resolver-implementation-close-out.md`.

This packet does not repeat or replace those contracts. It answers the narrower
question of how their immutable approval evidence could later be represented in
Postgres without confusing approval state with simulation execution state.

## Decision Boundary

The decision requested by this packet is whether to carry the following model
into a later schema-design gate:

1. one normalized approval-revision header for immutable approval metadata;
2. one normalized child row per canonical instrument weight;
3. one controlled lifecycle state on the header for efficient current-record
   enforcement;
4. one append-only audit event for every lifecycle transition;
5. one transaction for approval creation, supersession, reapproval, and their
   lifecycle audit evidence;
6. no duplicate JSON vector authority and no `is_current` boolean.

This is a recommendation, not an approval. Exact table names, column types,
DDL, index names, SQL, Drizzle declarations, and RLS policies remain outside
this packet.

## Existing Invariants

Any storage model must preserve the already-approved exact identity:

```text
(canonicalOwnerUserId,
 portfolioPathPolicyId,
 gate0ApprovalCommit,
 scenarioId,
 scenarioVersion)
```

Within one exact identity:

- approval revisions are positive safe integers, unique, and strictly
  increasing, but need not be contiguous;
- there may be zero or one current `approved` revision;
- `approved -> revoked | superseded` are the only lifecycle transitions;
- `revoked` and `superseded` are terminal;
- an identical-vector reapproval creates a higher immutable revision;
- an instrument, weight, policy, Gate 0, scenario id, or scenario version
  change creates a different approval identity or scenario version as required
  by the existing contract;
- a terminal revision is never rewritten or reactivated;
- no latest, newest, singleton, account, or cross-owner fallback is permitted.

The canonical vector consists only of:

```text
market
currency
ticker
weightBps
```

Canonical ordering is derived by the existing
`compareSimulationScenarioVectorRows` comparator. Stored array position or a
client-provided ordinal is not an authority.

Every `weightBps` value is an integer from 0 through 10,000, inclusive. An
explicit zero-weight row remains part of the exact canonical instrument set.
It must be persisted exactly once and must not be dropped as an optimization,
because removing it changes the vector universe and `scenarioVectorHash`.

## Legacy Meaning To Preserve

The legacy Base44 simulation flow does not contain a canonical approved-vector
authority. Its storage shape must not be copied.

Only these legacy-derived meanings remain relevant:

- an execution must bind immutable input snapshots rather than reading mutable
  inputs halfway through a run;
- vector approval lifecycle and execution lifecycle are different state
  machines;
- partial chunks, partial vectors, merge fallbacks, or confidence fallbacks
  cannot become approval authority;
- replacement or cleanup of execution shards cannot delete approval history;
- vector provenance and execution provenance must remain independently
  bindable.

Legacy `owner_id`, `created_by_id`, account, `weights_json`, asset blobs, job
status, and chunk status are not eligible approval-owner or approval-content
sources.

## Approval And Execution Separation

Approved-vector storage may contain only vector approval evidence. It must not
contain or derive:

- seed;
- expected block length;
- horizon;
- path count;
- end service date or return-step count;
- as-of date;
- matrix rows or `inputMatrixHash`;
- draw rows or `drawPlanHash`;
- engine or calibration execution settings;
- current holdings, quantities, market values, or target-policy output;
- execution status such as `queued`, `running`, `partial`, `failed`, or
  `ready`.

Those values belong to a later execution-request or execution-artifact model.
`scenarioVectorHash` cannot replace their separate provenance.

## Vector Storage Options

### Option A: Normalized Header And Child Rows

One immutable approval header owns multiple structured vector rows.

Advantages:

- instrument identity and weight remain typed structured data;
- duplicate `market/currency/ticker` rows can be constrained per revision;
- repository code can project exactly the four canonical row fields;
- per-instrument inspection and integrity audits do not require JSON parsing;
- future schema changes can remain additive at the row boundary;
- canonical sorting and hash reconstruction are explicit;
- approval data is not coupled to current `assets` membership.

Costs:

- header and child rows must be inserted atomically;
- aggregate `weightBps=10000` and hash agreement require transaction-level
  application validation in addition to row constraints;
- repository reads require one bounded parent/child assembly;
- a partially written revision would be dangerous if transaction boundaries
  were violated.

### Option B: Immutable Canonical JSON Vector

One approval row stores the entire vector in a JSON value.

Advantages:

- one-row insertion is naturally atomic;
- the vector is easy to retrieve as one payload;
- immutable snapshot semantics are visually direct.

Costs:

- instrument uniqueness, weight shape, and total weight are difficult to
  enforce with ordinary relational constraints;
- DB JSON representation must not be mistaken for the existing canonical hash
  serialization;
- malformed or extra keys are easier to persist accidentally;
- owner-scoped inspection and per-instrument audits become more complex;
- JSON path behavior becomes part of a core financial-data contract;
- a future index or query requirement can promote an opaque blob into an
  accidental second schema.

JSONB is appropriate elsewhere in this repository for flexible metadata and
derived payloads. An approved scenario vector is neither: it is small,
structured, identity-bearing financial policy data.

### Option C: Normalized Rows Plus Duplicate JSON

This option stores both normalized vector rows and a full JSON copy.

It is rejected as a recommendation because it creates two possible authorities.
Even if one copy is described as a cache, write drift, serializer changes, and
repair behavior would require another precedence contract.

The canonical serialized string may be produced transiently for hash
calculation. It should not become a second persisted vector authority unless a
later, separately justified audit requirement proves that duplication is
necessary.

## Vector Storage Recommendation

Select Option A for the later schema-design gate:

```text
immutable approval revision header
  -> normalized canonical vector child rows
```

The child rows should be owned through the approval revision. They should not
duplicate `canonicalOwnerUserId`; owner authority remains on the parent. A
later RLS design may revisit physical policy mechanics, but it must not create
two owner sources.

The vector rows should not require an `assets.id` foreign key. Counterfactual
and research scenarios may contain an instrument that is not a current holding,
and simulation identity is already `market/currency/ticker`. An optional shared
instrument reference can be considered separately, but current asset
membership cannot determine vector validity.

Stored row order should not be authoritative. The repository must reconstruct
the canonical vector using the existing comparator before hash validation and
pure resolver projection.

`scenarioVectorHash` should not be globally unique. Different owners or
approval revisions of the same scenario identity may legitimately produce the
same hash. Different scenario ids or versions remain distinct because those
fields participate in the existing canonical hash input.

## Lifecycle Storage Options

### Option L1: Append-Only Events Only

Approval creation and terminal transitions are represented only as events;
current state is folded from event history.

Advantages:

- every persisted fact is immutable;
- audit history is naturally complete;
- terminal transitions never update an approval row.

Costs:

- zero-or-one current approval is difficult to enforce atomically with a
  simple relational uniqueness rule;
- every repository read requires a correct event fold;
- malformed lineage and concurrent approvals are harder to prevent at write
  time;
- an additional current-pointer or series record may be needed, increasing
  model complexity.

### Option L2: Mutable Lifecycle State Only

The approval header stores `approved | revoked | superseded`, and terminal
transitions update that field without an event ledger.

Advantages:

- current approval lookup and partial unique enforcement are straightforward;
- repository reads are simple.

Costs:

- transition history and timing can be lost;
- a bad update can silently replace audit meaning;
- repository `auditStatus=verified` lacks independent lifecycle evidence;
- it resembles legacy delete-and-replace behavior too closely.

### Option L3: Controlled Terminal State Plus Append-Only Audit

The approval header exposes the current lifecycle state while each creation and
terminal transition also appends immutable audit evidence in the same
transaction.

Advantages:

- current-record uniqueness remains enforceable at the header boundary;
- owner-first repository reads remain bounded;
- lifecycle history remains independently auditable;
- state and event coherence can contribute to repository `auditStatus`;
- approval content stays immutable even though its lifecycle state can move
  once to a terminal value.

Costs:

- the write transaction must keep header state and audit evidence coherent;
- both missing events and mismatched events become integrity failures;
- later migrations must prevent direct un-audited lifecycle updates.

## Lifecycle Recommendation

Select Option L3 for the later schema-design gate.

Only lifecycle state may transition on an existing approval revision. These
content fields remain immutable:

- canonical owner;
- policy id and Gate 0 commit;
- scenario id and version;
- approval revision;
- approved timestamp;
- vector rows;
- scenario vector hash;
- approval audit envelope.

Do not add an independent `is_current` boolean. Current eligibility is derived
from exact identity plus `lifecycleStatus=approved`, with zero-or-one cardinality
enforced as a database invariant in a later schema gate.

Lifecycle audit evidence should conceptually bind:

- approval revision identity;
- transition kind;
- previous and resulting lifecycle state;
- server-owned canonical UTC transition time;
- replacement revision identity when a supersession has one.

Actor/provider/session details remain a separate auth-audit decision. They must
not be inferred from Basic Auth, email, legacy owner data, or a machine secret,
and this packet does not select an actor schema.

## Prospective Admission And Artifact Non-Retroactivity

`revoked` and `superseded` affect admission of new executions prospectively.
Once a future orchestrator admits an execution, that execution must pin the
exact `approvalRevision` and `scenarioVectorHash` that were current at its
admission boundary.

A later lifecycle transition must not:

- mutate the vector or approval binding of an already committed execution
  artifact;
- reclassify a previously committed artifact as if it used a different
  approval revision;
- delete or rewrite historical execution evidence;
- cause a repository to substitute a newer approval into a replay.

Whether an execution that is already in flight should continue, cancel, or
finish without publication after its approval is revoked or superseded remains
a later orchestration-policy decision. This storage packet does not infer that
behavior. It fixes only that committed artifacts and their pinned provenance
are immutable and that terminal approval state blocks new admission.

## Atomicity Requirements

Future writes must be serialized per exact approval identity. The SQL mechanism
is not selected here, but the observable transaction requirements are:

### Initial Approval

1. validate canonical owner capability and exact scenario identity;
2. validate the complete vector and recompute its hash;
3. verify that the revision is valid and no current approval conflicts;
4. insert the immutable header, all child rows, and creation audit evidence;
5. expose the revision as approved only when the entire transaction commits.

No `draft` or `pending` row may be visible to the runtime approval repository.

### Identical-Vector Supersession

1. lock or otherwise serialize the exact identity;
2. prove the new revision has the same policy, Gate 0, selector, vector, and
   hash as required by the existing contract;
3. move the old approved revision to `superseded` and append its event;
4. insert the higher approved revision, its child rows, and creation event;
5. commit all changes together.

If any operation fails, the old current revision remains current and no partial
new authority is visible.

### Reapproval After Revocation

The revoked revision remains terminal. A higher immutable revision with the
same approved content may be created in one transaction. The old record is not
reactivated or deleted.

### Changed Vector Or Policy

A changed instrument, weight, policy, or Gate 0 value cannot be hidden behind a
higher revision of the same scenario version. It requires the separately
approved scenario-version behavior already fixed by the trust-boundary
contract.

Concurrent attempts must produce one committed winner or a typed conflict. A
failed writer must not retry with a different owner, selector, revision, or
vector.

## Enforcement Responsibility

The later schema gate should separate database-enforceable invariants from
application-validation invariants.

Candidate database invariants:

- canonical owner relationship to `app_users.id`;
- allowed lifecycle values;
- positive approval revision;
- unique exact identity plus revision;
- zero-or-one approved revision per exact identity;
- unique instrument identity per approval revision;
- integer row weights from 0 through 10,000 bps, inclusive;
- child ownership through one approval revision;
- terminal timestamps coherent with lifecycle state.

Candidate application and repository invariants:

- complete vector total is exactly 10,000 bps;
- vector canonicalization and `scenarioVectorHash` recomputation;
- policy and Gate 0 revision compatibility;
- changed-vector versus new-scenario-version rule;
- lifecycle event/header coherence;
- audit-envelope verification;
- exact repository state classification;
- minimized resolver projection.

The later design must not claim that application validation can replace a
database uniqueness guarantee for current approvals. Conversely, it must not
invent a complex trigger solely to move canonical hash logic out of the
reviewed TypeScript serializer without a separate reason.

## Repository Read Boundary

A future repository continues to accept only:

```text
TenantContext
exact canonical scenario selector
```

It must apply the owner predicate before or together with exact policy, Gate 0,
scenario id, and scenario version predicates. It must use explicit projections,
never whole-row `select()` output as the pure resolver input.

The raw server-only assembly may include the owner, lifecycle, audit envelope,
and immutable vector rows needed for validation. The pure resolver still
receives only the existing minimized `ScenarioVectorEvidencePort` after a
successful resolution.

Repository state meanings remain unchanged:

| State | Storage interpretation |
| --- | --- |
| `not_requested` | Tenant or selector prerequisite failed before any lookup |
| `not_found` | No exact owner-scoped identity history exists |
| `not_current` | Exact history exists but no approved revision is eligible |
| `unavailable` | Repository or database evidence cannot be loaded reliably |
| `collision` | Current cardinality, revision uniqueness, or lifecycle lineage is ambiguous |
| `loaded` | One current approval and its bounded evidence were assembled |

An assembled record with malformed vector content or a hash mismatch is not
silently repaired. It remains invalid evidence for the pure resolver or audit
status boundary. Terminal history is not a fallback.

## DAL And RLS Responsibility

Application DAL authorization is mandatory even if RLS is added later:

- `TenantContext.ownerUserId` is the only owner capability;
- the owner predicate is part of every approval lookup;
- account filters and scenario selectors cannot replace it;
- raw approval records remain server-only;
- child rows are reachable only through the owner-scoped parent boundary.

RLS is a later defense-in-depth gate. Its future design must include two-user
isolation tests and explicit child-row policy behavior. This packet does not
choose denormalized owner columns, RLS joins, policies, roles, grants, or
connection settings.

## No Import Or Seed Authority

No existing data source may be automatically promoted into this model:

- Base44 weights or job payloads;
- current holdings or target weights;
- ISA `isa-v1`;
- research-vector Markdown;
- fixtures or tests;
- environment variables;
- latest, only, or global rows.

Any future initial approval must be created through a separately approved
server-owned write contract. There is no import, seed, or backfill in this
packet.

## Rejected Shortcuts

The later implementation must not:

- store account as the approval owner or identity;
- use Basic Auth or a machine secret to choose an owner;
- make `asset_id` membership mandatory for vector rows;
- trust stored JSON order or a client ordinal as canonical order;
- omit or prune an explicit zero-weight canonical vector row;
- use `scenarioVectorHash` as a unique owner or execution identifier;
- expose approval rows before all vector rows commit;
- retain partial vectors as current approvals;
- update vector content in place;
- delete terminal revisions during supersession or reapproval;
- merge approval and execution status;
- treat RLS as a substitute for owner-aware DAL code;
- return raw approval or audit rows to Phase 1C, an API, RSC output, or client.

## Recommendation Summary

The varda-labs recommendation is:

```text
normalized immutable approval-revision header
  + normalized canonical vector child rows
  + controlled approved-to-terminal header transition
  + append-only lifecycle audit evidence
  + exact-identity transaction serialization
  + database-enforced zero-or-one current approval
  + owner-first explicit repository projection
```

This model is preferred over JSON because the vector is structured financial
policy data with relational integrity requirements. It is preferred over a
pure event fold because current-record atomicity is a first-class runtime
requirement. It is preferred over mutable state without events because approval
history must remain auditable.

## Explicit Non-Actions

This packet does not authorize or implement:

- table or column names;
- Drizzle schema declarations;
- SQL, migration, FK, check, unique index, partial index, trigger, function, or
  transaction code;
- lifecycle or approval writes;
- repository, cache, route, API, Server Action, page, component, job, or Cron;
- current production DB reads;
- auth SDK, session adapter, identity link, app-user activation, Basic Auth
  change, or RLS;
- vector import, seed, backfill, or research-vector runtime use;
- execution request, matrix execution, bootstrap execution, NAV, persistence,
  result cache, or UI;
- expected shortfall, optimizer, recommendation, rebalance, or order behavior.

## Next Approval Boundary

The immediate next decision is whether to approve the recommendation in this
packet as the storage-model basis for a later schema contract.

Approval of this packet would still not approve DDL or runtime code. A later
schema-contract gate would need exact candidate table/column shapes,
constraints, transaction boundaries, explicit projections, migration ordering,
rollback behavior, and a no-data dry-run rehearsal before any implementation.

Auth runtime remains frozen. The later schema contract must continue to consume
a future `TenantContext` and must not invent a temporary singleton or Basic Auth
tenant.
