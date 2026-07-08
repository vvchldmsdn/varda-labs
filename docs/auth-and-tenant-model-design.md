# Auth And Tenant Model Design

Last updated: 2026-07-08

Status: docs-only design gate. This document does not authorize installing an
auth provider, changing schema, enabling RLS, adding policies, changing API
behavior, backfilling rows, or changing Cron/KIS/snapshot/admin write paths.

## Decision Summary

The current varda-labs app is protected as a single-user migration verification
surface. It is not yet a social-login or multi-tenant product.

Before user-facing writes, settings edits, event-ledger writes, recommendation
run storage, simulation job storage, or balance/history write paths are
enabled, varda-labs needs an explicit auth and tenant boundary.

The next implementation gate should be:

1. choose an auth provider;
2. define the app user model;
3. classify every table by ownership;
4. decide the canonical owner key;
5. plan how imported Base44 rows attach to the initial owner;
6. add app-level user filtering;
7. only then evaluate optional Postgres RLS policies.

## Current Auth Surface

### UI Routes

Current protected UI routes:

| Route | Current protection | Notes |
| --- | --- | --- |
| `/` | Basic Auth in `src/proxy.ts` | Read-only portfolio dashboard. |
| `/portfolio/:path*` | Basic Auth in `src/proxy.ts` | Reserved route family. |
| `/etfs` and `/etfs/:path*` | Basic Auth in `src/proxy.ts` | ETF reference read-only surface. |
| `/market` and `/market/:path*` | Basic Auth in `src/proxy.ts` | Market context read-only surface. |

Current UI auth environment contract:

| Env key | Role |
| --- | --- |
| `VARDA_APP_PASSWORD` | Preferred dashboard access password. |
| `APP_ACCESS_PASSWORD` | Compatibility dashboard access password. |
| `VARDA_APP_USER` | Optional username. Defaults to `varda`. |

This is an access gate for a private deployment. It is not a user identity
system and must not be treated as social login.

### Admin And Job Routes

Current admin/job auth uses `src/lib/admin-auth.ts` through
`ADMIN_JOB_SECRET` or `CRON_SECRET`.

| Route | Method | Current protection | Product role |
| --- | --- | --- | --- |
| `/api/admin/market/prices/sync` | `POST` | Admin job secret | Admin market-data operation. |
| `/api/admin/snapshots/daily` | `POST` | Admin job secret | Admin snapshot operation. |
| `/api/cron/market-cycle/preflight` | `GET` | Admin job secret | Cron/preflight diagnostic. |

These routes are not user session routes. Keep them separate from future
social-login authorization.

### Entity API Routes

The current `src/app/api/entities/*` routes are protected by
`requireAdminJob`, which delegates to `isAuthorizedAdminJob`.

| Route family | Methods observed | Current classification |
| --- | --- | --- |
| `/api/entities/accounts` | `GET`, `POST` | Admin/import compatibility surface. |
| `/api/entities/accounts/[id]` | `PATCH`, `DELETE` | Admin/import compatibility surface. |
| `/api/entities/assets` | `GET`, `POST` | Admin/import compatibility surface. |
| `/api/entities/assets/[id]` | `PATCH`, `DELETE` | Admin/import compatibility surface. |
| `/api/entities/asset-groups` | `GET`, `POST` | Admin/import compatibility surface. |
| `/api/entities/asset-groups/[id]` | `PATCH`, `DELETE` | Admin/import compatibility surface. |
| `/api/entities/asset-group-members` | `GET`, `POST` | Admin/import compatibility surface. |
| `/api/entities/asset-group-members/[id]` | `PATCH`, `DELETE` | Admin/import compatibility surface. |

Do not expose these as user CRUD without reworking authorization, ownership
filters, transactions, and product-specific command semantics.

## Current Non-Goals

- Do not treat Basic Auth as social login.
- Do not treat admin secret routes as user session authorization.
- Do not treat existing `owner_user_id` or `created_by_id` columns as the final
  tenant model.
- Do not copy Base44 `created_by`, `created_by_id`, `owner_id`, or `user_id`
  fields into the product model without review.
