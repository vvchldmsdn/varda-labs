# Price Sync and Snapshot Pipeline Plan

Last updated: 2026-07-08

This document records the current manual market-data and daily snapshot pipeline
plus the remaining Cron plan. Vercel Cron is not enabled yet.

## Decision

The next migration step should be the market-data freshness pipeline, not another
dashboard panel. The read-only dashboard now has stronger calculations, but
`assets.current_price` and the latest `daily_position_snapshots` currently come
from the same imported state. In that state, today movement correctly renders as
zero because there is no newer live price layer.

## Base44 Reference

Read-only reference files:

- `base44/functions/syncAssetPrices/entry.ts`
- `base44/functions/backfillRecentCloses/entry.ts`
- `base44/functions/saveDailyHistorySnapshot/entry.ts`
- `base44/functions/dailyPortfolioSnapshot/entry.ts`
- `base44/functions/captureDailyPositionSnapshot/entry.ts`
- `base44/functions/syncFxRates/entry.ts`

Useful behavior to preserve, without copying Base44 code:

- `dailyPortfolioSnapshot` and `captureDailyPositionSnapshot` are compatibility
  wrappers. The canonical writer is `saveDailyHistorySnapshot`.
- `syncAssetPrices` has two modes:
  - live quote mode updates current asset prices quickly.
  - full/history mode also updates `AssetPriceSnapshot`, recent closes, and
    MA120 inputs.
- Close prices are written to `AssetPriceSnapshot` as ticker/date rows. Fallback
  quote-close rows may be replaced later by higher quality KIS/history rows.
- `saveDailyHistorySnapshot` runs after the US close cycle, around 22:00 UTC /
  07:00 KST, and only writes the current cycle date.
- Daily snapshot writes are guarded. If fresh close rows are missing, the writer
  aborts instead of storing a partial or live-price-based history snapshot.
- Complete existing daily snapshots are treated as immutable. Duplicate or
  unexpected rows block automatic overwrites.
- Settings once held KIS token fields in Base44, but varda-labs should not store
  KIS tokens or API keys in Postgres.

## Current varda-labs State

Already available:

- `assets.current_price`, `assets.ma_120`, `assets.days_above_ma`
- `assets.price_source`, `assets.price_fetched_at`, `assets.price_as_of`,
  `assets.price_quote_type`, `assets.price_status`, `assets.price_error`
- `fx_rates`
- `asset_price_snapshots`
- `market_data_sync_runs`
- `daily_position_snapshots`
- `daily_portfolio_snapshots`
- `event_ledger_entries`
- read-only dashboard calculation helper
- manual admin route handlers under `src/app/api/admin/...`

Remaining gaps before Cron:

- The KIS close sync path is manual and guarded by `limit <= 5`.
- Two production market cycles have been validated end to end, but Cron still
  requires an explicit design and enablement decision.
- Existing admin write routes are `POST`-only, while Vercel Cron invokes `GET`
  paths from `vercel.json`.
- Cron-safe batching, timeout, and cooldown behavior are not designed yet.
- No Vercel Cron config exists.

## Data Model Status

The first-pass market-data columns and run table exist. Keep the constraints
below in mind before broadening writes.

### `assets`

Nullable live quote metadata:

- `price_source varchar(100)`
- `price_fetched_at timestamp with time zone`
- `price_as_of timestamp with time zone` or `varchar(50)` if the provider gives
  non-ISO local market timestamps.
- `price_quote_type varchar(50)` such as `live`, `delayed`, `close`,
  `fallback_close`
- `price_status varchar(50)` such as `ok`, `stale`, `failed`
- `price_error text`

Keep secrets out of this table.

### `asset_price_snapshots`

Keep this as the canonical close-price cache.

Recommended operational constraint after duplicate audit:

- unique key on `(ticker, date)`

If existing imported data has duplicate ticker/date rows, audit and resolve them
first using source priority:

1. official KIS/history close
2. other reliable close history
3. `quote_close`
4. `latest_close_fallback`

### `market_data_sync_runs`

Small observability table:

- `id uuid`
- `job_type varchar(100)` such as `fx_sync`, `live_price_sync`,
  `close_price_sync`, `daily_snapshot`
