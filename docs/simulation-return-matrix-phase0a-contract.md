# Simulation Return Matrix Phase 0A Contract

Last updated: 2026-07-11

Status: versioned pure helper and synthetic fixtures implemented. No database
adapter, provider call, route, UI, stochastic engine, optimizer, persistence,
recommendation, or job behavior is enabled.

## Purpose

Phase 0A answers one narrow data question:

> Can a requested service-date window and instrument universe be represented as
> one deterministic rectangular matrix of point-in-time KRW simple returns?

It does not simulate paths, estimate a distribution, choose weights, or judge
whether a portfolio is good.

## Versioned Policy

The policy id is `simulation_return_matrix_v1`.

- return: KRW-investor simple return;
- price: adjusted close only;
- FX: date-specific USD/KRW;
- evidence date `D`: service date `D + 1` under the KST 07:00 boundary;
- maximum price carry: 7 calendar days;
- maximum FX carry: 3 calendar days;
- missing values: preserve a null cell with provenance;
- common-history intersection: forbidden;
- zero filling: forbidden;
- minimum instrument count: none.

The builder reuses only the proven date validation, D+1 mapping, calendar-day
distance, and binary-search primitive from `portfolio-risk-calendar.ts`. It
does not call the portfolio risk input builder or risk math.

## Input Boundary

The pure builder receives:

1. `requestedServiceDates`
   - at least two valid ISO dates;
   - unique and strictly increasing;
   - supplied explicitly rather than selected from a hidden 90/120-day rule.
2. Instrument universe
   - market, currency, ticker, and explicit history status only;
   - no account, quantity, current value, weight, target, owner, or id.
3. Price observations
   - normalized market/currency/ticker identity;
   - source price date;
   - positive adjusted close only.
4. FX observations
   - source rate date;
   - positive USD/KRW;
   - explicit `status=ok`.

Input order for instruments, prices, and FX cannot affect output. Requested
service-date order is a contract and is preserved exactly.

## Instrument Universe

Eligible rows use normalized `(market, currency, ticker)` identity and support
KRW or USD in v1. Output instruments are sorted by canonical key so every
matrix row has the same column order.

Rows without instrument-keyed history remain explicit exclusions. This covers
the current KRX gold spot and managed-product/Fount evidence until separate
canonical histories exist. Exclusions are not silently dropped: they make the
overall result `incomplete` and block stochastic consumers even when every
included cell is ready.

Duplicate eligible identities hard-block the result.

## Point-In-Time Normalization

For each requested service date and included instrument:

1. Select only an observation whose mapped service date is on or before the
   requested date.
2. Use the latest such observation by binary search.
3. Reject it as stale when price carry exceeds 7 calendar days.
4. For USD instruments, independently select the latest prior USD/KRW row.
5. Reject FX as stale when carry exceeds 3 calendar days.
6. Calculate unit value in KRW from adjusted close and date-specific FX.

Future price and FX observations are ignored. A current exchange rate is never
applied to the full history.

Unlike the current risk input, this contract does not permit fallback from a
missing adjusted close to raw close. Presence of `closePrice` or
`rawClosePrice` in a relevant price row hard-blocks the result.

## Matrix Shape

For `N` requested service dates and `M` included instruments, the output always
contains:

- `N - 1` ordered return rows;
- exactly `M` ordered cells in every row.

Each cell contains:

- canonical instrument key;
- simple KRW return or `null`;
- previous-date price/FX source dates and carry days;
- current-date price/FX source dates and carry days;
- explicit missing/stale reason where applicable.

Missing evidence does not delete a date, delete an instrument, substitute zero,
or join only the common complete history. This preserves the requested matrix
geometry for review.

## Status Semantics

### `ready`

- at least one included instrument;
- no exclusion;
- every rectangular cell has a finite return;
- no blocker.

### `incomplete`

- matrix and provenance are returned;
- one or more cells are missing/stale, or one or more requested instruments are
  excluded;
- stochastic consumer status is `blocked_incomplete_matrix`.

### `blocked`

- matrix is empty;
- stable blockers explain malformed dates, duplicate identity/date, invalid
  source evidence, raw-close mixing, or non-finite calculation;
- no partial numerical matrix is returned.

Duplicate price and FX dates hard-block even when values are equal.

## Deliberate Differences From Portfolio Risk

Phase 0A does not inherit:

- ending holdings or weights;
- account aggregation or quantity math;
- Sharpe, volatility, covariance, correlation, or ENB;
- minimum two-instrument rule;
- risk coverage thresholds or partial-risk status;
- raw-close fallback;
- selection of the latest fixed 90-return window.

One instrument is a valid matrix. Whether a later model can use it is a later
model contract.

## Verification

Synthetic fixtures cover:

- KR/US holiday union with bounded price carry;
- unchanged USD price with date-specific FX movement;
- future price and FX look-ahead rejection;
- duplicate price and FX hard blockers;
- raw-close mixing and invalid/non-positive evidence;
- exact requested service-date row and column preservation;
- incomplete cells without date intersection or zero fill;
- price carry above 7 days and FX carry above 3 days;
- explicit KRX gold and managed-product history exclusions;
- one-instrument support;
- identity and source-row order independence;
- no internal or legacy identifier projection;
- no risk math, DB, provider, route, optimizer, randomness, approved ISA vector,
  or MA120 evidence dependency.

## Next Gate

The separately reviewed pure historical-resampling draw-plan core is now
implemented in `docs/simulation-stationary-bootstrap-phase1a-contract.md`. It
consumes only a `ready` matrix and remains separate from wealth compounding,
factor Monte Carlo, optimization, UI, jobs, and persistence.

Phase 0A by itself still does not authorize any stochastic consumer.
