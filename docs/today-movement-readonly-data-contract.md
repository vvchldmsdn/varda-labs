# Today Movement Read-Only Data Contract

Status: docs-only contract. This does not add routes, UI, provider calls,
dry-run execution, writes, Cron, schema changes, or a public sync button.

This document defines the data contract for future today-movement and
per-holding detail surfaces. These surfaces must reuse the movement model that
already powers `/`; they must not introduce a second daily-movement formula or a
new write path.

## Scope

In scope for this contract:

- a future today-movement page or tab;
- a future per-holding movement/detail view;
- read-only server-side data loading;
- account filtering for `all`, `brokerage`, `isa`, and `irp`;
- display of current value, baseline value, price contribution, FX
  contribution, trade-flow adjustment, and coverage state.

Out of scope:

- provider calls;
- dry-run buttons;
- actual-write buttons;
- public sync buttons;
- Cron or automation;
- recommendation, risk, or scoring integration;
- schema or migration changes;
- new movement formulas;
- visual polish beyond basic data readability.

## Service-Day Baseline

The service day is based on the KST 07:00 boundary.

- From `YYYY-MM-DD 07:00 KST` until `YYYY-MM-DD+1 07:00 KST`, the comparison
  baseline is snapshot date `YYYY-MM-DD`.
- This mirrors the market sequence: Korea market daytime first, then the US
  market closes before the next 07:00 KST boundary.
- The baseline source is the `daily_position_snapshots` row set for the current
  service-day snapshot date.
- The route must not infer a baseline from browser local date alone. It should
  use the same server-side cycle resolver used by the dashboard movement code.

## Calculation Sources

Primary source:

- `daily_position_snapshots` for baseline quantity, baseline market value,
  baseline local price, and baseline FX basis.

Fallback source:

- `asset_price_snapshots` previous-close rows only when snapshot movement
  coverage is insufficient and current holdings have fresh live quote metadata.

Current source:

- `live_price_quotes` for current live/latest market prices, keyed by market,
  ticker, currency, and provider. The quote cache is user-neutral and must not
  duplicate per-user holding rows.
- `assets.current_price` remains a manual/fallback value, not the canonical live
  quote source for today movement.
- A current price can be used for today movement only when its quote type is
  live/delayed/realtime, status is ok, and fetched/as-of time is inside the
  current 07:00-to-07:00 KST service window.

Event source:

- `event_ledger_entries` for trade-flow adjustment after the baseline snapshot.
- Buy/sell/deposit-like rows after the baseline date must affect movement
  through the existing trade-flow adjustment path, not by changing the baseline.

FX source:

- `fx_rates` latest stored USD/KRW row, with settings fallback only where the
  current dashboard already allows it.
- USD movement compares current stored USD/KRW to the baseline snapshot FX rate
  when a baseline FX basis exists.
- FX contribution is `0` only when the holding does not require FX. Missing
  baseline FX evidence should be shown as unknown or coverage-limited, not as a
  clean zero contribution.

## Required Holding Fields

Each displayed holding row/detail should carry:

| Field | Meaning |
| --- | --- |
| `assetId` | Current varda asset id when available. |
| `legacyBase44Id` | Internal trace/evidence id. It may be present in data but must not be primary default UI text. |
| `ticker` | Current ticker, falling back to snapshot ticker only for evidence views. |
| `assetName` | Current asset name, falling back to snapshot asset name only for evidence views. |
| `account` | One of `brokerage`, `isa`, `irp`. |
| `market` | Current market label, such as `korea` or `us`. |
| `currency` | Current valuation currency. |
| `quantity` | Current holding quantity. |
| `currentPrice` | Current live/latest price used for movement. |
| `currentValueKrw` | Current KRW value after FX conversion. |
| `baselineDate` | Service-day snapshot date used for comparison. |
| `baselinePrice` | Snapshot local price or previous-close fallback price. |
| `baselineValueKrw` | Baseline KRW value. |
| `todayChangeKrw` | `currentValueKrw - baselineValueKrw - tradeFlowKrw`. |
| `todayReturnPct` | `todayChangeKrw / baselineValueKrw` when baseline is positive. |
| `priceImpactKrw` | Local price movement converted at baseline FX. |
| `fxImpactKrw` | Currency movement contribution for non-KRW holdings. |
| `tradeFlowKrw` | Post-baseline trade-flow adjustment. |
| `movementSource` | `daily_position_snapshot` or `asset_price_snapshot`. |
| `priceFetchedAt` | Current quote metadata timestamp. |
| `priceAsOf` | Provider as-of timestamp when available. |
| `priceSource` | Provider/source label only, never credentials or raw response. |
| `coverageStatus` | Whether this row contributes to aggregate movement. |

