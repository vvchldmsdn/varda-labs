# Shared Movement Builder Extraction Plan

Status: planning only. This does not change code, routes, UI, provider calls,
dry-run behavior, writes, Cron, schema, or migrations.

The next implementation risk is formula drift. The current `/` dashboard already
computes today movement, but the aggregate movement, holding contributions,
coverage, trade-flow adjustment, and removed-position accounting live as private
logic in `src/lib/portfolio-dashboard.ts`. A future `/today` or per-holding
detail route must not copy that logic into a second formula.

## Current Private Boundary

The following concepts are currently dashboard-private and should be extracted
only behind tests:

| Current item | Current role |
| --- | --- |
| `HoldingDailyContribution` | Per-holding previous value, change, return, trade flow, FX impact, and source. |
| `MovementCoverage` | Current value, snapshot value, count, and previous-close coverage percentages. |
| `MovementResult` | Aggregate readiness, reason, totals, contributions map, and coverage. |
| `buildDailyPositionMovement` | Primary movement builder from `daily_position_snapshots`. |
| `buildPreviousCloseMovement` | Previous-close fallback movement builder from `asset_price_snapshots`. |
| `calculateTradeFlowForHolding` | Post-baseline buy/sell adjustment for current holdings. |
| `calculateTradeFlowForSnapshot` | Post-baseline buy/sell adjustment for removed baseline positions. |
| `findPositionSnapshotForHolding` | Current asset to baseline snapshot resolution. |
| `hasFreshMovementPrice` | Fresh live/delayed/realtime price metadata gate. |

## Target Shape

Create a route-independent movement module only after tests are in place.

Candidate module:

- `src/lib/portfolio-movement.ts`

The module should be pure or near-pure:

- no Drizzle imports;
- no `db` imports;
- no provider imports;
- no admin route imports;
- no direct HTTP/fetch;
- no mutation or write helpers;
- no React dependencies.

Inputs should be plain objects prepared by route/query layers:

- current holdings;
- baseline position snapshot rows;
- previous close rows;
- event ledger rows;
- selected account;
- service-day movement cycle;
- latest stored USD/KRW rate;
- coverage thresholds.

Outputs should be serializable except for the internal contribution lookup.
If a `Map` remains useful internally, expose an array form for route payloads.

## Proposed Shared Types

The extracted module should define or export stable types similar to:

| Type | Purpose |
| --- | --- |
| `MovementHoldingInput` | Current holding fields needed for movement only. |
| `MovementPositionSnapshotInput` | Baseline snapshot fields needed for matching and previous value. |
| `MovementPriceSnapshotInput` | Previous-close fallback fields. |
| `MovementEventInput` | Event fields needed for post-baseline trade flow. |
| `MovementCycleInput` | Snapshot date plus 07:00-to-07:00 KST live window. |
| `MovementContribution` | Per-holding movement result. |
| `MovementCoverage` | Aggregate coverage percentages. |
| `MovementResult` | Aggregate ready/source/reason/totals plus contributions. |
| `MovementExclusionReason` | Missing/stale/unsupported reason metadata. |

Reason values should be explicit enough for UI and tests:

- `missing_baseline_snapshot`
- `missing_fresh_live_prices`
- `missing_previous_close_fallback`
- `unsupported_currency`
- `missing_current_fx`
- `missing_baseline_fx`
- `coverage_below_threshold`

## Legacy Id Rule

`legacyBase44Id` can be an internal matching/evidence field. It should not be a
default user-facing display field.

Rules:

- allowed in internal matching and debug/evidence payloads;
- allowed in admin-only diagnostics when needed;
- not shown as primary text in default product tables;
- not used as a replacement for ticker/name/account when a human-facing label is
  available.

This avoids repeating the earlier problem where legacy ids appeared directly in
normal history UI.

## FX Evidence Rule

The shared result should distinguish non-FX zero from missing FX evidence.

- KRW holdings: `fxImpactKrw` can be `0` with reason `not_required`.
- USD holdings with baseline FX evidence: compute `fxImpactKrw`.
- USD holdings without baseline FX evidence: mark `fxImpactKrw` as `null` or
  coverage-limited with reason `missing_baseline_fx`.
- Unsupported currencies: exclude from aggregate movement with
  `unsupported_currency`.

Do not silently render missing baseline FX evidence as a clean `0`.

## Extraction Phases

Phase 1: test current semantics.

- Add fixture tests against current dashboard movement semantics before moving
  code.
- Cover primary snapshot movement, previous-close fallback, stale current price,
  unsupported currency, trade flow, FX-only movement, and removed positions.

Phase 2: extract types and pure helpers.

- Move type definitions and helper functions that do not query the DB.
- Keep `portfolio-dashboard.ts` as the only caller initially.
- Preserve current dashboard output exactly.

Phase 3: extract aggregate builders.

- Move `buildDailyPositionMovement` and `buildPreviousCloseMovement` into the
  shared module.
- Convert any dashboard-specific row shape at the call boundary.
- Keep thresholds configurable through function parameters or exported defaults.

Phase 4: expose serializable contribution data.

- Add an array output for future `/today` or holding detail payloads.
- Keep the current dashboard able to attach contributions by holding id.

Phase 5: only then consider route implementation.

- Build a minimal read-only route or page after `/` uses the shared builder.
- Do not implement provider/dry-run/write actions as part of the route.

## Test Gate

Before code extraction is accepted:

1. KRW holding with fresh current price and baseline snapshot.
2. USD holding where price is unchanged but USD/KRW changes.
3. USD holding where both price and FX change.
4. Post-baseline buy/sell trade-flow adjustment.
5. Stale current price excludes the holding from ready movement.
6. Unsupported currency is excluded and reported.
7. Missing baseline FX is not shown as clean zero.
8. Removed baseline position contributes through removed-position accounting.
9. Aggregate movement equals contribution sum plus removed-position adjustment.
10. Previous-close fallback is used only when snapshot movement is not ready.

## Non-Goals

- No `/today` route in the extraction step.
- No per-holding detail UI in the extraction step.
- No admin action buttons.
- No public sync button.
- No provider calls.
- No dry-run execution.
- No writes.
- No Cron or automation changes.
- No schema or migration changes.
- No recommendation, risk, or scoring integration.

## Acceptance Criteria

The extraction plan is ready for implementation only when:

- current `/` dashboard behavior has fixture coverage;
- the shared module has no DB/provider/route dependencies;
- `/` can keep the same rendered numbers after switching to the shared builder;
- future `/today` can consume the same contribution output without copying
  movement formulas;
- default product UI does not expose `legacyBase44Id`.
