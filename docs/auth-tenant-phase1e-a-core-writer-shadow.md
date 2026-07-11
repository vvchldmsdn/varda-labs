# Auth/Tenant Phase 1E-A: Core Writer Canonical Shadow

## Scope

Phase 1E-A prepares only the Base44 core migration writer:

- `accounts`;
- `asset_groups`;
- `assets`;
- `asset_group_members`.

It does not enable a canonical owner write. Identity linking, user activation,
backfill, reader filtering, RLS, session auth, machine-job ownership, and all
other writers remain outside this phase.

## Tenant State Audit

`npm run audit:tenant-expand` is now phase-aware. It accepts only:

- `expanded_empty`: no app user, identity, or canonical owner assignment; or
- `provisioned_empty_owner`: exactly one `provisioning`/`user` app user, no
  identity, and no canonical owner assignment.

Any active or disabled user, admin user, identity row, canonical owner row, or
inconsistent status/role count fails the audit. The command remains read-only.

## Core Import Arguments

The existing legacy evidence contract remains:

- `--owner-user-id` or `IMPORT_OWNER_USER_ID` supplies the existing varchar
  evidence;
- the default remains `base44-import`;
- legacy writes still require the existing `--write` flag;
- no legacy value is interpreted as a canonical UUID.

The canonical shadow contract adds:

- `--canonical-owner-id <reviewed-uuid>` with no env or default fallback;
- `--approve-provisioning-owner` when that app user is still provisioning;
- direct `node --no-warnings` invocation for reviewed execution, because npm can echo
  forwarded arguments;
- a hard argument error when `--canonical-owner-id` and `--write` are combined.

The canonical ID, legacy owner value, Base44 row IDs, and internal UUIDs are not
included in output. A reviewed operator may keep the canonical ID in process
memory while invoking the direct entrypoint; it must not be committed or
written to a log file.

## Read-Only Plan

When a canonical owner is supplied, the command performs five SELECTs and
returns aggregate counts for every core table:

- `insert`: the future dual-write would create the row;
- `update`: the existing row has no canonical owner;
- `skip`: the existing row already has the requested canonical owner;
- `block`: the row has a different owner or violates a parent-child contract.

Accounts, groups, assets, and members are evaluated as one relationship graph.
A foreign-owned parent blocks its descendants. Existing asset account/group
references and member group/asset references must match the import graph.
Reassignment is never planned.

The returned contract always includes:

- `mode=shadow`;
- `source=migration_cli`;
- `actualWriteAllowed=false`;
- `canonicalOwnerWriteEnabled=false`;
- `databaseSideEffects=false`.

The legacy varchar owner columns and `assets.created_by_id` remain unchanged.
The shadow state loader contains SELECT statements only, and the existing core
DML contains no `canonical_owner_user_id` assignment.

## Completion Gate

Phase 1E-A is complete only when all of the following pass:

1. `npm run audit:tenant-expand` reports `provisioned_empty_owner`.
2. The core canonical shadow run reports `planned`, zero blocked rows, and zero
   database side effects.
3. `app_users=1`, `auth_identities=0`, and canonical non-null rows remain zero.
4. The legacy core dry-run and write guards remain intact.
5. Tests, lint, build, data-integrity audit, product route smoke, and entity API
   boundary smoke pass.
6. Product and API output contains no owner or secret fields.

## Still Forbidden

- canonical owner DML;
- partial writer activation;
- identity linking or app-user activation;
- backfill or repair;
- schema, FK, unique, NOT NULL, or RLS changes;
- request body, query, form, URL, or header canonical-owner input;
- daily snapshot or Cron ownership changes;
- cleanup and delete changes.

The next gate must decide between preparing the remaining user-owned writers
and a separately approved global writer freeze. Partial activation is not an
approved option.
