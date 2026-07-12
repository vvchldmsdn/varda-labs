# Simulation Normalized NAV Phase 1C Implementation Close-Out

Recorded: 2026-07-12

Status: `docs_only_close_out`

This packet closes the reviewed pure implementation of
`simulation_normalized_nav_v1`. It records implementation provenance,
verification evidence, and boundaries only. It is not a runtime resolver,
trust source, execution instruction, persistence record, or product approval.

## Reviewed Commit Chain

Phase 1C contract:

```text
a9386a271b4cf7de29be1cecaa5ad61a495d3695
```

Numerical-policy amendment:

```text
27975e663add73cc9c56e5b1df8c89bf577e1766
```

Pure implementation:

```text
024a956695befc4bd54fc4b01cf9ae9beca00a59
```

The contract files retain their original docs-only status. This close-out
records that the separately approved pure implementation was reviewed against
those exact revisions. No application code reads these commit identities or
this Markdown file as trust evidence.

## Implemented Policy

```text
policy.version: simulation_normalized_nav_v1
policy.inputGrossGrowthVersion: simulation_gross_growth_v1
portfolioPathPolicyId: gross_normalized_buy_and_hold_v1
Gate0ApprovalCommit: 652b9ea9c9b48f51dc4c68e8f148132ca8893d7e
weightedSumAlgorithm: neumaier_compensated_sum_v1
weightedSumOrder: canonical_instrument_order
baseline: literal_one_at_step_zero
runtimeTrustStatus: not_established
maxNavPoints: 1,000,000
```

The result is a dimensionless normalized buy-and-hold path. It is not KRW
wealth, a distribution summary, a forecast, or an investment recommendation.

## Pure Input Boundary

The helper accepts only three explicit in-memory inputs:

1. one complete `simulation_gross_growth_v1` result;
2. one complete canonical scenario-vector evidence object;
3. one expected matrix-hash and draw-plan-hash binding object.

It validates the full Phase 1B policy lineage, ready status, empty blocker
list, dimensions, path and point indices, factor identities and order,
baseline, and sampled-date provenance.

It recalculates `scenarioVectorHash` from the supplied scenario identity and
vector. It compares `inputMatrixHash` and `drawPlanHash` separately with the
explicit expected binding. Those two comparisons establish binding
consistency only; they do not revalidate unavailable source artifacts or
establish runtime trust.

The supplied vector must already be in canonical order, and the gross-growth
artifact must use the same exact instrument order. The implementation does not
sort, deduplicate, intersect, pad, truncate, infer, or renormalize invalid
input.

## NAV Materialization

For each validated path:

```text
NAV[path, 0] = 1

NAV[path, step] =
  sum(
    (weightBps[instrument] / 10,000)
    * grossGrowth[path, instrument, step]
  )
```

Step zero is materialized as literal `1`, not as a floating-point weighted
sum. Later steps use the contract's exact Neumaier recurrence in canonical
instrument order and return `sum + compensation` without presentation
rounding.

Every factor is required to be finite and strictly positive, including a
factor associated with an explicit zero-basis-point row. A zero weight cannot
hide missing or malformed growth evidence.

The implementation validates weighted terms, running sums, compensation, and
final NAV values. Any blocker returns no partial path. The NAV point cap and
safe-integer arithmetic are checked before output-path allocation.

## Runtime Trust Boundary

The result keeps two separate statuses:

```text
calculationStatus: ready | blocked
runtimeTrustStatus: not_established
```

A ready pure calculation means only that the supplied in-memory objects are
internally consistent under this policy. It does not mean that a vector,
matrix, draw plan, execution request, user, or tenant is approved at runtime.

The previously recorded research scenario vector and its production evidence
hashes were deliberately not used by the implementation fixtures. The helper
does not load the vector-approval Markdown artifact.

## Synthetic Verification

The implementation uses only synthetic identities and hashes in its fixtures.
The focused suite records:

- deterministic two-instrument normalized paths;
- exact literal-one baseline and immutable output;
- a pinned magnitude-skew case where native summation loses precision and the
  required Neumaier result preserves it;
- one-instrument and explicit zero-weight operation;
- rejection of an invalid factor on a zero-weight instrument;
- scenario-vector, total-weight, matrix-hash, and draw-plan-hash mismatch;
- rejection of out-of-order vector and gross-growth input;
- Phase 1B status, blocker, policy, shape, provenance, factor-order, and
  baseline mismatch;
- pre-allocation NAV memory-cap rejection;
- whole-result rejection when positive factors underflow to zero NAV;
- minimized output and permanently unestablished runtime trust.

## Verification Recorded At Implementation

The implementation commit was closed with:

- focused Phase 1C tests: 13 passed;
- full test suite: 478 passed;
- TypeScript check: passed;
- lint: passed;
- production build: passed;
- staged diff and whitespace checks: passed;
- forbidden production identity and I/O boundary checks: passed.

These results describe the reviewed implementation commit. They do not claim
that later repository states have the same result without rerunning checks.

## No-I/O Boundary

The production helper and validation modules do not read Markdown, files,
environment variables, databases, providers, HTTP requests, routes, or
runtime approval stores. They do not perform writes, persistence, stochastic
sampling, matrix compilation, draw-plan generation, or actual orchestration.

## Explicitly Unapproved

This close-out does not approve or implement:

- a runtime Scenario Vector Resolver or approval lookup;
- use of the approved research vector as a runtime input;
- production matrix, draw-plan, gross-growth, or NAV execution;
- initial KRW capital, current-portfolio comparison, or wealth scaling;
- terminal distributions, percentile bands, fan or spaghetti charts;
- drawdown, expected shortfall, loss probability, optimization, target
  generation, recommendation, order, or rebalance behavior;
- database, schema, migration, seed, provider, API, route, page, UI, job,
  Cron, write, auth, ownership, or RLS changes.

## Closure And Next Gate

The pure Phase 1C implementation is complete at the implementation commit
above. No runtime behavior is enabled by this close-out.

Any resolver, production execution orchestration, distribution calculation,
initial-capital scaling, persistence, or product presentation requires a new
contract and separate explicit approval. Continued development must not be
treated as implicit authorization for those gates.
