# Simulation Path Maximum Drawdown Distribution Phase 1F1 Implementation Close-Out

Last updated: 2026-07-12

Status: implementation close-out record. This document records the reviewed
docs-only contract, pure implementation, accessor-binding correction, and
synthetic verification. It does not establish runtime trust or enable any
production execution, persistence, route, UI, or optimization behavior.

## Purpose

Phase 1F1 closes one narrow pure-calculation slice:

> Given one complete ready `simulation_path_max_drawdown_v1` artifact and an
> explicit expected binding for its three evidence hashes, summarize the
> complete empirical per-path maximum-drawdown sample with Type 7 p50 and p90.

The implementation preserves the product intent to describe path-level
drawdown risk without carrying forward the legacy `Expected MDD` ambiguity.

## Reviewed Commit Chain

The closed implementation is the exact chain below:

```text
cef92a8b581d0fb1e8243c6229d5519ea351caa1
  Define drawdown distribution summary contract

19b885f580ce58556bde42d8d3f2ecd6176f5647
  Clarify drawdown summary input validation

9dd5d052a1df1d6e33facd7fd899ec80c71a7062
  Pin drawdown summary key semantics

3deaa6700a5eb749955cbc0baa2a5700a173affa
  Add pure drawdown distribution summary

d42723cabeb00ef88dec6255c7354326b91ac0ea
  Harden drawdown summary accessor binding
```

The first three commits define and refine the docs-only contract. `3deaa67`
implements it. `d42723c` closes the reviewed enumerable-accessor binding bug
without changing the statistical policy or widening the approved scope.

Commit hashes are provenance references only. The helper does not read
Markdown, Git state, or approval records at runtime.

## Implemented Policy

The fixed policy is:

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

The policy object and its quantile-probability array are frozen. A synthetic
test pins the exact public policy projection so an undeclared field cannot be
added silently.

The one-million normalized-NAV point ceiling remains an input Phase 1F0
policy constraint. It is consulted directly from
`simulation_path_max_drawdown_v1`; it is not duplicated as a new Phase 1F1
policy field.

## Statistical Meaning

The random variable is one already-calculated `maxDrawdown` value per complete
simulation path. Every path has equal weight and every validated path must be
included.

- `p50` is the median path maximum drawdown;
- `p90` is the adverse 90th-percentile boundary of the supplied empirical
  path sample;
- larger values are worse;
- values remain dimensionless fractions, so `0.20` means 20 percent.

Neither value is an arithmetic expected value. Product code must not label
either result as `Expected MDD`, a confidence level, or a loss probability.

Mean drawdown, p95, worst-path drawdown, confidence scores, and combined risk
scores are not part of this policy.

## Pure Input Boundary

The helper accepts one in-memory wrapper with exactly these own enumerable
string keys:

```text
pathMaxDrawdown
expectedBinding
```

`pathMaxDrawdown` must be one complete ready Phase 1F0 result. Its exact
top-level shape, exact per-path row shape, fixed policy, ready status, empty
blockers, unestablished runtime trust, scenario descriptors, three hashes,
counts, row order, and numeric domain are revalidated.

`expectedBinding` must contain exactly:

```text
expectedScenarioVectorHash
expectedInputMatrixHash
expectedDrawPlanHash
```

All three values must be canonical lowercase `sha256:` strings and match the
three values carried by the Phase 1F0 artifact.

An absent, null, primitive, or array wrapper produces the exact ordered
prerequisite blockers:

```text
input_drawdown_not_ready
expected_binding_invalid
input_drawdown_shape_invalid
```

Malformed artifact and binding prerequisites remain independently
classifiable. No missing trust, policy, hash, row, or numeric fact is invented
after an early artifact-shape failure.

## Enumerable-Key And Accessor Boundary

Shape checks use the own enumerable string keys returned by `Object.keys`,
matching the existing JSON-equivalent Phase 1D0 and Phase 1F0 artifact
boundary.

- extra enumerable string keys are blocked;
- a non-enumerable required key does not satisfy the required shape;
- symbol and non-enumerable extra properties are not read, copied, reflected,
  or emitted;
- input objects are never spread or assigned into output objects.

The initial pure implementation repeatedly read artifact hash fields during
comparison, canonical validation, and validated-output construction. An
enumerable getter could therefore return the expected hash first and another
canonical hash later, creating a ready result whose returned hash did not
match the validated binding.

Commit `d42723c` closes that time-of-check/time-of-use gap:

- wrapper artifact and binding references are guarded one-read values;
- all 13 declared artifact fields are copied once into an internal snapshot;
- all three expected-binding hashes are copied once into a separate snapshot;
- hash comparison, shape validation, and validated output consume only those
  snapshots;
- each row's `pathIndex` and `maxDrawdown` are copied once;
- blockers length, drawdown-row length, and row access are guarded;
- a throwing declared getter becomes the existing deterministic blocked
  projection rather than escaping as an exception.

A mutable getter may supply a valid first value, but validation and output use
that same first snapshot. Later getter values are never consumed.

Proxy-level dynamic object behavior remains outside the JSON-equivalent
plain-data input contract and was not used to widen this correction slice.

## Exact Quantile Calculation

Validation allocates one numeric working array after all count and resource
prerequisites permit it. Each validated path contributes exactly one copied
drawdown value. Only this working array is sorted; the input artifact and row
array are not mutated.

