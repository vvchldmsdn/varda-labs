# Simulation Period Request Resolver Phase 0C Contract

Last updated: 2026-07-12

Status: pure resolver and synthetic fixtures implemented. No database adapter,
route, UI, provider call, persistence, scenario selection, vector approval,
matrix calculation, bootstrap execution, recommendation, or optimization is
enabled.

## Purpose

Phase 0C converts one user-readable period request into the exact service-date
axis required by Phase 0B:

```text
exact candidate identities
exact end service date
N requested return steps
```

Exactly `N + 1` service-date points are required. The resolver never returns a
shorter axis as a successful request.

V1 intentionally supports only `endServiceDate + returnStepCount`. A start/end
mode and an on-or-before endpoint convenience mode require separate policies.

## Axis Policy

The axis is the sorted union of:

- each candidate's valid adjusted-close observation date mapped to KST service
  date `D + 1`;
- valid USD/KRW observation dates mapped the same way when any candidate is
  USD-denominated.

This preserves:

- Korean and US market holiday differences;
- one market moving while another market carries;
- USD FX-only return dates.

The resolver forbids:

- calendar-day enumeration;
- complete-history intersection across candidates;
- date creation from carry rules;
- dropping a candidate with missing evidence;
- automatic endpoint rollback;
- hidden fixed 90/120/252-day defaults.

Price and FX carry are applied only later by
`simulation_return_matrix_v1`. They do not create Phase 0C axis points.

## Exact Endpoint

`endServiceDate` must be a valid ISO date and must exist exactly in the union
axis. When it is absent:

- status is `blocked`;
- `resolvedServiceDates` is empty;
- `resolvedEndServiceDate` is null;
- reason is `end_service_date_not_observed`;
- the nearest prior observed service date is returned as reference only.

The nearest prior date is never substituted automatically.

## Source Validation

Only candidate-keyed price rows on or before the requested endpoint are
considered. External price rows are ignored. Future price and FX observations
are ignored before value/status validation and cannot affect the axis.

Relevant in-window evidence fails closed for:

- invalid source date;
- raw-close field presence;
- non-positive or non-finite adjusted close;
- duplicate instrument/date price rows;
- invalid FX date, status, or value;
- duplicate FX date rows.

Duplicate groups are never resolved by input order, latest timestamp, source
preference, or equal-value deduplication.

## Result Semantics

The output contains only:

- request and required point count;
- endpoint resolution and nearest-prior reference;
- exact resolved service dates when available;
- candidate identity, display label, and observation availability counts;
- aggregate price/FX/union axis-source counts;
- stable issues with `blocked` or `incomplete` severity;
- status and Phase 0B handoff status.

It does not return prices, FX values, returns, weights, quantities, ids,
provider metadata, or the full available date axis.

### `ready`

- request and candidate universe are valid;
- source evidence is unambiguous;
- exact endpoint exists;
- exactly `N + 1` points can be selected;
- every candidate has at least one price observation;
- required FX has at least one observation.

### `incomplete`

- no hard blocker exists;
- a candidate or required FX has no observation, or fewer than `N + 1` union
  points exist.

When the exact axis is still resolvable despite a missing candidate/FX source,
`phase0BStatus=eligible_for_evidence_review`. Phase 0B then preserves and
reports the actual missing/carry coverage instead of Phase 0C hiding it.

When there are too few axis points, `resolvedServiceDates` stays empty and
Phase 0B handoff is blocked.

### `blocked`

- request, candidate identity, endpoint, or source evidence is malformed or
  ambiguous;
- `resolvedServiceDates` is empty and the endpoint remains unresolved even when
  a tentative union axis could otherwise be assembled;
- no Phase 0B handoff is allowed.

## Explicit Non-Scope

Phase 0C does not authorize:

- choosing an actual candidate universe, endpoint, or step count;
- current holdings, ISA `isa-v1`, target, or equal-weight inference;
- a production DB read adapter or preflight page;
- scenario id/version or integer weight vector;
- `scenarioUniverseHash`, `matrixRequestHash`, `inputMatrixHash`, or
  `drawPlanHash` creation;
- Scenario Vector Resolver, Phase 1C NAV aggregation, fan charts, percentiles,
  drawdown, or optimizer work.

## Next Gate

The next safe slice is a server-only, read-only preflight adapter that loads
only the candidate identities' adjusted-close rows and required FX rows for a
bounded historical scan, invokes this resolver, and passes an exactly resolved
axis to Phase 0B. Its query bound and user-review DTO must be reviewed before
adding a route or UI.
