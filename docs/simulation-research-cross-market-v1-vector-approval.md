# Simulation Research Cross-Market V1 Vector Approval

Last updated: 2026-07-12

Status: approved by explicit user decision on 2026-07-12. This artifact records
one research scenario vector assumption only. It is not a runtime approval
store and does not authorize execution, aggregation, persistence, or product
integration.

## Approved Identity

| Field | Approved value |
| --- | --- |
| portfolio path policy | `gross_normalized_buy_and_hold_v1` |
| Gate 0 approval commit | `652b9ea9c9b48f51dc4c68e8f148132ca8893d7e` |
| scenario id | `research-kr-us-cross-market` |
| scenario version | `v1` |
| weight unit | integer basis points |
| total weight | `10,000` bps |
| scenario vector hash | `sha256:cf16d3ce3e3328cff4e55082f6442768edb38b3fe56e8c9e23f22245bb84b41b` |

## Approved Canonical Vector

| Market | Currency | Ticker | Weight |
| --- | --- | --- | ---: |
| `korea` | `KRW` | `069500` | `5,000` bps |
| `us` | `USD` | `QQQ` | `5,000` bps |

The vector covers the complete two-instrument canonical set and totals exactly
10,000 bps. Both weights are explicit user-approved research assumptions.

## Meaning Of Approval

This approval covers only the numeric model assumption represented by the
scenario identity, policy revision, canonical instrument identities, weights,
and `scenarioVectorHash` above.

The 50/50 split is not:

- an automatic equal-weight rule or product default;
- inferred from current holdings or account membership;
- copied from ISA `isa-v1` or another strategic target;
- an investment recommendation, order, rebalance, or optimizer result.

Changing the scenario id, version, policy revision, instrument identity, or any
weight requires a new packet, hash, and explicit approval.

## Evidence Separation

The production preflight's `scenarioUniverseHash` was external human-review
provenance. It was not an input to or output from the pure Scenario Vector
Review Packet and is not part of this approval identity.

`matrixRequestHash` is also excluded. The vector is a reusable research model
assumption for the same canonical instrument set; changing only the evidence
window does not mutate this vector. A later execution must bind its own matrix
and draw-plan evidence under a separately approved contract.

The pure packet helper continues to return `approvalState=unapproved` by
design. This Markdown record must not be parsed or treated as runtime
authorization.

## Explicitly Not Approved

This approval does not authorize:

- a resolver or runtime vector binding;
- Phase 1C normalized NAV aggregation;
- `inputMatrixHash` or `drawPlanHash` execution binding;
- bootstrap draw execution or portfolio-path calculation;
- initial KRW capital or current-valuation scaling;
- database persistence, schema, migration, seed, or write;
- provider, route, API, page, UI, job, Cron, or auth changes;
- target-policy linkage, recommendation, order, or rebalance behavior;
- fan charts, percentiles, drawdown, expected shortfall, Monte Carlo,
  optimization, or walk-forward validation.

## Next Gate

Any pure Phase 1C design or implementation requires a separate review and
explicit approval. That future gate must validate this vector against the exact
execution matrix instrument set and keep `scenarioVectorHash`,
`inputMatrixHash`, and `drawPlanHash` as separate evidence bindings.

This approval alone must not start that work.
