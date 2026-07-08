# Base44 Migration Coverage Audit

Last updated: 2026-07-08

Source inventory: `C:\Users\Eunwoo_2\Desktop\gyeol-fin\migration-data\base44-full-entity-inventory.json`

This audit classifies every Base44 entity definition from the inventory into one of four states:

- `migrated`: already represented in varda-labs schema/import scripts.
- `pending`: should be migrated with a clear table/function target.
- `intentionally_skipped`: no Base44 rows exist now, so no schema/import should be added yet.
- `needs_decision`: the source is unavailable, overlaps with migrated data, or depends on a product/engine decision before importing.

Sensitive Settings values are intentionally not included here. This document uses entity names, counts, field names, and mapping decisions only.

Resolution guidance for the remaining `needs_decision` entities lives in
`docs/needs-decision-entity-resolution.md`. The coverage statuses below remain
unchanged until a separate implementation step imports, skips, or replaces each
entity.

History/balance read-only source-of-truth guidance lives in
`docs/history-balance-readonly-design.md`.

Simulation and investment lab job/artifact guidance lives in
`docs/simulation-investment-lab-model-audit.md`.

## Summary

| Status | Entities | Rows represented |
| --- | ---: | ---: |
| `migrated` | 18 | 28,415 |
| `pending` | 0 | 0 |
| `intentionally_skipped` | 17 | 0 |
| `needs_decision` | 11 | 284 plus 3 unavailable entities |

Inventory totals:

- Entity definitions: 46
- Fetch OK: 43
- Fetch failed: 3 (`CompanyFundamentalSnapshot`, `MarketPriceDaily`, `SecurityMaster`, all 404)
- Already imported nonzero Base44 entities: `AccountBalance`, `Asset`, `AssetGroup`, `AssetPriceSnapshot`, `BenchmarkSnapshot`, `DailyPortfolioSnapshot`, `DailyPositionSnapshot`, `EtfHolding`, `EtfMaster`, `EventLedger`, `FixedTransaction`, `FxRate`, `GlobalMarketFactor`, `Goal`, `MarketRegimeDaily`, `MonthlyIncome`, `Settings`, `Transaction`

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
| `EtfHolding` | `migrated` | 10,872 | 2026-03-31 to 2026-07-03 | `etf_holdings` | Imported by `scripts/import-base44-etf-reference.mjs`. `legacy_etf_id`, `etf_ticker`, holding identity, sector/country/market, rank, weight, shares, market value, source, and `as_of_date` are preserved. |
| `EtfLookthroughRun` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `EtfMaster` | `migrated` | 1,202 | 2026-04-19 to 2026-04-20 | `etf_masters` | Imported by `scripts/import-base44-etf-reference.mjs`. JSON tag/exposure/substitute/top10 fields are stored as JSONB while searchable scalar columns remain separate. |
| `EtfSyncJob` | `intentionally_skipped` | 0 | none | none for now | No Base44 rows. |
| `EventLedger` | `migrated` | 51 | 2026-04-28 to 2026-07-02 | `event_ledger_entries` | Imported by `scripts/import-base44-events.mjs`. Preserves historical `asset_id`/`group_id` as legacy ids plus nullable current UUID mappings and raw before/after values. |
| `FixedTransaction` | `migrated` | 7 | 2026-02-18 to 2026-02-19 | `fixed_transactions` | Imported by `scripts/import-base44-cashflow-goals.mjs` with recurrence day, holiday shift, active flag, type/category/name, and amount. |
| `FxRate` | `migrated` | 467 | 2024-10-07 to 2026-07-05 | `fx_rates` | Imported by history import. |
| `GlobalMarketFactor` | `migrated` | 2,401 | 2025-06-01 to 2026-06-23 | `global_market_factors` | Imported by `scripts/import-base44-market-context.mjs`. Scalar factor keys/date/value/change fields are separated and `derived_metrics_json` is stored as JSONB. |
| `Goal` | `migrated` | 1 | 2026-03-18 | `goals` | Imported by `scripts/import-base44-cashflow-goals.mjs` for source preservation. The source title is empty, so UI usage should remain opt-in until a new goal model is designed. |
| `MacroSeries` | `needs_decision` | 20 | 2025-10-01 to 2026-06-22 | candidate `macro_series` or merge into `global_market_factors` | Overlaps with `GlobalMarketFactor`. Decide whether to keep a separate macro-source table or normalize both into one factor time-series model. |
| `MarketPriceDaily` | `needs_decision` | unavailable | 404 | likely replaced by `asset_price_snapshots` | Base44 fetch failed. Decide whether this legacy entity is obsolete once `AssetPriceSnapshot` is imported. |
| `MarketRegimeDaily` | `migrated` | 69 | 2026-05-20 to 2026-07-05 | `market_regime_daily` | Imported by `scripts/import-base44-market-context.mjs`. Preserves `drivers_json` as JSONB plus scores, labels, account/date, and nullable current account mapping. |
| `MarketSignal` | `needs_decision` | 2 | 2026-04-20 to 2026-04-21 | candidate `market_signals` or generated insights | Only two rows. Decide whether historical signals are source-of-record data or derived/recomputed output. |
| `MonthlyIncome` | `migrated` | 12 | 2026-02-18 | `monthly_incomes` | Imported by `scripts/import-base44-cashflow-goals.mjs` with year/month/pay day and nullable actual amount. |
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
| `Transaction` | `migrated` | 14 | 2026-02-11 to 2026-03-01 | `transactions` | Imported by `scripts/import-base44-cashflow-goals.mjs`. Raw account is preserved and `account_id` is nullable because most rows have no account. |

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

