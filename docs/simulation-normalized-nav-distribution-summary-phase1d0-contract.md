# Simulation Normalized NAV Distribution Summary Phase 1D0 Contract

Last updated: 2026-07-12

Status: docs-only contract. No helper, type, fixture, test, production
execution, runtime trust, repository, persistence, route, UI, chart, or
optimization behavior is enabled by this phase.

## Purpose

Phase 1D0 answers one narrow pure-calculation question:

> Given one complete `simulation_normalized_nav_v1` result and an explicit
> expected binding for its three evidence hashes, what are the empirical p10,
> p50, and p90 normalized-NAV values at every step and at the terminal step?

This phase defines a summary artifact only. It does not draw a fan chart,
choose representative paths, scale NAV into KRW, calculate expected wealth,
or optimize portfolio weights.

## Versioned Policy

The proposed policy is:

```text
policy.version: simulation_normalized_nav_distribution_summary_v1
policy.inputNavVersion: simulation_normalized_nav_v1
quantileAlgorithm: hyndman_fan_type_7_v1
quantileProbabilities: [0.10, 0.50, 0.90]
pathTreatment: all_paths_or_block
stepOrder: increasing_step_index
baseline: literal_one_band_at_step_zero
runtimeTrustStatus: not_established
maxInputNavPoints: 1,000,000
outputKind: dimensionless_empirical_nav_quantile_summary
```

The input NAV policy's `distributionSummary=forbidden` field means that Phase
1C does not embed or calculate a distribution summary. It does not prevent a
separately versioned downstream pure phase from consuming a complete Phase 1C
artifact under a new contract.

This docs-only contract proposes the Phase 1D0 version and exact calculation
rules. It does not approve an implementation or execution.

## Statistical Meaning

The output is an empirical distribution over the supplied normalized NAV
paths at each step. It is conditional on the exact return matrix, stochastic
draw plan, scenario vector, horizon, and path count that produced the input.

The bands are not:

- guaranteed outcomes;
- calibrated forecast confidence intervals;
- calendar-dated future prices;
- expected returns or arithmetic means;
- recommendations, targets, or order instructions.

`p50` is the Type 7 median of the supplied path values. It must not be labeled
as an expected value. Expected-value calculation, if later needed, requires a
separate policy and gate.

## Pure Input Boundary

The future helper may accept only two explicit in-memory inputs.

### 1. Ready normalized NAV artifact

One complete `SimulationNormalizedNavResult` with:

```text
calculationStatus: ready
runtimeTrustStatus: not_established
policy.version: simulation_normalized_nav_v1
blockers: []
scenarioId
scenarioVersion
scenarioVectorHash
inputMatrixHash
drawPlanHash
horizon
pathCount
totalPointCount
totalNavCells
paths
```

The full Phase 1C policy object must match exactly. In particular, its
portfolio-path policy, Gate 0 commit, weighted-sum algorithm, canonical order,
literal-one baseline, memory cap, and no-rebalancing meaning must not drift.

Phase 1D0 consumes the materialized NAV values. It does not receive or
recalculate the scenario vector, return matrix, draw plan, gross-growth
factors, or weighted NAV formula.

### 2. Expected summary binding

One caller-supplied in-memory object containing:

```text
expectedScenarioVectorHash
expectedInputMatrixHash
expectedDrawPlanHash
```

All three values must use canonical lowercase `sha256:` form and exactly equal
the corresponding fields carried by the ready NAV artifact.

The expected binding prevents a caller from accidentally summarizing an
artifact from a different vector, matrix, or draw execution. Equality proves
binding consistency only. Phase 1D0 cannot revalidate source evidence it does
not receive, establish runtime authorization, or infer tenant ownership.

## Structural Validation

The future helper must revalidate the complete summary-relevant Phase 1C
shape rather than trusting TypeScript types alone:

- status is `ready`, blockers are empty, and runtime trust remains
  `not_established`;
- the complete Phase 1C policy object matches `simulation_normalized_nav_v1`;
- scenario id and version are valid nonempty canonical descriptors;
- all three carried hashes are canonical and match the expected binding;
- horizon and path count are positive safe integers;
- total point and NAV-cell counts are equal to
  `pathCount * (horizon + 1)` with safe integer arithmetic;
- total points do not exceed the Phase 1C one-million-point cap;
- paths contain exactly `pathCount` rows in sequential `pathIndex` order;
- every path contains exactly `horizon + 1` points in sequential `stepIndex`
  order;
