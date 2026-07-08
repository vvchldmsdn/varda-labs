# History Balance Read-Only Design

Last updated: 2026-07-08

Status: docs-only source-of-truth design. This document does not add routes,
UI, schema, migrations, imports, backfills, cleanup, RLS policies, auth provider
setup, Cron/KIS/snapshot/admin write-path changes, or recommendation logic.

## Decision Summary

Use `account_balance_snapshots` and `daily_portfolio_snapshots` as separate
read-only history lanes.

- `account_balance_snapshots` is account/balance evidence imported from Base44
  `AccountBalance`.
- `daily_portfolio_snapshots` is investment portfolio performance and trend
  evidence imported from Base44 `DailyPortfolioSnapshot`, plus later
  varda-generated daily snapshots.
- `daily_position_snapshots` can support future date/account drilldowns, but it
  is not the first source for high-level balance history.
- Do not add or import `PortfolioSnapshot` now.
- Do not add or import `DailyGroupSnapshot` now.

`PortfolioSnapshot` remains fold/defer. It should be revisited only if a future
read-only history screen proves that its earlier total-history rows are
product-visible and cannot be reasonably represented from migrated balance and
portfolio snapshots.

## Source Tables

### `account_balance_snapshots`

Role: account/balance history source.

Shape:

| Column | Display meaning |
| --- | --- |
| `date` | Balance snapshot date. |
| `cash` | Cash/balance evidence from the source row. |
| `brokerage` | Brokerage balance evidence from the source row. |
| `isa` | ISA balance evidence from the source row. |
| `irp` | IRP balance evidence from the source row. |
| `legacy_base44_id` | Base44 source id for audit/reimport idempotency. |

Interpretation:

- This is a wide-row balance source.
- It should not be treated as the same metric as portfolio market value,
  invested amount, total cost, PnL, or return.
- It currently has no owner key. Per
  `docs/auth-and-tenant-model-design.md`, it is user-owned historical evidence
  and needs future initial-owner assignment before user-specific writes or RLS.

### `daily_portfolio_snapshots`

Role: investment portfolio performance and trend source.

Shape:

| Column family | Display meaning |
| --- | --- |
| `snapshot_date`, `account`, `account_id`, `source` | Date/account/source identity. |
| `cash_value`, `invested_amount`, `total_cost`, `total_market_value` | Portfolio valuation basis. |
| `total_pnl`, `total_return_pct` | Investment performance basis. |
| `fx_rate`, `usdkrw`, `kr_weight`, `us_weight`, `usd_exposure_pct` | FX and allocation context. |
| benchmark columns | Aggregate benchmark output for the snapshot, not raw benchmark history. |
| regime columns | Imported/generated context for that portfolio snapshot. |

Interpretation:

- This is the source for investment trend, return, and valuation history.
- The unique identity is `(snapshot_date, account, source)`.
- Source must remain visible in a future history view because imported rows and
  varda-generated rows coexist.
- The `all` account row is a first-class aggregate when present.
- It currently has no owner key. Per
  `docs/auth-and-tenant-model-design.md`, it is user-owned historical evidence
  and needs future initial-owner assignment before user-specific writes or RLS.

### `daily_position_snapshots`

Role: future detail drilldown candidate.

Use it for:

- per-date holdings detail;
- account-specific position rows;
- removed-position or unmatched legacy-row inspection;
- future group exposure views when exact group snapshot rows are not required.

Do not use it as the first source for high-level balance totals.

## Read-Only Data Smoke

Smoke date: 2026-07-08. Queries were SELECT-only against the current Neon
database. No amount values are recorded in this document.

### `account_balance_snapshots`

| Check | Result |
| --- | ---: |
| Rows | 3 |
| Date range | 2026-02-18 to 2026-02-26 |
| Distinct dates | 3 |
| Dates | 2026-02-18, 2026-02-20, 2026-02-26 |
| `cash` null rows | 0 |
| `brokerage` null rows | 0 |
| `isa` null rows | 0 |
| `irp` null rows | 0 |
| `legacy_base44_id` null rows | 0 |
| Sample rows | 0 |

### `daily_portfolio_snapshots`

| Check | Result |
| --- | ---: |
| Rows | 86 |
| Date range | 2026-05-20 to 2026-07-08 |
| Distinct dates | 26 |
| Accounts | 4 |
| Sources | 2 |
| `legacy_base44_id` null rows | 12 |
| Sample rows | 0 |
| Duplicate `(snapshot_date, account, source)` groups | 0 |

Source/account distribution:

| Account | Source | Rows | Date range | Distinct dates | Null `account_id` rows |
| --- | --- | ---: | --- | ---: | ---: |
| `all` | `base44_import` | 5 | 2026-05-20 to 2026-07-05 | 5 | 5 |
| `all` | `varda_manual_daily_snapshot` | 3 | 2026-07-06 to 2026-07-08 | 3 | 3 |
| `brokerage` | `base44_import` | 23 | 2026-05-20 to 2026-07-05 | 23 | 0 |
| `brokerage` | `varda_manual_daily_snapshot` | 3 | 2026-07-06 to 2026-07-08 | 3 | 0 |
| `irp` | `base44_import` | 23 | 2026-05-20 to 2026-07-05 | 23 | 0 |
| `irp` | `varda_manual_daily_snapshot` | 3 | 2026-07-06 to 2026-07-08 | 3 | 0 |
| `isa` | `base44_import` | 23 | 2026-05-20 to 2026-07-05 | 23 | 0 |
| `isa` | `varda_manual_daily_snapshot` | 3 | 2026-07-06 to 2026-07-08 | 3 | 0 |

