# Simulation Terminal Loss Probability Phase 1F0 Implementation Close-Out

Recorded: 2026-07-12

Status: `docs_only_close_out`

This packet closes the reviewed pure implementation of
`simulation_terminal_loss_probability_v1`. It records contract and
implementation provenance, synthetic verification evidence, and explicit
boundaries only. It is not a runtime trust source, execution instruction,
persistence record, risk recommendation, or product approval.

## Reviewed Commit Chain

Phase 1F0 path-risk semantics contract:

```text
dabe8773085e33f32d48bda134aec6c69ae59bf3
```

Pure terminal-loss implementation:

```text
7e7405f8cae35c220fccb25e95def7d9b7a2bd56
```

The shared semantics contract retains its docs-only status. This close-out
records that the separately approved terminal-loss implementation was
reviewed against that exact revision. No application code reads these commit
identities or this Markdown file as runtime trust evidence.

## Implemented Policy

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

The result is an empirical loss count and probability over the supplied
normalized NAV paths. It is not a calibrated real-world forecast, KRW loss,
expected shortfall, percentile risk summary, recommendation, target, or order.

## Pure Input Boundary

The helper accepts exactly two explicit in-memory inputs:

1. one complete ready `simulation_normalized_nav_v1` result;
2. one expected binding for scenario-vector, input-matrix, and draw-plan
   hashes.

It validates the complete Phase 1C artifact before counting terminal loss,
including ready status, empty blockers, unestablished runtime trust, the exact
Phase 1C policy, scenario descriptors, all three hash bindings, dimensions,
counts, canonical path and step order, every finite positive NAV value, and
every literal-one baseline.

An invalid nonterminal point also blocks the whole result. The implementation
does not drop or repair a path, reduce the denominator, interpolate a missing
value, substitute an average, or calculate from a Phase 1D0 distribution
summary or Phase 1E0 display subset.

Hash equality establishes binding consistency only. It does not revalidate
source artifacts unavailable to the helper, establish runtime trust, infer
tenant ownership, or authorize production execution.

## Exact Loss Calculation

For every fully validated canonical path:

```text
terminalNav = path.points[horizon].nav
isLoss = terminalNav < 1
```

The comparison is strict. A terminal NAV exactly equal to `1` is not a loss.
The implementation applies no epsilon, tolerance, rounding, formatting, or
near-one bucket.

Every path contributes exactly one equally weighted observation:

```text
lossPathCount = count(path where terminalNav < 1)
lossProbability = lossPathCount / pathCount
```

The denominator is the complete validated path count. The helper does not use
path probabilities, selected paths, importance weights, outlier removal, or
terminal-value ranking.

`lossProbability` remains the unrounded JavaScript numeric division result.
It is not multiplied by 100 or converted to a presentation string. The
integer numerator and path-count metadata preserve the empirical ratio when
binary floating point cannot represent that fraction exactly.

## Output And Blocked Projection

A ready result contains only:

- the fixed policy and unestablished runtime-trust status;
- scenario id and version;
- scenario-vector, input-matrix, and draw-plan hashes;
- horizon, path count, and total point count;
- loss-path count and unrounded loss probability;
- an empty immutable blocker list.

It does not contain raw paths, terminal samples, non-loss counts, source
dates, provenance, vector rows, matrix rows, draw-plan rows, owner data, KRW
values, drawdown, percentile, expected-shortfall, or optimization output.

Every blocked result uses one exact projection: scenario and hash metadata is
`null`, counts are zero, loss probability is `null`, and only fixed reason
values appear in blockers. Caller-supplied values and partial loss results are
never reflected.

Ready and blocked outputs, nested policies, and blocker arrays are deeply
immutable.

## Deterministic Blockers

Applicable validation reasons are deduplicated in this fixed order:

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

Semantic reasons whose structural prerequisites are unavailable are not
fabricated. The expected binding remains independently validatable.

The final two reasons are defensive guards. Under a successfully validated
positive safe path count and the one-million-point cap, the incremented loss
count must be a safe integer in `[0, pathCount]`, and its division by the path
count must be finite in `[0, 1]`. They are retained as output-invariant guards,
not exposed through a separate testing API or artificial runtime hook.

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
loss result.

## Synthetic Verification

Fixtures use synthetic scenario identities, hashes, and normalized NAV paths
only. They do not use the approved research vector, production hashes,
production NAV artifacts, or actual owner identifiers.

The reviewed fixtures record:

- a pinned two-loss result over five complete paths;
- strict behavior at `1 - Number.EPSILON`, literal `1`, and
  `1 + Number.EPSILON`;
- one-path, no-loss, all-loss, and mixed-loss cases;
- loss-count and probability invariants across path counts 1 through 32;
- canonical path and step order validation without sorting or relabeling;
- malformed top-level prerequisite coherence;
- independent expected-binding validation and three separate hash mismatch
  reasons;
- ready status, input blockers, runtime trust, and policy drift separation;
- malformed steps, invalid NAV, and literal-one baseline validation;
- whole-result rejection for one invalid nonterminal point;
- a valid one-million-point ready artifact;
- a valid-shape 1,000,025-point artifact blocked only by
  `input_nav_too_large`;
- fixed blocker order, deduplication, and exact blocked projection;
- source-provenance non-consumption;
- minimized immutable output and no input mutation;
- no database, environment, network, runtime, Phase 1D0, Phase 1E0, or
  maximum-drawdown dependency.

## Verification Recorded At Implementation

The pure implementation was closed with:

- focused Phase 1F0 terminal-loss tests: 17 passed;
- full test suite: 550 passed;
- TypeScript check: passed;
- lint: passed;
- production build: passed;
- staged diff and whitespace checks: passed.

The reviewed full suite was also independently rerun with 550 passing tests.
These results describe the reviewed implementation commit. They do not claim
that a later repository state has the same result without rerunning checks.

## No-I/O Boundary

The policy, type, validation, and helper modules do not read Markdown, files,
environment variables, databases, providers, HTTP requests, routes, sessions,
auth state, approval stores, or tenant records. They perform no writes,
persistence, resampling, matrix compilation, draw-plan generation, growth
calculation, NAV materialization, risk aggregation, or orchestration.

## Explicitly Unapproved

This close-out does not approve or implement:

- `simulation_path_max_drawdown_v1` policy code, types, validation, helper,
  fixtures, tests, or execution;
- production vector, matrix, draw-plan, growth, NAV, loss, or drawdown
  artifacts;
- runtime repository, approval lookup, session, auth, tenant, ownership, or
  trust establishment;
- database, schema, migration, persistence, seed, backfill, provider, file,
  environment, or network I/O;
- initial KRW scaling, current-portfolio comparison, or wealth projection;
- percentile risk summaries, expected shortfall, aggregate drawdown,
  optimization, targets, recommendations, orders, or rebalance behavior;
- API, route, page, UI, chart, job, Cron, write, ownership, or RLS changes.

## Closure And Next Gate

The pure `simulation_terminal_loss_probability_v1` implementation is complete
at the reviewed implementation commit above. No runtime authority, production
execution, persistence, or product behavior is enabled by this close-out.

Before any maximum-drawdown helper approval, the Phase 1F0 semantics contract
requires a separate docs-only resource amendment that fixes the derived
maximum result-row count, exact output-length invariant, pre-allocation bound
check, and no-truncation rule. That amendment and every later implementation
remain separately unapproved by this close-out.
