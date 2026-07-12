# Simulation Path Risk Semantics Phase 1F0 Gate 0 Contract

Last updated: 2026-07-12

Status: docs-only semantics contract. No helper, type, fixture, test,
production execution, runtime trust, repository, persistence, route, UI,
chart, risk summary, or optimization behavior is enabled by this phase.

## Purpose

Phase 1F0 Gate 0 fixes the meaning of two separate path-risk calculations:

1. Given one complete `simulation_normalized_nav_v1` result and its explicit
   expected three-hash binding, what fraction of all validated paths ends
   below the literal normalized baseline of `1`?
2. For every validated path in that same kind of input, what is the largest
   peak-to-trough decline observed from step zero through the terminal step?

This document defines a shared input and validation boundary, followed by two
separate future policies and output artifacts:

```text
simulation_terminal_loss_probability_v1
simulation_path_max_drawdown_v1
```

The two artifacts must not be combined into one helper or one output. They
share validation semantics but answer different statistical questions and
may evolve through separate approval gates.

This phase does not define expected shortfall, percentile risk summaries,
drawdown duration, recovery time, terminal-value quantiles, optimizer
objectives, chart composition, or product presentation.

## Relationship To Existing Simulation Artifacts

Both future calculations consume a complete ready
`simulation_normalized_nav_v1` result and one explicit expected three-hash
binding directly.

They must not consume:

- the Phase 1D0 p10/p50/p90 distribution summary;
- the Phase 1E0 deterministic spaghetti-path subset;
- a selected, filtered, repaired, ranked, or truncated path collection.

The full normalized-NAV artifact is required because loss probability uses
the full empirical path denominator and maximum drawdown is path-dependent.
Neither metric can be reconstructed correctly from quantile bands or a
display subset.

## Versioned Policies

### Terminal loss probability

```text
policy.version: simulation_terminal_loss_probability_v1
policy.inputNavVersion: simulation_normalized_nav_v1
lossDefinition: strict_terminal_nav_below_literal_one_v1
probabilityDenominator: all_validated_paths_v1
pathTreatment: all_paths_or_block
runtimeTrustStatus: not_established
maxInputNavPoints: 1,000,000
outputKind: dimensionless_terminal_loss_probability
```

### Per-path maximum drawdown

```text
policy.version: simulation_path_max_drawdown_v1
policy.inputNavVersion: simulation_normalized_nav_v1
drawdownAlgorithm: running_peak_from_literal_step_zero_v1
drawdownDefinition: one_minus_nav_div_running_peak_v1
signConvention: nonnegative_loss_fraction
pathTreatment: all_paths_or_block
resultTreatment: per_path_only
runtimeTrustStatus: not_established
maxInputNavPoints: 1,000,000
maxPathDrawdownRows: 500,000
pathDrawdownCardinality: exactly_one_per_validated_path_v1
pathDrawdownLimitBehavior: exact_or_block
outputKind: dimensionless_per_path_max_drawdown
```

`maxPathDrawdownRows` is a derived structural ceiling, not a separate claim
that allocating 500,000 result objects is safe in every runtime. It follows
from the positive-horizon rule and the one-million input-point cap. A future
runtime execution policy may impose a smaller separately versioned limit, but
this pure contract must not silently reduce a valid request.

The input NAV policy's `distributionSummary=forbidden` field means that Phase
1C does not embed risk summaries. It does not prevent separately versioned
downstream pure calculations from consuming a complete Phase 1C artifact.

These policies are documentation proposals only. No implementation or actual
execution is approved by this contract.

## Shared Statistical Meaning

Both outputs are empirical summaries of the exact normalized paths supplied
to the future helper. They are conditional on the scenario vector, return
matrix, draw plan, horizon, path count, and portfolio-path policy that
produced those paths.

They are not:

- calibrated probabilities of real-world investment outcomes;
- guarantees, confidence intervals, or recommendations;
- net-of-tax, net-of-fee, inflation-adjusted, or cash-flow-adjusted results;
- KRW amounts or current-portfolio performance;
- evidence that the supplied source artifacts or user were approved at
  runtime.

