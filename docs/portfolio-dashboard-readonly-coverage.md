# Portfolio Dashboard Read-Only Coverage

Last updated: 2026-07-08

Status: docs-only QA pass. This document does not add or change schema,
migrations, import scripts, routes, UI, admin triggers, KIS/Cron behavior,
snapshot writers, cleanup, backfill, recommendation logic, or database writes.

Scope: the existing `/` portfolio dashboard only. This is not a new dashboard
implementation and it is not a port of Base44 `Portfolio.jsx`.

## Current Route Shape

`src/app/page.tsx` is the portfolio dashboard route.

- It is a Server Component route with `dynamic = "force-dynamic"`.
- It reads `searchParams.account`, normalizes it with
  `normalizeDashboardAccount`, and passes the selected account to
  `getPortfolioDashboard`.
- It renders the server-built payload through `PortfolioDashboard`.
- There is no Base44 client, browser-side REST fetch, route mutation, or admin
  trigger in this path.

Supported account tabs:

| URL | Selected account |
| --- | --- |
| `/` | `brokerage` |
| `/?account=brokerage` | `brokerage` |
| `/?account=isa` | `isa` |
| `/?account=irp` | `irp` |
| `/?account=all` | `all` |

Any unknown account value falls back to `brokerage`.

## Read Path

`src/lib/portfolio-dashboard.ts` is server-only and reads the database directly
with Drizzle/Neon. The current query path reads these tables:

| Table | Use in `/` dashboard |
| --- | --- |
| `accounts` | Account labels for tabs, summaries, and event activity. |
| `asset_groups` | Current group name lookup for holdings. No historical group rollup is built. |
| `assets` | Current holding source for investment assets and cash-like/non-investment assets. |
| `settings` | Latest sanitized settings row for trend filter, trim drift threshold, and fallback USD/KRW. |
| `fx_rates` | Latest USD/KRW rate, preferred over the settings fallback. |
| `daily_portfolio_snapshots` | Recent trend points for the selected account and data-health comparison against current headline values. |
| `daily_position_snapshots` | Latest baseline position snapshot for daily movement, removed-position accounting, and unmatched snapshot health counts. |
| `asset_price_snapshots` | Previous-close fallback for daily movement when the latest position snapshot coverage is not sufficient. |
| `event_ledger_entries` | Realized return, trade-flow adjustment after the baseline snapshot, and event activity. |

Tables intentionally not read by the current `/` route:

- `account_balance_snapshots`: imported and useful for later history/balance
  views, but not currently part of the first-screen dashboard.
- `benchmark_snapshots`, `market_regime_daily`, `global_market_factors`: used by
  `/market`, not by the portfolio dashboard.
- `etf_masters`, `etf_holdings`: used by `/etfs`, not by the portfolio
  dashboard.
- `PortfolioSnapshot`, `DailyGroupSnapshot`, `MacroSeries`, `MarketSignal`,
  `AssetFactorProfile`: still covered by
  `docs/needs-decision-entity-resolution.md`; none are pulled into this route.

## Display Basis

Headline values:

- Current market value is computed from current `assets` rows after filtering to
  investment asset types.
- Cost basis and realized return come from `event_ledger_entries` through the
  portfolio return metrics helper.
- `dataHealth.headlineBasis` is `current_assets_plus_event_ledger`.

Trend values:

- Recent chart data comes from `daily_portfolio_snapshots` for the selected
  account.
- `dataHealth.trendBasis` is `daily_portfolio_snapshots`.
- The latest portfolio snapshot is used as a comparison point only; it is not
  the source for the headline total.

Daily movement:

- The baseline is the `daily_position_snapshots` row for the current KST 07:00
  service day. For example, from 2026-07-08 07:00 KST until 2026-07-09 07:00
  KST, the dashboard uses the 2026-07-08 snapshot as the comparison baseline.
- Current movement uses `assets.current_price` only when the asset price
  metadata shows a fresh live/delayed/realtime quote updated inside the current
  07:00-to-07:00 KST service window.
- If live price freshness coverage is too low, the dashboard hides aggregate
  today movement instead of showing stale imported or close-only values as
  "today" movement.
- Holding-level movement displays use the same rule. If a holding has no fresh
  daily movement value, the UI shows a neutral `-` instead of falling back to
  cumulative total return.
- If snapshot coverage is too low, the dashboard falls back to
  `asset_price_snapshots` previous-close rows only for holdings with fresh live
  price metadata.
- The UI displays whether movement came from position snapshots or previous
  close fallback.

