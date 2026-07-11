# Simulation Portfolio Path Gate 0 Approval

Last updated: 2026-07-12

Status: approved by explicit user decision on 2026-07-12. This artifact records
policy-model approval only. It does not approve an actual scenario vector,
normalized NAV result, runtime source, UI, API, provider, job, persistence,
optimizer, recommendation, or order behavior.

## Approved Revision

| Field | Approved value |
| --- | --- |
| policy id | `gross_normalized_buy_and_hold_v1` |
| reviewed commit | `652b9ea` |
| full commit | `652b9ea9c9b48f51dc4c68e8f148132ca8893d7e` |
| approval date | `2026-07-12` |
| path origin | dimensionless `NAV[0] = 1` |
| allocation behavior | initial-weight buy-and-hold |
| rebalancing | none |
| cash row | none |
| required vector total | exactly 10,000 integer bps |

## Approved Semantics

The approval covers:

- normalized buy-and-hold portfolio paths starting at one;
- one explicit scenario vector matching each execution input matrix's exact
  canonical instrument set;
- no rebalancing and no cash instrument;
- no added investor-level trading cost, tax, or cash-yield model;
- the Phase 0A KRW-investor adjusted-close basis;
- sampled-return source dates as provenance rather than future calendar dates;
- a new vector approval when an execution matrix instrument set changes;
- reuse of an approved vector when a later execution has the same canonical
  instrument set and only its evidence binding changes.

The model does not perform an additional FX conversion. It also must not be
described as universally fee-free because validated adjusted-close evidence
retains effects already reflected in its source series.

## Explicit Exclusions

The approval does not cover:

- any actual scenario weights or `scenarioVectorHash`;
- initial KRW capital or current valuation scaling;
- automatic use of ISA `isa-v1` or any strategic target;
- current-weight, equal-weight, group-ratio, or legacy-target fallback;
- Phase 1C normalized NAV aggregation;
- fan charts, quantiles, drawdown, expected shortfall, or loss probability;
- factor Monte Carlo, optimizer, walk-forward validation, recommendation, or
  execution;
- DB, provider, API, route, UI, job, artifact persistence, schema, migration,
  or write behavior.

## Authorized Next Gate

This approval permits only the pure Simulation Scenario Vector Review Packet
Phase 0 contract and helper.

That packet must:

- accept explicit scenario identity/version, execution-matrix instrument
  identities, and integer basis-point rows;
- validate exact universe matching and an exact 10,000-bps total;
- produce order-independent canonical serialization and a scenario vector
  hash only when reviewable;
- always remain `unapproved`;
- exclude matrix and draw-plan hashes, runtime approval, persistence, and
  strategic-target inference.

The Markdown approval artifact is evidence only and must not be parsed as a
runtime store.

## Invalidation

Changing the approved policy meaning or the reviewed Gate 0 document requires
new Gate 0 approval. A new matrix with the same canonical instrument set does
not. A changed instrument set requires a new scenario vector packet and vector
approval.