The terminal-loss result answers only whether the gross normalized terminal
NAV is below its initial baseline. The maximum-drawdown result answers only
the largest within-path decline from a running peak.

## Shared Pure Input Boundary

Each future helper may accept exactly two explicit in-memory inputs.

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

The complete Phase 1C policy object must match exactly. In particular, its
portfolio-path policy, Gate 0 approval commit, weighted-sum algorithm,
canonical order, literal-one baseline, one-million-point limit, and
no-rebalancing meaning must not drift.

The risk helpers consume materialized normalized NAV values. They do not
receive or recalculate scenario-vector rows, return-matrix rows, draw-plan
rows, gross-growth factors, portfolio weights, or the weighted NAV formula.

### 2. Expected risk binding

One caller-supplied in-memory object containing:

```text
expectedScenarioVectorHash
expectedInputMatrixHash
expectedDrawPlanHash
```

All three values must use canonical lowercase `sha256:` form and exactly equal
the corresponding fields carried by the ready NAV artifact.

Hash equality establishes binding consistency only. It does not revalidate
source evidence unavailable to this phase, establish runtime trust, authorize
a user or tenant, or approve production execution.

## Shared All-Path Validation

Each future helper must independently revalidate the complete risk-relevant
Phase 1C shape before calculating its metric:

- status is `ready`, blockers are empty, and runtime trust remains
  `not_established`;
- the complete Phase 1C policy matches `simulation_normalized_nav_v1`;
- scenario id and version are valid nonempty canonical descriptors;
- all three carried hashes are canonical and match the expected binding;
- horizon and path count are positive safe integers;
- total point and NAV-cell counts equal
  `pathCount * (horizon + 1)` using safe integer arithmetic;
- total points do not exceed the Phase 1C one-million-point cap;
- paths contain exactly `pathCount` rows in sequential `pathIndex` order;
- every path contains exactly `horizon + 1` points in sequential `stepIndex`
  order;
- every NAV value is finite and strictly positive;
- every step-zero NAV is exactly literal `1`;
- no path or point is missing, duplicated, reordered, or extra.

An invalid path blocks the entire metric result. A future helper must not drop
that path, reduce the denominator, repair input, substitute a value, or emit a
partial result.

Path input must not be sorted, relabeled, repaired, deduplicated, padded,
truncated, intersected, inferred, or normalized. The helpers must not apply
missing-value interpolation or an average fallback. Those behaviors belong to
an upstream evidence-repair policy and cannot be introduced during risk
calculation.

Top-level prerequisite coherence follows Phase 1D0 and Phase 1E0: semantic
trust, policy, and carried-hash reasons are evaluated only after the required
shape for those comparisons is available. The independently supplied expected
binding is validated separately.

## Source-Provenance Non-Consumption

At path and point level, both future helpers may consume only:

```text
path.pathIndex
point.stepIndex
point.nav
```

They must not read, validate, compare, rank, copy, aggregate, or emit:

```text
drawStepIndex
sourceRowIndex
previousServiceDate
serviceDate
```

Those fields remain upstream historical-sampling provenance. Hash equality is
binding consistency, not provenance revalidation, and no sampled date may be
recast as a future forecast date.

## Terminal Loss Probability Semantics

For each fully validated path, let:

```text
terminalNav = path.points[horizon].nav
```

The path is a terminal-loss path exactly when:

```text
terminalNav < 1
```

The comparison is strict:

- `terminalNav === 1` is not a loss;
- `terminalNav > 1` is not a loss;
- no epsilon, tolerance, rounding, formatting, or near-one bucket is allowed.

Count every loss path once:

```text
lossPathCount = count(path where terminalNav < 1)
```

The probability denominator is the complete validated path count:

```text
lossProbability = lossPathCount / pathCount
```

