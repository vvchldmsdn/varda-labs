# Simulation Stationary Bootstrap Phase 1A Contract

Last updated: 2026-07-12

Status: pure seeded stationary-bootstrap draw-plan core and synthetic fixtures
implemented. No wealth path, distribution summary, factor model, optimizer,
database adapter, route, UI, job, artifact persistence, or recommendation is
enabled.

## Purpose

Phase 1A answers one procedural question:

> Given one complete Phase 0A return matrix and explicit sampling parameters,
> which historical return rows should each future path step reference?

The output is a reproducible draw plan. It is not a simulated wealth result.

## Versioned Policy

The policy id is `stationary_bootstrap_v1`.

- input matrix: `simulation_return_matrix_v1` with
  `consumerStatus=matrix_ready`;
- sampling unit: one whole return row;
- first source index: uniform over all source rows;
- restart probability: `1 / expectedBlockLength`;
- continuation: circular next source-row index;
- PRNG: `mulberry32_v1`;
- seed: explicit uint32 only;
- output: draw plan only;
- production parameter defaults: forbidden.

The legacy regime-weighted variable 5-20 day block, current-regime
conditioning, and log-return pipeline are not ported. Phase 1A has no regime
input and must not invent one.

## Input Validation

The helper accepts:

1. A complete Phase 0A matrix.
2. `seed`: integer from `0` through `4,294,967,295`.
3. `expectedBlockLength`: explicit positive integer no greater than the number
   of source return rows.
4. `horizon`: explicit positive safe integer draw count per path.
5. `pathCount`: explicit positive safe integer.

The helper does not supply defaults for seed, block length, horizon, or path
count.

`horizon * pathCount` is limited to 1,000,000 planned draws. This is a memory
safety bound, not a model default or product recommendation.

## Ready-Matrix Revalidation

Phase 1A does not trust the input status flag alone. It rechecks:

- status and consumer status;
- matrix policy version;
- no blockers or exclusions;
- unique sorted instrument columns;
- valid, unique, strictly increasing service dates;
- exact `N - 1` matrix row shape;
- exact instrument cell order on every row;
- finite non-null return values;
- summary counts and 100% coverage.

An incomplete, blocked, or structurally tampered matrix returns no draw plan.
The helper never drops a missing row or column to manufacture readiness.

## Input Matrix Hash

`inputMatrixHash` is SHA-256 over canonical JSON containing:

- hash version;
- matrix policy version;
- requested service-date axis;
- canonical instrument-key axis;
- every return-row date pair;
- every finite return value in canonical column order.

The hash binds the numerical stochastic input. Detailed price/FX source
provenance remains in the Phase 0A matrix artifact and is not duplicated in the
draw plan.

## PRNG Contract

`mulberry32_v1` is implemented as a small pure uint32 state generator. It emits
values in `[0, 1)` and uses no system time, owner id, runtime randomness,
crypto-random source, environment value, or global mutable state.

One PRNG stream is consumed in deterministic path order:

1. At each path start, consume one value for a uniform first source index.
2. At each later step, consume one value for the restart decision.
3. On restart only, consume one additional value for a new uniform index.
4. On continuation, advance to `(previousIndex + 1) % sourceRowCount` without
   consuming another index draw.

Adding later paths appends consumption after earlier paths; it does not change
the earlier path sequence.

## Whole-Row Sampling

Each draw contains exactly one `sourceRowIndex`, plus that row's previous and
current service dates. It has no instrument-specific index.

All instrument returns in the selected Phase 0A row therefore move together.
This preserves observed same-date cross-asset dependence and prevents separate
per-column sampling.

Circular continuation permits a block that reaches the last historical row to
continue at row zero. `expectedBlockLength=1` restarts at every later step;
larger values reduce restart probability.

## Output

Ready output contains only:

- policy and PRNG versions;
- `inputMatrixHash` and `drawPlanHash`;
- seed and explicit block/horizon/path parameters;
- source row and instrument counts;
- per-path ordered draw steps;
- source row index and source service-date pair for each step;
- block-start marker.

It does not copy matrix returns, compound wealth, calculate percentiles, or
produce terminal outcomes. `drawPlanHash` binds the input hash, PRNG version,
parameters, and complete ordered plan.

## Fail-Closed Conditions

- matrix not ready;
- matrix shape or summary mismatch;
- seed outside uint32 or non-integer;
- block length outside `1..sourceRowCount`;
- non-positive or non-integer horizon;
- non-positive or non-integer path count;
- unsafe or over-limit total planned draws.

Blocked output has no paths and no draw-plan hash.

## Verification

Fixtures cover:

- exact deterministic source-index and block-start sequence;
- pinned input and plan SHA-256 values;
- identical result for identical input/parameters/seed;
- changed evidence for seed, block length, or matrix changes;
- whole-row cross-asset selection;
- circular final-row to first-row continuation;
- one-instrument ready matrix;
- incomplete, blocked, and tampered matrix rejection;
- invalid seed, block length, horizon, path count, and memory bound;
- no production defaults or ambient randomness;
- no return copying, wealth math, factor model, optimizer, target policy,
  MA120, DB, provider, API, UI, or persistence dependency.

## Next Gate

The separately reviewed per-instrument gross growth materializer is implemented
in `docs/simulation-gross-growth-phase1b-contract.md`. It consumes the exact
plan without resampling and still does not aggregate a portfolio.

Initial capital, portfolio weights, rebalancing, cash, costs, terminal
distribution summaries, and user-facing simulation output remain later gates.
Phase 1A itself authorizes none of them.
