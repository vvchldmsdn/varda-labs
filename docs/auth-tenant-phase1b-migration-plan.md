# Auth/Tenant Phase 1B: Exact Identity And Owner Migration Plan

Last updated: 2026-07-10

Status: complete plan-only proposal, awaiting implementation approval. Nothing
in this document authorizes a schema change, migration generation/application,
identity row, data backfill, writer change, auth SDK, login UI, RLS policy, or
Basic Auth removal.

The non-active implementation drafts are under
`docs/plans/auth-tenant-phase1b/`. `drizzle.config.ts` reads only
`src/db/schema.ts` and writes only to `drizzle/`; therefore these drafts cannot
be picked up by the configured Drizzle commands.

## Measured Starting Point

The read-only audits were rerun on 2026-07-10:

- 22 public tables: 14 user-owned, 7 shared-reference, 1 admin/system;
- 757 user-owned rows and 0 rows with a canonical UUID owner;
- 0 foreign keys in `public`;
- 40 non-null legacy-owner cells across seven tables, representing one
  distinct legacy value; the value was not printed and is not an owner UUID;
- 0 current logical-reference orphan errors in the existing integrity audit;
- 52 daily-position rows intentionally retain an unmatched legacy asset and
  nullable `asset_id`;
- 3 duplicate `market_regime_daily` date/account groups;
- 0 duplicate account-balance dates, but that observation is not enough to
  invent a business identity;
- 1 current settings row.

The current data is compatible with one explicit initial-owner backfill, but
the old string owner must not be cast, overwritten, or used to infer the UUID.

## Fixed Decisions

### `app_users`

| Column | Exact contract |
| --- | --- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `status` | non-null `varchar(20)`, default `provisioning`, check `provisioning`, `active`, or `disabled` |
| `role` | non-null `varchar(20)`, default `user`, check `user` or `admin` |
| `created_at` | non-null timestamptz, default now |
| `updated_at` | non-null timestamptz, default now |

There is no email, provider profile, token, password, or managed-auth foreign
key. Status is separate from authentication so financial access can be
disabled immediately even while a provider session remains cached.

### `auth_identities`

| Column | Exact contract |
| --- | --- |
| `id` | UUID primary key |
| `app_user_id` | non-null UUID FK to `app_users.id`, `ON DELETE RESTRICT` |
| `provider` | non-null `varchar(50)`; first planned value is `neon_auth` |
| `provider_subject` | non-null `varchar(255)` stable external user id |
| `status` | non-null `varchar(20)`, default `active`, check `active` or `disabled` |
| `disabled_at` | nullable timestamptz |
| `created_at`, `updated_at` | non-null timestamptz, default now |

Constraints and indexes:

- unique `(provider, provider_subject)`;
- index `(app_user_id)`;
- partial unique `(app_user_id, provider) WHERE status = 'active'`;
- no direct FK to `neon_auth.*`;
- no copied email, OAuth token, cookie, password, profile, or Google subject.

The partial unique permits historical disabled mappings while allowing at most
one active identity per provider for one product user.

## Owner Column Lifecycle

Every user-owned table receives this expand-only column first:

```sql
canonical_owner_user_id uuid NULL
```

During expand and backfill:

- existing `owner_user_id varchar(255)` remains unchanged;
- `assets.created_by_id` remains unchanged;
- new writers must dual-write the canonical UUID or all user-owned writers
  must be frozen before backfill;
- readers continue using the current single-user behavior until the separate
  application cutover;
- no owner FK or `NOT NULL` is added during expand.

During the final contract migration only:

1. the seven old varchar `owner_user_id` columns are renamed to
   `legacy_owner_user_id`;
2. all `canonical_owner_user_id` columns are renamed to `owner_user_id`;
3. `assets.created_by_id` stays as deprecated legacy evidence until a later
   cleanup decision;
4. no legacy owner column is dropped in this migration.

## Fourteen-Table Transition Matrix

`Canonical` below always means nullable `canonical_owner_user_id uuid` during
expand and non-null `owner_user_id uuid REFERENCES app_users(id) ON DELETE
RESTRICT` after contract.

