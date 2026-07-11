# Investment Lab Historical Counterfactual Contract

Last updated: 2026-07-11

Status: Phase 1 aggregate KODEX200 deterministic path engine implemented and
read-only audited. No route, UI, provider call, schema change, or database
write is approved by this document.

## Product Decision

The primary Investment Lab question is:

> With the same dated buy and sell schedule and the same KRW amounts, how would
> the user's observed portfolio value have changed under a different portfolio
> composition?

The first fixed scenario is "all KODEX 200" (`korea:KRW:069500`). The lab must
show its hypothetical valuation path next to the user's actual observed path.
Static current-weight risk adjustment can be a later secondary card; it is not
the primary Investment Lab model.

## Measurement Boundary

The v1 path measures invested positions, not the user's entire financial
account. Current varda daily snapshots store `cash_value = 0` and calculate
`total_market_value` from positions. Therefore:

- `buy` crosses into the measured path as an invested-boundary inflow;
- `sell` crosses out of the measured path as an invested-boundary outflow;
- `deposit` and `withdrawal` belong to a cash ledger outside this v1 path;
- `asset_added` and `asset_removed` are position metadata, not trade notionals.

This does not claim that buy and sell are external cash flows for the user's
whole brokerage account. It defines how they cross this specific measurement
boundary. Replaying both cash-ledger events and buy/sell events would double
count capital unless a future model includes cash explicitly.

## Canonical Paths

### Actual path

- Anchor at the first complete observed portfolio snapshot in the selected
  window.
- Use `daily_portfolio_snapshots.total_market_value`; do not reconstruct the
  historical actual portfolio from today's holdings.
- For `all`, sum the same-date `brokerage`, `isa`, and `irp` rows. Use a date
  only when all three account rows exist.
- Reconcile derived `all` values against stored `account='all'` rows where both
  exist. A mismatch blocks the model.
- Plot only observed snapshot dates. Do not interpolate missing actual values.

### Hypothetical path

- Allocate the anchor value to the requested scenario weights.
- Replay every post-anchor buy as the same KRW invested-boundary inflow.
- Replay every post-anchor sell as the same KRW invested-boundary outflow.
- Preserve gross buy and sell evidence, even when same-day events net to zero.
- Use adjusted closes from `asset_price_snapshots` and date-specific FX from
  `fx_rates` for non-KRW instruments.
- Value the scenario on the actual path's snapshot dates.

Same-day events must retain source order and must not be netted. Transaction
costs are zero in v1 unless reliable fee evidence is added later.

## Date Semantics

`daily_portfolio_snapshots.snapshot_date` is a service-cycle date, not the
market close date. A close dated 2026-07-08 is evidence for the 2026-07-09
service cycle. Price and FX evidence must use the existing
`mapRiskEvidenceDateToServiceDate` convention.

This distinction applies differently to two operations:

- snapshot valuation selects the latest allowed close on or before the service
  cycle, with bounded prior carry and no look-ahead;
- transaction execution starts from the event's actual calendar date and needs
  an explicit policy when the scenario instrument's market is closed.

Never compare raw close dates directly with cycle dates, and never use the
latest current FX rate for historical valuation.

## Event Evidence

The canonical event account resolution order is:

1. `event_ledger_entries.account`;
2. `after_value.account`, then `before_value.account`;
3. the explicitly linked current asset's account.

No account is inferred from ticker alone, legacy owner strings, or snapshot
history. Account-specific scenarios fail closed when an in-window event remains
unassigned. The `all` scenario can consume such an event because account
attribution is not required for the aggregate path.

The canonical KRW event amount is `abs(amount_krw)`. When it is absent, a value
may be reconstructed only from stored event quantity, event price, and the
stored event FX evidence. A current or fallback FX rate is forbidden.

Events on the anchor date are treated as already reflected in the anchor
snapshot. Replay begins strictly after the anchor date.

## Instrument Identity

Calculation identity is `(market, currency, ticker)`, not ticker alone. The
current `asset_price_snapshots(ticker, date)` unique index is adequate for the
present data but is not sufficient for a future global multi-user universe in
which the same ticker can exist in multiple markets. That schema decision is
deferred; this phase does not change it.

## Comparison Metrics

The lab should eventually expose two distinct answers:

- valuation-path difference: actual KRW value versus hypothetical KRW value,
  valid because both paths receive the same transaction schedule;
- cashflow-adjusted time-weighted return: performance isolated from the size
  and timing of those transactions.

Do not substitute money-weighted return, raw end/start return, or a single
latest-price comparison without labeling it. Risk metrics such as volatility,
Sharpe, maximum drawdown, and correlation are downstream summaries, not the
path-generation algorithm.

## Legacy Behaviors Rejected

The Base44 behavior is reference material, not parity truth. varda-labs must not:

- backcast today's holdings as the historical actual portfolio;
- fund a hypothetical world only at inception while ignoring later trades;
- stitch a synthetic path into the actual continuation;
- use ticker-only identity;
- use fixed or fallback FX for historical dates;
- silently trim to a common history window;
- present a full-window optimum as if it were an investable historical strategy.

The old `simulatePortfolioTimemachine` and
`comparePortfolioParallelWorlds` paths violate one or more of these rules.

## Optimizer Policy

Fixed user-selected scenarios come first. Maximum-Sharpe, minimum-drawdown, and
other optimized allocations are later work.

An optimizer must either:

- use walk-forward estimation with weights chosen only from information
  available before each rebalance; or
- be explicitly labeled hindsight analysis.

An in-sample full-window grid search must never be presented as a realistic
historical strategy.

## Readiness Baseline

The 2026-07-11 read-only production audit found:

- 90 stored portfolio snapshot rows;
- 81 account rows produce 27 complete derived `all` dates;
- 9 stored `all` dates overlap the derived path with zero mismatches;
- 46 buy/sell event rows in total and 38 post-anchor rows for the aggregate
  window, all with resolvable KRW amounts;
- 3 in-window events still lack an account after canonical fallback, so
  account-specific scenarios remain blocked;
- KODEX 200 has 911 adjusted-close dates from 2022-10-17 through 2026-07-08;
- the aggregate KODEX 200 case is ready for a pure engine fixture, but not for a
  production engine or user-facing route.
- the event ledger contains 31 buys, 15 sells, 2 asset-added rows, and 3
  asset-removed rows; there are no deposit or withdrawal rows;
- all 46 buy/sell rows have resolvable KRW notionals;
- 41 KODEX 200 executions map to a same-day close and 5 wait for a later valid
  close within the bounded policy.
- the pure aggregate path engine produced all 27 actual service-cycle rows,
  replayed 38 post-anchor flows, preserved pending evidence on 5 comparison
  rows, used at most 3 calendar days of valuation carry, and ended with no
  pending flow or blocker;
- 8 flows on or before the anchor are intentionally treated as already
  represented by the anchor snapshot.

Run `npm run audit:investment-lab-counterfactual` to refresh this evidence.
Run `npm run audit:investment-lab-event-flow` to refresh event-flow evidence.
Run `npm run audit:investment-lab-counterfactual-path` to execute the pure path
engine against read-only production evidence.

## Execution Policy

Phase 1A fixes `eod_adjusted_close_on_or_after_v1`:

1. Use a valid adjusted close on the event date when one exists.
2. Otherwise keep the event pending until the first later valid close, for at
   most seven calendar days.
3. Pending buy capital is zero-return KRW cash from the event date.
4. A pending sell is a KRW withdrawal obligation from the event date.
5. Never execute at a prior close or rewrite the event date with a future
   price.
6. Never net multiple pending events; preserve event and recorded order.
7. Block an event with no executable close inside the window or beyond the
   seven-day limit.
8. Block a sell that the long-only scenario cannot fund. Do not partially fill,
   borrow, short, or reduce the requested amount.

The deterministic aggregate KODEX200 path fixture and read-only production
audit are complete. Cashflow-adjusted TWR remains deferred until a separate
fixture proves its pending-flow denominator semantics. No user-facing read
model or valuation series is enabled yet.

## Architecture Boundary

Future implementation should keep four layers separate:

1. server-only evidence loader for snapshots, events, prices, and FX;
2. pure deterministic path engine with fixture tests;
3. read-model composer that exposes only safe aggregate output;
4. Server Component UI that renders the read model.

Simulation Validation remains a separate subsystem. Bootstrap, Monte Carlo,
reverse optimization, job orchestration, and artifact persistence are not part
of this Investment Lab Phase 0 contract.
