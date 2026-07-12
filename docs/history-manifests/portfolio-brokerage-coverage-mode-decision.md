# Portfolio Brokerage History Coverage Mode Decision Packet

Recorded: 2026-07-12

Status: `docs_only_review_packet_no_mode_decision`

This packet compares the available History coverage modes for the
`portfolio/brokerage` lane. It does not select or approve a new mode, change
the approved observed-only candidate, establish runtime trust, or authorize a
resolver or product integration.

## Current Reviewed State

The exact observed-only candidate was approved at:

```text
689abe0fb69e04a562843b7eb69de65668723490
```

Its pure validator was implemented at:

```text
4645592feaf89d5051f10eb0f255983525660813
```

The validator close-out review packet was recorded at:

```text
58a78c0ffa5107de13843a6ab70d3759944013f7
```

The approved candidate identity remains:

```text
manifestVersion: portfolio-brokerage-observed-v1
sourceAuthority: stored_daily_portfolio_snapshots_display_evidence_v1
lane: portfolio
account: brokerage
mode: observed_only
```

The validator still returns `runtimeTrustStatus=not_established`. None of the
commit references above is a runtime trust source.

## Observed Evidence Snapshot

The read-only review attached to the candidate found 27 stored brokerage rows
on 27 distinct dates:

| Stored source | Rows | Distinct dates | First observed date | Last observed date |
| --- | ---: | ---: | --- | --- |
| `base44_import` | 23 | 23 | 2026-05-20 | 2026-07-05 |
| `varda_manual_daily_snapshot` | 4 | 4 | 2026-07-06 | 2026-07-09 |

At that evidence snapshot there were no null `total_market_value` rows and no
same-account/date cross-source duplicate groups. The source ranges did not
overlap.

These facts establish only which rows were observed. They do not establish:

- the brokerage account's inception date;
- an expected daily, market-day, or service-day cadence;
- whether any unobserved date is missing or intentionally absent;
- a coverage denominator or percentage;
- authority to repair, interpolate, or fetch any date.

The source transition cannot be promoted into a schedule rule.

## Mode Comparison

| Mode | Date authority | Stored-row UX | Missing and coverage UX | Current readiness |
| --- | --- | --- | --- | --- |
| `observed_only` | No required-date authority or denominator; stored dates are observation timestamps only | Show each valid stored row with its date and source provenance | Missing dates are not asserted; count and percentage are `not_applicable` | Honest current mode |
| `explicit_date_list` | Separately reviewed exact date list inside approved bounds | Show observed rows; keep out-of-list rows visible as outside-manifest evidence | A required date can be classified only relative to the exact approved list | Not ready: no exact list or bounds approved |
| `declared_service_schedule` | Versioned service-date policy plus approved bounds and exceptions | Show observed rows; keep skipped or out-of-bounds rows visible as outside-manifest evidence | A required date can be classified only after applying the exact approved policy and skip dates | Not ready: no policy, bounds, or skips approved |

No mode may hide malformed, duplicate, ambiguous, or out-of-manifest stored
evidence. Excluding a row from a denominator does not make its evidence valid.

## Option A: Continue `observed_only`

Permitted meaning:

- render valid stored brokerage observations;
- preserve each stored date and source provenance;
- render an empty observed result as empty, not as 0% coverage;
- make no missing-date, continuity, or completeness claim.

Required fields remain limited to the five approved identity fields, with
optional non-authoritative `validationEvidence`. Coverage bounds, required
dates, schedule policy, skip dates, and active components remain absent.

UX consequence: users can inspect the evidence that exists, but the product
cannot truthfully say whether an unobserved date is a gap.

## Option B: Review An `explicit_date_list`

This mode is appropriate only when a reviewer can supply an exact authoritative
list of dates that should exist. A future candidate would need:

- a new `manifestVersion` and reviewed `sourceAuthority`;
- `lane=portfolio` and `account=brokerage`;
- `mode=explicit_date_list`;
- inclusive `coverageStartDate` and `coverageEndDate`;
- unique, valid, sorted `explicitDates` inside those bounds.

