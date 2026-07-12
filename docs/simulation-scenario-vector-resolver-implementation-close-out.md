# Simulation Scenario Vector Resolver Implementation Close-Out

Recorded: 2026-07-12

Status: `docs_only_close_out`

This packet closes the reviewed pure implementation of
`simulation_scenario_vector_resolver_v1`. It records implementation
provenance, deterministic state behavior, verification evidence, and explicit
boundaries only. It is not a runtime approval source, repository adapter,
session adapter, persistence record, execution instruction, or product
approval.

## Reviewed Commit Chain

Approval-source trust-boundary contract:

```text
ac68916b2cfadee8aef2d9926b6ab4d9bdef0c4d
```

Lifecycle, selector, and audit-boundary amendment:

```text
ceb82d5249fb0947324541055f72096c2eb560d1
```

Repository-port coherence amendment:

```text
39a4173566dd461aab711ffa920d38ff76c7769f
```

Pure implementation:

```text
ba980f3a99cdb4c61c4b86d897bfed3395c3a885
```

The contract documents retain their docs-only status. No application code
reads these commit identities or this Markdown file as runtime trust evidence.

## Implemented Policy

```text
policy.version: simulation_scenario_vector_resolver_v1
portfolioPathPolicyId: gross_normalized_buy_and_hold_v1
Gate0ApprovalCommit: 652b9ea9c9b48f51dc4c68e8f148132ca8893d7e
selectorEquality: exact_case_sensitive_canonical
auditEnvelopeVersion: scenario_vector_approval_audit_v1
auditDecisionKind: explicit_approval
runtimeTrustStatus: not_established
outputKind: minimized_scenario_vector_evidence_port
```

A resolved pure result means only that the supplied in-memory port objects are
internally coherent under this policy. It does not prove that a repository,
session, tenant, user, vector, or execution request is trusted at runtime.

## Pure Input Boundary

The helper accepts exactly three caller-supplied in-memory inputs:

1. a `TenantContext` shape containing `ownerUserId` and `role`;
2. an exact canonical `scenarioId` and `scenarioVersion` selector;
3. one normalized repository-port result.

`TenantContext` is imported with a TypeScript `import type` reference to the
existing pure session-resolver contract. This provides structural contract
reuse only. The resolver does not import or invoke a runtime session adapter,
provider SDK, identity lookup, app-user lookup, cookie handler, or auth route.

Selector values must match the existing descriptor rule exactly:

```text
^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$
```

The helper does not coerce, trim, case-fold, default, infer a latest version,
or fall back to another selector.

## Repository Port States

The normalized repository states are fixed to:

```text
not_requested
not_found
not_current
unavailable
collision
loaded
```

The pure helper receives one normalized result. It does not receive raw rows,
query a repository, choose among revisions, infer a current record, or repair
lifecycle ambiguity.

State coherence is fail-closed:

- an invalid tenant shape is reported as `tenant_context_invalid` only when
  the repository state is exactly `not_requested`;
- after a valid tenant shape, an invalid selector is reported as
  `scenario_selector_invalid` only when the state is exactly `not_requested`;
- any requested or malformed repository state after an invalid prerequisite
  is `resolver_state_invalid`;
- `not_requested` after both prerequisites are valid is also
  `resolver_state_invalid`;
- each remaining non-loaded state maps to one deterministic blocker;
- only `loaded` proceeds to approval-record validation.

If both tenant and selector shapes are invalid and the repository was not
requested, tenant validation wins. No result contains multiple blockers.

## Loaded Approval Validation

A loaded result is accepted only when all required evidence passes in a fixed
order:

- loaded owner equals `TenantContext.ownerUserId` exactly;
- loaded scenario identity equals the canonical selector exactly;
- portfolio-path policy and Gate 0 revision equal the supported constants;
- lifecycle is exactly `approved`;
- repository audit status is exactly `verified`;
- top-level approval revision is a positive safe integer;
- top-level `approvedAt` is a canonical UTC ISO instant;
- the audit envelope has only its four approved fields and exact version and
  decision-kind constants;
- record and audit-envelope revision and timestamp values match exactly;
- every vector row has only the canonical identity and basis-point fields;
- the vector is already canonical, unique, and totals exactly 10,000 basis
  points;
