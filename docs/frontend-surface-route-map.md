# Frontend Surface Route Map

Last updated: 2026-08-03

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
(`/history`), aggregate KODEX 200 and VOO Investment Lab comparisons
(`/investment-lab`), and read-only Simulation Validation market-input readiness
(`/simulation`). Investment Lab also has an ephemeral historical
contribution-impact experiment over those fixed scenarios. The actionable,
account-specific Additional contribution flow and actual simulation execution
remain deferred and require independent runtime authority. They must not be
inferred from the old Goal/Cashflow schema.

ETF reference, Market Context, and Market Sync are supporting reference or
operator surfaces rather than additional primary product flows.

## Global Rules

- Product pages resolve the Neon server session to an active Varda Labs user
  before starting any product-data query. User-owned rows are then filtered by
  the trusted tenant context in server-only DALs. A failed resolution renders a
  closed access boundary and records that the product database read was not
  attempted.
- `src/proxy.ts` Basic Auth is limited to human operator pages under `/admin/*`
  and the temporary bootstrap-claim presentation endpoint. The OAuth callback
  stays in Proxy for the Neon Auth exchange; sign-in, session, auth API, and
  product routes are not Basic Auth matchers.
- Shared ETF masters, ETF holdings, benchmarks, and global factors still
  require an active product session. Account-derived market regime rows are
  additionally scoped through active accounts owned by that user.
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
| `/history` | Product-facing history evidence. Legacy ids stay hidden; legacy-only event/position status may be shown without the identifier. |
| `/simulation` | Product-facing market-input readiness, ready-only observed-return evidence, an aligned common-axis cumulative observed-index comparison, and minimized cross-market carry-method evidence. Hashes, internal ids, raw prices, raw FX values, and source dates stay outside the UI DTO. |
| `/etfs` | Product-facing ETF reference. Holdings raw-row details no longer display `legacyBase44Id`; future diagnostic legacy evidence belongs in admin/debug context. |
| `/market` | Current read-only data-quality surface. Duplicate-regime selected legacy id is temporarily allowed as diagnostic evidence, but must be hidden or moved before product-facing polish. |
| `/admin/market-sync` | Operator status surface. Operational ids and run metadata can be shown when useful, but secrets, auth headers, raw provider responses, and secret-shaped metadata remain prohibited. |

## Route Inventory

The protection column records the route's historical verification context.
For current runtime authorization, the Global Rules above are authoritative:
product routes use the Neon session plus tenant-scoped DALs, while Basic Auth
remains only on the explicit operator/bootstrap matchers.

