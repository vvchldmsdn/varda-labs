# Decision-Support Feature Contracts

Last updated: 2026-07-11

This document defines the intended product behavior for Additional
Contribution, Investment Lab, and Simulation Validation before their remaining
varda-labs implementation. It is based on read-only inspection of gyeol-fin,
but legacy behavior is not a parity requirement.

No UI, route, provider call, database write, schema change, recommendation, or
simulation job is approved by this document.

## Shared Principles

- Start with the user question, then choose the model. Do not expose a model
  merely because the legacy code already exists.
- Separate observed data, assumptions, deterministic calculations, stochastic
  calculations, and presentation.
- Use `(market, currency, ticker)` as instrument identity.
- Use adjusted historical prices and date-specific FX without look-ahead.
- Preserve full precision in calculations and round only for presentation.
- Expose missing evidence and model uncertainty instead of manufacturing a
  complete-looking result.
- Keep strategy design, simulation, validation, and execution as separate
  commands and artifacts.

## Additional Contribution

### Question it should answer

> Given an explicit amount of new investable KRW, where can it be allocated
> among the selected account's eligible existing holdings to move the portfolio
> toward its strategic target while respecting explicit tactical guardrails?

This is a constrained allocation calculator. It is not a market forecast, an
LLM recommendation, or an automatic sell-and-rebalance command.

The executable Phase 1 details live in
`docs/additional-contribution-phase1-contract.md`.

The optional MA120 evidence-only Phase 2A boundary lives in
`docs/additional-contribution-ma120-phase2a-contract.md`. It does not alter the
Phase 1 allocation.

### Canonical v1 behavior

1. Read current holdings, live/as-of prices, date-specific FX, and strategic
   target policy.
2. Calculate target value after adding the new cash.
3. Calculate each eligible holding's positive target deficit.
4. Allocate integer KRW in proportion to positive post-top-up deficits, capped
   so no holding receives more than its deficit.
5. Apply optional tactical overlays as separately reported constraints or
   multipliers. They must not rewrite strategic targets.
6. Convert KRW allocations to executable units using market lot and fractional
   rules, then report residual cash explicitly.
7. Show before/after weights plus a decomposition of strategic allocation,
   tactical adjustment, rounding, and residual cash.

Default v1 must not sell existing holdings. A trim/rebalance command is a
separate opt-in operation with a separate authorization and preview.

### MA120 decision

Reducing a buy below MA120 is a momentum/trend-following policy, not a universal
financial truth. It can avoid adding during a falling trend, but it can also
delay buying an underweight asset at a lower price.

Therefore MA120 must be:

- optional and user-visible;
- derived point-in-time from `asset_price_snapshots`, not canonical state on an
  `assets` row;
- evaluated only from information available at the calculation date;
- bounded so it cannot silently eliminate the strategic allocation;
- validated later in Simulation Validation against an identical no-overlay
  baseline.

### Legacy assessment

Useful legacy ideas:

- target-deficit calculation;
- allocation capped by each deficit;
- explicit residual cash;
- risk and FX evidence shown separately.

Do not port these legacy behaviors:

- synchronizing providers inside the calculation command;
- treating stored `asset.ma_120` as canonical history;
- automatic profitable-asset trimming inside an additional-cash workflow;
- multiplying opaque FX, risk-contribution, regime, news, event, and performance
  penalties into one score;
- the ad hoc 40/25/20/10/5 top-up score and minimum-deployment correction that
  can partly undo earlier penalties;
- LLM text generation or recommendation persistence as part of the allocator.

## Investment Lab

### Question it should answer

> If the same dated KRW buy and sell notionals had crossed the invested-position
> boundary, how would the observed valuation path differ under another fixed
> portfolio composition?

The first fixed scenario is all KODEX 200. The canonical details live in
`docs/investment-lab-historical-counterfactual-contract.md`.

### Legacy assessment

The main legacy implementations do not answer the question reliably:

- current holdings are backcast as if they existed throughout history;
- some hypothetical paths receive only initial funding and ignore later
  transactions;
- synthetic paths can be stitched to actual continuation;
- historical optimization can use the same full window for selection and
  evaluation;
- one path uses a fixed FX fallback.

The varda replacement uses observed actual snapshots, explicit boundary-flow
classification, adjusted closes, date-specific FX, bounded pending execution,
and fail-closed long-only solvency.

## Simulation Validation

### Question it should answer

> What plausible future paths can this portfolio take, what do their outcome
> ranges look like, and can a constrained alternative allocation improve a
> clearly chosen objective without hiding downside or model uncertainty?

The first product experience should preserve the original exploratory intent:
show a reproducible sample of Monte Carlo paths as a spaghetti chart, then the
full distribution as fan bands such as p10, p50, and p90. The chart is not only
decoration; it should help the user see path dispersion, drawdowns, loss
probability, and terminal-outcome uncertainty.

