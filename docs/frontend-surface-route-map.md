# Frontend Surface Route Map

Last updated: 2026-07-10

Status: route inventory and verification log. This document does not itself
call providers, execute dry-runs, write data, change Cron behavior, change
schema, or change migrations.

Purpose: keep the current Next.js App Router surfaces explicit before adding
more migrated gyeol-fin screens. The immediate goal is to prevent premature
component abstraction, duplicated financial formulas, and accidental render-time
side effects.

## Product Scope Lock

The primary product is limited to Home, Today movement, Additional
contribution, Portfolio structure, History, Investment lab, and Simulation
validation. Legacy cashflow, goal-setting, and calendar screens are not future
route candidates.

Current route coverage is Home (`/`), Today movement (`/today`), Portfolio
structure (`/portfolio/structure` and `/portfolio/risk`), History
(`/history`), and the first aggregate KODEX 200 Investment Lab comparison
(`/investment-lab`). Additional contribution and Simulation validation remain
placeholders and require independent runtime authority. They must not be
inferred from the old Goal/Cashflow schema.

ETF reference, Market Context, and Market Sync are supporting reference or
operator surfaces rather than additional primary product flows.

## Global Rules

- All listed product/operator pages are protected by `src/proxy.ts` Basic Auth
  in production. Neon Auth is selected only as a future identity/session
  boundary in `docs/auth-identity-session-strategy.md`; no route has switched
  auth behavior yet.
- Server-rendered read views should load DB-backed data directly through server
  helpers. Do not introduce first-render browser REST refetching for these
  surfaces.
- Render paths must not call KIS, FX providers, dry-run routes, write routes, or
  admin mutation routes.
- `/`, `/today`, and later holding detail surfaces must share the movement
  model from `src/lib/portfolio-movement.ts`; do not copy the formula into a
  route-specific implementation.
- Default product UI must not use `holdingId`, `legacyBase44Id`, or similar
  internal identifiers as fallback labels.

## Identifier Display Policy

Legacy and internal identifiers are migration evidence, not user-facing
portfolio labels.

| Surface class | Policy |
| --- | --- |
| Default product UI | Do not display `holdingId`, `assetId`, `legacyBase44Id`, legacy Base44 object ids, provider request ids, raw headers, or secret-shaped metadata as labels, fallback text, table cells, or badges. Prefer ticker, asset name, account, market, source label, and status reason. |
| Imported evidence data | Preserve legacy ids in database rows, query payloads, import scripts, matching logic, and idempotency checks where they are needed for reconciliation. Do not remove columns or query fields just to hide UI text. |
| Admin/debug/data-quality surfaces | Internal ids may be shown only when they are necessary diagnostic evidence, preferably inside collapsed or clearly diagnostic sections. These surfaces still must not expose secrets, provider auth material, raw request headers, or raw provider responses. |
| Product polish phase | Any diagnostic legacy/internal id still visible on a route must be re-reviewed and either hidden, moved to an admin/debug surface, or intentionally documented as operator-only evidence. |

Current route decisions:

| Route | Current identifier decision |
| --- | --- |
| `/` | Product dashboard. Internal and legacy ids must stay hidden. |
| `/today` | Product/evidence hybrid, but default display hides internal and legacy ids. Contribution/exclusion rows should use ticker, name, account, source, and reason. |
| `/portfolio/structure` | Product/evidence hybrid labeled `자산 배분`. It is allocation-only, not the legacy ENB/Sharpe/correlation screen. Internal and legacy ids must stay hidden. |
| `/portfolio/risk` | Product/evidence hybrid labeled `포트폴리오 위험·분산`. Internal and legacy ids stay hidden; nullable metrics retain `n/a` and an explicit reason. |
| `/history` | Product-facing history evidence. Legacy ids should stay hidden in the default table. |
| `/etfs` | Product-facing ETF reference. Holdings raw-row details no longer display `legacyBase44Id`; future diagnostic legacy evidence belongs in admin/debug context. |
| `/market` | Current read-only data-quality surface. Duplicate-regime selected legacy id is temporarily allowed as diagnostic evidence, but must be hidden or moved before product-facing polish. |
| `/admin/market-sync` | Operator status surface. Operational ids and run metadata can be shown when useful, but secrets, auth headers, raw provider responses, and secret-shaped metadata remain prohibited. |

## Route Inventory

