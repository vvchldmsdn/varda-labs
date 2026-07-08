# Needs-Decision Entity Resolution

Last updated: 2026-07-08

Status: docs-only resolution guidance. This document does not add schema,
migrations, import scripts, routes, UI, cleanup, backfill, or provider calls.

Source baseline: `docs/migration-coverage-audit.md`.

## Purpose

`docs/migration-coverage-audit.md` intentionally left several Base44 entities
as `needs_decision` because they overlap with already migrated tables, depend
on recommendation/factor product decisions, or failed Base44 fetches.

This document records the current migration stance for those entities so the
next product work does not re-open the same Base44 shape questions.

Coverage status remains `needs_decision` until a separate implementation step
either imports the data, marks it intentionally skipped, or replaces it with a
varda-native product model.

## Non-Goals

- no Drizzle schema
- no SQL migration
- no import script
- no data backfill or cleanup
- no UI route
- no recommendation engine or helper extraction
- no Cron/KIS/snapshot pipeline change
- no external data-source setup

## Resolution Summary

| Base44 entity | Current rows | Resolution stance | Next action |
| --- | ---: | --- | --- |
| `PortfolioSnapshot` | 57 | Fold/defer. Do not add `portfolio_snapshots` now. | Use `daily_portfolio_snapshots` and `account_balance_snapshots` for read-only totals. Revisit only if earlier total-history gaps become product-visible. |
| `DailyGroupSnapshot` | 23 | Derive/defer. Do not add `daily_group_snapshots` now. | Recompute current group views from `daily_position_snapshots`, `asset_groups`, and `asset_group_members`; import only if historical group drift/execution evidence is required. |
| `MacroSeries` | 20 | Fold into market factors unless a diff proves unique product value. | Prefer `global_market_factors`; no `macro_series` table now. |
| `MarketSignal` | 2 | Defer as recommendation evidence. | Do not create `market_signals` for two rows. Use recommendation docs before revisiting. |
| `AssetFactorProfile` | 27 | Defer until factor ownership/source semantics are designed. | Do not create `asset_factor_profiles` now. Treat as future factor/read-model work. |
| `MarketPriceDaily` | unavailable, 404 | Obsolete/replaced candidate. | Treat `asset_price_snapshots` as the migrated price-history source unless a new external source is approved. |
| `SecurityMaster` | unavailable, 404 | Replaced for ETF/reference scope. | Use `etf_masters` for the current ETF universe. Add generic securities only if non-ETF products need it. |
| `CompanyFundamentalSnapshot` | unavailable, 404 | External-source decision, not migration. | Skip until a fundamentals product surface and provider/source are approved. |
| `RebalanceRecommendation` | 65 | Covered by recommendation lane. | Do not resolve here; see recommendation docs. |
| `RecommendationRun` | 8 | Covered by recommendation lane. | Do not resolve here; see recommendation docs. |
| `RecommendationCandidate` | 82 | Covered by recommendation lane. | Do not resolve here; see recommendation docs. |

## Entity Notes

### `PortfolioSnapshot`

Current stance: fold/defer.

Reason:

- It stores account totals and grand total, which overlaps with
  `daily_portfolio_snapshots` and `account_balance_snapshots`.
- The imported daily portfolio rows already include account, market value,
  cost, return, FX, benchmark, and regime context.
- Adding a third portfolio-total snapshot table would make first read-only
  dashboard queries ambiguous.

Allowed future trigger:

- A read-only history screen proves that `PortfolioSnapshot` covers dates or
  totals that cannot be derived or reasonably displayed from the migrated daily
  portfolio/account-balance tables.

### `DailyGroupSnapshot`

Current stance: derive/defer.

Reason:

- It contains group-level weights, drift, and execution flags.
- Current group membership and asset/group mappings already exist in
  `asset_groups` and `asset_group_members`.
- Daily position rows preserve `legacy_group_id`, `group_name`, weights, and
  target-weight evidence, so first read-only group views can be derived.

Allowed future trigger:

- A historical audit UI needs to show exactly what Base44 stored for group
  drift/execution on each date, not a recomputed view.

### `MacroSeries`

Current stance: fold into `global_market_factors` unless proven otherwise.

Reason:

- `global_market_factors` already imports 2,401 rows across FX, policy-rate,
  sovereign-yield, and yield-curve families.
- `MacroSeries` has only 20 rows and overlaps conceptually with the imported
  factor time series.
- A separate `macro_series` table would duplicate market-context read paths.

Allowed future trigger:

- A read-only diff proves `MacroSeries` contains unique macro series that are
  not represented by `global_market_factors`, and the UI needs those series.

### `MarketSignal`

Current stance: defer as recommendation evidence.

Reason:

- There are only two Base44 rows.
- The rows are generated signal evidence, not canonical market data.
- Recommendation docs already decide not to create `recommendation_signals` or
  `market_signals` just for these rows.

Allowed future trigger:

- Imported recommendation runs need exact historical explainability, or signals
  become a reusable product surface.

### `AssetFactorProfile`

Current stance: defer until factor/read-model design.

Reason:

- It overlaps with ETF master, ETF holdings, market factors, and future
  recommendation/diversification scoring.
- The ownership of the profile is unclear: imported evidence, current cache, or
  regenerated scoring artifact.
- It should not block read-only dashboard work or the first recommendation
  run/items schema.

Allowed future trigger:

- ETF lookthrough or diversification screens need a stable per-asset factor
  profile, with source priority and refresh semantics defined first.

### `MarketPriceDaily`

Current stance: obsolete/replaced candidate.

Reason:

- Base44 fetch returned 404.
- `asset_price_snapshots` already imports `AssetPriceSnapshot` as the canonical
  historical price source, with ticker/date/source/FX fields preserved.

Allowed future trigger:

- A new source proves that `MarketPriceDaily` represented a different market
  series that `asset_price_snapshots` cannot cover.

### `SecurityMaster`

Current stance: replaced for current ETF/reference scope.

Reason:

- Base44 fetch returned 404.
- `etf_masters` already covers the current migrated ETF/reference universe.
- varda-labs has not yet defined a generic security master product surface for
  non-ETF securities.

Allowed future trigger:

- The app expands beyond ETF/reference data and needs a canonical generic
  securities table.

### `CompanyFundamentalSnapshot`

Current stance: skip/defer as unavailable external-source work.

Reason:

- Base44 fetch returned 404.
- No imported rows exist.
- Company fundamentals require a provider/source decision, freshness policy,
  and product surface. They are not a Base44 migration task by themselves.

Allowed future trigger:

- A fundamentals screen or scoring model is approved with a concrete provider
  and import policy.

## Recommendation Entities

Do not resolve recommendation entities in this document.

Use these documents instead:

- `docs/recommendation-model-audit.md`
- `docs/recommendation-schema-proposal.md`
- `docs/recommendation-implementation-plan.md`

Current recommendation stance:

- no recommendation schema or import now;
- future first lane is varda-native `recommendation_runs` and
  `recommendation_items`;
- `RebalanceRecommendation.items_json` remains raw legacy evidence unless a
  historical recommendation UI explicitly needs normalized rows;
- `MarketSignal` and `AssetFactorProfile` remain deferred.

## Current Read-Only Work Direction

After this resolution pass, the next low-risk product work is read-only query
coverage from already migrated tables. The current `/` portfolio dashboard
coverage is tracked in `docs/portfolio-dashboard-readonly-coverage.md`:

- portfolio totals from `daily_portfolio_snapshots` and
  `account_balance_snapshots`;
- holdings and movement from `daily_position_snapshots`, `assets`, and
  `event_ledger_entries`;
- ETF reference/lookthrough from `etf_masters` and `etf_holdings`;
- market context from `benchmark_snapshots`, `market_regime_daily`, and
  `global_market_factors`.

Do not add schema or import scripts just to satisfy old Base44 entity names.
