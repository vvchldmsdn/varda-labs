# FK Hardening Proposal

Last updated: 2026-07-07

This is a proposal only. It does not add foreign keys, generate a Drizzle
migration, update `src/db/schema.ts`, backfill data, or change write behavior.

## Basis

The 2026-07-07 read-only data integrity audit reported:

- `severity="error"` checks: 0
- total checks: 34
- duplicate account code groups: 0
- `assets.account_id` orphans: 0
- `assets.group_id` orphans: 0
- `asset_group_members.asset_id` orphans: 0
- `asset_group_members.group_id` orphans: 0
- duplicate asset group memberships: 0
- event ledger UUID orphans: 0
- daily position `asset_id` / `account_id` orphans: 0
- daily portfolio `account_id` orphans: 0
- transaction `account_id` orphans: 0
- market regime `account_id` orphans: 0
- ETF holding `etf_master_id` orphans: 0
- asset price `asset_id` orphans: 0
- asset price `asset_id` / ticker mismatch groups: 0

The non-passing checks were informational:

- `daily_position_snapshots.unmatched_legacy_asset_ids`: 5 legacy asset groups
  have no current `assets` match.
- `market_regime_daily.duplicate_date_account_groups`: 3 brokerage
  date/account duplicate groups.
- `etf_holdings.duplicate_holding_identity_groups`: 10 sampled duplicate
  identity groups.
- `asset_price_snapshots.ticker_unmatched_current_assets`: 7 price tickers have
  no current `assets.ticker` match.

These informational findings are migration evidence or normalization questions.
They are not cleanup targets by default and should not block read-only UI work.

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
| `transactions.account_id -> accounts.id` | no UUID orphans, 11 null account ids, 11 blank raw account rows | Nullable FK may be acceptable later, but raw account/payment text must remain. Do not infer required account ownership from this table yet. |
| `market_regime_daily.account_id -> accounts.id` | no UUID orphans, no account string mismatches, 3 date/account duplicate groups | Nullable FK may be acceptable later, but duplicate date/account groups need product interpretation before unique constraints or UI assumptions. |
| `etf_holdings.etf_master_id -> etf_masters.id` | no UUID orphans, no ticker or legacy ETF id unmatched groups, 10 sampled identity duplicates | Nullable FK is a stronger candidate after duplicate identity semantics are understood. Preserve `legacy_etf_id`, `etf_ticker`, and `etf_name`. |
| `asset_price_snapshots.asset_id -> assets.id` | no UUID orphans, 1692 null asset ids, 7 tickers not matched to current assets | Keep nullable. Price history is operationally ticker/date keyed and may include historical or non-current tickers. |

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
2. Decide whether the info-only findings need migration notes or UI handling,
   especially market regime duplicates, ETF holding duplicate identity rows, and
   asset price unmatched tickers.
3. Move to read-only UI work, such as ETF/EventLedger sections, while keeping
   market-data automation frozen.