| Table | Current owner evidence | Legacy preservation | Canonical indexes / uniqueness | Same-owner references | Reader and writer cutover |
| --- | --- | --- | --- | --- | --- |
| `accounts` | nullable varchar `owner_user_id` | rename to `legacy_owner_user_id` only at contract | owner index; unique `(owner, id)`; unique `(owner, code)` | none | all account selectors and core/entity writers require trusted owner |
| `asset_groups` | nullable varchar `owner_user_id` | rename at contract | owner index; unique `(owner, id)`; unique `(owner, name)` | none | dashboard/structure and core/entity writers become owner-scoped |
| `assets` | nullable varchar `created_by_id`, currently null | retain as deprecated legacy evidence | owner index; unique `(owner, id)`; no new ticker identity | optional `(owner, account_id)` and `(owner, group_id)` | dashboard/risk/snapshot reads and core/entity/price metadata writers propagate owner |
| `asset_group_members` | nullable varchar `owner_user_id` | rename at contract | owner index; unique `(owner, group_id, asset_id)` | required group and asset composite FKs | structure reads and membership writers require owner |
| `event_ledger_entries` | none | n/a | owner/date/type and owner/account/date indexes; unique `(owner, id)` | optional account, asset, group, and correcting-event composite FKs | return/movement readers and event import/commands require owner |
| `market_regime_daily` | none | n/a | index `(owner, date, account)`; deliberately no new natural unique | optional account composite FK | market-context reader filters owner; regime writer propagates owner |
| `goals` | nullable varchar `owner_user_id` | rename at contract | owner/target-date index | none | future goal readers/writers require owner |
| `transactions` | nullable varchar `owner_user_id` | rename at contract | owner/date index | optional account composite FK | cash-flow readers/imports require owner |
| `fixed_transactions` | nullable varchar `owner_user_id` | rename at contract | owner/active index | none | recurring-cash-flow readers/imports require owner |
| `monthly_incomes` | nullable varchar `owner_user_id` | rename at contract | unique `(owner, year, month)` | none | income readers/imports require owner |
| `account_balance_snapshots` | none | n/a | index `(owner, date)`; no new unique yet | none | history reader and future writer require owner |
| `daily_portfolio_snapshots` | none | n/a | index `(owner, snapshot_date, account)`; unique `(owner, snapshot_date, account, source)` | optional account composite FK; `all` may remain null | dashboard/history readers and snapshot writer partition by owner |
| `daily_position_snapshots` | none | n/a | owner/date index; partial unique `(owner, snapshot_date, account, asset_id, source)` when `asset_id IS NOT NULL` | optional account and asset composite FKs | movement/history readers and snapshot writer preserve unmatched legacy rows |
| `settings` | none | n/a | unique `(owner)` | none | settings read/import becomes exactly one row per owner |

The global `legacy_base44_id` unique indexes remain. Imported Base44 ids are
global source identities; new application rows use null.

## Same-Owner Relationship Contract

A simple FK such as `assets.account_id -> accounts.id` proves existence but
does not prove both rows have the same owner. The final model uses composite
keys for user-owned relationships:

```text
child (owner_user_id, foreign_id)
  -> parent (owner_user_id, id)
```

Parent tables receive unique `(owner_user_id, id)` keys. All financial FKs use
`ON DELETE RESTRICT`; owner reassignment is not an implicit cascade operation.
PostgreSQL `MATCH SIMPLE` is retained so a nullable resource id remains valid.

