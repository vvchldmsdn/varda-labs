# Recommendation Schema Proposal

Last updated: 2026-07-08

Status: proposal only. This document does not create Drizzle schema, SQL
migrations, import scripts, routes, UI, recommendation execution, provider calls,
or LLM calls.

## Purpose

This proposal turns `docs/recommendation-model-audit.md` into a logical
database shape for a future recommendation system. The goal is to prevent a
1:1 copy of the Base44 recommendation tables and JSON blobs.

The target model should support:

- deterministic recommendation runs
- candidate/action rows attached to a run
- structured fields for filtering and display
- JSONB evidence for detailed score/debug context
- optional post-run explanation/content
- future user review/execution records
- legacy Base44 evidence if imported later

## Non-Goals

- no `src/db/schema.ts` change
- no Drizzle migration
- no import script
- no recommendation route or server action
- no recommendation UI
- no engine implementation
- no LLM or provider call
- no trade execution
- no EventLedger write
- no Cron/KIS/snapshot pipeline change

## Naming Decision

Use `recommendation_runs` plus `recommendation_items` as the preferred logical
names.

Reason:

- Base44 `RecommendationCandidate` is close to the future item shape, but
  `candidate` can imply an intermediate object that never becomes a decision.
- varda-labs needs one row per recommendation output item, whether executable
  or observation-only.
- `recommendation_items` leaves room for candidate generation internals to
  exist later without becoming the persisted public run output.

If later implementation prefers `recommendation_candidates`, keep the same
fields and relationships. Do not support both names.

## Logical Tables

### `recommendation_runs`

Role: one deterministic engine run for one account/date/input snapshot.

Layer: run artifact.

Base44 source mapping:

- primary mapping from `RecommendationRun`
- legacy evidence mapping from `RebalanceRecommendation` only if imported later
- not mapped from `EtfCandidateRun` or `EtfLookthroughRun`

Column groups:

| Group | Candidate fields | Notes |
| --- | --- | --- |
| Identity | `id`, `legacy_base44_id` | `legacy_base44_id` only for imported Base44 rows. |
| Run key | `run_date`, `account`, `account_id` | `account_id` nullable because imported rows may not map. |
| Source | `source`, `engine_version`, `status` | `source` examples: `varda_engine`, `base44_import`. |
| Context | `regime_label`, `regime_score`, `fx_buy_multiplier` | Scalar fields only for common display/filter needs. |
| Counts | `include_count`, `replace_count`, `trim_count`, `watch_count`, `execution_count` | Derived from items when possible, but useful on run header. |
| Input snapshot | `portfolio_profile_json`, `signals_used_json`, `config_json`, `warnings_json` | JSONB evidence, not canonical source data. |
| Legacy evidence | `legacy_source_type`, `legacy_items_json`, `legacy_raw_json` | Only for imported legacy rows. |
| Timestamps | `base44_created_at`, `base44_updated_at`, `created_at`, `updated_at` | Same import timestamp pattern as other migrated tables. |

Proposed status values:

- `draft`
- `ready`
- `partial`
- `failed`
- `imported`
- `archived`

Implementation note: do not create a status enum until the first implementation
needs it. A varchar with validation in the command layer may be easier during
migration.

### `recommendation_items`

Role: one output item in a recommendation run.

Layer: run artifact item.

Base44 source mapping:

- primary mapping from `RecommendationCandidate`
- optional best-effort mapping from each legacy `RebalanceRecommendation.items_json`
  element if old rows are imported

Column groups:

| Group | Candidate fields | Notes |
| --- | --- | --- |
| Identity | `id`, `legacy_base44_id`, `legacy_item_key` | `legacy_item_key` is useful for item JSON that has no Base44 row id. |
| Parent | `recommendation_run_id`, `legacy_run_id` | `recommendation_run_id` nullable only during import staging. |
| Run key copy | `run_date`, `account`, `account_id` | Duplicated for simpler read queries; run remains source of truth. |
| Action | `candidate_type`, `status`, `suggested_amount_krw` | Mirrors Base44 include/replace/trim/watch direction. |
| Target asset | `asset_id`, `legacy_asset_id`, `ticker`, `name`, `market` | Keep raw ticker/name even if no asset maps. |
| Replacement source | `from_asset_id`, `legacy_from_asset_id`, `from_ticker`, `from_name` | Only for replace/trim style items. |
| Allocation | `current_weight_pct`, `target_weight_pct` | Point-in-time recommendation evidence. |
| Score | `score`, `confidence_pct` | Headline display/filter fields. |
| Evidence JSONB | `score_breakdown_json`, `reasons_json`, `counter_reasons_json`, `cancel_conditions_json`, `signals_json`, `guardrails_passed_json`, `expected_impact_json` | Keep detailed shape flexible. |
| Legacy raw | `legacy_raw_json` | Preserve raw item if imported from `items_json`. |
| Timestamps | `base44_created_at`, `base44_updated_at`, `created_at`, `updated_at` | Same import timestamp pattern. |