| Route | Purpose | Data source and helpers | Protection | Write behavior | Current smoke status | Known gaps | Next candidate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | First-screen portfolio dashboard. Shows current portfolio summary, account tabs, holding heatmap, recent trend, return/event evidence, and side panels. | `src/app/page.tsx`, `getPortfolioDashboard`, `PortfolioDashboard`, `portfolio-return-metrics`, `portfolio-movement`. Reads `assets`, `accounts`, `asset_groups`, `settings`, `fx_rates`, `daily_portfolio_snapshots`, `daily_position_snapshots`, `asset_price_snapshots`, `event_ledger_entries`. | Basic Auth via `src/proxy.ts`. | Read-only render. No provider or write calls during render. | Latest route smoke: no-auth 401, auth 200, `/today` href present, key data markers present, DB counts unchanged. | Visual browser smoke remains partial because Basic Auth automation is blocked. Sidebar still contains placeholder nav items beyond implemented read-only routes. | User visual review before expanding more placeholder nav items. |
| `/today` | Minimal read-only today movement evidence surface. Shows aggregate movement, FX impact, trade flow, coverage, contribution rows, exclusions, and a query-selected holding detail panel. | `src/app/today/page.tsx`, `getPortfolioDashboard`, `TodayMovement`, `today-holding-detail`, shared `portfolio-movement` output. Reads the same dashboard payload rather than a second formula. | Basic Auth via `src/proxy.ts`. | Read-only render. No provider, dry-run, write, admin, or Cron calls. | Latest route smoke before the holding-detail panel: no-auth 401, auth 200 for default and account params; markers present; no configured secret leak; DB counts unchanged. Holding-detail selector tests cover contribution, exclusion, not-found, duplicate, and internal-id sanitization cases. | Visual browser smoke remains partial. UI is deliberately plain. Detail panel is query-based inside `/today`; no separate per-holding route yet. Design lives in `docs/today-holding-detail-readonly-design.md`. | Production smoke for `/today?ticker=069500&market=korea` and `/today?account=all&ticker=VOO&market=us`, then user visual review. |
| `/portfolio/structure` | Read-only `자산 배분` surface. Shows account tabs, direct-holding concentration and currency exposure, an ephemeral static USD/KRW shock over explicit USD direct holdings, group and holding allocation, exclusions, and data health. This is not the legacy risk/diversification screen despite the retained URL. | `src/app/portfolio/structure/page.tsx`, `getReadOnlyPortfolioStructure`, `buildPortfolioStructure`, `buildPortfolioDirectHoldingsBaseline`, and `calculatePortfolioFxShock`. Reads `assets`, `asset_groups`, `asset_group_members`, `live_price_quotes`, `fx_rates`, and settings USD/KRW fallback. | Basic Auth via `src/proxy.ts` `/portfolio/:path*`. | Server Component reads the DB directly. The shock input is a narrow Client Component and browser-memory-only calculation. No provider, dry-run, write, admin, or Cron calls. | Pure fixture coverage and a dedicated route smoke verify account states, default 5% reconciliation, leak scanning, access protection, and unchanged DB counts. | The FX experiment holds local prices fixed, never infers KRW-listed ETF look-through, and uses only the currently evaluable direct-holding subset. Effective target/drift remains `n/a`; member allocation remains unresolved evidence. | Keep forecast, VaR, recommendation, order, and ETF look-through FX outside this surface. |
| `/portfolio/risk` | Minimal read-only current-portfolio risk and diversification surface. Supports account and 30/90/252-day URL filters, explicit complete/standalone/unavailable states, portfolio metrics, per-instrument risk, current/stress correlation matrices, and data health. | `src/app/portfolio/risk/page.tsx`, `getReadOnlyTenantPortfolioRisk`, `PortfolioRiskView`, pure portfolio-risk input/math/read-model modules. Owned instruments are selected through active named accounts; shared `asset_price_snapshots` and `fx_rates` are read only after that universe is established. | Basic Auth remains an outer gate. The Server Component also requires a resolved Neon Auth session mapped to an active app user and canonical account owner. | Server Component direct DB read after tenant resolution. No browser REST refetch, provider call, mutation, schema, snapshot, or Cron change. | Default smoke verifies no-auth 401 and a fail-closed Basic-auth-only boundary with no product DB read. Session-bound deep smoke requires an explicit cookie and verifies unchanged DB row counts. | Gold proxy and historical risk-free source remain separate future data-policy decisions. | Owner-scoped implementation is under review; Production session-bound smoke remains a deployment close-out step. |
| `/history` | Read-only balance, portfolio, stored-position, and stored-event history evidence. Supports account/lane URL filters, separate stored-amount trajectory charts, exact named-account/date/source position drilldown, an exact same-source two-endpoint holdings change explorer, and a bounded exact named-account event timeline. Stored versus display-only derived aggregates remain explicit and historical values are not recomputed under the current asset policy. | `src/app/history/page.tsx`, `getReadOnlyHistoryBalance`, `history-balance`, `history-trajectory`, `history-position-detail`, `history-position-comparison`, `history-event-timeline`, and `src/components/history/*`. Reads `account_balance_snapshots`, `daily_portfolio_snapshots`, bounded exact tuples from `daily_position_snapshots`, and at most 101 exact-account rows from `event_ledger_entries`; can derive display-only `all` portfolio rows when stored rows are absent. | Basic Auth via `src/proxy.ts`. | Server Component direct DB reads and server-rendered SVG/tables. Two comparison endpoint reads run in parallel only after strict URL validation. The events-only lane skips unrelated balance and portfolio reads. No browser refetch, provider call, or write. Internal asset, event, correction, and legacy ids are removed before the display model. | Pure tests and dedicated route smoke cover account/lane states, generated and legacy-only position detail, exact endpoint change counts, stable private comparison identity, event counts/types/reference states, stored/derived markers, no-interpolation disclosure, full-response ID/secret leakage, overflow ownership, and source-table counts unchanged. | Charts connect only consecutive dates with the same source and row kind. Position detail and comparison require stored named-account portfolio rows and exact compatible position sources. Comparison keeps endpoint position sum, stored cash, and stored total separate; stored value change is not return/PnL/causality. Event date is separate from snapshot/service-cycle dates; accountless events are not inferred; correction rows are not netted. `all` comparison/event aggregation, current-asset fallback, live prices, interpolation, FX reconstruction, performance contribution/TWR, target/recommendation/order, and historical writes remain excluded. | History read-only evidence is closed enough; move to the trusted tenant-scoped target-policy adapter and authenticated ISA Additional Contribution preview boundary. |
| `/investment-lab` | Read-only account-scoped counterfactual comparing the observed invested-position path with all-KODEX-200, all-VOO, an explicit KODEX/VOO fixed-mix path, a zero-return same-flow counterfactual, and an anchor-date observed basket. A neutral scenario matrix projects those existing results onto one exact period and preserves unavailable rows without ranking or substitution. The anchor basket starts from an exact stored portfolio/position source intersection, uses the stored ticker or a matching Base44-imported snapshot ticker consensus before aggregating `(market,currency,ticker)` within the selected account scope, and never backcasts today's holdings. | `src/app/investment-lab/page.tsx`, counterfactual, ETF X-ray, and stress-replay server queries, read loaders/models, scenario-matrix projector, KODEX/VOO/fixed-mix/cash/anchor-basket path engines, special-holding authority policy, contribution calculators, `investment-lab-etf-shock`, and narrow Client Components for local inputs. Reads event, account snapshot/cash/FX, bounded anchor position and price evidence, shared admitted historical price/FX evidence, KODEX/VOO close, ETF master, and latest ETF holding evidence. | Basic Auth plus a resolved Neon Auth tenant session. | Server Components read the DB directly and pass sanitized read models to pure calculations. The scenario matrix performs no new read or calculation path. Independent ETF, portfolio-structure, and stress-replay reads stream in separate Suspense boundaries. Anchor position evidence is loaded after the selected comparison axis is known. Missing stored ticker recovery requires the same legacy identity and exact name/account/market/currency/asset-type agreement across Base44-imported position rows; current asset metadata and current price are forbidden historical fallbacks. The UI receives only sanitized authority status. Broader bounded price evidence is skipped unless every anchor holding is identified. URL account, date, fixed-mix, and anchor selections are server-resolved. No browser refetch, render-time provider, mutation, schema, recommendation, order, or persistence. | Build/test/lint and dedicated route smoke cover account scope, the six matrix rows, fixed mix, zero-return baseline, anchor readiness/path, special-holding authority rows, contribution, X-ray, the default single-name shock, and three stress windows while retaining leak and DB side-effect checks. | `all`, brokerage, ISA, and IRP are supported. KODEX adjusted-close, VOO raw-close plus stored USD/KRW, and zero-return assumptions stay separately labeled. The zero-return path is not an actual cash ledger. The anchor basket allocates equally only once at the selected anchor and then uses continuing fixed equal-flow allocation; it is neither simple buy-and-hold equal weight nor automatic rebalancing. Any incomplete identity, price, FX, solvency, or common-period evidence hides that exact anchor path; the separate stress replay instead preserves the eligible subset and discloses coverage. Exact flow-time TWR, actual cash-ledger reconstruction, scheduled rebalancing, transaction costs, prediction, and VaR remain deferred. | Keep provider completion outside route rendering. `315960` identity recovery is eligible from eleven imported snapshot rows but full price coverage remains separately guarded. KRX Gold current valuation uses the stored manual KRW-per-gram value; historical scenarios require explicit forward manual observations and never backcast today's value. The official provider is deferred. Fount is intentionally excluded. |
| `/simulation` | Read-only Simulation Validation with owner/account current-composition research and the separate retrospective KODEX 200/VOO research surface. The owner section shows current composition, stored-history readiness, and, only when all modeled rows are admitted, a 500-path stationary-bootstrap fan chart for `all`, brokerage, ISA, or IRP. The fixed research keeps exact-date 90-step input readiness, bounded carry evidence, observed KRW-return charts, regime-labeled hindsight research, walk-forward minimum-volatility comparison, and seven-endpoint stability history. | `src/app/simulation/page.tsx`, `resolveCurrentTenantContext`, `getReadOnlyTenantSimulationOwnerResearch`, `getReadOnlySimulationInputReadiness`, owner-scoped portfolio structure, the shared adjusted-history matrix loader, pure owner-input/execution modules, and split Simulation Server Components. Owner composition is loaded once through canonical owned accounts; independent fixed-research reads start in parallel after session resolution. | Basic Auth remains the outer gate. The Server Component also requires a resolved Neon Auth session mapped to an active app user and canonical account owner before owner or shared market-evidence reads start. The `account` query is only a validated filter. | Server Component direct DB reads after session resolution and pure in-memory diagnostics/calculations. The matrix loader excludes rows without an admitted adjusted-close basis, provider/source/fetch timestamp, and unambiguous provider symbol/exchange binding; the owner executor independently rechecks that boundary. No browser refetch, provider, mutation, job, or persistence. The owner vector is ephemeral current-value research input and is never loaded from or written to durable approval tables. Fount is excluded before weight derivation. KRX Gold is not backcast: its weight is disclosed and omitted until explicit manual history exists, while the listed subset is clearly labeled and renormalized for the research run only. | Pure fixtures cover deterministic allocation, exact/query and latest-common end selection, full listed execution, Gold partial execution, matrix blocking, explicit-date provenance bypass prevention, Fount exclusion, valuation gaps, and account-scope mismatch. Route tests enforce owner-first server reads, account URL preservation, adjusted-history admission, partial diagnostics, and no write/provider boundary. | Current-value weights are not a persisted approved vector, target, optimizer input, recommendation, or order authority. Missing valuation blocks vector derivation but remains visible. Existing imported price values without complete adjusted-history provenance are diagnostics only and cannot produce owner paths, even with an explicit date. Existing KODEX/VOO outputs remain separate fixed retrospective research and must not be labeled as the user's portfolio forecast. | Add a rights-reviewed provider-history completion path for missing or unqualified listed instruments, then add historical outcome calibration for owner paths. Keep account-specific and all-account runs separate and preserve partial-evidence disclosure. |
| `/etfs` | Read-only ETF reference and holdings lookthrough. Search/select ETF master and view grouped holdings. | `src/app/etfs/page.tsx`, `searchReadOnlyEtfMasters`, `getReadOnlyEtfHoldings`, `etf-holdings` grouping helpers. Reads `etf_masters` and `etf_holdings`. | Basic Auth via `src/proxy.ts`. | Read-only render. | Build/lint/test pass with current route. Earlier production smoke verified route access, but not after every dashboard-only change. | Holdings raw-row details no longer display `legacyBase44Id`. If diagnostic legacy evidence is needed later, expose it only in an admin/debug context. | Focused `/etfs` visual smoke and product-facing table review. |
| `/market` | Read-only market context page for benchmarks, regime rows, duplicate regime groups, and global factors. | `src/app/market/page.tsx`, `getReadOnlyMarketContext`, `market-context` helpers. Reads `benchmark_snapshots`, `market_regime_daily`, and `global_market_factors`. | Basic Auth via `src/proxy.ts`. | Read-only render. | Prior smoke covered no-auth/auth, expected markers, and no side effects. | Duplicate regime diagnostics still expose selected legacy ids in the duplicate section. That is acceptable only as admin/evidence text, not polished product UI. | Keep read-only. If this becomes user-facing, hide legacy identifiers and add visual smoke. |
| `/admin/market-sync` | Status-only operator console for market data freshness, close coverage, FX status, snapshot evidence, KIS cooldown, recent sync metadata, and manual boundary hints. | `src/app/admin/market-sync/page.tsx`, `getAdminMarketSyncStatus`, `admin-market-sync-status` helpers. Reads stored DB state including `assets`, `asset_price_snapshots`, `fx_rates`, `daily_position_snapshots`, `daily_portfolio_snapshots`, and `market_data_sync_runs`. | Basic Auth via `src/proxy.ts`; under `/admin/:path*`. | Read-only render. Must not call providers, dry-run routes, or write routes. | Prior status page checks showed status-only behavior and no render-time provider/write calls. | This is not an action console. Manual action buttons remain intentionally absent. | Keep as status-only until a separate reviewed admin action contract is approved. |

