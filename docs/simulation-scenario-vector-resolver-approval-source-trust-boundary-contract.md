# Simulation Scenario Vector Resolver And Approval-Source Trust Boundary Contract

Last updated: 2026-07-12

Status: `docs_only_contract`. No runtime approval source, repository, resolver,
session adapter, schema, persistence, or execution path is approved or
implemented by this artifact.

## Purpose

This contract defines the authority boundary that must exist before a
production simulation can select a scenario vector. It answers one question:

> How may a future server-side resolver obtain one exact owner-scoped approved
> scenario vector without treating Markdown, request input, a hash, or current
> portfolio state as runtime authority?

It does not execute a return matrix, draw plan, gross-growth artifact, or
normalized NAV path.

## Ordering Decision

The approval-source boundary must be defined before production execution
orchestration. An orchestrator cannot safely select simulation inputs until it
has both:

1. a server-derived canonical tenant context; and
2. an owner-scoped authoritative scenario-vector record.

An execution contract written first would either leave vector authority
undefined or accidentally promote an audit document, request value, singleton
record, or hash match into authorization.

## Current Repository State

There is currently no permitted runtime source for an approved scenario
vector.

- `src/lib/session-resolver-contract.ts` implements only a pure provider-neutral
  state machine.
- The future `getCurrentAppUser()` request adapter is not implemented.
- No production route, query, or simulation module currently imports the pure
  session resolver.
- No approved-scenario repository or persistence model exists.
- The pure Scenario Vector Review Packet always remains `unapproved`.
- The research-vector approval Markdown is audit evidence only.
- Phase 1C always returns `runtimeTrustStatus=not_established`.

Consequently, no current request can resolve an approved vector for production
execution. This contract must not be read as changing that state.

## Existing Tenant Prerequisite

The canonical tenant prerequisite is the existing provider-neutral session
contract:

```text
verified active provider session
  -> exactly one active auth_identities mapping
  -> the same active app_users row
  -> TenantContext { ownerUserId, role }
```

Only `verified_active_identity_mapping` may source a user tenant. Basic Auth is
an outer access gate only. An account selector, email, provider subject,
machine secret, URL, body, form, or header owner value cannot source
`TenantContext`.

This simulation contract consumes a future internal `TenantContext`; it does
not change, bypass, or implement the auth/session state machine.

## Future Server-Only Flow

The required conceptual flow is:

```text
future provider/session adapter
  -> resolveSessionToAppUser(...)
  -> TenantContext
  -> validated untrusted scenario selector
  -> server-only ApprovedScenarioVectorRepository
  -> exact owner-scoped current approval record
  -> approval-record validation and scenario hash recalculation
  -> ScenarioVectorEvidencePort
  -> separately approved execution orchestrator
  -> pure simulation_normalized_nav_v1
```

Every arrow after `TenantContext` remains future work. The flow is a contract,
not an implemented import graph.

## Runtime Authority Source

A future authoritative source must be a server-owned repository. The storage
technology is intentionally undecided in this phase, but the repository must:

- require a server-derived `TenantContext` for every lookup;
- apply the canonical owner predicate before scenario identity filters;
- return only an exact owner-scoped record or a typed failure;
- prevent request input from selecting or overriding owner, vector rows,
  policy revision, hash, lifecycle state, or audit metadata;
- return no global, cross-owner, first-row, singleton, or nearest-match
  fallback;
- reject ambiguous current records instead of choosing one;
- keep repository records and internal owner identity server-only;
- expose a minimized vector-evidence projection to pure calculation code.

No database table or repository implementation is selected or authorized by
this document.

## Ineligible Runtime Trust Sources

The following can never establish runtime vector authority:

- Markdown approval or close-out documents;
- Git commit identity or Git history;
- fixtures, tests, example payloads, or client-cached data;
- a scenario hash supplied by a browser, route, header, cookie, or job input;
- URL, query, form, body, or header vector rows or weights;
- environment variables or deployment configuration containing a vector;
- hard-coded production vectors in application modules;
- current holdings, current weights, account membership, or latest snapshots;
- ISA, brokerage, IRP, target-policy, MA120, or recommendation output;
- Basic Auth username or password;
- admin or Cron machine secrets;
- legacy Base44 ids, owner strings, creator fields, or imported metadata;
- the only row, newest row, globally current row, or another singleton
  inference.