- `status varchar(50)` such as `ok`, `partial`, `failed`, `blocked`
- `started_at`, `finished_at`
- `mode varchar(50)`
- `provider varchar(100)`
- `target_count int`, `success_count int`, `error_count int`
- `summary_json jsonb`
- `error_json jsonb`

This table is also used by the KIS close cooldown guard. Cooldown rejections do
not create run rows.

## Route/Job Surfaces

Use route handlers under `src/app/api/admin/...`. These should be server-only,
protected by `CRON_SECRET` or `ADMIN_JOB_SECRET`, and never callable from the
public dashboard without authorization.

### `POST /api/admin/market/fx/sync`

Detailed provider and row-policy planning lives in
`docs/fx-refresh-provider-plan.md`.

Writes:

- upsert `fx_rates` by `date`

Sources:

- primary: Frankfurter for historical daily USD/KRW where available
- fallback: exchangerate API or Yahoo chart for latest snapshot

Output:

- inserted/updated counts
- latest USD/KRW
- source and status

Status:

- Phase 1 admin-only dry-run route skeleton is implemented.
- Actual writes are not implemented.
- Actual write preparation helper exists, but it is not connected to route
  execution.
- Do not connect this route to the public dashboard, a user-facing sync button,
  or Cron before the admin-only contract below is implemented and smoke-tested.

Admin-only contract before implementation:

- Method: `POST`.
- Auth: `ADMIN_JOB_SECRET` or `CRON_SECRET` only. Browser sessions must not be
  enough to call it.
- Default mode: `dryRun=true`.
- Actual write is blocked in Phase 1. Future actual writes will require
  `dryRun=false&confirmWrite=true` after separate approval.
- Supported pair in v1: USD/KRW only. Do not add JPY/EUR/HKD without an approved
  multi-currency FX model.
- Row identity: one canonical `fx_rates` row per `date`.
- Dry-run response may show the candidate date, USD/KRW value, source, status,
  and planned insert/update counts.
- Dry-run does not write `fx_rates` or `market_data_sync_runs`.
- Actual write may upsert only `fx_rates` and optional sanitized
  `market_data_sync_runs` metadata. It must not touch `assets`,
  `asset_price_snapshots`, `daily_position_snapshots`, or
  `daily_portfolio_snapshots`.
- Metadata may store provider name, pair, rate date, status, counts, stale
  reason, and warning summaries.
- Metadata must not store provider credentials, request headers, authorization
  headers, raw response bodies, raw URLs with keys, environment variable names
  used as secret keys, KIS credentials, or app secrets.
- On provider failure or empty response, write nothing unless an explicit
  stale-status row policy is separately approved.
- Response copy must describe values as "stored FX" or "latest stored USD/KRW",
  not "real-time FX".

Implementation smoke before any dashboard button:

1. No-auth request returns `401` and writes nothing.
2. Authenticated dry-run returns candidate USD/KRW, source, date, planned
   writes, and `dryRun=true`.
3. Actual write with missing `confirmWrite=true` returns `400` or `409` before
   provider/DB mutation.
4. A tiny actual write/upsert is manually approved and run once.
5. Confirm `fx_rates` changed only for the intended date/pair.
6. Confirm `assets`, `asset_price_snapshots`, and daily snapshot tables did not
   change.
7. Run metadata secret audit or an equivalent scan covering
   `market_data_sync_runs`.
8. Run authenticated `/` smoke and confirm dashboard FX as-of text changed only
   according to the new stored row.

Current valuation scope:

- varda-labs currently supports KRW assets and USD assets for KRW valuation.
- USD positions use the latest stored USD/KRW row when calculating dashboard
  movement and daily snapshots.
- Other foreign currencies must not be treated as KRW by fallback. Until a
  multi-currency FX table is approved, unsupported currencies should surface as
  data-health/write blockers instead of silent valuation inputs.

Current FX freshness policy:

- `fx_rates` is a stored market-data source, not a real-time quote stream.
- Dashboard today movement may combine fresh KIS latest prices with the latest
  stored USD/KRW rate. Those two inputs can have different as-of times.
- If the latest USD/KRW row is the same row used by the baseline daily position
  snapshot, the displayed FX contribution can correctly be `0` even when live
  prices have moved.
- Dashboard copy must not call this "real-time FX" until an FX refresh route,
  provider, as-of policy, and stale-warning threshold are approved.