Every row has non-null `total_market_value`, `invested_amount`, and
`cash_value`.

### Coverage Relationship

| Check | Result |
| --- | ---: |
| Dates overlapping both source tables | 0 |
| `account_balance_snapshots` dates absent from `daily_portfolio_snapshots` | 3 |
| `daily_portfolio_snapshots` dates inside balance date range but absent from balance table | 0 |

Interpretation:

- The two sources do not overlap in time.
- Balance evidence covers only three February 2026 dates.
- Portfolio performance evidence starts on 2026-05-20 and continues through
  the current varda-generated daily snapshot cycle.
- A future history view should show the gap explicitly rather than smoothing or
  joining the two series as if they were the same metric.

### Aggregate Coverage

`daily_portfolio_snapshots` has account-specific rows for `brokerage`, `isa`,
and `irp` across 26 distinct dates, but `account = 'all'` exists for only 8
dates.

Dates with account-specific rows but no `all` row:

- 2026-05-21
- 2026-05-22
- 2026-05-23
- 2026-05-24
- 2026-05-25
- 2026-05-26
- 2026-05-30
- 2026-05-31
- 2026-06-04
- 2026-06-07
- 2026-06-20
- 2026-06-21
- 2026-06-25
- 2026-06-26
- 2026-06-27
- 2026-06-28
- 2026-06-29
- 2026-06-30

Display rule:

- If an `account = 'all'` row exists for a date/source, use it as the aggregate
  source.
- If no `all` row exists but all required account rows exist
  (`brokerage`, `isa`, and `irp`), the current read-only `/history` route may
  derive an aggregate display row, but it must label that row as derived and
  keep the source rows inspectable.
- If the date/source group is partial, do not show it as an `all` aggregate.
  Use the account-specific filters to inspect the underlying rows instead.
- Do not write derived aggregate rows back to the database without a separate
  snapshot/backfill decision.

## Display Semantics

Do not treat these metrics as interchangeable:

| Metric | Source | Meaning |
| --- | --- | --- |
| Cash/balance fields | `account_balance_snapshots` | Balance evidence by account bucket. |
| `cash_value` | `daily_portfolio_snapshots` | Portfolio snapshot cash component. |
| `invested_amount` | `daily_portfolio_snapshots` | Invested/capital basis from snapshot logic. |
| `total_cost` | `daily_portfolio_snapshots` | Cost basis in snapshot. |
| `total_market_value` | `daily_portfolio_snapshots` | Investment valuation in snapshot. |
| `total_pnl` and `total_return_pct` | `daily_portfolio_snapshots` | Investment performance. |

If both lanes appear in one future page:

- use separate series names;
- show source table and source type;
- avoid a single unlabeled "total" line;
- keep balance history and investment performance visually distinct;
- show coverage gaps instead of interpolating;
- make account filters explicit.

## `PortfolioSnapshot` Decision

Inventory baseline:

- 57 rows;
- date range 2026-02-26 to 2026-07-01;
- stores account totals and grand total;
- overlaps conceptually with both `daily_portfolio_snapshots` and
  `account_balance_snapshots`.

Current decision: keep `PortfolioSnapshot` fold/defer.

Reason:

- It would introduce a third total-history source.
- Current dashboard already has current headline data and
  `daily_portfolio_snapshots` trend data.
- `account_balance_snapshots` already preserves the earlier February balance
  evidence that was intentionally imported.
- The remaining value appears to be earlier total-history coverage, not a
  distinct product model.

Revisit only if:

- a concrete read-only history screen requires total history before
  2026-05-20;
- the required totals cannot be clearly represented by existing balance and
  portfolio lanes;
- the product accepts a third legacy total source with clear labeling.

Until then:

- do not create `portfolio_snapshots`;
- do not import `PortfolioSnapshot`;
- do not use it in `/` dashboard queries;
- do not silently merge it into `daily_portfolio_snapshots`.

## `DailyGroupSnapshot` Decision

Current decision: derive/defer.

Reason:

- Group-level views can likely be derived from `daily_position_snapshots`,
  `asset_groups`, and `asset_group_members` for first read-only use.
- Exact historical group drift/execution evidence is not required by the
  current read-only dashboard or this history/balance design.

Revisit only if a future group-history audit view needs the exact Base44-stored
group output for each date.

## Future Read-Only Page Shape

The current `/history` route should stay narrow:

- account filter: `all`, `brokerage`, `isa`, `irp`;
- source toggle: balance evidence, portfolio performance, or both;
- coverage panel: date ranges and missing aggregate rows;
- table-first rendering before chart polish;
- optional detail link for position snapshots on a date/account.

Current URL shape:

- `/history?account=all&lane=portfolio`
- `/history?account=brokerage&lane=balance`

This does not authorize writes, imports, or chart/polish expansion.

## Guardrails

- Keep `/history` read-only and table-first.
- No `/balance` route yet.
- No schema or migration.
- No import/backfill of `PortfolioSnapshot` or `DailyGroupSnapshot`.
- No cleanup/delete/backfill.
- No Cron/KIS/snapshot/admin write-path changes.
- No recommendation/risk/scoring connection.
- No user-facing write path before the auth/tenant gates in
  `docs/auth-and-tenant-model-design.md`.

## Next Step

After review, the next safe implementation step could be a small read-only
history query helper and table-first page. That should still avoid
`PortfolioSnapshot` unless this document's revisit trigger is met.
