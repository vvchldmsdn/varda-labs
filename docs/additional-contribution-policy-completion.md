# Explainable contribution policy completion

This completes the additional-contribution policy on top of the presentation UI merged in PR #160. The original dirty `codex/analysis-holding-authority` worktree remains preserved. The current master already contains a first implementation of that policy, so integration extends the connected implementation instead of replacing it with the older page/query copies.

## Calculation authority

The source comparison used gyeol-fin's integrated `Portfolio` flow, `CreativeContributionScreen.jsx` and mobile `ContributionScreen.jsx`, and `base44/functions/calcRebalanceRecommendation/entry.ts`. Both original clients refresh live prices and invoke the function with `persist: false`. The old standalone RebalancingCalculator is not the authority.

The user-approved contract takes precedence where it intentionally differs from the original service:

- Targets must total exactly 10,000 basis points. No automatic normalization of saved production targets.
- Drift is measured before adding new cash: `(current weight - target weight) / target weight`. Default threshold is 12%, with an explicit tenant setting including 0% respected.
- A trim requires known positive cost basis and nonnegative unrealized return. The landing value is `(current portfolio value + new cash) × target weight × 1.05`. Original code treated absent cost as zero return; this implementation never uses that as sale eligibility.
- A zero target permits an exit only under the same cost/return requirements. Integer sale amounts are floored, so less than one KRW of valuation may remain. Sale proceeds never exceed holdings.
- Purchase funds are new cash plus calculated sale proceeds. Only holdings with no actual sale and a positive effective target deficit can receive a purchase allocation.
- MA120 target multipliers are broad index 0.8, dividend quality 0.8, large growth 0.7, thematic 0.5, and other 0.8. Gold and bonds are exempt. The first 3% below MA120 is linearly interpolated. Missing/invalid evidence never creates a reduction. Tenant and asset trend switches are respected.
- Purchases are proportional to exact, unrounded effective deficits. Whole KRW are assigned by largest remainder with stable allocation-key tie breaking, bounded by each deficit's whole-KRW amount. Remaining funds stay cash.
- The execution ratio is a reference check against `ceil(funds × ratio / 100)`. It does not force purchases above the effective deficits. A reference shortfall is displayed honestly.
- Currency-entry, risk, regime, news and performance modifiers require separately established evidence. The original service's later top-up loop compensates for those later reductions; it is not applied to this simpler policy. Group or asset overrides without a normalized contract are not invented.
- This is an amount calculation. It does not execute orders or include fees, taxes or brokerage order-size constraints.

## Data and explanation boundaries

All portfolio/settings reads stay in tenant-scoped server queries. Missing fractional-position cost must remain unknown; it must not be added as zero to known whole-share cost. Legacy account fallback must match every valuation/target holding without allowing duplicate instrument entries to overwrite each other. Stable account/asset allocation keys are carried through selection and explanation views.

The logic dialog shows funds, pre-cash drift, post-cash trim basis, MA multiplier, effective deficit, actual purchase/sale and cash. Strategic allocation is an MA-off comparison, never an extra source of purchase funds. A decrease in one holding's purchase amount may be redistributed to another holding and is not labelled cash retention. Weight-change details include sales and unchanged holdings because their denominator also changes with new cash.

## Verification

Pure engine tests cover threshold boundaries, zero-target exits, missing/zero/loss cost, fractional valuations, deterministic allocation, MA classes and interpolation, unavailable evidence, safety bounds and cash conservation. Query integration tests inject read ports while executing the actual query adapter and actual policy engine, including tenant identity and legacy fallback cases. Browser checks exercise the existing presentation layout, calculation completion, scope retention and explanation/flow dialogs. Full tests, lint, production build and deployed HTTP responses are required before release.

September 8, 2026 local verification: all 2,047 tests pass (including 25 engine tests and 18 policy-input/query tests), ESLint passes, and the production build passes. Independent source review found no remaining release blocker. At 1366×768 and 390×844, the main contribution view fits the viewport; its detail dialogs scroll normally. Browser checks confirmed calculation completion, amount preservation across account changes, real sale amounts in weight details, execution-reference shortfall, Escape focus return and zero application console errors/warnings. These browser checks use explicitly marked development fixtures, while integration tests exercise the server query with injected I/O; they do not claim authenticated production portfolio verification. No migration, authentication, dependency or lockfile change is included.
