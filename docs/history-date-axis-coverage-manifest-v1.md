# History Date-Axis and Coverage Manifest Contract V1

Last updated: 2026-07-12

Status: docs-only contract. No manifest resolver, stored manifest, date
generation, coverage calculation, History UI integration, provider call, or
write path is enabled.

## Purpose

History coverage cannot be inferred from rows that happen to exist. That would
make a fully missing date invisible. It also cannot be inferred from every
calendar day because balance evidence may be sparse and portfolio snapshot
cadence, account inception, and approved exceptions are not yet canonical.

This contract defines the reviewed manifest that a future resolver must require
before it can produce exact date requirements for the History evidence mapping
adapter.

## Lane Independence

Balance and portfolio manifests are separate authorities. They never share:

- a date axis;
- a coverage start or end;
- a denominator;
- a schedule policy;
- an exception list;
- an active component set.

The existence of a balance row does not create a portfolio requirement, and
the existence of a portfolio row does not create a balance requirement.

## Manifest Shape

The conceptual V1 shape is:

```text
manifestVersion
sourceAuthority
validationEvidence
lane: balance | portfolio
account: brokerage | isa | irp | all
mode: observed_only | explicit_date_list | declared_service_schedule
coverageStartDate
coverageEndDate
explicitDates
serviceDatePolicyVersion
activeComponentsByDate
approvedSkipDates
```

This is a semantic contract, not a database or API schema.

### `manifestVersion`

A stable version for the full manifest. Any change to dates, bounds, component
periods, schedule policy, or exceptions requires a new version. V1 does not
define or issue a manifest hash.

### `sourceAuthority`

The reviewed authority that supplied the manifest. Existing History rows,
`created_at`, Base44 creation timestamps, the first observed snapshot, current
holdings, or account labels are not authority for coverage inception.

Until a durable source exists, the only honest candidate is an explicitly
reviewed manual manifest. This document does not approve an actual manifest.

### `validationEvidence`

Non-authoritative references used to review the candidate, such as a dated
read-only row-count, duplicate, or null-value audit. Validation evidence does
not define which rows are display evidence and does not become cadence,
inception, schedule, or coverage authority.

This field is provenance for review and is not one of the five manifest
identity fields. Changing the source authority requires a new candidate;
refreshing a read-only validation reference does not silently approve that
candidate.

### `coverageStartDate` and `coverageEndDate`

Inclusive bounds for `explicit_date_list` and
`declared_service_schedule`. Both are absent in `observed_only`, because that
mode has no denominator.

An account must not be counted as missing before a reviewed coverage start.

### `activeComponentsByDate`

The gyeol-fin proposal called this `activeAccountsByDate`, but account names
alone cannot describe the balance `all` view because cash is a separate stored
component. V1 therefore uses non-overlapping effective-date component ranges:

```text
- effectiveFrom: YYYY-MM-DD
  effectiveTo: YYYY-MM-DD | null
  components: [...]
```

Allowed components are lane-specific:

- balance `all`: `cash`, `brokerage`, `isa`, `irp`
- portfolio `all`: `brokerage`, `isa`, `irp`

For a named account manifest this field is absent. For an `all` manifest in a
mode with a denominator, every required date must resolve to exactly one
active component range. Ranges must not overlap.

A stored `all` row remains preferred observed evidence. Component membership
is used only when a stored `all` row is absent and a display-only reconstruction
is considered. Reconstruction requires exactly one valid row for every active
component on that date and no extra component is silently substituted.

## Mode Semantics

### `observed_only`

- Display stored observed rows.
- Do not create required dates.
- Do not report missing dates.
- Coverage count and percentage are `not_applicable`, not zero or 100%.
- `coverageStartDate`, `coverageEndDate`, `explicitDates`,
  `serviceDatePolicyVersion`, and `approvedSkipDates` are absent.
- No derived `all` coverage claim is made from an assumed permanent component
  set.

This is the only honest current default for a lane/account without an approved
manifest.

