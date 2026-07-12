# History Evidence Mapping Adapter V1

Last updated: 2026-07-12

Status: pure mapping adapter and fixtures implemented. The existing History
query, read model, route, and UI are unchanged.

## Purpose

This adapter maps stored History rows onto the Historical Evidence
Completeness and Consumer Eligibility Contract V1. It reports lane-specific
observed and display coverage without recalculating or replacing existing
financial values.

## Exact Date-Axis Input

The adapter requires two caller-supplied date arrays:

- `requiredDates.balance`
- `requiredDates.portfolio`

It does not infer calendar days, market days, account inception, or expected
snapshot cycles. Deriving requirements only from rows that already exist would
make fully missing dates invisible.

The two date axes and denominators remain separate. A balance date does not
create a portfolio requirement, and a portfolio date does not create a balance
requirement.

Duplicate required dates are not deduplicated. The shared classifier marks the
duplicate requirement key invalid.

## Mapping Rules

### Balance lane

`account_balance_snapshots` stores one row per date with cash, brokerage, ISA,
and IRP columns.

- key: `balance/{selectedAccount}/{balanceDate}`
- exactly one row with the required finite field or fields: `observed`
- no row or a required null field: `missing`
- duplicate rows for the same date: `ambiguous`
- non-finite required value: `invalid`

For a named account only that account column is required. For `all`, cash and
all three named account columns are required. Numeric zero is observed
evidence, not a missing value.

### Portfolio lane

- key: `portfolio/{selectedAccount}/{snapshotDate}`
- exactly one stored selected-account row: `observed`
- duplicate selected-account rows across sources: `ambiguous`
- stored `all` row: `observed` and preferred over named-account rows
- no stored `all` plus exactly one brokerage, ISA, and IRP row from the same
  source with finite values: `reconstructed`
- missing named account or null required value: `missing`
- duplicate named-account evidence or source mismatch: `ambiguous`
- invalid source or non-finite value: `invalid`

The only reconstruction method in V1 is
`history_all_account_sum_v1`. It is display-derived evidence and does not gain
calculation eligibility.

## Date Semantics

`daily_portfolio_snapshots` has a portfolio-level `snapshotDate`, not a
portfolio-level `referenceDate`. V1 uses `snapshotDate` as `asOfDate` and
source-date provenance. It does not invent a reference date from position
evidence or current market data.

Any future price-reference provenance must come from an explicit reviewed
projection and a new contract version.

## Coverage Output

Each lane returns:

- `status`: `ready | partial | unavailable`
- required count
- observed count and observed coverage percentage
- displayable count and display coverage percentage
- reconstructed row count
- missing, ambiguous, and invalid requirement keys
- evidence classifications without financial values

No value-weighted coverage is defined. A missing row has no trustworthy value
for the denominator. Current value, latest observed value, adjacent average,
or zero would create an estimate and could introduce look-ahead.

## Explicit Non-Scope

V1 does not:

- change `buildPortfolioHistoryDisplayRows` or its output;
- change the History query, page, tables, labels, or search params;
- return stored financial values in evidence metadata;
- infer required dates or merge lane denominators;
- call providers or create provider-backfilled evidence;
- reconstruct missing snapshots or interpolate chart points;
- add routes, buttons, jobs, Cron, schema, or DML;
- change Risk, Investment Lab, Simulation, or Optimizer eligibility;
- change authentication, ownership, or RLS.

## Next Gate

The next step may connect this metadata to `/history` as a read-only coverage
surface. That integration first needs an explicit reviewed source for the
balance and portfolio required-date axes. Provider repair and display
interpolation remain later, separate gates.
