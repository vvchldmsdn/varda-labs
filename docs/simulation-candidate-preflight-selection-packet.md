# Simulation Candidate Preflight Selection Packet

Recorded: 2026-07-12

Status: `docs_only_no_candidate_or_period_selected`

This packet defines what a user must choose before one separately approved,
read-only Simulation production preflight can run. It does not select a
candidate, period, scenario vector, or runtime default, and it is not read by
application code.

## Why This Packet Exists

The Simulation data path already has reviewed, fail-closed boundaries:

- Phase 0A builds a KRW-investor adjusted-close return matrix;
- Phase 0B reports exact candidate-universe and matrix-request evidence;
- Phase 0C resolves one exact end service date and return-step count;
- the Phase 0C server-only preflight performs one bounded axis scan and, only
  after an exact axis resolves, one Phase 0B coverage read.

Those phases define how a request is checked. They do not choose which
instruments or period a user wants to review. This packet keeps that product
choice explicit before any production database read.

## Selection Fields

A future selection must provide all of the following:

```text
reviewPurpose
candidates:
  - market
    currency
    ticker
    displayName (optional)
endServiceDate
returnStepCount
```

`reviewPurpose` is human review metadata only. It is not part of the Phase 0C
request, instrument identity, scenario universe hash, or matrix request hash.

No field in this packet is currently selected.

## Review-Purpose Options

### `control`

Use one explicitly named instrument to inspect endpoint and period evidence
without cross-market or FX interaction. This is useful for isolating the basic
axis behavior, but it does not exercise the cross-market product requirement.

### `research_cross_market`

Use at least one explicitly named KRW instrument and one explicitly named USD
instrument. This exercises:

- the Korea/US service-date union;
- date-specific USD/KRW evidence;
- Phase 0A FX-normalized KRW returns;
- incomplete candidate or FX evidence without intersection-based shrinking.

This is the recommended first review purpose because it covers more of the
important data contract in one bounded read. It is not selected by this packet
and does not authorize any particular ticker.

### `benchmark_comparison`

Use explicitly named benchmark instruments to compare evidence readiness for a
later research baseline. A familiar ticker or an existing Market Context row
is not an automatic selection and does not prove that the required adjusted
close history is available.

These purpose labels are documentation vocabulary only. Adding one to runtime
input or hashing would require a separate contract change.

## Candidate Identity Rules

Each candidate is identified by exact normalized:

```text
market | currency | ticker
```

Current request validation requires:

- nonempty `market`, normalized to lowercase;
- `currency` equal to `KRW` or `USD`, normalized to uppercase;
- nonempty `ticker`, normalized to uppercase;
- no duplicate normalized candidate identity;
- at least one candidate.

`displayName` is optional presentation metadata and is not identity.

The candidate set must be supplied explicitly by the user. It must not be
inferred from:

- current holdings or quantities;
- brokerage, ISA, or IRP membership;
- ISA `isa-v1` or another strategic target;
- current, equal, group, or legacy weights;
- a Market Context benchmark row;
- whichever instruments happen to have the most stored data.

This packet does not perform a production candidate-availability query. A
candidate may later be reported as missing by the read-only preflight; it must
not be silently removed from the universe.

## Period Request Rules

### `endServiceDate`

The user must provide one exact valid `YYYY-MM-DD` service date.

The resolver uses exact endpoint semantics:

- stored close evidence date maps to the following KST service date;
- the initial scan reads source dates only through
  `endServiceDate - 1 calendar day`;
- the requested service-date endpoint must be observed on the union axis;
- nearest-prior evidence may be reported for review but is never substituted;
- there is no automatic rollback to an earlier endpoint.

### `returnStepCount`

The user must provide one exact safe integer from 1 through 10,000. The upper
bound is an input-validation limit, not a recommended product default.

For `returnStepCount=N`, the resolver requires exactly `N + 1` service-date
points to produce `N` return steps. The user must choose the count; current
history length, a prior screen, or a fixture must not become a silent default.

## Fixed Read Boundary

For a valid exact request, the implemented preflight plans one fixed axis scan:

```text
requiredPointCount = returnStepCount + 1
axisScanDays = ceil(requiredPointCount * 2) + 30
sourceDateTo = endServiceDate - 1 calendar day
sourceDateFrom = sourceDateTo - axisScanDays calendar days
```

It permits:

- one parallel adjusted-close read for the exact candidates;
- one USD/KRW read over the same bounds only when a USD candidate exists;
- at most one exact Phase 0B coverage read after the axis resolves.

It forbids automatic retry, adaptive range expansion, silent all-history
fallback, provider calls, and backfill. An insufficient result describes the
fixed scan only; it does not prove that older evidence does not exist.

## Result Vocabulary

Statuses are outputs of a future read-only preflight, not user-selected or
predicted fields.

Axis status:

- `axis_ready`: an exact `N + 1` service-date axis resolved;
- `axis_incomplete`: the fixed scan did not provide enough usable points;
- `axis_blocked`: the request, exact endpoint, or source evidence failed
  closed.

Final preflight status:

- `axis_incomplete` or `axis_blocked`: Phase 0B was not run;
- `matrix_ready`: the exact Phase 0B matrix is complete;
- `matrix_incomplete`: missing or stale evidence remains visible;
- `matrix_blocked`: evidence is ambiguous or malformed.

The result must preserve the explicitly requested candidate set. It must not
produce a complete-looking matrix by intersecting away an incomplete
instrument or FX series.

## Hash Boundary

A later read-only result may contain:

- `scenarioUniverseHash`, only for a valid exact instrument universe;
- `matrixRequestHash`, only when the exact universe and service-date axis meet
  the Phase 0B hash requirements.

These are result provenance, not authorization credentials or selection
defaults. The hashes cannot approve a candidate, vector, execution, tenant, or
write.

This packet does not request or authorize:

- `scenarioVectorHash` or numeric weights;
- `inputMatrixHash`;
- `drawPlanHash`;
- initial KRW capital;
- normalized NAV aggregation.

## Unfilled Selection Record

The first production preflight remains unselected:

```text
reviewPurpose: not_selected
candidates: not_selected
endServiceDate: not_selected
returnStepCount: not_selected
expectedResult: not_applicable_result_is_observed_after_read
```

The recommended review purpose is `research_cross_market`, but a future user
decision must still name every candidate identity and the exact period. No
current holding, target, benchmark, or fixture fills those fields.

## Next Approval Gate

After the user supplies a complete selection, one bounded production preflight
requires separate approval that repeats the exact request:

```text
I select this Simulation read-only preflight request:

reviewPurpose: <control | research_cross_market | benchmark_comparison>
candidates:
  - market: <exact market>
    currency: <KRW | USD>
    ticker: <exact ticker>
endServiceDate: <YYYY-MM-DD>
returnStepCount: <integer>

I approve one production read-only preflight for this exact request only.
This does not approve runtime defaults or binding, provider calls, retries,
writes, scenario weights, draw execution, Phase 1C, UI/API, jobs, or auth
changes.
```

The preflight result must be returned for review before any scenario vector is
chosen or reused. `matrix_ready` would only open a later review gate; it would
not approve a vector or execution.

## Explicit Non-Scope

This docs-only packet does not add or change:

- a production database read or preflight invocation;
- candidate or period runtime binding;
- Phase 0A, 0B, or 0C resolver and scan behavior;
- candidate fallback, weights, vector approval, or target reuse;
- matrix, draw-plan, portfolio-path, or distribution execution;
- Phase 1C, fan charts, summaries, Monte Carlo, or optimization;
- route, API, page, UI, provider, write, job, Cron, schema, auth, ownership, or
  RLS behavior.