- The safe user-facing description is "latest stored USD/KRW", "stored FX",
  or "baseline FX versus stored FX", depending on the view.
- `daily_position_snapshots.fx_rate` is historical evidence for the snapshot
  write. Dashboard live FX impact is a derived display value comparing current
  stored FX with that baseline; it should not be treated as the same semantic
  field as stored `daily_position_snapshots.fx_change_krw`.
- Any FX refresh job must keep credentials and raw provider responses out of
  Postgres metadata and out of rendered HTML.

### `POST /api/admin/market/prices/sync`

Modes:

- `mode=live`
  - fetch current quotes for active investment assets
  - update `assets.current_price`
  - update `assets.price_*` metadata
  - do not write a daily history snapshot
- `mode=close`
  - fetch recent daily close rows
  - upsert `asset_price_snapshots`
  - update `assets.ma_120` and `assets.days_above_ma` when enough close history
    exists
  - may also update `assets.current_price` to the latest close if no live quote
    is available

Writes:

- `assets`
- `asset_price_snapshots`
- optionally `market_data_sync_runs`

Production preflight and observability:

- `mode=live` is admin-only in the current implementation. It is not connected
  to a user-facing sync button, Cron, or high-frequency automation.
- Start with `provider=kis&mode=close&dryRun=true` and narrow target filters
  such as `tickers=...`, `market=korea|us`, `account=brokerage|isa|irp`.
- Response should include provider, mode, dry-run state, target filter summary,
  target filter include/skip results, requested/success/failed/skipped counts,
  planned writes, write action/source/reason summaries, and warnings.
- `market_data_sync_runs.metadata_json` stores summaries only: target filter
  counts, target samples, write summaries, count summaries, and warnings.
- It must not store KIS credentials, access tokens, authorization headers,
  request headers, or raw KIS response bodies.
- Use `npm run audit:market-sync-metadata` to scan recent run metadata for
  secret-shaped keys or values.
- Immediate repeated KIS runs may return `429 kis_job_cooldown_active`; the
  response should include `Retry-After` plus retry timing fields.

Provider adapter shape:

```ts
type PriceProvider = {
  name: string;
  fetchLiveQuote(input: PriceRequest): Promise<LiveQuote>;
  fetchDailyCloses(input: HistoryRequest): Promise<DailyClose[]>;
};
```

Initial provider order:

- Korea-listed assets: KIS domestic quote/history first.
- US-listed assets: KIS overseas quote/history first.
- Optional later fallbacks: Yahoo/Finnhub/Naver, gated behind separate env vars.

### `POST /api/admin/snapshots/daily`

This is the varda-labs replacement for Base44 `saveDailyHistorySnapshot`.
Implemented v1 is manual/admin-only and does not configure Cron.

Writes:

- `daily_position_snapshots`
- `daily_portfolio_snapshots`

Inputs:

- `dryRun=true|false`; default is `true`.
- `dryRun=false` requires `confirmWrite=true`.
- optional `date=YYYY-MM-DD`; dry-run can inspect other dates, but actual writes
  are limited to the current resolved cycle date.
- optional `account=brokerage|isa|irp|all`; `all` writes the three account
  snapshots plus the aggregate portfolio snapshot.

Core rules:

- Resolve the cycle in KST. Before 07:00 KST, the snapshot date is yesterday.
  At or after 07:00 KST, the snapshot date is today.
- Before writing snapshots, require fresh close rows for every active investment
  asset with a ticker.
- `snapshotDate` is the portfolio cycle date. It is not assumed to be the same
  as valuation close date.
- For Korea-listed assets, `calendarReferenceDate` / `expectedCloseDate` is the
  previous KRX trading day before the snapshot date. The rule excludes weekends,
  KRX-specific Labor Day and year-end closure, fixed/substitute Korean holidays,
  and explicit lunar/election holiday overrides currently needed for the
  migration window.
- For US-listed or USD-denominated assets, `calendarReferenceDate` /
  `expectedCloseDate` is the previous US trading day before the snapshot date,
  including standard NYSE/Nasdaq holidays.
- The writer does not silently accept an older row when the expected market
  reference date has no close. It reports ticker-level `freshClose.coverage`
  with `calendarReferenceDate`, `expectedCloseDate`, `selectedCloseDate`, source,
  status, and reason.
