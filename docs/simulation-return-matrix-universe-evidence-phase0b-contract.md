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

The low-level read adapter receives only:

- the exact ordered service dates to review;
- candidate `market/currency/ticker` identities;
- optional display labels.

The exact date list is a resolved internal input, not a user-facing form
contract. A later resolver may accept an end service date plus return-step
count, or an explicit start and end date, and produce the exact date axis. That
resolver is not implemented in Phase 0B.

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
- `scenarioUniverseHash` for a valid non-empty exact instrument set;
- `matrixRequestHash` when that universe and exact service-date axis are valid.

FX coverage is calculated independently from price coverage. Missing USD price
history cannot incorrectly make existing FX evidence look missing.

The DTO does not expose prices, returns, the numerical matrix, weights,
quantities, values, ids, row sources, or approval state.

Hash existence does not mean source evidence is ready. The separate
`vectorReviewStatus` remains blocked unless the complete Phase 0A matrix is
`ready`.

## Scenario Universe Hash

Hash version: `simulation_scenario_universe_hash_v1`.

The canonical SHA-256 input contains:

- identity policy `market_currency_ticker_identity_v1`;
- KRW-investor simple-return basis;
- adjusted-close-only price basis;
- date-specific USD/KRW basis;
- supported currencies KRW and USD;
- sorted canonical `market/currency/ticker` identities.

It intentionally excludes service dates, Phase 0A/0B carry and window policy,
display labels, prices, returns, and Gate 0 approval revision. The same exact
scenario universe can therefore be reused across multiple historical windows.

Changing an instrument changes the hash. Reordering candidate inputs, changing
a display label, or changing only the historical window does not.

## Matrix Request Hash

Hash version: `simulation_return_matrix_request_hash_v1`.

The canonical SHA-256 input contains:

- `scenarioUniverseHash`;
- Phase 0B evidence policy version;
- Phase 0A return-matrix policy version;
- the exact resolved service-date list.

The hash intentionally excludes display labels, weights, price values, return
values, Gate 0 approval revision, `inputMatrixHash`, and `drawPlanHash`. It
identifies a matrix request under fixed read policies; it is not source-data or
execution provenance.

Changing a date, instrument, or Phase 0A/0B policy changes the hash. Reordering
candidate inputs or renaming a display label does not.

## Fail-Closed Gate

`scenarioUniverseHash` is `null` when the candidate set is empty, excluded,
malformed, or duplicated. `matrixRequestHash` is also `null` when the resolved
date axis is malformed.

Valid hashes may still be returned with incomplete or blocked source evidence
so a failed request can be identified without pretending it succeeded.
Scenario vector review remains blocked when:

- any requested instrument is excluded;
- any price or required FX service date is missing or stale;
- any rectangular return cell is incomplete;
- Phase 0A reports a malformed or ambiguous source row blocker.

No partial universe is silently hashed. Hash presence never overrides matrix
status. No common-history intersection, zero fill, automatic normalization, or
fallback to raw close is allowed.

## Explicit Non-Scope

Phase 0B does not authorize:

- an actual candidate universe or date window;
- an actual scenario id, version, or 10,000bps vector;
- current/equal/target/ISA weight reuse;
- Scenario Vector Resolver or Phase 1C NAV aggregation;
- user-facing date-axis resolution;
- `inputMatrixHash` or draw-plan execution binding;
- DB schema changes, writes, API routes, pages, forms, or admin actions;
- provider fetches, cron jobs, recommendations, optimizer, fan charts,
  percentiles, or drawdown calculations.

## Next Gate

The next review input should ask the user for a candidate scenario definition,
not a raw date array or numeric weights:

```text
scenarioId:
scenarioVersion:
purpose: control / research basket / benchmark comparison
candidate instruments: market / currency / ticker / display name
period: end service date plus return-step count, or start service date
```

Varda must resolve that period into an exact date axis and present the
instrument table, coverage, blockers, `scenarioUniverseHash`, and
`matrixRequestHash` together. A hash alone is not a review artifact.

Only after a ready matrix may the user separately approve scenario id/version,
`scenarioUniverseHash`, and one exact 10,000bps vector. A later pure Scenario
Vector Resolver must bind the approved Gate 0 revision there, then revalidate
the universe hash, vector hash, exact identities, and weight total before Phase
1C can be considered.
