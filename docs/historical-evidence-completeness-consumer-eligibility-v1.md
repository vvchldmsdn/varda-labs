# Historical Evidence Completeness and Consumer Eligibility Contract V1

Last updated: 2026-07-12

Status: contract and pure classifier implemented. No database write, provider
call, route, UI workflow, interpolation engine, or production integration is
enabled by this phase.

## Purpose

An isolated missing historical value must not make an otherwise useful product
surface disappear. It must also not be silently replaced with a value that can
change financial calculations.

This contract separates:

1. source evidence obtained from a canonical store or provider;
2. derived evidence reconstructed from other records;
3. display-only estimates used to keep a chart readable;
4. unresolved gaps that remain visible to the user.

The contract classifies evidence metadata only. It does not calculate or store
prices, FX rates, portfolio values, returns, or interpolated values.

## Evidence Taxonomy

| Evidence kind | Meaning | Display surfaces | Calculation consumers |
| --- | --- | --- | --- |
| `observed` | Existing canonical source observation | Allowed | Allowed |
| `provider_backfilled` | Newly fetched provider observation stored with provenance | Allowed with source/freshness | Allowed |
| `reconstructed` | Derived from positions, events, historical prices, FX, or another reviewed method | Allowed with method disclosure | Blocked unless the exact method version is separately approved for that consumer |
| `display_estimated` | Presentation-only carry/interpolation/estimate | Allowed with a visible estimated state | Always blocked |
| `missing` | Required evidence is absent | Render a gap and coverage | Blocked |
| `ambiguous` | More than one unresolved source interpretation exists | Render a gap and reason | Blocked |
| `invalid` | Provenance or source evidence is malformed | Render a gap and reason | Blocked |

`provider_backfilled` is source evidence. It is not the same as a
`reconstructed` value. Neither kind may overwrite an immutable imported or
previously observed raw row.

## Required Lineage

Every requirement has a stable `key`, target `asOfDate`, `evidenceKind`, and
the following lineage fields:

- `source`
- `sourceDates`
- `methodVersion`
- `reason`

Observed evidence requires a source and at least one source date.
Provider-backfilled evidence additionally requires an ingestion method
version. Reconstructed and display-estimated evidence require a source, at
least one source date, and an exact method version. Missing, ambiguous, and
invalid evidence require a reason.

V1 deliberately does not define a numeric `confidence`. A number without a
calibrated statistical model would imply precision that the system has not
established.

## Consumer Policy

Display consumers:

- `/`
- `/today`
- `/history`
- `/portfolio/structure`

Display consumers return:

- `ready` when every requirement is observed or provider-backfilled;
- `partial` when at least one row remains displayable but a reconstruction,
  estimate, or gap exists;
- `unavailable` only when no requirement can be displayed.

Calculation consumers:

- Additional Contribution
- Portfolio Risk
- Investment Lab
- Simulation Validation
- Optimizer

Calculation consumers return `ready` only when every required item is
eligible. Observed and provider-backfilled evidence are eligible by default.
Reconstructed evidence requires a consumer-specific exact method-version
approval. Display estimates, missing evidence, ambiguous evidence, and invalid
evidence are never eligible.

Approval for one calculation consumer does not authorize another consumer.

## Coverage Rules

The pure classifier reports count-based metadata:

- required count;
- consumer-eligible count;
- canonical count;
- reconstructed count;
- display-estimated count;
- disclosure-required count;
- gap count;
- canonical and consumer coverage percentages;
- gap dates, estimated dates, and reasons.

It never removes a missing requirement from the denominator and never treats a
missing value as zero. Duplicate requirement keys are invalid rather than
silently deduplicated.

Feature adapters may add a separately named value-weighted coverage measure.
They must not relabel value coverage as count coverage or use the shared
classifier to transport portfolio amounts.

## Missing-Date Resolution Order

For a missing KODEX 200 value on July 1, the intended order is:

1. confirm that July 1 is an expected observation date rather than a market
   holiday;
2. request the exact historical provider observation through a separately
   approved, idempotent backfill command;
3. if provider evidence cannot be obtained, consider a versioned
   reconstruction from positions, events, prices, and FX;
4. only for chart presentation, consider a visibly estimated value from
   adjacent dates when the display method permits it;
5. otherwise retain a visible gap and continue rendering the known range.

An average of adjacent portfolio values is not a canonical repair. Trades,
cash flows, distributions, splits, or quantity changes can make that average
incorrect. A display-only estimate must never feed return, risk, simulation,
recommendation, or optimization calculations.

Non-trading-day carry is a separate market-calendar policy and must not be
misreported as missing evidence.

## Raw and Derived Storage Boundary

This phase defines semantics, not tables. A future storage design must keep
raw/provider evidence and derived artifacts distinguishable. At minimum, a
derived artifact needs its evidence kind, source dates, method version, target
date, and reason/provenance. Display estimates must not be written into the
canonical price, FX, position, or portfolio snapshot fields.

## Repair Workflow Boundary

A future UI may explain missing dates and offer a reviewed repair action, but
this phase does not authorize that action. The future flow must be:

1. read-only availability check;
2. dry-run repair plan with exact dates, providers, and row counts;
3. explicit authorization;
4. idempotent server-side write with deduplication and rate limits;
5. recalculation against newly stored evidence.

Shared price and FX repairs should be deduplicated globally. User-specific
position or portfolio reconstruction must remain within the canonical user
ownership boundary.

## Explicit Non-Scope

V1 does not add or change:

- database schema or rows;
- provider calls or provider credentials;
- backfill, retry, job, or Cron behavior;
- routes, buttons, prompts, charts, or UI labels;
- existing History, Today Movement, Risk, Investment Lab, or Simulation logic;
- interpolation, carry, reconstruction, or valuation algorithms;
- reconstruction approvals;
- social authentication, ownership backfill, or RLS.

## Next Gate

The first product integration should be a read-only `/history` adapter that
maps existing evidence to this taxonomy and exposes partial coverage without
changing stored values. Provider backfill and interpolation remain separate,
later approval gates.
