# Market Context Read-Only Coverage

Last updated: 2026-07-08

Status: docs-only QA pass. This document does not add or change schema,
migrations, import scripts, routes, UI, API mutations, admin triggers, Cron/KIS
behavior, snapshot writers, cleanup, backfill, recommendation logic, risk
scoring, diversification scoring, or portfolio calculations.

Scope: the existing `/market` route only. This is not a new market UI
implementation and it does not authorize using market context as recommendation
or risk-scoring input.

## Current Route Shape

`src/app/market/page.tsx` is the market context route.

- It is a Server Component route with `dynamic = "force-dynamic"`.
- It calls `getReadOnlyMarketContext` on the server.
- It renders benchmark, market regime, duplicate regime group, and global
  factor sections from the server-built payload.
- There is no Base44 client, browser-side REST fetch, route mutation, admin
  trigger, provider call, KIS call, or write path in this route.

## Read Path

`src/db/queries/market-context.ts` is server-only and reads the database directly
with Drizzle/Neon.

| Table | Use in `/market` |
| --- | --- |
| `benchmark_snapshots` | Latest imported benchmark reference row for each requested benchmark ticker. |
| `market_regime_daily` | Latest imported market regime row per account, plus duplicate date/account context. |
| `global_market_factors` | Latest imported factor row per factor key, grouped by factor family. |

`src/lib/market-context.ts` is a pure selection/grouping helper. It does not
read or write the database.

Tables and data intentionally not read by `/market`:

- `assets`, `daily_position_snapshots`, and current portfolio holdings;
- `event_ledger_entries` and realized-return calculations;
- `MarketSignal` and recommendation signal rows;
- `AssetFactorProfile` and factor profile caches;
- recommendation, simulation, risk, or diversification output tables;
- KIS, Cron, snapshot writer, and admin mutation paths.

## Selection Rules

Benchmarks:

- Default requested tickers are `069500` and `VOO`.
- The route selects one latest row per ticker.
- Tie-break order is latest date, latest `base44_updated_at`, latest
  `updated_at`, latest `created_at`, then descending `legacy_base44_id`.
- Benchmarks are imported historical/reference rows, not live price source
  rows.

Market regime:

- The route selects one latest row per account.
- There is no imported `all` account row in `market_regime_daily`.
- Duplicate `(date, account)` groups are summarized as data quality context.
- Duplicate groups are not cleanup targets in this pass.
- The same tie-break rule is used inside duplicate groups and latest selection.

Global factors:

- The route selects one latest row per `factor_key`.
- Latest rows are grouped by `factor_family`.
- Each factor keeps its own date, source, and frequency because daily and
  monthly series do not share one global latest date.
- The first read-only UI displays scalar fields. `derived_metrics_json` remains
  out of the first UI except for future debug context.

## Production Smoke

Read-only production smoke was run against
`https://varda-labs.vercel.app/market` on 2026-07-08.

Access checks:

| Route | No auth | Basic Auth |
| --- | ---: | ---: |
| `/market` | 401 | 200 |

Render markers:

| Marker | Present |
| --- | --- |
| `Market Context` | yes |
| `Benchmarks` | yes |
| `Market Regime` | yes |
| `Global Factors` | yes |
| `Duplicate regime groups` | yes |
| `069500` | yes |
| `VOO` | yes |
| `fx` | yes |
| `policy_rate` | yes |

Credential scan:

- authenticated HTML high-risk credential pattern hits: none
- actual dashboard access value leak: false

## Read-Only Data Smoke

Read-only Neon data smoke on 2026-07-08:

### Benchmarks

| Check | Result |
| --- | ---: |
| `benchmark_snapshots` rows | 1,519 |
| date range | 2022-10-17 to 2026-06-24 |
| distinct benchmark tickers | 2 |
| duplicate `(benchmark_ticker, date)` groups | 0 |

Latest selected benchmark rows:

| Ticker | Name | Latest date | Source | Currency |
| --- | --- | --- | --- | --- |
| `069500` | KODEX 200 (KOSPI200 proxy) | 2026-06-24 | `kis` | KRW |
| `VOO` | Vanguard S&P 500 ETF | 2026-06-24 | `kis_overseas_dailyprice` | USD |