- Do not put provider credentials, tokens, raw auth headers, app keys, or app
  secrets in user-owned Postgres rows.

## Auth Provider Decision Matrix

No provider is selected yet. The first auth decision should compare candidates
against the same criteria.

| Candidate | Strengths to evaluate | Risks to evaluate |
| --- | --- | --- |
| Auth.js / NextAuth | Good Next.js fit, app-controlled tables, flexible providers. | More app-owned session and adapter decisions. RLS context is still custom work. |
| Clerk | Managed user lifecycle, fast social-login setup, good App Router support. | Vendor lock-in and mapping external user ids to internal owner ids. |
| Supabase Auth | Integrated auth and Postgres/RLS model. | varda-labs already uses Neon; adopting Supabase Auth only may add split-platform complexity. |
| Other managed identity | May fit future organization/login needs. | Needs explicit Next.js, Neon, webhook, and local-dev validation. |

Selection criteria:

- server-side session access in Next.js App Router;
- compatibility with Vercel deployment;
- stable internal app user id separate from provider id;
- social provider account mapping;
- user lifecycle hooks or webhooks;
- local development ergonomics;
- Neon/Postgres RLS integration path;
- operational burden and lock-in.

## App User Model Proposal

Use an internal app user id as the owner key. External social provider ids
should map to that internal id instead of being used directly as row ownership.

Candidate tables:

| Table | Purpose |
| --- | --- |
| `app_users` | Internal user identity and lifecycle state. |
| `auth_accounts` | Social provider account mapping to `app_users.id`. |
| `auth_sessions` | Optional only if the chosen provider stores sessions in the app DB. |

Candidate `app_users` fields:

| Field | Purpose |
| --- | --- |
| `id uuid` | Stable internal owner id. |
| `email text` | Login/contact identifier. |
| `display_name text` | Optional display name. |
| `is_active boolean` | Soft user lifecycle control. |
| `created_at timestamptz` | Internal creation time. |
| `updated_at timestamptz` | Internal update time. |

Candidate `auth_accounts` fields:

| Field | Purpose |
| --- | --- |
| `id uuid` | Row id. |
| `user_id uuid` | FK to `app_users.id`. |
| `provider text` | Example: `google`, `github`, `kakao`. |
| `provider_account_id text` | External provider subject/account id. |
| `created_at timestamptz` | Mapping creation time. |
| `updated_at timestamptz` | Mapping update time. |

Initial imported Base44 data should be assigned to one explicit initial owner,
not left as implicit global state. The exact owner id should be created by a
future migration after the provider and app user model are approved.

## Table Ownership Matrix

This matrix is the proposed target classification. It is not a migration.

| Table | Current owner state | Proposed classification | Notes |
| --- | --- | --- | --- |
| `accounts` | Has `owner_user_id`. | User-owned config. | Should eventually require canonical owner. |
| `asset_groups` | Has `owner_user_id`. | User-owned config. | Group names and target policy are user-specific. |
| `asset_group_members` | Has `owner_user_id`. | User-owned config join. | Should follow both group and asset ownership. |
| `assets` | Has `created_by_id`, no canonical owner. | User-owned current state. | Needs canonical owner before user CRUD. |
| `settings` | No owner. | User-owned policy/settings. | Current single row should attach to initial owner later. |
| `event_ledger_entries` | No owner. | User-owned historical evidence. | Append-only user financial events. |
| `account_balance_snapshots` | No owner. | User-owned historical evidence. | Imported balance facts need initial owner assignment. |
| `daily_portfolio_snapshots` | No owner. | User-owned historical evidence. | Account string is not enough for tenant isolation. |
| `daily_position_snapshots` | No owner. | User-owned historical evidence. | Must retain nullable asset FK and legacy ids. |
| `goals` | Has `owner_user_id`. | User-owned config/history. | Keep separate from old Goal UI assumptions. |
| `transactions` | Has `owner_user_id`. | User-owned event/input. | Future write path needs command semantics. |
| `fixed_transactions` | Has `owner_user_id`. | User-owned recurring input. | Future write path needs validation and ownership. |
| `monthly_incomes` | Has `owner_user_id`. | User-owned income input. | Unique constraints should include canonical owner. |
| `etf_masters` | No owner. | Public/reference. | Shared reference universe. |
| `etf_holdings` | No owner. | Public/reference evidence. | Shared ETF lookthrough history, not user portfolio exposure. |
| `benchmark_snapshots` | No owner. | Shared market data. | Imported benchmark time series. |
| `global_market_factors` | No owner. | Shared market data. | Macro/factor series shared across users. |
| `market_regime_daily` | No owner, has account string/id. | Unresolved user-derived market evidence. | Account-specific rows should likely attach to owner or be recomputed per user. |
| `asset_price_snapshots` | No owner. | Shared market data. | Ticker price series are shared unless user-specific overrides appear. |
| `market_data_sync_runs` | No owner. | Admin/system job artifact. | Belongs to operations, not user data. |
| `fx_rates` | No owner. | Shared market data. | FX series are shared. |

