# History Coverage Manifest Pure Validator V1

Last updated: 2026-07-12

Status: pure shape and supported-fixture validator implemented. No runtime
manifest trust, resolver, date generation, History query/UI integration,
provider call, or write path is enabled.

## Approved Implementation Scope

The user approved the review candidate at artifact commit:

```text
689abe0fb69e04a562843b7eb69de65668723490
```

The approval permits only a pure validator and fixture for:

```text
manifestVersion: portfolio-brokerage-observed-v1
sourceAuthority: stored_daily_portfolio_snapshots_display_evidence_v1
lane: portfolio
account: brokerage
mode: observed_only
```

The approval record is stored separately under `docs/history-manifests`. The
validator does not read Markdown, parse Git history, or treat the approval
record as runtime trust.

## Validator Result

The validator separates:

- `shapeStatus`: whether the input follows the implemented observed-only
  field contract;
- `supportStatus`: whether the five identity fields exactly match the one
  supported fixture;
- `runtimeTrustStatus`: always `not_established` in V1.

Only a shape-valid exact fixture returns `valid_supported_fixture`. That status
does not authorize any runtime use.

## Observed-Only Field Boundary

The following fields are forbidden by presence, even when their value is null,
empty, or undefined:

- `coverageStartDate`
- `coverageEndDate`
- `explicitDates`
- `serviceDatePolicyVersion`
- `activeComponentsByDate`
- `approvedSkipDates`
- `requiredDates`

Unknown fields are blocked without reflecting their names or values.

`validationEvidence` is optional review provenance. When present it must be an
array of unique supported references. It is sorted for deterministic output and
does not affect the five-field candidate identity.

## Later Modes

`explicit_date_list` and `declared_service_schedule` are recognized contract
names but return `mode_not_implemented`. No dates, bounds, schedules,
components, or skip dates are resolved in V1.

## Explicit Non-Scope

V1 does not:

- create runtime approval or trust from a Markdown record or commit hash;
- read a database, provider, file, environment variable, or request;
- persist a manifest or add schema;
- enumerate required dates or calculate missing dates or coverage;
- reconstruct `all` rows;
- change `/history`, another page, API, query, component, or search param;
- change auth, ownership, RLS, job, write, or Cron behavior.

## Next Gate

Any resolver or `/history` integration needs a separate approval. A pure
validator result alone is not sufficient authority to begin either step.