### `explicit_date_list`

- `explicitDates` is the exact reviewed denominator.
- Dates are unique, valid, sorted, and inside the inclusive coverage bounds.
- The resolver does not add calendar days, market days, or stored row dates.
- `serviceDatePolicyVersion` is absent.
- `approvedSkipDates` is absent because omitted dates are already outside the
  exact list; combining both mechanisms would make the denominator ambiguous.

### `declared_service_schedule`

- Inclusive coverage bounds are required.
- An exact reviewed `serviceDatePolicyVersion` is required.
- The versioned schedule produces candidate required dates.
- `approvedSkipDates` removes reviewed exceptions from that candidate set.
- No adaptive fallback, nearest-date substitution, or stored-row-driven
  expansion is allowed.
- `explicitDates` is absent.

The current snapshot-cycle helpers do not by themselves constitute an approved
historical schedule enumerator.

## Approved Skip Dates

Each schedule exception needs an exact date and a stable reason code. Skip dates
must be unique, inside the coverage bounds, and present in the schedule before
subtraction.

A stored row on a skip date remains observed evidence but is outside the
coverage denominator. It is not deleted or converted into a requirement.

## Stored Rows Outside the Manifest

Stored rows outside bounds, outside an explicit list, or on an approved skip
date remain visible as observed evidence with `coverageScope=outside_manifest`.
They do not increase the denominator or the satisfied requirement count.

Duplicate or malformed stored evidence remains ambiguous or invalid even when
outside the denominator. Excluding a row from coverage does not make its source
quality clean.

## Future Resolver Output

A future pure resolver may return only:

```text
status: observed_only | ready | blocked
manifestVersion
lane
account
mode
requiredDates
approvedSkipDates
activeComponentsByRequiredDate
outOfManifestStoredDates
issues
```

It must not return or calculate financial values. `requiredDates` may be passed
to the existing History evidence mapping adapter only when status is `ready`.
In `observed_only`, that adapter's coverage mode is not invoked.

## Validation Rules

A future resolver must fail closed for:

- malformed or duplicate dates;
- start date after end date;
- mode-incompatible fields;
- an unknown source authority or manifest version;
- missing or unknown service-date policy version;
- overlapping or uncovered active-component ranges;
- components not allowed for the lane;
- an `all` manifest without date-specific component authority;
- skip dates outside bounds or outside the generated schedule;
- attempts to infer inception or cadence from stored rows.

It must preserve, not silently remove, a stored row that is outside manifest
scope.

## Required Fixtures Before Implementation

- different coverage start dates for brokerage, ISA, and IRP;
- an active component set change inside one coverage window;
- balance `all` with cash as an explicit component;
- an approved schedule skip date;
- a stored row outside the manifest;
- a stored row on a skip date;
- stored `all` priority;
- complete component reconstruction;
- partial component evidence remaining missing;
- duplicate component evidence remaining ambiguous;
- explicit-list and schedule field collisions;
- `observed_only` producing no denominator or missing-date claim.

## Explicit Non-Scope

This contract does not add or change:

- a manifest instance, approval, hash, table, migration, or seed;
- a resolver or schedule generator;
- History query, read model, route, component, label, or search parameter;
- current stored rows or the existing display calculations;
- provider backfill, retry, reconstruction, or interpolation;
- value-weighted coverage;
- snapshot jobs, Cron, auth, ownership, or RLS.

## Next Gate

The first review candidate is documented at
`history-manifests/portfolio-brokerage-observed-v1.review.md`. It is
`observed_only` and makes no missing-date or coverage claim. It remains
unapproved.

The exact observed-only candidate was approved at artifact commit
`689abe0fb69e04a562843b7eb69de65668723490`. The pure validator is documented
in `history-manifest-validator-v1.md`. Its result does not establish runtime
trust.

Any resolver or `/history` integration remains a separate approval gate. An
explicit portfolio schedule must not be inferred from the four recent
generated snapshots or imported legacy history.