Optimization is a linked but separate decision-support layer. Quantiles alone
cannot be uniquely "reversed" into portfolio weights. Instead, the optimizer
must search candidate weights under the same simulation model using an
explicit objective and explicit constraints, then compare the candidate with
the current portfolio under identical seeds and assumptions.

Possible user-visible objectives include:

- maximize expected or median terminal wealth;
- maximize expected wealth subject to a p10 or loss-probability floor;
- improve downside utility or expected shortfall;
- reduce drawdown while preserving a minimum return target.

Every objective must also enforce concentration, turnover, FX exposure,
transaction-cost, and long-only constraints as applicable. No optimized weight
is a recommendation until walk-forward validation judges information that was
unavailable during fitting.

### Canonical subsystem split

1. **Input normalization**: aligned KRW simple-return matrix, date-specific FX,
   bounded market-calendar carries, exclusions, and provenance.
2. **Historical resampling**: stationary or variable-block bootstrap that
   samples all assets on the same historical dates and preserves serial and
   cross-asset dependence.
3. **Parametric simulation**: heavy-tailed factor/residual model with shrinkage,
   reproducible seeds, covariance diagnostics, and explicit regime assumptions.
4. **Optimizer**: optional long-only constrained candidate generator using only
   training-window data. It evaluates explicit distribution objectives rather
   than attempting to invert p10/p50/p90 directly, and includes concentration,
   turnover, FX, and transaction-cost constraints.
5. **Validator**: walk-forward scoring of interval coverage, median error,
   downside calibration, weight stability, and realized benchmark comparison.
6. **Artifact layer**: server-owned idempotent jobs, small relational summaries,
   and external/blob storage for dense paths and large sample matrices.

Bootstrap and factor Monte Carlo are complementary model views. Neither is the
single true forecast. Their disagreement is useful model-risk evidence.

### Legacy assessment

The newer gyeol-fin simulation design contains sound ideas worth reusing:

- contiguous 5-20 day resampling blocks;
- same-date cross-asset sampling;
- KRW-normalized foreign-asset returns;
- Student-t factor shocks, EWMA covariance, off-diagonal shrinkage, residual
  covariance, and seeded reproducibility;
- loss probability, expected shortfall, drawdown, and fan-chart summaries;
- constrained long-only optimization with turnover and transaction costs;
- point-in-time walk-forward validation of forecast-band coverage and weight
  stability.

The following still require replacement or proof before migration:

- browser-orchestrated multi-step job mutation;
- silent covariance fallback or hard-coded regime parameters without surfaced
  diagnostics;
- the old full-window grid optimizer used for max return, max Sharpe, minimum
  volatility, or minimum drawdown;
- fixed FX fallback values and ticker-only identity;
- any optimizer/validator path not proven to restrict every input to its
  historical as-of date;
- calling optimized weights a recommendation before out-of-sample evidence is
  sufficient.

### Optimization policy

- Always show the current portfolio as the baseline under the same samples,
  seed, horizon, and model assumptions as an optimized candidate.
- Treat sampled spaghetti paths and p10/p50/p90 bands as distribution evidence,
  not promises or direct optimizer inputs with a unique inverse.
- Maximum Sharpe is unstable because expected return estimates dominate the
  answer. Use shrinkage, turnover limits, and walk-forward validation.
- Minimum variance and related quadratic objectives should use an established
  constrained optimizer rather than a coarse exhaustive grid.
- Minimum drawdown is path-dependent and non-convex. A heuristic result must be
  reproducible and validated out of sample; it is not a guaranteed optimum.
- Reverse optimization must state its implied assumptions and constraints. It
  must not infer a user's desired return from future outcomes.

## Implementation Order

1. Investment Lab aggregate deterministic path fixture (completed 2026-07-11).
2. Additional Contribution explicit-target strategic allocator fixtures
   (completed 2026-07-11), without tactical overlays or sells.
3. Target Policy Evidence Audit Phase 0 (completed 2026-07-11): raw evidence
   remains unresolved and no target vector or resolver is approved.
4. Target Policy Gate A model approved 2026-07-11; account vectors remain
   separately gated.
5. Gate B0 review-packet validation and deterministic vector hashing completed;
   the helper remains pure and externally unapproved by design.
6. ISA `isa-v1` Gate B packet approved 2026-07-11 with full vector,
   `universeHash`, and `vectorHash`; brokerage and IRP remain unapproved.
7. Pure ISA resolver validation completed 2026-07-11 without persistence or
   allocator connection.
8. MA120 evidence-only/no-overlay validation completed 2026-07-11; multiplier,
   buy blocking, and redistribution policy remain unapproved.
9. Build the Simulation Validation normalized return-matrix contract.
10. Add bootstrap and parametric engines as pure seeded helpers.
11. Add walk-forward validation before any optimizer is labeled useful.
12. Design user-owned job/artifact persistence only after auth and ownership
   gates permit writes.