## Aggregate Contract

Aggregate today movement and holding-level movement must share the same source
contributions.

- The aggregate value is the sum of eligible holding contributions plus
  removed-position accounting from unmatched baseline snapshots.
- A holding detail view must not recompute movement with a different formula.
- A today-movement page must not use cumulative return as a fallback for daily
  movement.
- When aggregate movement is hidden because coverage is insufficient, holding
  rows may still show row-level evidence, but the aggregate status must stay
  `not_ready`.

## Account Filter

Supported filters:

- `brokerage`
- `isa`
- `irp`
- `all`

Rules:

- `brokerage`, `isa`, and `irp` show only current holdings and snapshots for the
  selected account.
- `all` aggregates current holdings across the three tracked accounts.
- `all` must not merge unrelated legacy-only rows into synthetic current
  holdings.
- URL state should use search params, for example `?account=isa`, so a future
  page can be shared and server-rendered without client-side data fetching.
- Unknown account values should normalize to the same fallback as the current
  dashboard, currently `brokerage`.

## Stale Or Missing Data

Do not show stale or unrelated numbers as today movement.

- If current price metadata is stale or missing, show neutral/unknown for that
  row's today movement.
- If aggregate fresh-price coverage is below the dashboard threshold, hide the
  aggregate today movement and show a data-health status.
- Do not fall back to total return, cumulative PnL, imported account balance, or
  latest portfolio snapshot return as today movement.
- If the previous-close fallback is used, label the source as
  `asset_price_snapshot` and show previous-close coverage separately.
- If no usable baseline exists, the reason should be `missing_baseline_snapshot`.
- If no usable live/latest current price exists, the reason should be
  `missing_fresh_live_prices`.

## Unsupported Currency

Only currencies with an explicit FX model can participate in movement.

- Current supported valuation currencies are KRW and USD.
- Unsupported currencies must not be silently treated as KRW.
- Unsupported rows should be marked as excluded or data-health blocked.
- A future multi-currency model must define pair source, rate date, baseline FX
  storage, and stale-rate display before those rows are included.

## Read-Only Route Candidates

These route names are candidates only:

- `/today`
- `/portfolio/movement`
- `/portfolio/holdings/[ticker]`

Implementation rules if one is later approved:

- Prefer a Server Component route that reads the database through a query/helper
  layer.
- Use URL search params for account and view state.
- Split client components only for local sorting/filtering or table interaction.
- Do not introduce browser-side Base44-style REST fetching for the first render.
- Do not call admin routes, provider routes, dry-run routes, or write routes
  from render.

## Reuse Points

The future surfaces should reuse or extract from:

- `src/lib/portfolio-dashboard.ts` movement contribution model;
- `calculateFxAwareSnapshotMovementKrw`;
- `calculateFxAwarePositionMovementKrw`;
- `resolveKrwFxRate`;
- existing market-calendar service-day cycle helpers;
- existing event-ledger trade-flow adjustment logic.

If extraction is needed later, extract a shared read-only movement builder first,
then point both `/` and the new surface at the same builder. Do not fork the
formula.

The extraction plan is documented in
`docs/shared-movement-builder-extraction-plan.md`.

## Verification Gate

Before implementing a route:

1. Add fixture tests for KRW and USD holdings using the same helper path.
2. Include a USD case where price is unchanged but FX changes.
3. Include a post-baseline trade-flow adjustment case.
4. Include a stale current price case that hides movement.
5. Include an unsupported currency exclusion case.
6. Confirm aggregate movement equals the sum of holding contributions plus
   removed-position accounting.
7. Confirm no provider/dry-run/write/admin route is called by render.

Until this gate exists, keep this as a contract and do not add the display
surface.