### Market Regime

| Check | Result |
| --- | ---: |
| `market_regime_daily` rows | 69 |
| date range | 2026-05-20 to 2026-07-05 |
| distinct accounts | 3 |
| null `account_id` rows | 0 |
| duplicate `(date, account)` groups | 3 |

Account distribution:

| Account | Rows | Date range |
| --- | ---: | --- |
| `brokerage` | 45 | 2026-05-20 to 2026-07-05 |
| `irp` | 12 | 2026-05-20 to 2026-06-30 |
| `isa` | 12 | 2026-05-20 to 2026-06-30 |

Duplicate groups:

| Date | Account | Rows | Selected legacy id |
| --- | --- | ---: | --- |
| 2026-06-24 | `brokerage` | 2 | `6a3b07e2a2410bd9e08fc3c0` |
| 2026-05-28 | `brokerage` | 2 | `6a176007c9d5251ff74daee4` |
| 2026-05-24 | `brokerage` | 2 | `6a12e48c734787c74201a7c4` |

Latest selected regime rows:

| Account | Latest date | Duplicate row count |
| --- | --- | ---: |
| `brokerage` | 2026-07-05 | 1 |
| `irp` | 2026-06-30 | 1 |
| `isa` | 2026-06-30 | 1 |

### Global Factors

| Check | Result |
| --- | ---: |
| `global_market_factors` rows | 2,401 |
| date range | 2025-06-01 to 2026-06-23 |
| distinct factor keys | 17 |
| distinct factor families | 4 |
| duplicate `(factor_key, date)` groups | 0 |

Family distribution:

| Family | Rows | Factor keys | Date range |
| --- | ---: | ---: | --- |
| `fx` | 1,280 | 5 | 2025-06-23 to 2026-06-23 |
| `policy_rate` | 401 | 4 | 2025-06-01 to 2026-06-23 |
| `sovereign_yield` | 470 | 7 | 2025-06-01 to 2026-06-18 |
| `yield_curve` | 250 | 1 | 2025-06-23 to 2026-06-22 |

Latest factor rows by family:

| Family | Latest factor rows | Earliest latest date | Latest latest date |
| --- | ---: | --- | --- |
| `fx` | 5 | 2026-06-23 | 2026-06-23 |
| `policy_rate` | 4 | 2026-04-01 | 2026-06-23 |
| `sovereign_yield` | 7 | 2026-03-16 | 2026-06-18 |
| `yield_curve` | 1 | 2026-06-22 | 2026-06-22 |

## Guardrails

The current `/market` route must remain:

- read-only;
- server-side;
- backed by `benchmark_snapshots`, `market_regime_daily`, and
  `global_market_factors`;
- disconnected from portfolio holdings, recommendation, risk, diversification,
  KIS, Cron, snapshots, and admin writes.

Do not add:

- schema migrations;
- FK or unique constraint hardening;
- duplicate cleanup/delete/backfill;
- new mutation routes;
- portfolio dashboard scoring panels;
- recommendation, risk, or diversification scoring based on market context;
- `MarketSignal` or `AssetFactorProfile` route dependencies.

## Follow-Ups

No immediate code change is required from this audit.

Later candidates, still outside this pass:

- add query-string controls only if users need to inspect custom benchmark
  tickers, accounts, or factor families;
- expose `derived_metrics_json` only in a clearly labeled debug/detail view;
- decide separately whether market context should feed recommendation/risk
  engines after pure helper boundaries and tests exist;
- keep duplicate market regime groups as evidence until a separate cleanup or
  source-priority policy is approved.

## Verification

This pass reviewed:

- `src/app/market/page.tsx`
- `src/db/queries/market-context.ts`
- `src/lib/market-context.ts`
- `docs/market-context-readonly-plan.md`
- `docs/data-integrity-audit.md`
- `docs/migration-coverage-audit.md`

Because this is docs-only, use `git diff --check` for this change. Run
`npm run test`, `npm run lint`, and `npm run build` only if code, tests, or
runtime behavior changes in the same branch.