| Child | Parent | Null behavior |
| --- | --- | --- |
| `assets.account_id` | `accounts` | nullable in schema |
| `assets.group_id` | `asset_groups` | nullable |
| `asset_group_members.group_id` | `asset_groups` | resource id non-null |
| `asset_group_members.asset_id` | `assets` | resource id non-null |
| `event_ledger_entries.account_id` | `accounts` | nullable |
| `event_ledger_entries.asset_id` | `assets` | nullable for legacy-only events |
| `event_ledger_entries.group_id` | `asset_groups` | nullable |
| `event_ledger_entries.corrects_event_id` | `event_ledger_entries` | nullable self-reference |
| `market_regime_daily.account_id` | `accounts` | nullable in current schema |
| `transactions.account_id` | `accounts` | nullable for non-portfolio cash flow |
| `daily_portfolio_snapshots.account_id` | `accounts` | nullable for aggregate `all` rows |
| `daily_position_snapshots.account_id` | `accounts` | nullable contract retained |
| `daily_position_snapshots.asset_id` | `assets` | nullable; 52 imported rows depend on this |

The application must validate the same relationships before the constraints
are installed. Constraints are defense in depth, not the first place a user
learns that a reference belongs to another tenant.

## Uniqueness Decisions

### Approved tenant-aware identities

- accounts: `(owner, code)`;
- groups: `(owner, name)`;
- memberships: `(owner, group_id, asset_id)`;
- monthly incomes: `(owner, year, month)`;
- portfolio snapshots: `(owner, snapshot_date, account, source)`;
- mapped position snapshots: `(owner, snapshot_date, account, asset_id, source)`
  with `asset_id IS NOT NULL`;
- settings: one row per owner.

### Deliberately not invented

- `market_regime_daily`: current data has three duplicate date/account groups;
  a writer/source identity decision is required first;
- `account_balance_snapshots`: dates are currently distinct, but no reviewed
  source/idempotency key exists;
- `assets`: ticker is not a stable unique identity across account/market;
- events, goals, transactions, and fixed transactions: UUID and legacy source
  identities are sufficient for this phase.

## Staged Migration Sequence

### 1. Expand

1. Create `app_users` and `auth_identities` only.
2. Add nullable `canonical_owner_user_id` to exactly the 14-table whitelist.
3. Add ordinary single-column canonical-owner indexes.
4. Deploy nothing that assumes the column is populated.

No owner row or backfill occurs in expand.

### 2. Writer safety

Choose and verify one:

- deploy owner-aware dual-write behavior for every listed writer; or
- freeze all user-owned writers for the short backfill/cutover window.

Shared market-data writers remain active because they do not touch the 14
user-owned tables. A partial mix of owner-aware and ownerless writers is not
allowed.

### 2b. Initial owner provisioning

After expand and writer safety, a separate approved operation creates exactly
one `app_users` row with an explicitly reviewed UUID and `provisioning` status.
It creates no `auth_identities` row and writes no financial table. Phase 1C
does not include this operation.

### 3. Guarded backfill

1. Run the command with no `--write` and an explicit initial owner UUID.
2. Review counts, nulls, relationship mismatches, and the sanitized manifest
   hash.
3. Run actual mode only with owner confirmation, matching manifest, and writer
   safety confirmation.
4. Use one transaction and a transaction-scoped advisory lock.
5. Assign null canonical owners only; reject any different canonical owner.
6. Re-run dry-run; it must report `already_assigned` with no changes.

### 4. Constraint preparation

1. Build parent and tenant-aware unique indexes with regular index DDL in a
   reviewed custom migration.
2. Add owner and same-owner FKs as `NOT VALID`.
3. Add temporary non-null checks as `NOT VALID` so new ownerless writes fail.
4. Validate FKs and non-null checks separately.
5. After new canonical tenant uniques and writer safety are verified, remove
   the superseded legacy/global natural unique indexes. This must occur before
   colliding two-user fixtures.

PostgreSQL applies a `NOT VALID` FK/check to new writes while deferring the
existing-row scan until `VALIDATE CONSTRAINT`.

### Drizzle execution contract

The installed PostgreSQL Drizzle migrator wraps pending migrations in a
transaction. PostgreSQL does not allow concurrent index creation inside a
transaction, so `03-contract.sql.txt` deliberately uses regular index DDL.
This is proportionate to the measured user-owned tables: the largest currently
has 486 rows, and the migration occurs before general multi-user access.

- Phase 1C uses normal `npm run db:generate` for the expand schema diff.
- Backfill is a separate parameterized Node command and one explicit database
  transaction; it is not a Drizzle schema migration.