## Account Coverage

The account filter is applied consistently at the dashboard boundary:

- `brokerage`, `isa`, and `irp` show only current investment assets for that
  account.
- `all` aggregates current investment assets across all three tracked accounts.
- Account summaries are always shown for `brokerage`, `isa`, and `irp`.
- Recent portfolio snapshots are selected by exact `account` value, including
  `all`.
- Latest position snapshot date is selected globally for `all`, and by account
  for account-specific tabs.
- Event activity and realized sell rows use raw event account when present,
  otherwise asset resolution fallback.

Current scale note:

- `event_ledger_entries` are loaded and filtered in memory. That is acceptable
  for the current imported row count, but should move to SQL filtering or
  pagination before event volume grows materially.

## Legacy And Unmatched Preservation

Position snapshots:

- `daily_position_snapshots.asset_id` remains nullable.
- The dashboard loads latest position rows without joining through `assets`, so
  rows with missing current `asset_id` are not dropped at query time.
- Matching to current holdings tries `asset_id`, then `legacy_asset_id`, then
  normalized ticker, then asset name.
- Unmatched latest rows are included in snapshot coverage calculations and
  removed-position movement accounting.
- The UI exposes unmatched snapshot counts through data health.
- Current holdings table still renders only current `assets` rows. Legacy-only
  snapshot rows are preserved in health/movement evidence, not promoted to
  synthetic holdings.

Events:

- `event_ledger_entries.asset_id` is nullable and raw `legacy_asset_id`,
  `ticker`, and `asset_name` are used for resolution.
- Realized return matching tries current id, legacy id, ticker+account, and
  name+account.
- Event activity displays mapping status as `mapped`, `legacy_only`, or
  `unmatched`.
- Unmatched sell rows remain in selected realized totals when the selected
  account can be inferred, with brokerage as the fallback for rows with no
  account evidence.

## Non-Investment Assets

The current dashboard deliberately separates investment assets from
cash-like/non-investment assets.

Investment asset types:

- `etf`
- `stock`
- `pension`
- `commodity`

Non-investment asset types:

- `savings`
- `fixed_deposit`
- `housing_subscription`

Non-investment assets are:

- excluded from headline investment total, weights, drift, movement, and return
  calculations;
- displayed separately in the cash-like/non-investment asset card;
- included in `dataHealth.nonInvestmentAssetCount` and
  `nonInvestmentTotalKrw`.

This is consistent with the current first-screen read-only goal. If a later net
worth screen needs total household assets, that should be a separate display
basis rather than changing this dashboard's investment headline.

## Needs-Decision Guardrails

The current `/` dashboard should continue not to import or query these Base44
entities directly:

| Entity | Current stance for `/` |
| --- | --- |
| `PortfolioSnapshot` | Do not add a route dependency. Current dashboard already has headline and trend sources. Use only if a later history screen proves a coverage gap. |
| `DailyGroupSnapshot` | Do not add a route dependency. Current dashboard uses current `asset_groups` labels only; group history can be derived or deferred. |
| `MacroSeries` | Do not add. Market factor work belongs under `/market` and `global_market_factors`. |
| `MarketSignal` | Do not add. Signal rows remain recommendation evidence, not portfolio dashboard source data. |
| `AssetFactorProfile` | Do not add. Factor profile ownership belongs to future ETF/factor/recommendation work. |

## Open Follow-Ups

No immediate code change is required from this audit. The current implementation
is coherent for read-only dashboard coverage.

Later candidates, still outside this pass:

- Add a read-only balance/history view that uses `account_balance_snapshots`.
- Add a read-only group exposure panel derived from
  `daily_position_snapshots` plus current group membership.
- Add a small legacy-only snapshot detail panel if data-health counts are not
  enough for user inspection.
- Move event filtering into SQL when event volume grows.
- Keep trend/MA evidence as snapshot or price-history evidence for future
  recommendation work; do not make `assets` a dumping ground for expanding
  historical indicators.

## Verification

This pass reviewed:

- `src/app/page.tsx`
- `src/lib/portfolio-dashboard.ts`
- `src/components/portfolio-dashboard.tsx`
- `src/lib/portfolio-return-metrics-core.ts`
- `docs/migration-coverage-audit.md`
- `docs/needs-decision-entity-resolution.md`

Because this is docs-only, use `git diff --check` for this change. Run
`npm run test`, `npm run lint`, and `npm run build` only if code, tests, or
runtime behavior changes in the same branch.
