# Simulation Runtime Execution Readiness Gate 0

Last updated: 2026-07-12

Status: `docs_only_readiness_audit`. The pure calculation chain is substantially
implemented, but production simulation execution is not ready and runtime trust
is not established.

## Purpose

This Gate 0 records the current boundary between implemented simulation
calculation capabilities and the missing server-owned runtime capabilities that
would be required to execute them for a real user.

It does not authorize or implement a production execution path. In particular,
it keeps these questions separate:

1. can a pure helper calculate a deterministic result from valid input;
2. can the server identify the current tenant;
3. can the server load an owner-approved scenario vector;
4. can the server select and bind a complete market-evidence artifact;
5. can the server own stochastic execution parameters and provenance;
6. can an orchestrator establish one auditable execution identity;
7. can a product route safely expose a minimized result.

A positive answer to question 1 does not imply a positive answer to any later
question.

## Gate Decision

The current decision is:

```text
pureCalculationReadiness: implemented_pure_only
sharedMarketReadReadiness: implemented_server_select_only
tenantRuntimeReadiness: blocked_missing_request_adapter
approvedVectorAuthorityReadiness: blocked_missing_persistence_and_repository
executionParameterAuthorityReadiness: blocked_missing_server_policy
orchestrationReadiness: not_implemented
runtimeTrustStatus: not_established
productionExecutionReadiness: blocked
```

No current route, Server Action, job, Cron task, page, or component may treat
the existing pure helper outputs as production simulation results.

## Audit Baseline

This review uses repository commit
`e55f87cc41226b9a35491a09013c63cdd006e974` as its code baseline.

The primary reviewed boundaries are:

- `src/lib/session-resolver-contract.ts` and
  `src/lib/session-resolver-policy.ts`;
- `src/lib/simulation-scenario-vector-resolver.ts` and its policy, types, and
  validation modules;
- `src/db/queries/simulation-return-matrix.ts`;
- Phase 0A through Phase 1F1 simulation policy, type, validation, and helper
  modules;
- `src/db/schema.ts`;
- production files under `src/app`;
- the auth/session, matrix, vector, NAV, sampling, and risk close-out records.

This audit performs no database, provider, environment, file-backed artifact,
or network read. Consequently, current tenant rows, identity mappings, stored
market coverage for a new request, and deployment environment state are not
asserted as current facts.

Prior documents that recorded a provisioning user or an identity-row count are
dated audit evidence only. Their row counts and lifecycle states remain
`current_data_unverified` until a separately approved current-state read occurs.

## Readiness State Dimensions

One aggregate `ready` flag would hide materially different risks. Runtime work
must retain at least these independent dimensions:

| Dimension | Meaning |
| --- | --- |
| `implementationStatus` | Whether code exists and whether it is pure, SELECT-only, or production-integrated |
| `authorityStatus` | Whether a server-owned source is allowed to supply the value |
| `dataStatus` | Whether the required current production evidence has been read and validated |
| `bindingStatus` | Whether exact artifacts are linked under their own hash contracts |
| `runtimeTrustStatus` | Whether one production execution has an established authorization and provenance chain |

The allowed judgments in this document are deliberately narrow:

- `implemented_pure_only`: deterministic in-memory helper and synthetic tests
  exist, but there is no production input adapter;
- `implemented_server_select_only`: a server-only explicit-projection read
  adapter exists, but it does not establish execution authority;
- `contract_only`: types or a state machine define a future port, without the
  runtime adapter behind that port;
- `not_implemented`: no production capability exists;
- `current_data_unverified`: this audit did not read the current database or
  deployment state;
- `not_established`: no production authorization and provenance chain exists.

These states are not interchangeable. For example, a pure result may be
`calculationStatus=ready` while its `runtimeTrustStatus` remains
`not_established`.

## Implemented Calculation Capabilities

