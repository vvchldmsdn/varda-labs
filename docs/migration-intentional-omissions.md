# Migration Intentional Omissions

This note separates deliberate migration gaps from issues that should be fixed
before expanding the migrated app surface.

## Intentionally Preserved

- Base44 24-character ids remain in `legacy_base44_id` / `legacy_*` columns.
  Current UUID primary keys stay canonical for varda-labs.
- Historical snapshots keep denormalized text fields such as ticker, asset name,
  account string, market, currency, and source labels. This preserves Base44
  evidence even when current UUID rows are missing.
- `daily_position_snapshots.asset_id` and similar history pointers stay nullable.
  The Base44 export contains legacy position rows that do not currently match an
  imported Asset row.
- KIS secrets and access tokens are not stored in Postgres. The KIS adapter reads
  app credentials from environment variables and uses per-request token fetching
  unless configured otherwise.
- Import scripts remain dry-run by default and require `--write` for mutation.
- Daily snapshot writes remain manual and guarded by `dryRun=false` plus
  `confirmWrite=true` until the close-price cycle has been validated in live
  market conditions.

## Protected In Code

- The read-only dashboard is not public in production unless an app access
  password is configured. Set `VARDA_APP_PASSWORD` or `APP_ACCESS_PASSWORD`;
  `VARDA_APP_USER` defaults to `varda`.
- `/api/entities/*` CRUD routes require the same admin job secret mechanism used
  by admin routes: `Authorization: Bearer <secret>` or `x-admin-job-secret`.

## Pending Decisions

- Add database foreign keys for core current-state tables such as assets,
  accounts, asset groups, and asset group members only after reviewing
  `npm run audit:data-integrity`. The 2026-07-07 read-only audit found zero
  `severity="error"` orphan or duplicate checks, but FK migrations should still
  be proposed separately from the audit itself.
- Revisit `asset_price_snapshots` uniqueness. Current writes use ticker/date,
  while lookup targets are market/ticker/currency. A future migration should
  decide whether the unique key should include market and currency.
- Add deterministic tests for portfolio return metrics, market calendar close
  dates, close sync planning, and daily snapshot write guards before enabling
  automated Cron writes.
- Replace the hard-coded Korean holiday coverage before running unattended
  snapshots beyond the covered migration years.