A matching hash proves internal content identity under its hash contract. It
does not prove owner, approval lifecycle, session authorization, or execution
permission.

## Untrusted Scenario Selector

A future product may allow a user to select among that user's own reviewed
scenarios. The only request-derived fields that may eventually be considered
are canonical selectors such as:

```text
scenarioId
scenarioVersion
```

Both values must already match the exact descriptor rule used by the existing
Scenario Vector Review Packet:

```text
^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$
```

Selector equality is case-sensitive. The resolver must not coerce a non-string
value, trim whitespace, change case, infer `latest`, insert a default, or roll
to another version. Missing, empty, noncanonical, or malformed selectors are
typed failures before repository access. For those inputs, the normalized
repository port state must be `not_requested`.

These values are untrusted lookup selectors, not authority. They may narrow an
already owner-scoped repository query, but they cannot:

- select `ownerUserId`;
- provide or override weights, instrument rows, hashes, policy revisions,
  lifecycle state, or approval metadata;
- cause a fallback to another version or another owner's scenario;
- request a global default, latest record, or automatic current scenario.

Selector syntax, route shape, search params, and UI remain outside this phase.
No default scenario-selection policy is approved.

## Minimum Logical Approval Record

A future server-owned approval record needs at least the following logical
fields. This is not a database schema proposal.

```text
canonicalOwnerUserId
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
canonicalVector[]:
  market
  currency
  ticker
  weightBps
scenarioVectorHash
approvalRevision
approvedAt
lifecycleStatus: approved | revoked | superseded
auditEnvelope:
  version: scenario_vector_approval_audit_v1
  decisionKind: explicit_approval
  approvalRevision
  approvedAt
```

The scenario identity, policy revision, vector, and hash for one approval
revision are immutable. Revocation or supersession must not rewrite those
fields into a different vector. A future persistence contract must define an
append-only lifecycle event or another audited transition model before any
schema is created.

The record-level and audit-envelope `approvalRevision` values must match
exactly. The record-level and audit-envelope `approvedAt` values must also
match exactly. `approvalRevision` must be a positive safe integer. Revisions
for one exact approval identity are unique and strictly increasing, but they
need not be contiguous. `approvedAt` must be a canonical valid UTC ISO instant
rather than a locale string. Both values are server-owned and cannot come from
the selector or another client-controlled field. The audit envelope contains
no actor profile, email, provider subject, note, request payload, token, or raw
audit document.

Changing an instrument, weight, policy revision, Gate 0 revision, scenario id,
or scenario version requires a new exact approval record and hash. Any policy,
Gate 0, or vector change also requires a new `scenarioVersion`; it cannot be
hidden behind a new approval revision of the same selector. A changed matrix or
draw plan does not mutate the vector approval record.

## Current Approval And Lifecycle Invariants

The exact approval identity is:

```text
(canonicalOwnerUserId,
 portfolioPathPolicyId,
 gate0ApprovalCommit,
 scenarioId,
 scenarioVersion)
```

For each identity, there may be zero or one current `approved` record, never
more than one. Resolver success requires exactly one. The absence of a current
record is a typed blocked result, not a reason to select a terminal or older
revision.

Only these lifecycle transitions are permitted:

```text
approved -> revoked
approved -> superseded
```

`revoked` and `superseded` are terminal. Neither can be reactivated or changed
to the other terminal state. A new approval creates a new immutable revision;
it never rewrites or reactivates an old revision.

When a new revision replaces a currently approved revision of the same exact
identity, the previous approved revision becomes `superseded`. The new revision
must preserve the same policy, Gate 0 revision, scenario identity, canonical
vector, and hash. If those fields change, the caller must use a new
`scenarioVersion` and obtain a separate approval.

A new identical approval after a revocation may create a higher revision, but
the revoked record remains terminal. Multiple scenario versions may remain
independently approved because selection always requires an exact version;
there is no implicit latest-version policy.

The repository must not fall back to a revoked, superseded, older, newest, or
otherwise inferred revision.

## Repository Port Boundary

A future repository port should be semantically equivalent to:

```ts
type ScenarioSelector = Readonly<{
  scenarioId: string;
  scenarioVersion: string;
}>;

interface ApprovedScenarioVectorRepository {
  findExactForTenant(input: Readonly<{
    tenantContext: TenantContext;
    selector: ScenarioSelector;
  }>): Promise<OwnerScopedApprovalRecordResult>;
}
```

