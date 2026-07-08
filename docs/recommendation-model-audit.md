# Recommendation Model Audit

Last updated: 2026-07-08

Source scanned read-only:

- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\base44\entities`
- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\base44\functions`
- `docs/migration-coverage-audit.md`
- `docs/function-migration-audit.md`

This is a modeling audit only. It does not add tables, import scripts, routes,
UI, provider calls, LLM calls, or recommendation execution.

## Decision

Do not implement recommendations yet.

Before recommendation UI or engine work, varda-labs needs a target run/items
model that separates:

- source inputs
- deterministic calculation artifacts
- recommendation decisions
- explanation/debug evidence
- optional AI-authored narrative
- eventual user action or trade execution

Base44 has two recommendation shapes and several auxiliary analysis shapes. The
future varda-labs model should use the newer `RecommendationRun` plus
`RecommendationCandidate` direction as the conceptual base, not the older
single-row `RebalanceRecommendation.items_json` shape.

## Current varda-labs State

There are no recommendation-specific tables or routes in varda-labs yet.

Current usable source tables:

- `assets`, `accounts`, `asset_groups`, `asset_group_members`
- `event_ledger_entries`
- `asset_price_snapshots`
- `daily_portfolio_snapshots`
- `daily_position_snapshots`
- `fx_rates`
- `benchmark_snapshots`
- `market_regime_daily`
- `global_market_factors`
- `etf_masters`
- `etf_holdings`
- `settings`

Current calculation helpers:

- `src/lib/portfolio-dashboard.ts`
- `src/lib/portfolio-return-metrics.ts`
- `src/lib/portfolio-return-metrics-core.ts`
- `src/lib/portfolio-math.ts`

These helpers are useful inputs, but they are not a recommendation engine.

## Base44 Entity Split

| Entity | Rows | Current role | Model decision |
| --- | ---: | --- | --- |
| `RebalanceRecommendation` | 65 | Older date/account row with `items_json`, summary, cash input, regime fields | Treat as legacy evidence only. Do not make this the final varda-labs model. |
| `RecommendationRun` | 8 | Newer run header with engine version, counts, config, portfolio profile, signals, optional briefing | Closest to future `recommendation_runs`. |
| `RecommendationCandidate` | 82 | Newer run item with candidate type, status, ticker, score, reasons, guardrails, expected impact | Closest to future `recommendation_items` or `recommendation_candidates`. |
| `RebalanceReview` | 0 | Monthly review/execution comparison for old recommendations | Skip for now. Add only with a review product surface. |
| `MarketSignal` | 2 | Generated signal rows used by recommendation scoring | Treat as generated evidence. Import only if historical explainability is required. |
| `EtfCandidateRun` | 0 | Older ETF candidate run blob | Skip. Future candidate rows should be normalized under recommendation items. |
| `EtfLookthroughRun` | 0 | ETF lookthrough result blob | Skip as persisted model for now; use `etf_holdings` directly for read-only lookthrough. |
| `AssetFactorProfile` | 27 | Derived per-asset exposure/factor profile | Needs factor model decision. Do not let it block recommendation schema design. |
| `AssetFactorEstimate` | 0 | Regression/factor estimate artifact | Skip until a factor engine exists. |

## Base44 Function Split

| Function | Writes | Role | varda-labs treatment |
| --- | --- | --- | --- |
| `generateRecommendations` | `RecommendationRun`, `RecommendationCandidate` | Newer unified recommendation engine | Use as behavior reference only. Rebuild with tests and target schema. |
| `calcRebalanceRecommendation` | `RebalanceRecommendation`, also touches market regime output | Older rebalance/cash allocation engine with provider and LLM concerns mixed in | Do not port as final engine. Extract formulas only after fixture tests. |
| `buildRecommendationBriefing` | updates `RecommendationRun` | LLM narrative for a completed run | Future post-run content step only; never inside critical calculation transaction. |
| `calcDiversification` | no recommendation table write found | Risk/diversification analytics with provider price fetching mixed in | Extract pure math later; provider access must stay outside pure calculation. |
| `generatePortfolioWeaknessCards` | no recommendation table write found | UI/content helper for weakness cards | Future read model/content helper. |
| `classifyPortfolioPersonality` | no recommendation table write found | Classification/content layer | Defer until product decision. |
| `analyzeEtfCandidates` | `EtfCandidateRun` | ETF include/replace/trim candidate run | Do not preserve separate run shape; fold useful logic into future item generation. |
| `findEtfSubstitutes` | none found | ETF replacement candidate helper | Future pure helper/reference only. |
| `analyzeEtfHoldingLookthrough` | `EtfLookthroughRun` | Lookthrough exposure analysis | Use `etf_holdings` for read-only UI; persisted run can wait. |
| `compareEtfLookthrough` | none found | Lookthrough comparison | Defer. |
| `listMarketSignals` | `MarketSignal` | Builds/refreshes market signal rows | Future signal generator candidate; no import/write now. |
| `syncAssetFactorProfiles` | `AssetFactorProfile` | Builds derived asset factor profiles | Defer until factor model decision. |