Proposed `candidate_type` values:

- `include`
- `replace`
- `trim`
- `watch`

Proposed item `status` values:

- `executable`
- `observation`
- `blocked`
- `superseded`
- `imported`

Do not treat `executable` as permission to trade. It only means the
recommendation engine's guardrails passed at run time.

### `recommendation_explanations` optional

Role: post-run narrative/content artifact.

Layer: content artifact, not calculation source.

Add only if LLM or generated narrative becomes a real product surface.

Column groups:

| Group | Candidate fields | Notes |
| --- | --- | --- |
| Identity | `id`, `legacy_base44_id` | Legacy id if imported from `RecommendationRun` briefing fields. |
| Parent | `recommendation_run_id` | Required for varda-generated rows. |
| Content | `summary`, `briefing_text`, `top_changes_json` | LLM or templated output. |
| Source | `source`, `engine_version`, `model_name`, `prompt_version` | Do not store prompt secrets or raw credentials. |
| Status | `status`, `warnings_json` | Allows failed/partial content generation without corrupting run. |
| Timestamps | `created_at`, `updated_at` | Normal varda-labs timestamps. |

Decision: do not put long LLM markdown in `recommendation_runs` unless the
product chooses a small, single-table design. Keep deterministic run data and
generated prose separable.

### `recommendation_signals` optional

Role: reusable generated market/factor signal evidence.

Layer: generated evidence.

Add only if signals become a read surface or a reusable input to multiple runs.
Do not create it just to import the two existing Base44 `MarketSignal` rows.

Column groups:

| Group | Candidate fields | Notes |
| --- | --- | --- |
| Identity | `id`, `legacy_base44_id` | For imported signals only. |
| Signal key | `signal_date`, `signal_key`, `signal_type`, `scope`, `scope_value` | Mirrors Base44 where useful. |
| Effect | `direction`, `strength`, `score_delta` | Numeric fields useful for scoring/display. |
| Evidence | `headline`, `explanation`, `evidence_json`, `affects_tickers_json`, `affects_tags_json` | Detailed evidence stays JSONB. |
| Validity | `valid_until`, `source`, `status` | Signals should expire or be superseded. |
| Timestamps | `base44_created_at`, `base44_updated_at`, `created_at`, `updated_at` | Same import timestamp pattern. |

### `recommendation_reviews` optional

Role: user review or execution comparison after a recommendation.

Layer: user action/review artifact.

Add only when the product has a review/execution workflow. It should not be part
of first recommendation generation.

Column groups:

| Group | Candidate fields | Notes |
| --- | --- | --- |
| Identity | `id`, `legacy_base44_id` | Base44 `RebalanceReview` has zero rows now. |
| Parent | `recommendation_run_id`, `legacy_recommendation_id` | Parent may point to imported old run evidence. |
| Review key | `year_month`, `account`, `account_id` | Account FK nullable for legacy rows. |
| Execution | `executed`, `execution_date`, `executed_items_json` | Execution details are review evidence, not trades. |
| Comparison | `portfolio_before_json`, `portfolio_after_json`, `portfolio_counterfactual_json` | JSONB evidence. |
| Metrics | `perf_return_actual`, `perf_return_counterfactual`, `risk_enb_before`, `risk_enb_after`, `risk_avg_corr_before`, `risk_avg_corr_after`, `risk_mdd_before`, `risk_mdd_after` | Optional scalar review metrics. |
| User input | `review_memo`, `review_score` | Future user-owned surface. |

If the user executes trades from a recommendation, write that through a separate
command and `event_ledger_entries`. Do not mutate recommendation rows into a
portfolio transaction ledger.

### `asset_factor_profiles` optional

Role: reusable per-asset exposure/factor profile.

Layer: generated factor evidence.

Current decision: defer. Base44 has 27 `AssetFactorProfile` rows, but factor
profile ownership, source priority, ETF lookthrough dependency, and refresh
semantics need their own model decision.

## Relationship Rules

| Relationship | Rule |
| --- | --- |
| Run to items | One run has many items. Items should not exist without a run after import staging. |
| Run to account | `account_id` nullable; keep raw `account` string. |
| Item to asset | `asset_id` nullable; keep raw `legacy_asset_id`, `ticker`, and `name`. |
| Item to replacement source | nullable; keep `from_ticker` and `from_name`. |
| Run to explanation | optional one-to-many or one-to-one, depending on content lifecycle. |
| Run to signals | store signal keys/ids in JSONB first; normalize only if signals become reusable product data. |
| Review to execution | review may reference executed items, but actual portfolio changes belong in `event_ledger_entries`. |

## Candidate Indexes And Constraints

Proposal only. Do not create these until the implementation step.

