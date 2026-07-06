# Price Sync and Snapshot Pipeline Plan

Last updated: 2026-07-06

This is a design plan only. It does not implement cron jobs or provider calls yet.

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
- `fx_rates`
- `asset_price_snapshots`
- `daily_position_snapshots`
- `daily_portfolio_snapshots`
- `event_ledger_entries`
- read-only dashboard calculation helper

Gaps before operational sync:

- `assets` lacks live price lineage columns such as `price_source`,
  `price_fetched_at`, `price_as_of`, and `price_quote_type`.
- `asset_price_snapshots` has indexes but no operational unique key for
  idempotent ticker/date upsert.
- No route handlers exist for admin/cron market jobs.
- No job run table exists for provider errors, stale close reasons, or run
  duration.
- No Vercel Cron config exists.

## Proposed Data Model Changes

Add these before implementing jobs.

### `assets`

Add nullable live quote metadata:

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

### Optional `market_data_sync_runs`

Add a small observability table:

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

This is more useful than only console logs once jobs run on Vercel Cron.

## Route/Job Surfaces

Use route handlers under `src/app/api/admin/...`. These should be server-only,
protected by `CRON_SECRET` or `ADMIN_JOB_SECRET`, and never callable from the
public dashboard without authorization.

### `POST /api/admin/market/fx/sync`

Writes:

- upsert `fx_rates` by `date`

Sources:

- primary: Frankfurter for historical daily USD/KRW where available
- fallback: exchangerate API or Yahoo chart for latest snapshot

Output:

- inserted/updated counts
- latest USD/KRW
- source and status

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
     `freshClose.coverage`, `realizedReturn`, and `plannedWrites`.
   - Confirm route output and logs do not include raw secrets, tokens, request
     headers, or environment variable values.

3. Cron design before enablement
   - Keep Vercel Cron disabled until manual production dry-run is clean.
   - Run close-price sync before the daily snapshot writer.
   - If close sync is blocked or partial, the snapshot writer should stay
     blocked with `409` on actual writes and show detailed coverage in dry-run.
   - Use `ADMIN_JOB_SECRET` or `CRON_SECRET`; never store KIS tokens or provider
     credentials in Postgres.

Suggested initial cron schedule:

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
- If live prices are stale, prefer `asset_price_snapshots` previous-close
  fallback only when coverage passes threshold.
- If coverage is low, hide aggregate today movement and show a data health badge
  instead of showing partial movement as a portfolio-level number.

## Implementation Phases

1. Schema and constraints
   - add `assets.price_*` metadata
   - add optional `market_data_sync_runs`
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
