# Recommendation Implementation Plan

Last updated: 2026-07-08

Status: docs-only implementation plan. This document does not create Drizzle
schema, SQL migrations, import scripts, routes, UI, recommendation execution,
provider calls, LLM calls, or EventLedger writes.

## Purpose

This plan is the approval gate between the logical proposal in
`docs/recommendation-schema-proposal.md` and any future schema work. It fixes
the first implementation boundary so varda-labs does not accidentally port the
Base44 recommendation stack wholesale.

The first implementation lane is persistence planning for future varda-native
recommendation runs. It is not a historical import lane and not an engine lane.

## First Lane Table List

First lane tables:

- `recommendation_runs`
- `recommendation_items`

Deferred tables:

| Deferred table | Decision |
| --- | --- |
| `recommendation_explanations` | Defer until generated briefing/content is a product surface. |
| `recommendation_signals` | Defer. Do not create a table just for two legacy `MarketSignal` rows. |
| `recommendation_reviews` | Defer until review/execution comparison is a product workflow. |
| `asset_factor_profiles` | Defer until factor ownership, source priority, ETF lookthrough dependency, and refresh semantics are decided. |

Do not add compatibility tables for Base44 `RebalanceRecommendation`,
`RecommendationRun`, or `RecommendationCandidate`. Preserve legacy identifiers
on the varda-labs tables only if an import phase is approved later.

## First Implementation Stance

Default stance: start varda-native only.

Meaning:

- do not import Base44 recommendation rows in the first implementation;
- do not parse `RebalanceRecommendation.items_json` into first query paths;
- do not create a raw legacy recommendation table;
- keep `legacy_base44_id` and raw legacy evidence fields in the plan so a later
  import phase can be idempotent;
- require a separate approval before any historical recommendation import.

Reason:

- imported recommendation rows are old engine output, not current source of
  truth;
- Base44 has two recommendation shapes, and importing both before UI/engine
  needs are known would recreate legacy complexity;
- varda-labs should first define the run/items contract it wants to generate.

## Column Set Candidate

This is the first-lane candidate column set for a later schema plan. It is not
a Drizzle schema and does not authorize a migration.

### `recommendation_runs`

| Group | Candidate columns | Nullability rule |
| --- | --- | --- |
| Identity | `id`, `legacy_base44_id` | `legacy_base44_id` nullable; used only for approved legacy import. |
| Run key | `run_date`, `account`, `account_id` | `account` preserved as raw text. `account_id` nullable for `all` runs or legacy mismatch. |
| Source/status | `source`, `engine_version`, `status` | Required for varda-native rows. |
| Context | `regime_label`, `regime_score`, `fx_buy_multiplier` | Nullable; only scalar fields needed for display/filtering. |
| Counts | `include_count`, `replace_count`, `trim_count`, `watch_count`, `execution_count` | Nullable or default zero; can be recomputed from items. |
| Evidence | `portfolio_profile_json`, `signals_used_json`, `config_json`, `warnings_json` | JSONB evidence, not canonical source data. |
| Legacy evidence | `legacy_source_type`, `legacy_items_json`, `legacy_raw_json` | Nullable; not used in first varda-native write path. |
| Timestamps | `base44_created_at`, `base44_updated_at`, `created_at`, `updated_at` | Base44 timestamps nullable; varda timestamps required. |

### `recommendation_items`

| Group | Candidate columns | Nullability rule |
| --- | --- | --- |
| Identity | `id`, `legacy_base44_id`, `legacy_item_key` | Legacy fields nullable; only for approved import. |
| Parent | `recommendation_run_id`, `legacy_run_id` | `recommendation_run_id` required for varda-native rows. |
| Run key copy | `run_date`, `account`, `account_id` | Duplicated for read efficiency; run remains source of truth. |
| Action | `candidate_type`, `status`, `suggested_amount_krw` | Type/status required for varda-native rows. Amount nullable for observation rows. |
| Target asset | `asset_id`, `legacy_asset_id`, `ticker`, `name`, `market` | `asset_id` nullable; keep ticker/name/market for unmapped or observed assets. |
| Replacement source | `from_asset_id`, `legacy_from_asset_id`, `from_ticker`, `from_name` | Nullable; used only for replace/trim style rows. |
| Allocation | `current_weight_pct`, `target_weight_pct` | Nullable; point-in-time recommendation evidence. |
| Score | `score`, `confidence_pct` | Nullable until scoring contract is stable. |
| Evidence | `score_breakdown_json`, `reasons_json`, `counter_reasons_json`, `cancel_conditions_json`, `signals_json`, `guardrails_passed_json`, `expected_impact_json` | JSONB for debug and detail expansion. |
| Legacy raw | `legacy_raw_json` | Nullable; not used by first varda-native write path. |
| Timestamps | `base44_created_at`, `base44_updated_at`, `created_at`, `updated_at` | Base44 timestamps nullable; varda timestamps required. |

