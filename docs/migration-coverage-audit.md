# Base44 Migration Coverage Audit

Last updated: 2026-07-06

Source inventory: `C:\Users\Eunwoo_2\Desktop\gyeol-fin\migration-data\base44-full-entity-inventory.json`

This audit classifies every Base44 entity definition from the inventory into one of four states:

- `migrated`: already represented in varda-labs schema/import scripts.
- `pending`: should be migrated with a clear table/function target.
- `intentionally_skipped`: no Base44 rows exist now, so no schema/import should be added yet.
- `needs_decision`: the source is unavailable, overlaps with migrated data, or depends on a product/engine decision before importing.

Sensitive Settings values are intentionally not included here. This document uses entity names, counts, field names, and mapping decisions only.

## Summary

| Status | Entities | Rows represented |
| --- | ---: | ---: |
| `migrated` | 9 | 13,786 |
| `pending` | 9 | 14,629 |
| `intentionally_skipped` | 17 | 0 |
| `needs_decision` | 11 | 284 plus 3 unavailable entities |

Inventory totals:

- Entity definitions: 46
- Fetch OK: 43
- Fetch failed: 3 (`CompanyFundamentalSnapshot`, `MarketPriceDaily`, `SecurityMaster`, all 404)
- Already imported nonzero Base44 entities: `AccountBalance`, `Asset`, `AssetGroup`, `AssetPriceSnapshot`, `BenchmarkSnapshot`, `DailyPortfolioSnapshot`, `DailyPositionSnapshot`, `FxRate`, `Settings`

## Coverage Matrix

