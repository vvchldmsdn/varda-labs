# Simulation Normalized NAV Aggregation Phase 1C Contract

Last updated: 2026-07-12

Status: docs-only contract. No helper, fixture, resolver, actual matrix or draw
execution, runtime trust, database access, persistence, route, UI, summary, or
portfolio-path result is enabled by this phase.

## Purpose

Phase 1C answers one narrow pure-calculation question:

> Given one internally consistent `simulation_gross_growth_v1` artifact, one
> complete 10,000-bps scenario vector, and three separate expected evidence
> hashes, what is the dimensionless normalized buy-and-hold NAV path?

It does not decide whether a vector is approved at runtime. It does not read an
approval Markdown file or establish artifact ownership or trust.

## Approved Portfolio Meaning

The calculation follows the separately approved policy:

```text
portfolioPathPolicyId: gross_normalized_buy_and_hold_v1
Gate0ApprovalCommit: 652b9ea9c9b48f51dc4c68e8f148132ca8893d7e
```

For every path:

```text
NAV[path, 0] = 1

NAV[path, step] =
  sum(
    (weightBps[instrument] / 10,000)
    * grossGrowth[path, instrument, step]
  )
```

Weights describe the initial allocation only. The per-instrument gross-growth
factors already represent buy-and-hold compounding, so Phase 1C does not
rebalance or update the weights at later steps.

Output is dimensionless normalized NAV. It is not KRW wealth, a forecast
calendar, a probability summary, or a recommendation.

## Pure Input Boundary

The future pure helper may accept only three explicit in-memory inputs.

### 1. Gross-growth artifact

One complete `SimulationGrossGrowthResult` produced under:

```text
policy.version: simulation_gross_growth_v1
policy.inputMatrixVersion: simulation_return_matrix_v1
policy.inputDrawPlanVersion: stationary_bootstrap_v1
policy.baseline: one_at_step_zero
policy.outputKind: per_instrument_gross_growth_factor_only
status: ready
blockers: []
```

The artifact supplies:

- canonical `instrumentKeys`;
- `inputMatrixHash` and `drawPlanHash`;
- horizon, path, instrument, point, and growth-cell counts;
- per-path points and per-instrument gross-growth factors;
- sampled source-row and service-date provenance.

Phase 1C consumes this artifact without re-running Phase 0A, Phase 1A, or
Phase 1B. It must not call a PRNG, resample rows, recompile the matrix, or
recalculate the draw plan.

### 2. Scenario vector evidence

One caller-supplied in-memory object containing:

```text
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
canonicalVector:
  - market
    currency
    ticker
    weightBps
scenarioVectorHash
```

The helper must reconstruct each canonical instrument key as
`market|CURRENCY|TICKER`, validate the complete vector, canonicalize it with the
existing `simulation_scenario_vector_hash_v1` rules, and require the
recalculated hash to equal `scenarioVectorHash`.

The object is calculation evidence, not runtime approval evidence. A future
resolver may supply it only under a separately reviewed contract. Phase 1C
must not read `docs/simulation-research-cross-market-v1-vector-approval.md` or
any other approval artifact.

### 3. Expected execution binding

One caller-supplied in-memory binding containing:

```text
expectedInputMatrixHash
expectedDrawPlanHash
```

The helper compares these values with the hashes carried by the ready Phase 1B
artifact. This detects a caller/artifact binding mismatch, but it does not
independently recompute either hash from a matrix or draw plan that Phase 1C
does not receive.

This distinction is required. The contract must not claim cryptographic
revalidation of unavailable source artifacts.

## Three Independent Hash Roles

| Hash | Meaning | Phase 1C treatment |
| --- | --- | --- |
| `scenarioVectorHash` | Scenario model assumption: identity, version, exact instruments, and weights | Recalculate from the supplied vector and compare |
| `inputMatrixHash` | Canonical historical return-matrix evidence | Compare Phase 1B value with explicit expected binding |
| `drawPlanHash` | Stochastic draw provenance for that matrix | Compare Phase 1B value with explicit expected binding |

The hashes remain separate. They must not be concatenated into a replacement
authorization hash, substituted for one another, or treated as tenant or user
identity.

`scenarioUniverseHash` and `matrixRequestHash` are not Phase 1C inputs. The
first supported review vector is reusable for the same canonical instrument
set across separately bound evidence windows; the second identifies one Phase
0B request rather than the vector or draw execution.

## Runtime Trust Separation

Phase 1C has two independent result dimensions:

```text
calculationStatus: ready | blocked
runtimeTrustStatus: not_established
```

`runtimeTrustStatus` is always `not_established` in this contract, including
when every pure calculation input is internally valid. A ready calculation is
eligible only for synthetic or explicitly orchestrated review; it is not a
runtime authorization decision.

No boolean such as `approved=true` may be accepted from an untrusted caller or
derived from a matching hash.

## Structural Validation

### Scenario vector

- policy id and Gate 0 commit match the approved policy revision;
- scenario id and version are valid nonempty descriptors;
- every identity is complete and uses only `KRW` or `USD`;
- instrument identities are unique and canonically ordered;
- every weight is an integer from 0 through 10,000 bps;
- every gross-growth instrument has exactly one vector row;
- no external vector instrument exists;
- the exact total is 10,000 bps;
- the recalculated vector hash matches the supplied hash.

