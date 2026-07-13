# Synthetic Curated Admission Planner Local Implementation Packet

Last updated: 2026-07-13

Status: `docs_only_implementation_plan_for_review_not_approved`

This packet proposes one local-only pure implementation slice for the
synthetic admission planner approved at
`38e7981cc2c2e61b9ce50c2e52edc09770b0d70a`.

It does not authorize source or test edits, database access, schema, migration,
auth/session integration, repository, writer, runtime binding, API, UI, job,
seed, import, backfill, or approval data.

## Implementation Objective

The proposed slice implements one deterministic function:

```text
planSyntheticCuratedVectorAdmission(input)
```

It consumes bounded `caller_supplied_synthetic_unverified` in-memory input and
returns only:

```text
synthetic_preconditions_satisfied
blocked
```

Every result remains:

```text
mode = synthetic_only
runtimeTrustStatus = not_established
readinessStatus = not_ready
```

No production adapter or product surface is part of this slice.

## Blocking Hash Dependency

This implementation plan is blocked by
`docs/simulation-scenario-vector-hash-versioning-decision-packet.md`.

The current v1 serializer uses locale-sensitive sorting and is frozen as
legacy provenance. Planner source and tests must not start until:

```text
a separately approved simulation_scenario_vector_hash_v2 pure helper is implemented and verified
```

The hash correction is not part of the eight-file planner allowlist. It needs
its own approval, changed-file allowlist, tests, and compatibility evidence.

## Proposed File Allowlist

Only these files may be created or changed after a separate implementation
approval:

| File | Purpose |
| --- | --- |
| `src/lib/simulation-curated-admission-planner-policy.ts` | Frozen policy ids, caps, enums, and blocker order. |
| `src/lib/simulation-curated-admission-planner-types.ts` | Readonly synthetic input, decision, checks, and result types. |
| `src/lib/simulation-curated-admission-planner-serialization.ts` | Strict synthetic instant parsing, canonical envelope serialization, and local SHA-256. |
| `src/lib/simulation-curated-admission-planner-validation.ts` | Snapshot-once normalization and deterministic fail-closed validation. |
| `src/lib/simulation-curated-admission-planner.ts` | Thin orchestration and immutable bounded result projection. |
| `tests/fixtures/simulation-curated-admission-planner.mjs` | Synthetic-only fixture builders and pinned expected digests. |
| `tests/simulation-curated-admission-planner.test.mjs` | Focused policy, purity, resource, mutation, and output tests. |
| `tests/run.mjs` | One import line for the focused test file. |

No existing scenario, resolver, DB, route, page, auth, package, migration, or
script file may be edited. If implementation requires another file, the slice
stops and returns for review.

## Policy Constants

The proposed policy module freezes exactly these values:

```text
policyId = curated_vector_synthetic_admission_planner_v1
policyVersion = 1
mode = synthetic_only
runtimeTrustStatus = not_established
readinessStatus = not_ready
supportedIntent = initial_approval
supportedActorMode = tenant_self_approval_v1
confirmationPolicyId = curated_vector_self_confirmation_v1
vectorHashVersion = simulation_scenario_vector_hash_v2
approvalEnvelopeDigestVersion = curated_vector_approval_envelope_digest_v1
writeSafetyApprovalCommit = c0a2f584e167f153db0dedb6cfc418d76b2fc5bd
contractApprovalCommit = 38e7981cc2c2e61b9ce50c2e52edc09770b0d70a
maxVectorRows = 64
requiredWeightTotalBps = 10000
maxCanonicalInputBytes = 32768
```

`maxCanonicalInputBytes` is an in-memory serialization bound, not an HTTP body,
database, execution-universe, or UI limit.

`vectorHashVersion=simulation_scenario_vector_hash_v2` remains a conditional
candidate. It may be pinned by the planner only after the versioning decision
and separate v2 pure implementation gates complete without changing v1.

## Exact Input Types

The later TypeScript types must be readonly and closed to these semantic
groups.

### Policy Evidence

```text
evidenceSource = caller_supplied_synthetic_unverified
plannerPolicyId
plannerPolicyVersion
actorMode
confirmationPolicyId
portfolioPathPolicyId
gate0ApprovalCommit
vectorHashVersion
approvalEnvelopeDigestVersion
```

### Synthetic Actor Assumptions