It must not include `serviceDatePolicyVersion` or `approvedSkipDates`. Omitted
dates are outside the exact denominator, so adding skip semantics would make
the date authority ambiguous. `activeComponentsByDate` also remains absent for
this named brokerage manifest.

UX consequence after separate manifest, validator, resolver, and integration
approvals: the product could identify required dates as satisfied, missing,
ambiguous, or invalid and report count-based coverage against that exact list.

No exact dates or bounds are proposed or approved by this packet.

## Option C: Review A `declared_service_schedule`

This mode is appropriate only when a stable operational schedule can be named,
versioned, and reviewed independently of the rows that happen to exist. A
future candidate would need:

- a new `manifestVersion` and reviewed `sourceAuthority`;
- `lane=portfolio` and `account=brokerage`;
- `mode=declared_service_schedule`;
- inclusive `coverageStartDate` and `coverageEndDate`;
- an exact `serviceDatePolicyVersion`;
- any `approvedSkipDates`, each with a stable reason and verified membership
  in the generated schedule.

It must not include `explicitDates`.

`activeComponentsByDate` is not applicable to this named brokerage manifest
and must remain absent. That field is relevant only to a future `account=all`
manifest where date-specific component authority is needed.

UX consequence after separate policy, manifest, validator, resolver, and
integration approvals: the product could explain expected dates and reviewed
exceptions and calculate count-based coverage against the resolved schedule.

No schedule policy, bounds, inception date, or skip date is proposed or
approved by this packet.

## Consumer Eligibility Matrix

| Consumer behavior | `observed_only` | `explicit_date_list` | `declared_service_schedule` |
| --- | --- | --- | --- |
| Display valid stored observations | Allowed | Allowed | Allowed |
| Show an unobserved date as missing | Not applicable | Only after separately approved ready resolver output | Only after separately approved ready resolver output |
| Show count-based coverage | `not_applicable` | Only against exact resolved dates | Only against exact resolved schedule dates |
| Use evidence in financial calculations | No new eligibility from mode alone | Fail closed until every required item is calculation-eligible | Fail closed until every required item is calculation-eligible |
| Use display-only estimates in calculations | Forbidden | Forbidden | Forbidden |

For calculation consumers, observed and provider-backfilled source evidence are
eligible by default under the existing evidence contract. A reconstruction
requires an exact consumer-specific method approval. Display estimates,
missing evidence, ambiguous evidence, and invalid evidence remain ineligible.

A future date-axis resolver answers which dates are required. It does not make
the evidence on those dates calculation-eligible and does not calculate
financial values.

## Missing-Evidence UX Principle

The product should preserve useful observed history even when completeness is
not established. It should not silently fill financial evidence with zero,
adjacent-date averages, current values, or unreviewed interpolation.

If a later approved date axis identifies a gap, the resolution order remains:

1. verify that the date is actually required;
2. seek exact provider source evidence through a separately approved repair
   workflow;
3. consider a versioned reconstruction only for an explicitly approved
   consumer;
4. use an estimate only for visibly labelled display continuity;
5. otherwise keep the gap visible while rendering known observations.

This packet does not authorize any step in that workflow.

## Current Review Recommendation

Continue `portfolio/brokerage` as `observed_only` for now.

This recommendation is based on the absence of reviewed date authority, not on
an assumption that the stored evidence is complete. The imported and manually
generated ranges are useful observations but cannot prove account inception,
cadence, required dates, or approved exceptions.

This is a review recommendation only. It is not a new mode approval and does
not establish runtime trust for the existing observed-only fixture.

## Decision Gate

Moving away from `observed_only` requires a new exact review candidate and
explicit approval of its date authority and mode-specific fields. A future
approval must choose one denominator model; it must not combine an explicit
list with schedule-generated dates or infer either from stored rows.

Any validator expansion, resolver, persistence, coverage calculation,
missing-date output, query/page/UI integration, provider or write workflow,
authentication, RLS, or Cron change remains a separate approval gate.
