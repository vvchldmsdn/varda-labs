# Base44 Function Migration Audit

Last updated: 2026-07-10

Source scanned read-only:
`C:\Users\Eunwoo_2\Desktop\gyeol-fin\base44\functions`

This audit classifies the Base44 server functions before any further feature
port. It is intentionally docs-only. It does not approve schema changes, route
changes, Cron enablement, KIS write automation, snapshot writer changes,
cleanup, repair, delete, or backfill work.

## Executive Decision

Do not port Base44 functions wholesale.

The Base44 function tree mixes current runtime behavior, compatibility wrappers,
manual operations, one-off repairs, diagnostics, legacy experiments,
recommendation engines, simulation jobs, and AI/content helpers. varda-labs
should use Base44 functions as behavior references, then re-implement only the
needed product behavior with Next.js App Router, server-only query helpers,
Drizzle/Postgres transactions, explicit dry-run guards, and tests.

Current pipeline status:

- Phase 1 Cron preflight observation is implemented and smoke-tested.
- Pipeline implementation must stop there for now.
- `vercel.json`, Cron scheduling, close-sync automation, and snapshot write
  automation remain out of scope.

## Migration Categories

| Category | Meaning | varda-labs treatment |
| --- | --- | --- |
| `canonical_runtime` | Base44 function contains current product behavior worth preserving | Re-implement as varda-labs helper/route, do not copy code |
| `compatibility_wrapper` | Delegates to another canonical function | Do not port; point callers at the canonical varda-labs path |
| `read_helper` | Read-only product data helper | Prefer Server Components plus server-only DB query helpers |
| `manual_admin_operation` | Admin/operator task that may write | Dry-run default, explicit write confirmation, audit output |
| `one_off_backfill` | Historical fill or data patch | Do not port by default; create one-off script only with approval |
| `repair_or_diagnostic` | Audit, inspect, visibility repair, cleanup | Prefer read-only audit; mutation only as separately approved script |
| `reference_data_operation` | ETF/security/reference-data sync or patch | Use imported tables first; future sync must be dry-run guarded |
| `market_context_operation` | Macro, regime, factor, news, or signal work | Use imported market context first; future ingestion should be separate |
| `recommendation_engine_candidate` | Recommendation, rebalance, diversification, briefing | Defer until recommendation model/audit decision and fixture tests |
| `simulation_or_job_artifact` | Simulation, optimization, calibration, chunk/shard job | Defer to a job/artifact subsystem design |
| `legacy_or_obsolete` | Superseded or explicitly deprecated | Do not port |
| `do_not_port` | Unsafe, redundant, or no product value now | Leave behind |

## Current Replacement Surface

| Base44 area | varda-labs surface now | Notes |
| --- | --- | --- |
| Daily history writer | `src/lib/snapshots/daily.ts`, `POST /api/admin/snapshots/daily`, `GET /api/cron/market-cycle/preflight` | varda-labs already has a guarded dry-run/write split. Keep one canonical writer. |
| Price sync | `src/lib/market-data/price-sync.ts`, `src/lib/market-data/providers/kis.ts`, `POST /api/admin/market/prices/sync` | Current manual admin path replaces `syncAssetPrices` behavior in a narrower form. |
| Portfolio dashboard reads | `src/lib/portfolio-dashboard.ts`, `src/db/queries/*`, Server Components | Keep read-only screens on server-side DB helpers, not Base44-style REST. |
| ETF reference reads | `etf_masters`, `etf_holdings`, `src/db/queries/etf-holdings.ts`, `/etfs` | Imported data is usable without ETF sync functions. |
| Market context reads | `benchmark_snapshots`, `market_regime_daily`, `global_market_factors`, `/market` | Imported data is usable without recomputing market context. |
| Event/return calculations | `event_ledger_entries`, `src/lib/portfolio-return-metrics*.ts` | Current fixture gap guidance lives in `docs/calculation-fixture-gap-audit.md`. |
| Recommendation output | No final varda-labs recommendation model yet | Decide legacy import vs regeneration before implementation. |
| Simulation output | No varda-labs simulation job subsystem yet | Defer; Base44 simulation code is job/artifact-heavy. |

## Function Inventory

### Snapshot and Price Pipeline

