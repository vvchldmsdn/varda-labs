# Simulation Per-Path Maximum Drawdown Phase 1F0 Implementation Close-Out

Recorded: 2026-07-12

Status: `docs_only_close_out`

This packet closes the reviewed pure implementation of
`simulation_path_max_drawdown_v1`. It records the approved semantics contract,
resource-bound amendment, pure implementation, shared input-validation
extraction, synthetic verification evidence, and explicit boundaries only.
It is not a runtime trust source, execution instruction, persistence record,
optimizer objective, recommendation, or product approval.

## Reviewed Commit Chain

Phase 1F0 path-risk semantics contract:

```text
dabe8773085e33f32d48bda134aec6c69ae59bf3
```

Maximum-drawdown resource-bound amendment:

```text
5a2d746f4e21145fcba3b0a0dcbe0321c979acf6
```

Pure implementation and shared-validation extraction:

```text
dd968e9ab6fba7211e3f93dfcffd4c296871a892
```

The shared semantics contract retains its docs-only status. This close-out
records that the separately approved pure implementation was reviewed against
the exact contract chain above. No application code reads these commit
identities or this Markdown file as runtime trust evidence.

## Implemented Policy

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

The result describes the maximum observed running-peak decline on every
supplied normalized simulation path. It is not an aggregate risk score,
expected shortfall, percentile summary, KRW loss, forecast guarantee,
recommendation, target, or order.

## Pure Input Boundary

The helper accepts exactly two explicit in-memory inputs:

1. one complete ready `simulation_normalized_nav_v1` result;
2. one expected binding for scenario-vector, input-matrix, and draw-plan
   hashes.

It validates the complete Phase 1C artifact before allocating or calculating
drawdown output, including ready status, empty blockers, unestablished runtime
trust, the exact Phase 1C policy, scenario descriptors, all three hash
bindings, dimensions, counts, canonical path and step order, every finite
positive NAV value, and every literal-one baseline.

An invalid path or point blocks the whole result. The implementation does not
drop, repair, sort, relabel, truncate, select, average, interpolate, or replace
path input. It does not consume a Phase 1D0 quantile summary or Phase 1E0
display subset.

Hash equality establishes binding consistency only. It does not revalidate
source artifacts unavailable to the helper, establish runtime trust, infer
tenant ownership, or authorize production execution.

## Shared Input Validation

The implementation extracts the common risk-input boundary into:

```text
simulation-path-risk-input-policy.ts
simulation-path-risk-input-validation.ts
```

Terminal-loss probability and per-path maximum drawdown share only the input
blocker taxonomy and complete normalized-NAV validation. Their policies,
metric calculations, output types, result projections, and metric-specific
blockers remain separate.

The terminal-loss validation module now delegates to the common input
validator through a narrow wrapper. Its public calculation and output did not
change. The focused terminal-loss regression suite remained fully passing
after extraction.

For the 500,000-path boundary, exact path-key validation avoids allocating and
sorting a new key array for every path. This changes validation mechanics, not
the accepted key set or fail-closed semantics.

## Exact Maximum-Drawdown Calculation

For every fully validated canonical path, the helper initializes:

```text
runningPeak = 1
maxDrawdown = 0
```

It then visits every point from step zero through the terminal step in
increasing canonical order:

```text
runningPeak = max(runningPeak, nav)
peakRatio = nav / runningPeak
drawdown = 1 - peakRatio
maxDrawdown = max(maxDrawdown, drawdown)
```

This single scan is `O(totalInputNavPoints)` time. The returned per-path rows
require `O(pathCount)` output memory. No exact algorithm can avoid reading
every path point while preserving this running-peak definition.

Every intermediate must remain finite and satisfy:

```text
runningPeak > 0
0 < peakRatio <= 1
0 <= drawdown < 1
0 <= maxDrawdown < 1
```

The sign convention is a nonnegative loss fraction. A 20% decline is `0.2`,
not `-0.2`. A path with no decline returns literal positive `0`, never negative
zero.

For extreme positive finite inputs, `nav / runningPeak` can underflow to zero.
The helper blocks the entire artifact with `invalid_drawdown`; it does not
clamp, round, replace, or silently emit `1`.

## Exact Row Cardinality And Resource Boundary

The derived row bound is:

```text
derivedMaxPathDrawdownRows = floor(1,000,000 / (horizon + 1))
pathCount <= derivedMaxPathDrawdownRows <= 500,000
pathDrawdowns.length = pathCount
```

The validated path count and derived row bound are checked before allocating
`pathDrawdowns`. A 500,001-path artifact with horizon one has 1,000,002 input
points and is blocked by the existing `input_nav_too_large` reason before any
drawdown output allocation.

The 500,000-row value is a structural ceiling derived from the pure input
contract. It is not a claim that rendering, serializing, transporting, or
persisting 500,000 rows is safe in a runtime request or product UI. A later
runtime policy may impose a smaller separately versioned request limit.

The pure helper never satisfies a bound by returning a prefix, subset, reduced
row set, replacement row, or partial output.

## Output And Blocked Projection

A ready result contains only:

- the fixed policy and unestablished runtime-trust status;
- scenario id and version;
- scenario-vector, input-matrix, and draw-plan hashes;
- horizon, path count, and total input-point count;
- exactly one immutable `pathIndex` and `maxDrawdown` row per validated path;
- an empty immutable blocker list.

Rows remain in sequential canonical `pathIndex` order. The output excludes raw
NAV points, running peaks, peak ratios, peak or trough indices, durations,
recovery times, source dates, vector rows, matrix rows, owner data, KRW values,
terminal-loss flags, aggregate statistics, percentiles, and optimizer output.

Every blocked result uses one exact projection: scenario and hash metadata is
`null`, counts are zero, `pathDrawdowns` is empty, and only fixed reason values
appear in blockers. A calculation failure after earlier rows were computed
still returns no partial rows.

Ready and blocked outputs, nested policies, path rows, and blocker arrays are
deeply immutable.

## Deterministic Blockers

Applicable reasons are deduplicated in this fixed order:

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

No separate drawdown-output-size blocker exists. The output-row ceiling is
derived from validated input shape and the existing input-point cap. Semantic
reasons whose structural prerequisites are unavailable are not fabricated,
and blocker payloads never reflect caller values.

## Source-Provenance Boundary

At path and point level, the implementation consumes only:

```text
pathIndex
stepIndex
nav
```

It does not read, validate, compare, copy, aggregate, or emit draw-step
indices, source-row indices, previous service dates, or service dates. Those
fields remain upstream historical-sampling provenance and cannot affect the
drawdown result.

## Synthetic Verification

Fixtures use synthetic scenario identities, hashes, and normalized NAV paths
only. They do not use the approved research vector, production hashes,
production NAV artifacts, or actual owner identifiers.

The reviewed fixtures record:

- pinned per-path running-peak maximum drawdowns;
- literal positive zero for a nondecreasing path;
- declines from the step-zero baseline and from a later new peak;
- retention of an earlier maximum decline after recovery;
- `1 -> Number.MAX_VALUE -> Number.MIN_VALUE` underflow rejection;
- no partial output when a later path fails drawdown calculation;
- canonical input order, shape, status, trust, policy, hash, NAV, and baseline
  validation;
- an actual ready artifact with 500,000 distinct input path objects sharing
  one immutable two-point array;
- exactly 500,000 allocated output rows with every sequential path index and
  literal-zero value checked;
- a 500,001-path over-limit input blocked before output allocation;
- fixed blocker order, deduplication, and exact blocked projection;
- source-provenance non-consumption;
- minimized deeply immutable output and no input mutation;
- no database, environment, network, runtime, aggregation, expected-shortfall,
  or optimizer dependency.

Large-fixture wall-clock and heap values are not asserted. The focused run
observed approximately 227 ms for the 500,000-row ready fixture and 46 ms for
the 500,001-row pre-allocation block. Those observations are not performance
guarantees.

## Verification Recorded At Implementation

The pure implementation and shared-validation extraction were closed with:

- focused maximum-drawdown tests: 16 passed;
- focused terminal-loss regression tests: 17 passed;
- full test suite: 566 passed;
- TypeScript check: passed;
- lint: passed;
- production build: passed;
- staged diff and whitespace checks: passed.

The reviewed full suite, TypeScript check, lint, and build were also
independently rerun successfully. These results describe the reviewed
implementation commit. They do not claim that a later repository state has
the same result without rerunning checks.

## No-I/O Boundary

The policy, type, validation, and helper modules do not read Markdown, files,
environment variables, databases, providers, HTTP requests, routes, sessions,
auth state, approval stores, or tenant records. They perform no writes,
persistence, resampling, matrix compilation, draw-plan generation, growth
calculation, NAV materialization, risk aggregation, or orchestration.

## Explicitly Unapproved

This close-out does not approve or implement:

- aggregate or percentile maximum-drawdown summaries;
- terminal-loss magnitude, expected shortfall, tail means, combined risk
  scores, or optimizer objectives;
- production vector, matrix, draw-plan, growth, NAV, loss, or drawdown
  artifacts;
- runtime repository, approval lookup, session, auth, tenant, ownership, or
  trust establishment;
- database, schema, migration, persistence, seed, backfill, provider, file,
  environment, or network I/O;
- initial KRW scaling, current-portfolio comparison, or wealth projection;
- recommendation, target generation, order, rebalance, or hindsight-based
  minimum-drawdown optimization;
- API, route, page, UI, chart, job, Cron, write, ownership, or RLS changes.

## Closure And Next Gate

The pure `simulation_path_max_drawdown_v1` implementation is complete at the
reviewed implementation commit above. No runtime authority, production
execution, persistence, optimization, or product behavior is enabled by this
close-out.

Before any aggregate drawdown or expected-shortfall helper, a separate
docs-only risk-aggregation semantics gate must define the exact random
variable, direction, unit, alpha or quantile probabilities, discrete-tail and
tie treatment, path weighting, output meaning, and separation from terminal
loss, recommendation, and optimization. Runtime orchestration and product
integration remain separate later gates.
