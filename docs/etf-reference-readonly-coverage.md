# ETF Reference Read-Only Coverage

Last updated: 2026-07-08

Status: docs-only QA pass. This document does not add or change schema,
migrations, import scripts, routes, UI, API mutations, admin triggers, Cron/KIS
behavior, snapshot writers, cleanup, backfill, recommendation logic, risk
scoring, or portfolio lookthrough calculations.

Scope: the existing `/etfs` route only. This is not a new ETF UI
implementation and it does not authorize using ETF holdings as portfolio
exposure or recommendation input.

## Current Route Shape

`src/app/etfs/page.tsx` is the ETF reference route.

- It is a Server Component route with `dynamic = "force-dynamic"`.
- It reads `searchParams.q`, `searchParams.ticker`,
  `searchParams.etfMasterId`, `searchParams.id`, and
  `searchParams.asOfDate`.
- It searches ETF masters with `searchReadOnlyEtfMasters`.
- It resolves the selected ETF master from an explicit id, a ticker match, or
  the first search result.
- It loads holdings with `getReadOnlyEtfHoldings`.
- There is no Base44 client, browser-side REST fetch, route mutation, admin
  trigger, provider call, or write path in this route.

## Read Path

`src/db/queries/etf-holdings.ts` is server-only and reads the database directly
with Drizzle/Neon.

| Table | Use in `/etfs` |
| --- | --- |
| `etf_masters` | Search/list source for ticker, name, market, currency, issuer, asset class, category, active flag, and universe flag. |
| `etf_holdings` | Selected ETF holdings source for one ETF/date, preserving raw rows and grouping duplicate identity candidates for display. |

`src/lib/etf-holdings.ts` is a pure grouping helper. It does not read or write
the database.

Tables and data intentionally not read by `/etfs`:

- `assets`, `daily_position_snapshots`, and portfolio holdings calculations;
- `AssetFactorProfile` and factor profile caches;
- `MarketSignal` and recommendation signal rows;
- `event_ledger_entries`, recommendation run/candidate data, and simulation
  data;
- KIS, Cron, snapshot writer, and admin mutation paths.

## Selection Rules

Master search:

- Empty search returns the first page ordered by universe pick, active flag,
  ticker, and market.
- Non-empty search matches ticker, name, issuer, or category label.
- The route caps master results through the query helper limit.

Selected ETF:

- Explicit `etfMasterId` or `id` wins.
- If `ticker` is provided, the route selects the first searched master whose
  ticker exactly matches after uppercasing.
- Otherwise, the first search result is selected.

Holdings date:

- Explicit `asOfDate` wins.
- Otherwise, `getReadOnlyEtfHoldings` selects the latest `etf_holdings.as_of_date`
  for the selected `etf_master_id`; ticker fallback is used only when no master
  id is available.

## Grouped Display Rules

`groupEtfHoldingRows` groups raw holdings by this display identity:

```text
etf_ticker + as_of_date + coalesce(holding_symbol, "(null)") + holding_name
```

This key is a read-only display heuristic, not a database identity or future
unique constraint.

The grouped result exposes:

- `rawRowCount`
- `groupedRowCount`
- `duplicateGroupCount`
- grouped rows
- raw rows behind each group

Display rules:

- Duplicate identity groups remain visible through raw-row count badges and
  expandable raw row details.
- `weight_pct` is summed only when the group has one source.
- `shares` and `market_value` are summed only when source and currency are not
  mixed.
- mixed source or mixed currency groups show a grouped status instead of a
  misleading numeric sum.
- rank displays the minimum non-null rank and flags disagreement.
- text fields display the value only when all raw rows agree; otherwise they
  display `mixed`.

Duplicate rows are migration evidence and display evidence. They are not
cleanup targets in this pass.

## Production Smoke

Read-only production smoke was run against
`https://varda-labs.vercel.app` on 2026-07-08.

Access checks:

| Route | No auth | Basic Auth |
| --- | ---: | ---: |
| `/etfs` | 401 | 200 |
| `/etfs?q=VOO` | 401 | 200 |
| `/etfs?q=069500` | 401 | 200 |
| `/etfs?q=NO_MATCH_ETF_000000` | 401 | 200 |

Render markers:

| Route | Result |
| --- | --- |
| `/etfs` | title, master list, grouped holdings table, raw row count, duplicate count, and read-only warning present |
| `/etfs?q=VOO` | title, master list, grouped holdings table, raw row count, duplicate count, and read-only warning present |
| `/etfs?q=069500` | title, master list, grouped holdings table, raw row count, duplicate count, and read-only warning present |
| `/etfs?q=NO_MATCH_ETF_000000` | title, empty master state, and no-holdings empty state present |

Credential scan:

- authenticated HTML high-risk credential pattern hits: none
- actual dashboard access value leak: false

Note: populated ETF pages render the selected ETF name and grouped holdings
summary rather than the literal empty-state `ETF Holdings` heading.

## Read-Only Data Smoke

Read-only Neon data smoke on 2026-07-08:

| Check | Result |
| --- | ---: |
| `etf_masters` rows | 1,202 |
| `etf_holdings` rows | 10,872 |
| distinct master tickers | 1,202 |
| distinct holding tickers | 1,097 |
| distinct holding dates | 53 |
| `etf_holdings.etf_master_id` null rows | 0 |
| `etf_holdings.etf_master_id` orphans | 0 |
| holding ticker unmatched to `etf_masters.ticker` | 0 |
| non-null `legacy_etf_id` unmatched to `etf_masters.legacy_base44_id` | 0 |
| null `legacy_etf_id` rows | 25 |

Representative ETF checks:

| Query | Selected ETF | Latest holdings date | Raw rows | Grouped rows | Duplicate groups | Mixed source groups | Mixed currency groups | Rank disagreement groups |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `VOO` | `VOO` / Vanguard S&P 500 ETF | 2026-04-30 | 10 | 10 | 0 | 0 | 0 | 0 |
| `069500` | `069500` / KODEX 200 | 2026-04-17 | 10 | 10 | 0 | 0 | 0 | 0 |

No-match query:

- `NO_MATCH_ETF_000000` returned 0 master matches and rendered the empty state.

Sample duplicate identity groups remain present in the raw data. The top sample
groups are still from `0001S0` on `2026-04-17`, with two raw rows per returned
group. They should remain visible through grouped display and raw detail, not
deleted or hidden by cleanup.

## Guardrails

The current `/etfs` route must remain:

- read-only;
- server-side;
- backed by `etf_masters` and `etf_holdings`;
- disconnected from portfolio exposure, recommendation, risk, diversification,
  KIS, Cron, snapshots, and admin writes.

Do not add:

- schema migrations;
- FK or unique constraint hardening;
- duplicate cleanup/delete/backfill;
- new mutation routes;
- portfolio dashboard lookthrough exposure;
- recommendation or risk scoring based on ETF holdings.

## Follow-Ups

No immediate code change is required from this audit.

Later candidates, still outside this pass:

- add lightweight pagination or row-window controls if the first 100 grouped
  holdings is too narrow for broad funds;
- add a clearly labeled raw-row inspection surface if the current `<details>`
  view is insufficient;
- design factor/lookthrough models separately before using ETF holdings in
  recommendation or diversification features;
- keep duplicate holding identity groups as evidence until a separate source
  priority and cleanup policy is approved.

## Verification

This pass reviewed:

- `src/app/etfs/page.tsx`
- `src/db/queries/etf-holdings.ts`
- `src/lib/etf-holdings.ts`
- `docs/etf-holdings-readonly-semantics.md`
- `docs/data-integrity-audit.md`
- `docs/migration-coverage-audit.md`

Because this is docs-only, use `git diff --check` for this change. Run
`npm run test`, `npm run lint`, and `npm run build` only if code, tests, or
runtime behavior changes in the same branch.