| Base44 entity | Status | Rows | Date range | varda-labs mapping | Notes |
| --- | --- | ---: | --- | --- | --- |
| `AccountBalance` | `migrated` | 3 | 2026-02-18 to 2026-02-26 | `account_balance_snapshots` | Imported by `scripts/import-base44-history.mjs` with `legacy_base44_id`. |
| `Asset` | `migrated` | 19 | 2026-02-18 to 2026-06-22 | `assets`, derived `accounts` | UUID primary keys are retained; Base44 ids are in `assets.legacy_base44_id`. |
| `AssetFactorEstimate` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. Add only if future factor-estimate history appears. |
| `AssetFactorProfile` | `needs_decision` | 27 | 2026-06-23 to 2026-07-01 | candidate: `asset_factor_profiles` or fold into ETF/factor analytics | Nonzero and useful for diversification, but overlaps with `EtfMaster`, `EtfHolding`, and future factor models. Decide whether this is imported source data or regenerated analysis output. |
| `AssetGroup` | `migrated` | 1 | 2026-03-19 | `asset_groups`, derived `asset_group_members` | Imported by core import. Empty member priority/ratio JSON was not separately modeled. |
| `AssetPriceSnapshot` | `migrated` | 11,284 | 2022-10-17 to 2026-07-03 | `asset_price_snapshots` | Imported by `scripts/import-base44-market-data.mjs`. `asset_id` is nullable; ticker/date and price source are preserved for unmatched tickers. |
| `BacktestValidationRun` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `BenchmarkSnapshot` | `migrated` | 1,519 | 2022-10-17 to 2026-06-24 | `benchmark_snapshots` | Imported by `scripts/import-base44-market-data.mjs`. This is raw benchmark history; the benchmark columns in `daily_portfolio_snapshots` remain aggregate output. |
| `CompanyFundamentalSnapshot` | `needs_decision` | unavailable | 404 | candidate external source or skip | Base44 fetch failed. Decide whether varda-labs needs company fundamentals independently of Base44. |
| `DailyGroupSnapshot` | `needs_decision` | 23 | 2026-03-24 to 2026-07-05 | candidate `daily_group_snapshots` or derive from `daily_position_snapshots` | Contains group-level weights/drift/execution flags. It may be recomputable, but importing preserves historical audit output. |
| `DailyPortfolioSnapshot` | `migrated` | 74 | 2026-05-20 to 2026-07-05 | `daily_portfolio_snapshots` | Imported by history import. |
| `DailyPositionSnapshot` | `migrated` | 418 | 2026-03-24 to 2026-07-05 | `daily_position_snapshots` | Imported with nullable `asset_id`; `legacy_asset_id`, `ticker`, `asset_name`, and `snapshot_date` are preserved so the 52 unmatched rows are not dropped. |
| `EngineContextSnapshot` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `EtfCandidateRun` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `EtfHolding` | `pending` | 10,872 | 2026-04-19 to 2026-07-03 | proposed `etf_holdings` | High-priority next candidate after `EtfMaster`. Preserve `legacy_base44_id`, `legacy_etf_id`, `etf_ticker`, holding identity, sector/country/market, rank, weight, shares, market value, source, and `as_of_date`. |
| `EtfLookthroughRun` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `EtfMaster` | `pending` | 1,202 | 2026-04-19 to 2026-04-20 | proposed `etf_masters` | High-priority next candidate. Import before `EtfHolding`; use JSONB for tag/exposure/substitute/top10 fields while keeping searchable scalar columns. |
| `EtfSyncJob` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `EventLedger` | `pending` | 51 | 2026-04-28 to 2026-07-02 | proposed `event_ledger_entries` | High-priority next candidate before any write/rebalance UI. Preserve historical `asset_id`/`group_id` as legacy ids plus nullable current UUID mappings. |
| `FixedTransaction` | `pending` | 7 | 2026-02-18 to 2026-02-19 | proposed `fixed_transactions` | Clear cashflow table, lower priority than market/ETF/ledger data. |
| `FxRate` | `migrated` | 467 | 2024-10-07 to 2026-07-05 | `fx_rates` | Imported by history import. |
| `GlobalMarketFactor` | `pending` | 2,401 | 2025-06-01 to 2026-06-23 | proposed `global_market_factors` | Priority market-context candidate. Use scalar fields for key/date/value/change/volatility and JSONB for derived metrics. |
| `Goal` | `pending` | 1 | 2026-03-18 | proposed `goals` | Clear mapping, but not required for read-only dashboard v1. |
| `MacroSeries` | `needs_decision` | 20 | 2025-10-01 to 2026-06-22 | candidate `macro_series` or merge into `global_market_factors` | Overlaps with `GlobalMarketFactor`. Decide whether to keep a separate macro-source table or normalize both into one factor time-series model. |
| `MarketPriceDaily` | `needs_decision` | unavailable | 404 | likely replaced by `asset_price_snapshots` | Base44 fetch failed. Decide whether this legacy entity is obsolete once `AssetPriceSnapshot` is imported. |
| `MarketRegimeDaily` | `pending` | 69 | 2026-05-20 to 2026-07-05 | proposed `market_regime_daily` | Priority market-context candidate. Preserve `drivers_json`, scores, labels, and account/date. |
| `MarketSignal` | `needs_decision` | 2 | 2026-04-20 to 2026-04-21 | candidate `market_signals` or generated insights | Only two rows. Decide whether historical signals are source-of-record data or derived/recomputed output. |
| `MonthlyIncome` | `pending` | 12 | 2026-02-18 | proposed `monthly_incomes` | Clear cashflow table, lower priority than market/ETF/ledger data. |
| `NewsSentimentDaily` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `PortfolioOptimizationRun` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `PortfolioSimulationRun` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `PortfolioSnapshot` | `needs_decision` | 57 | 2026-02-26 to 2026-07-01 | candidate `portfolio_snapshots` or fold into `daily_portfolio_snapshots` / `account_balance_snapshots` | It stores account totals and grand total. It overlaps with migrated portfolio/balance snapshots but may backfill earlier total history. |
| `PositionSnapshot` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows; `DailyPositionSnapshot` is the imported position history. |
| `RebalanceRecommendation` | `needs_decision` | 65 | 2026-05-20 to 2026-07-05 | candidate `rebalance_recommendations` | Decide whether to preserve legacy recommendation output or recompute under the future varda-labs engine. |
| `RebalanceReview` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `RecommendationCandidate` | `needs_decision` | 82 | 2026-04-20 to 2026-04-21 | candidate `recommendation_candidates` | Tied to recommendation runs. Import only if preserving historical recommendation explainability. |
| `RecommendationRun` | `needs_decision` | 8 | 2026-04-20 to 2026-04-21 | candidate `recommendation_runs` | Tied to generated recommendation outputs and engine config. Needs decision with recommendation strategy. |
| `ScenarioRun` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `SecurityMaster` | `needs_decision` | unavailable | 404 | likely replaced by `etf_masters`; future candidate `securities` | Base44 fetch failed. Decide whether generic security master data is needed beyond ETF master/reference tables. |
| `Settings` | `migrated` | 1 | 2026-02-18 | `settings` | Imported by sanitized allowlist only. KIS token-related fields are excluded. |
| `SimulationCalibration` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `SimulationChunk` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `SimulationJob` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `SimulationRunResult` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `SimulationSampleShard` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `Transaction` | `pending` | 14 | 2026-02-11 to 2026-03-01 | proposed `transactions` | Clear cashflow/expense table, lower priority than market/ETF/ledger data. |

