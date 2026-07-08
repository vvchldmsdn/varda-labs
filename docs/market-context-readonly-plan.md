# Market Context Read-Only Plan

Last updated: 2026-07-08

This document fixes the read-only display rules for imported market context
data. The current `/market` route coverage and production smoke results are
tracked in `docs/market-context-readonly-coverage.md`.

## Scope

Run:

```bash
npm run audit:market-context
```

The script:

- reads from `DATABASE_URL`
- writes no database rows
- changes no schema
- calls no production mutation API
- prints a JSON summary for `benchmark_snapshots`, `market_regime_daily`, and
  `global_market_factors`

## Latest Observation

Generated at: 2026-07-07T00:39:33Z.

### `benchmark_snapshots`

- rows: 1,519
- date range: 2022-10-17 to 2026-06-24
- tickers: 2
- currencies: KRW 901, USD 618
- sources: `kis` 901, `yahoo` 517, `kis_overseas_dailyprice` 101
- null `fx_rate` rows: 189
- duplicate `(benchmark_ticker, date)` groups: 0
- sample rows: 0

Ticker coverage:

| ticker | name | rows | date range | currency |
| --- | --- | ---: | --- | --- |
| `069500` | KODEX 200 (KOSPI200 proxy) | 901 | 2022-10-17 to 2026-06-24 | KRW |
| `VOO` | Vanguard S&P 500 ETF | 618 | 2024-01-05 to 2026-06-24 | USD |

Display rule:

- Use `069500` and `VOO` as the initial benchmark candidates.
- Display `close_price`, `normalized_index_value`, `fx_rate`, `source`, and
  `date`.
- Treat this as imported historical/reference data. Do not imply it is the live
  market price source.

### `market_regime_daily`

- rows: 69
- date range: 2026-05-20 to 2026-07-05
- accounts: brokerage 45, irp 12, isa 12
- labels: all 69 rows use the source stable/low-stress label
- null `account_id` rows: 0
- blank `description` rows: 69
- null `news_sentiment_score` rows: 69
- null portfolio metrics: 13 rows each for `avg_correlation`, `enb`, and
  `portfolio_volatility`
- `drivers_json` keys: `macro`, `news`, `portfolio`, all arrays
- duplicate `(date, account)` groups: 3, all `brokerage`

Duplicate groups:

| date | account | rows |
| --- | --- | ---: |
| 2026-06-24 | brokerage | 2 |
| 2026-05-28 | brokerage | 2 |
| 2026-05-24 | brokerage | 2 |

Display rule:

- Do not add a unique constraint yet.
- For read-only display, select one row per `(date, account)` with this
  deterministic ordering:
  1. latest `base44_updated_at`
  2. latest `updated_at`
  3. latest `created_at`
  4. descending `legacy_base44_id`
- Show duplicate count as data quality context if needed, not as a cleanup
  target.
- Account tabs can show latest row per account. There is no imported `all`
  account row in this table.

### `global_market_factors`

- rows: 2,401
- date range: 2025-06-01 to 2026-06-23
- factor keys: 17
- factor families: 4
- sources: ECB 1,280, FRED 1,109, ECOS 12
- frequencies: daily 2,306, monthly 95
- benchmark keys: 0; all `benchmark_key` rows are null
- blank `description` rows: 2,401
- preliminary rows: 0
- sample rows: 0
- duplicate `(factor_key, date)` groups: 0
- `derived_metrics_json` sample key: `source_series_id` as string in all rows

Family distribution:

| family | rows |
| --- | ---: |
| `fx` | 1,280 |
| `sovereign_yield` | 470 |
| `policy_rate` | 401 |
| `yield_curve` | 250 |

Display rule:

- Group by `factor_family`.
- Within each family, show the latest row per `factor_key`.
- Always show each factor's own `date`; do not assume a single global latest
  date because monthly and daily series differ.
- Display only scalar fields first: `value`, `change_pct`, `change_1m_pct`,
  `change_3m_pct`, `percentile_1y`, `volatility_20d_pct`, source, frequency.
- Keep `derived_metrics_json` out of the first UI except for optional debug
  context.

## Route Coverage

The first implementation is a separate `/market` read-only route.

Reason:

- Market context is reference data, not current portfolio holdings.
- The data has independent freshness and duplicate semantics.
- Keeping it separate avoids making the portfolio dashboard look more complete
  than the migrated calculations currently are.

The current screen is still a data-connection check, not a final design:

- latest benchmark table for `069500` and `VOO`
- latest market regime by account
- latest global factors grouped by family
- explicit as-of dates and sources
- small duplicate/context notice for `market_regime_daily`

See `docs/market-context-readonly-coverage.md` before extending this route.

## Still Prohibited

- No Cron/KIS/snapshot write path changes
- No `src/lib/snapshots/daily.ts` changes for this display step
- No schema migration, FK, or unique constraint
- No cleanup/delete/backfill
- No recommendation, risk scoring, or diversification connection
- No admin trigger or mutation API