- every NAV value is finite and strictly positive;
- every step-zero NAV is exactly literal `1`;
- no point, path, or step is missing, duplicated, reordered, or extra.

Status classification is explicit:

- `calculationStatus` other than `ready` or a nonempty input blocker list adds
  `input_nav_not_ready`;
- top-level `runtimeTrustStatus` other than `not_established` adds
  `input_nav_runtime_trust_invalid`;
- drift in the separate Phase 1C policy object adds
  `input_nav_policy_mismatch`.

These checks remain distinct even if more than one reason applies.

An out-of-order path array or a path whose `pathIndex` does not equal its
canonical array position is `input_nav_shape_invalid`. Phase 1D0 must not sort,
relabel, or otherwise repair path input. Numeric sorting is allowed only for
the temporary per-step NAV buffer used by the quantile algorithm.

After validating the top-level policy, identity, hashes, and counts, Phase
1D0 consumes only these path-level fields:

```text
path.pathIndex
point.stepIndex
point.nav
```

It must not read, validate, compare, copy, aggregate, or emit these Phase 1C
point-provenance fields:

```text
drawStepIndex
sourceRowIndex
previousServiceDate
serviceDate
```

Those fields belong to upstream historical sampling provenance. Omitting them
from Phase 1D0 is deliberate: different paths can carry different sampled
dates at the same step, and the three hash comparisons establish binding
consistency only. They do not revalidate upstream provenance or authorize
relabeling any sampled date as a future forecast date.

Any malformed count, path, summary-relevant point field, NAV, hash, policy, or
status blocks the whole result. The helper must not drop a bad path and
summarize the remaining paths.

## Exact Quantile Algorithm

For each `stepIndex`, collect exactly one NAV value from every path. Retain
duplicates and sort a copy in numeric ascending order:

```text
x[0] <= x[1] <= ... <= x[n - 1]
n = pathCount
```

Every path contributes one equally weighted observation. The helper must not
introduce path probabilities, importance weights, quality weights, or path
selection.

For each fixed probability `p` in `0.10`, `0.50`, and `0.90`, apply
Hyndman-Fan Type 7 exactly:

```text
h = (n - 1) * p
j = floor(h)
g = h - j
k = min(j + 1, n - 1)
Q(p) = x[j] + g * (x[k] - x[j])
```

The arithmetic order above is part of the proposed policy. Every intermediate
and final value must remain finite, and every final quantile must be strictly
positive. No presentation rounding, decimal formatting, clipping, winsorizing,
outlier removal, weighting, interpolation across steps, or alternate quantile
definition is allowed.

For `n=1`, all three quantiles equal the one supplied NAV value. Duplicate
path values remain duplicate observations.

The input arrays must not be mutated. A future implementation should reuse at
most one step-sized sort buffer rather than retain a separately sorted copy for
every step.

## Baseline And Band Invariants

Step zero must be emitted as:

```text
stepIndex: 0
p10: 1
p50: 1
p90: 1
```

This is valid only after every path's step-zero NAV has been checked as literal
`1`. It must not be synthesized to hide a malformed baseline.

For every later step:

```text
0 < p10 <= p50 <= p90
```

The terminal summary is the final step band at `stepIndex=horizon`. It must be
an exact projection of that band, not a separate calculation using different
paths, rounding, or a different quantile algorithm.

## Output Boundary

A ready result may contain only:

```text
summaryStatus: ready
runtimeTrustStatus: not_established
policy
scenarioId
scenarioVersion
scenarioVectorHash
inputMatrixHash
drawPlanHash
horizon
pathCount
totalPointCount
stepBands:
  - stepIndex
    p10
    p50
    p90
terminalSummary:
  stepIndex
  p10
  p50
  p90
blockers: []
```

The output remains dimensionless. Values such as `1.20` mean normalized NAV
of 1.20, not 1.20 KRW or a preformatted 20% return.

The result must not include:

- raw paths or individual terminal path values;
- scenario-vector rows, return-matrix rows, draw indices, or gross-growth
  factors;
- source dates presented as future dates;
- owner, tenant, user, auth, approval-record, database, or provider data;
- initial or terminal KRW values;
- mean, variance, loss probability, confidence label, drawdown, expected
  shortfall, representative path, or optimization result.

A blocked result has one exact projection regardless of which validation stage
failed:

```text
summaryStatus: blocked
runtimeTrustStatus: not_established
policy: SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY
scenarioId: null
scenarioVersion: null
scenarioVectorHash: null
inputMatrixHash: null
drawPlanHash: null
horizon: 0
pathCount: 0
totalPointCount: 0
stepBands: []
terminalSummary: null
blockers:
  - reason
```