### Investment Lab Stress Replay Addendum

The route includes three fixed retrospective windows: the 2020 COVID selloff,
the 2022 rate shock, and the 2023 AI rally. For `all`, brokerage, ISA, or IRP,
the server applies current positive-value weights at each window start and
compares buy-and-hold current composition, equal weight, KODEX 200, VOO, and
zero-return cash. USD instruments use date-specific stored USD/KRW evidence.

This module does not make a whole result disappear merely because one holding
lacks history. It excludes pre-inception or insufficient-evidence instruments,
renormalizes only the historically eligible current-value subset, and displays
both coverage and exclusions. It never fills a missing price with an invented
average. Bounded carry is explicit, and no current price or current FX is used
as a historical fallback. KIS and Frankfurter completion run only through a
separate reviewed operator command; rendering remains provider-free and
read-only. The result excludes tax, fees, and dividend reinvestment and is
research, not a recommendation or order authority.

### Simulation Historical Outcome Addendum

The `/simulation` route also starts one server-only historical outcome
validation read in parallel with the main readiness and regime reads. It renders through
its own Suspense boundary, so a slow or unavailable validation does not erase
the other Simulation sections. Each of seven fixed outcome endpoints requests
153 paired KODEX 200/VOO KRW-return rows: 90 training rows and the immediately
following 63 observed rows. The pure calculation validates a fixed 50:50
initial-weight, no-rebalancing research path and exposes P10/P50/P90, actual
terminal return, band hit/miss, and absolute P50 error. It preserves available
rows when another endpoint is missing and performs no provider call, fallback,
write, account binding, ranking, tuning, or persistence.

