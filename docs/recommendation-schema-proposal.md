# Recommendation Schema Proposal

Last updated: 2026-07-10

Status: proposal only. This document does not create Drizzle schema, SQL
migrations, import scripts, routes, UI, recommendation execution, provider calls,
or LLM calls.

## Purpose

This proposal turns `docs/recommendation-model-audit.md` into a logical
database shape for a future recommendation system. The current first-lane
implementation gate lives in `docs/recommendation-implementation-plan.md`.
The goal is to prevent a 1:1 copy of the Base44 recommendation tables and JSON
blobs.

The target model should support:

- deterministic recommendation runs
- candidate/action rows attached to a run
- structured fields for filtering and display
- JSONB evidence for detailed score/debug context
- optional post-run explanation/content
- future user review/execution records
- legacy Base44 evidence if imported later

The canonical owner prerequisite is defined in
`docs/auth-tenant-phase0-preflight.md`. Recommendation persistence must not be
implemented before that owner migration is approved.

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

Decision: use `recommendation_items` for the persisted output rows. Do not
support both `recommendation_items` and `recommendation_candidates`.

## Accepted Decisions

These decisions are accepted for the next planning step. They still do not
authorize schema, migration, import, route, UI, or engine implementation.

### 1. Persisted item table naming

Use `recommendation_items`.

Reason:

- The persisted row is an output item, not necessarily an internal generation
  candidate.
- Internal candidate generation can still exist later without becoming the
  public persisted table.
- Supporting both item and candidate table names would add avoidable migration
  and query complexity.

### 2. Briefing and generated content split

Keep deterministic run data separate from generated narrative content.

Preferred direction:

- `recommendation_runs` stores deterministic run header, input snapshot,
  counts, context, status, and legacy evidence.
- `recommendation_explanations` remains optional and later-only for generated
  summaries, briefing text, top changes, model metadata, and content status.
- The first schema may omit `recommendation_explanations` if no content product
  is ready.

Rule: LLM or generated narrative must not be inside the critical calculation or
write transaction.

### 3. Legacy `RebalanceRecommendation.items_json`

Preserve raw legacy evidence first. Do not normalize
`RebalanceRecommendation.items_json` into the primary query model by default.

If historical recommendation UI explicitly needs old item rows later:

- create one legacy run row per Base44 `RebalanceRecommendation`;
- best-effort normalize item JSON into `recommendation_items`;
- keep the raw item JSON on each normalized row;
- keep the original full `items_json` on the legacy run evidence.

### 4. `MarketSignal`

Defer import and modeling.

Do not create `recommendation_signals` just to preserve the two existing
Base44 `MarketSignal` rows. If historical recommendation runs need signal
evidence later, store signal keys or raw evidence in run/item JSONB first.
Normalize only when signals become a reusable read surface or a reusable input
to multiple runs.

### 5. `AssetFactorProfile`

Defer factor profile modeling.

Do not block the recommendation run/items schema on `AssetFactorProfile`.
Treat it as a future factor evidence or read-model decision that needs its own
source priority, ETF lookthrough dependency, ownership, and refresh semantics.

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
| Identity | `id`, `owner_user_id`, `legacy_base44_id` | `owner_user_id uuid NOT NULL` for every row. `legacy_base44_id` only for imported Base44 rows. |
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
- optional best-effort mapping from each legacy
  `RebalanceRecommendation.items_json` element only if historical UI explicitly
  needs normalized old rows

Column groups:

| Group | Candidate fields | Notes |
| --- | --- | --- |
| Identity | `id`, `owner_user_id`, `legacy_base44_id`, `legacy_item_key` | `owner_user_id uuid NOT NULL` and must equal the parent run owner. `legacy_item_key` is useful for item JSON that has no Base44 row id. |
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

Decision: do not put long LLM markdown in `recommendation_runs`. Keep
deterministic run data and generated prose separable. This table can be omitted
from the first implementation if no recommendation content surface is ready.

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
| Run/item to owner | Both require canonical `owner_user_id`; item owner must equal its parent run owner. |
| Run to items | One run has many items. Items should not exist without a run after import staging. |
| Run to account | `account_id` nullable; keep raw `account` string. Account is portfolio scope, never tenant identity. |
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
| `recommendation_runs` | unique `(owner_user_id, id)` | Composite parent key for enforcing item/run owner equality. |
| `recommendation_runs` | `(owner_user_id, run_date, account, source)` | Find latest/current run inside one owner boundary. |
| `recommendation_runs` | `(owner_user_id, account_id, run_date)` | Current-account lookup when mapped. |
| `recommendation_runs` | `(owner_user_id, status, run_date)` | User-scoped operational filtering. |
| `recommendation_items` | unique `legacy_base44_id` where not null | Idempotent Base44 item import. |
| `recommendation_items` | FK `(owner_user_id, recommendation_run_id)` to run `(owner_user_id, id)` | Reject parent/item owner mismatch. |
| `recommendation_items` | `(owner_user_id, recommendation_run_id, candidate_type)` | Render grouped run items and preserve owner locality. |
| `recommendation_items` | `(owner_user_id, ticker, run_date)` | User-scoped ticker history lookup. |
| `recommendation_items` | `(owner_user_id, account, run_date)` | User/account recommendation history. |
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
- best-effort normalize each item into `recommendation_items` only if a
  historical recommendation UI explicitly needs item-level old rows;
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
5. Require the approved canonical `owner_user_id`; imported rows must use the
   explicit initial owner and never a raw Base44 owner value.
6. Exclude provider credentials, raw auth headers, tokens, and secrets.
7. Use nullable account/asset/run references for historical rows.
8. Store raw legacy JSON as JSONB evidence.
9. Keep `RebalanceRecommendation.items_json` out of primary query paths.

## Read Model Direction

First read-only recommendation UI should query:

- current canonical owner from trusted server context;
- latest ready run for selected account;
- item rows grouped by `candidate_type`;
- item headline fields for table/card display;
- JSONB reasons only for detail expansion;
- optional explanation row if content exists.

Owner filtering must precede account/date filters. Do not compute
recommendations in the browser. Client components may only sort, filter, or
expand already-rendered data.

## Open Questions

1. What exact status strings and validation layer should the first
   implementation use?
2. Should the first implementation import historical `RecommendationRun` and
   `RecommendationCandidate` rows, or start varda-native only?
3. Should recommendation import happen before the first read-only
   recommendation UI?
4. What fixture coverage is required before the first recommendation migration?
5. When should `AssetFactorProfile` get its own model, and should it be
   sourced from ETF lookthrough, market factor data, or recomputed scoring
   inputs?
6. How should eventual execution connect to `event_ledger_entries` without
   turning recommendations into trade records?

## Next Approval Gate

The next approval gate is an implementation plan, not a migration.

Before any Drizzle schema or SQL migration is created, write a short plan that
confirms:

- final table list for the first implementation;
- final column set and nullable relationship rules;
- whether historical Base44 rows are imported in the same phase;
- dry-run default import behavior if import is included;
- test fixtures required before recommendation generation or write paths;
- explicit non-goals for LLM/provider calls, execution, and UI mutation.

## Recommended Next Step

After these decisions are reviewed, the next safe step is still not migration.

Recommended order:

1. Review `docs/recommendation-implementation-plan.md`.
2. Decide whether the first implementation imports historical rows or starts
   varda-native only.
3. Add more fixture tests for pure recommendation input calculations if needed.
4. Only after explicit approval, draft an actual Drizzle schema change in a
   separate commit.
