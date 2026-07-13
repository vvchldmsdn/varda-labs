# Curated Approved-Vector Synthetic Admission Planner Contract

Last updated: 2026-07-13

Status: `docs_only_draft_for_review_not_approved`

This document proposes the meaning of a first pure, synthetic-only planner for
curated approved-vector admission. It does not approve or implement the
planner, tests, repository, writer, transaction, schema, migration, database
operation, auth/session adapter, API, UI, job, seed, import, backfill, approval
row, challenge, or receipt.

## Product Question

> Given one completely normalized in-memory synthetic snapshot, can a pure
> helper explain whether that snapshot satisfies the static conditions for a
> first curated-vector approval without claiming that any real user, session,
> database state, lock, challenge, receipt, or commit exists?

The proposed policy id is:

```text
curated_vector_synthetic_admission_planner_v1
```

The proposed helper name for a later implementation packet is:

```text
planSyntheticCuratedVectorAdmission
```

Neither name creates runtime authority.

## Canonical Result Terminology

The planner must not return plain `would_admit` or generic `eligible`. Its only
top-level decisions are:

```text
synthetic_preconditions_satisfied
blocked
```

Every result also contains:

```text
mode: synthetic_only
runtimeTrustStatus: not_established
readinessStatus: not_ready
```

`synthetic_preconditions_satisfied` means only:

> the caller-supplied normalized synthetic snapshot passed this pure static
> policy.

It does not mean a production request would admit, a user is authenticated, a
database row exists, a lock can be acquired, a challenge is valid now, a
revision can be allocated, or a transaction can commit.

The existing Gate 0 term `would_admit` remains reserved for a future separately
approved server-side boundary that repeats every authoritative runtime and
transaction-time check. No current code may return that term.

## Scope: First Initial Approval Only

Version 1 evaluates only:

```text
intent: initial_approval
```

It does not model revocation, supersession, reapproval after revocation,
operator approval, cancellation execution, invalidation execution, or receipt
recovery. Those paths require durable lifecycle evidence and are ineligible for
this first synthetic planner.

An unsupported intent returns `blocked`; it is never converted to
`initial_approval`.

## Approved Policy Bindings To Preserve

A later implementation must pin, as immutable policy constants:

- actor mode `tenant_self_approval_v1`;
- confirmation policy `curated_vector_self_confirmation_v1`;
- source-vector cap 64, including explicit zero-bps rows;
- portfolio-path policy and Gate 0 values from the proposed exact envelope;
- the approved vector-hash version;
- the approved approval-envelope digest version;
- write-safety contract commit
  `c0a2f584e167f153db0dedb6cfc418d76b2fc5bd`; and
- runtime trust `not_established`; and
- readiness `not_ready`.

The planner may compare input labels to pinned constants. It cannot prove that
the labels came from an authoritative source.

## Synthetic Input Boundary

The planner consumes one in-memory object that is explicitly labelled:

```text
evidenceSource: caller_supplied_synthetic_unverified
```

The object may contain normalized evidence equivalent to these groups.

### Policy Snapshot

- planner policy id and version;
- actor-mode label;
- confirmation-policy label;
- portfolio-path policy id;
- Gate 0 approval commit;
- vector-hash version; and
- approval-envelope digest version.

### Synthetic Actor Snapshot

- session condition: `verified_active` or an ineligible state;
- identity mapping condition: `exactly_one_active` or an ineligible state;
- app-user condition: `active` or an ineligible state;
- actor/owner relation: `same_canonical_owner` or mismatch; and
- one canonical UUID-shaped owner value used only to validate and bind the
  synthetic exact identity.

These fields are assumptions, not capabilities. The pure planner must not
accept a provider token, cookie, session id, provider subject, email, Basic
Auth value, admin secret, Cron secret, role override, or browser-selected owner.

### Exact Approval Identity

- canonical owner user id;
- portfolio-path policy id;
- Gate 0 approval commit;
- scenario id; and
- scenario version.

The actor snapshot's synthetic owner and exact identity owner must match. The
owner value is never returned.

### Canonical Source Vector

- one nonempty array of exact `(market, currency, ticker, weightBps)` rows;
- explicit zero-bps rows preserved;
- canonical order already applied;
- exact integer total of 10,000 bps; and
- reviewed scenario-vector hash evidence.

The planner validates; it does not sort, trim, deduplicate, append, infer,
renormalize, or repair rows.

### Synthetic Confirmation Snapshot

- exact server-challenge policy label;
- state label;
- synthetic owner-binding match;
- exact envelope-digest match;
- synthetic `issuedAt`, `expiresAt`, and `syntheticEvaluationTime`; and
- a safe challenge-instance label used only for equality checks inside the
  fixture.

All three synthetic instants use the exact canonical UTC form:

```text
YYYY-MM-DDTHH:mm:ss.sssZ
```

