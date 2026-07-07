# Cron Preflight Route Contract

Last updated: 2026-07-08

This is a contract draft only. It does not add a route, enable Vercel Cron,
add `vercel.json`, change any admin route, or open any write path.

## Candidate Route

Future route candidate:

```text
GET /api/cron/market-cycle/preflight
```

The name is not final. The important contract is that this is a cron-only
`GET` preflight surface, separate from the existing manual/admin `POST` write
routes.

Existing write-capable routes remain separate:

- `POST /api/admin/market/prices/sync`
- `POST /api/admin/snapshots/daily`

The future preflight route must not proxy blindly to those admin routes.

## Purpose

The preflight route answers one question:

```text
If the current market cycle ran now, what close-price and snapshot readiness
state would block or allow the next guarded steps?
```

It should inspect readiness only. In Phase 1 it must not:

- call KIS for actual provider writes
- write `asset_price_snapshots`
- write `daily_portfolio_snapshots`
- write `daily_position_snapshots`
- update `assets.current_price`
- write `market_data_sync_runs`
- trigger cleanup, delete, repair, or backfill work

The route may reuse read-only calculation helpers that power manual dry-runs,
but the first implementation should be reviewed before any code is added.

## Auth Contract

Authentication should use the existing secret-based admin contract:

- `CRON_SECRET`, or
- `ADMIN_JOB_SECRET`

Accepted presentation forms should match `src/lib/admin-auth.ts`:

- `Authorization: Bearer <secret>`
- `x-admin-job-secret: <secret>`

Vercel Cron headers may be recorded as non-secret context, but only as secondary
signals:

- user agent: `vercel-cron/1.0`
- header: `x-vercel-cron-schedule`

The route must not authenticate by user agent alone.

The response, logs, and any future metadata must not include:

- secret values
- Authorization header values
- KIS app keys
- KIS app secrets
- access tokens
- raw provider request headers
- raw provider response bodies

## Input Contract

Inputs are GET query parameters only.

Allowed candidate inputs:

| Query | Required | Values | Purpose |
| --- | --- | --- | --- |
| `date` | no | `YYYY-MM-DD` | inspect a specific cycle date in dry-run/debug mode |
| `account` | no | `all`, `brokerage`, `isa`, `irp` | inspect one account scope or the aggregate scope |
| `mode` | no | `preflight` | reserved explicit mode; any future value requires review |

Rejected inputs:

- `dryRun=false`
- `confirmWrite`
- `write`
- `force`
- `backfill`
- `delete`
- provider tokens or provider credentials

The route should default to the current resolved KST cycle when `date` is not
provided. Cron schedule definitions stay UTC, but cycle logic remains KST-based
because the daily snapshot writer already resolves portfolio cycles in KST.

## Output Contract

Candidate JSON response shape:

```json
{
  "ok": true,
  "routeMode": "preflight",
  "wouldWrite": false,
  "secretsIncluded": false,
  "cycle": {
    "snapshotDate": "YYYY-MM-DD",
    "resolvedAtKst": "ISO-8601",
    "cronScheduleUtc": "string-or-null"
  },
  "expectedCloseDates": [
    {
      "market": "korea",
      "expectedCloseDate": "YYYY-MM-DD",
      "targetCount": 0
    }
  ],
  "closeCoverage": {
    "requiredCount": 0,
    "satisfiedCount": 0,
    "missingCount": 0,
    "staleCount": 0,
    "items": []
  },
  "closeSyncPlan": {
    "canProceedToSnapshotWrite": false,
    "suggestedBatches": [],
    "dryRunQueries": []
  },
  "snapshot": {
    "writeReady": false,
    "plannedPortfolioWrites": {
      "insert": 0,
      "update": 0
    },
    "plannedPositionWrites": {
      "insert": 0,
      "update": 0
    }
  },
  "blockingReasons": [],
  "nextRecommendedAction": "string"
}
```

Output rules:

- `wouldWrite` must always be `false` in Phase 1.
- `secretsIncluded` must always be `false`.
- `closeSyncPlan` may include dry-run query strings only.
- `closeSyncPlan` must not include a ready-to-run
  `dryRun=false&confirmWrite=true` URL.
- `nextRecommendedAction` should be a human-readable category such as:
  - `no_action_required`
  - `manual_kis_close_dry_run_required`
  - `manual_kis_close_write_required_after_review`
  - `manual_daily_snapshot_dry_run_required`
  - `blocked_by_missing_close_coverage`
  - `blocked_by_kis_cooldown`
  - `blocked_by_duplicate_or_unmanaged_rows`

## Failure Policy

The route should be conservative:

- Missing or stale close rows set `snapshot.writeReady=false`.
- KIS cooldown state is reported as a blocking reason.
- Partial data is not reported as success.
- Imported Base44 rows that block writes remain blocking evidence.
- Duplicate or unmanaged generated rows remain blocking evidence.
- Any unexpected error returns a sanitized error response.
- A failed preflight must not mutate the database.

## Schedule Notes

Vercel Cron schedules are UTC. The future route should report both the UTC
schedule context and the resolved KST portfolio cycle.

Candidate schedules remain non-binding until `vercel.json` is separately
approved:

| Candidate UTC | KST | Intended future purpose |
| --- | --- | --- |
| `22:05 UTC` | `07:05 KST` | FX sync preflight or read-only readiness check |
| `22:10 UTC` | `07:10 KST` | close sync readiness check |
| `22:20 UTC` | `07:20 KST` | daily snapshot readiness check |

Do not implement a high-frequency live quote Cron route in this phase.

## Non-Goals

- No `vercel.json`.
- No Cron enablement.
- No KIS actual write.
- No daily snapshot actual write.
- No live `assets.current_price` update.
- No route that accepts `confirmWrite=true`.
- No write limit, cooldown, or token policy change.
- No serverless function that sleeps through repeated 90 second cooldowns.
- No schema, migration, FK, or unique constraint change.
- No cleanup, delete, destructive backfill, or repair path.

## Acceptance Criteria Before Implementation

Before any route file is added:

1. The separation between existing `POST` admin routes and the future `GET`
   Cron preflight route is explicit.
2. The route is read-only by contract.
3. UTC schedule context and KST cycle resolution are both represented.
4. Write-related query parameters are explicitly rejected.
5. No planner output contains a ready-to-run actual-write URL.
6. Failure states remain blocking, not silently successful.
7. A later implementation approval gate is recorded before code work starts.

## Next Approval Gate

The next implementation step, if approved later, is a read-only route skeleton
for `GET /api/cron/market-cycle/preflight`.

That future implementation still must not add `vercel.json` or perform writes.