For each fixed probability `p` in `0.50` and `0.90`, the private Phase 1F1
helper applies Hyndman-Fan Type 7:

```text
h = (n - 1) * p
j = floor(h)
g = h - j
k = min(j + 1, n - 1)
Q(p) = x[j] + g * (x[k] - x[j])
```

Duplicates remain duplicate observations. For one path, p50 and p90 both
equal that path's drawdown. An all-zero sample produces literal positive zero,
not negative zero.

Every intermediate and final quantile must remain finite and satisfy:

```text
0 <= p50 <= p90 < 1
```

Any invalid quantile returns the fixed `invalid_quantile` blocked result. No
presentation rounding, clipping, winsorization, path weighting, or selected
display-path fallback occurs.

## All-Path And Resource Boundary

The summary is exact or blocked:

- exactly one row must exist for every declared path;
- rows must remain in sequential canonical `pathIndex` order;
- invalid, missing, duplicate, extra, or reordered rows block the whole
  result;
- no valid subset is summarized after one bad row;
- selected spaghetti paths and fan bands are never accepted as substitutes.

The structural row ceiling is 500,000. A valid 500,000-row synthetic artifact
is fully validated and summarized. A 500,001-row artifact is blocked before
row scan and sort-buffer allocation.

The direct complexity is:

```text
time: O(pathCount * log(pathCount))
additional memory: O(pathCount)
```

Focused runs observed the 500,000-row fixture at approximately 0.42 to 0.52
seconds on the local review environment. This is an observation only, not a
runtime latency guarantee, production limit recommendation, or test timing
assertion.

## Output And Blocked Projection

A ready result contains only:

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

The ready object, policy, quantile array, quantile result, and blocker array
are immutable.

Every blocked result uses one exact minimized projection with null scenario
and hash fields, zero counts, null quantiles, and fixed reason-only blockers.
It never reflects arbitrary input values, field names, indices, hashes, or
partial statistics.

The fixed blocker order is:

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

## Synthetic Verification

The final focused suite contains 26 synthetic tests covering:

- exact policy projection;
- odd, even, and one-path Type 7 values;
- duplicate observations and literal positive zero;
- path-assignment invariance and input immutability;
- exact wrapper, artifact, row, and binding key shapes;
- malformed prerequisite precedence;
- symbol and non-enumerable property non-consumption;
- non-enumerable required-field rejection;
- one-read mutable artifact hash binding;
- one-read mutable expected-binding hash comparison;
- throwing artifact and binding getter fail-close behavior;
- one-read `maxDrawdown` row values;
- status, trust, policy, and hash classification;
- row order, cardinality, and count drift;
- negative zero, negative, one, NaN, and infinite drawdowns;
- no valid-subset fallback;
- 500,000-row ready and 500,001-row blocked boundaries;
- deterministic blockers, exact projections, deep freeze, and no-I/O source
  audit.

Fixtures use synthetic identities, hashes, and drawdown values only. They do
not use the approved research vector, a production artifact, owner identity,
or legacy simulation result.

## Verification Recorded At Implementation

The initial implementation commit recorded:

```text
focused tests: 22 / 22
full suite: 588 / 588
npx tsc --noEmit: passed
npm run lint: passed
npm run build: passed
```

After the accessor-binding correction, the final reviewed state recorded:

```text
focused tests: 26 / 26
full suite: 592 / 592
npx tsc --noEmit: passed
npm run lint: passed
npm run build: passed
staged diff and whitespace checks: passed
```

These results describe commits through `d42723c`. Adding this docs-only
close-out record does not claim a new code execution or a production runtime
verification.

## No-I/O Boundary

The Phase 1F1 policy, types, validation, and helper modules do not access:

- files, environment variables, or network providers;
- database clients, repositories, schemas, or migrations;
- Next.js routes, pages, server actions, or UI components;
- runtime sessions, tenant lookup, auth providers, jobs, or Cron;
- production vectors, matrices, draw plans, NAV artifacts, or approvals.

The helper is an in-memory deterministic calculation only.

## Explicitly Unapproved

This close-out does not approve or enable:

- production simulation execution or runtime trust;
- a runtime scenario-vector resolver or server-owned approval repository;
- session-to-`TenantContext` resolution or owner-scoped lookup;
- database schema, migration, persistence, seed, or backfill;
- provider, file, environment, or network I/O;
- API, route, page, UI, fan chart, job, Cron, or write behavior;
- mean MDD, p95, worst-path MDD, expected shortfall, CVaR, terminal-loss
  magnitude, confidence score, or combined risk score;
- optimizer, target generation, recommendation, order, or rebalance behavior;
- legacy `expected_mdd_pct` or `cvar_5pct` import or rebinding.

## Closure And Next Gate

`simulation_path_max_drawdown_distribution_summary_v1` is closed as a pure,
synthetic-only implementation with `runtimeTrustStatus=not_established`.

The next appropriate slice is not expected shortfall. A separately approved
docs-only **Simulation Runtime Execution Readiness Gate 0** may record the
still-missing prerequisites:

- verified session-to-`TenantContext` resolution;
- server-owned approved-vector source;
- owner-scoped approval lookup;
- production orchestration boundaries;
- exact production artifact binding and execution trust.

That readiness gate must only classify and document missing states. It must
not implement auth adapters, repositories, execution, persistence, routes,
UI, jobs, or writes.
