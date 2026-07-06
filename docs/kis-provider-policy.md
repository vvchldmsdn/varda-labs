# KIS Provider Policy

Last updated: 2026-07-06

This document fixes the provider and token policy before any KIS HTTP calls are
implemented. It is intentionally narrower than the full market-data pipeline.

## Decision

Use KIS as the primary official provider for close and live prices. Do not make
Naver or Yahoo the primary provider. They can be evaluated later as fallback or
read-only comparison sources, but their response stability and blocking risk are
not acceptable as the first operational path.

## Environment Variables

Required:

- `KIS_APP_KEY`
- `KIS_APP_SECRET`

Optional:

- `KIS_ACCOUNT_NO`
- `KIS_BASE_URL`
- `KIS_IS_MOCK`
- `KIS_TOKEN_POLICY`
- `KIS_JOB_COOLDOWN_SECONDS`
- `KIS_VALUE_CONFLICT_THRESHOLD_PCT`

Admin route secrets remain separate:

- `ADMIN_JOB_SECRET`
- `CRON_SECRET`

## Storage Rules

- Do not store KIS app key, app secret, account number, or access token in
  `settings`, Postgres, import files, route responses, or
  `market_data_sync_runs.metadata_json`.
- Store only provider labels, counts, status codes, sanitized error categories,
  and non-secret timing metadata.
- Any raw provider error must be sanitized before it reaches logs, responses, or
  database metadata.

## Token Policy

Supported first-pass policies:

- `per_request`: request a token for each job execution and persist nothing.
- `memory_cache`: keep a token only in server memory for a warm instance.

Default:

- `per_request`

Reasoning:

- `per_request` is simplest and keeps the no-DB-token-storage rule strict.
- `memory_cache` can reduce token calls later, but serverless cold starts must
  still tolerate token refetches.
- Vercel serverless memory is not a global cache. Consecutive admin requests can
  land on different instances and still trigger multiple token requests.
- Vercel KV or a dedicated secret store can be considered later.
- Postgres encrypted token cache is intentionally not part of the first
  implementation because it conflicts with the current migration rule.

## KIS Job Cooldown

Production dry-run testing showed that repeated KIS admin calls can trigger KIS
token request failures even with `KIS_TOKEN_POLICY=memory_cache`. To avoid
hammering the token endpoint, `provider=kis&mode=close` requests are guarded by a
route-level cooldown.

- Env: `KIS_JOB_COOLDOWN_SECONDS`
- Default: `90`
- Applies to dry-run requests too.
- Uses `market_data_sync_runs` to find the latest KIS close run.
- If the latest run is inside the cooldown window, the route returns HTTP `429`
  with:
  - `error: "kis_job_cooldown_active"`
  - `retryAfterSeconds`
  - `lastRunId`
  - `lastRunStartedAt`
  - `lastRunFinishedAt`
- Cooldown rejections do not create `market_data_sync_runs` rows. This keeps
  repeated manual retries from polluting the sync audit log.
- The response must not include KIS app keys, app secrets, access tokens, or raw
  KIS responses.

Manual admin calls and future Cron jobs must respect this cooldown. A durable
external token cache, such as Vercel KV, can be evaluated later if higher
frequency KIS calls become necessary.

## Guarded KIS Close Writes

KIS close writes are intentionally manual and narrow until the full daily
pipeline exists.

Required route conditions:

- `provider=kis`
- `mode=close`
- `dryRun=false`
- `confirmWrite=true`
- `fixture=false`
- `limit` must be present and at most `5`
- the KIS cooldown guard must pass

Allowed KIS write sources:

- `kis_domestic_itemchartprice`
- `kis_overseas_dailyprice:<exchange>`

Existing row policy for `asset_price_snapshots(ticker,date)`:

- Existing KIS rows can be updated by KIS rows.
- Existing non-KIS rows can be replaced by KIS only when the close price
  relative difference is within the value conflict threshold.
- Default threshold: `3%`
- Env override: `KIS_VALUE_CONFLICT_THRESHOLD_PCT`
- Rows above the threshold are skipped as `value_conflict`; they are not
  overwritten.

KIS write metadata may include count summaries, write action summaries, conflict
counts, target summaries, and warnings. It must not include app keys, app
secrets, tokens, or raw KIS responses.

### Manual Target Control

KIS manual close runs support query-only target filters. Request bodies are not
used for target selection yet, which keeps manual calls reproducible from the
URL alone.

Supported filters:

- `tickers=VOO,SCHD,069500`
- `market=korea|us`
- `account=brokerage|isa|irp|all`

Filter policy:

- `tickers` is comma-separated, trimmed, uppercased, de-duplicated, and matched
  exactly against normalized asset tickers.
- Fuzzy ticker matching is not allowed.
- `account=all` is the same as no account filter.
- `tickers`, `market`, and `account` compose with `AND` semantics.
- Tickers outside the current syncable asset universe are not written.
- `dryRun=false` KIS writes still require `confirmWrite=true`, cooldown pass,
  and an explicit `limit` of at most `5`.
- `dryRun=true` may return `200` with zero selected targets and a warning.
- `dryRun=false` returns `400 no_write_targets` when filters select no write
  targets.

Target filter metadata may include normalized filter values, count summaries,
and ticker-level include/skip reasons. It must not include raw KIS responses,
tokens, secrets, request headers, or full provider payloads.

## Provider Contract

KIS adapter work should proceed in this order:

1. Token helper using env vars only.
2. Close price dry-run preview.
3. Guarded `dryRun=false` upsert through the existing
   `asset_price_snapshots(ticker,date)` writer.
4. Duplicate audit.
5. Daily snapshot writer.

The first KIS implementation must not add:

- Vercel Cron
- daily snapshot writer
- live mode `assets.current_price` updates
- Naver/Yahoo fallback
- token persistence in Postgres