The arithmetic order above is part of the policy. `lossPathCount` must be a
safe integer in `[0, pathCount]`. `lossProbability` must be finite and in
`[0, 1]`.

The probability is emitted as the unrounded calculation result. It must not
be multiplied by 100, converted to a formatted string, rounded to display
precision, or replaced by a percentile label inside the pure artifact. The
integer numerator and path-count metadata preserve the exact empirical ratio
when binary floating point cannot represent the fraction exactly.

Spaghetti-path selections, quantile bands, path weights, importance weights,
outlier removal, and per-path probabilities are forbidden. Every validated
path contributes exactly one equally weighted terminal observation.

## Terminal Loss Probability Output

A ready result may contain only:

```text
lossStatus: ready
runtimeTrustStatus: not_established
policy: SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY
scenarioId
scenarioVersion
scenarioVectorHash
inputMatrixHash
drawPlanHash
horizon
pathCount
totalPointCount
lossPathCount
lossProbability
blockers: []
```

It must not include terminal NAV samples, raw paths, non-loss counts, quantile
bands, representative paths, dates, KRW values, or any drawdown result.

A blocked result has one exact projection:

```text
lossStatus: blocked
runtimeTrustStatus: not_established
policy: SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY
scenarioId: null
scenarioVersion: null
scenarioVectorHash: null
inputMatrixHash: null
drawPlanHash: null
horizon: 0
pathCount: 0
totalPointCount: 0
lossPathCount: 0
lossProbability: null
blockers:
  - reason
```

Blocked output never reflects caller-supplied scenario, hash, count, path, NAV,
or partial loss values.

## Per-Path Maximum Drawdown Semantics

For each fully validated canonical path, initialize:

```text
runningPeak = 1
maxDrawdown = 0
```

Then visit every point in increasing `stepIndex` order, including step zero:

```text
runningPeak = max(runningPeak, nav)
peakRatio = nav / runningPeak
drawdown = 1 - peakRatio
maxDrawdown = max(maxDrawdown, drawdown)
```

The operation order above is part of the policy. Step zero establishes a
literal peak of `1` and a drawdown of literal `0`.

Every intermediate must satisfy:

```text
runningPeak is finite and > 0
peakRatio is finite and 0 < peakRatio <= 1
drawdown is finite and 0 <= drawdown < 1
maxDrawdown is finite and 0 <= maxDrawdown < 1
```

Positive finite NAV input mathematically implies a drawdown below `1`, but an
extreme floating-point division can underflow to zero. A future helper must
block that artifact as `invalid_drawdown`; it must not clamp, round, replace,
or silently emit `1`.

The sign convention is a nonnegative loss fraction:

- no drawdown is literal `0`;
- a 20% decline is represented as `0.2`;
- negative percentages such as `-0.2` are forbidden;
- no output formatting or multiplication by 100 occurs in the pure artifact.

The result is one maximum value per input path. This gate does not define an
average, median, percentile, expected shortfall, worst-path selection,
portfolio-level maximum across paths, peak index, trough index, duration, or
recovery time.

## Per-Path Maximum Drawdown Output

A ready result may contain only:

```text
drawdownStatus: ready
runtimeTrustStatus: not_established
policy: SIMULATION_PATH_MAX_DRAWDOWN_POLICY
scenarioId
scenarioVersion
scenarioVectorHash
inputMatrixHash
drawPlanHash
horizon
pathCount
totalPointCount
pathDrawdowns:
  - pathIndex
    maxDrawdown
blockers: []
```

`pathDrawdowns` contains exactly `pathCount` rows in canonical ascending
`pathIndex` order:

```text
pathDrawdowns.length === pathCount
```

The output must never contain a truncated prefix, selected subset, reduced
row set, replacement row, or partial path result. It does not contain raw NAV
points, peak or trough values, indices, source dates, terminal-loss flags, or
aggregate statistics.

A blocked result has one exact projection:

```text
drawdownStatus: blocked
runtimeTrustStatus: not_established
policy: SIMULATION_PATH_MAX_DRAWDOWN_POLICY
scenarioId: null
scenarioVersion: null
scenarioVectorHash: null
inputMatrixHash: null
drawPlanHash: null
horizon: 0
pathCount: 0
totalPointCount: 0
pathDrawdowns: []
blockers:
  - reason
```

Blocked output never reflects caller-supplied scenario, hash, count, path, NAV,
or partial drawdown values.

## Shared Output Boundary

Both ready and blocked outputs, nested policies, path results, and blockers
must be deeply immutable.

Neither artifact may include:

- scenario-vector, return-matrix, draw-plan, or gross-growth rows;
- raw paths or source provenance;
- owner, tenant, user, auth, approval-record, database, or provider data;
- initial or terminal KRW values;
- fees, taxes, inflation, cash flow, or transaction costs;
- Phase 1D0 bands or Phase 1E0 selected paths;
- expected value, expected shortfall, percentile risk, confidence labels,
  optimization, targets, recommendations, orders, or rebalance behavior.

## Deterministic Blocker Policies

The future terminal-loss implementation should use this fixed deduplicated
order:

```text
input_nav_not_ready
input_nav_runtime_trust_invalid
input_nav_policy_mismatch
expected_binding_invalid
scenario_vector_hash_mismatch
input_matrix_hash_mismatch
draw_plan_hash_mismatch
input_nav_shape_invalid
input_nav_too_large
invalid_nav
invalid_terminal_loss_count
invalid_terminal_loss_probability
```

The future maximum-drawdown implementation should use this fixed deduplicated
order:

```text
input_nav_not_ready
input_nav_runtime_trust_invalid
input_nav_policy_mismatch
expected_binding_invalid
scenario_vector_hash_mismatch
input_matrix_hash_mismatch
draw_plan_hash_mismatch
input_nav_shape_invalid
input_nav_too_large
invalid_nav
invalid_drawdown
```

Validation returns every safely evaluable applicable reason, deduplicated and
ordered only by the applicable list above. A reason whose prerequisites are
structurally unavailable must not be fabricated. A blocked result has at least
one blocker, and a ready result has none.

Blocker objects contain only the fixed `reason` value. Caller values, field
names, indices, hashes, counts, and raw input fragments must not be reflected.

## Resource Bounds

Both policies inherit the Phase 1C exact input bound:

```text
maxInputNavPoints: 1,000,000
totalInputNavPoints = pathCount * (horizon + 1)

derivedMaxPathDrawdownRows = floor(1,000,000 / (horizon + 1))
pathCount <= derivedMaxPathDrawdownRows <= 500,000
pathDrawdowns.length = pathCount
```

Safe integer arithmetic and the input-point cap must be checked before metric
output allocation. The maximum-drawdown helper must also check the validated
`pathCount` against the derived row bound before allocating `pathDrawdowns`.
Because `horizon >= 1`, the largest possible derived row bound is 500,000 at
`horizon = 1`.

No path subset, denominator reduction, output truncation, output-row
reduction, partial output, or silent fallback is allowed to satisfy the
bound. An input that exceeds the point-derived bound is already classified by
`input_nav_too_large` or `input_nav_shape_invalid`; this amendment introduces
no separate drawdown-output blocker.

Expected direct costs are:

```text
terminal loss:
  time: O(totalInputNavPoints)
  additional metric memory: O(1)

per-path maximum drawdown:
  time: O(totalInputNavPoints)
  additional metric memory: O(pathCount)
```

The all-point traversal is deliberate even for terminal loss because the
shared contract requires complete artifact validation before any metric is
trusted. These complexity statements do not authorize production execution.

## Required Synthetic Fixtures Before Implementation

Shared validation fixtures:

- ready status, empty blockers, runtime trust, exact Phase 1C policy, and
  three-hash binding classification;
