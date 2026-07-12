# Simulation Period Phase 0C Read-Only Preflight Contract

Last updated: 2026-07-12

Status: versioned scan planner, two-stage loader, and server-only Drizzle adapter
implemented. No route, UI, provider call, write, schema change, scenario
selection, vector approval, draw execution, recommendation, or optimizer is
enabled.

## Purpose

This preflight connects the pure Phase 0C period resolver to stored shared
market evidence without introducing an adaptive query loop.

It performs at most two deterministic stages:

1. one bounded axis-discovery read;
2. one existing Phase 0B coverage read, only after an exact axis is resolved.

The same read-only repository contract and explicit Drizzle projections are
used in both stages.

## Axis-Discovery Scan V1

Policy version: `simulation_period_preflight_scan_v1`.

For an exact `endServiceDate` and `returnStepCount=N`:

```text
requiredPointCount = N + 1
sourceDateTo = endServiceDate - 1 calendar day
axisScanDays = ceil(requiredPointCount * 2) + 30
sourceDateFrom = sourceDateTo - axisScanDays calendar days
```

The adapter reads in parallel:

- non-sample adjusted-close rows for the exact candidate identities;
- non-sample `status=ok` USD/KRW rows only when a USD candidate exists.

The source date bounds and policy version are returned as scan provenance.

## No Adaptive Expansion

V1 permits exactly one axis-discovery price read and at most one matching FX
read. It forbids:

- automatic retry;
- progressively wider queries;
- data-dependent query boundaries;
- silent fallback to all history;
- provider calls or backfill.

When fewer than `N + 1` points are found, the outcome is
`insufficient_axis_within_scan_bound`. This means only that the versioned scan
range was insufficient. It does not claim that older evidence does not exist.

A longer scan requires a separate explicit request and separately reviewed
policy provenance. That mode is not implemented.

## Conditional Coverage Read

Coverage starts only when Phase 0C returns an exact resolved axis and permits
Phase 0B evidence review.

The existing Phase 0B loader then performs one exact bounded read:

- price: first service date minus 8 days through last service date minus 1;
- FX: first service date minus 4 days through last service date minus 1.

This second stage applies Phase 0A carry and rectangular coverage rules. It
cannot add dates to or otherwise change the resolved axis.

An axis with a missing candidate or missing FX source may still reach Phase 0B
so the missing evidence remains visible. Scenario-vector review stays blocked
unless the resulting complete matrix is `ready`.

## Status Names

The adapter avoids the ambiguous bare status `ready`:

- `axis_ready`: exact `N + 1` date axis resolved;
- `axis_incomplete`: fixed scan did not provide enough points;
- `axis_blocked`: request, endpoint, or source evidence failed closed;
- `matrix_ready`: Phase 0B complete matrix ready;
- `matrix_incomplete`: Phase 0B preserved missing/stale coverage;
- `matrix_blocked`: Phase 0B source evidence ambiguous or malformed.

`scenarioVectorReviewStatus` is delegated to Phase 0B and opens only for
`matrix_ready`.

## Read Boundary

`src/db/queries/simulation-return-matrix.ts` remains marked `server-only`.
Both stages reuse its private read repository:

- explicit selected columns only;
- no ids, legacy ids, owners, quantities, values, or whole-row projections;
- no DML;
- no HTTP input, auth change, route, or browser fetch.

The output contains scan ranges, counts, dates, candidate availability,
coverage summaries, blockers, and hashes only. Source price and FX values are
not returned.

## Explicit Non-Scope

This phase does not authorize:

- an actual candidate universe, endpoint, or step count;
- current holdings, ISA `isa-v1`, targets, or equal-weight defaults;
- a public/admin route or page;
- automatic longer-history retry;
- market-data provider calls or writes;
- numeric scenario vector approval or resolver;
- `inputMatrixHash`, draw plan, Phase 1C NAV aggregation, fan charts,
  percentiles, drawdown, or optimizer work.

## Next Gate

The next step is to run a separately reviewed read-only production preflight
for one explicitly chosen candidate scenario and period request, or first add a
minimal administrative presentation boundary if direct invocation cannot be
reviewed safely. Neither action is approved by this implementation alone.