Status: migrated on 2026-07-06 by `scripts/import-base44-etf-reference.mjs`.

Why this was migrated next:

- Parent/reference table for `EtfHolding`.
- Needed before lookthrough, ETF search, diversification, and future recommendation work.

Proposed columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Searchable scalars: `ticker`, `name`, `market`, `exchange`, `currency`, `issuer`, `isin`, `asset_class`, `category_label`, `benchmark_name`, `expense_ratio`, `aum`, `average_volume`, `dividend_yield`, `risk_level`, `is_active`, `is_universe_pick`
- Strategy/risk scalars: `region_focus`, `currency_exposure`, `is_currency_hedged`, `is_inverse`, `is_leveraged`, `leverage_type`, `leverage_factor`
- JSONB fields: `account_suitability_json`, `currency_exposure_json`, `region_exposure_json`, `sector_exposure_json`, `region_tags_json`, `sector_tags_json`, `style_tags_json`, `theme_tags_json`, `substitutes_json`, `top10_holdings_json`
- Indexes: unique `legacy_base44_id`, unique or partial index on `(ticker, market)`, plus `is_active`

### 4. `EtfHolding` to `etf_holdings`

Status: migrated on 2026-07-06 by `scripts/import-base44-etf-reference.mjs`.

Why this was migrated next:

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
Read-only UI note: use `docs/etf-holdings-readonly-semantics.md` before
displaying holdings. Duplicate holding identity rows are migration evidence and
should not be cleaned up or hidden by default. Current `/etfs` route coverage is
tracked in `docs/etf-reference-readonly-coverage.md`.

### 5. `EventLedger` to `event_ledger_entries`

Status: migrated on 2026-07-06 by `scripts/import-base44-events.mjs`.

Why this was migrated next:

- Small row count and high audit value.
- Should be imported before any write, transaction, rebalance, or correction UI.

Implemented columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Event keys: `event_date`, `event_type`, `source`, `rule_version`, `recorded_at`
- Optional mappings: `account_id`, `asset_id`, `group_id`, plus raw `account`, `legacy_asset_id`, `asset_name`, `ticker`, `legacy_group_id`, `group_name`
- Values: `amount_krw`, `quantity_delta`, `price`, `fx_rate`, `before_value`, `after_value`
- Correction link: `legacy_corrects_event_id`, nullable `corrects_event_id`
- Notes: `memo`, `description`, `is_sample`

Import note: all current UUID mappings are nullable. Historical events may reference assets/groups that are no longer present, so raw legacy ids and raw before/after strings are preserved.

### 6. `MarketRegimeDaily` to `market_regime_daily`

Status: migrated on 2026-07-06 by `scripts/import-base44-market-context.mjs`.

Why this was migrated next:

- Gives read-only dashboard context without porting `calcDiversification` or recommendation functions.
- Aligns with fields already copied into `daily_portfolio_snapshots`.