| Table | Candidate index/constraint | Purpose |
| --- | --- | --- |
| `recommendation_runs` | unique `legacy_base44_id` where not null | Idempotent Base44 import. |
| `recommendation_runs` | `(run_date, account, source)` | Find latest/current run by account. |
| `recommendation_runs` | `(account_id, run_date)` | Current-account lookup when mapped. |
| `recommendation_runs` | `(status, run_date)` | Operational filtering. |
| `recommendation_items` | unique `legacy_base44_id` where not null | Idempotent Base44 item import. |
| `recommendation_items` | `(recommendation_run_id, candidate_type)` | Render grouped run items. |
| `recommendation_items` | `(ticker, run_date)` | Ticker history lookup. |
| `recommendation_items` | `(account, run_date)` | Account-level recommendation history. |
| `recommendation_signals` | unique `(signal_date, signal_key, source)` | Avoid duplicate generated signals. |
| `recommendation_explanations` | `(recommendation_run_id, source)` | Fetch content for a run. |

Use nullable FKs for imported legacy links until all historical rows map
cleanly. Do not add hard FK constraints in the proposal step.

## Base44 Mapping Rules

### `RecommendationRun`

Map to future `recommendation_runs`.

| Base44 field | Target direction |
| --- | --- |
| `id` | `legacy_base44_id` |
| `date` | `run_date` |
| `account` | raw `account`, optional `account_id` mapping |
| `engine_version` | `engine_version` |
| `regime_label`, `regime_score`, `fx_buy_multiplier` | scalar context fields |
| `summary` | run summary or explanation summary depending on final content split |
| `briefing_text`, `top_changes_json` | prefer `recommendation_explanations` if that table exists |
| count fields | run count fields |
| `signals_used_json`, `portfolio_profile_json`, `config_json`, `warnings_json` | JSONB evidence |

### `RecommendationCandidate`

Map to future `recommendation_items`.

| Base44 field | Target direction |
| --- | --- |
| `id` | `legacy_base44_id` |
| `run_id` | `legacy_run_id`, resolved to `recommendation_run_id` |
| `date`, `account` | copied run keys for query convenience |
| `candidate_type`, `status` | item action/status fields |
| `ticker`, `name`, `market` | target identity |
| `from_ticker`, `from_name` | replacement source identity |
| `suggested_amount_krw` | action amount |
| `current_weight_pct`, `target_weight_pct` | allocation evidence |
| `score`, `confidence_pct` | headline score fields |
| JSON fields | item evidence JSONB |
| `description` | optional item note; not a scoring source |

### `RebalanceRecommendation`

Do not use as the final model.

If imported later:

- create one legacy run row per Base44 row;
- preserve `items_json` as raw legacy evidence;
- optionally best-effort normalize each item into `recommendation_items`;
- store raw item JSON on each normalized item;
- mark `source` as `base44_rebalance_legacy`.

### `MarketSignal`

Do not import by default.

Import only if it is needed to explain imported recommendation runs or becomes
a reusable product surface.

### Zero-row auxiliary entities

Skip until product surfaces exist:

- `RebalanceReview`
- `EtfCandidateRun`
- `EtfLookthroughRun`
- `AssetFactorEstimate`

## Import Policy

No import now.

If import is approved later:

1. Add schema/migration in a separate step.
2. Add import scripts with dry-run default.
3. Write only with `--write`.
4. Preserve `legacy_base44_id`.
5. Exclude owner/user ids until tenant/user modeling exists.
6. Exclude provider credentials, raw auth headers, tokens, and secrets.
7. Use nullable account/asset/run references for historical rows.
8. Store raw legacy JSON as JSONB evidence.
9. Keep `RebalanceRecommendation.items_json` out of primary query paths.

## Read Model Direction

First read-only recommendation UI should query:

- latest ready run for selected account;
- item rows grouped by `candidate_type`;
- item headline fields for table/card display;
- JSONB reasons only for detail expansion;
- optional explanation row if content exists.

Do not compute recommendations in the browser. Client components may only sort,
filter, or expand already-rendered data.

## Open Questions

1. Should the persisted item table be named `recommendation_items` or
   `recommendation_candidates`?
2. Should `briefing_text` live on `recommendation_runs` for simplicity or in
   `recommendation_explanations` for lifecycle separation?
3. Should imported Base44 `RebalanceRecommendation` rows be normalized into
   item rows, or preserved only as raw legacy run evidence?
4. Should `MarketSignal` be imported before any recommendation UI exists?
5. Should `AssetFactorProfile` be a product table or a recomputed scoring
   artifact?
6. How should eventual execution connect to `event_ledger_entries` without
   turning recommendations into trade records?

## Recommended Next Step

After this proposal is reviewed, the next safe step is still not migration.

Recommended order:

1. Decide naming: `recommendation_items` vs `recommendation_candidates`.
2. Decide content split: run row field vs separate explanation table.
3. Add more fixture tests for pure recommendation input calculations if needed.
4. Only then draft an actual Drizzle schema change in a separate commit.