| Route | Purpose | Data source and helpers | Protection | Write behavior | Current smoke status | Known gaps | Next candidate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | First-screen portfolio dashboard. Shows current portfolio summary, account tabs, holding heatmap, recent trend, return/event evidence, and side panels. | `src/app/page.tsx`, `getPortfolioDashboard`, `PortfolioDashboard`, `portfolio-return-metrics`, `portfolio-movement`. Reads `assets`, `accounts`, `asset_groups`, `settings`, `fx_rates`, `daily_portfolio_snapshots`, `daily_position_snapshots`, `asset_price_snapshots`, `event_ledger_entries`. | Basic Auth via `src/proxy.ts`. | Read-only render. No provider or write calls during render. | Latest route smoke: no-auth 401, auth 200, `/today` href present, key data markers present, DB counts unchanged. | Visual browser smoke remains partial because Basic Auth automation is blocked. Sidebar still contains placeholder nav items beyond implemented read-only routes. | User visual review before expanding more placeholder nav items. |
| `/today` | Minimal read-only today movement evidence surface. Shows aggregate movement, FX impact, trade flow, coverage, contribution rows, exclusions, and a query-selected holding detail panel. | `src/app/today/page.tsx`, `getPortfolioDashboard`, `TodayMovement`, `today-holding-detail`, shared `portfolio-movement` output. Reads the same dashboard payload rather than a second formula. | Basic Auth via `src/proxy.ts`. | Read-only render. No provider, dry-run, write, admin, or Cron calls. | Latest route smoke before the holding-detail panel: no-auth 401, auth 200 for default and account params; markers present; no configured secret leak; DB counts unchanged. Holding-detail selector tests cover contribution, exclusion, not-found, duplicate, and internal-id sanitization cases. | Visual browser smoke remains partial. UI is deliberately plain. Detail panel is query-based inside `/today`; no separate per-holding route yet. Design lives in `docs/today-holding-detail-readonly-design.md`. | Production smoke for `/today?ticker=069500&market=korea` and `/today?account=all&ticker=VOO&market=us`, then user visual review. |
| `/portfolio/structure` | Minimal read-only `자산 배분` surface. Shows account tabs, summary, group allocation, holding allocation, exclusions, and data health. This is not the legacy risk/diversification screen despite the retained URL. | `src/app/portfolio/structure/page.tsx`, `getReadOnlyPortfolioStructure`, `buildPortfolioStructure`. Reads `assets`, `asset_groups`, `asset_group_members`, `live_price_quotes`, `fx_rates`, and settings USD/KRW fallback. | Basic Auth via `src/proxy.ts` `/portfolio/:path*`. | Read-only render. No provider, dry-run, write, admin, or Cron calls. | Local build/test/lint pass. DB smoke showed counts unchanged and sanitized output. Production smoke: no-auth 401, auth 200 for `all` and `isa`, markers present, leak scan pass, DB counts unchanged. | Effective target/drift remains `n/a`; member allocation remains unresolved evidence. Legacy ENB/Sharpe/correlation functionality is tracked separately in `docs/portfolio-risk-structure-v1-contract.md`. | Copy-only naming smoke, then risk-structure contract review. |
| `/portfolio/risk` | Minimal read-only current-portfolio risk and diversification surface. Supports account and 30/90/252-day URL filters, explicit complete/standalone/unavailable states, portfolio metrics, per-instrument risk, current/stress correlation matrices, and data health. | `src/app/portfolio/risk/page.tsx`, `getReadOnlyPortfolioRisk`, `PortfolioRiskView`, pure portfolio-risk input/math/read-model modules. Reads `assets`, `asset_price_snapshots`, and `fx_rates`. | Basic Auth via `src/proxy.ts` `/portfolio/:path*`. | Server Component direct DB read. No browser REST refetch, provider call, mutation, schema, snapshot, or Cron change. | Local and deployed production smoke: dashboard and route no-auth 401; dashboard and four risk states auth 200; sidebar keeps `자산 배분` then adds `위험·분산`; leak and overflow-contract checks pass; DB counts unchanged. Build/test/lint pass. | Gold proxy and historical risk-free source remain separate future data-policy decisions. | Portfolio Risk v1 is closed; choose the next migration slice separately. |
| `/history` | Read-only balance and portfolio history evidence. Supports account/lane URL filters, explicitly separates balance dates from snapshot dates, and labels stored versus display-only derived aggregates. Historical values are not recomputed under the current asset policy. | `src/app/history/page.tsx`, `getReadOnlyHistoryBalance`, `history-balance` helpers, and `src/components/history/*`. Reads `account_balance_snapshots` and `daily_portfolio_snapshots`; can derive display-only `all` rows when stored rows are absent. | Basic Auth via `src/proxy.ts`. | Server Component direct DB read. No browser refetch or write. Public DTOs do not select DB UUIDs. | Dedicated local and production smoke covers dashboard/history 401/200, account/lane section states, stored/derived markers, full-response ID/secret leakage, table overflow ownership, and DB counts unchanged. | No chart, interpolation, position drilldown, third history source, or historical rewrite. | History Read-only v1 is closed; choose the next product boundary separately. |
| `/investment-lab` | Read-only aggregate counterfactual comparing the observed all-account invested-position path with an all-KODEX-200 path under the same dated KRW buy/sell amounts. | `src/app/investment-lab/page.tsx`, `getReadOnlyInvestmentLabCounterfactual`, read loader/model, existing execution schedule and deterministic path engine. Reads explicit event, account snapshot, and adjusted-close projections in parallel. | Basic Auth via `src/proxy.ts`. | Server Component direct DB read and pure calculation. No browser refetch, provider, mutation, schema, job, or persistence. | Local production smoke: no-auth 401, auth 200, 27 comparison dates, 38 applied in-window flows, 5 delayed executions, 911 KODEX 200 close rows, zero pending-at-end, leak scan pass, DB counts unchanged. Test/lint/build pass. | Aggregate `all` plus KODEX 200 only. Account-specific paths remain blocked by three unattributed events. Cashflow-adjusted TWR, VOO, fixed vectors, scheduled rebalancing, optimization, and transaction costs remain deferred. | User data/meaning review, then choose TWR fixture or another primary product slice. |
| `/etfs` | Read-only ETF reference and holdings lookthrough. Search/select ETF master and view grouped holdings. | `src/app/etfs/page.tsx`, `searchReadOnlyEtfMasters`, `getReadOnlyEtfHoldings`, `etf-holdings` grouping helpers. Reads `etf_masters` and `etf_holdings`. | Basic Auth via `src/proxy.ts`. | Read-only render. | Build/lint/test pass with current route. Earlier production smoke verified route access, but not after every dashboard-only change. | Holdings raw-row details no longer display `legacyBase44Id`. If diagnostic legacy evidence is needed later, expose it only in an admin/debug context. | Focused `/etfs` visual smoke and product-facing table review. |
| `/market` | Read-only market context page for benchmarks, regime rows, duplicate regime groups, and global factors. | `src/app/market/page.tsx`, `getReadOnlyMarketContext`, `market-context` helpers. Reads `benchmark_snapshots`, `market_regime_daily`, and `global_market_factors`. | Basic Auth via `src/proxy.ts`. | Read-only render. | Prior smoke covered no-auth/auth, expected markers, and no side effects. | Duplicate regime diagnostics still expose selected legacy ids in the duplicate section. That is acceptable only as admin/evidence text, not polished product UI. | Keep read-only. If this becomes user-facing, hide legacy identifiers and add visual smoke. |
| `/admin/market-sync` | Status-only operator console for market data freshness, close coverage, FX status, snapshot evidence, KIS cooldown, recent sync metadata, and manual boundary hints. | `src/app/admin/market-sync/page.tsx`, `getAdminMarketSyncStatus`, `admin-market-sync-status` helpers. Reads stored DB state including `assets`, `asset_price_snapshots`, `fx_rates`, `daily_position_snapshots`, `daily_portfolio_snapshots`, and `market_data_sync_runs`. | Basic Auth via `src/proxy.ts`; under `/admin/:path*`. | Read-only render. Must not call providers, dry-run routes, or write routes. | Prior status page checks showed status-only behavior and no render-time provider/write calls. | This is not an action console. Manual action buttons remain intentionally absent. | Keep as status-only until a separate reviewed admin action contract is approved. |

