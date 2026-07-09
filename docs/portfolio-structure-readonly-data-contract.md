# Portfolio Structure Read-Only Data Contract

Last updated: 2026-07-09

Status: docs-only contract. This does not add routes, UI, query helpers,
provider calls, dry-runs, writes, Cron behavior, schema changes, migrations,
cleanup, repair, or backfill work.

## Purpose

Define the source-of-truth rules for a future read-only `포트 구조` surface
before adding another dashboard page.

The first version should answer:

- how current value is distributed by account, group, market, currency, and
  holding;
- how current weight compares with configured target weight;
- which rows are excluded because current valuation evidence is incomplete;
- which group or target fields are display evidence versus canonical policy.

It must not become a recommendation, rebalance, risk, simulation, or provider
refresh surface.

## Non-Goals

Out of scope for this contract:

- write/edit UI for assets, groups, or target policy;
- public sync buttons or admin action buttons;
- provider calls during render;
- daily snapshot writes;
- recommendation or rebalance calculations;
- risk scoring;
- importing `DailyGroupSnapshot`;
- schema changes for group snapshots or derived allocation tables;
- showing legacy/internal ids in product UI.

## Primary Source Tables

| Table | Role | Notes |
| --- | --- | --- |
| `assets` | Current holding state and per-asset policy. | Use quantity, market, currency, account, asset type, group id, target weight, MA policy fields, and provider metadata. Do not treat legacy ids as display labels. |
| `asset_groups` | Current group policy and grouping metadata. | Use name, target weight, color, flags, execution mode, active/sort state. |
| `asset_group_members` | Explicit group membership evidence. | Use only active rows. `allocation_ratio` is a member-level policy candidate, not yet the canonical target weight until conflict rules are approved. |
| `live_price_quotes` | Current quote cache. | Use as current price evidence when fresh and status is `ok`. Render must not fetch providers. |
| `fx_rates` | Current FX basis. | Use latest stored USD/KRW row, with the same freshness semantics as dashboard movement where possible. |
| `settings` | Portfolio-level policy. | Use only non-secret policy fields such as trend filter and drift thresholds. |

Secondary evidence:

| Table | Role | Rule |
| --- | --- | --- |
| `daily_position_snapshots` | Baseline and historical evidence. | Use for validation, snapshot comparison, and historical group drift evidence. Do not make it the first source for current structure if `assets` plus quote cache can explain current holdings. |
| `daily_portfolio_snapshots` | Historical totals. | Useful for trend context only. Do not use to allocate current group weights. |
| `event_ledger_entries` | Transaction evidence. | Not required for current structure v1 unless a later view needs post-baseline flow context. |

## Current Structure Definition

The first read-only structure surface should be current-state first:

1. Select active investment holdings from `assets`.
2. Apply current quote cache from `live_price_quotes` when the quote is usable.
3. Convert local value to KRW with `fx_rates` and the existing FX helper rules.
4. Compute weights within the selected account scope.
5. Attach group metadata from `asset_groups` and membership evidence from
   `asset_group_members`.

This should share existing valuation helpers where practical:

- `convertToKrw`
- `resolveKrwFxRate`
- `toNumber`
- account normalization used by the dashboard

It should not fork today-movement formulas from
`src/lib/portfolio-movement.ts`. Current structure is an allocation view, not a
daily movement view.

## Account Scope

Supported account filters:

- `brokerage`
- `isa`
- `irp`
- `all`

Rules:

- Use URL search params, for example `/portfolio/structure?account=isa`.
- Unknown account values should normalize to the same fallback used by the
  portfolio dashboard.
- `all` aggregates current holdings across tracked accounts, but account-level
  rows must still keep their account identity for drilldown and grouping.
- Do not merge unrelated legacy-only snapshot rows into current holdings.

## Valuation Rules

Current value:

- KRW holdings: `quantity * currentPrice + fractionalKrwValue`.
- USD holdings: `quantity * currentPrice * usdKrw + fractionalKrwValue`.
- Unsupported currencies: exclude from weight math and show a data-health
  reason.

Current price priority:

1. Fresh `live_price_quotes` row with matching market, normalized ticker, and
   currency.
2. Existing asset price fields only as a labeled fallback, not as live evidence.
3. Missing/failed/stale quote rows should produce an exclusion or warning, not
   a silent zero.

FX priority:

1. Latest stored `fx_rates.usdkrw` row that is fresh enough for the current
   service cycle.
2. Existing settings fallback only where the current dashboard already permits
   it.
3. Missing FX should block USD allocation from current-weight math unless the
   row is clearly displayed as incomplete.

## Target Weight Rules

The current schema has three target-policy fields:

| Field | Meaning in this contract |
| --- | --- |
| `assets.target_weight` | Per-asset explicit target candidate. Safe to show as raw asset target evidence. |
| `asset_groups.target_weight` | Group-level target candidate. Safe to show as group target evidence. |
| `asset_group_members.allocation_ratio` | Member-level allocation candidate inside a group. Preserve and show as evidence only after conflict display rules are implemented. |

