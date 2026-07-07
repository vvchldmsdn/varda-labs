# Base44 Structure Audit

This note records the read-only structural audit of `gyeol-fin` before more
varda-labs product work. It is intentionally docs-only and must not change the
KIS, Cron, daily snapshot, or database write paths.

## Executive Decision

Do not treat the Base44 entity files or functions as the target varda-labs data
model. The Base44 app mixes current product screens, legacy screens,
experiments, diagnostics, repair scripts, backfills, and mutable cache fields in
one project.

The migration rule is:

- Import source data that has audit value.
- Preserve Base44 ids as legacy identifiers.
- Re-model source-of-truth tables for varda-labs.
- Keep derived, cached, and UI-only values out of canonical master tables unless
  there is an explicit compatibility reason.

## Current High-Risk Patterns

### Overloaded `Asset`

Base44 `Asset` is used for several different responsibilities:

- security and holding identity
- current holding state
- target allocation and contribution rules
- current quote cache
- MA120 and trend cache
- memo, review, and user-facing thesis fields

In varda-labs, `assets` can continue to hold compatibility columns while the
migration is incomplete, but those columns must be classified. `assets` should
not become the permanent source of truth for time-series or derived indicators.

### MA120 and trend state

Base44 calculates or stores MA120 in multiple places:

- `syncAssetPrices` computes MA120 from price history and updates `Asset.ma_120`
  and `days_above_ma`.
- `saveDailyHistorySnapshot` copies the current MA120 state into
  `DailyPositionSnapshot`.
- recommendation and contribution screens read MA120 and `ma120_status` from
  asset rows, snapshot rows, or recommendation debug output.

varda-labs should treat this as three separate concepts:

| Concept | Target role |
| --- | --- |
| price history | canonical source in `asset_price_snapshots` |
| latest MA/trend indicator | derived cache, not an asset master property |
| MA/trend used in a past decision | snapshot or recommendation-run evidence |

`assets.ma_120` and `assets.days_above_ma` are therefore compatibility/cache
fields. They are not the canonical source for MA120.

### Settings and secrets

Base44 `Settings` mixes portfolio policy, user preference, provider state, and
KIS token cache fields. varda-labs must keep the existing split:

- portfolio and display policy may live in `settings`
- KIS app keys, app secrets, account numbers, access tokens, authorization
  headers, and raw provider responses must not live in Postgres settings
- provider credentials belong in environment variables or a future secret store

### Snapshot model overlap

The canonical Base44 history writer is `saveDailyHistorySnapshot`. Compatibility
wrappers such as `dailyPortfolioSnapshot` and `captureDailyPositionSnapshot`
delegate to that writer.

varda-labs should keep a single canonical daily snapshot write path. Imported
Base44 history rows remain immutable evidence, and varda-generated rows stay
separate through source markers.

### Recommendation model overlap

Base44 has at least two recommendation shapes:

- `RebalanceRecommendation`: older single-row output with item JSON
- `RecommendationRun` and `RecommendationCandidate`: run/items shape

varda-labs should not copy both as independent product models. A future
recommendation engine should use a run plus candidate/item model. Legacy
recommendation rows can be imported only if historical explainability is needed.

### Simulation and optimization artifacts

Simulation entities behave more like job records, chunks, shards, or artifact
storage than normalized finance tables. Do not migrate them into the core
finance schema by default. Rebuild them later as a job/artifact subsystem with a
small read model for UI summaries.

### Ownership fields

Base44 ownership fields appear under mixed names such as `created_by_id`,
`created_by`, `owner_id`, and `user_id`. varda-labs should not copy that shape.
Use one future tenant/user key, and treat legacy ownership fields as sensitive
data unless explicitly reviewed.

### Client-side mutation flow

Base44 UI components often perform multi-step mutations from the browser and
manually compensate on failure. varda-labs should move those flows into route
handlers or server actions with database transactions before enabling write UI.

## Field Classification Rules

Use these categories before adding or expanding tables:

| Category | Meaning | Examples |
| --- | --- | --- |
| source_of_truth | canonical current business fact | account id, ticker, target allocation rule |
| event | append-only change record | buy, sell, deposit, withdrawal, target change |
| time_series_source | observed or imported series | close price, FX rate, benchmark value |
| snapshot_fact | point-in-time portfolio evidence | daily position value, weight, MA status used that day |
| derived_cache | recomputable value stored for speed or compatibility | latest MA120, trend state, days above MA |
| run_artifact | output of one calculation run | score breakdown, recommendation reasons, debug steps |
| ui_state | presentation preference or transient browser state | selected tab, expanded section |
| legacy_evidence | preserved Base44 raw evidence | legacy ids, raw before/after JSON, raw account string |
| obsolete | no row data or superseded by another model | empty legacy snapshots, one-off repair outputs |

## Asset Field Direction

| Field type | Current compatibility | Long-term direction |
| --- | --- | --- |
| identity and mapping | keep in `assets` | canonical |
| ticker, market, currency | keep in `assets` | canonical for current holding/security mapping |
| quantity, average cost | keep during migration | may move to holding state/event projection later |
| target weight/rule config | keep where used | split allocation policy when recommendation work starts |
| current price and price metadata | cache only | latest quote cache; not history |
| MA120 and days above MA | cache only | derive from `asset_price_snapshots`; copy to snapshots/runs as evidence |
| contribution amount/day | compatibility | future cashflow/schedule model candidate |
| memo/thesis/review | compatibility | future note/review model candidate |

## Function Migration Triage

Classify Base44 functions before porting:

Detailed function-by-function classification lives in
`docs/function-migration-audit.md`. Use that document as the routing layer
before deciding whether a Base44 function should be rewritten, skipped, or kept
as reference-only.

| Function type | Migration treatment |
| --- | --- |
| product read helper | rewrite as server-only query/helper |
| product write command | rewrite as route handler/server action with transactions |
| admin operation | dry-run first, `confirmWrite` for mutation, audit output |
| backfill or repair | do not port wholesale; design a one-off script only when needed |
| diagnostic | prefer read-only audit script |
| AI or recommendation function | wait for model decision and test fixtures |
| simulation job | defer to job/artifact subsystem design |

## Frontend Migration Priority

The current main product surface is the portfolio dashboard path. Legacy or
secondary pages should not be treated as equal-priority migration targets.

Recommended order:

1. Read-only data connection screens from imported tables.
2. Small server-side query helpers with deterministic selection rules.
3. Pure calculation helpers with fixture tests.
4. Write flows only after route/server-action transaction design.
5. Recommendation, investment lab, and simulation only after model decisions.

## Non-Goals Before the 2026-07-08 07:00 KST Automation Check

- no Cron enablement
- no `vercel.json` Cron config
- no KIS write limit expansion
- no daily snapshot writer semantic change
- no snapshot schema or unique/FK migration
- no provider credential or token storage change
- no cleanup/delete/backfill
- no recommendation engine implementation
- no simulation migration