## Owner Key Policy

Recommended canonical name: `owner_user_id` if the current schema is evolved
incrementally, or `user_id` if the auth migration is allowed to rename toward a
cleaner model.

Pragmatic recommendation:

- keep `owner_user_id` as the public schema name for the migration to reduce
  churn;
- define it as a FK to future `app_users.id` once app users exist;
- deprecate `created_by_id` as a legacy compatibility column;
- keep Base44 legacy owner fields out of imported data unless a specific audit
  need is approved;
- do not add owner keys to public/reference market tables;
- split account-derived market rows from shared market rows before enforcing
  ownership on `market_regime_daily`.

## Query And Write Boundary

Future app-level authorization should be enforced before optional RLS.

Read rules:

- Server Component query helpers must accept or derive the current internal
  user id.
- User-owned tables must filter by canonical owner.
- Historical snapshot queries must preserve legacy ids and denormalized labels
  while filtering by owner.
- Public/reference tables may be read without owner filters.
- Admin/system job tables should remain outside user session reads unless a
  specific admin UI is approved.

Write rules:

- Browser-side multi-step mutation remains forbidden.
- User writes should use route handlers or server actions with authorization,
  validation, transactions, idempotency where needed, and event-ledger append
  where applicable.
- Admin/import write routes should stay separate from user writes.
- Existing entity APIs should be reclassified before being exposed as product
  CRUD.

## RLS Decision Section

Do not enable RLS yet. RLS should be evaluated only after the app user model and
owner backfill plan are approved.

RLS questions to resolve:

- How will the current request user id reach Postgres for each query?
- With Neon serverless and Drizzle, should the app use a transaction-scoped
  local setting such as `SET LOCAL app.current_user_id = ...`?
- Which DB role will application traffic use?
- Which DB role will migrations and import/admin jobs use?
- Will app-level authorization and RLS both be required?
- How will public/reference tables remain readable?
- How will historical nullable owner rows be handled during transition?
- How will test fixtures prove cross-user isolation?

Potential policy shape after approval:

- user-owned tables: `owner_user_id = current_setting('app.current_user_id',
  true)::uuid`;
- public/reference tables: read-only to the app role;
- admin/system job artifacts: not visible to normal user role;
- import/migration role: separate path with explicit operational controls.

This is only a direction. It is not an implementation plan until provider,
schema, and owner backfill decisions are approved.

## Approval Gates

| Gate | Required decision | Output |
| --- | --- | --- |
| 1 | Auth provider | Provider choice and session strategy. |
| 2 | App user schema | `app_users` and account mapping proposal. |
| 3 | Ownership/backfill | Table-by-table owner migration plan. |
| 4 | App-level filtering | Query helper/API/server action changes. |
| 5 | Optional RLS | Policy design, roles, tests, migration. |
| 6 | User-facing writes | Product command routes and UI enablement. |

## Immediate Next Step

After this document is reviewed, the next docs-only step can be
`account_balance_snapshots` plus `daily_portfolio_snapshots` history/balance
read-only design. That document should reference this tenant model and state
that owner assignment is a prerequisite before any user-facing writes.
