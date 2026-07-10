# Auth/Tenant Phase 1C0: Schema Evolution Response Boundary

Last updated: 2026-07-10

Status: completed code-only gate. Local audit, test, lint, build, and HTTP
smoke verification passed. Phase 1C remains a separate reviewed migration.

This slice changes no database schema or rows. It hardens public server output
before nullable owner columns are added to the active Drizzle schema.

## Problem

The four admin compatibility entity APIs used unqualified Drizzle calls:

```ts
db.select().from(table)
mutation.returning()
```

Those calls return every column in the active table definition. Adding
`canonical_owner_user_id` in Phase 1C would therefore change HTTP response
shape even when every new database value is null.

This is an output contract problem, not a reason to abandon additive schema
evolution. The response boundary must be explicit before the schema expands.

## API Response Contract

`src/db/entity-api-selections.ts` now owns explicit Drizzle projections for:

- accounts;
- assets;
- asset groups;
- asset group members.

Every entity GET, POST, PATCH, and DELETE response uses the same table-specific
projection. No entity route may use no-argument `.select()` or `.returning()`.

The response contract preserves every existing non-owner key. It deliberately
removes only current ownership evidence:

| Table | Excluded response field | Reason |
| --- | --- | --- |
| `accounts` | `ownerUserId` | legacy owner evidence, not an API DTO field |
| `asset_groups` | `ownerUserId` | legacy owner evidence |
| `asset_group_members` | `ownerUserId` | legacy owner evidence |
| `assets` | `createdById` | legacy Base44 ownership evidence |

Future `canonicalOwnerUserId`, final/legacy owner aliases, and provider subjects
are absent from the allowlists and cannot appear automatically.

`id`, relationship UUIDs, and `legacyBase44Id` remain in these admin-only
compatibility responses because they identify CRUD resources and imported
source rows. This does not authorize displaying them in product UI.

## Input Boundary

These routes remain machine-admin compatibility endpoints protected by
`ADMIN_JOB_SECRET`/`CRON_SECRET`. Existing legacy owner input is retained for
current import/admin compatibility in this slice.

They are not future user commands. A future session-authenticated command must:

- reject URL/body/header owner selection;
- derive `TenantContext.ownerUserId` on the server;
- verify every referenced resource belongs to that owner;
- write canonical ownership explicitly.

No entity route accepts or writes `canonicalOwnerUserId`,
`canonical_owner_user_id`, `legacyOwnerUserId`, or `legacy_owner_user_id`.

## Product And RSC Audit

The current product tree has no Client Component (`"use client"`) boundary.
Database access is server-only and product pages receive derived read models,
not entity API responses.

Whole-row selects still exist inside server-only calculation/query modules
where matching and financial calculations need existing columns. They are not
returned directly:

| Surface | Public boundary |
| --- | --- |
| `/`, `/today` | `DashboardData` and movement/detail DTOs |
| `/portfolio/structure` | `PortfolioStructureResult` |
| `/portfolio/risk` | normalized `PortfolioRiskReadModel` |
| `/history` | explicit history display rows |
| `/market` | explicit benchmark/regime/factor selections and display model |
| `/etfs` | explicit master/holding selections and grouped display rows |

The regression test scans product page/component source for owner/provider
field names. Existing route smokes remain responsible for rendered HTML/RSC
value leakage, including IDs used accidentally as React keys.

## Tenant Audit Preparation

The ownership policy now recognizes `identity_system` as a separate
classification:

- before Phase 1C: 22 tables and 0 identity-system tables;
- after atomic Phase 1C expand: 24 tables including `app_users` and
  `auth_identities`;
- exactly one of the two identity tables: hard failure.

Identity-system rows are not user-owned financial rows and do not receive an
`owner_user_id` column.

## Regression Contract

Automated tests require:

1. the exact non-owner response key sets remain frozen;
2. a synthetic row containing current/future owner fields projects none of
   them;
3. all eight entity route files use named projections;
4. no entity route contains no-argument `.select()` or `.returning()`;
5. no entity route accepts a future canonical/final owner override;
6. product render source contains no owner/provider field name;
7. current 22-table and future atomic 24-table tenant policies both resolve;
8. a partial identity-table expansion fails.

HTTP smoke additionally checks:

- entity GET without admin auth returns 401;
- valid admin auth returns 200 and exact response keys;
- major product routes return 200 under Basic Auth;
- owner/secret field names are absent;
- entity table row counts are unchanged.

## Verification

Verified on 2026-07-10:

- `npm run audit:tenant-ownership`: 22/22 public tables classified,
  `identity_system: 0`, `unresolved: 0`, read-only;
- `npm run audit:data-integrity`: 34 checks, 0 failed error checks;
- `npm run test`: 140/140 passing;
- `npm run lint`: passing;
- `npm run build`: passing with Next.js 16.2.10;
- `npm run smoke:entity-api-boundary`: four entity GET routes return 401
  without auth and 200 with admin auth, seven product routes return 200,
  owner/secret leaks are 0, and entity row counts are unchanged.

## Next Gate

After this slice is verified and deployed, Phase 1C may perform only the
reviewed expand migration:

- add empty `app_users` and `auth_identities`;
- add nullable `canonical_owner_user_id` to the 14 user-owned tables;
- add regular owner indexes;
- add only the identity table's internal FK;
- create no identity/owner row and run no backfill;
- add no financial FK, default, or non-null constraint;
- change no auth, query, writer, RLS, Basic Auth, Cron, KIS, or snapshot
  behavior.
