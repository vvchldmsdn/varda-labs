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
- Vercel KV or a dedicated secret store can be considered later.
- Postgres encrypted token cache is intentionally not part of the first
  implementation because it conflicts with the current migration rule.

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
