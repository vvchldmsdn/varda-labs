# Simulation Gross Growth Phase 1B Contract

Last updated: 2026-07-12

Status: pure per-instrument gross growth-factor materialization and synthetic
fixtures implemented. Portfolio aggregation, initial capital, weights,
rebalancing, cash, costs, distribution summaries, runtime adapters, and writes
are not enabled.

## Purpose

Phase 1B answers one calculation question:

> Given one complete Phase 0A return matrix and its hash-matched Phase 1A draw
> plan, what is each instrument's cumulative gross growth factor along every
> sampled path?

The result is dimensionless. It is not KRW wealth, a portfolio outcome, a fan
chart, or a recommendation.

## Versioned Policy

The policy id is `simulation_gross_growth_v1`.

- input matrix: `simulation_return_matrix_v1` with
  `consumerStatus=matrix_ready`;
- input draw plan: ready `stationary_bootstrap_v1`;
- baseline: every instrument is `1` at output step zero;
- recurrence: `growth[t] = growth[t - 1] * (1 + sampledReturn)`;
- sampling: consume the supplied draw plan without drawing again;
- output: per-instrument gross growth factors only;
- portfolio aggregation and distribution summary: forbidden;
- output safety limit: 1,000,000 growth-factor cells.

The safety limit includes the baseline point for every path and instrument. It
is a memory bound, not a simulation parameter or product default.

## Input Integrity

Phase 1B reuses the Phase 1A canonical matrix hash validation and then checks
the supplied plan again. It requires:

- ready matrix status, exact matrix shape, finite values, and 100% coverage;
- matrix hash equality between the matrix and draw plan;
- the complete expected Phase 1A policy;
- valid uint32 seed and positive integer block, horizon, and path parameters;
- exact row, instrument, draw, and path counts;
- sequential path and draw indices;
- every source row index within bounds;
- every draw date pair equal to its referenced matrix row;
- the first draw in each path marked as a block start;
- every non-restart draw continuing to the circular next row;
- a recalculated draw-plan hash equal to the supplied hash.

The hash is integrity evidence, not an authorization credential. Runtime
artifact trust and ownership remain outside this pure phase.

## Compounding

For each path, Phase 1B keeps one accumulator per instrument in the matrix's
canonical instrument order.

1. Output step `0` contains factor `1` and no source-row provenance.
2. Draw step `d` creates output step `d + 1`.
3. The whole return vector at the draw's source row is applied once.
4. Each factor is updated independently with the same sampled row.
5. No rounding is performed.

A sampled simple return less than or equal to `-1` is rejected. Any
non-finite intermediate factor is also rejected. No partial path is returned
after a failure.

This phase preserves the cross-asset row selection from Phase 1A, but it does
not combine instruments into one portfolio.

## Output

Ready output contains:

- policy and input versions;
- `inputMatrixHash` and `drawPlanHash`;
- canonical instrument-key order;
- horizon, path, point, instrument, and growth-cell counts;
- path index;
- output step and corresponding draw-step index;
- source row index and source service-date pair;
- full-precision gross growth factor for each instrument.

Instrument keys use the existing `(market, currency, ticker)` canonical
identity. No database id, legacy id, owner id, user id, raw price row, return
matrix copy, or provider secret is projected.

## Fail-Closed Conditions

- matrix incomplete, blocked, or structurally invalid;
- draw plan blocked or policy-invalid;
- matrix hash mismatch;
- draw-plan shape or hash mismatch;
- out-of-range source row;
- source-date provenance mismatch;
- sampled return at or below `-100%`;
- non-finite compounded factor;
- unsafe or over-limit output size.

Blocked output contains no growth paths.

## Verification

Synthetic fixtures cover:

- deterministic two-instrument compounding with positive, zero, and negative
  returns;
- baseline factor one and exact source provenance;
- one-instrument operation;
- sampled `-100%` and lower rejection;
- finite-number overflow rejection;
- incomplete matrix and blocked-plan rejection;
- matrix-hash and draw-plan-hash mismatch;
- out-of-range row and tampered date rejection;
- output memory-bound rejection;
- no PRNG, resampling, portfolio aggregation, distribution summary, optimizer,
  MA120, DB, provider, route, UI, job, or persistence dependency.

## Next Gate

Portfolio aggregation remains a separate policy decision. Before it is
implemented, the contract must explicitly choose:

- initial capital semantics;
- reviewed portfolio-weight source;
- buy-and-hold or constant-mix behavior;
- rebalancing timing;
- cash treatment;
- fees, taxes, and transaction-cost assumptions.

Fan bands, terminal distributions, drawdown, and probability summaries remain
later consumers of an approved portfolio path. Phase 1B does not authorize
either aggregation or presentation.