- If required closes are missing, dry-run reports the missing ticker/date/reason;
  actual writes return `409` and do not write partial snapshots.
- Imported Base44 rows are immutable. Rows with non-null `legacy_base44_id` block
  writes for the same `snapshot_date/account`.
- varda-generated rows use `legacy_base44_id = null` and
  `source = 'varda_manual_daily_snapshot'`.
- imported Base44 rows use `source = 'base44_import'`.
- DB-level idempotency is enforced with:
  - `daily_portfolio_snapshots(snapshot_date, account, source)`
  - `daily_position_snapshots(snapshot_date, account, asset_id, source)` where
    `asset_id is not null`
- v1 still performs preflight duplicate/unmanaged-row checks before using Neon
  HTTP batch writes, because imported unmatched position rows can have nullable
  `asset_id`.

Valuation basis:

- `daily_position_snapshots.current_price` and `close_price`: close price used
  for the snapshot.
- `price_date` / `reference_date`: close date used.
- `price_source`: provider/source label.
- `price_basis`: `close`, `fallback_current`, or future explicit status.
- `fx_rate`, `fx_reference_date`: USD/KRW used.
- `previous_*`: latest prior valid position snapshot for the same account/asset.
- `market_value_change_*`, `price_change_krw`, `fx_change_krw`: derived from
  prior snapshot when available.
- For USD positions, `market_value_change_*` includes both local price movement
  and USD/KRW movement. `fx_change_krw` preserves the FX contribution as
  evidence.
- KRW/USD are the only supported valuation currencies in the current writer.
  Additional foreign currencies require an explicit FX model before snapshot
  writes are enabled for those assets.
- tickerless investment assets are allowed and use `assets.current_price` with
  `price_basis=manual_current`.
- Position-level `pnl_krw` remains open-position unrealized PnL against asset
  average cost/fractional average cost.
- Portfolio-level `total_pnl` / `total_return_pct` use the shared
  event-ledger realized-return helper also used by the read-only dashboard:
  - unrealized PnL from current open positions
  - realized PnL from sell events through `snapshotDate`
  - denominator as open position cost plus realized disposed-cost basis
- Realized PnL source priority is:
  1. explicit `trade_metrics` / `realized_metrics` in event JSON
  2. running buy/sell ledger disposed-cost estimate
  3. before-value average cost fallback
  4. memo `realized_pnl_krw=...` fallback
- Dry-run response includes `realizedReturn` with event counts, account totals,
  unmatched sell-event count, and missing-cost sell-event count.

## Vercel Cron Order

Start with manual admin triggers first. Add Vercel Cron after route handlers are
stable.

Detailed readiness design lives in `docs/cron-readiness-plan.md`. That document
and the Phase 1 route contract lives in
`docs/cron-preflight-route-contract.md`. These are the current gates before any
Cron route implementation or `vercel.json` enablement.

### Close Sync Coverage Gate

The production manual path is considered minimally verified once a KIS close
write and a guarded daily snapshot write have both succeeded without creating
duplicates. That does not make Cron ready by itself.

Before adding `vercel.json` or enabling Vercel Cron, define and verify the close
sync coverage policy. The daily snapshot writer requires full fresh-close
coverage for active ticker-backed investment assets. At the current migration
checkpoint that means 15 price targets:

- Korea / brokerage: 7
- Korea / ISA: 4
- Korea / IRP: 1
- US / brokerage: 3

Current route constraints:

- `provider=kis&mode=live` defaults to `dryRun=true`. Actual live writes require
  `dryRun=false&confirmWrite=true`, a reviewed target filter, and `limit <= 5`.
- KIS live writes update only `assets.current_price` and `assets.price_*`
  metadata. They must not insert or update `asset_price_snapshots`.
- `provider=kis&mode=close` may run as `dryRun=true` across the selected target
  set.
- KIS actual close writes require `dryRun=false&confirmWrite=true`.
- KIS actual close writes currently require `limit` and cap it at `limit <= 5`
  for manual safety.
- The daily snapshot route must remain blocked when close coverage is missing
  or stale; partial snapshot writes are not allowed.

Coverage policy to settle before Cron:

- Derive the required ticker list from the daily snapshot dry-run
  `freshClose.coverage`, grouped by market and expected close date.
