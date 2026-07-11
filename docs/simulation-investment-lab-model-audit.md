# Simulation and Investment Lab Model Audit

Last updated: 2026-07-11

Source scanned read-only:

- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\base44\functions`
- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\base44\entities`
- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\src\components\simulation`
- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\src\lib\usePortfolioInsights.js`
- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\src\lib\portfolioInsights.js`
- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\src\pages\Simulation.jsx`
- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\src\pages\SimulationValidation.jsx`

This audit is docs-only. It does not approve Drizzle schema changes,
migrations, imports, route handlers, server actions, simulation engines,
recommendation engines, provider calls, KIS changes, Cron changes, DB writes,
cleanup, delete, repair, or backfill work.

## Executive Decision

Do not port the Base44 simulation and investment lab stack wholesale.

The Base44 implementation is a mix of:

- an older personal finance projection page;
- current portfolio simulation validation UI;
- insight lab comparison cards;
- heavy Base44 function orchestration;
- job, chunk, shard, and compressed payload storage;
- optimization and backtest artifacts;
- recommendation-adjacent comparison paths.

varda-labs should treat this area as a future job/artifact subsystem, not as
core finance schema. The first migration decision is therefore not "which
tables do we import", but "which product surface needs which run summary, which
artifact payload belongs outside relational tables, and which formulas deserve
fixture-backed pure helpers."

## Primary Investment Lab Intent Correction

The primary Investment Lab is now defined by
`docs/investment-lab-historical-counterfactual-contract.md`.

It is not a static before/after weight card. It compares the user's observed
portfolio-value history with a hypothetical portfolio that receives the same
dated buy and sell schedule and the same KRW amounts. "All KODEX 200" is the
first fixed scenario.

Read-only inspection found that legacy parity would be incorrect:

- `simulatePortfolioTimemachine` backcasts current holdings and current weights
  instead of replaying the user's actual historical transaction schedule;
- `comparePortfolioParallelWorlds` flow-adjusts the actual path but funds its
  reference worlds only at inception;
- `portfolioBackcast` can stitch a synthetic path to the actual continuation;
- full-window maximum-Sharpe and minimum-drawdown results use future
  information when presented as historical strategies.

Those formulas and orchestration paths must not be copied. The canonical
replacement is a server-loaded, date- and FX-aware evidence model feeding a
pure transaction-schedule counterfactual engine with no provider calls or
writes.

The product-level decisions for Additional Contribution, Investment Lab, and
Simulation Validation are consolidated in
`docs/decision-support-feature-contracts.md`.

## Simulation Validation Intent Correction

The intended first interaction is an exploratory Monte Carlo experience: show
a bounded, reproducible sample of individual paths as a spaghetti chart and
summarize the full sample with p10/p50/p90 fan bands, drawdown, loss
probability, and terminal-value distributions. This interaction should remain
useful and engaging even before optimization is enabled.

The later allocation optimizer is related but not a literal inversion of those
quantiles. Multiple weight vectors can produce similar p10/p50/p90 summaries,
and model error can be amplified by optimization. varda-labs should search
candidate weights against an explicit objective such as expected terminal
wealth with a p10, expected-shortfall, loss-probability, turnover, or
concentration constraint. Current and candidate weights must be evaluated with
the same paths or common random numbers, horizon, costs, and model assumptions.
Walk-forward validation remains required before presenting a candidate as
decision support rather than an in-sample illustration.

## Current Row Coverage

The current Base44 inventory has no persisted rows for the simulation and
investment lab artifact entities:

| Base44 entity | Rows | Current classification |
| --- | ---: | --- |
| `SimulationJob` | 0 | `job_control` / intentionally skipped |
| `SimulationChunk` | 0 | `shard/blob_artifact` / intentionally skipped |
| `SimulationSampleShard` | 0 | `shard/blob_artifact` / intentionally skipped |
| `SimulationCalibration` | 0 | `run_artifact` / intentionally skipped |
| `SimulationRunResult` | 0 | `run_artifact` / intentionally skipped |
| `PortfolioSimulationRun` | 0 | `run_artifact` / intentionally skipped |
| `PortfolioOptimizationRun` | 0 | `run_artifact` / intentionally skipped |
| `BacktestValidationRun` | 0 | `run_artifact` / intentionally skipped |
| `ScenarioRun` | 0 | `run_artifact` / intentionally skipped |

Related nonzero recommendation and factor entities exist, but they are outside
this audit's implementation scope:

| Related entity | Rows | Current handling |
| --- | ---: | --- |
| `RecommendationRun` | 8 | Covered by recommendation docs; do not repeat here. |
| `RecommendationCandidate` | 82 | Covered by recommendation docs; do not repeat here. |
| `RebalanceRecommendation` | 65 | Legacy recommendation evidence. |
| `AssetFactorProfile` | 27 | Factor/recommendation decision, not simulation persistence. |
| `MarketSignal` | 2 | Recommendation/market signal decision. |

Because all simulation artifact entities are empty, do not create matching
varda-labs tables just to preserve historical rows.

## Product Surface Split

### 1. Legacy `Simulation.jsx`

`src/pages/Simulation.jsx` is not the current main portfolio dashboard. It is an
older finance projection screen that reads `AccountBalance`, `Asset`,
`Settings`, and `FixedTransaction`, then uses
`src/components/finance/assetEngine.jsx` `runSimulationScenario` to project
cash, brokerage, ISA, and IRP balances month by month.

Classification:

- UI surface: legacy / secondary.
- Data model: cashflow projection, not portfolio Monte Carlo.
- Persistence: none required for first varda-labs migration.
- Future treatment: intentionally skipped legacy. The product scope no longer
  includes this cashflow projection or a goal-planning replacement.

Do not use this page as the target for the investment lab or simulation job
subsystem.

### 2. Simulation Validation UI

The current simulation validation surface is driven by:

- `src/pages/SimulationValidation.jsx`
- `src/components/portfolio/desktop/visual/CreativeSimValidationScreen.jsx`
- `src/components/portfolio/mobile/SimulationScreen.jsx`
- `src/components/simulation/useSimulationValidationRun.js`
- `src/components/simulation/runChunkedSimulationJob.js`

The client reads the latest `PortfolioSimulationRun`,
`PortfolioOptimizationRun`, and `BacktestValidationRun`, then can invoke a
multi-step function chain:

1. `startSimulationJob`
2. `runSimulationJobChunk` for each chunk
3. `finalizeSimulationJob`
4. `optimizeSimulationJob`
5. `getSimulationRunDetails` for expanded dense-path/shard details

Classification:

- UI surface: current but not first migration surface.
- Persistence: future job/artifact subsystem.
- Current Base44 client behavior: browser orchestrates multiple function calls.
- varda-labs treatment: do not copy the browser-orchestrated mutation chain.
  Future implementation should be server-owned orchestration with idempotent job
  steps and artifact storage.

### 3. Insights Lab Cards

The desktop lab/history insight cards use `usePortfolioInsights` and
`portfolioInsights` helpers. They enable heavier queries only when the lab or
history view opts in. The key simulation-like calls are:

- `simulatePortfolioTimemachine`
- `comparePortfolioParallelWorlds`
- `simulatePortfolioAdjustment` through draft inputs and UI cards
- `comparePortfolioScenario`

Classification:

- UI surface: current insight/lab display, not first read-only surface.
- Persistence: mostly none, except `comparePortfolioScenario` writes
  `ScenarioRun`.
- Data model: derived read model / run artifact.
- Future treatment: rebuild as server-side read models or explicit scenario
  commands only after auth/tenant and write boundaries are in place.

## Function Classification

### Calibration and Input Preparation

| Base44 function | Observed role | Classification | varda-labs treatment |
| --- | --- | --- | --- |
| `calibratePortfolioFactorModel` | Reads assets, price history, factor rows, and factor profiles; upserts `SimulationCalibration`. | `run_artifact` | Future calibration job. Do not import empty rows. Extract math only with fixtures. |
| `normalizeReturnMatrix` | Builds aligned KRW return matrix from prices and factor observations. | replace with bounded pure contract | Phase 0A implemented as strict adjusted-close and date-specific FX normalization in `docs/simulation-return-matrix-phase0a-contract.md`; no runtime adapter or factor coupling. |

### Direct Simulation Engines

| Base44 function | Observed role | Classification | varda-labs treatment |
| --- | --- | --- | --- |
| `runPortfolioMonteCarlo` | Reads `SimulationCalibration`, estimates, snapshots, assets, and settings; may create `PortfolioSimulationRun`. | `run_artifact` | Future simulation run command, not a page query. |
| `runRegimeBootstrapSimulation` | Uses calibration, prices, benchmark, factors, and snapshots; may create `PortfolioSimulationRun`. | replace rather than port | Pure whole-row stationary draw-plan Phase 1A and per-instrument gross growth Phase 1B implemented without regime conditioning, portfolio aggregation, summaries, or writes; any future run command remains separate. |
| `runHybridPortfolioSimulation` | Large hybrid engine; writes chunks, sample shards, and `PortfolioSimulationRun`. | `job_control` plus `shard/blob_artifact` | Do not port wholesale. Split math, orchestration, and artifact storage. |

### Chunked Job Pipeline

| Base44 function | Observed role | Classification | varda-labs treatment |
| --- | --- | --- | --- |
| `startSimulationJob` | Creates `SimulationJob`, input bundle shards, and job config. | `job_control` | Future server-owned job creation. No browser multi-step mutation. |
| `runSimulationJobChunk` | Executes one chunk, writes `SimulationChunk`, replaces `SimulationSampleShard`, updates job progress. | `job_control` plus `shard/blob_artifact` | Future worker/job step. Needs idempotency and artifact strategy. |
| `finalizeSimulationJob` | Reads chunks/shards, creates `PortfolioSimulationRun`, back-links chunks/shards, updates job. | `job_control` plus `run_artifact` | Future finalize command. |
| `optimizeSimulationJob` | Reads `SimulationJob`/simulation output, creates optimization result. | `job_control` plus `run_artifact` | Future post-simulation optimization step. |
| `getSimulationRunDetails` | Reads `PortfolioSimulationRun` and `SimulationSampleShard`, decodes dense paths. | read helper | Future server-only read helper after artifact storage exists. |
| `runSimulationPipeline` | Base44 code itself returns a deprecated response pointing to the chunked path. | `obsolete` | Do not port. |

### Optimization and Backtesting

| Base44 function | Observed role | Classification | varda-labs treatment |
| --- | --- | --- | --- |
| `optimizePortfolioAllocation` | Reads simulation run and creates `PortfolioOptimizationRun`. | `run_artifact` | Future optimizer artifact. Needs fixtures and clear objective definitions. |
| `optimizeHistoricalAllocation` | Historical optimizer from price series. | pure helper candidate / research artifact | Defer until investment lab product need. |
| `backtestValidation` | Invokes calibration, evaluates points, writes `BacktestValidationRun`. | `run_artifact` | Future validation subsystem, not first migration. |

### Investment Lab What-If Helpers

| Base44 function | Observed role | Classification | varda-labs treatment |
| --- | --- | --- | --- |
| `simulatePortfolioWeights` | Backtests requested weights from price series. | pure helper candidate | Future read-only helper with fixtures. |
| `simulatePortfolioAdjustment` | Compares adjusted portfolio risk/exposure from current positions and snapshots. | derived read model | Future lab helper. No persistence by default. |
| `simulatePortfolioTimemachine` | Backcasts current/target/equal/optimizer scenarios from prices, FX, and events. | derived read model / run artifact | Future lab helper. Keep provider access and price reads server-side. |
| `comparePortfolioParallelWorlds` | Compares actual/target/recommended/reference worlds, uses events, snapshots, prices, and recommendations. | derived read model | Do not connect until recommendation boundary is approved. |
| `comparePortfolioScenario` | Applies scenario and creates `ScenarioRun`. | user command / run artifact | Future write command only after auth/tenant and transaction design. |

## Entity Classification

| Base44 entity | Model class | Notes |
| --- | --- | --- |
| `SimulationJob` | `job_control` | Status, progress, retry, chunk counts, current step, and links to output ids. |
| `SimulationChunk` | `shard/blob_artifact` | Stores per-chunk samples and dense path payload fields. |
| `SimulationSampleShard` | `shard/blob_artifact` | Stores base64 sample payload shards. Better suited to artifact/blob storage plus a manifest. |
| `SimulationCalibration` | `run_artifact` | Point-in-time calibration matrix/statistics. Summary may be relational; matrices should remain JSON/artifacts. |
| `PortfolioSimulationRun` | `run_artifact` | Run header plus result summaries and dense path/fan chart payloads. |
| `PortfolioOptimizationRun` | `run_artifact` | Optimizer output tied to a simulation run and constraints. |
| `SimulationRunResult` | `obsolete` / legacy result | Older result shape. No rows. Do not create table unless a product surface specifically needs it. |
| `BacktestValidationRun` | `run_artifact` | Validation summary and point details. No rows now. |
| `ScenarioRun` | `run_artifact` / user command result | Scenario comparison output. No rows now. Requires user ownership before writes. |

## Artifact Storage Direction

Do not put dense path samples, compressed sample matrices, or large fan-chart
payloads into first-pass relational tables.

Future varda-labs should split:

- relational job/run headers for filtering and status;
- small scalar summaries for first-screen UI;
- JSONB for bounded diagnostics and objective summaries;
- blob or artifact storage for dense paths, sample shards, large matrices, and
  input bundles;
- manifest rows that point from job/run ids to artifact ids.

This keeps Postgres useful for queries without turning it into a large binary
payload store.

## Pure Helper Candidates

These areas may become pure, fixture-tested helpers before any persistence:

- KRW return matrix normalization (Phase 0A pure helper implemented; runtime
  adapter remains pending and the approved pure consumers are Phase 1A draw
  planning and Phase 1B gross growth materialization);
- seeded whole-row stationary-bootstrap draw planning (Phase 1A pure helper
  implemented);
- per-instrument gross growth-factor materialization (Phase 1B pure helper
  implemented; portfolio aggregation, summaries, and artifacts remain
  pending);
- weight normalization and rebalancing calendar logic;
- simple historical weight backtests;
- risk contribution and effective-number-of-bets calculations;
- scenario metric summaries;

Provider reads, Base44 entity reads, job status updates, and artifact writes
must stay outside pure helpers.

## Ownership and Write Boundary

All future simulation and investment lab writes are user-owned. Base44 uses a
mix of `owner_id` and `created_by_id`; varda-labs should not copy that mix.
Before any simulation write path:

1. finish the auth/tenant design gate;
2. choose the canonical owner key;
3. design app-level authorization;
4. decide whether RLS applies to job/run/artifact rows;
5. define an admin/worker identity for background job steps;
6. keep public/reference market data separate from user-owned run artifacts.

Do not expose the current entity API routes as user-facing simulation CRUD.

## Relationship to Recommendation

Recommendation planning already lives in:

- `docs/recommendation-model-audit.md`
- `docs/recommendation-schema-proposal.md`
- `docs/recommendation-implementation-plan.md`

This audit does not reopen that model. The only boundary to carry forward is:

- `comparePortfolioParallelWorlds` can read recommendation candidates/plans in
  Base44, so varda-labs must not connect parallel-world scenarios to
  recommendation output until recommendation run/items are approved.
- simulation/optimization output must not mutate recommendation rows or event
  ledger rows.
- executed trades belong to a separate user command and `event_ledger_entries`,
  not to simulation or recommendation artifacts.

## Proposed Future Implementation Gates

1. Product gate: decide which surface comes first:
   - simulation validation;
   - insight lab timemachine/parallel-world comparison;
   - scenario command.
2. Auth gate: complete owner model and write authorization.
3. Pure-helper gate: add fixtures for math that can run without providers or DB
   writes.
4. Artifact gate: choose storage for dense paths, shards, and input bundles.
5. Job-control gate: design idempotent job state transitions and worker/admin
   identity.
6. Read-model gate: define minimal run summary query for UI.
7. Write gate: only then add schema, migrations, routes, or server actions.

## Current Non-Goals

- no simulation schema migration;
- no simulation import script;
- no simulation route, API route, or server action;
- no simulation UI in varda-labs;
- no legacy cashflow projection or goal-planning migration;
- no job queue implementation;
- no dense path or shard storage implementation;
- no provider, KIS, market-data, or LLM calls;
- no recommendation connection;
- no user-facing writes;
- no cleanup, delete, backfill, or repair.
