# FX Refresh Provider Plan

Last updated: 2026-07-08

Status: docs-only provider/source audit. This document does not add routes,
provider code, schema migrations, Cron, dashboard buttons, or database writes.

## Decision

Do not implement `/api/admin/market/fx/sync` yet. The next executable step,
when approved, should be an admin-only dry-run route for USD/KRW only. Public
sync buttons, Cron wiring, multi-currency FX, and snapshot writer changes remain
out of scope.

The current dashboard should continue to describe FX as latest stored USD/KRW,
not real-time FX.

## Base44 Reference

Read-only reference:

- `C:\Users\Eunwoo_2\Desktop\gyeol-fin\base44\functions\syncFxRates\entry.ts`

Observed behavior to preserve conceptually, without copying the implementation:

- Backfills roughly 540 days of USD/KRW history from Frankfurter.
- Skips the current KST end date in the Frankfurter loop.
- Fetches a current-day snapshot through fallback providers.
- Upserts Base44 `FxRate` by `date`.
- Updates an existing row only when the value differs materially.
- Stores `date`, `usdkrw`, `source`, `fetched_at`, and `status`.
- Keeps only a rolling window of recent rows in Base44.

Base44 behavior not to copy directly:

- Do not hard-code provider keys or auth tokens.
- Do not use a public dashboard session as authorization for server jobs.
- Do not delete old `fx_rates` rows as part of the first varda implementation.
- Do not call Yahoo Finance an official or guaranteed FX source.
- Do not add multi-currency rows before the valuation model supports them.

## Source Candidates

Source docs reviewed for this plan:

- Frankfurter: `https://frankfurter.dev/`
- ExchangeRate-API Open Access: `https://www.exchangerate-api.com/docs/free`

### Frankfurter

Use for historical and previous-day repair rows.

Current public docs describe Frankfurter as a daily exchange-rate API with a
public API at `api.frankfurter.dev`, no API key requirement, `base`/`quotes`
filtering, historical date lookup, and time-series queries using `from` and
`to`. The docs also say provider filtering and provider attribution are
available.

Planned varda use:

- source label: `frankfurter`
- pair: USD/KRW
- query style: narrow USD base and KRW quote only
- row date: provider-returned rate date
- freshness semantics: daily/reference rate, not intraday or real-time FX
- write use: historical backfill/repair and previous service-day coverage

Do not use Frankfurter as proof of current intraday FX.

### ExchangeRate-API Open Access

Use as the first candidate for latest stored USD/KRW fallback only after route
implementation is approved.

Current public docs describe the open endpoint as no-key, rate-limited, updated
once per day, cacheable under its terms, and returning `time_last_update_utc`,
`time_next_update_utc`, `base_code`, and `rates`.

Planned varda use:

- source label: `er-api_open_access`
- pair: USD/KRW
- request style: `latest/USD`, read `rates.KRW`
- row date: UTC date from `time_last_update_utc`, not the local request date
- fetched time: server fetch timestamp
- freshness semantics: latest stored daily FX, not real-time FX
- attribution/terms: verify before production UI exposure

Do not poll this endpoint frequently. Its own docs say the open data refreshes
once per day.

### Yahoo Finance Chart

Base44 used Yahoo Finance chart data as a current snapshot fallback. Treat this
as an unstable compatibility reference only.

Current varda stance:

- do not use as v1 canonical provider;
- do not call it official;
- do not depend on it before provider stability and terms are reviewed;
- if later enabled, gate it behind explicit source approval and metadata labels.

### Korea Exim

Base44 used Korea Exim as a later fallback. Treat this as a possible official
source candidate, not a ready implementation.

Current varda stance:

- do not hard-code an auth key;
- do not add an env var until the provider terms and key ownership are reviewed;
- if approved later, store only provider/source labels and counts, never the key;
- decide whether its `deal_bas_r` basis is the correct service-day FX basis
  before using it for dashboard movement.