This signature is illustrative only. It does not approve a TypeScript helper,
database adapter, query, route, or request parser.

The repository must not accept a standalone owner UUID from a public or job
payload. Internal extraction of `tenantContext.ownerUserId` belongs inside the
server-only data-access boundary.

The future pure resolver must consume a normalized repository port result, not
a database row list:

```ts
type ApprovalAuditStatus = "verified" | "invalid" | "unavailable";

type OwnerScopedApprovalRecordResult =
  | Readonly<{ state: "not_requested" }>
  | Readonly<{ state: "not_found" }>
  | Readonly<{ state: "not_current" }>
  | Readonly<{ state: "unavailable" }>
  | Readonly<{ state: "collision" }>
  | Readonly<{
      state: "loaded";
      record: OwnerScopedApprovalRecord;
      auditStatus: ApprovalAuditStatus;
    }>;
```

`not_requested` proves that no repository lookup was performed because a
prerequisite failed. `not_found` means no exact owner-scoped selector identity
exists.
`not_current` means matching history exists but no current approved revision is
eligible. `collision` represents ambiguous cardinality or lifecycle lineage.
The repository, not the pure resolver, performs owner-first retrieval and
reduces storage evidence to one of these states.

The pure resolver validates a `loaded` record and requires
`auditStatus=verified`. It does not receive or parse raw audit metadata and
does not claim to verify the authority of an actor, provider session, database
transaction, or audit document. Establishing `auditStatus` is a later
server-repository responsibility.

## State Coherence

Selector validation must complete before a repository lookup can be
represented as requested:

- malformed or absent selector with `not_requested` produces the typed
  selector failure when the tenant-context shape is otherwise valid;
- malformed or absent tenant context with `not_requested` produces the typed
  tenant-context failure when the selector is otherwise canonical;
- if both prerequisite shapes are malformed, `not_requested` remains required
  and the tenant-context failure takes precedence over the selector failure;
- any malformed prerequisite with a repository state other than
  `not_requested` is an invalid resolver-state combination;
- valid canonical selector plus valid tenant-context shape plus
  `not_requested` is also an invalid resolver-state combination.

Resolver failure precedence is deterministic:

```text
tenant-context shape
  -> selector shape and canonical equality
  -> repository request-state coherence
  -> normalized repository outcome
  -> loaded record, lifecycle, audit, and vector validation
```

The pure helper accepts `TenantContext` only as the opaque downstream
capability defined by the existing session-resolver contract. It must not
repeat provider-session, identity-mapping, app-user-status, cookie, or auth
checks. It may reject a malformed `TenantContext` shape, and a malformed or
absent context requires `not_requested`, but shape validation does not
establish that a real session was authenticated.

For a `loaded` state:

- `record.canonicalOwnerUserId` must exactly equal
  `tenantContext.ownerUserId`;
- record scenario id and version must exactly equal the canonical selector;
- policy and Gate 0 fields must match the supported policy revision;
- lifecycle must be `approved`;
- audit status must be `verified`;
- record and audit-envelope revision and timestamp values must match exactly.

An owner or selector mismatch is a repository integrity failure, not
`not_found`. A loaded terminal record is an invalid normalized port state;
terminal history without a current approval must be represented by
`not_current`.

Terminal historical revisions may coexist with exactly one current approved
revision. That normal history is not a collision. `collision` is limited to
ambiguous evidence such as multiple current approved records, duplicate
revisions, or malformed lifecycle lineage. The pure resolver receives the
normalized collision state and does not select among raw records.

## Resolver Validation

Before producing vector evidence, a future resolver must fail closed unless:

- a structurally valid `TenantContext` capability was supplied through the
  existing session-resolver boundary, without the pure helper claiming to
  authenticate its source;
- selector and repository-request state are coherent;
- exactly one record matches owner, scenario id, and scenario version;
- loaded owner and selector fields exactly match the supplied context and
  canonical selector;
- the record lifecycle is currently `approved`;
- the repository audit-status port is `verified`;
- no revoked, superseded, duplicate, or conflicting current record is
  eligible;
- `portfolioPathPolicyId` and the Gate 0 revision match the supported policy;
- scenario id and version are strings that already match the exact canonical
  descriptor rule and equal the selector without coercion or normalization;