- missing, duplicate, reordered, and extra paths or points;
- out-of-order paths remaining blocked without sorting or relabeling;
- invalid and unsafe counts and one-million-point boundary behavior;
- non-finite, zero, negative, and non-literal-one baseline NAV;
- one malformed path blocking the entire artifact;
- identical metric results when only ignored source-provenance fields differ;
- fixed blocker order, deduplication, unavailable-reason nonfabrication, and
  exact blocked null, zero, and empty projections;
- minimized deeply immutable output with no raw paths, dates, owner, approval,
  or provider data;
- no Phase 1D0, Phase 1E0, PRNG, resampling, vector/matrix/draw/growth
  recalculation, file, environment, database, provider, network, route, UI,
  job, write, or persistence dependency.

Terminal-loss fixtures:

- terminal NAV below, exactly equal to, and above literal `1`;
- a representable NAV immediately below `1` remaining a loss without an
  epsilon rule;
- one-path, no-loss, all-loss, and mixed-loss samples;
- the denominator remaining the complete validated `pathCount`;
- exact integer loss count and unrounded division result;
- invalid count or non-finite or out-of-range probability blocking the whole
  result;
- no terminal sample, non-loss count, drawdown, percentile, or formatted
  percentage in output.

Maximum-drawdown fixtures:

- an exact derived-bound artifact with `pathCount=500,000`, `horizon=1`, and
  `totalPointCount=1,000,000`;
- a one-row-over artifact with `pathCount=500,001`, `horizon=1`, and
  `totalPointCount=1,000,002` mapping to `input_nav_too_large` and an empty
  blocked output;
- a ready result containing exactly `pathCount` rows in sequential canonical
  `pathIndex` order with no partial, truncated, selected, or reduced row set;
- a nondecreasing path producing literal `0` rather than negative zero;
- a decline from the step-zero baseline before any new high;
- a new running peak followed by a larger decline;
- recovery after a trough not erasing the earlier maximum;
- multiple paths preserving separate canonical per-path results;
- the exact arithmetic order and nonnegative fraction sign convention;
- `1 -> Number.MAX_VALUE -> Number.MIN_VALUE` whose division underflows to
  zero mapping to `invalid_drawdown` rather than clamping to `1`;
- no aggregate mean, percentile, expected shortfall, peak/trough metadata,
  duration, recovery, or formatted percentage in output.

Fixtures must use synthetic scenario identities, hashes, and NAV paths. They
must not use the approved research vector, production artifacts, or an actual
owner identifier.

## Explicit Non-Scope

This docs-only contract does not add or change:

- TypeScript helpers, policies, types, fixtures, tests, or test registration;
- actual matrix, draw-plan, growth, NAV, summary, path-sample, loss, or
  drawdown execution;
- production vectors, hashes, artifacts, or provider calls;
- runtime repository, approval lookup, session, auth, tenant, ownership, or
  trust establishment;
- database schema, migration, persistence, seed, backfill, or RLS;
- file, environment, network, API, route, page, UI, chart, job, Cron, or write
  behavior;
- initial KRW capital, current-portfolio comparison, wealth scaling, fees,
  taxes, inflation, transaction costs, or cash flow;
- percentile risk summaries, expected shortfall, drawdown aggregation,
  terminal-value distributions, or combined risk artifacts;
- optimizer objectives, candidate weights, target generation,
  recommendation, order, or rebalance behavior.

## Next Gates

This Gate 0 contract authorizes no code. Separate explicit approval is required
for each future pure implementation.

The narrower implementation sequence is:

1. `simulation_terminal_loss_probability_v1` pure helper, policy, types,
   synthetic fixtures, and tests;
2. separate close-out of that implementation;
3. `simulation_path_max_drawdown_v1` pure helper, policy, types, synthetic
   fixtures, and tests under a new approval;
4. separate close-out of that implementation.

Expected shortfall, percentile or aggregate drawdown summaries, runtime
orchestration, production execution, persistence, initial-KRW scaling, chart
composition, product UI, and optimization remain later independent gates.