## Row Policy

Current table:

- `fx_rates.date`
- `fx_rates.usdkrw`
- `fx_rates.source`
- `fx_rates.status`
- `fx_rates.fetched_at`
- `fx_rates.legacy_base44_id`
- `fx_rates.is_sample`

No schema change is part of this plan.

Rules for a future admin-only route:

- Supported v1 pair is USD/KRW only.
- `date` must be the provider rate date, not simply the request date.
- `usdkrw` must be finite and positive.
- `source` must identify the provider and mode, for example `frankfurter` or
  `er-api_open_access`.
- `status='ok'` is the only status that can be used for valuation.
- `fetched_at` is the server-side fetch timestamp.
- varda-generated rows use `legacy_base44_id = null`.
- Imported Base44 rows must not be silently mutated in the first route version.
- If a target `date` already has a varda-generated row, update it only when the
  new value differs by more than `0.01`.
- If a target `date` has only imported legacy rows, skip it unless a later
  migration policy explicitly allows replacing imported FX evidence.
- If a target `date` has duplicate rows, block actual write and report a data
  quality error instead of guessing.
- If the provider returns no KRW rate, a non-positive rate, or malformed dates,
  write nothing.
- Do not insert failure rows until a stale-status row policy is approved.

Future hardening candidate:

- Add a unique operational key on `fx_rates(date)` only after auditing imported
  rows for duplicates and deciding how legacy rows should be treated.

## Route Contract

Future route:

- `POST /api/admin/market/fx/sync`
- Auth: `ADMIN_JOB_SECRET` or `CRON_SECRET`
- Default: `dryRun=true`
- Actual write: `dryRun=false&confirmWrite=true`

Allowed write tables:

- `fx_rates`
- optional `market_data_sync_runs` with sanitized metadata only

Forbidden write tables:

- `assets`
- `asset_price_snapshots`
- `daily_position_snapshots`
- `daily_portfolio_snapshots`
- settings or any table that could hold provider credentials

Response may include:

- provider
- pair
- dry-run state
- candidate date
- candidate USD/KRW
- source
- status
- planned insert/update/skip counts
- warnings

Response must not include:

- credentials
- provider request headers
- authorization headers
- raw response bodies
- raw URLs with keys
- environment variable values
- executable actual-write URLs

## Implementation Gate

Before writing route code:

1. Add pure parser fixtures for Frankfurter and ExchangeRate-API responses.
2. Add row policy tests for insert, update, skip imported row, duplicate block,
   malformed response, and no-write dry-run.
3. Implement dry-run first.
4. Confirm no-auth and missing-confirm guards stop before provider and DB
   mutation.
5. Smoke the dry-run route in production.
6. Ask for explicit approval before one actual USD/KRW write.

Before public button design:

1. One admin-only FX actual write has been manually approved and verified.
2. Dashboard FX as-of text changes only from the stored FX row.
3. Metadata secret audit passes.
4. Price freshness and FX freshness remain separately displayed.
5. Button copy avoids "real-time FX".

## Verification Plan

Docs-only phase:

- `git diff --check`

Route implementation phase:

- `npm run test`
- `npm run lint`
- `npm run build`
- no-auth production smoke
- authenticated dry-run smoke
- missing `confirmWrite=true` actual-write guard smoke
- one approved actual write smoke
- `fx_rates` date/pair check
- forbidden table row-count checks
- metadata secret audit
- authenticated `/` dashboard smoke

## Open Questions

- Should varda-labs ever overwrite imported Base44 FX rows, or should it only
  add varda-generated rows for dates after import coverage?
- Should a future unique index be `fx_rates(date)` or should source-specific
  rows be allowed with a selected canonical row?
- Is Frankfurter enough for service-day close snapshots, or should Korea Exim be
  preferred for KRW official reference semantics after key ownership is clear?
- Does the product need exchange-rate attribution text if ExchangeRate-API open
  access data is used in a rendered page?
