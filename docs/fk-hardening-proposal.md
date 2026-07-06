# FK Hardening Proposal

Last updated: 2026-07-07

This is a proposal only. It does not add foreign keys, generate a Drizzle
migration, update `src/db/schema.ts`, backfill data, or change write behavior.

## Basis

The 2026-07-07 read-only data integrity audit reported:

- `severity="error"` checks: 0
- duplicate account code groups: 0
- `assets.account_id` orphans: 0
- `assets.group_id` orphans: 0
- `asset_group_members.asset_id` orphans: 0
- `asset_group_members.group_id` orphans: 0
- duplicate asset group memberships: 0
- event ledger UUID orphans: 0
- daily position `asset_id` / `account_id` orphans: 0
- daily portfolio `account_id` orphans: 0

The only non-passing check was informational:

- `daily_position_snapshots.unmatched_legacy_asset_ids`: 5 legacy asset groups
  have no current `assets` match.

That informational finding is expected migration evidence. It is not a cleanup
target and should not block read-only UI work.

## Safe Current-State FK Candidates

These relationships are good first candidates because they represent current
state rather than historical evidence, and the audit found no orphans.

| Relationship | Column State | Suggested Delete Policy | Rationale |
| --- | --- | --- | --- |
| `assets.account_id -> accounts.id` | nullable in schema, currently populated | `restrict` / `no action` | Current asset ownership should point to a valid account. Keep nullable at the column level until product rules require otherwise. |
| `assets.group_id -> asset_groups.id` | nullable, mostly null by design | `set null` or `restrict` | Group assignment is optional. `set null` matches optional grouping, while `restrict` protects accidental group deletion. Pick one deliberately before migration. |
| `asset_group_members.asset_id -> assets.id` | not null | `cascade` only if membership is purely dependent; otherwise `restrict` | Membership cannot exist without an asset, but deleting assets may need an explicit operator decision. |
| `asset_group_members.group_id -> asset_groups.id` | not null | `cascade` only if membership is purely dependent; otherwise `restrict` | Membership cannot exist without a group, but deleting groups may need an explicit operator decision. |

Recommended first migration, if approved later:

1. Add FK constraints only for `assets` and `asset_group_members`.
2. Do not make nullable columns non-null in the same migration.
3. Re-run `npm run audit:data-integrity` immediately before migration.
4. Keep the migration independent from market-data, KIS, snapshot, and Cron work.

## Possible Later FK Candidates

These passed orphan checks but preserve imported or historical evidence. Add
constraints only after deciding whether the table is current state or audit
history.

| Relationship | Current Finding | Proposed Stance |
| --- | --- | --- |
| `event_ledger_entries.account_id -> accounts.id` | no UUID orphans, many null account ids | Nullable FK may be acceptable, but raw `account` should remain. |
| `event_ledger_entries.asset_id -> assets.id` | no UUID orphans, some null asset ids | Nullable FK may be acceptable, but `legacy_asset_id`, `ticker`, and `asset_name` remain canonical evidence for unmatched events. |
| `event_ledger_entries.group_id -> asset_groups.id` | no UUID orphans, mostly null group ids | Nullable FK may be acceptable, but group history should not be required. |
| `event_ledger_entries.corrects_event_id -> event_ledger_entries.id` | no correction rows now | Add only when correction workflows are used. |
| `daily_portfolio_snapshots.account_id -> accounts.id` | no UUID orphans, `all` aggregate rows naturally have null account ids | Nullable FK is possible, but `account='all'` must remain valid without an account row. |
| `transactions.account_id -> accounts.id` | not covered by the latest audit | Audit first. Cashflow imports may intentionally preserve raw account/payment text. |
| `market_regime_daily.account_id -> accounts.id` | not covered by the latest audit | Audit first. Market context can be account-scoped or aggregate-derived. |
| `etf_holdings.etf_master_id -> etf_masters.id` | not covered by the latest audit | Audit first. `legacy_etf_id`, `etf_ticker`, and `etf_name` should remain preserved even if a parent row is missing. |

## Relationships To Keep Without FK For Now

These should not receive FK constraints in the next migration.

- `legacy_base44_id`, `legacy_asset_id`, `legacy_group_id`,
  `legacy_corrects_event_id`, and `legacy_etf_id` columns.
- Raw historical labels such as `account`, `ticker`, `asset_name`,
  `group_name`, `market`, `currency`, and provider `source`.
- `daily_position_snapshots.asset_id` as a required reference.
  It must stay nullable because imported Base44 position history includes
  unmatched legacy assets.
- Any settings, token, app key, app secret, authorization, or credential-like
  value. Secrets do not belong in Postgres user data.
- `asset_price_snapshots.asset_id` as a required reference. Price history is
  keyed operationally by ticker/date and may outlive current asset rows.

## Migration Checklist

Before any FK migration:

1. Re-run `npm run audit:data-integrity`.
2. Confirm `severity="error"` failures are 0.
3. Confirm the latest generated daily snapshots still have no duplicate
   snapshot/account/source groups.
4. Decide every `on delete` policy explicitly.
5. Keep history tables non-cascading unless a table is purely dependent.
6. Check Neon lock/availability risk for constraint creation.
7. Prepare rollback SQL before applying the migration.
8. Run `npm run db:generate`, review generated SQL, then run
   `npm run db:migrate` only after approval.

## Current Decision

No FK migration should be generated from this proposal yet.

Next safe options:

1. Review and approve a narrow current-state FK migration for `assets` and
   `asset_group_members`.
2. Add read-only audits for possible later FK candidates such as transactions,
   market regime rows, and ETF holdings.
3. Move to read-only UI work, such as ETF/EventLedger sections, while keeping
   market-data automation frozen.