## Status And Validation

Do not create DB enums in the first schema plan unless implementation evidence
shows the status sets are stable. Prefer varchar fields plus validation in the
server command layer for the first pass.

Run status candidates:

- `draft`
- `ready`
- `partial`
- `failed`
- `archived`

Import-only run status, if historical import is approved later:

- `imported`

Item status candidates:

- `executable`
- `observation`
- `blocked`
- `superseded`

Import-only item status, if historical import is approved later:

- `imported`

Validation rules:

- `source` must identify the engine or import source.
- `candidate_type` must be one of `include`, `replace`, `trim`, or `watch`.
- `executable` does not mean trade permission; it means the recommendation
  guardrails passed at run time.
- recommendation rows must not append or mutate portfolio events.

## Relationship Rules

| Relationship | First-lane rule |
| --- | --- |
| Run to items | One run has many items. varda-native items require a parent run. |
| Run to account | Preserve raw `account`. `account_id` can be nullable for `all` or legacy mismatch. |
| Item to asset | `asset_id` can be nullable. Preserve `ticker`, `name`, `market`, and legacy asset id where available. |
| Item to replacement source | Optional. Preserve raw source ticker/name even when no current asset maps. |
| Run to explanation | No first-lane table. Generated content is a later table or service. |
| Run to signals | Store signal references in run/item JSONB first. Normalize later only if signals become reusable product data. |
| Recommendation to execution | No direct execution write. Event changes belong to separate commands and `event_ledger_entries`. |

## Import Policy For First Lane

No import in the first implementation.

If an import phase is approved later:

1. Add schema/migration in its own approved step.
2. Add an import script with dry-run default.
3. Write only with `--write`.
4. Preserve `legacy_base44_id`.
5. Exclude owner/user ids until tenant modeling exists.
6. Exclude provider credentials, raw auth headers, tokens, and secrets.
7. Use nullable refs for historical account/asset mismatches.
8. Preserve raw legacy JSON as evidence.
9. Keep `RebalanceRecommendation.items_json` out of primary query paths unless
   historical UI explicitly requires normalized old item rows.

## Test Gate Before Schema Work

Current calculation fixture gap guidance lives in
`docs/calculation-fixture-gap-audit.md`.

Before any recommendation schema migration, add or confirm fixture coverage for:

- event-ledger cost basis and realized return inputs;
- account filter behavior for all/brokerage/isa/irp;
- USD to KRW conversion evidence used by recommendation inputs;
- MA/trend evidence selection from price snapshots or latest caches;
- cash allocation and contribution sizing rules;
- guardrails: minimum execution size, churn window, taxable account penalty,
  minimum holding days, and blocked symbols;
- ETF substitute/candidate scoring only after the ETF/factor model is chosen;
- legacy import parsing only if historical rows are included.

Tests should use deterministic fixtures and should not call production DB,
providers, KIS, LLMs, admin routes, or Cron paths.

### Not Yet Testable Without Helper Extraction

These recommendation input areas should remain gaps until pure helper
boundaries exist. Do not implement new recommendation logic just to satisfy
tests:

- MA/trend evidence selection from asset prices, snapshots, or latest caches;
- cash allocation and contribution sizing;
- guardrails such as minimum execution size, churn window, taxable account
  penalty, minimum holding days, and blocked symbols;
- ETF substitute/candidate scoring.

The next step for these areas is a helper extraction plan with fixture inputs
and expected outputs, not a direct port of Base44 recommendation functions.

## Explicit Non-Goals

- no Drizzle schema or SQL migration
- no import script
- no recommendation route or server action
- no recommendation UI
- no recommendation engine implementation
- no LLM or provider call
- no KIS call
- no EventLedger write
- no trade execution
- no market signal table for two legacy rows
- no AssetFactorProfile coupling in the first recommendation schema
- no Cron/KIS/snapshot pipeline change

## Next Approval Gate

After this plan is reviewed, choose one of these narrow lanes:

1. Add fixture tests for recommendation input calculations.
2. Draft a schema implementation plan that converts this document into exact
   Drizzle table definitions, still without migration.
3. Return to read-only product screens that use already imported data.

Do not create a migration until the selected lane is explicitly approved.