- The daily snapshot response includes `closeSyncPlan` as the dry-run coverage
  planner. It is derived from the same `freshClose.coverage` used by the writer.
- Treat rows with `status=satisfied` and `selectedCloseDate=expectedCloseDate`
  as already covered.
- Write only missing or stale ticker/date rows when possible.
- Keep manual KIS actual writes at `limit <= 5`.
- `closeSyncPlan` may provide a `dryRunQuery` and non-executable
  `suggestedWriteParams`, but it must not provide a ready-to-run
  `dryRun=false&confirmWrite=true` URL.
- Actual writes must be constructed deliberately by the operator after
  reviewing the dry-run result and manually adding `dryRun=false` and
  `confirmWrite=true`.
- If an internal or Cron-only batch path is introduced later, give it a separate
  max target limit and guard it behind the same admin/Cron secret contract.
- If any required ticker fails, let the daily snapshot actual write return 409
  and keep the stored snapshot unchanged.
- Do not update `assets.current_price` from this close-sync path.

Manual runbook until Cron is implemented:

1. Run KIS close dry-run for the intended target set.
2. Inspect `targetFilterSummary`, `targetFilterResults`, `plannedWrites`, and
   `writeSummary`.
3. Build KIS actual close write requests manually from the reviewed
   `suggestedWriteParams`. The planner must not provide a ready-to-run
   `confirmWrite=true` URL.
4. Run actual close writes only for missing or stale targets, in batches that
   respect the manual `limit <= 5` cap and cooldown.
5. Run `npm run audit:asset-price-duplicates`.
6. Run `npm run audit:market-sync-metadata -- --limit 50`.
7. Run production daily snapshot dry-run and confirm `writeReady=true`,
   `freshClose.missingCount=0`, `closeSyncPlan.canProceedToSnapshotWrite=true`,
   no suggested KIS batches, and update-only `plannedWrites` when rerunning an
   existing varda snapshot.
8. Run guarded daily snapshot actual write only for the current resolved cycle:
   `dryRun=false&confirmWrite=true`.
9. Re-run daily snapshot dry-run to confirm the path remains update-only.

Observed manual market-cycle validation:

- Validation date: 2026-07-07 KST cycle.
- Initial production daily snapshot dry-run resolved `snapshotDate=2026-07-07`
  with close coverage `6/15`, stale `9`, and `writeReady=false`.
- `closeSyncPlan.suggestedKisBatches` produced three manual KIS batches:
  - Korea, `2026-07-06`, 5 tickers:
    `101280`, `133690`, `315960`, `360200`, `395160`.
  - Korea, `2026-07-06`, 3 tickers:
    `455850`, `475350`, `489250`.
  - US, `2026-07-06`, 1 ticker: `SCHD`.
- Guarded KIS actual close writes inserted 9 total rows into
  `asset_price_snapshots`.
- The route-level 90 second KIS cooldown blocked immediate retries as expected;
  the operator waited between dry-run and actual write calls.
- The close sync path did not update `assets.current_price`, which is the
  intended current policy.
- `npm run audit:asset-price-duplicates` reported duplicate groups `0`.
- `npm run audit:market-sync-metadata -- --limit 50` reported match count `0`.
- The final daily snapshot dry-run reported close coverage `15/15`, missing
  `0`, stale `0`, suggested KIS batches `0`, and `writeReady=true`.
- Guarded daily snapshot actual write succeeded for the current cycle:
  - `daily_portfolio_snapshots`: 4 rows for `2026-07-07` with
    `source='varda_manual_daily_snapshot'`.
  - `daily_position_snapshots`: 17 rows for `2026-07-07` with
    `source='varda_manual_daily_snapshot'`.
  - Position rows with nullable `asset_id`: 0.
- Post-write daily snapshot dry-run was update-only: portfolio update `4`,
  position update `17`, insert `0`.
- Follow-up validation date: 2026-07-08 KST cycle.
- Initial production daily snapshot dry-run resolved `snapshotDate=2026-07-08`
  with required close rows missing/stale for 15 assets and `writeReady=false`.
