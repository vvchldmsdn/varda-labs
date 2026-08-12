# Dynamic Portfolio Analysis Scopes

Status: Production schema applied; first owner-scoped holdings read slice in implementation

## Product Decision

`brokerage`, `isa`, and `irp` are not universal product enums. They are names
from the imported single-user data set. A user may have several brokerage
accounts, no retirement account, or a custom collection spanning accounts.

The product therefore needs three separate concepts:

1. **Custody account**: the real financial-provider account that owns a
   position. The target `accounts` model should represent this concept.
2. **Allocation group**: a classification or execution-policy bucket such as
   the existing `금` group. Existing `asset_groups` remains this concept.
3. **Portfolio group**: a user-created analysis scope used by dashboard,
   today movement, additional contribution, risk, Investment Lab, and
   simulation. This is a new concept and must not reuse `asset_groups`.

The UI may call a portfolio group `자산 그룹`. The database name should stay
distinct (`portfolio_groups`) so classification policies and analysis scope do
not become coupled.

The three imported `accounts` rows are not automatically accepted as verified
custody-account identities. They may represent the former screen's logical
`brokerage`/`isa`/`irp` split. Their current asset relationships remain intact
during transition, but each row must be classified before it becomes a durable
provider-account authority.

## Canonical Scope Identity

New links use a stable UUID-based `scope` search parameter:

| Scope | Canonical value |
| --- | --- |
| Every currently owned position | `all` |
| One custody account | `account:<account_uuid>` |
| One user portfolio group | `portfolio:<portfolio_group_uuid>` |

The old `account=brokerage|isa|irp|all` input remains a temporary compatibility
path. It resolves a code only through active accounts already filtered by the
authenticated owner. Unknown, duplicate, inactive, malformed, or conflicting
inputs are blocked; they never silently fall back to `all`.

`src/lib/portfolio-analysis-scope.ts` implements this pure boundary. The
`/portfolio/holdings` Server Component is the first consumer: it loads only the
authenticated owner's active accounts and portfolio groups, resolves the URL,
and then reads the selected holdings without a browser REST round trip.

## Proposed Normalized Tables

### `portfolio_groups`

- `id uuid` primary key
- `canonical_owner_user_id uuid` required
- `name varchar` required
- `description text` optional
- `sort_order integer` required
- `archived_at timestamptz` optional
- `created_at`, `updated_at`
- owner-qualified uniqueness and foreign keys
- active-name uniqueness per owner where practical

Deleting a group in the UI archives it. Historical calculations must retain
the group identity and its former membership.

### `portfolio_group_account_memberships`

- `id uuid` primary key
- `canonical_owner_user_id uuid` required
- `portfolio_group_id uuid` required
- `account_id uuid` required
- `valid_from date` required
- `valid_to date` optional, exclusive
- owner-qualified foreign keys to both parent rows
- one active membership per group/account pair

The future writer must also reject overlapping closed historical periods in
the same transaction. The initial indexes enforce one open period and unique
start dates; a PostgreSQL range exclusion constraint can be added later if the
write path requires direct SQL clients beyond the reviewed application writer.

Account membership automatically includes positions later added to that
account. This is the normal path for grouping several brokerages.

### `portfolio_group_asset_memberships`

- `id uuid` primary key
- `canonical_owner_user_id uuid` required
- `portfolio_group_id uuid` required
- `asset_id uuid` required
- `valid_from date` required
- `valid_to date` optional, exclusive
- owner-qualified foreign keys to both parent rows
- one active membership per group/asset pair

The same non-overlap writer invariant applies to direct asset periods.

Direct asset membership supports a thematic group that selects only some
positions. Nested groups are excluded from v1 to avoid cycles.

For a service date, holdings are the union of active account membership and
active direct-asset membership, deduplicated by `assets.id`. Membership periods
are effective-dated so changing a group today does not rewrite past charts.

## Snapshot And Calculation Semantics

- Daily position snapshots remain attached to real accounts and assets.
- `all` and portfolio-group history are derived from owner-scoped position
  snapshots plus membership periods for the requested service date.
- A materialized group snapshot is an optional later optimization, not the
  initial authority.
- Dashboard, today movement, risk, Investment Lab, and simulation consume the
  same resolved holdings universe for a scope.
- Additional contribution requires an approved target policy for the selected
  portfolio group. Existing account-bound target policies need an explicit
  migration; they must not be inferred from a matching display name.
- Current `asset_groups` stays available for allocation rules such as target
  bucket weight, FX exemption, MA exemption, and execution mode.

## Migration Sequence

1. **Foundation (complete)**
   - Add the pure canonical scope catalog, resolver, URL builder, and tests.
   - Keep all current routes and writes unchanged.
2. **Expand schema (complete)**
   - Add the three empty portfolio-group tables and owner-qualified integrity
     constraints. This change includes the local schema candidate.
   - Rehearse on a disposable Neon branch before Production migration.
3. **Seed compatibility groups (superseded by user onboarding)**
   - For each current owner, create groups corresponding to the current
     brokerage/ISA/IRP presentation only after reviewing membership dates.
   - Preserve the exact legacy split with direct asset membership first.
   - Link a real account by UUID only after its provider-account identity is
     established. Do not treat the imported code as a global enum or proof of
     a custody account.
4. **Server read path (holdings slice in implementation)**
   - Load the owner-scoped scope catalog in Server Components.
   - Resolve `scope`, then fetch independent sections in parallel.
   - Keep `account=` only as a redirect/compatibility input.
5. **Feature conversion**
   - Convert dashboard, today movement, history, portfolio structure/risk,
     Investment Lab, and simulation to the shared holdings resolver.
   - Convert additional contribution after target-policy scope migration.
6. **User management**
   - Add create, rename, archive, and membership editing with Server Actions or
     narrow mutation handlers protected by the current tenant context.
7. **Contract cleanup**
   - Remove fixed account constants and fixed snapshot checks only after old
     rows, jobs, routes, and target policies have migrated and been audited.

## Explicit Non-Goals Of This Change

- No database migration application or data seeding
- No Production or Preview database write
- No route, UI, snapshot, target-policy, or calculation behavior change
- No reinterpretation of legacy `asset_groups`
- No hard deletion of historical group evidence
