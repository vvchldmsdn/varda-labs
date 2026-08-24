# KIS Provider Policy

Last updated: 2026-07-25

This document fixes the provider and token policy before any KIS HTTP calls are
implemented. It is intentionally narrower than the full market-data pipeline.

## Decision

Use KIS as the current private operational provider for raw close and live
prices. This does not make KIS an exchange-authoritative close, adjusted-price,
or total-return provider. Do not make Naver or Yahoo the primary operational
provider. They can be evaluated later as fallback or read-only comparison
sources, but their response stability and blocking risk are not acceptable as
the first operational path.

This decision applies to the current private, single-migration-tenant
operational path. It does not grant KIS data multi-user cache, display, or
research-model authority.

## Multi-User Rights Boundary

KIS is not currently admitted as a shared market-data provider for multiple
Varda Labs users.

The official KIS Developers guidance distinguishes personal or general
corporate use for the customer's own assets from a corporation providing a
KIS-powered service to third parties. The partnership page also states that a
non-regulated fintech company is not eligible for that partnership route and
that a partner application displaying KRX or overseas exchange prices needs
the relevant exchange information-use agreement.

References:

- https://apiportal.koreainvestment.com/about-howto
- https://apiportal.koreainvestment.com/provider
- https://apiportal.koreainvestment.com/provider-apply

Until explicit written permission is obtained:

- Keep KIS provider calls private/admin-only.
- Do not expose a user-triggered KIS provider route.
- Do not treat a shared raw-price cache as authorized.
- Do not promote KIS raw-price rows to public Investment Lab or Simulation
  authority.
- Do not claim that KIS raw prices are adjusted or total-return data.

The confirmation questions and admission rules are recorded in
`docs/kis-multi-user-market-data-rights-inquiry-v1.md`.

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

- `memory_cache`

Reasoning:

- `memory_cache` reuses an unexpired token in a warm server instance without
  persisting credentials in Postgres.
- One live refresh also shares a request-scoped token session between price and
  USD/KRW requests, including concurrent issuance coalescing.
- `per_request` remains available for troubleshooting and still reuses one
  token inside a single request-scoped session.
- Serverless cold starts must still tolerate token refetches.
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

## Historical Completion Preflight

KIS access tokens are long-lived provider credentials, and the official KIS
sample reuses a valid token instead of issuing one for every command. A
historical completion review must therefore avoid consuming a token before the
approved write command runs.

- `simulation:complete-kis-history` defaults to `plan_only`.
- Plan-only reads the owned holding universe and reports targets, exclusions,
  and batch sizes without a provider call or database write.
- `--provider-dry-run` is an explicit diagnostic action. It calls KIS and can
  consume the provider's token-issuance window.
- `--write --confirm-shared-history-write` remains the only write mode.
- Do not use a provider dry-run as a same-window prerequisite for an approved
  write. Use plan-only plus fixture tests, then perform the reviewed write once.
- Provider authentication failures are terminal for that operator invocation;
  do not retry automatically.

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

Existing row policy for
`asset_price_snapshots(market,currency,ticker,date)`:

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
3. Guarded `dryRun=false` upsert through the existing composite-identity
   `asset_price_snapshots(market,currency,ticker,date)` writer.
4. Duplicate audit.
5. Daily snapshot writer.

The first KIS implementation must not add:

- Vercel Cron
- daily snapshot writer
- live mode `assets.current_price` updates
- Naver/Yahoo fallback
- token persistence in Postgres