- `closeSyncPlan.suggestedKisBatches` produced four manual KIS batches:
  - Korea, `2026-07-07`, 5 tickers:
    `0092B0`, `0101N0`, `0139P0`, `069500`, `101280`.
  - Korea, `2026-07-07`, 5 tickers:
    `133690`, `315960`, `360200`, `395160`, `455850`.
  - Korea, `2026-07-07`, 2 tickers: `475350`, `489250`.
  - US, `2026-07-07`, 3 tickers: `QQQ`, `SCHD`, `VOO`.
- All four KIS close dry-runs succeeded: 15 total planned inserts, failed `0`.
- Guarded KIS actual close writes inserted 15 total rows into
  `asset_price_snapshots`.
- The route-level 90 second KIS cooldown also applied to KIS dry-runs; the
  operator waited between KIS calls.
- The post-close daily snapshot dry-run reported close coverage `15/15`,
  missing `0`, suggested KIS batches `0`, and `writeReady=true`.
- Guarded daily snapshot actual write succeeded for the current cycle:
  - `daily_portfolio_snapshots`: 4 rows for `2026-07-08` with
    `source='varda_manual_daily_snapshot'`.
  - `daily_position_snapshots`: 17 rows for `2026-07-08` with
    `source='varda_manual_daily_snapshot'`.
- Post-write daily snapshot dry-run was update-only: portfolio update `4`,
  position update `17`, insert `0`.
- `npm run audit:asset-price-duplicates` reported duplicate groups `0`.
- `npm run audit:data-integrity` reported `ok=true` and failed error checks `0`.
- `npm run audit:market-sync-metadata` reported match count `0`.
- Authenticated production dashboard HTML included the latest snapshot date and
  no high-risk secret patterns.
- This validates the manual path across two consecutive production cycles. It
  still does not make Cron ready without an explicit Cron design and enablement
  decision.

Pre-Cron verification checklist:

1. Dashboard display
   - The read-only dashboard headline is calculated from current `assets` plus
     the shared event-ledger realized-return helper.
   - The trend chart reads `daily_portfolio_snapshots`.
   - Dashboard data health exposes the latest portfolio snapshot delta so the
     current headline calculation can be compared against the latest stored
     snapshot row before Cron is enabled.
   - The top total PnL label should remain clear that realized PnL is included.

2. Production daily snapshot dry-run
   - Use `POST /api/admin/snapshots/daily?dryRun=true` on production only with
     admin-job auth.
   - Do not pass `confirmWrite=true` for this verification.
   - Verify HTTP 200, `writeReady`, `snapshotDate`, `closeReferences`,
     `freshClose.coverage`, `closeSyncPlan`, `realizedReturn`, and
     `plannedWrites`.
   - Confirm route output and logs do not include raw secrets, tokens, request
     headers, or environment variable values.

3. Cron design before enablement
   - Keep Vercel Cron disabled until manual production dry-run is clean.
   - Keep Cron disabled until the close sync coverage gate above is settled.
   - Two successful real market cycles through the manual runbook have been
     observed, but this is a prerequisite rather than approval to enable Cron.
   - Resolve the current route mismatch first: existing admin write routes are
     `POST` routes, while Vercel Cron invokes `GET` paths from `vercel.json`.
   - Confirm each successful cycle has duplicate audit `0`, metadata secret
     audit `0`, final `writeReady=true`, and post-write update-only dry-run.
   - Run close-price sync before the daily snapshot writer.
   - If close sync is blocked or partial, the snapshot writer should stay
     blocked with `409` on actual writes and show detailed coverage in dry-run.
   - Use `ADMIN_JOB_SECRET` or `CRON_SECRET`; never store KIS tokens or provider
     credentials in Postgres.
   - Do not implement a Cron flow that waits through repeated 90 second cooldown
     sleeps inside one serverless invocation until Vercel timeout behavior and a
     separate Cron-safe cooldown policy are explicitly designed.

Candidate cron schedule after the coverage gate is implemented:

- `07:10 UTC` / `16:10 KST`: `prices/sync?mode=close` for Korea close rows.
- `22:05 UTC` / `07:05 KST`: `fx/sync`.
- `22:10 UTC` / `07:10 KST`: `prices/sync?mode=close` for US close rows and
  recent close repair.
- `22:20 UTC` / `07:20 KST`: `snapshots/daily`.

Do not start with high-frequency live quote cron. Use manual admin live sync
first, then decide whether the dashboard needs scheduled intraday updates after
KIS rate limits are known.