| Capability | Current implementation | Runtime judgment |
| --- | --- | --- |
| Period request resolution | Pure exact-endpoint, union-axis resolver | `implemented_pure_only` |
| Period preflight | Server-only bounded Drizzle SELECT adapter plus pure loaders | `implemented_server_select_only` |
| KRW-investor return matrix | Pure adjusted-close and date-specific FX matrix builder | `implemented_pure_only` |
| Universe and request identity | Separate `scenarioUniverseHash` and `matrixRequestHash` contracts | `implemented_pure_only` |
| Scenario review packet | Pure canonical vector review; packet remains unapproved | `implemented_pure_only` |
| Scenario vector resolver | Pure owner/selector/lifecycle/hash state machine over normalized port results | `implemented_pure_only` |
| Stationary bootstrap | Pure seeded whole-row draw-plan generator | `implemented_pure_only` |
| Gross growth | Pure per-instrument sampled growth materialization | `implemented_pure_only` |
| Normalized NAV | Pure normalized buy-and-hold aggregation with explicit bindings | `implemented_pure_only` |
| NAV distribution summary | Pure Type 7 distribution summary | `implemented_pure_only` |
| Spaghetti path sample | Pure deterministic path-sample projection | `implemented_pure_only` |
| Terminal loss probability | Pure terminal loss summary | `implemented_pure_only` |
| Per-path maximum drawdown | Pure peak-to-trough maximum drawdown | `implemented_pure_only` |
| Maximum-drawdown distribution | Pure all-path Type 7 P50/P90 summary | `implemented_pure_only` |

The read-only market adapter projects shared market evidence only. It does not
load an owner-approved vector, establish a tenant, select an execution policy,
or invoke the downstream simulation chain.

The existing pure modules also enforce local resource caps. Those caps are
helper-level validation boundaries, not an end-to-end runtime resource budget.

## Runtime Prerequisite Matrix

| Boundary | Existing evidence | Missing prerequisite | Current status |
| --- | --- | --- | --- |
| Request session to `TenantContext` | Pure provider-neutral resolver state machine | Verified request/session adapter and active identity-to-user resolution | `contract_only`, runtime blocked |
| Current tenant data | Historical docs only | Separately approved current-state read | `current_data_unverified` |
| Outer access protection | Basic Auth proxy | Canonical user identity and tenant authorization | Access gate exists; tenant authority absent |
| Approved vector storage | Logical record and pure resolver contracts | Owner-scoped schema and lifecycle persistence | `not_implemented` |
| Approved vector repository | Normalized repository port result types | Server-only owner-first repository adapter | `not_implemented` |
| Owner-scoped lookup | Pure owner-match validation | DAL owner predicate and optional later RLS defense | `not_implemented` |
| Scenario selector | Exact pure selector validation | Server request adapter and projection policy | `contract_only` |
| Shared market evidence | Explicit-projection Drizzle SELECT adapter | Orchestrated request and fresh request-specific evidence review | Adapter exists; current request data unverified |
| Execution parameters | Explicit pure input fields and helper caps | Server-owned source, defaults, bounds, and replay policy | `not_implemented` |
| Artifact binding | Pure helpers compare separate expected hashes | Server orchestration that owns expected bindings | `implemented_pure_only` |
| Execution orchestration | No production import graph | Ordered fail-closed server flow | `not_implemented` |
| End-to-end resource policy | Per-helper caps | Runtime timeout, concurrency, memory, and admission policy | `not_implemented` |
| Execution audit/replay | Deterministic hashes inside pure artifacts | Execution id, immutable request envelope, retention decision | `not_implemented` |
| Product projection | Pure minimized result shapes | Authenticated server projection, API/page boundary, UX | Outside Gate 0 |
| Runtime trust | Helpers report `not_established` | Full authorization, evidence, parameter, and execution chain | `not_established` |

## Tenant And Access Boundary

The only eligible user tenant source remains:

```text
verified active provider session
  -> exactly one active auth identity
  -> the same active app user
  -> TenantContext { ownerUserId, role }
```