Offsets, omitted milliseconds, local time, leap-second text, invalid calendar
values, and implementation-dependent date parsing are rejected. The planner
checks only:

```text
issuedAt <= syntheticEvaluationTime < expiresAt
```

`syntheticEvaluationTime` is caller-supplied synthetic evidence. The helper
must not call `Date.now()`, read a clock, replace the supplied value, or claim
server time.

The input must not contain a raw production challenge handle, handle digest,
receipt, provider/session value, or secret.

### Synthetic Durable-State Snapshot

For `initial_approval`, the snapshot contains only these bounded assumptions:

```text
approvalRevisionAssumption:
  no_prior_revision
  current_approval_exists
  prior_revision_exists
  unknown

competingChallengeAssumption:
  none
  live_competitor_present
  unknown
```

Only `no_prior_revision` plus `none` can satisfy v1 preconditions. No row,
count, revision number, timestamp, receipt, lifecycle event, physical id, or
database-shaped object is accepted.

These are unverified assumptions. The planner does not query, lock, or prove
database state and does not allocate a revision.

## Validation Order

A later pure helper must use one deterministic fail-closed order:

1. validate planner input shape and synthetic source label;
2. validate pinned policy and contract bindings;
3. validate the synthetic actor-state labels;
4. validate exact-identity field shape and synthetic actor/owner equality;
5. require `initial_approval` intent;
6. reject an empty vector or more than 64 rows before copying or hashing rows;
7. validate every canonical instrument identity and integer weight;
8. reject duplicates and noncanonical input order;
9. require every explicit row, including zero-bps rows, and total exactly
   10,000 bps;
10. recompute and compare the scenario-vector hash;
11. recompute and compare the exact approval-envelope digest;
12. validate canonical synthetic instants, confirmation policy, owner binding,
    exact challenge instance, `pending` state, and
    `[issuedAt, expiresAt)` using `syntheticEvaluationTime`;
13. require the minimal synthetic durable-state assumptions
    `no_prior_revision` and `none`; and
14. return `synthetic_preconditions_satisfied` only when no blocker remains.

No later step repairs or hides an earlier blocker. In particular, the planner
must not use hash equality to bypass row validation, actor assumptions, expiry,
or synthetic lifecycle-state checks.

## Deterministic Blockers

The proposed blocker vocabulary and order are:

```text
invalid_synthetic_input
unsupported_evidence_source
policy_binding_mismatch
unsupported_actor_mode
synthetic_session_not_verified_active
synthetic_identity_mapping_not_exactly_one_active
synthetic_app_user_not_active
synthetic_actor_owner_mismatch
invalid_exact_identity
unsupported_admission_intent
source_vector_empty
source_vector_row_cap_exceeded
invalid_instrument_identity
duplicate_instrument_identity
source_vector_not_canonical_order
invalid_weight_bps
source_vector_total_not_10000_bps
scenario_vector_hash_mismatch
approval_envelope_digest_mismatch
invalid_synthetic_instant
confirmation_policy_mismatch
confirmation_owner_binding_mismatch
confirmation_instance_mismatch
confirmation_not_pending
confirmation_not_yet_valid
confirmation_expired
synthetic_current_approval_exists
synthetic_prior_revision_exists
synthetic_competing_challenge
synthetic_durable_state_unproven
```

The result includes every applicable blocker in this fixed order. It does not
return raw values, validation exceptions, owner identity, hashes, challenge
material, or simulated database rows.

## Output Projection

The proposed output is bounded to semantics equivalent to:

```text
policyId
policyVersion
mode = synthetic_only
runtimeTrustStatus = not_established
readinessStatus = not_ready
decision = synthetic_preconditions_satisfied | blocked
intent = initial_approval
blockers[]
rowCount
totalWeightBps
zeroWeightRowCount
checks:
  policyBinding
  actorAssumptions
  exactIdentityShape
  sourceVector
  vectorHash
  approvalEnvelope
  confirmationAssumptions
  durableStateAssumptions
```

Each check is only `pass`, `blocked`, or `not_evaluated`. Output contains no:

- owner UUID, provider subject, email, role, session, cookie, or token;
- raw or digested challenge handle;
- scenario-vector hash or approval-envelope digest value;
- full vector rows or instrument names;
- physical ids, revision allocation, timestamp allocation, SQL, advisory key,
  table name, index name, or constraint name;
- current holdings, target weights, recommendation, optimizer result, or order;
  or
- simulated approval, receipt, lifecycle event, or committed result.

## Purity And Resource Contract

A later implementation may use only deterministic in-memory computation. It
must not perform:

- database, filesystem, network, provider, environment, clock, random, crypto
  service, cache, process-global, or browser I/O;
- auth/session resolution or identity lookup;
- advisory lock acquisition, SQL generation, transaction creation, receipt
  recovery, or revision allocation;
- logging, analytics, metrics emission, or persistence; or
- mutation of the input or reuse of mutable output state.

