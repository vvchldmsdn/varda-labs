# Auth/Tenant Phase 1D-A: Writer Readiness

Last updated: 2026-07-11

Status: completed. Production writer behavior remains unchanged.

This phase inventories every current database writer and freezes the trusted
canonical-owner contract before any owner value is written. It adds no user,
identity, owner backfill, query filter, constraint, RLS policy, or auth SDK.

## Trusted Owner Contract

A canonical owner is accepted only from one of these trusted server-side
sources:

- the future result of `getCurrentAppUser()` for a user command;
- a separate migration CLI canonical-owner argument after an `app_users`
  lookup verifies it;
- an explicitly approved machine-job target for a user-owned snapshot.

Canonical owner values are forbidden in URL params, query strings, request
bodies, forms, headers, response payloads, and logs. They must not be inferred
from a legacy owner string, email, Base44 id, asset, snapshot, or arbitrary
string-to-UUID conversion.

`src/lib/tenant-write-context.ts` expresses this as a pure preparation and
validation contract. No production writer imports it in Phase 1D-A. Shadow
contexts therefore produce no canonical-owner assignment and cannot change a
database row.

## Writer Registry

`src/lib/tenant-writer-registry.ts` is the machine-readable inventory. It
contains 16 logical writers backed by 20 DML implementation files.

| Writer | Class | User-owned targets | Shared/admin targets |
| --- | --- | --- | --- |
| Base44 core import | user | accounts, asset_groups, assets, asset_group_members | - |
| Base44 history import | mixed | account_balance_snapshots, daily_portfolio_snapshots, daily_position_snapshots | fx_rates |
| Base44 settings import | user | settings | - |
| Base44 market-data import | shared | - | asset_price_snapshots, benchmark_snapshots |
| Base44 ETF-reference import | shared | - | etf_masters, etf_holdings |
| Base44 event import | user | event_ledger_entries | - |
| Base44 market-context import | mixed | market_regime_daily | global_market_factors |
| Base44 cashflow/goal import | user | goals, transactions, fixed_transactions, monthly_incomes | - |
| Base44 nonportfolio cleanup | user | assets delete | - |
| Accounts compatibility API | user | accounts | - |
| Assets compatibility API | user | assets | - |
| Asset-groups compatibility API | user | asset_groups | - |
| Group-members compatibility API | user | asset_group_members | - |
| Admin market-price sync | mixed | - | market_data_sync_runs, live_price_quotes, asset_price_snapshots |
| Admin FX sync | shared | - | fx_rates |
| Admin daily snapshot | user | daily_portfolio_snapshots, daily_position_snapshots | - |

The registry is checked against both source-code DML discovery and
`scripts/lib/tenant-ownership-policy.mjs`. Adding a writer without registering
it, or assigning a target a conflicting class, fails the test suite.

## Prepare, Activate, Freeze

User-owned writers follow three explicit states:

1. **Prepare:** build and validate a trusted context in shadow mode; write no
   canonical owner.
2. **Activate:** after an initial verified `app_users` row exists, dual-write a
   verified owner and reject cross-owner updates and references.
3. **Freeze:** reject user-owned writes that lack a verified context. Cleanup
   and deletes remain frozen until they are owner-scoped.

Shared-reference and admin-system targets never receive an owner. Mixed
writers split behavior by target table. In particular,
`market_regime_daily` is user-owned while `global_market_factors` is shared.

The compatibility entity APIs remain machine-admin boundaries in this phase.
Their HTTP schemas do not accept canonical owner input. Activation must either
move ownership into an owner-aware repository or freeze those routes.

## Guarded Fixtures

`tests/tenant-writer-readiness.test.mjs` fixes the following behavior without
touching the database:

- canonical owner input cannot enter through HTTP;
- the legacy `base44-import` owner remains separate evidence and is never a
  canonical default;
- a canonical migration owner must be a verified UUID;
- cross-owner update, relationship, and delete fixtures are rejected without
  putting owner values in error messages;
- daily snapshot identity includes owner, date, and account, including the
  `all` account row;
- a transaction with mixed snapshot owners is an integrity failure;
- all 52 legacy-only position rows can receive the snapshot owner directly,
  without resolving an asset owner;
- mixed market-context targets remain split between user-owned and shared.

## Database Invariants

Phase 1D-A must leave all Phase 1C production invariants unchanged:

- `app_users`: 0 rows;
- `auth_identities`: 0 rows;
- canonical-owner non-null rows: 0;
- existing imported and generated financial data unchanged;
- no schema or migration change.

## Next Gate

Phase 1D-B adds a dry-run-only initial app-user provisioning command. It does
not create a real user and does not activate canonical owner writes. It must
not be combined with owner backfill, reader filtering, social-login cutover,
RLS, or Basic Auth removal.

Future backfill and constraint work requires a real preview/branch rehearsal;
the production transaction rollback technique used for the small additive
Phase 1C DDL is not an acceptable substitute.