Blocked output never reflects caller-supplied scenario, hash, count, path, or
NAV values, even if some fields passed earlier validation. It must never
return a partial band or terminal summary.

All ready and blocked outputs, nested bands, terminal summary, policy, and
blockers must be immutable.

## Deterministic Blocker Policy

The future implementation should use a fixed deduplicated blocker order:

```text
input_nav_not_ready
input_nav_runtime_trust_invalid
input_nav_policy_mismatch
expected_binding_invalid
scenario_vector_hash_mismatch
input_matrix_hash_mismatch
draw_plan_hash_mismatch
input_nav_shape_invalid
summary_output_too_large
invalid_nav
invalid_quantile
```

Validation returns every safely evaluable applicable reason, deduplicated and
ordered only by the list above. A later check whose prerequisites are not
structurally available is not fabricated as an additional reason. A blocked
result must have at least one blocker, and a ready result must have none.

Blocker objects contain only the fixed `reason` value. Caller-supplied values,
field names, indices, hashes, counts, and raw input fragments must not be
reflected inside blocker payloads.

## Resource Bound

Phase 1D0 accepts no artifact larger than the Phase 1C cap:

```text
maxInputNavPoints: 1,000,000
totalInputNavPoints = pathCount * (horizon + 1)
totalOutputBands = horizon + 1
```

Safe integer arithmetic and the point cap must be checked before allocating
summary arrays. The future helper may allocate one output band per step and
one reusable sort buffer of `pathCount` values. The cap is an engineering
bound, not a production default for path count or horizon.

The direct calculation cost is expected to be:

```text
time: O((horizon + 1) * pathCount * log(pathCount))
additional memory: O(pathCount + horizon)
```

This complexity statement does not authorize production execution.

## Required Synthetic Fixtures Before Implementation

- one-path Type 7 behavior;
- odd and even path counts with pinned p10, p50, and p90 values;
- duplicate values retained in the empirical sample;
- exact literal-one step-zero band;
- terminal summary exactly matching the final step band;
- out-of-order paths and mismatched `pathIndex` values remaining blocked
  without sorting or relabeling input;
- two separately valid canonical artifacts with the same per-step NAV
  multisets but values assigned to different canonical path indices producing
  identical bands, without mutating either input;
- identical summaries when only ignored draw/source/date provenance fields
  differ, proving those fields are not consumed;
- ready-status or nonempty input blockers mapping to `input_nav_not_ready`;
- a top-level runtime-trust mismatch mapping to exactly
  `input_nav_runtime_trust_invalid` when every other input is valid;
- Phase 1C policy and hash-binding mismatch remaining separately classified;
- missing, duplicate, reordered, and extra path or step;
- invalid counts and unsafe count multiplication;
- non-finite, zero, and negative NAV at baseline and later steps;
- no path exclusion after one invalid value;
- non-finite quantile intermediate or result;
- one-million-point boundary and over-limit rejection;
- minimized immutable output with no raw paths, dates, owner, or approval data;
- no PRNG, resampling, vector/matrix/draw/growth recalculation, file, env,
  database, provider, network, route, UI, job, write, or persistence dependency.

Fixtures must use synthetic scenario identities and hashes. They must not use
the approved research vector, production artifacts, or an actual owner
identifier.

## Explicit Non-Scope

This docs-only contract does not add or change:

- TypeScript helpers, types, fixtures, or tests;
- an actual matrix, draw plan, gross-growth, NAV, or summary execution;
- a runtime Scenario Vector Resolver, repository, session adapter, or approval
  lookup;
- database schema, migration, persistence, seed, backfill, provider, auth,
  ownership, or RLS behavior;
- initial capital, current-portfolio comparison, KRW wealth, contribution, or
  cash-flow behavior;
- path means, expected values, loss probability, drawdown, expected shortfall,
  fan or spaghetti path selection, optimizer, target generation,
  recommendation, order, or rebalance behavior;
- API, route, page, UI, chart, job, Cron, or write behavior.

## Next Gate

Only a separate explicit approval may authorize a pure helper, types, tests,
and synthetic fixtures implementing this contract. That implementation must
remain in-memory, use no production artifacts, preserve
`runtimeTrustStatus=not_established`, and perform no actual simulation
execution, repository lookup, persistence, route, UI, job, or write work.

Fan-chart presentation, spaghetti-path sampling, loss and drawdown metrics,
initial-KRW scaling, optimization, runtime orchestration, and product
integration remain later independent gates.