Canonical hashing may call an already-reviewed deterministic local hash helper
over bounded in-memory bytes. It must not call an external service or read a
file or environment value.

The helper must inspect the outer row count before cloning, sorting, or hashing
the vector. It rejects more than 64 rows without partial canonicalization. A
later implementation packet must define exact string and total-byte bounds for
all synthetic fields before code is approved.

## Synthetic Fixture Requirements

A later pure-only implementation packet must require fixtures for at least:

- one fully eligible synthetic initial approval;
- empty, 64-row, and 65-row vectors;
- explicit zero-bps row preservation;
- duplicate and out-of-order instruments;
- invalid, negative, non-integer, over-10,000, and wrong-total weights;
- scenario-vector hash and envelope-digest mismatch;
- strict canonical UTC instant parsing, caller-supplied
  `syntheticEvaluationTime`, future-issued, exact-boundary-expired, terminal,
  and owner-mismatched challenge assumptions;
- inactive session, ambiguous identity, provisioning/disabled user, and actor
  mismatch assumptions;
- every minimal approval-revision and competing-challenge assumption enum,
  including both `unknown` states;
- deterministic blocker ordering and immutable bounded output;
- input mutation resistance and repeated-field getter safety;
- no DB, network, filesystem, environment, clock, randomness, logging, API,
  UI, or write behavior; and
- no use of a real owner UUID, production challenge, production database row,
  approved research vector, provider value, token, secret, or environment
  value.

## Current Runtime Result

Even if this contract is approved and later implemented, current runtime
remains:

```text
runtimeTrustStatus = not_established
readinessStatus = not_ready
```

No synthetic result may be persisted, returned from a product API or Server
Action, shown as an approval promise in UI, used to skip confirmation, or
translated into `would_admit` or `committed`.

## Rejected Alternatives

This candidate rejects:

- returning plain `would_admit` or generic `eligible` from a synthetic helper;
- accepting a browser-supplied owner UUID as authority;
- passing a real `TenantContext`, session, challenge, receipt, or DB row into
  synthetic fixtures;
- treating synthetic actor or durable-state labels as verified facts;
- sorting, trimming, deduplicating, renormalizing, filling, or falling back;
- checking the hash before the 64-row cap and complete row validation;
- calling the database to make the pure result more realistic;
- allocating a revision or timestamp in a dry-run;
- deriving or returning an advisory lock key;
- implementing supersession, revocation, or reapproval in v1;
- using current holdings, target policies, optimizer output, latest rows,
  singleton rows, Markdown, Git, or Base44 evidence as fallback authority; and
- exposing the helper through API, UI, admin tools, jobs, or Cron.

## Explicit Non-Actions

This docs-only contract does not:

- approve the planner policy or helper implementation;
- edit source, tests, fixtures, package scripts, schema, SQL, or migrations;
- read or write a database;
- implement auth, tenant capability, challenge, receipt, lock, repository,
  planner, transaction, writer, API, UI, job, or Cron;
- seed, import, backfill, approve, revoke, supersede, or reapprove data; or
- authorize simulation execution, optimizer use, recommendation, rebalance,
  or order behavior.

## Requested Review Decision

The user may approve, reject, or revise this package only as one docs-only
bundle:

1. v1 is a pure synthetic-only planner for `initial_approval` static
   conditions only;
2. canonical decisions are `synthetic_preconditions_satisfied` and `blocked`,
   always paired with `mode=synthetic_only`,
   `runtimeTrustStatus=not_established`, and `readinessStatus=not_ready`;
3. expiry uses only strict canonical UTC `issuedAt`, `expiresAt`, and the
   caller-supplied `syntheticEvaluationTime`; no clock is read;
4. normalized synthetic actor, exact identity, vector, confirmation, and the
   minimal durable-state assumption enums remain caller-supplied assumptions,
   never runtime authority or persisted-row projections;
5. validation is deterministic, fail-closed, bounded by 64 rows before hash
   work, and returns the ordered blocker vocabulary above;
6. output is bounded and excludes owner, provider/session, challenge, hash,
   vector-row, physical, SQL, approval, and committed evidence; and
7. the helper performs no I/O, runtime trust resolution, lock, receipt
   recovery, revision allocation, transaction, or write.

Approval of this bundle would approve planner semantics only. It would not
approve an implementation, test, schema, database operation, repository,
writer, auth/session runtime, API, UI, row, or operator mode.

## Authorized Next Gate

If this docs-only contract is explicitly approved, the next artifact may be an
unapproved local-only pure-helper implementation packet defining exact types,
string/byte caps, deterministic local hashing reuse, blocker tests, mutation
guards, and forbidden-I/O assertions.

That implementation packet must return for explicit approval before any source
or test file changes. Challenge/receipt persistence, verified `TenantContext`,
repository, writer, database, API, and UI remain later independent gates.

This Markdown contract is not imported by code and is not a runtime trust
source.