## Field Classification

| Field group | Base44 examples | Classification | Target direction |
| --- | --- | --- | --- |
| Run identity | `date`, `account`, `engine_version` | run artifact key | Scalar columns on future run table. |
| Runtime config | `config_json`, thresholds, weights, guardrails | run artifact evidence | JSONB snapshot on run. |
| Portfolio profile | `portfolio_profile_json`, current holdings/weights/drift | input snapshot evidence | JSONB on run plus normalized source references where useful. |
| Market context | `regime_label`, `regime_score`, `fx_buy_multiplier`, `signals_used_json` | input/evidence | Scalar fields for common labels; JSONB for evidence references. |
| Candidate identity | `ticker`, `name`, `market`, `from_ticker` | recommendation item | Scalar item columns. |
| Candidate action | `candidate_type`, `status`, `suggested_amount_krw`, `current_weight_pct`, `target_weight_pct` | recommendation decision | Scalar item columns. |
| Scores | `score`, `confidence_pct`, `score_breakdown_json` | derived score artifact | Scalar headline score plus JSONB breakdown. |
| Reasons | `reasons_json`, `counter_reasons_json`, `cancel_conditions_json`, `guardrails_passed_json`, `expected_impact_json` | explanation/debug artifact | JSONB on item. |
| Old item blob | `RebalanceRecommendation.items_json` | legacy evidence | Preserve raw only if importing old rows; do not query as primary model. |
| Briefing/content | `briefing_text`, `top_changes_json`, generated cards/personality | content artifact | Separate post-run explanation/content step. |
| Review/execution | `RebalanceReview.executed`, `executed_items_json`, actual/counterfactual performance | user action/review artifact | Future execution/review subsystem, not first recommendation model. |
| Provider data | KIS/Finnhub/AlphaVantage fetches in calculation functions | external source access | Must be outside pure recommendation math; use existing market-data tables. |

## Target Model Proposal

No schema is added by this audit. If/when recommendation persistence is approved,
use this shape as the starting point.

### `recommendation_runs`

Purpose: one deterministic engine run for one account/date and input snapshot.

Candidate columns:

- identity: `id uuid`, nullable `legacy_base44_id varchar(24) unique`
- keys: `run_date date`, `account varchar(50)`, nullable `account_id uuid`
- source: `source varchar(100)`, `engine_version varchar(100)`, `status varchar(50)`
- context: `regime_label`, `regime_score`, `fx_buy_multiplier`
- counts: `include_count`, `replace_count`, `trim_count`, `watch_count`,
  `execution_count`
- inputs/evidence: `portfolio_profile_json jsonb`, `signals_used_json jsonb`,
  `config_json jsonb`, `warnings_json jsonb`
- content: optional `summary text`; do not put long LLM markdown in the core
  calculation row unless the content model stays small
- timestamps: Base44 imported timestamps plus varda-labs timestamps

### `recommendation_items`

Purpose: one actionable or observational candidate in a run.

Candidate columns:

- identity: `id uuid`, nullable `legacy_base44_id varchar(24) unique`
- parent: `recommendation_run_id uuid`, nullable `legacy_run_id varchar(24)`
- keys: `run_date date`, `account varchar(50)`, nullable `account_id uuid`
- action: `candidate_type`, `status`, `suggested_amount_krw`
- target: nullable `asset_id uuid`, `ticker`, `name`, `market`
- replacement source: nullable `from_asset_id uuid`, `from_ticker`,
  `from_name`