| Base44 function | Category | Base44 role | varda-labs mapping | Decision |
| --- | --- | --- | --- | --- |
| `saveDailyHistorySnapshot` | `canonical_runtime` | Canonical daily portfolio/position snapshot writer | `src/lib/snapshots/daily.ts` and admin/preflight routes | Already redesigned; do not copy code. Preserve behavior ideas only. |
| `dailyPortfolioSnapshot` | `compatibility_wrapper` | Delegates to `saveDailyHistorySnapshot` | None | Do not port. |
| `captureDailyPositionSnapshot` | `compatibility_wrapper` | Delegates/overlaps with canonical snapshot writer | None | Do not port. |
| `syncAssetPrices` | `canonical_runtime` | Live quote, close cache, MA/trend update, asset price metadata | `src/lib/market-data/price-sync.ts` and KIS provider | Replacement exists; continue hardening varda-labs path only. |
| `kisStockData` | `manual_admin_operation` | Direct KIS quote/history fetch helper | `src/lib/market-data/providers/kis.ts` | Reference only; do not expose generic provider proxy. |
| `syncFxRates` | `manual_admin_operation` | FX rate sync into `FxRate` | `fx_rates`; future provider job if needed | Do not port yet; imported FX covers current reads. |
| `backfillRecentCloses` | `one_off_backfill` | Recent close patch into `AssetPriceSnapshot` | Manual close sync planning only | Do not port wholesale; varda-labs already has guarded manual close sync. |
| `backfillPriceHistory` | `one_off_backfill` | Larger price-history fill from KIS/fallback providers | `asset_price_snapshots` import plus future one-off script | Do not port by default. |
| `backfillDailyPortfolioSnapshots` | `legacy_or_obsolete` | Disabled legacy daily portfolio backfill | None | Do not port. |
| `listAssetPriceSnapshotsForHoldings` | `read_helper` | Read price snapshots for held assets | Future server query helper if charts need it | Port as query helper only when UI needs it. |

### Portfolio Dashboard and Read Helpers

| Base44 function | Category | Base44 role | varda-labs mapping | Decision |
| --- | --- | --- | --- | --- |
| `getPortfolioHomeSnapshot` | `read_helper` | Aggregated dashboard payload | `src/lib/portfolio-dashboard.ts`, `src/app/page.tsx` | Use as display-priority reference, not code source. |
| `auditPortfolioDataIntegrity` | `repair_or_diagnostic` | Read/audit plus optional snapshot identity fixes | `docs/data-integrity-audit.md`; future read-only script | Keep diagnostic-only unless a repair script is separately approved. |
| `inspectAllSnapshots` | `repair_or_diagnostic` | Snapshot inventory inspection | Future read-only audit script | Do not port as product route. |
| `diagSnapshotVisibility` | `repair_or_diagnostic` | Snapshot visibility diagnostic | Future read-only audit script | Do not port as product route. |
| `diagSnapshotOwnership` | `repair_or_diagnostic` | Ownership diagnostic for snapshots | Future read-only audit script | Do not port. Legacy owner fields are sensitive. |
| `repairDailySnapshotVisibility` | `repair_or_diagnostic` | Snapshot visibility repair | None | Do not port unless a one-off repair is explicitly approved. |
| `repairHistoricalSnapshots` | `repair_or_diagnostic` | Historical snapshot repair | None | Do not port wholesale. |
| `restoreLegacySnapshots` | `repair_or_diagnostic` | Restore legacy snapshot rows | None | Do not port. Imported rows are immutable evidence. |
| `cleanupBackfillSnapshots` | `do_not_port` | Deletes/cleans generated backfill rows | None | Do not port; cleanup/delete is out of scope. |

### ETF Reference, Lookthrough, and Security Data