- the scenario-vector hash has canonical lowercase SHA-256 form and matches a
  fresh calculation.

An explicit zero-weight row is retained and validated. Invalid vectors are not
sorted, deduplicated, intersected, padded, dropped, or renormalized.

`auditStatus=verified` is a normalized input-port claim. The pure helper does
not inspect raw audit records or establish the authority of that claim. This
is why every output continues to report `runtimeTrustStatus=not_established`.

## Minimized Output Boundary

Every result has exactly four top-level fields:

```text
resolutionStatus: resolved | blocked
runtimeTrustStatus: not_established
evidence: ScenarioVectorEvidencePort | null
blocker: { reason } | null
```

Resolved evidence contains only:

```text
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
canonicalVector
scenarioVectorHash
```

Owner identifiers, role, approval revision, lifecycle, approval timestamp,
audit envelope, audit status, raw record, and repository state are not
projected. Blocked results contain no evidence and exactly one deterministic
primary reason. Successful and blocked outputs are immutable, including the
canonical vector rows.

## Synthetic Verification

Fixtures use synthetic owner identities, selector values, instrument
identities, vectors, hashes, and audit-envelope values only. They do not use
the approved research scenario instruments, production scenario-vector hash,
or an actual owner identifier.

The focused suite records:

- one minimized, deeply immutable resolved result;
- all five non-loaded terminal outcomes and `not_requested` coherence;
- invalid-prerequisite lookup prevention;
- malformed repository-port rejection;
- exact minimal `TenantContext` and selector validation;
- owner and selector integrity mismatch;
- policy and Gate 0 drift;
- terminal and unknown lifecycle rejection;
- distinct invalid and unavailable audit outcomes;
- revision and audit-envelope equality;
- canonical UTC timestamp validation;
- malformed, noncanonical, duplicate, and wrong-total vector rejection;
- scenario-vector hash recalculation;
- explicit zero-weight row preservation;
- no runtime trust or execution capability in the pure policy.

## Verification Recorded At Implementation

The implementation commit was closed with:

- focused resolver tests: 17 passed;
- full test suite: 495 passed;
- TypeScript check: passed;
- lint: passed;
- production build: passed;
- staged diff and whitespace checks: passed;
- production vector, I/O, database, provider, and Phase 1C runtime-reference
  scope audit: passed.

During full-suite verification, the earlier Phase 1G0 static audit treated a
TypeScript `import type` as a production runtime import. The implementation
commit narrowed that audit to strip only explicit type-only imports before
checking for remaining session-resolver references. Runtime imports and other
remaining references continue to fail the production-import audit. The full
suite passed after this correction.

These results describe the reviewed implementation commit. They do not claim
that later repository states have the same result without rerunning checks.

## No-I/O Boundary

The resolver implementation does not read Markdown, files, environment
variables, databases, providers, HTTP requests, routes, cookies, headers, or
runtime approval stores. It performs no write, persistence, repository lookup,
session resolution, matrix compilation, stochastic sampling, growth
materialization, NAV aggregation, or execution orchestration.

## Explicitly Unapproved

This close-out does not approve or implement:

- a runtime approval-vector repository or repository adapter;
- a runtime session adapter or auth/session integration;
- database schema, migration, persistence, seed, backfill, or approval-record
  write behavior;
- production vector or hash lookup, loading, caching, or runtime use;
- execution orchestration or Phase 1C runtime-input binding;
- production matrix, draw-plan, gross-growth, or NAV execution;
- initial KRW capital, current-portfolio comparison, or wealth scaling;
- distribution, percentile, fan or spaghetti chart, drawdown, optimization,
  recommendation, order, or rebalance behavior;
- provider, API, route, page, UI, job, Cron, write, ownership, or RLS changes.

## Closure And Next Gate

The pure approval-record validator and resolver state machine are complete at
the implementation commit above. No runtime authority or product behavior is
enabled by this close-out.

Any runtime repository, persistence model, session integration, production
vector lookup, execution orchestration, Phase 1C binding, or product surface
requires a separate contract and explicit approval. Continued development must
not be treated as implicit authorization for those gates.
