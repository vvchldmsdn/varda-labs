# Additional Contribution MA120 Overlay Candidate

Last updated: 2026-08-12

Status: pure comparison candidate implemented. It is not connected to the
runtime allocator, page, API, database, provider, recommendation, or order
flow.

## Product Boundary

The strategic deficit allocation remains the source baseline. This candidate
only asks how that exact baseline would differ under one explicit MA120 trend
overlay. It does not rewrite target weights or infer that buying below MA120 is
universally undesirable.

## Candidate Policy

- The caller must explicitly select `candidate`; `off` reproduces the baseline.
- Above or exactly at MA120 uses multiplier `1.0`.
- From 0% to 3% below MA120, the multiplier decreases linearly from `1.0` to
  `0.5`.
- At least 3% below MA120 uses the bounded floor multiplier `0.5`.
- Missing, invalid, insufficient, future, or more than seven calendar days old
  evidence uses neutral multiplier `1.0` and remains visible as a data-quality
  state.
- Whole-KRW conversion rounds toward the strategic baseline with `ceil`, so
  rounding cannot make the reduction harsher than the stated multiplier.
- Reduced budget remains explicit residual cash. It is not redistributed to a
  different holding and no automatic minimum-deployment correction is used.

## Invariants

- the exact strategic baseline object is preserved beside the comparison;
- every candidate allocation is an integer between zero and its strategic
  allocation;
- candidate allocations plus candidate residual cash equal the input cash;
- baseline order and evidence order cannot change the result;
- duplicate identities or malformed baseline totals block the comparison;
- no database, provider, clock, API, UI, persistence, recommendation, sell, or
  order dependency exists in the pure module.

## Runtime Gate

This implementation is evidence for review and historical comparison only.
Before a user-facing toggle can affect an Additional Contribution result, the
candidate must be evaluated against the identical no-overlay baseline and the
UI must show strategic allocation, multiplier, reduction, residual cash, data
freshness, and an explicit on/off control. Runtime default-on behavior is not
approved.

The guarded `npm run audit:additional-contribution-ma120-overlay` command reads
the current three named account baselines and their stored MA120 evidence from
the pinned Production target. It performs no provider call or database write.

## 2026-08-12 Production Read Audit

- the pinned Production target guard passed;
- ISA had usable MA120 evidence for all four target instruments;
- all four ISA instruments were above or at MA120, so the candidate preserved
  the exact KRW 3,000,000 strategic allocation with zero residual cash;
- Brokerage and IRP were blocked before MA120 evaluation because no approved
  target policy exists for those accounts;
- the audit did not infer target weights from current holdings, legacy asset
  fields, or another account's policy.