| Base44 function | Category | Base44 role | varda-labs mapping | Decision |
| --- | --- | --- | --- | --- |
| `seedEtfMaster` | `reference_data_operation` | Seed ETF master rows | `etf_masters` import | Already imported. Future refresh should be a new dry-run script. |
| `seedEtfUniverse` | `reference_data_operation` | Seed ETF universe/reference picks | `etf_masters` | Do not port now; classify universe fields before edits. |
| `syncKrEtfUniverse` | `reference_data_operation` | KR ETF universe sync | `etf_masters` | Future admin sync candidate, not current scope. |
| `syncKrEtfHoldings` | `reference_data_operation` | KR ETF holdings sync | `etf_holdings` | Future admin sync candidate with dry-run and source priority. |
| `syncUsEtfHoldings` | `reference_data_operation` | US ETF holdings sync | `etf_holdings` | Future admin sync candidate with provider isolation. |
| `upsertEtfMasterPatch` | `reference_data_operation` | Patch ETF master rows | `etf_masters` | Do not port ad hoc patching; use migrations/scripts with review. |
| `enrichEtfMasterMetadata` | `reference_data_operation` | Adds ETF metadata | `etf_masters` | Future curated enrichment only. |
| `applyEqualWeightHoldingProxy` | `one_off_backfill` | Writes proxy holdings | `etf_holdings` | Do not port by default. Proxy rows must be explicitly labeled if ever used. |
| `applyEtfHoldingProxyWeights` | `one_off_backfill` | Applies proxy weights to holdings | `etf_holdings` | Do not port by default. |
| `fixCommodityEtfHoldings` | `one_off_backfill` | Commodity ETF holding repair | `etf_holdings` | Do not port wholesale. |
| `auditEtfHoldingCoverage` | `repair_or_diagnostic` | Coverage audit for ETF lookthrough | `src/lib/etf-holdings.ts`; future audit script | Read-only query/helper is enough for now. |
| `analyzeEtfHoldingLookthrough` | `read_helper` | Lookthrough exposure analysis | Future analytics helper | Defer until recommendation/diversification scope. |
| `compareEtfLookthrough` | `read_helper` | Compare ETF lookthrough results | Future analytics helper | Defer. |
| `analyzeEtfCandidates` | `recommendation_engine_candidate` | ETF candidate analysis | Future recommendation engine | Defer until recommendation model audit. |
| `findEtfSubstitutes` | `recommendation_engine_candidate` | ETF substitute suggestions | Future recommendation engine | Defer. |

### Market Context, Macro, News, and Signals

| Base44 function | Category | Base44 role | varda-labs mapping | Decision |
| --- | --- | --- | --- | --- |
| `calcMarketRegime` | `market_context_operation` | Calculates market regime from portfolio/context | `market_regime_daily`, `/market` | Imported rows power read-only UI. Recompute later only with tests. |
| `syncGlobalMarketFactors` | `market_context_operation` | Writes global factor time series | `global_market_factors` | Imported. Future ingestion must be a provider job, not direct port. |
| `syncIndustryFactors` | `market_context_operation` | Industry factor sync | Candidate `global_market_factors` or future factor table | Defer until factor model decision. |
| `syncAssetFactorProfiles` | `market_context_operation` | Writes per-asset factor exposure profiles | `AssetFactorProfile` is still `needs_decision` | Defer until factor/recommendation model decision. |
| `syncMacro` | `market_context_operation` | Macro series sync | `global_market_factors`; `MacroSeries` still needs decision | Defer. Avoid duplicate macro tables until model is chosen. |
| `listMarketSignals` | `read_helper` | Reads generated market signals | `MarketSignal` is still `needs_decision` | Defer until signal model decision. |
| `syncNews` | `market_context_operation` | News ingestion | No current varda-labs table | Defer. Not required for portfolio migration baseline. |
| `syncSecurityResearchCache` | `market_context_operation` | Security research/cache generation | No current varda-labs table | Defer. Treat as derived cache/content. |
| `generateDailyBriefing` | `market_context_operation` | AI/content daily briefing | Future content layer only | Do not port before LLM/content policy decision. |
| `generateWeeklyReplay` | `market_context_operation` | AI/content weekly replay | Future content layer only | Do not port now. |

### Recommendation, Diversification, and Investment Logic

| Base44 function | Category | Base44 role | varda-labs mapping | Decision |
| --- | --- | --- | --- | --- |
| `generateRecommendations` | `recommendation_engine_candidate` | Newer run/candidate recommendation engine | Future `recommendation_runs` and `recommendation_candidates` if approved | Defer. Needs model audit and fixture tests. |
| `calcRebalanceRecommendation` | `recommendation_engine_candidate` | Older single-row rebalance output | Possible legacy import or reference-only | Do not port as final engine. |
| `buildRecommendationBriefing` | `recommendation_engine_candidate` | AI narrative for recommendation run | Future content layer | Defer until recommendation model exists. |
| `calcDiversification` | `portfolio_risk_core_migrated_adapter_pending` | Descriptive diversification/risk analytics plus provider orchestration | `portfolio-risk-input*`, `portfolio-risk-statistics.ts`, `portfolio-risk-derived-metrics.ts`, `portfolio-risk.ts`; contract and fixtures | Canonical pure input/math core is implemented. DB adapter and read-only UI remain pending; provider orchestration, composite scores, recommendation, beta/alpha/MDD, and legacy rounding are not ported. |
| `generatePortfolioWeaknessCards` | `recommendation_engine_candidate` | UI cards for weaknesses | Future read model/content helper | Defer. |
| `classifyPortfolioPersonality` | `recommendation_engine_candidate` | Classification/content layer | Future product decision | Defer. |

