# Simulation Deterministic Spaghetti Path Sampling Phase 1E0 Implementation Close-Out

Recorded: 2026-07-12

Status: `docs_only_close_out`

This packet closes the reviewed pure implementation of
`simulation_spaghetti_path_sample_v1`. It records the approved contract,
pure implementation, synthetic verification evidence, the valid one-million
input-point boundary correction, and explicit boundaries only. It is not a
runtime trust source, execution instruction, persistence record, chart
approval, or product approval.

## Reviewed Commit Chain

Phase 1E0 contract:

```text
0ee2fc1044938b24a9b36a17fe3add6e6def57db
```

Pure implementation:

```text
d14bda5a1dcd535c94826581ed372c738cf0ccd3
```

Valid input-cap regression correction:

```text
18e8cdba6790da7867d808f56a97ffc89792e429
```

The contract document retains its docs-only status. This close-out records
that the separately approved pure implementation and test correction were
reviewed against that contract. No application code reads these commit
identities or this Markdown file as runtime trust evidence.

## Implemented Policy

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

The result is a deterministic bounded display subset of supplied normalized
NAV paths. It is not a random sample, percentile representative, confidence
interval, forecast, expected-value estimate, KRW wealth path, target, or
investment recommendation.

## Pure Input Boundary

The helper accepts exactly three explicit in-memory inputs:

1. one complete ready `simulation_normalized_nav_v1` result;
2. one expected binding for scenario-vector, input-matrix, and draw-plan
   hashes;
3. one explicit positive safe-integer sample count.

It validates the complete Phase 1C artifact before selection, including
status, empty blockers, unestablished runtime trust, exact policy, scenario
descriptors, all three hash bindings, dimensions, counts, canonical path and
step order, finite positive NAV values, and literal-one baselines.

An invalid unselected path blocks the whole result. The implementation does
not sort, relabel, repair, drop, deduplicate, pad, truncate, intersect, infer,
renormalize, or replace malformed input. Hash equality establishes binding
consistency only; it does not revalidate source artifacts or establish
runtime authority, tenant ownership, or approval.

## Deterministic Selection

For `P = pathCount` and `S = sampleCount`, the implementation uses:

```text
S = 1:
  selectedIndex[0] = floor((P - 1) / 2)

S > 1:
  selectedIndex[i] = floor(i * (P - 1) / (S - 1))
  i = 0, 1, ..., S - 1
```

The implementation validates safe integer arithmetic and defensively checks
the final selection count, order, uniqueness, range, and endpoints. It does
not call random or pseudorandom selection, resample paths, rank outcomes, or
select by terminal NAV, percentile proximity, date, return, loss, or
drawdown.

Every selected path is copied completely in canonical order. The helper does
not shorten a path to satisfy a resource limit. Sample counts and resource
limits are exact-or-block; they are not defaulted, clamped, rounded, coerced,
or silently reduced.

## Validation And Output Boundary

The implementation validates all input paths before selecting the output
subset. The one-million input-point limit is checked before point traversal
when safely available. The selected-path and output-point limits are checked
before output allocation.

Applicable blockers are deduplicated in the fixed contract order. A blocked
result always uses the same null, zero, and empty projection and contains only
fixed blocker reasons. It never reflects caller-supplied scenario, hash,
count, sample-count, path, or NAV values and never returns a partial selected
path.

A ready result contains only minimal scenario descriptors, the three hashes,
dimension and count metadata, and selected `pathIndex`, `stepIndex`, and
dimensionless `nav` values. It excludes unselected paths, source dates,
draw provenance, vector rows, matrix rows, draw-plan rows, growth factors,
owner data, provider data, KRW values, percentile labels, and risk or
optimization metrics.

Ready and blocked outputs, including nested policy, paths, points, and
blockers, are deeply immutable.

## Source-Provenance Boundary

At path and point level, Phase 1E0 consumes only:

```text
pathIndex
stepIndex
nav
```

It does not read, validate, compare, rank, copy, aggregate, or emit draw-step
indices, source-row indices, previous service dates, or service dates. Those
fields remain upstream historical-sampling provenance and do not influence
path selection.

## Synthetic Verification

Fixtures use synthetic scenario identities, hashes, and NAV paths only. They
do not use the approved research vector, production hashes, production NAV
artifacts, or actual owner identifiers.

The reviewed fixtures record:

- pinned one-path lower-middle and multi-path even-spacing behavior;
- strictly increasing unique endpoints across representative path and sample
  counts;
- selecting all paths when the requested count equals the input path count;
- deterministic, non-mutating, deeply immutable minimized output;
- whole-artifact rejection for malformed selected or unselected paths;
- separate sample-count, selected-path, output-point, and input-point limits;
- ready status, blocker, runtime-trust, policy, shape, baseline, NAV, and
  three-hash classifications;
- fixed blocker order, deduplication, prerequisite coherence, and exact
  blocked projection;
- source-provenance non-consumption and non-exposure;
- no random, resampling, distribution-summary, production-identity, I/O, or
  runtime dependency.

The input-cap correction replaces a hole-only at-cap fixture with a valid
synthetic artifact containing exactly 1,000,000 logical NAV points. That
artifact reaches the ready path and selects the expected lower-middle path.
The paired valid-shape over-cap artifact contains 1,000,025 logical points and
is blocked only by `input_nav_too_large`.

## Verification Recorded At Implementation

The pure implementation and subsequent input-cap correction were closed
with:

- focused Phase 1E0 tests: 19 passed;
- full test suite: 533 passed;
- TypeScript check: passed;
- lint: passed;
- production build: passed;
- diff, staged-diff, whitespace, scope, and synthetic-identity checks:
  passed.

These results describe the reviewed commits above. They do not claim that a
later repository state has the same result without rerunning verification.

## No-I/O Boundary

The helper, policy, type, and validation modules do not read Markdown, files,
environment variables, databases, providers, HTTP requests, routes, sessions,
auth state, approval stores, or tenant records. They perform no writes,
persistence, stochastic sampling, resampling, matrix compilation, draw-plan
generation, growth calculation, NAV materialization, distribution summary, or
execution orchestration.

## Explicitly Unapproved

This close-out does not approve or implement:

- production vector, matrix, draw-plan, growth, NAV, summary, or path-sample
  execution;
- runtime repository, approval lookup, session, auth, tenant, ownership, or
  trust establishment;
- database, schema, migration, persistence, seed, backfill, provider, file,
  environment, or network I/O;
- initial KRW scaling, current-portfolio comparison, or wealth projection;
- distribution and selected-path composition or chart presentation;
- drawdown, terminal-loss probability, expected shortfall, optimization,
  target generation, recommendation, order, or rebalance behavior;
- API, route, page, UI, job, Cron, write, ownership, or RLS changes.

## Closure And Next Gate

The pure Phase 1E0 deterministic path-sampling implementation is complete at
the reviewed implementation and correction commits above. No runtime
authority, production execution, persistence, chart, or product behavior is
enabled by this close-out.

A drawdown and loss-semantics docs-only contract is the next proposed pure
calculation gate. Its contract, implementation, production use, and product
presentation remain separately unapproved. Continued development must not
treat this close-out as implicit authorization for that gate or for any
runtime, data, auth, or UI integration.