## API And Operator Boundaries

| Surface | Current role | Boundary |
| --- | --- | --- |
| `/api/entities/*` | Existing CRUD compatibility APIs for core entities. | Not part of first-render dashboard reads. Keep separate from Server Component read paths unless a client-side editing workflow is intentionally added. |
| `/api/admin/market/prices/sync` | Guarded market price sync endpoint. | Must remain admin-only and explicit. Do not call during page render. |
| `/api/admin/market/fx/sync` | Guarded FX refresh endpoint. | Dry-run by default; actual write requires explicit guard. Do not call during page render. |
| `/api/admin/snapshots/daily` | Guarded daily snapshot endpoint. | Do not call from product pages. Preserve reviewed runbook boundaries. |
| `/api/cron/market-cycle/preflight` | Read-only Cron/operator preflight contract. | Must not expose write-shaped or secret-shaped parameters. |

## Current Sequencing Decision

Closed enough for now:

- `/` dashboard read path and smoke gates.
- `/today` read-only movement surface, account route smoke, internal id fallback
  hardening, and dashboard sidebar link.
- `/portfolio/structure` allocation contract, pure read model, DB adapter,
  minimal route implementation, and user-facing `자산 배분` naming.
- `/portfolio/risk` pure input/math/read model, server-only DB adapter, minimal
  Server Component route, and local protected render smoke.
- `/admin/market-sync` as a status-only operator page.

Do next only after user visual review or explicit direction:

- Select the next migration slice after closing Portfolio Risk v1.
- Focused visual review for `/today`, `/history`, `/etfs`, and `/market`.
- Product-facing identifier cleanup where legacy/internal ids still appear.

Still deferred:

- Separate per-holding detail page.
- Today/detail shared presentational component abstraction.
- Public sync buttons.
- Admin action buttons.
- Recommendation and composite risk-scoring integration.
- Portfolio risk charts, client matrix modes, composite scoring, and
  recommendation integration remain deferred.
- Snapshot/Cron forecast-calendar correction until a separate no-write review.
- Cron automation changes.
- Schema/migration changes for frontend-only work.