```text
sessionAssumption:
  verified_active | not_verified | inactive | unknown

identityMappingAssumption:
  exactly_one_active | missing | ambiguous | inactive | unknown

appUserAssumption:
  active | provisioning | disabled | missing | unknown

actorOwnerAssumption:
  same_canonical_owner | mismatch | unknown

syntheticOwnerUserId
```

`syntheticOwnerUserId` is shape evidence only. It is never returned and cannot
be sourced from a real session in this implementation slice.

### Exact Synthetic Identity

```text
ownerUserId
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
intent = initial_approval
```

The actor owner and identity owner must be byte-identical after strict
validation. Neither value is normalized, inferred, or returned.

### Canonical Vector Rows

```text
market
currency
ticker
weightBps
```

The array must already be in canonical order. The implementation validates and
rejects; it does not sort or repair the input.

### Synthetic Confirmation Assumptions

```text
state:
  pending | consumed | expired | invalidated | conflicted | unknown

ownerBindingAssumption:
  matches | mismatch | unknown

expectedChallengeInstanceLabel
presentedChallengeInstanceLabel
expectedApprovalEnvelopeDigest
presentedApprovalEnvelopeDigest
issuedAt
expiresAt
syntheticEvaluationTime
```

Challenge labels are synthetic equality tokens only. They are not raw or
digested production handles and are never returned.

### Minimal Durable-State Assumptions

```text
approvalRevisionAssumption:
  no_prior_revision | current_approval_exists | prior_revision_exists | unknown

competingChallengeAssumption:
  none | live_competitor_present | unknown
```

No row, count, revision number, receipt, event, timestamp, physical id, or
database object is accepted.

## String, Shape, And Byte Caps

The proposed implementation rejects rather than truncates or normalizes:

| Field | Exact v1 rule |
| --- | --- |
| owner UUID | 36 lowercase ASCII characters matching canonical UUID text |
| policy id, scenario id, scenario version | 1-100 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]*` |
| Gate 0/approval commit | exactly 40 lowercase hexadecimal characters |
| SHA-256 evidence | exactly `sha256:` plus 64 lowercase hexadecimal characters |
| market | 1-20 lowercase ASCII characters matching `[a-z][a-z0-9._:-]*` |
| currency | exactly `KRW` or `USD` |
| ticker | 1-50 uppercase ASCII characters matching `[A-Z0-9][A-Z0-9._:-]*` |
| synthetic challenge label | 1-64 ASCII characters matching `[A-Za-z0-9._:-]+` |
| canonical UTC instant | exactly 24 ASCII characters in `YYYY-MM-DDTHH:mm:ss.sssZ` |
| vector rows | 1-64, counting explicit zero-bps rows |
| canonical input serialization | at most 32,768 UTF-8 bytes |

The helper checks outer object/array shape and row count before copying nested
rows. It checks per-field caps before canonical serialization or hashing. An
oversized value yields blockers and no partial digest work.

The 32-KiB cap is deliberately above the maximum valid fixed-shape payload but
still bounds future accidental field expansion. It must not be silently raised
because a new field appears.

Under the current closed shape, 64-row cap, and per-field caps, a valid input
cannot independently reach 32 KiB. The cap is therefore a forward-compatibility
assertion, not a separately reachable v1 business-invalid case. Tests should
prove that a maximum-shape valid synthetic fixture remains below the cap and
that future field expansion cannot remove or silently raise the guard. They
must not fabricate an otherwise-valid 32-KiB rejection case that the approved
field rules cannot produce.

## Canonical Order And Complexity

Canonical instrument order is ascending by exact ASCII code unit over:

```text
market, then currency, then ticker
```

The implementation uses a small explicit comparator based on `<` and `>` for
the approved ASCII alphabets. It must not use locale-sensitive
`localeCompare()`.

Validation is `O(n)` expected time and `O(n)` bounded memory for at most 64
rows:

- one Set detects duplicate exact instrument keys;
- one adjacent comparison detects noncanonical order;
- one integer accumulation checks the 10,000-bps total; and
- hashing runs only after all shape, cap, row, order, uniqueness, and weight
  checks needed for canonical input have passed.

The helper does not sort, clone more than 64 rows, or build an instrument-keyed
error payload.

## Vector Hash Compatibility

The planner must not call, wrap, edit, or reinterpret
`simulation_scenario_vector_hash_v1`. V1 remains legacy provenance with its
existing serializer semantics.

The planner may later import only the separately approved pure v2 exports from
the new v2 module defined by its own implementation gate. Exact export and file
names remain unselected until that packet is approved.

The planner still validates that input rows are already canonical before
calling v2. V2 canonicalization must not repair or hide an out-of-order planner
input at this boundary, even though the standalone hash function remains
input-order independent for its own canonical hash contract.

The fixture must pin at least one expected `scenarioVectorHash` produced by the
approved synthetic-only v2 helper. No approved production vector or stored
database row may be used.

## Approval-Envelope Digest Candidate

The new serialization module proposes this canonical JSON property order:

```text
approvalEnvelopeDigestVersion
actorMode
confirmationPolicyId
intent
ownerUserId
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
vectorHashVersion
scenarioVectorHash
vector
```

`vector` contains the complete already-canonical rows, including explicit
zero-bps rows, with property order:

```text
market, currency, ticker, weightBps
```

`JSON.stringify()` over an object constructed in exactly that order and UTF-8
SHA-256 produces:

```text
sha256:<64 lowercase hexadecimal characters>
```

`actorMode` has exactly one canonical v1 value:

```text
tenant_self_approval_v1
```

The shorter `tenant_self` text in an earlier candidate receipt example is not
a digest alias and must not be accepted or normalized. The digest also binds
`intent=initial_approval` and
`vectorHashVersion=simulation_scenario_vector_hash_v2` so a different action or
hash policy cannot reuse the same confirmation envelope. The v2 binding
remains conditional on the blocking versioning and pure implementation gates.

`writeSafetyApprovalCommit`, `contractApprovalCommit`, Markdown paths, and Git
review provenance are deliberately excluded. They document review history;
they are not runtime approval-envelope authority.

The envelope digest includes owner and vector evidence internally but is not
returned. It is distinct from `scenarioVectorHash`, challenge identity, lock
key, approval identity, runtime input hash, or authorization material.

The implementation may import `createHash` only in the serialization module.
No remote crypto service, Web API, environment value, random value, clock, or
file is used.

## Strict Synthetic Instant Parsing

The serialization module uses a fixed regular expression plus explicit
Gregorian component/range checks for:

```text
YYYY-MM-DDTHH:mm:ss.sssZ
```

Version 1 accepts years 2000 through 2099. It rejects offsets, omitted
milliseconds, leap-second text, invalid dates, and noncanonical round trips.
It must not call `Date.parse()` or `Date.now()`.

After validation, deterministic UTC epoch milliseconds may be derived from the
parsed numeric components. The only eligibility interval is:

```text
issuedAt <= syntheticEvaluationTime < expiresAt
```

The helper does not replace, clamp, round, extend, or interpret any instant as
server time.

## Snapshot-Once And Immutability Rules

Before validation, the implementation takes one bounded snapshot of each
allowed scalar and each of at most 64 vector rows. It must:

- read an allowed getter at most once;
- reject missing, extra, accessor-induced invalid, or unsupported shape;
- never retain references to mutable input arrays or row objects;
- never invoke `toJSON`, `valueOf`, custom iteration, or user callbacks;
- construct new plain internal records; and
- deep-freeze policy, checks, blockers, and output.

Business-invalid input returns `blocked`; it does not throw. A programming
defect or impossible internal invariant may throw and must not be translated
into `synthetic_preconditions_satisfied`.

## Validation And Blocker Implementation

The policy module exports the approved blocker tuple in exact contract order.
The validator records each reason at most once in that order. It does not sort
blockers lexically and does not attach instrument keys or rejected values.

If a prerequisite needed for a later check is invalid, that check is reported
as `not_evaluated`; the helper must not hash malformed or over-limit content to
discover additional blockers.

The result contains only the approved bounded summary and check statuses. A
blocked result uses safe numeric summaries only when those summaries were
validated; otherwise the values are `null` rather than coerced defaults.

## Fixture And Test Plan

The synthetic fixture module contains no real owner, approved research vector,
database row, challenge, provider value, or secret. It uses visibly synthetic
values and a pinned digest generated from those values only.

Focused tests must cover:

1. one `synthetic_preconditions_satisfied` initial-approval result;
2. mandatory mode, trust, and readiness labels on both outcomes;
3. every blocker reason and exact blocker ordering;
4. empty, 64-row, and 65-row vectors, including a 64-row zero-bps case whose
   exact total remains 10,000 bps;
5. duplicate, reversed, and punctuation-sensitive ASCII instrument order;
6. invalid numeric weights, overflow-safe integer total, and no
   renormalization;
7. approved v2 scenario-vector hash compatibility and independent envelope hash
   sensitivity to actor mode, confirmation policy, intent, owner, policy,
   scenario, vector-hash version, scenario-vector hash, and complete vector;
8. exact UTC boundaries, leap-year dates, invalid dates, offsets, missing
   milliseconds, year bounds, and no current-clock read;
9. every actor and minimal durable-state enum, including `unknown`;
10. challenge state, synthetic instance, owner binding, and envelope mismatch;
11. oversized per-field rejection before hashing, a maximum-shape valid input
    remaining below 32 KiB, and the forward-compatibility cap remaining pinned;
12. input arrays/rows unchanged after success and failure;
13. output and nested arrays/objects frozen;
14. getter values read once and dangerous coercion hooks never invoked;
15. no owner, provider/session, challenge, hash, vector row, SQL, physical id,
    approval, receipt, or committed evidence in output; and
16. no imports or calls for DB, filesystem, network, environment, clock,
    random, cache, logger, route, Server Action, React, or Next.js behavior.

The test file must not connect to production or load `.env.local`.

## Forbidden Dependency Boundary

The proposed source import graph is allowlisted to:

```text
node:crypto
the separately approved simulation_scenario_vector_hash_v2 pure module
the five new planner modules
```

Within the planner slice, only the new envelope serialization module may import
`node:crypto`; the already approved v2 module keeps its separately reviewed
dependency boundary. No planner source may import from:

- `src/db`, Drizzle, Neon, schema, query, repository, or migration code;
- Next.js, React, routes, Server Actions, middleware, or components;
- auth/session, cookies, headers, Basic Auth, admin, or Cron code;
- provider, KIS, market-data, filesystem, environment, fetch, timers, random,
  logging, or cache code; or
- resolver, optimizer, simulation runtime, job, recommendation, rebalance, or
  order code.

## Verification Commands After Separate Approval

The later local-only implementation would run, in this order:

1. focused test file through the existing Node test environment;
2. `npm run test`;
3. `npm run lint`;
4. `npm run build`;
5. `git diff --check`; and
6. source/import and changed-file allowlist review.

No database command, migration generation, migration execution, provider call,
dev server, browser, Vercel deployment, or production smoke is part of this
slice.

## Stop Conditions

Implementation must stop without widening scope if:

- the separate v2 deterministic vector-hash implementation gate is not
  completed;
- any v1 source, fixture, hash, approval evidence, or durable evidence would
  need to change;
- a valid planner input requires more than the approved caps;
- the envelope digest cannot be defined without changing approved semantics;
- any real tenant, owner, challenge, vector, DB row, env value, or secret is
  required;
- a DB, auth, lock, receipt, runtime, API, UI, provider, or job import appears;
- a plain `would_admit`, generic `eligible`, `ready`, or `committed` result is
  introduced;
- an unsupported lifecycle intent is silently converted to initial approval;
- test isolation requires changing package dependencies or scripts; or
- any file outside the allowlist must change.

## Explicit Non-Actions

This docs-only implementation packet does not:

- approve source, type, fixture, test, or test-runner edits;
- run tests, lint, build, migration, database, provider, deployment, or smoke
  commands;
- implement schema, DB access, repository, auth, lock, receipt, transaction,
  writer, runtime, API, UI, job, or Cron;
- seed, import, backfill, approve, revoke, supersede, or reapprove data; or
- authorize simulation execution, optimizer use, recommendation, rebalance,
  or order behavior.

## Requested Review Decision

The user may approve, reject, or revise this package only as one local-only
implementation plan:

1. the eight-file allowlist above;
2. the exact policy constants and resource caps;
3. closed readonly synthetic input and bounded immutable output types;
4. deterministic ASCII canonical order, `O(n)` bounded validation, and ordered
   blockers;
5. the separately approved v2 scenario-vector hash binding;
6. the proposed approval-envelope digest serialization;
7. strict synthetic UTC parser and caller-supplied evaluation time;
8. snapshot-once, no-coercion, mutation, and freeze rules;
9. synthetic-only fixture and full focused-test matrix; and
10. the forbidden dependency, verification, and stop boundaries.

This packet is not currently requesting implementation approval. After the
versioning decision and separate v2 pure implementation complete, this packet
must be revised to pin the exact approved v2 module, exports, version constant,
and synthetic expected hash before returning for planner implementation
approval.

Any later approval may authorize only the listed local source/test
implementation and verification commands. It would not authorize schema, DB,
auth, repository, writer, runtime binding, API, UI, production data,
deployment, or operator mode.

This Markdown packet is not imported by code and is not a runtime trust source.