The pure session resolver models this state machine, but no production request
adapter calls it. Preview auth integration is frozen by the existing auth
readiness decision. Basic Auth remains an outer deployment access gate and
cannot produce `TenantContext`.

The following cannot select a simulation tenant:

- `brokerage`, `isa`, `irp`, or `all` account filters;
- Basic Auth username or password;
- admin or Cron machine secrets;
- email, provider subject, URL, query, form, body, or header owner values;
- the only app-user row, the newest row, or another singleton inference;
- legacy owner strings, creator ids, Base44 ids, assets, or snapshot history.

Shared market price and FX evidence may remain non-tenant data. Approved
scenario vectors, user execution requests, and any persisted user simulation
artifacts are user-owned and require the canonical `app_users.id` boundary.

## Approved Vector Authority Boundary

The pure Scenario Vector Resolver validates a normalized owner-scoped approval
record. It does not load one. `src/db/schema.ts` currently contains no scenario
approval or simulation execution table, and there is no production repository
adapter for the resolver port.

The following remain evidence or test material, never runtime authority:

- Markdown approvals and close-out documents;
- Git commits and commit hashes;
- fixtures, tests, examples, and client-cached values;
- current holdings, equal weights, target weights, or the ISA policy;
- a vector or vector hash sent by a browser, route, header, cookie, job, or
  environment variable;
- a global, newest, first, only, nearest, or cross-owner database record.

A future repository must receive server-derived `TenantContext`, apply the
canonical owner predicate before scenario selectors, reject collisions and
ambiguous current records, and return a minimized normalized port result. RLS
may later provide defense in depth but cannot replace application-level owner
authorization.

## Execution Parameter Authority

The pure pipeline currently requires explicit values such as:

- candidate instrument identities;
- end service date and return step count;
- scenario id and version;
- stationary-bootstrap seed;
- expected block length;
- horizon;
- path count.

Pure validation proves only that supplied values satisfy local contracts. It
does not prove who selected them or whether they are appropriate for a product
request.

A future server-owned execution policy must decide, separately for every field:

- whether the value is fixed by policy, selected by a bounded user control, or
  generated by the server;
- canonical normalization and allowed ranges;
- deterministic replay behavior;
- timeout, memory, concurrency, and total-work limits;
- whether a changed policy requires a new execution version.

There are no production defaults today. Current holdings, account targets,
ISA `isa-v1`, equal weights, or the previously approved research vector must
not be reused automatically. Initial KRW capital and wealth scaling remain a
separate product contract from normalized NAV.

## Identity And Hash Separation

The current contracts intentionally define distinct identities:

| Identity | Meaning | Not authority for |
| --- | --- | --- |
| `scenarioUniverseHash` | Canonical instrument set and return basis | Date window, weights, source values, execution |
| `matrixRequestHash` | Exact resolved date axis under matrix read policies | Source values, weights, stochastic draws |
| `scenarioVectorHash` | Canonical scenario weights and path-policy metadata | Tenant authorization, matrix evidence, draw provenance |
| `inputMatrixHash` | Canonical historical return-matrix artifact | Vector approval, draw provenance, user authorization |
| `drawPlanHash` | Seeded stochastic draw-plan provenance | Vector approval, matrix request authority, tenant authorization |

The normalized NAV boundary compares `scenarioVectorHash`, `inputMatrixHash`,
and `drawPlanHash` separately. A future orchestrator must preserve that
separation.

No composite authorization hash may be derived from these hashes. A hash match
proves content identity under one hash contract; it does not prove owner,
approval lifecycle, request authorization, or permission to execute.

## Required Fail-Closed Runtime Flow

A future production execution flow would have to preserve this order:

```text
verified request session
  -> TenantContext
  -> validated untrusted scenario selector
  -> owner-scoped approved-vector repository
  -> pure vector resolver
  -> server-owned execution specification
  -> exact period resolution
  -> bounded shared-market evidence reads
  -> complete canonical return matrix
  -> seeded draw plan
  -> gross growth artifact
  -> normalized NAV with explicit three-hash binding
  -> separately approved summaries or samples
  -> minimized authenticated product projection
```

