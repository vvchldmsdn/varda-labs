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
are normalized selectors such as:

```text
scenarioId
scenarioVersion
```

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
lifecycleStatus: approved | revoked | superseded
approvedAt
serverAuditMetadata
```

The scenario identity, policy revision, vector, and hash for one approval
revision are immutable. Revocation or supersession must not rewrite those
fields into a different vector. A future persistence contract must define an
append-only lifecycle event or another audited transition model before any
schema is created.

Changing an instrument, weight, policy revision, scenario id, or scenario
version requires a new exact approval record and hash. A changed matrix or draw
plan does not mutate the vector approval record.

## Repository Port Boundary

A future repository port should be semantically equivalent to:

```ts
type ScenarioSelector = Readonly<{
  scenarioId: string;
  scenarioVersion: string;
}>;

interface ApprovedScenarioVectorRepository {
  findExactCurrentForTenant(input: Readonly<{
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

## Resolver Validation

Before producing vector evidence, a future resolver must fail closed unless:

- the tenant context came from the existing verified active mapping contract;
- exactly one record matches owner, scenario id, and scenario version;
- the record lifecycle is currently `approved`;
- no revoked, superseded, duplicate, or conflicting current record is
  eligible;
- `portfolioPathPolicyId` and the Gate 0 revision match the supported policy;
- scenario id and version are valid exact descriptors;
- canonical vector rows are complete, unique, already ordered, and use
  supported identity rules;
- every weight is an integer from 0 through 10,000 basis points;
- the complete vector totals exactly 10,000 basis points;
- the recalculated `scenarioVectorHash` matches the stored hash;
- record revision, lifecycle, timestamp, and server audit evidence are
  structurally valid;
- no owner, identity, vector, or lifecycle ambiguity remains.

The resolver must not sort an out-of-order trusted record into validity,
renormalize weights, infer missing rows, select the latest duplicate, or repair
an invalid approval during read.

## Typed Failure Boundary

Future resolver failures must be typed and sanitized. At minimum, the contract
must distinguish:

- tenant context unavailable or not active;
- invalid scenario selector;
- owner-scoped scenario not found;
- approval not current;
- approval-record collision or ambiguity;
- policy or Gate 0 mismatch;
- invalid canonical vector or total;
- scenario-vector hash mismatch;
- malformed lifecycle or audit evidence;
- repository unavailable.

Public responses and logs must not include owner UUIDs, provider subjects,
vector rows, hashes, approval metadata, database ids, or raw repository
errors. Internal diagnostics may retain reviewed identifiers only under a
separate server audit policy.

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
state-machine contract using synthetic owner, lifecycle, selector, and vector
fixtures only. It must perform no auth, database, provider, file, environment,
network, route, or production-vector access.

Schema design, repository I/O, session integration, production execution
orchestration, and product presentation remain later independent gates.
