# Simulation Deterministic Spaghetti Path Sampling Phase 1E0 Contract

Last updated: 2026-07-12

Status: docs-only contract. No helper, type, fixture, test, production
execution, runtime trust, repository, persistence, route, UI, chart, or
optimization behavior is enabled by this phase.

## Purpose

Phase 1E0 answers one narrow pure-selection question:

> Given one complete `simulation_normalized_nav_v1` result, its explicit
> expected three-hash binding, and a caller-selected path count, which complete
> normalized NAV paths form a deterministic bounded subset for later
> spaghetti-chart presentation?

This phase defines a path-subset artifact only. It does not render a chart,
select percentile representatives, calculate distribution bands, scale NAV
into KRW, rerun stochastic sampling, or optimize portfolio weights.

## Versioned Policy

The proposed policy is:

```text
policy.version: simulation_spaghetti_path_sample_v1
policy.inputNavVersion: simulation_normalized_nav_v1
selectionAlgorithm: canonical_index_even_spacing_v1
sampleCountSource: caller_explicit
sampleCountBehavior: exact_or_block
pathTreatment: validate_all_then_select
pointTreatment: complete_selected_paths
runtimeTrustStatus: not_established
maxInputNavPoints: 1,000,000
maxSelectedPaths: 64
maxOutputPoints: 16,384
outputKind: dimensionless_deterministic_nav_path_subset
```

The input NAV policy's `distributionSummary=forbidden` field means that Phase
1C does not embed or calculate a distribution summary. It does not prevent a
separately versioned downstream pure phase from selecting complete paths from
a valid Phase 1C artifact under a new contract.

This docs-only contract proposes the Phase 1E0 policy and exact selection
rules. It does not approve an implementation or execution.

## Statistical Meaning

The selected paths are a deterministic display subset of the supplied paths.
They are not:

- p10, p50, or p90 representative paths;
- a random sample or probability-weighted sample;
- the best, worst, median, most likely, or most typical paths;
- a calibrated confidence interval or forecast;
- an expected-value estimate;
- a recommendation, target, or order instruction.

Canonical path indices originate in the already supplied draw execution. Even
spacing those indices provides reproducible bounded visual coverage only. It
does not rank terminal outcomes or claim statistical representativeness.

Changing `sampleCount` defines a different exact request and may select a
different subset. This policy does not promise prefix stability between two
different sample-count requests.

## Pure Input Boundary

A future helper may accept only three explicit in-memory inputs.

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

The complete Phase 1C policy object must match exactly. Phase 1E0 does not
receive or recalculate the scenario vector, return matrix, draw plan,
gross-growth factors, portfolio aggregation, or normalized NAV formula.

### 2. Expected path-sample binding

One caller-supplied in-memory object containing:

```text
expectedScenarioVectorHash
expectedInputMatrixHash
expectedDrawPlanHash
```

All values must use canonical lowercase `sha256:` form and exactly equal the
corresponding ready NAV fields. Equality establishes binding consistency only.
It does not revalidate unavailable source artifacts, establish runtime trust,
or infer tenant ownership.

### 3. Explicit sample count

`sampleCount` must be supplied by the caller as a positive safe integer. The
helper must not default, clamp, round, coerce, infer, or replace it.

The exact request is blocked when any of these conditions applies:

```text
sampleCount > pathCount
sampleCount > 64
sampleCount * (horizon + 1) > 16,384
```

The output-point product must use safe integer arithmetic. A rejected request
must not be silently reduced to a smaller path count.

## Full Input Validation Before Selection

The future helper must validate the complete summary-relevant Phase 1C shape
before selecting any path:

- status is `ready`, blockers are empty, and runtime trust remains
  `not_established`;
- the complete Phase 1C policy object matches `simulation_normalized_nav_v1`;
- scenario id and version are valid nonempty canonical descriptors;
- all three hashes are canonical and match the expected binding;
- horizon and path count are positive safe integers;
- total point and NAV-cell counts equal `pathCount * (horizon + 1)`;
- the total input point count does not exceed 1,000,000;
- paths contain exactly `pathCount` rows in sequential `pathIndex` order;
- every path contains exactly `horizon + 1` points in sequential `stepIndex`
  order;
- every NAV value is finite and strictly positive;
- every step-zero NAV is literal `1`;
- no point, path, or step is missing, duplicated, reordered, or extra.

