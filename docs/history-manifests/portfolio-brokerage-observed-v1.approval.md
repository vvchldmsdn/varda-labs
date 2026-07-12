# Portfolio Brokerage Observed-Only Manifest Approval Record

Recorded: 2026-07-12

Approved artifact commit:

```text
689abe0fb69e04a562843b7eb69de65668723490
```

Approved candidate:

```text
manifestVersion: portfolio-brokerage-observed-v1
sourceAuthority: stored_daily_portfolio_snapshots_display_evidence_v1
lane: portfolio
account: brokerage
mode: observed_only
```

Approved use:

- stored snapshot rows as observed display evidence only;
- pure manifest validator and fixture implementation only.

Explicitly not approved:

- coverage start or end;
- required dates or missing-date calculation;
- snapshot cadence or account-inception inference;
- active components or derived `all`;
- reconstruction, provider backfill, or interpolation;
- database persistence or runtime resolver;
- query, page, or UI integration;
- authentication, RLS, write, job, or Cron changes.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
