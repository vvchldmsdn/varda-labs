# Auth/Tenant Phase 1C: Expand-Only Migration

Last updated: 2026-07-11

Status: completed. The database-first expansion, schema deployment, and
production smoke verification all passed.

This phase adds only empty identity infrastructure and nullable transitional
owner columns. It provisions no user, assigns no owner, changes no product
query or writer, and does not enable authentication or RLS.

## Applied Scope

The generated migration is `drizzle/0016_ambiguous_vulcan.sql`.

It contains exactly:

- `app_users` and `auth_identities` table creation;
- the `auth_identities.app_user_id -> app_users.id` internal FK with
  `ON DELETE RESTRICT`;
- identity status, role, normalization, and disabled-state checks;
- three identity indexes;
- nullable `canonical_owner_user_id uuid` on the 14 user-owned tables;
- one regular canonical-owner index on each of those 14 tables.

`auth_identities.provider` must be non-empty, trimmed, and lowercase.
`provider_subject` must be non-empty and trimmed but is deliberately not
lowercased. Active identities require `disabled_at is null`; disabled
identities require a non-null disabled timestamp.

## Explicit Non-Scope

The migration contains none of the following:

- identity or owner row creation;
- owner backfill;
- row DML;
- financial-table owner FK or `NOT NULL`;
- existing column rename, drop, type change, or default change;
- tenant-aware unique replacement;
- query filtering or writer dual-write;
- auth SDK, login UI, session resolution, or Basic Auth change;
- RLS, policy, grant, role, or managed `neon_auth` change;
- Cron, KIS, FX, snapshot, recommendation, or simulation behavior change.

The current varchar owner columns and `assets.created_by_id` remain unchanged
as legacy evidence. Nullable asset/account/group relationships and all 52
unmatched legacy position rows remain representable.

## SQL Gate

`tests/tenant-expand-migration.test.mjs` freezes the migration allowlist. It
checks:

- two and only two identity tables;
- the exact 14 owner-column tables and 14 owner indexes;
- one and only one FK, owned by `auth_identities`;
- all required identity checks and indexes;
- no provider-subject lowercase rewrite;
- no DML, destructive DDL, RLS, grant, `CASCADE`, or `neon_auth` reference;
- exact alignment between the active Drizzle schema and generated SQL.

## Rehearsal And Deployment Order

No separate preview branch connection or Neon management credential was
available locally. Instead of skipping rehearsal, the exact 34 generated SQL
statements were executed in one production transaction with five-second lock
and 30-second statement timeouts. In-transaction assertions passed, then an
expected exception forced rollback.

The rollback rehearsal proved before and after state was identical:

- 22 public tables;
- zero identity tables;
- zero canonical owner columns;
- no committed database side effect.

The additive migration was then applied before deploying the new Drizzle
schema. This order preserves the previous production deployment because old
code ignores new nullable columns. Deploying the schema code before the DB
would have allowed whole-row server queries to request columns that did not yet
exist.

## Post-Expand Verification

Observed after `npm run db:migrate`:

- public tables: 24;
- classification: 14 user-owned, 7 shared, 1 admin, 2 identity, 0 unresolved;
- `app_users`: 0 rows;
- `auth_identities`: 0 rows;
- transitional owner columns: 14, all UUID, nullable, no default;
- transitional owner indexes: 14;
- non-null transitional owner rows: 0;
- user-owned rows: 757, unchanged;
- identity constraints: 9;
- financial canonical-owner constraints: 0;
- data-integrity failed error checks: 0.

The still-running previous production deployment passed authenticated and
unauthenticated route smoke against the expanded DB before the new schema code
was committed.

Commit `68fccf5` then deployed successfully through Vercel. Post-deployment
production smoke confirmed:

- entity GET routes return 401 without auth and 200 with admin auth;
- `/`, `/today`, `/history`, `/portfolio/structure`, `/portfolio/risk`,
  `/market`, and `/etfs` return 200 with Basic Auth;
- owner-key and configured-secret leaks are 0;
- entity row counts are unchanged;
- a repeated tenant-expand audit still reports empty identity tables and zero
  non-null canonical owners.

## Next Gate

Stop after deployment verification. Phase 1C does not authorize backfill or a
real user.

The next decision must separate:

- writer safety and owner-aware writer fixtures;
- explicit initial app-user provisioning and identity linking;
- guarded owner backfill;
- owner-filtered reader/writer cutover.

RLS and social-login production cutover remain later, independent gates.
