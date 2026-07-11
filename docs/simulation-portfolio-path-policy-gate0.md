# Simulation Portfolio Path Policy Gate 0

Last updated: 2026-07-12

Status: proposed and unapproved. This docs-only gate records a reviewable
portfolio-path model. It does not approve a scenario vector or authorize a
helper, runtime adapter, route, UI, database read/write, job, artifact, or
simulation result.

Proposed policy id:

```text
gross_normalized_buy_and_hold_v1
```

## Decision Question

> What portfolio meaning may combine the Phase 1B per-instrument gross growth
> factors without also choosing a KRW starting amount, execution policy, or
> distribution presentation?

Phase 1B deliberately stops before portfolio aggregation. Gate 0 defines one
possible normalized path semantics and keeps its numeric scenario vector under
a separate later approval.

## Proposed Semantics

The proposed v1 model is:

1. Every path starts at dimensionless `NAV[0] = 1`.
2. For each execution, one explicit scenario vector covers the exact canonical
   instrument set of that execution's input matrix. The Phase 1B result must
   expose the same set and order.
3. Each weight is an integer `weightBps`; the complete vector totals exactly
   `10,000` bps.
4. Portfolio NAV is calculated as:

   ```text
   NAV[path, step] =
     sum((weightBps[instrument] / 10,000)
         * grossGrowth[path, instrument, step])
   ```

5. Weights describe the initial allocation only.
6. There is no rebalancing at any sampled step.
7. Cash is not an instrument in v1. The vector represents a fully invested
   portfolio and therefore cannot total less than 10,000 bps.
8. The model adds no investor-level trading fee, tax, transaction cost, or
   cash yield.
9. It must not be described as universally "fee free." Adjusted-close returns
   retain whatever product, distribution, and market effects are already
   reflected in the validated Phase 0A source series; Gate 0 merely adds no
   separate investor-level cost model.
10. The KRW-investor return basis is inherited from Phase 0A. Gate 0 performs
    no additional FX conversion or fixed-rate substitution.
11. A sampled step represents one bootstrap-selected historical return
    interval. It is not a forecast calendar date.
12. Source service dates remain provenance only and must not be relabeled as
    future dates.

The normalized path can later be scaled for display, but no KRW amount is part
of this policy or its scenario vector. Scaling must not change path returns or
become a hidden model input.

## Scenario And Strategic Target Separation

A Simulation scenario vector is a model assumption, not an account target
policy.

- The approved ISA `isa-v1` target vector is not a Simulation scenario vector.
- No brokerage, ISA, or IRP target may be copied automatically into this
  model.
- Current holding weights, equal weights, group ratios, or raw legacy target
  fields are not fallback scenarios.
- Reusing any strategic target requires a separate, explicit Simulation
  scenario approval that shows the complete vector again.

This separation prevents Additional Contribution policy from silently changing
the meaning of a Simulation result.

## Reproducibility Binding

A future approved Phase 1C calculation must bind these three independent
hashes in its result:

1. `scenarioVectorHash` for the complete approved scenario vector;
2. `inputMatrixHash` from Phase 0A/1A;
3. `drawPlanHash` from Phase 1A.

The scenario hash proves the model assumption. The matrix and draw-plan hashes
prove the sampled evidence. None of the hashes is an authorization credential,
tenant identity, or persistence decision.

Changing any scenario identity or weight requires a new scenario version and
hash. Changing the matrix or draw plan does not mutate the scenario vector; it
creates a different execution binding.

A matrix with the same canonical instrument set may reuse an approved scenario
vector under a new execution binding. A matrix whose instrument set changes
requires a new Scenario Vector Review Packet and vector approval, but it does
not require Gate 0 model reapproval unless the policy semantics in this
document also change.

## Separate Scenario Vector Gate

Gate 0 contains no numeric vector. Only after explicit Gate 0 policy approval
may a Scenario Vector Review Packet be implemented or reviewed.

Its minimum explicit input is:

| Field | Rule |
| --- | --- |
| `scenarioId` | nonempty stable scenario identity |
| `scenarioVersion` | nonempty immutable version |
| instrument rows | exact market, currency, ticker for one reviewed execution-matrix instrument set |
| `weightBps` | integer from 0 through 10,000 for every row |
| total | exactly 10,000 bps |

The packet must reject missing, duplicate, external, or silently normalized
rows. It must remain `unapproved` until the complete visible vector and its
hash receive an explicit user decision.

Initial KRW capital, current valuation, account ownership, tenant identity,
matrix hash, and draw-plan hash are not scenario-vector approval fields. The
last two are attached only when an approved vector is executed against one
specific evidence set.

## Gate 0 Approval Boundary

Creating or editing this document does not approve the policy. Approval must
explicitly name:

- `gross_normalized_buy_and_hold_v1`;
- normalized `NAV[0] = 1`;
- initial-weight buy-and-hold with no rebalancing;
- fully invested 10,000-bps vectors with no cash row;
- no additional investor-level fee, tax, transaction-cost, or cash-yield
  model;
- strategic target and Simulation scenario separation.

An instruction to "continue migration" or "use the ISA targets" is not policy
approval.

## Not Authorized

Gate 0 does not authorize:

- a scenario vector, vector hash, or production default;
- Phase 1C NAV aggregation code;
- KRW wealth or current-portfolio adapters;
- rebalancing, cash, fee, tax, or transaction-cost variants;
- spaghetti/fan charts, terminal summaries, p10/p50/p90, drawdown, expected
  shortfall, or loss probability;
- factor Monte Carlo, optimizer, walk-forward validator, target-policy or MA120
  integration;
- DB, provider, route, UI, job, artifact persistence, schema, migration, or
  write behavior.

## Ordered Follow-On Gates

1. Explicit user approval of this Gate 0 policy model.
2. Pure Scenario Vector Review Packet that always remains unapproved.
3. Explicit approval of one complete scenario vector and hash.
4. Pure Phase 1C normalized NAV aggregation bound to the approved vector,
   matrix, and draw-plan hashes.
5. Distribution summaries only after Phase 1C is independently verified.

Each gate remains separate. Approval at one step does not imply approval of the
next.
