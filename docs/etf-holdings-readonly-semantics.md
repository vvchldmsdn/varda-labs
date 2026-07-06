# ETF Holdings Read-only Semantics

Last updated: 2026-07-07

This document defines the first read-only interpretation policy for
`etf_masters` and `etf_holdings`. It does not approve cleanup, backfill,
foreign keys, unique constraints, portfolio lookthrough calculations, or UI
implementation.

## Current Data State

The latest read-only data integrity audit reported:

- `etf_masters`: 1,202 rows
- `etf_holdings`: 10,872 rows
- `etf_holdings.etf_master_id` orphans: 0
- `etf_holdings.etf_ticker` unmatched to `etf_masters.ticker`: 0
- `etf_holdings.legacy_etf_id` unmatched to
  `etf_masters.legacy_base44_id`: 0
- `etf_holdings.etf_master_id` null rows: 0
- `etf_holdings.legacy_etf_id` null rows: 25
- distinct ETF tickers in `etf_holdings`: 1,097
- distinct `as_of_date` values in `etf_holdings`: 53

The same audit returned sampled duplicate holding identity groups. The sample
contained 10 groups, all for ETF ticker `0001S0` on `2026-04-17`.

Important interpretation: the audit query is capped by `SAMPLE_LIMIT`, so the
10 groups are a sample, not proof that only 10 duplicate groups exist.

## Duplicate Identity Heuristic

The current audit treats rows as duplicate holding identity candidates when
this key repeats:

```text
etf_ticker + as_of_date + coalesce(holding_symbol, '(null)') + holding_name
```

This is an audit heuristic, not an approved product identity key.

Known limitations:

- It does not include `etf_master_id`, because the UI may still need a fallback
  path through `etf_ticker`.
- It does not include `source`, because cross-source duplicates are one of the
  risks the audit should surface.
- It does not include `holding_market`, `currency`, `sector`, `security_type`,
  `rank`, `weight_pct`, `shares`, or `market_value`.
- It can group rows where the same holding name appears more than once with
  different source metadata, rank, or value fields.

Do not use this heuristic as a unique constraint without a separate migration
review.

## Display Policy Options

### A. Raw Rows

Show every `etf_holdings` row exactly as stored.

Pros:

- Preserves imported evidence with no interpretation.
- Makes source differences visible.
- Avoids accidental aggregation of incompatible rows.

Cons:

- Users can see the same holding repeated.
- ETF lookthrough weight totals may look inflated.
- It is noisy for large ETFs and broad market funds.

### B. Summed Identity Groups

Group rows by holding identity and sum numeric fields such as `weight_pct`,
`shares`, and `market_value`.

Pros:

- Better for lookthrough-style summaries.
- Reduces visible duplicates.

Cons:

- Can overstate exposure if rows are duplicate source artifacts.
- Can hide rank/source/notes differences.
- Requires a clear rule for null `holding_symbol` and different source values.

### C. Single Preferred Row

Pick one row per holding identity using a source/rank/timestamp priority.

Pros:

- Simple table display.
- Avoids duplicate-looking rows.

Cons:

- Hides preserved raw evidence.
- Source priority is not decided yet.
- Can drop meaningful alternate rows.

### D. Grouped Summary With Raw Detail

Use grouped rows for the first read-only UI, but expose the number of raw rows
behind each group. A detail/debug view can show raw rows when needed.

Pros:

- Keeps the main UI readable.
- Preserves auditability.
- Avoids destructive cleanup or premature uniqueness assumptions.
- Makes duplicates visible without presenting them as an error.

Cons:

- Requires the UI to label grouped values clearly.
- Still needs explicit aggregation rules for numeric fields.

Decision for the first read-only ETF UI: use option D.

## First ETF Read-only UI Contract

The first ETF UI should be read-only and limited to reference browsing.

Recommended scope:

- ETF master list/search using `etf_masters`.
- ETF detail view using the latest `as_of_date` available for that ETF.
- Holdings table from `etf_holdings` for the selected ETF/date.
- Group duplicate identity candidates by the audit heuristic above.
- Show a duplicate count badge when a displayed group contains more than one
  raw row.
- Label grouped numeric values as grouped display values.
- Provide raw-row detail only in a clearly marked detail/debug section.
- Keep `legacy_etf_id`, `etf_ticker`, and `etf_name` visible enough for
  migration traceability.

Do not connect this UI to portfolio exposure, risk scoring, recommendations,
KIS jobs, daily snapshots, or automated market-data writes.

## Numeric Display Rules

For a grouped ETF holding row:

- `weight_pct`: sum only when all raw rows in the group share the same
  `source`; otherwise display a grouped badge and prefer source-specific detail.
- `shares`: sum only when all raw rows in the group share the same `source` and
  `currency`; otherwise leave blank in the grouped row.
- `market_value`: sum only when all raw rows in the group share the same
  `source` and `currency`; otherwise leave blank in the grouped row.
- `rank`: display the minimum non-null rank, with a grouped badge if raw rows
  disagree.
- `sector`, `industry`, `holding_market`, `holding_country`, `currency`, and
  `security_type`: display the value only when all raw rows agree; otherwise
  display `mixed`.
- `source`: display a single source only when all raw rows agree; otherwise
  display `multiple sources`.

These rules are display-only. They do not change stored data.

## Constraints Not Approved

Do not add these yet:

- unique constraint on ETF holding identity
- cleanup or deletion of duplicate `etf_holdings` rows
- backfill that rewrites `legacy_etf_id`, `etf_ticker`, or `etf_name`
- required FK constraint on `etf_holdings.etf_master_id`
- ETF lookthrough exposure calculation in the portfolio dashboard
- recommendation, diversification, or risk scoring based on ETF holdings

## Next Safe Step

Before building ETF UI, add a read-only query helper that implements option D
for one selected ETF/date and returns both grouped rows and raw row counts.
Keep it server-side and read-only.
