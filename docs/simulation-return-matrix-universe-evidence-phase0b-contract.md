# Simulation Return-Matrix Universe Evidence Phase 0B Contract

Last updated: 2026-07-12

Status: server-only read adapter and review DTO implemented. No scenario vector,
approval, matrix execution binding, route, UI, provider call, persistence, job,
portfolio aggregation, recommendation, or optimization is enabled.

## Purpose

Phase 0B answers one review question before numeric scenario weights can be
approved:

> Does an explicitly chosen candidate instrument set have complete stored
> adjusted-close and date-specific USD/KRW evidence for an explicitly chosen
> service-date window?

The existing Phase 0A return-matrix builder remains the only calculation
authority. Phase 0B plans a bounded database read, calls Phase 0A, and reduces
the result to human-readable coverage evidence.

## Input Boundary

The caller supplies only:

- the exact ordered service dates to review;
- candidate `market/currency/ticker` identities;
- optional display labels.

There is no default 90/120/252-day window. The adapter does not discover a
universe from current holdings, account balances, ISA policy `isa-v1`, equal
weights, target weights, quantities, or current market values.

Display labels are non-semantic. They are excluded from every hash.

## Read Boundary

`src/db/queries/simulation-return-matrix.ts` is marked `server-only` and reads:

- `asset_price_snapshots`: normalized identity, date, adjusted close;
- `fx_rates`: date, USD/KRW, normalized status.

Both queries use explicit projections. Sample rows are excluded. FX rows are
restricted to `status=ok`. No ids, legacy ids, owner fields, raw close,
provider metadata, account data, or whole database rows are projected.

The lower source-date bound is derived from the Phase 0A carry policy and its
`D -> D+1 service date` mapping:

- price: first service date minus 8 calendar days;
- FX when USD is present: first service date minus 4 calendar days;
- upper bound: last service date minus 1 calendar day.

Price and FX reads are independent and run in parallel. A KRW-only candidate
set does not query FX.

Malformed service dates or duplicate instrument identities are rejected by the
pure Phase 0A preflight before either repository method can run.

## Evidence DTO

The read model returns:

- matrix status: `ready`, `incomplete`, or `blocked`;
- requested service-date range and exact date list;
- bounded query range;
- a canonical, sorted instrument table with display label and identity;
- independent price-date and FX-date coverage counts;
- rectangular return-cell coverage counts;
- missing/stale reasons, exclusions, and blockers;
- source row counts, without source row contents;
- `matrixUniverseHash` only when the complete matrix is `ready`.

FX coverage is calculated independently from price coverage. Missing USD price
history cannot incorrectly make existing FX evidence look missing.

The DTO does not expose prices, returns, the numerical matrix, weights,
quantities, values, ids, row sources, or approval state.

## Matrix Universe Hash

Hash version: `simulation_return_matrix_universe_hash_v1`.

The canonical SHA-256 input contains:

- Phase 0B evidence policy version;
- Phase 0A return-matrix policy version;
- approved `gross_normalized_buy_and_hold_v1` policy id;
- full Gate 0 approval commit;
- the exact requested service-date list;
- the sorted canonical `market/currency/ticker` identities.

The hash intentionally does not contain display labels, weights, price values,
return values, `inputMatrixHash`, or `drawPlanHash`. It identifies the reviewed
universe and window under a fixed policy revision; it is not execution-data
provenance.

Changing a date or instrument changes the hash. Reordering candidate inputs or
renaming a display label does not.

## Fail-Closed Gate

`matrixUniverseHash` is `null` and scenario vector review remains blocked when:

- any requested instrument is excluded;
- any price or required FX service date is missing or stale;
- any rectangular return cell is incomplete;
- Phase 0A reports a malformed or ambiguous source row blocker.

No partial universe is silently hashed. No common-history intersection, zero
fill, automatic normalization, or fallback to raw close is allowed.

## Explicit Non-Scope

Phase 0B does not authorize:

- an actual candidate universe or date window;
- an actual scenario id, version, or 10,000bps vector;
- current/equal/target/ISA weight reuse;
- Scenario Vector Resolver or Phase 1C NAV aggregation;
- `inputMatrixHash` or draw-plan execution binding;
- DB schema changes, writes, API routes, pages, forms, or admin actions;
- provider fetches, cron jobs, recommendations, optimizer, fan charts,
  percentiles, or drawdown calculations.

## Next Gate

The next review artifact must use a user-chosen candidate set and date list to
produce this Phase 0B table and a non-null `matrixUniverseHash`. Only then can
the user explicitly approve:

```text
scenarioId / scenarioVersion
matrixUniverseHash
one exact integer weightBps row per displayed instrument
total 10,000bps
```

After that approval, a separate pure resolver must revalidate the Gate 0
revision, universe hash, scenario-vector hash, exact identities, and weight
total before Phase 1C can be considered.