An invalid unselected path blocks the entire result. The helper must not use
selection to hide malformed paths, drop a bad path, or replace it with another
index.

Top-level prerequisites follow the same coherence rule as Phase 1D0: semantic
trust, policy, and hash reasons are evaluated only after the required shape
needed for those comparisons exists. Independently validatable expected
binding and sample-count checks remain separate.

Path input must not be sorted, relabeled, repaired, deduplicated, padded,
truncated, intersected, or normalized.

## Exact Selection Algorithm

Let:

```text
P = pathCount
S = sampleCount
```

After validation, `1 <= S <= P`.

For one selected path:

```text
S = 1
selectedIndex[0] = floor((P - 1) / 2)
```

This is the lower middle canonical index when `P` is even.

For more than one selected path:

```text
S > 1
selectedIndex[i] = floor(i * (P - 1) / (S - 1))
i = 0, 1, ..., S - 1
```

The arithmetic order above is part of the proposed policy. With `2 <= S <= P`
it produces strictly increasing unique indices, including `0` and `P - 1`.
Every integer operand and numerator must remain a safe integer, the quotient
must remain finite, and every selected index must be a safe integer.

The helper must not call `Math.random`, a PRNG, a resampler, or a hash-based
random selector. It must not sort by terminal NAV, percentile proximity,
draw provenance, date, return, loss, drawdown, or any other path metric.

Each selected path is copied in ascending selected-index order. Every point of
that path is retained in canonical step order. A path must never be shortened
to satisfy the output-point cap.

## Source-Provenance Non-Consumption

At path and point level, Phase 1E0 may consume only:

```text
path.pathIndex
point.stepIndex
point.nav
```

It must not read, validate, compare, rank, copy, aggregate, or emit:

```text
drawStepIndex
sourceRowIndex
previousServiceDate
serviceDate
```

Those fields remain upstream historical-sampling provenance. They are not
future forecast dates and must not influence which paths are selected.

## Output Boundary

A ready result may contain only:

```text
sampleStatus: ready
runtimeTrustStatus: not_established
policy
scenarioId
scenarioVersion
scenarioVectorHash
inputMatrixHash
drawPlanHash
horizon
inputPathCount
selectedPathCount
totalInputPointCount
totalOutputPointCount
selectedPaths:
  - pathIndex
    points:
      - stepIndex
        nav
blockers: []
```

For a ready result:

```text
selectedPathCount = sampleCount
totalOutputPointCount = sampleCount * (horizon + 1)
```

NAV values remain dimensionless and are copied without presentation rounding,
formatting, clipping, interpolation, or recalculation.

The output must not include:

- unselected paths or individual path probabilities;
- draw indices, source-row indices, or source dates;
- scenario-vector rows, matrix rows, draw-plan rows, or growth factors;
- distribution bands, percentile labels, terminal ranking, or representative
  path labels;
- owner, tenant, user, auth, approval-record, database, or provider data;
- initial or terminal KRW values;
- mean, variance, loss probability, drawdown, expected shortfall,
  optimization, target, recommendation, or order data.

A blocked result has one exact projection regardless of validation stage:

```text
sampleStatus: blocked
runtimeTrustStatus: not_established
policy: SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY
scenarioId: null
scenarioVersion: null
scenarioVectorHash: null
inputMatrixHash: null
drawPlanHash: null
horizon: 0
inputPathCount: 0
selectedPathCount: 0
totalInputPointCount: 0
totalOutputPointCount: 0
selectedPaths: []
blockers:
  - reason
```

Blocked output never reflects caller-supplied scenario, hash, count, path,
sample-count, or NAV values. It must never return a partial selected path.

All ready and blocked outputs, policies, paths, points, and blockers must be
deeply immutable.

## Deterministic Blocker Policy