## Priority Candidate Review

### 1. `AssetPriceSnapshot` to `asset_price_snapshots`

Status: migrated on 2026-07-06 by `scripts/import-base44-market-data.mjs`.

Why this was migrated first:

- Largest price-history source for portfolio charts, trend checks, and historical valuation.
- Does not require the Base44 functions to be ported.
- Schema is straightforward and can be imported independently.

Proposed columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Keys: `price_date date`, `ticker varchar(50)`, nullable `asset_id uuid`
- Attributes: `market`, `currency`, `source`, `is_sample`
- Values: `close_price`, `adjusted_close_price`, `close_price_krw`, `fx_rate`
- Timestamps: `base44_created_at`, `base44_updated_at`, `created_at`, `updated_at`
- Indexes: `(ticker, price_date)`, `price_date`, optional `(asset_id, price_date)`

Import note: match `asset_id` by `assets.ticker` where possible, but keep ticker/date even when no current asset matches.

### 2. `BenchmarkSnapshot` to `benchmark_snapshots`

Status: migrated on 2026-07-06 by `scripts/import-base44-market-data.mjs`.

Why this was migrated first:

- Complements asset prices for portfolio-relative performance.
- The benchmark fields inside `daily_portfolio_snapshots` are aggregate outputs, not a full benchmark time series.

Proposed columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Keys: `benchmark_ticker`, `benchmark_name`, `benchmark_date`
- Attributes: `currency`, `source`, `is_sample`
- Values: `close_price`, `normalized_index_value`, `fx_rate`
- Timestamps and indexes: same Base44 timestamp pattern, index `(benchmark_ticker, benchmark_date)`

### 3. `EtfMaster` to `etf_masters`

Why next:

- Parent/reference table for `EtfHolding`.
- Needed before lookthrough, ETF search, diversification, and future recommendation work.

Proposed columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Searchable scalars: `ticker`, `name`, `market`, `exchange`, `currency`, `issuer`, `isin`, `asset_class`, `category_label`, `benchmark_name`, `expense_ratio`, `aum`, `average_volume`, `dividend_yield`, `risk_level`, `is_active`, `is_universe_pick`
- Strategy/risk scalars: `region_focus`, `currency_exposure`, `is_currency_hedged`, `is_inverse`, `is_leveraged`, `leverage_type`, `leverage_factor`
- JSONB fields: `account_suitability_json`, `currency_exposure_json`, `region_exposure_json`, `sector_exposure_json`, `region_tags_json`, `sector_tags_json`, `style_tags_json`, `theme_tags_json`, `substitutes_json`, `top10_holdings_json`
- Indexes: unique `legacy_base44_id`, unique or partial index on `(ticker, market)`, plus `is_active`

### 4. `EtfHolding` to `etf_holdings`

Why next:

- Enables ETF lookthrough and exposure analysis without bringing over Base44 functions.
- Has a clear parent relation to `EtfMaster`.

Proposed columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Parent mapping: nullable `etf_master_id uuid`, `legacy_etf_id varchar(24)`, `etf_ticker`, `etf_name`
- Holding identity: `holding_symbol`, `holding_name`, `security_type`, `holding_market`, `holding_country`
- Classification: `sector`, `industry`, `currency`, `is_top10`, `rank`
- Values: `weight_pct`, `shares`, `market_value`
- Source: `source`, `source_url`, `notes`, `last_synced_at`, `as_of_date`
- Indexes: `(etf_ticker, as_of_date)`, `(legacy_etf_id, as_of_date)`, `(holding_symbol)`

Import note: preserve `legacy_etf_id` even if `etf_master_id` cannot be resolved.

### 5. `EventLedger` to `event_ledger_entries`

Why next:

- Small row count and high audit value.
- Should be imported before any write, transaction, rebalance, or correction UI.