- Constraint preparation, validation/replacement, and final contract are
  separate custom migrations generated with Drizzle's `--custom` workflow.
- Generate, review, commit, and apply one stage before generating the next;
  do not leave multiple contract stages pending for one `db:migrate` run.
- While constraint-preparation/validation migrations run, keep the active
  Drizzle schema at the expand representation. Their custom snapshots therefore
  remain expand-shaped while reviewed SQL advances the catalog in stages.
- For the final contract only, first change `src/db/schema.ts` to the reviewed
  final shape, then generate a custom migration. The installed Drizzle Kit
  writes the current schema snapshot even for a custom migration; the custom
  SQL performs the already-staged rename/normalization instead of trying to
  recreate constraints. Review the snapshot diff before applying it.
- Do not run a normal generated final-schema diff after staged catalog
  constraints exist; it would attempt duplicate DDL.
- Before each index stage, refresh row counts and rehearse on a preview branch.
  If regular index lock time is no longer acceptable, stop and design a
  separate non-transactional operator workflow; never add `CONCURRENTLY` to a
  migration run by the current Drizzle migrator.
- After every custom stage, compare the active Drizzle schema, migration
  journal/snapshot, and actual catalog before continuing.

### 5. Application cutover

1. Readers receive a server-derived `TenantContext` and filter owner first.
2. Writers reject browser owner input and write the trusted owner.
3. Two colliding synthetic users prove read/write isolation.
4. Basic Auth remains in place and no second real user is enabled.

### 6. Contract

1. Set canonical owner columns non-null after validated checks.
2. Rename old varchar owners to `legacy_owner_user_id`.
3. Rename canonical owners to final `owner_user_id`.
4. Align final constraint/index names and `src/db/schema.ts`.
5. Keep legacy evidence columns; do not drop them in this phase.

RLS is a later, independent migration after application isolation works.

## Rollback Boundaries

| Stage | Rollback |
| --- | --- |
| Plan | Delete/revise docs; no runtime effect |
| Expand | Drop only empty identity tables and nullable canonical columns after proving no consumer uses them |
| Dual-write before backfill | Roll back application writer; legacy storage remains authoritative |
| Backfill transaction | Any guard failure rolls back the whole transaction; no partial owners |
| Validated constraints before rename | Drop only new constraints/indexes; legacy columns/readers remain intact |
| Application cutover | Re-enable old reader/writer version while both owner columns still exist |
| Contract rename | Requires a reviewed reverse rename; legacy evidence is retained specifically for this recovery window |

No rollback uses `CASCADE`, row deletion, owner reassignment, or managed
`neon_auth` changes.

## Approval Checklist

Phase 1B is complete only when reviewers confirm:

- every current public table remains classified 14 user-owned / 7 shared / 1
  admin / 0 identity-system / 0 unresolved;
- every natural unique above is explicitly accepted or deliberately deferred;
- all listed parent-child relationships reject a cross-owner fixture;
- dry-run is the default and actual mode requires all confirmations;
- SQL contains no `neon_auth.*`, `CASCADE`, token, password, secret, or email
  columns;
- the 52 unmatched position rows remain representable;
- production schema, rows, readers, writers, Basic Auth, Cron, KIS, and RLS are
  unchanged by this planning phase.

## Next Narrow Slice

Phase 1C0 first hardens the schema-evolution response boundary documented in
`docs/auth-tenant-phase1c0-response-boundary.md`. It changes code and response
projections only, with no schema or row write.

Phase 1C implemented only the reviewed expand step:

- add `app_users` and `auth_identities` to the active Drizzle schema;
- add nullable `canonical_owner_user_id` plus regular indexes to the 14
  user-owned tables;
- generate and inspect one expand migration;
- apply no owner row and run no backfill;
- make no query, writer, auth UI, RLS, or Basic Auth change.

The applied scope and verification are recorded in
`docs/auth-tenant-phase1c-expand.md`. Writer safety, initial owner provisioning,
and guarded backfill remain separate approval gates.