The same matrix read and one complete 500-path calculation also produce the
downside outcome view. It compares predicted terminal loss probability and MDD
P50/P90 with the exact following observed terminal loss event and MDD. The
fan-band and downside sections are separate Server Components for presentation,
but they share one promise and result because their data source, freshness, and
calculation lifecycle are identical. P90 comparison is descriptive, not a
pass/fail model score.

The owner-scoped stationary-bootstrap and factor/residual sections also feed a
separate read-only comparison Server Component. The comparison requires the
same account, end service date, horizon, path count, and owner-derived weights;
otherwise it stays unavailable while each model's individual result remains
visible. It reports terminal P10-P90 overlap and signed metric deltas on a
shared chart scale. It does not average probabilities, choose a model, add a
database/provider read, persist a run, or create recommendation or order
authority.

## API And Operator Boundaries

| Surface | Current role | Boundary |
| --- | --- | --- |
| `/api/entities/*` | Existing CRUD compatibility APIs for core entities. | Not part of first-render dashboard reads. Keep separate from Server Component read paths unless a client-side editing workflow is intentionally added. |
| `/api/admin/market/prices/sync` | Guarded market price sync endpoint. | Must remain admin-only and explicit. Do not call during page render. |
| `/api/admin/market/fx/sync` | Guarded FX refresh endpoint. | Dry-run by default; actual write requires explicit guard. Do not call during page render. |
| `/api/admin/snapshots/daily` | Guarded daily snapshot endpoint. | Do not call from product pages. Preserve reviewed runbook boundaries. |
| `/api/cron/market-cycle/preflight` | Read-only Cron/operator preflight contract. | Must not expose write-shaped or secret-shaped parameters. |
| `/api/cron/market-cycle/run` | Guarded daily FX, close-price, and owner-scoped snapshot controller. | Machine auth only, no query selectors, and fail-closed unless `MARKET_CYCLE_CRON_WRITE_ENABLED=true`. One Hobby-compatible daily schedule is declared at `0 22 * * *`. |

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
- `/simulation` as a read-only independent KODEX 200/VOO market-input
  readiness surface, without execution or recommendation authority.

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
- Simulation fan charts, percentile results, initial-KRW scaling, optimizer,
  recommendation, and persisted run artifacts until runtime trust is established.
