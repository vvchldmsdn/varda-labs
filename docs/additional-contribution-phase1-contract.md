# Additional Contribution Phase 1 Contract

Last updated: 2026-07-11

Status: pure explicit-target strategic top-up allocator. No target resolver,
provider call, database read/write, route, UI, order sizing, recommendation, or
sell action is approved by this contract.

## Product Question

> Given a named account, an explicit strategic target vector, and an integer
> KRW cash amount, how should the new cash be divided among current holdings to
> reduce post-top-up target deficits without crossing any target cap?

This is a deterministic budget calculator. It does not decide the target
policy, forecast returns, or recommend trades.

## Required Input Boundary

- account must be exactly `brokerage`, `isa`, or `irp`;
- `all` is blocked because it does not identify the account in which cash can
  be deployed;
- the caller supplies a nonempty `targetPolicyVersion` and an explicit target
  weight for every row in the valuation universe;
- target weights are integer basis points and must total exactly 10,000;
- current values are already normalized to KRW by an upstream read model;
- calculation identity is `(market, currency, ticker)`, normalized as lower,
  upper, upper respectively;
- the new cash amount is a positive safe integer KRW value;
- buyability is explicit evidence, not inferred from prices or providers.

The helper must not read raw asset, group, or member targets. A future
`TargetPolicyResolver` must turn reviewed raw evidence into this explicit input
under a separate contract.

## Calculation

For each holding `i`:

```text
postTopupTotal = currentPortfolioTotal + cashAmount
targetValue_i = targetWeightBps_i / 10,000 * postTopupTotal
cap_i = max(0, targetValue_i - currentValue_i)
scale = min(1, cashAmount / sum(cap_i))
idealAllocation_i = cap_i * scale
```

Only buyable holdings with a positive cap participate. A non-buyable or
unidentified holding blocks the calculation only when it has a positive
post-top-up deficit. An already-at/above-target non-buyable holding requires no
budget in this calculation and remains visible as excluded evidence.

## Integer KRW Rounding

1. Floor every ideal allocation to integer KRW.
2. Rank remaining fractional remainders descending.
3. Break equal remainders by normalized `(market, currency, ticker)`.
4. Add at most one KRW to a row only if doing so does not cross its cap.
5. Preserve any unassignable KRW as explicit residual cash.

With a complete 10,000-bps target vector over the entire current valuation
universe, `sum(positive caps) >= cashAmount` by construction. Therefore the
legacy-style branch where cash exceeds every strategic deficit is not a normal
v1 state. Residual cash can still occur when integer one-KRW allocation would
cross every remaining fractional cap. Future separate hard limits may create
other residual reasons.

## Output Invariants

- every allocation is a nonnegative safe integer KRW value;
- `sum(allocations) + residualCash = cashAmount` exactly;
- `currentValue_i + allocation_i <= targetValue_i` within numeric tolerance;
- target-zero and already-overweight holdings receive zero;
- USD and other supported foreign holdings still receive KRW budgets only;
- no price, FX rate, quantity, provider metadata, UUID, or legacy ID is output;
- blockers return no partial allocation plan.

## Fail-Closed Conditions

- unsupported account, including `all`;
- missing or malformed policy version;
- zero, negative, non-integer, or unsafe cash amount;
- empty valuation universe;
- negative or non-finite current value;
- non-integer/out-of-range target basis points;
- target vector not totaling 10,000 bps;
- duplicate normalized instrument;
- buyable row without a complete instrument identity;
- positive target deficit on a tickerless or otherwise non-buyable row;
- any post-calculation conservation or cap invariant failure.

## Explicit Non-Goals

- no target inference from `assets`, asset groups, or member ratios;
- no MA120, market regime, news, event, performance, risk, or LLM overlay;
- no sell, trim, rebalance, or order-unit calculation;
- no live price, FX, KIS, external provider, or current-price fallback;
- no recommendation wording or persistence;
- no `all`-account actionable allocation;
- no UI, API route, server action, schema, migration, or database write.
