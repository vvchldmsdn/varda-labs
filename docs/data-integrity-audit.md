# Data Integrity Audit

Last updated: 2026-07-07

This audit is a read-only migration safety check. It is intentionally separate
from the KIS close sync, daily snapshot writer, and future Cron work.

## Scope

Run:

```bash
npm run audit:data-integrity
```

The script:

- reads from `DATABASE_URL`
- writes no database rows
- changes no schema
- calls no production mutation API
- prints a JSON summary with counts, distributions, and failed checks

## Checks

Current checks cover:

- account row counts, active/inactive distribution, and duplicate account codes
- `assets.account_id` and `assets.group_id` orphan references
- `assets.account` string coverage against `accounts.code`
- `asset_group_members.asset_id` / `group_id` orphan references
- duplicate asset group memberships
- `assets` and `asset_groups` duplicate `legacy_base44_id` groups
- event ledger nullable UUID mapping and account string coverage
- daily position snapshot nullable UUID mapping and account string coverage
- daily portfolio snapshot account mapping and duplicate snapshot keys
- imported versus varda-generated snapshot source distributions
- transaction account UUID mapping, raw account/payment distributions, and
  account string coverage
- market regime account UUID mapping, account string coverage, and
  date/account duplicate groups
- ETF holding parent mapping through `etf_master_id`, `etf_ticker`, and
  `legacy_etf_id`
- asset price snapshot nullable asset mapping, asset/ticker consistency, and
  ticker coverage against current assets

## Interpretation

`severity="error"` means the issue blocks FK/schema hardening until it is
understood or fixed.

`severity="info"` means the audit surfaced intentional migration state. For
example, historical `daily_position_snapshots` can preserve legacy asset ids
that no longer map to current `assets`; this is expected and should not cause
data deletion.

## Current Decision

Do not add FK constraints, backfill rows, or alter snapshot write semantics from
this audit alone. Use the audit output to decide the next small migration step.
See `docs/fk-hardening-proposal.md` for the current FK decision proposal.
See `docs/etf-holdings-readonly-semantics.md` for the ETF holdings duplicate
display policy.
See `docs/market-context-readonly-plan.md` for the benchmark, market regime,
and global factor read-only display policy.

## Latest Observation

Generated at: 2026-07-06T23:11:13Z.

Command:

```bash
npm run audit:data-integrity
```

Result:

- `ok`: `true`
- checks: 34
- failed `severity="error"` checks: 0
- failed `severity="info"` checks: 4
- info-only finding: `daily_position_snapshots.unmatched_legacy_asset_ids`
  reported 5 legacy asset id groups without current `assets` matches.
- info-only finding: `market_regime_daily.duplicate_date_account_groups`
  reported 3 brokerage date/account duplicate groups.
- info-only finding: `etf_holdings.duplicate_holding_identity_groups`
  reported 10 sample duplicate groups, all from `0001S0` on 2026-04-17 in
  the returned sample.
- info-only finding:
  `asset_price_snapshots.ticker_unmatched_current_assets` reported 7 price
  tickers that do not currently map to `assets.ticker`.

Core row counts:

- `accounts`: 4
- `assets`: 19
- `asset_groups`: 1
- `asset_group_members`: 1
- `event_ledger_entries`: 51
- `daily_portfolio_snapshots`: 82
- `daily_position_snapshots`: 452
- `asset_price_snapshots`: 11299
- `etf_masters`: 1202
- `etf_holdings`: 10872
- `fx_rates`: 467
- `market_regime_daily`: 69
- `settings`: 1
- `transactions`: 14

Current-state integrity:

- duplicate account code groups: 0
- `assets.account_id` orphans: 0
- `assets.group_id` orphans: 0
- asset account string mismatches against `accounts.code`: 0
- duplicate `assets.legacy_base44_id` groups: 0
- duplicate `asset_groups.legacy_base44_id` groups: 0
- `asset_group_members.asset_id` orphans: 0
- `asset_group_members.group_id` orphans: 0
- duplicate group memberships: 0

Imported/generated history integrity:

- event ledger UUID orphan checks: 0
- event ledger account string mismatches: 0
- daily position `asset_id` orphans: 0
- daily position `account_id` orphans: 0
- daily position account string mismatches: 0
- daily position duplicate current asset snapshot groups: 0
- daily portfolio `account_id` orphans: 0
- daily portfolio account string mismatches: 0
- daily portfolio duplicate snapshot/account/source groups: 0
- generated varda snapshots are present for 2026-07-06 and 2026-07-07.

The unmatched daily position legacy assets are expected migration evidence, not
a cleanup target. Keep `daily_position_snapshots.asset_id` nullable.

Later-candidate integrity:

- `transactions.account_id` orphans: 0
- transaction account string mismatches: 0
- transaction rows with null `account_id`: 11
- transaction raw account distribution: 11 blank rows, 3 `cash` rows
- `market_regime_daily.account_id` orphans: 0
- market regime account string mismatches: 0
- market regime duplicate date/account groups: 3, info only
- `etf_holdings.etf_master_id` orphans: 0
- ETF holding tickers unmatched to `etf_masters.ticker`: 0
- ETF holding legacy ids unmatched to `etf_masters.legacy_base44_id`: 0
- ETF holding identity duplicate groups: 10 in the sample, info only
- `asset_price_snapshots.asset_id` orphans: 0
- asset price `asset_id`/ticker mismatch groups: 0
- asset price tickers unmatched to current `assets.ticker`: 7, info only
- asset price ticker/date duplicate groups: 0

The asset price unmatched ticker finding is current-asset coverage evidence, not
a reason to require `asset_price_snapshots.asset_id`. Keep asset price history
usable by ticker/date and keep `asset_id` nullable.

The ETF holding duplicate finding is a read-only display semantics question, not
a cleanup target. Use `docs/etf-holdings-readonly-semantics.md` before building
ETF holdings UI or constraints.
