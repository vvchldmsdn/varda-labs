# Auth And Tenant Model Design

Last updated: 2026-07-10

Status: docs-only design gate. This document does not authorize installing an
auth provider, changing schema, enabling RLS, backfilling rows, changing query
behavior, or enabling user-facing writes.

The measured table inventory, row counts, owner migration plan, query/write
inventory, two-user fixture plan, and RLS ADR direction are in
`docs/auth-tenant-phase0-preflight.md`.

The selected identity provider, session strategy, Next.js authorization
boundaries, and Basic Auth transition are in
`docs/auth-identity-session-strategy.md`.

## Current State

varda-labs is a single imported portfolio protected by Basic Auth. It is not a
multi-user identity system.

- `VARDA_APP_PASSWORD` / `APP_ACCESS_PASSWORD` protect product pages.
- `ADMIN_JOB_SECRET` / `CRON_SECRET` protect admin and scheduled operations.
- `brokerage`, `isa`, `irp`, and `all` are account partitions, not tenants.
- Existing varchar `owner_user_id` and `created_by_id` values are legacy
  evidence, not canonical user UUIDs.
- Existing entity APIs are admin/import compatibility routes, not user CRUD.

Basic Auth and admin job auth must remain separate from future user sessions.
Neither supplies a product owner identity.

## Phase 0 Decision

The canonical future ownership contract is fixed for planning:

| Concern | Decision |
| --- | --- |
| Internal user table | `app_users` |
| Internal user key | `id uuid` |
| External account map | `auth_identities` with unique `(provider, provider_subject)` |
| User-owned row key | `owner_user_id uuid NOT NULL REFERENCES app_users(id)` |
| Initial imported portfolio | One explicitly approved initial app user |
| Shared market/reference data | No owner column; one shared copy |
| Account scope | Secondary filter inside an owner boundary |

`auth_identities` is provider-neutral. The server resolves an external provider
subject to an internal app user UUID. Provider IDs, emails, Basic Auth names,
Base44 owner strings, and import labels must not be used as row owners.

## Complete Ownership Summary

The policy classifies all 22 current public tables:

### User-owned

- `assets`
- `accounts`
- `asset_groups`
- `asset_group_members`
- `event_ledger_entries`
- `market_regime_daily`
- `goals`
- `transactions`
- `fixed_transactions`
- `monthly_incomes`
- `account_balance_snapshots`
- `daily_portfolio_snapshots`
- `daily_position_snapshots`
- `settings`

### Shared reference

- `fx_rates`
- `asset_price_snapshots`
- `live_price_quotes`
- `benchmark_snapshots`
- `etf_masters`
- `etf_holdings`
- `global_market_factors`

### Admin/system

- `market_data_sync_runs`

There are no unresolved tables. `market_regime_daily` is user-owned because its
rows are account-specific portfolio-derived evidence. Price, FX, ETF,
benchmark, live quote, and global factor data remains shared.

## Owner Migration Rules

- A future backfill must require an explicitly reviewed initial user UUID.
- Never infer that UUID from current owner strings or access credentials.
- Add/populate canonical owners while columns are nullable, validate all rows,
  then apply UUID type, `NOT NULL`, FKs, and owner-aware unique indexes.
- `assets.created_by_id` is legacy evidence and should be deprecated after a
  canonical asset owner exists.
- Snapshot writers must propagate owner from the portfolio being snapshotted.
- Shared provider data must not be duplicated per user.

No migration or backfill is approved by this document.

## Query And Write Boundary

Every user-facing server query must derive an internal user UUID from trusted
server session context, filter user-owned tables by that UUID, and only then
apply account/search/date filters. URL search params may select account scope,
but may not select an owner.

Browser-provided owner IDs are untrusted. Future user commands must derive
ownership from the session, validate referenced rows belong to that owner, and
write in transactions. Admin/import routes remain separate.

Recommendation runs and items must each require the canonical owner; account
scope is not a substitute. Item owner must match parent run owner.

## Phase 1A Identity And Session Decision

Neon Auth is selected for development/preview identity integration. Google is
the only initial social method. Neon Auth database sessions are authoritative;
a short-lived signed cookie cache is a performance layer only.

The official quickstart currently labels Neon Auth Beta, so production
multi-user cutover and Basic Auth removal remain blocked on a separate
production-readiness review or an approved replacement provider.

The current Neon project already has a managed `neon_auth` schema but no auth
users, sessions, or linked accounts. varda-labs will not own or migrate those
managed tables through `src/db/schema.ts`.

Product identity remains provider-neutral:

- Neon Auth user id is an external provider subject;
- `auth_identities(provider = 'neon_auth', provider_subject)` resolves it to
  `app_users.id`;
- email, Google subject, Basic Auth username, and account code are never owner
  keys;
- missing mapping or inactive app user fails closed before financial queries;
- v1 is multi-user individual ownership, with no organization/household
  tenant model;
- registration remains closed until owner isolation is proven.

Provider selection does not change the canonical internal UUID contract.

## RLS Direction

App-level owner filters are required before RLS. RLS is defense in depth, not a
replacement for query authorization.

Before enabling RLS, prove:

- a non-owner, non-`BYPASSRLS` application role;
- separate migration and admin-job roles;
- transaction-local request identity in the same Neon/Drizzle transaction as
  the protected query;
- `USING` and `WITH CHECK` policies for all user-owned tables;
- shared reference read grants and no app-role access to admin tables;
- two synthetic users cannot read or write each other's data.

Do not enable RLS until this behavior has integration tests.

## Ordered Approval Gates

1. Phase 0 ownership/preflight review. Completed.
2. Auth provider and session strategy. Completed in the Phase 1A ADR.
3. Exact identity/owner schema and guarded backfill proposal, no migration.
4. Two-user query/write fixtures.
5. Reviewed migration and explicit initial-owner backfill.
6. Owner-filtered application reads/writes and deployed isolation smoke.
7. Optional RLS implementation in a separate gate.
8. User-facing write workflows and recommendation persistence.

The immediate next gate is the exact identity/owner migration and guarded
backfill plan. It must not enable RLS or recommendation persistence.