Proposed columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Event keys: `event_date`, `event_type`, `source`, `rule_version`, `recorded_at`
- Optional mappings: `account_id`, `asset_id`, `group_id`, plus raw `account`, `legacy_asset_id`, `asset_name`, `ticker`, `legacy_group_id`, `group_name`
- Values: `amount_krw`, `quantity_delta`, `price`, `fx_rate`, `before_value`, `after_value`
- Correction link: `legacy_corrects_event_id`, later nullable `corrects_event_id`
- Notes: `memo`, `description`, `is_sample`

Import note: all current UUID FKs should be nullable. Historical events may reference assets/groups that are no longer present.

### 6. `MarketRegimeDaily` to `market_regime_daily`

Why next:

- Gives read-only dashboard context without porting `calcDiversification` or recommendation functions.
- Aligns with fields already copied into `daily_portfolio_snapshots`.

Proposed columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Keys: `regime_date date`, `account varchar(50)`, nullable `account_id uuid`
- Scores: `regime_score`, `macro_stress_score`, `news_sentiment_score`, `avg_correlation`, `enb`, `portfolio_volatility`, `stress_badge_count`
- Labels: `label`, `yield_curve`, `rate_level`, `description`
- JSONB: `drivers_json`
- Indexes: `(regime_date, account)`, `regime_date`

### 7. `GlobalMarketFactor` to `global_market_factors`

Why next:

- Provides macro/factor time series for market context.
- Likely more complete than `MacroSeries` and should drive the first market-factor schema decision.

Proposed columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Keys: `factor_date`, `factor_key`, `factor_family`, `benchmark_key`, `source_series_id`, `frequency`
- Attributes: `factor_name`, `country_code`, `region`, `related_currency`, `tenor`, `source`, `description`, `is_preliminary`, `is_sample`
- Values: `value`, `prev_value`, `change_pct`, `change_1m_pct`, `change_3m_pct`, `change_6m_pct`, `change_speed_20d`, `percentile_1y`, `volatility_20d_pct`, `volatility_60d_pct`, `carry_spread_value`
- Dates/times: `period_end_date`, `release_date`, `observed_at`
- JSONB: `derived_metrics_json`
- Indexes: `(factor_key, factor_date)`, `factor_date`, `factor_family`

## Recommended Next Migration Order

1. Add ETF reference and lookthrough:
   - Schema/import: `etf_masters`, then `etf_holdings`
   - Script: `scripts/import-base44-etf-reference.mjs`
   - Rationale: `EtfHolding` depends on `EtfMaster`; both unlock lookthrough/diversification views.

2. Add event audit trail:
   - Schema/import: `event_ledger_entries`
   - Script: either separate `scripts/import-base44-events.mjs` or included with a future finance-ledger import.
   - Rationale: preserves historical decisions and corrections before any interactive write workflow.

3. Add market context:
   - Schema/import: `market_regime_daily`, `global_market_factors`
   - Script: `scripts/import-base44-market-context.mjs`
   - Rationale: useful for read-only explanations and future recommendation context, but less blocking than raw prices/ETF reference.

4. Add goals and cashflow:
   - Schema/import: `goals`, `transactions`, `fixed_transactions`, `monthly_incomes`
   - Rationale: clear mappings, but not required for the initial read-only portfolio dashboard.

5. Resolve `needs_decision` entities:
   - `PortfolioSnapshot`: import only if earlier account-total history is required.
   - `DailyGroupSnapshot`: import only if historical group-level drift/execution output must be preserved.
   - `AssetFactorProfile`: decide after ETF/reference data model is in place.
   - `MacroSeries` and `MarketSignal`: decide whether to merge into market-factor/signal models.
   - Recommendation entities: decide whether legacy recommendations are audit history or should be regenerated by a varda-labs engine.
   - 404 entities: treat `MarketPriceDaily` as superseded by `AssetPriceSnapshot` unless a new source is found; treat `SecurityMaster` as superseded by `EtfMaster` unless generic securities are needed.

## Import Rules To Carry Forward

- Keep existing UUID primary keys in varda-labs.
- Store Base44 ids as `legacy_base44_id varchar(24)` and make them unique.
- Use nullable UUID FKs for imported historical data when the referenced asset/account/group may not exist in current tables.
- Preserve raw legacy identifiers such as `legacy_asset_id`, `legacy_group_id`, and `legacy_etf_id`.
- Default import scripts to dry-run; write only with `--write`.
- Use explicit allowlists for Settings and sensitive-prone entities.
- Do not import Base44 tokens, API keys, owner ids, or user ids.
- Prefer practical tables plus JSONB for structured JSON fields over over-normalizing the first import pass.