- canonical vector rows are complete, unique, already ordered, and use
  supported identity rules;
- every weight is an integer from 0 through 10,000 basis points;
- the complete vector totals exactly 10,000 basis points;
- the recalculated `scenarioVectorHash` matches the stored hash;
- record revision, lifecycle, timestamp, and minimal immutable audit envelope
  are structurally valid;
- no owner, identity, vector, or lifecycle ambiguity remains.

The resolver must not sort an out-of-order trusted record into validity,
renormalize weights, infer missing rows, select the latest duplicate, or repair
an invalid approval during read.

## Typed Failure Boundary

Future resolver failures must be typed and sanitized. At minimum, the contract
must distinguish:

- tenant context unavailable or not active;
- invalid scenario selector;
- invalid resolver or repository-request state combination;
- owner-scoped scenario not found;
- approval not current;
- approval-record collision or ambiguity;
- loaded owner or selector integrity mismatch;
- approval audit invalid or unavailable;
- policy or Gate 0 mismatch;
- invalid canonical vector or total;
- scenario-vector hash mismatch;
- malformed lifecycle or audit evidence;
- repository unavailable.

Public responses and logs must not include owner UUIDs, provider subjects,
vector rows, hashes, approval revisions, audit envelopes, database ids, or raw
repository errors. Internal diagnostics may retain reviewed identifiers only
under a separate server audit policy.

## ScenarioVectorEvidencePort Projection

Only after successful owner and approval validation may a future resolver
project the exact fields consumed by the pure Phase 1C helper:

```text
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
canonicalVector
scenarioVectorHash
```

The projection intentionally excludes owner UUID, approval record id,
approval revision, lifecycle metadata, provider/session data, and audit
metadata. The future orchestration boundary must retain tenant authorization
and approval provenance separately; the pure helper must not become an auth or
repository layer.

## Trust Status Separation

A successful future resolver may establish that one server-owned record is an
eligible vector authority for one tenant and selector. That does not change
the Phase 1C result:

```text
runtimeTrustStatus: not_established
```

Phase 1C validates calculation inputs only. A later production orchestration
contract must keep resolver authority, matrix evidence, draw-plan provenance,
execution identity, and calculation status as separate dimensions. It must not
turn a vector hash or `calculationStatus=ready` into blanket execution
authorization.

## Owner And RLS Direction

Any future persisted approval source is user-owned data. It must follow the
existing ownership rollout rather than inventing a simulation-specific tenant
key:

- canonical owner is `app_users.id`;
- application queries filter owner before scenario selectors;
- account values are not tenant ids;
- writes derive owner from trusted session or separately approved internal
  migration context;
- app-level owner checks precede optional RLS;
- RLS remains defense in depth and requires its own gate and two-user tests.

This document does not add a table, owner column, FK, index, constraint,
policy, migration, backfill, or RLS rule.

## Explicit Non-Scope

This docs-only contract does not authorize or implement:

- Neon Auth or another provider SDK, auth route, sign-in UI, or session
  adapter;
- identity linking, app-user activation, provisioning, or Basic Auth removal;
- `getCurrentAppUser()` or another runtime tenant resolver;
- approved-vector schema, migration, persistence, seed, import, or backfill;
- repository, approval lookup, resolver, cache, route, API, Server Action,
  page, component, search-param, or client integration;
- use of the recorded research vector as a runtime input;
- production matrix, draw-plan, gross-growth, or NAV execution;
- initial KRW, current-portfolio comparison, or wealth scaling;
- distribution summaries, fan or spaghetti charts, percentiles, drawdown,
  expected shortfall, loss probability, optimizer, recommendation, or order;
- provider call, database read or write, job, Cron, ownership mutation, RLS,
  or schema change.

## Next Gate

This contract must be reviewed before any resolver or repository code is
approved.

The next narrow candidate is a pure approval-record validator and resolver
state machine using synthetic `TenantContext`, exact selectors, normalized
repository port results, lifecycle records, audit-status values, and vector
fixtures only. It must consume `not_requested | not_found | not_current |
unavailable | collision | loaded` port states rather than selecting from a
database-row list, and it must perform no auth, database, provider, file,
environment, network, route, or production-vector access.

Schema design, repository I/O, session integration, production execution
orchestration, and product presentation remain later independent gates.