## Secrets and Token Policy

Use Vercel environment variables only:

- `KIS_APP_KEY`
- `KIS_APP_SECRET`
- `CRON_SECRET` or `ADMIN_JOB_SECRET`
- optional fallback provider keys later

Do not store KIS access tokens, app keys, or secrets in `settings` or any other
Postgres table. For the first implementation, fetching a KIS token per job is
acceptable. If token reuse becomes necessary, add an encrypted/ephemeral cache
outside user-facing data, not a Settings row.

## Dashboard Data Health

Extend dashboard health once jobs exist:

- latest live price sync time
- latest close sync time
- latest daily snapshot date
- stale asset count
- missing close count
- provider error count
- movement source: `daily_position_snapshot`, `asset_price_snapshot`,
  `live_vs_close`, or `hidden`

Dashboard rules:

- If live asset prices are fresher than the latest daily snapshot, today movement
  compares live `assets.current_price` against the latest snapshot/close
  baseline.
- For USD positions, today movement uses live/latest local price multiplied by
  the latest stored USD/KRW rate, then compares that KRW value with the baseline
  snapshot KRW value. This means FX movement is included in the displayed KRW
  change.
- If live prices are stale, prefer `asset_price_snapshots` previous-close
  fallback only when coverage passes threshold.
- If coverage is low, hide aggregate today movement and show a data health badge
  instead of showing partial movement as a portfolio-level number.
- User-facing copy should describe this as fresh KIS latest quote plus latest
  stored FX. Do not imply real-time FX until an FX refresh/as-of policy exists.
- Dashboard health should eventually expose the latest USD/KRW `rate_date`,
  source, and freshness state separately from price freshness. A fresh price
  with stale FX is a valid partial freshness state and should be visible to the
  operator before a public sync button is introduced.

## User-Facing Sync Button Boundary

Do not implement a public or dashboard-facing sync button until the admin-only
price and FX paths have separate, verified contracts.

Terms to keep separate:

- Price refresh: KIS live quote fetch that updates `assets.current_price` and
  `assets.price_*` only.
- Close refresh: KIS close/history fetch that upserts `asset_price_snapshots`.
- FX refresh: USD/KRW provider fetch that upserts `fx_rates`.
- Snapshot write: guarded daily evidence write into `daily_*_snapshots`.

Button naming:

- If a future button only runs KIS live quotes, call it "price refresh" or a
  similarly narrow label. Do not call it "today movement refresh".
- A "today movement refresh" label is only correct after both price freshness
  and FX freshness are handled, or after the UI clearly states that FX comes
  from the latest stored rate.
- Do not expose `ADMIN_JOB_SECRET`, KIS credentials, provider headers, raw
  responses, run ids, or executable write URLs in the browser.

Implementation gate:

1. Verify admin-only KIS live actual write on a tiny target set.
2. Verify admin-only FX dry-run/write policy separately.
3. Add data-health copy for price freshness and FX freshness as separate
   states.
4. Only then design a server-only dashboard action/route with rate limits,
   cooldown display, loading/error states, and explicit partial-success copy.

## Implementation Phases

1. Schema and constraints
   - `assets.price_*` metadata is present.
   - `market_data_sync_runs` is present and used for KIS cooldown.
   - audit duplicates before adding operational unique constraints

2. Provider layer
   - implement KIS token helper using env vars only
   - implement provider adapters for KR/US live quote and daily close history
   - add rate-limit friendly batching

3. Manual admin routes
   - `fx/sync`
   - `prices/sync` with `live` and `close` modes
   - dry-run option for route responses where practical

4. Daily snapshot writer
   - implement cycle resolver
   - implement fresh close guard
   - upsert positions and portfolio snapshots
   - preserve `legacy_asset_id`, `ticker`, `asset_name`, nullable `asset_id`

5. Cron wiring
   - add `vercel.json`
   - use `CRON_SECRET`
   - keep schedules conservative until provider limits are known

6. Dashboard health
   - surface stale/missing data states
   - keep investment holdings separate from non-investment/cash-like assets

## Non-goals For The First Implementation

- No public UI buttons for price sync.
- No Base44 function calls.
- No token storage in Settings/Postgres.
- No high-frequency live quote polling until rate limits are measured.
- No ETF lookthrough or new history chart work in this step.
