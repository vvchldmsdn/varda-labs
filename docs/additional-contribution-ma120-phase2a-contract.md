# Additional Contribution MA120 Phase 2A Contract

Last updated: 2026-07-11

Status: pure evidence-only validation implemented. No allocation multiplier,
buy block, redistribution, target rewrite, persistence, database/provider read,
route, UI, or recommendation behavior is enabled.

## Purpose

Phase 2A answers one descriptive question:

> Where is one explicitly dated comparison price relative to the simple
> average of the latest 120 actual adjusted-close observations available by
> that date?

It does not decide whether buying below MA120 is desirable or how an allocation
should change.

## Input Boundary

The pure evaluator receives:

- a normalized instrument key;
- an explicit `asOfPriceDate`;
- one positive finite comparison price;
- explicit `comparisonPriceBasis=adjusted_close_compatible` evidence;
- adjusted-close observations containing only `priceDate` and
  `adjustedClosePrice`.

The comparison price is deliberately separate from the historical series. A
future adapter may source it from a current valuation quote or an observed
close only after proving that it is comparable with the adjusted-close basis.
Phase 2A does not choose a provider or source.

The evaluator does not accept account, owner, quantity, current value, target
weight, allocation, provider metadata, internal id, or legacy id.

## Window Semantics

1. Validate the explicit as-of date without consulting the system clock.
2. Ignore observations after the as-of date. They cannot affect the result.
3. Require valid, positive adjusted closes on unique observed price dates.
4. Sort actual observations by price date.
5. Use the latest 120 observations at or before the as-of date.
6. Do not create rows for weekends, holidays, suspensions, or missing dates.
7. If fewer than 120 actual observations exist, return
   `insufficient_history` and no MA value.

An older observation outside the latest-120 window cannot affect the result.
The output preserves the oldest and latest used price dates so later rendering
can show the evidence range without manufacturing freshness.

## Price Basis

Only `adjustedClosePrice` is allowed in the history input. The presence of a
raw `closePrice` or `rawClosePrice` field blocks the result even when an
adjusted value is also present. There is no raw-close fallback.

`adjusted_close_compatible` is an explicit input assertion, not proof supplied
by this helper. A future read adapter must establish split/distribution basis
compatibility and price provenance before using production data.

## Evidence States

- `above_ma`: comparison price is above MA120;
- `at_ma`: comparison price is equal to MA120 within floating-point tolerance;
- `below_ma`: comparison price is below MA120;
- `insufficient_history`: fewer than 120 actual observations are available;
- `invalid_history`: request, basis, date, duplicate, raw-close, or numeric
  evidence is invalid.

Ready evidence includes the full-precision MA120, percentage distance from the
average, actual observation counts, ignored future-row count, and window dates.
Presentation rounding is a later UI concern.

## No-Overlay Invariant

`pairBaselineWithMa120Evidence` returns the exact baseline object reference and
places evidence beside it. It does not copy, mutate, freeze, normalize, filter,
or recalculate the baseline.

Therefore all of these remain identical with and without MA120 evidence:

- total allocated KRW;
- residual cash;
- every instrument allocation;
- target vector and valuation inputs;
- allocation ordering and rounding.

An invalid or below-MA evidence result also has no allocation effect.

## Forbidden Dependencies

Phase 2A does not import or read:

- the Additional Contribution allocator;
- the Target Policy Resolver or approved ISA vector;
- `assets.ma_120`, `assets.days_above_ma`, or snapshot MA caches;
- `settings.useTrendFilter`;
- Drizzle, Postgres, providers, KIS, API routes, or product pages;
- Base44 recommendation logic.

The legacy behavior that halves an effective target from cached MA state is
not migrated.

## Verification

Synthetic fixtures cover:

- exactly 120 and exactly 119 actual observations;
- above, equal, and below comparisons;
- no calendar-day carry;
- future-row look-ahead exclusion;
- latest-120 selection when older observations exist;
- duplicate and invalid dates;
- zero, non-finite, and otherwise invalid adjusted closes;
- adjusted/raw close mixing rejection;
- comparison-price basis validation;
- unchanged baseline totals and per-instrument allocations;
- source-level absence of legacy cache, settings, DB, provider, API, allocator,
  and approved ISA fixture dependencies.

## Next Gate

Phase 2A does not authorize an overlay. Before any allocation adjustment, the
user must separately choose and approve at least:

- whether the overlay is enabled per account or scenario;
- the treatment of `below_ma`, `at_ma`, insufficient, invalid, and stale data;
- whether reduced budget remains cash or is redistributed;
- a bounded multiplier or constraint;
- comparison against the identical no-overlay baseline in Simulation
  Validation;
- a point-in-time production read adapter with provenance and no look-ahead.

No runtime adapter or allocator connection should be added before that policy
gate.
