# Simulation Path Maximum Drawdown Distribution Phase 1F1 Gate 0 Contract

Last updated: 2026-07-12

Status: docs-only contract. No helper, type, fixture, test, production
execution, runtime trust, repository, persistence, route, UI, chart, risk
score, recommendation, or optimization behavior is enabled by this phase.

## Purpose

Phase 1F1 answers one narrow pure-calculation question:

> Given one complete `simulation_path_max_drawdown_v1` result and an explicit
> expected binding for its three evidence hashes, what are the empirical
> median and 90th-percentile values of the complete per-path maximum-drawdown
> sample?

This phase defines a constant-size summary artifact only. It does not
recalculate drawdown from normalized NAV paths, estimate expected shortfall,
select display paths, combine risk metrics, or optimize portfolio weights.

## Relationship To Existing Simulation Artifacts

The direct input is the complete ready result from
`simulation_path_max_drawdown_v1`, not:

- a normalized-NAV fan-band summary;
- terminal NAV values;
- selected spaghetti paths;
- legacy `expected_mdd_pct` or `cvar_5pct` fields;
- a partial or reconstructed path sample.

Maximum drawdown is path-order dependent. A drawdown distribution therefore
cannot be reconstructed from per-step NAV quantile bands. Quantile and maximum
operations do not commute.

Phase 1F1 reuses the Type 7 quantile convention established by Phase 1D0, but
it summarizes a different random variable: one already-calculated maximum
drawdown per complete simulation path.

## Versioned Policy

The proposed policy is:

```text
policy.version: simulation_path_max_drawdown_distribution_summary_v1
policy.inputDrawdownVersion: simulation_path_max_drawdown_v1
quantileAlgorithm: hyndman_fan_type_7_v1
quantileProbabilities: [0.50, 0.90]
pathTreatment: all_paths_or_block
pathWeighting: equal
drawdownDirection: larger_is_worse
drawdownUnit: dimensionless_loss_fraction
runtimeTrustStatus: not_established
maxInputPathDrawdownRows: 500,000
outputKind: dimensionless_empirical_max_drawdown_quantile_summary
```

This docs-only contract proposes the Phase 1F1 version and exact calculation
rules. It does not approve an implementation or execution.

## Why P50 And P90

The policy intentionally exposes only two statistics:

- `p50` is the median per-path maximum drawdown and describes a typical
  supplied path;
- `p90` is an adverse empirical boundary: approximately 90 percent of the
  supplied paths have maximum drawdown at or below it, subject to the Type 7
  interpolation rule.

Neither value is an expected value. Product copy must not label `p50` or
`p90` as "Expected MDD".

Mean drawdown, p95, worst-path drawdown, confidence scores, and combined risk
scores are deliberately excluded. P90 gives one restrained adverse-path view
without adding a second nearby tail percentile whose interpretation depends
more heavily on path count. A later separately versioned contract may add
another statistic only with an explicit product use and sample-adequacy rule.

## Statistical Meaning

The output is an empirical summary over the exact supplied set of per-path
maximum drawdowns. It is conditional on the scenario vector, return matrix,
draw plan, horizon, path count, portfolio-path policy, and normalized NAV
artifact that produced the input.

The output is not:

- a guaranteed future loss;
- a calibrated forecast confidence interval;
- a probability that the portfolio will lose money;
- an expected-shortfall or conditional-tail-mean statistic;
- an estimate derived from selected display paths;
- an investment recommendation, target, or order instruction.

The values remain dimensionless loss fractions. For example, `0.20` means a
20 percent maximum peak-to-trough loss, not 0.20 KRW and not a preformatted
percentage string.

## Pure Input Boundary

The future helper may accept one in-memory wrapper object with exactly these
two own enumerable string keys:

```text
pathMaxDrawdown
expectedBinding
```

An extra own enumerable string key is `input_drawdown_shape_invalid`. A
missing wrapper key is classified through the corresponding artifact or
binding rule below. The wrapper is a transport boundary only and must not
carry owner, approval, runtime, database, or provider context.

If the wrapper itself is absent, null, an array, a primitive, or otherwise not
a record, both declared inputs are treated as absent and the exact ordered
blockers are:

```text
input_drawdown_not_ready
expected_binding_invalid
input_drawdown_shape_invalid
```

### 1. Ready per-path maximum-drawdown artifact

One complete `SimulationPathMaxDrawdownResult` with:

```text
drawdownStatus: ready
runtimeTrustStatus: not_established
policy.version: simulation_path_max_drawdown_v1
blockers: []
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
```

The artifact must be a non-array record with exactly these top-level own
enumerable string keys:

```text
drawdownStatus
runtimeTrustStatus
policy
scenarioId
scenarioVersion
scenarioVectorHash
inputMatrixHash
drawPlanHash
horizon
pathCount
totalPointCount
pathDrawdowns
blockers
```

Every `pathDrawdowns` row must be a non-array record with exactly these own
enumerable string keys:

```text
pathIndex
maxDrawdown
```

Extra top-level or row enumerable string keys are not ignored. They make the
artifact `input_drawdown_shape_invalid` even when every required field is
otherwise valid.

The complete Phase 1F0 maximum-drawdown policy object must match exactly,
including its running-peak algorithm, step-zero treatment, numeric domain,
path cardinality, and resource limits.

Phase 1F1 consumes only the materialized per-path maximum-drawdown rows. It
does not receive or recalculate normalized NAV paths, scenario weights,
return-matrix rows, draw-plan rows, or gross-growth factors.

### 2. Expected summary binding

One caller-supplied in-memory object containing:

```text
expectedScenarioVectorHash
expectedInputMatrixHash
expectedDrawPlanHash
```

The binding must be a non-array record with exactly those three own enumerable
string keys. A missing key, extra enumerable string key, non-string value, or
noncanonical hash makes it `expected_binding_invalid`. No hash-mismatch reason
may be evaluated from an invalid binding.

All three values must use canonical lowercase `sha256:` form and exactly equal
the corresponding fields carried by the ready drawdown artifact.

The expected binding prevents accidental aggregation of an artifact from a
different vector, matrix, or draw execution. Equality proves binding
consistency only. It does not establish runtime authorization, tenant
ownership, source-evidence validity, or production readiness.

## Structural Validation

The future helper must revalidate the complete summary-relevant input shape
rather than trusting TypeScript types alone:

- status is `ready`, blockers are empty, and runtime trust remains
  `not_established`;
- the complete Phase 1F0 policy matches
  `simulation_path_max_drawdown_v1` exactly;
- scenario id and version are valid nonempty canonical descriptors;
- all three carried hashes are canonical and match the expected binding;
- horizon and path count are positive safe integers;
- total point count equals `pathCount * (horizon + 1)` using safe integer
  arithmetic and does not exceed 1,000,000;
- path count does not exceed 500,000;
- `pathDrawdowns` contains exactly `pathCount` rows in sequential
  `pathIndex` order;
- every `maxDrawdown` is finite, nonnegative, and strictly less than `1`;
- zero drawdown is literal positive zero, not negative zero;
- no path row is missing, duplicated, reordered, relabeled, or extra.

For wrapper, artifact, row, and binding shape checks, "exact keys" means the
own enumerable string keys returned by `Object.keys`. This matches the
JSON-equivalent plain-data artifact boundary used by the existing Phase 1D0
and Phase 1F0 validators.

Symbol properties and non-enumerable properties are outside the contract.
They do not satisfy a required key, and extra hidden properties are ignored.
The helper must not read, validate, compare, copy, reflect, or emit them. This
is a non-consumption rule, not an alternate metadata channel.

Status classification is explicit:

- `drawdownStatus` other than `ready` or a nonempty input blocker list adds
  `input_drawdown_not_ready`;
- top-level `runtimeTrustStatus` other than `not_established` adds
  `input_drawdown_runtime_trust_invalid`;
- drift in the separate Phase 1F0 policy object adds
  `input_drawdown_policy_mismatch`.

An out-of-order row array or a row whose `pathIndex` does not equal its
canonical array position is `input_drawdown_shape_invalid`. Phase 1F1 must not
sort, relabel, drop, or repair input rows. Numeric sorting is allowed only on
a separate temporary array containing the already-validated drawdown values.

Any malformed status, policy, identity, hash, count, row, or drawdown value
blocks the whole result. The helper must not remove a bad path and summarize
the remaining paths.

### Malformed prerequisite classification

Binding validation is independent and occurs before an early return caused by
a malformed drawdown artifact.

If the wrapper is a record but `pathMaxDrawdown` is absent, null, an array, a
primitive, or otherwise not a record, the exact safely established artifact
reasons are:

```text
input_drawdown_not_ready
input_drawdown_shape_invalid
```

If the artifact is a record but lacks any required top-level own key, the same
two reasons apply. Validation then stops for that artifact. It must not
fabricate runtime-trust, policy, hash-mismatch, count, row, or drawdown-value
reasons from unavailable prerequisites.

An independently malformed or missing `expectedBinding` additionally yields:

```text
expected_binding_invalid
```

Therefore a missing artifact and missing binding produce exactly these
ordered reasons:

```text
input_drawdown_not_ready
expected_binding_invalid
input_drawdown_shape_invalid
```

If all required artifact keys exist, safely evaluable status, trust, policy,
hash, count, and row checks proceed independently. An extra artifact or row
key adds `input_drawdown_shape_invalid`; it does not suppress other reasons
that are safely established from present prerequisites.

If the expected binding is structurally valid, each carried artifact hash is
compared independently. A missing or malformed carried hash is a safely
established mismatch for that hash only after the artifact has passed the
required-key prerequisite. If the binding is invalid, no carried-hash mismatch
is fabricated.

## Source-Provenance Non-Consumption

Phase 1F1 must not read or infer:

- source service dates or sampled draw indices;
- individual normalized NAV points;
- return-matrix or FX observations;
- scenario-vector rows or approval records;
- owner, user, tenant, auth, database, or provider metadata.

The three carried hashes are opaque binding identifiers. Phase 1F1 compares
them for exact equality but cannot use them to revalidate omitted evidence.

## Exact Quantile Algorithm

Copy exactly one validated `maxDrawdown` value from every input row into one
temporary numeric array. Retain duplicates and sort the copy in ascending
order:

```text
x[0] <= x[1] <= ... <= x[n - 1]
n = pathCount
```

Every path contributes one equally weighted observation. No path
probabilities, importance weights, quality weights, regime weights, or display
selection may be introduced.

For each fixed probability `p` in `0.50` and `0.90`, apply Hyndman-Fan Type 7
exactly:

```text
h = (n - 1) * p
j = floor(h)
g = h - j
k = min(j + 1, n - 1)
Q(p) = x[j] + g * (x[k] - x[j])
```

The arithmetic order above is part of the policy. Every intermediate and
final value must remain finite. Every final value must be nonnegative and
strictly less than `1`.

No presentation rounding, clipping, winsorizing, outlier removal, alternate
quantile definition, interpolation across paths before sorting, or conversion
to percentage points is allowed. If a calculated quantile equals zero, the
stored numeric result must be normalized to literal positive zero.

For `n=1`, both quantiles equal the one supplied drawdown. Duplicate values
remain duplicate observations.

The input arrays and rows must not be mutated.

## Quantile Invariants

Every ready result must satisfy:

```text
0 <= p50 <= p90 < 1
```

These fields describe the distribution of per-path maximum drawdown. They do
not describe the maximum drawdown of the p50 or p90 NAV fan line, and they
must not be recomputed from fan bands.

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
maxDrawdownQuantiles:
  p50
  p90
blockers: []
```

The result must not include:

- individual path rows or normalized NAV paths;
- raw terminal values, fan bands, or selected spaghetti paths;
- scenario weights, matrix rows, draw indices, dates, or FX rows;
- initial or terminal KRW values;
- mean, p95, worst path, loss probability, expected shortfall, CVaR,
  confidence label, combined score, or optimization result;
- legacy field names such as `expected_mdd_pct` or `cvar_5pct`;
- owner, tenant, user, auth, approval-record, database, or provider data.

A blocked result has one exact projection regardless of which validation
stage failed:

```text
summaryStatus: blocked
runtimeTrustStatus: not_established
policy: SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY
scenarioId: null
scenarioVersion: null
scenarioVectorHash: null
inputMatrixHash: null
drawPlanHash: null
horizon: 0
pathCount: 0
totalPointCount: 0
maxDrawdownQuantiles: null
blockers:
  - reason
```

Blocked output never reflects caller-supplied scenario, hash, count, path, or
drawdown values, even if some fields passed earlier validation. It must never
return partial quantiles.

All ready and blocked outputs, nested quantiles, policy, and blockers must be
immutable.

## Deterministic Blocker Policy

The future implementation should use a fixed deduplicated blocker order:

```text
input_drawdown_not_ready
input_drawdown_runtime_trust_invalid
input_drawdown_policy_mismatch
expected_binding_invalid
scenario_vector_hash_mismatch
input_matrix_hash_mismatch
draw_plan_hash_mismatch
input_drawdown_shape_invalid
input_drawdown_too_large
invalid_drawdown
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

Phase 1F1 accepts no artifact larger than the Phase 1F0 structural ceiling:

```text
maxInputPathDrawdownRows: 500,000
inputPathDrawdownRows = pathDrawdowns.length = pathCount
outputQuantileCount: 2
```

Safe count and cap checks must complete before allocating the numeric sort
buffer. The future helper may allocate one copied array of `pathCount` numeric
drawdowns and one constant-size output object. It must not retain multiple
sorted copies or materialize normalized NAV input.

The direct calculation cost is expected to be:

```text
time: O(pathCount * log(pathCount))
additional memory: O(pathCount)
```

This is the simplest exact deterministic implementation for the pinned Type 7
contract at the current structural cap. This complexity statement does not
authorize production execution or establish a production request limit.

## Required Synthetic Fixtures Before Implementation

- one-path Type 7 behavior;
- odd and even path counts with pinned p50 and p90 values;
- duplicate values retained in the empirical sample;
- all-zero drawdowns producing literal positive-zero quantiles;
- known mixed drawdowns satisfying `0 <= p50 <= p90 < 1`;
- values reassigned among canonical path indices producing the same summary,
  without mutating either input;
- out-of-order rows and mismatched `pathIndex` values remaining blocked
  without sorting or relabeling input;
- a missing, duplicate, or extra row blocking the entire result;
- exact wrapper, artifact, row, and expected-binding own enumerable string-key
  sets;
- a null, primitive, or array wrapper producing exactly the three ordered
  prerequisite reasons;
- an extra enumerable string key on the wrapper, artifact, or row mapping to
  `input_drawdown_shape_invalid`;
- an extra or missing enumerable string expected-binding key mapping to exactly
  `expected_binding_invalid` when the artifact is otherwise valid;
- ignored symbol and non-enumerable extra properties proving they are not
  consumed, copied, reflected, or emitted;
- a non-record or required-key-missing artifact producing exactly
  `input_drawdown_not_ready` and `input_drawdown_shape_invalid` when the
  binding is valid;
- a missing artifact and missing binding producing exactly the three ordered
  prerequisite reasons without fabricated trust, policy, or hash mismatch;
- ready-status or nonempty input blockers mapping to
  `input_drawdown_not_ready`;
- top-level runtime-trust mismatch mapping to exactly
  `input_drawdown_runtime_trust_invalid` when every other field is valid;
- Phase 1F0 policy and three-hash binding mismatches remaining separately
  classified;
- invalid counts and unsafe count multiplication;
- negative zero, negative, `1`, positive infinity, negative infinity, and NaN
  drawdowns;
- no path exclusion after one invalid drawdown;
- non-finite quantile intermediate or result mapping to
  `invalid_quantile`;
- 500,000-row exact boundary and 500,001-row pre-allocation rejection;
- minimized immutable output with no path rows, dates, owner, legacy metric,
  or approval data;
- no selected-path, fan-band, PRNG, resampling, NAV recalculation, file, env,
  database, provider, network, route, UI, job, write, or persistence
  dependency.

Fixtures must use synthetic scenario identities, hashes, and drawdown values.
They must not use the approved research vector, production artifacts, actual
owner identifiers, or values copied from the legacy simulation result.

## Explicit Non-Scope

This docs-only contract does not add or change:

- TypeScript helpers, types, fixtures, tests, or shared quantile refactors;
- actual matrix, draw, gross-growth, NAV, path-drawdown, or summary execution;
- runtime Scenario Vector Resolver, repository, session adapter, or approval
  lookup;
- database schema, migration, persistence, seed, backfill, provider, auth,
  ownership, or RLS behavior;
- mean MDD, p95, worst-path MDD, terminal-loss magnitude, expected shortfall,
  CVaR, drawdown duration, recovery time, or combined risk score;
- initial capital, current-portfolio comparison, KRW wealth, contribution, or
  cash-flow behavior;
- fan chart, spaghetti-path selection, optimizer, target generation,
  recommendation, order, or rebalance behavior;
- API, route, page, UI, chart, job, Cron, or write behavior.

## Legacy Migration Boundary

The legacy product intent to show drawdown risk is preserved. Its stored field
meaning is not.

Legacy `expected_mdd_pct` values must not be imported or rebound to this
summary because existing engines used that name for different statistics,
including a mean and a median. Legacy `cvar_5pct` values also remain outside
this contract because their loss variable, sign, and tail-count conventions
were inconsistent.

Any future UI must use explicit labels such as "median path maximum drawdown"
and "90th-percentile path maximum drawdown". Product-language approval is a
separate UI gate.

## Next Gate

Only a separate explicit approval may authorize a pure helper, types, tests,
and synthetic fixtures implementing this contract. That implementation must
remain in-memory, consume only a complete ready Phase 1F0 drawdown artifact,
preserve `runtimeTrustStatus=not_established`, and perform no actual simulation
execution, repository lookup, persistence, route, UI, job, or write work.

Expected shortfall must remain a later independent contract that first fixes
its loss random variable, sign, alpha, discrete tail count, threshold-tie
treatment, and output unit. Runtime orchestration, product integration, and
optimization remain separate gates.