Do not silently combine all three fields into one canonical target number.

Recommended v1 target display:

- `rawAssetTargetPct`: from `assets.target_weight`.
- `groupTargetPct`: from `asset_groups.target_weight`.
- `memberAllocationRatioPct`: from `asset_group_members.allocation_ratio`.
- `effectiveTargetPct`: optional derived display value, only if the route
  labels the derivation and tests it.

The daily snapshot writer already derives a point-in-time
`target_weight_effective` when a group target exists. A structure route may use
that as historical evidence, but it should not treat snapshot-derived effective
weight as the editable current policy.

## Suggested Effective Target Derivation

If v1 needs a single effective target for drift display, use this conservative
order and label it as derived:

1. If an active group has a group target and active member allocation ratios
   that sum to a usable positive value, allocate group target by normalized
   member ratio.
2. Else if an active group has a group target, distribute the group target by
   current member market value share.
3. Else use `assets.target_weight`.
4. If no target evidence exists, show `n/a` and do not compute drift.

This is stricter than the current dashboard holding card, which mostly uses
`assets.target_weight` plus trend-filter adjustment. The structure page should
not imply a more exact policy than the stored data supports.

## Group Rows

A group row should show:

| Field | Source |
| --- | --- |
| Group name | `asset_groups.name` |
| Account scope | Derived from current member holdings |
| Current value KRW | Sum of included member current values |
| Current weight | Group value divided by selected account total |
| Group target | `asset_groups.target_weight` |
| Drift | Current weight minus derived/effective target only when target is available |
| Member count | Active current member holdings |
| Excluded count | Members excluded from valuation because price/FX evidence is missing |

Ungrouped holdings should be shown as an explicit `Ungrouped` bucket. They
should not be forced into the imported Base44 group.

## Holding Rows

A holding row should show:

| Field | Source |
| --- | --- |
| Name, ticker, account, market, currency | `assets` |
| Group | `asset_groups` through `assets.group_id` and/or active membership |
| Quantity | `assets.quantity` |
| Current price | `live_price_quotes` or labeled fallback |
| Current value KRW | Derived current valuation |
| Current weight | Derived within account scope |
| Asset target | `assets.target_weight` |
| Effective target | Derived only if rules are implemented |
| Drift | Derived only when target is known |
| Price evidence | quote source, status, fetched/as-of |

Default UI must not display:

- `assets.id`
- `asset_groups.id`
- `asset_group_members.id`
- `legacy_base44_id`
- provider auth material
- raw request or response metadata

## Data-Health States

Use explicit states instead of silently showing misleading zeros:

| State | Meaning |
| --- | --- |
| `ready` | Included in current value and weight math. |
| `missing_price` | No usable current price evidence. |
| `stale_price` | Quote exists but is outside accepted freshness rules. |
| `missing_fx` | USD or future non-KRW currency lacks usable FX. |
| `unsupported_currency` | Currency has no approved conversion model. |
| `missing_target` | Current value can be shown, but drift cannot be computed. |
| `ambiguous_group_policy` | More than one target source conflicts and no derivation rule is approved. |

Aggregates should disclose excluded value/count when available.

## Route Candidate

Preferred first route:

- `/portfolio/structure`

Acceptable alternative:

- `/structure`

Initial behavior:

- Server Component route.
- Search params for account and maybe view mode.
- Table-first display for groups and holdings.
- Optional client component only for local sorting/filtering.
- No first-render browser REST refetch.
- No provider/admin/write/Cron calls.

## Query Helper Boundary

If implemented, add a helper such as:

- `src/db/queries/portfolio-structure.ts`

The helper should return a display-ready, sanitized read model:

- selected account;
- valuation basis and FX evidence;
- group rows;
- holding rows;
- exclusions/data-health rows;
- raw counts useful for smoke tests.

It should not return legacy/internal ids unless a later operator-only diagnostic
section explicitly needs them. Product components should not need to know those
ids.

## Verification Gate Before UI

Before adding the route, add focused tests for the pure read-model helper:

1. KRW holding current weight.
2. USD holding valuation with FX.
3. Missing FX excludes USD valuation.
4. Unsupported currency is excluded.
5. Group target with no member allocation.
6. Group target with member allocation ratios.
7. Ungrouped holdings bucket.
8. No legacy/internal id in display payload.

Then verify:

- `npm run test`
- `npm run lint`
- `npm run build`
- production route smoke after route implementation:
  - no-auth 401;
  - valid auth 200;
  - expected route markers;
  - no secret/internal id leakage;
  - DB counts unchanged.

## Deferred Decisions

These should remain deferred until a product or write path explicitly needs
them:

- importing or modeling `DailyGroupSnapshot`;
- editing target policy;
- deciding whether group target overrides asset target;
- deciding whether member allocation ratio is authoritative;
- trend-filter adjusted target display for allocation structure;
- recommendation/risk/scoring integration;
- public refresh button;
- admin action button;
- Cron or snapshot writer changes.