Zero weight is explicit and valid. Missing rows must not be converted to zero,
and valid rows must not be renormalized.

### Gross-growth artifact

- status is `ready`, blockers are empty, and the complete policy object matches
  `simulation_gross_growth_v1`;
- `inputMatrixHash` and `drawPlanHash` are nonempty and match the explicit
  expected execution binding;
- instrument keys are nonempty, unique, and in the same canonical order as the
  vector;
- instrument, horizon, path, point, and growth-cell counts are exact positive
  safe integers with the documented cross-field relationships;
- paths and points use sequential zero-based indices;
- every path contains exactly `horizon + 1` points;
- each point contains the exact instrument set and order;
- every factor is finite and strictly positive;
- each step-zero factor is exactly `1` and has null draw/source provenance;
- later point provenance is structurally valid and copied without relabeling.

Phase 1C must not silently sort, deduplicate, truncate, pad, or intersect an
invalid artifact into a valid-looking input.

## NAV Materialization

The future helper processes paths in increasing `pathIndex`, points in
increasing `stepIndex`, and factors in canonical instrument order.

- Step zero is emitted as literal `NAV=1` after baseline and total-weight
  validation. It is not obtained by a potentially rounded floating-point sum.
- Later steps use the approved weighted-sum formula with full JavaScript number
  precision and no presentation rounding.
- Any non-finite or non-positive computed NAV blocks the whole result.
- No partial path output is returned after a blocker.

Each output point may contain only:

```text
stepIndex
drawStepIndex
sourceRowIndex
previousServiceDate
serviceDate
nav
```

The sampled dates remain historical provenance. They must not be labeled as
future forecast dates.

## Output Boundary

A ready result may contain only:

- `calculationStatus=ready`;
- `runtimeTrustStatus=not_established`;
- Phase 1C policy and approved portfolio-path policy revisions;
- scenario id and version;
- `scenarioVectorHash`, `inputMatrixHash`, and `drawPlanHash` as separate
  fields;
- horizon, path, point, and NAV-cell counts;
- ordered dimensionless NAV paths with unchanged sampled provenance;
- an empty blocker list.

It must not return:

- a copy of the scenario vector, return matrix, draw plan, or gross-growth
  factor matrix;
- initial or terminal KRW values;
- percentile bands, average paths, terminal distributions, drawdown, expected
  shortfall, loss probability, or confidence labels;
- current holdings, targets, recommendation, order, tenant, user, database, or
  provider data.

A blocked result contains no NAV paths.

## Memory Bound

Proposed Phase 1C policy limit:

```text
maxNavPoints: 1,000,000
totalNavPoints = pathCount * (horizon + 1)
```

The helper must reject unsafe integer arithmetic or a total above the cap
before allocating output paths. The cap is an engineering memory bound, not a
production default for horizon or path count.

Phase 1B's growth-cell cap already bounds the same execution more tightly when
multiple instruments exist. Phase 1C still rechecks its own output size rather
than relying on that incidental relationship.

## Fail-Closed Conditions

- missing, blocked, policy-invalid, or structurally invalid Phase 1B artifact;
- policy id, Gate 0 commit, or scenario metadata mismatch;
- invalid, duplicate, missing, extra, or out-of-order instrument identity;
- invalid weight or a total other than 10,000 bps;
- scenario vector hash mismatch;
- missing or mismatched expected matrix or draw-plan hash;
- invalid baseline, path, point, factor, count, or provenance shape;
- non-finite or non-positive factor or NAV;
- unsafe or over-limit NAV output size.

Blocked output must use deterministic reason codes and contain no partial NAV
paths.

## Required Synthetic Fixtures Before Implementation

- deterministic two-instrument weighted NAV calculation;
- exact literal baseline one;
- one-instrument and explicit zero-weight operation;
- out-of-order vector or gross-growth instruments remaining blocked;
- scenario id, version, weight, and vector-hash sensitivity;
- policy id and Gate 0 revision mismatch;
- vector missing, external, duplicate, invalid, and wrong-total rows;
- Phase 1B policy, status, blocker, matrix-hash, and draw-hash mismatch;
- instrument order and set mismatch;
- malformed path, point, factor, count, and provenance shape;
- non-finite and non-positive factor or NAV;
- unsafe and over-limit output size;
- no PRNG, resampling, matrix/draw recomputation, Markdown read, I/O, runtime
  trust, initial capital, summary, UI, provider, or persistence dependency.

## Explicit Non-Scope

This docs-only contract does not add or change:

- a pure helper, type, fixture, or test;
- a Scenario Vector Resolver or runtime approval source;
- an actual return matrix, draw plan, gross-growth, or NAV execution;
- initial KRW scaling, current portfolio comparison, or wealth output;
- distribution summaries, fan or spaghetti charts, percentiles, drawdown,
  expected shortfall, loss probability, Monte Carlo, or optimizer behavior;
- database, schema, migration, seed, provider, route, API, page, UI, job, Cron,
  write, auth, ownership, or RLS behavior.

## Next Gate

Only a separate explicit approval may authorize a pure helper and synthetic
fixtures implementing this contract. That implementation must keep all inputs
in memory, return `runtimeTrustStatus=not_established`, and perform no actual
matrix or draw execution, database read, provider call, route, UI, job, write,
or persistence work.

Runtime vector resolution, actual execution orchestration, distribution
summaries, and product presentation remain later independent gates.
