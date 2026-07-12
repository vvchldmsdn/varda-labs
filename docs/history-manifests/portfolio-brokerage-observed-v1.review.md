# Portfolio Brokerage Observed-Only Manifest Review Candidate

Last updated: 2026-07-12

Artifact status: `review_candidate_not_approved`

This document is a proposed first instance under the History Date-Axis and
Coverage Manifest Contract V1. It is not a runtime manifest, user approval,
coverage declaration, schedule, or permission to change `/history`.

## Candidate

```text
manifestVersion: portfolio-brokerage-observed-v1
sourceAuthority: stored_daily_portfolio_snapshots_read_audit_v1
lane: portfolio
account: brokerage
mode: observed_only
```

No other manifest field is present.

The following fields are deliberately absent and forbidden in this mode:

- `coverageStartDate`
- `coverageEndDate`
- `explicitDates`
- `serviceDatePolicyVersion`
- `activeComponentsByDate`
- `approvedSkipDates`
- `requiredDates`

## Source-Authority Meaning

`stored_daily_portfolio_snapshots_read_audit_v1` authorizes only a read-only
review of stored brokerage portfolio snapshot rows as display evidence.

It does not make those rows authoritative for:

- account inception;
- expected snapshot cadence;
- missing dates;
- a daily, market-day, or service-day denominator;
- coverage start or end;
- reconstruction of an `all` row;
- provider backfill or repair.

The authority name is local to this candidate. It is not an approved global
enum or database value.

## Read-Only Evidence Review

The database was read without identifiers, owner fields, or financial values.
The review selected only account, source, row/date counts, date bounds, null
value counts, and cross-source duplicate counts.

Evidence snapshot:

```text
readOnly: true
evidenceAsOf: 2026-07-12T00:47:06.560Z
account: brokerage
storedRowCount: 27
distinctStoredDateCount: 27
nullTotalMarketValueRowCount: 0
sameAccountDateCrossSourceDuplicateGroupCount: 0

source: base44_import
rowCount: 23
distinctDateCount: 23
minDate: 2026-05-20
maxDate: 2026-07-05

source: varda_manual_daily_snapshot
rowCount: 4
distinctDateCount: 4
minDate: 2026-07-06
maxDate: 2026-07-09
```

The source transition is non-overlapping. It is retained as provenance and is
not treated as proof of a continuous schedule. The 27 observed dates are not a
27-date denominator.

The repository-wide read-only data-integrity audit also reported no error-level
failure for current portfolio snapshot account references or
date/account/source duplicates at this evidence snapshot.

## Why Brokerage

Brokerage was not selected because its evidence was more complete than ISA or
IRP. The same read-only aggregate check found all three named accounts had:

- 23 imported rows and dates from 2026-05-20 through 2026-07-05;
- 4 generated rows and dates from 2026-07-06 through 2026-07-09;
- no null `total_market_value` rows;
- no same account/date cross-source duplicate groups.

There was no evidence-based ranking among the three accounts. Brokerage is the
first deterministic review candidate because the coordination decision named
it, not because the system inferred a preferred account.

## Permitted Interpretation

If separately approved, this candidate would mean only:

- stored brokerage portfolio rows may remain visible as observed evidence;
- each row keeps its stored `snapshotDate` and source provenance;
- no coverage percentage or missing-date claim is emitted;
- no active component declaration is required or allowed;
- rows are not converted into required dates.

An empty stored result would be an empty observed view, not 0% coverage.

## Explicit Non-Scope

This candidate does not approve or implement:

- a manifest table, schema, hash, seed, or write;
- a pure validator or resolver;
- a required-date axis or schedule generator;
- History query, page, table, label, or search-param changes;
- missing-date, count-coverage, or value-coverage UI;
- all-account reconstruction;
- provider calls, repair, interpolation, jobs, or Cron;
- authentication, ownership, or RLS changes.

## Review Gate

Before this candidate can become an approved fixture for a pure validator, a
reviewer must explicitly approve all five exact identity fields:

```text
manifestVersion
sourceAuthority
lane
account
mode
```

Approval must not be inferred from the stored row count or from continued
development. Any semantic field change creates a new review candidate.