### Simulation, Optimization, and Backtesting

Detailed simulation and investment lab model guidance lives in
`docs/simulation-investment-lab-model-audit.md`. Use it before any schema,
route, job, artifact, or UI work in this area.

| Base44 function | Category | Base44 role | varda-labs mapping | Decision |
| --- | --- | --- | --- | --- |
| `calibratePortfolioFactorModel` | `simulation_or_job_artifact` | Creates simulation calibration artifacts | Future job/artifact subsystem | Defer. |
| `normalizeReturnMatrix` | `simulation_or_job_artifact` | Normalizes return matrix | Future pure helper inside simulation subsystem | Defer. |
| `runPortfolioMonteCarlo` | `simulation_or_job_artifact` | Monte Carlo simulation run | Future job/artifact subsystem | Defer. |
| `runRegimeBootstrapSimulation` | `simulation_or_job_artifact` | Regime bootstrap simulation | Future job/artifact subsystem | Defer. |
| `runHybridPortfolioSimulation` | `simulation_or_job_artifact` | Hybrid simulation and persisted outputs | Future job/artifact subsystem | Defer. |
| `startSimulationJob` | `simulation_or_job_artifact` | Starts chunked simulation job | Future job queue design | Defer. |
| `runSimulationJobChunk` | `simulation_or_job_artifact` | Executes simulation chunk/shards | Future job queue design | Defer. |
| `finalizeSimulationJob` | `simulation_or_job_artifact` | Merges simulation chunks and creates run | Future job queue design | Defer. |
| `optimizeSimulationJob` | `simulation_or_job_artifact` | Optimizes completed simulation job | Future job queue design | Defer. |
| `optimizePortfolioAllocation` | `simulation_or_job_artifact` | Allocation optimizer | Future optimization subsystem | Defer. |
| `optimizeHistoricalAllocation` | `simulation_or_job_artifact` | Historical allocation optimizer | Future optimization subsystem | Defer. |
| `simulatePortfolioWeights` | `simulation_or_job_artifact` | Simple weight simulation | Future simulation helper | Defer. |
| `simulatePortfolioAdjustment` | `simulation_or_job_artifact` | Adjustment impact simulation | Future investment lab scope | Defer. |
| `simulatePortfolioTimemachine` | `simulation_or_job_artifact` | Time-machine scenario simulation | Future investment lab scope | Defer. |
| `comparePortfolioParallelWorlds` | `simulation_or_job_artifact` | Scenario comparison against actual/recommendation | Future investment lab scope | Defer. |
| `comparePortfolioScenario` | `simulation_or_job_artifact` | Scenario comparison | Future investment lab scope | Defer. |
| `backtestValidation` | `simulation_or_job_artifact` | Validation/backtest runner | Future test/research subsystem | Defer. |
| `getSimulationRunDetails` | `simulation_or_job_artifact` | Reads simulation run/chunks/shards | Future job/artifact read model | Defer. |
| `runSimulationPipeline` | `legacy_or_obsolete` | Deprecated legacy orchestration | None | Do not port; Base44 code itself marks replacement path. |

## Shared Modules

`base44/functions/_shared` is not a direct route surface. It contains reusable
logic for KIS access, market calendars, portfolio data, market history,
factor stores, return normalization, simulation math, and optimization.

Migration treatment:

- formulas may be extracted into small pure helpers only when a varda-labs
  feature needs them;
- provider access must use varda-labs provider boundaries, not copied Base44
  token/cache logic;
- simulation helpers wait for the job/artifact subsystem;
- market calendar helpers can be compared against
  `src/lib/snapshots/market-calendar.ts` before any pipeline change.

## Immediate Non-Goals

- no new Base44 function port
- no new route or API mutation
- no `vercel.json`
- no Cron enablement
- no KIS policy, cooldown, or token cache change
- no snapshot writer semantic change
- no schema, FK, or unique constraint change
- no cleanup, delete, repair, restore, or backfill
- no recommendation engine implementation
- no simulation engine implementation

## Recommended Next Order

1. Freeze this function inventory as the routing layer for future work.
2. Do a recommendation model audit before implementing recommendation logic:
   `docs/recommendation-model-audit.md` records the current entity/function
   split and target run/items direction.
3. Use `docs/calculation-fixture-gap-audit.md` to choose focused fixture tests
   before any automated write path depends on existing financial calculations.
4. Continue read-only UI/data work from existing imported tables:
   portfolio dashboard, ETF reference, market context, and event-ledger
   explainability.
5. Return to Cron automation only after a separate approval gate for Phase 2
   controller design.
