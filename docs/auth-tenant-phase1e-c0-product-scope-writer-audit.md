# Auth/Tenant Phase 1E-C0: Product-Scope Writer Audit

Last updated: 2026-07-11

Status: completed as a non-destructive scope and dependency gate. Runtime
writer behavior, database rows, schema, routes, and authentication remain
unchanged.

## Product Scope Lock

The migrated product contains exactly these seven user flows:

1. Home
2. Today movement
3. Additional contribution
4. Portfolio structure
5. History
6. Investment lab
7. Simulation validation

Legacy cashflow, goal-setting, and calendar flows are not migration targets.
This does not mean that their already imported evidence is deleted. It means
they are excluded from product runtime, canonical-owner backfill, and writer
activation until a separately approved cleanup removes them safely.

## Runtime Dependency Map

| Product flow | Current route state | Current read dependencies | Writer implication |
| --- | --- | --- | --- |
| Home | Implemented at `/` | accounts, asset groups, assets, settings, FX, live quotes, asset prices, daily portfolio/position snapshots, event ledger | Core, settings, history/snapshot, market data, and event writers remain in scope. |
| Today movement | Implemented at `/today`; shares the dashboard read model | Same movement evidence as Home, including event ledger trade flow and realized return | Event ledger remains in scope and is not legacy cashflow. |
| Additional contribution | Navigation placeholder; no route contract yet | None selected | Do not infer this flow from Goal, Transaction, FixedTransaction, or MonthlyIncome. Define a read-only calculation contract first. |
| Portfolio structure | Implemented across `/portfolio/structure` and `/portfolio/risk` | assets, groups/members, live quotes, settings/FX, asset price history | Core, settings, market price, and snapshot support remain in scope. |
| History | Implemented at `/history` | account balance snapshots and daily portfolio snapshots | History import and daily snapshot writers remain in scope. The current route does not read event ledger directly. |
| Investment lab | Navigation placeholder; model audit only | None selected | Define inputs and artifacts from the product intent. Do not reuse the legacy cashflow projection merely because it exists. |
| Simulation validation | Navigation placeholder; model audit only | None selected | Define job, calibration, and result contracts before selecting writers or tables. |

`/etfs`, `/market`, and `/admin/market-sync` are supporting reference/operator
surfaces. They are not additional primary product flows, but their data may
support portfolio structure, investment lab, and simulation validation.

## Canonical Owner Rollout Scope

The physical ownership classification and the product rollout classification
are separate:

- A table can remain physically `user_owned` while being excluded from the new
  product.
- Excluded writers remain registered so DML discovery and static safety checks
  cannot lose sight of them.
- Activation requires every `in_scope` user-owned writer to be shadow-ready.
  An `intentionally_skipped_legacy` writer must remain frozen, not silently
  ignored or partially activated.

Machine-readable policy lives in:

- `src/lib/tenant-writer-registry.ts`
- `scripts/lib/tenant-ownership-policy.mjs`

The excluded legacy set is exactly:

- writer: `base44_cashflow_goal_import`
- tables: `goals`, `transactions`, `fixed_transactions`, `monthly_incomes`
- transition: dry-run evidence only, no canonical activation, frozen writer

The importer remains in the DML registry and its existing legacy import
contract is not rewritten in this phase.

## Event Ledger Decision

`event_ledger_entries` remains an in-scope portfolio ledger because current
runtime code uses it for event activity, realized return, cost basis, and
post-baseline trade-flow adjustments. It is distinct from the excluded legacy
cashflow planning tables.

The next writer shadow slice targets `base44_event_import`, but it must
validate account, asset, group, and self-correction ownership relationships.
It must not copy the importer's global correction repair update into the
canonical shadow path.

That slice is now completed in
`docs/auth-tenant-phase1e-c1-event-writer-shadow.md` without enabling writes.

The next in-scope mixed writer, `base44_history_import`, is now split and
validated as a read-only owner/FX shadow in
`docs/auth-tenant-phase1e-d-history-writer-shadow.md`. Shared FX diagnostics do
not act as snapshot owner evidence and do not enable any write.

The next mixed writer, `base44_market_context_import`, is now split into a
read-only regime owner plan and shared factor diagnostic in
`docs/auth-tenant-phase1e-e-market-context-writer-shadow.md`. Existing regime
duplicates are preserved as data-health evidence and no factor owner action is
created.

## Regression Gate

Tests enforce all of the following:

- the four excluded tables have the exact
  `intentionally_skipped_legacy` rollout scope;
- the cashflow/goal importer stays registered and frozen;
- excluded tables cannot appear in an in-scope writer target;
- no product App Router, component, query, library, scheduled route, or admin
  route reads the excluded table identifiers;
- all registered DML implementations remain free of canonical-owner writes.

## Explicit Non-Actions

This phase does not:

- delete legacy rows, schema, importers, exports, or documentation;
- backfill any canonical owner;
- add RLS, constraints, routes, or UI;
- connect social identity or activate the provisioning user;
- derive Additional contribution, Investment lab, or Simulation validation
  from the excluded Goal/Cashflow model.