- allocation: `current_weight_pct`, `target_weight_pct`
- score: `score`, `confidence_pct`
- explanation: `score_breakdown_json jsonb`, `reasons_json jsonb`,
  `counter_reasons_json jsonb`, `cancel_conditions_json jsonb`,
  `signals_json jsonb`, `guardrails_passed_json jsonb`,
  `expected_impact_json jsonb`

### Optional Later Tables

| Table | When to add | Notes |
| --- | --- | --- |
| `recommendation_signals` | if signals become reusable product data | Do not import two legacy `MarketSignal` rows just to create a table. |
| `recommendation_explanations` | if LLM/content needs separate lifecycle | Keeps narratives out of deterministic engine transaction. |
| `asset_factor_profiles` | if factor exposure becomes product data | Requires a factor model decision and source priority rules. |
| `recommendation_reviews` | if monthly review/execution comparison returns | Keep separate from recommendation generation. |

## Engine Boundary

Recommended future flow:

1. Server command receives account/date/config.
2. Load source data from varda-labs tables only.
3. Build a deterministic input snapshot.
4. Run pure calculation helpers:
   - portfolio profile
   - drift/cash allocation
   - risk/diversification metrics
   - signal matching
   - candidate scoring
   - guardrail checks
5. Persist run plus item rows in one transaction.
6. Optionally generate briefing/content after the run exists.
7. Render read-only recommendation UI from run/items.
8. If the user executes an action later, write a separate command/event ledger
   entry. Do not mutate the recommendation row into a trade record.

Boundaries:

- Pure calculation helpers must not call KIS, Finnhub, AlphaVantage, LLMs, or DB
  writes.
- Provider data should arrive through `asset_price_snapshots`, `fx_rates`,
  `global_market_factors`, and `market_regime_daily`.
- LLM-generated content is not a source of truth for scores or actions.
- Client components can sort/filter displayed candidates, but cannot perform
  multi-step recommendation writes.

## Import Decision

Do not import recommendation rows yet.

When legacy explainability is needed, import in this order:

1. `RecommendationRun` and `RecommendationCandidate` as historical run/items.
2. `RebalanceRecommendation` only as legacy evidence, either:
   - raw legacy run rows with `items_json` preserved, or
   - normalized best-effort items with raw item JSON retained.
3. `MarketSignal` only if explaining imported runs requires it.
4. Skip zero-row `RebalanceReview`, `EtfCandidateRun`, `EtfLookthroughRun`, and
   `AssetFactorEstimate` until product surfaces exist.

Every import script should follow existing migration rules:

- dry-run by default
- write only with `--write`
- preserve `legacy_base44_id`
- keep current UUID ids in varda-labs
- use nullable foreign keys for legacy asset/account links
- exclude owner/user ids and any provider credentials
- keep raw legacy JSON as JSONB evidence, not primary query structure

## Test Requirements Before Implementation

Before any recommendation route or write path:

- fixture tests for portfolio profile and weight calculations
- fixture tests for event-ledger cost/realized return inputs
- fixture tests for MA/trend evidence selection from price snapshots
- fixture tests for drift/cash allocation rules
- fixture tests for guardrails: churn window, taxable account penalty,
  minimum holding days, minimum execution size
- fixture tests for ETF substitution/candidate scoring
- snapshot tests for legacy import parsing if old rows are imported

## Explicit Non-Goals

- no recommendation schema migration
- no recommendation import script
- no recommendation route or server action
- no recommendation UI
- no Base44 function port
- no LLM/API/provider call
- no ETF exposure scoring implementation
- no simulation connection
- no trade execution or portfolio mutation
- no Cron/KIS/snapshot pipeline change

## Recommended Next Step

After this audit is reviewed, choose one narrow lane:

1. Add fixture tests around existing financial calculation helpers, especially
   return metrics and daily movement inputs.
2. Draft a recommendation schema proposal without migration. The current
   proposal lives in `docs/recommendation-schema-proposal.md`.
3. Continue read-only product screens from already imported tables.

Do not implement the recommendation engine until the schema proposal and test
fixtures are accepted.