The future implementation should use this fixed deduplicated blocker order:

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
sample_count_invalid
sample_count_exceeds_path_count
sample_count_exceeds_limit
sample_output_too_large
invalid_selection
```

Definitions specific to Phase 1E0 are:

- `input_nav_too_large`: safely calculated full input point count greater than
  1,000,000;
- `invalid_nav`: a non-finite, zero, negative, or non-literal-one baseline NAV;
- `sample_count_invalid`: not a positive safe integer;
- `sample_count_exceeds_path_count`: valid count greater than input path count;
- `sample_count_exceeds_limit`: valid count greater than 64;
- `sample_output_too_large`: safely evaluable output count greater than 16,384
  or not representable as a safe integer;
- `invalid_selection`: safely validated prerequisites nevertheless produce an
  out-of-range, duplicate, nonascending, noninteger, or wrong-count selection.

Validation returns every safely evaluable applicable reason, deduplicated and
ordered only by the list above. A reason whose prerequisites are structurally
unavailable must not be fabricated. A blocked result has at least one blocker,
and a ready result has none.

Blocker objects contain only the fixed `reason` value. Caller values, field
names, indices, hashes, counts, and raw input fragments must not be reflected.

## Resource Bounds

The policy has two independent output bounds:

```text
maxSelectedPaths: 64
maxOutputPoints: 16,384
```

The full input remains subject to the Phase 1C cap:

```text
maxInputNavPoints: 1,000,000
```

All bounds are exact-or-block. They are engineering limits, not defaults or
recommendations for a product chart.

The direct selection and copy cost is expected to be:

```text
time: O(input validation points + selected output points)
additional memory: O(selected output points)
```

This complexity statement does not authorize production execution.

## Relationship To The Distribution Summary

Phase 1E0 does not consume the Phase 1D0 p10/p50/p90 summary. Both artifacts
independently consume the same ready normalized NAV artifact and expected
three-hash binding.

A later composition layer may display a path subset and percentile bands
together only after separately validating their scenario identity, all three
hashes, horizon, and input path count. That composition behavior and its UI are
not approved by this contract.

## Required Synthetic Fixtures Before Implementation

- `sampleCount=1` with odd and even path counts, pinning the lower-middle rule;
- `sampleCount>1` with pinned uneven-spacing results;
- exact inclusion of path indices `0` and `P - 1` when `sampleCount>1`;
- strictly ascending unique indices for representative valid `P` and `S`;
- `sampleCount=pathCount` selecting every canonical path exactly once;
- no mutation, sorting, relabeling, or repair of input paths;
- complete point copying for selected paths with no rounding or truncation;
- an invalid unselected path blocking the entire artifact;
- zero, negative, fractional, non-finite, unsafe, over-path-count, and
  over-64 sample-count rejection;
- exact 16,384-output-point boundary and one-point-over rejection;
- one-million-input-point boundary and over-limit rejection;
- ready status, input blocker, runtime trust, Phase 1C policy, shape, hash,
  count, baseline, and NAV mismatch classification;
- fixed blocker order, deduplication, unavailable-reason nonfabrication, and
  exact blocked null/zero projection;
- identical selections and outputs when only ignored point provenance differs;
- minimized deeply immutable output with no raw unselected paths, dates,
  vector, owner, approval, or provider data;
- source audit proving no `Math.random`, PRNG, resampling, distribution summary,
  file, environment, database, provider, network, route, UI, job, write, or
  persistence dependency.

Fixtures must use synthetic scenario identities, hashes, and NAV paths. They
must not use the approved research vector, production artifacts, or an actual
owner identifier.

## Explicit Non-Scope

This docs-only contract does not add or change:

- TypeScript helpers, types, fixtures, or tests;
- actual matrix, draw-plan, growth, NAV, summary, or path-sample execution;
- production vectors, hashes, artifacts, or provider calls;
- runtime repository, session, auth, tenant, trust, or approval lookup;
- database schema, migration, persistence, seed, backfill, ownership, or RLS;
- file, environment, network, API, route, page, UI, chart, job, Cron, or write
  behavior;
- initial KRW capital, current-portfolio comparison, or wealth scaling;
- percentile-path selection, probability weighting, loss probability,
  drawdown, expected shortfall, optimizer, target generation, recommendation,
  order, or rebalance behavior.

## Next Gate

Only a separate explicit approval may authorize a pure helper, types, tests,
and synthetic fixtures implementing this contract. That implementation must
remain in memory, preserve `runtimeTrustStatus=not_established`, and use no
production artifact or I/O.

Actual simulation orchestration, runtime trust, persistence, distribution and
path-sample composition, initial-KRW scaling, chart rendering, product UI,
drawdown or loss metrics, and optimization remain later independent gates.