Every transition must fail closed. No step may silently substitute:

- a different tenant, scenario, instrument, date, or policy version;
- partial/common-history intersection data;
- zero-filled, interpolated, raw-close, or provider-fetched evidence;
- current holdings or target weights for an approved vector;
- a default seed, block length, horizon, or path count;
- a nearest, newest, singleton, or cross-owner approval record.

Missing historical evidence may later support a separately designed repair or
backfill workflow, but that workflow cannot be hidden inside execution and is
not part of this Gate 0.

## Ordered Blockers

Production execution remains blocked by these independent prerequisites:

1. auth runtime is frozen and no verified request-to-`TenantContext` adapter
   exists;
2. current tenant and identity data state is unverified in this docs-only
   review;
3. no server-owned approved-vector persistence model exists;
4. no owner-first approved-vector repository adapter exists;
5. no server-owned execution-parameter policy exists;
6. no orchestrator binds tenant authority, vector approval, market evidence,
   draw provenance, and pure results;
7. no end-to-end admission, timeout, concurrency, audit, or replay policy
   exists;
8. runtime trust therefore remains `not_established`.

Later product UI, API, comparison charts, initial-capital scaling, optimizer,
recommendation, and order behavior cannot remove or bypass these blockers.

## Explicit Non-Actions

This Gate 0 does not authorize or implement:

- auth SDK installation, sign-in UI, cookies, callback routes, session adapter,
  identity linking, app-user activation, or Basic Auth removal;
- current production DB inspection or a claim about current user or identity
  row counts;
- schema, migration, approved-vector table, execution table, repository, cache,
  seed, import, backfill, owner mutation, FK, unique constraint, or RLS;
- route, API, Server Action, page, component, search parameter, client state,
  job, Cron, queue, provider call, or write;
- production matrix, vector, draw plan, growth, NAV, risk, or distribution
  execution;
- automatic use of the approved research vector, ISA targets, current holdings,
  or equal weights;
- provider backfill, interpolation, zero fill, common-history intersection, or
  silent evidence repair;
- expected shortfall, CVaR, mean loss, P95, worst loss, combined score,
  optimizer, recommendation, rebalance, or order generation;
- initial KRW capital, investor wealth projection, actual-portfolio comparison,
  or final product presentation.

## Next Approval Boundary

Runtime implementation is not ready for approval.

The logical owner relationship, immutable lifecycle, current-record invariant,
owner-first lookup, collision behavior, six repository port states, and
minimized vector projection are already defined in
`docs/simulation-scenario-vector-resolver-approval-source-trust-boundary-contract.md`.
The corresponding pure resolver state machine is closed out in
`docs/simulation-scenario-vector-resolver-implementation-close-out.md`.
Repeating those decisions in another persistence-boundary document is not a
new migration slice.

The next unresolved non-auth candidate is a separately approved docs-only
storage-model decision. It would need to choose, without writing DDL:

- normalized header/vector-row storage versus an immutable JSON vector;
- append-only lifecycle events versus another audited terminal-transition
  representation;
- how exact identity, revision uniqueness, and zero-or-one current approval
  could be enforced atomically;
- how supersession and identical-vector reapproval would remain transactional;
- the exact server-only projection used by a future repository adapter;
- which protections belong to application DAL checks and which require a
  later independent RLS gate.

This Gate 0 does not approve that storage decision. Any later design must
consume a future `TenantContext` rather than inventing a temporary singleton or
Basic Auth tenant. Schema, migration, repository code, current production-data
reads, and writes require still later separate approval.

Execution-parameter authority and orchestration remain separate gates after the
approved-vector storage model is decided and implemented through its own gates.
Expected shortfall and product UI also remain closed until their own meaning and
runtime prerequisites are approved.