Implemented columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Keys: `date`, `account varchar(50)`, nullable `account_id uuid`
- Scores: `regime_score`, `macro_stress_score`, `news_sentiment_score`, `avg_correlation`, `enb`, `portfolio_volatility`, `stress_badge_count`
- Labels: `label`, `yield_curve`, `rate_level`, `description`
- JSONB: `drivers_json`
- Indexes: `(date, account)`, `(account, date)`

Read-only UI note: current `/market` route coverage is tracked in
`docs/market-context-readonly-coverage.md`.

### 7. `GlobalMarketFactor` to `global_market_factors`

Status: migrated on 2026-07-06 by `scripts/import-base44-market-context.mjs`.

Why this was migrated next:

- Provides macro/factor time series for market context.
- Likely more complete than `MacroSeries` and should drive the first market-factor schema decision.

Implemented columns:

- Identity: `id uuid`, `legacy_base44_id varchar(24) unique`
- Keys: `date`, `factor_key`, `factor_family`, `benchmark_key`, `source_series_id`, `frequency`
- Attributes: `factor_name`, `country_code`, `region`, `related_currency`, `tenor`, `source`, `description`, `is_preliminary`, `is_sample`
- Values: `value`, `prev_value`, `change_pct`, `change_1m_pct`, `change_3m_pct`, `change_6m_pct`, `change_speed_20d`, `percentile_1y`, `volatility_20d_pct`, `volatility_60d_pct`, `carry_spread_value`
- Dates/times: `period_end_date`, `release_date`, `observed_at`
- JSONB: `derived_metrics_json`
- Indexes: `(factor_key, date)`, `date`, `(factor_family, date)`

Read-only UI note: current `/market` route coverage is tracked in
`docs/market-context-readonly-coverage.md`.

## Recommended Next Migration Order

0. Freeze the Base44 structure decisions before new feature work:
   - Use `docs/base44-structure-audit.md` and
     `docs/migration-modeling-guidelines.md` before adding schema or porting
     functions.
   - Treat Base44 as historical evidence and behavior reference, not as the
     target Postgres model.
   - Keep Cron/KIS/snapshot write paths unchanged until the next automation
     validation gate is complete.

1. Use `docs/needs-decision-entity-resolution.md` before adding any schema for
   remaining `needs_decision` entities:
   - `PortfolioSnapshot`: fold/defer into migrated portfolio/balance snapshots.
   - `DailyGroupSnapshot`: derive/defer from position snapshots and group
     membership unless exact historical group output becomes a product need.
   - `MacroSeries`: fold into `global_market_factors` unless a diff proves
     unique product value.
   - `MarketSignal`: defer as recommendation evidence.
   - `AssetFactorProfile`: defer until factor/read-model ownership and refresh
     semantics are designed.
   - 404 entities: treat `MarketPriceDaily` as replaced by
     `asset_price_snapshots`; treat `SecurityMaster` as replaced by
     `etf_masters` for the current ETF scope; treat
     `CompanyFundamentalSnapshot` as an external-source decision.
   - Recommendation entities: use `docs/recommendation-model-audit.md`,
     `docs/recommendation-schema-proposal.md`, and
     `docs/recommendation-implementation-plan.md`; do not resolve them here.

2. Keep read-only product work tied to migrated source-of-truth tables:
   - The existing `/` portfolio dashboard coverage is documented in
     `docs/portfolio-dashboard-readonly-coverage.md`.
   - Treat that route as a data-connection dashboard, not a fresh Base44
     `Portfolio.jsx` port.
   - Do not pull `PortfolioSnapshot`, `DailyGroupSnapshot`, `MacroSeries`,
     `MarketSignal`, or `AssetFactorProfile` into the dashboard query path
     without a separate product decision.
   - Keep legacy `Goal` data out of first-screen UI unless a new goal product model is defined.

## Import Rules To Carry Forward

- Keep existing UUID primary keys in varda-labs.
- Store Base44 ids as `legacy_base44_id varchar(24)` and make them unique.
- Use nullable UUID FKs for imported historical data when the referenced asset/account/group may not exist in current tables.
- Preserve raw legacy identifiers such as `legacy_asset_id`, `legacy_group_id`, and `legacy_etf_id`.
- Default import scripts to dry-run; write only with `--write`.
- Use explicit allowlists for Settings and sensitive-prone entities.
- Do not import Base44 tokens, API keys, owner ids, or user ids.
- Prefer practical tables plus JSONB for structured JSON fields over over-normalizing the first import pass.
