# Auth/Tenant Phase 1D-B: Initial App-User Provisioning

Last updated: 2026-07-11

Status: dry-run-only gate completed. No app user was provisioned.

This phase adds a guarded command that can eventually create exactly one
initial `app_users` row. It validates the production preconditions now, but the
write path remains uncalled until a separate Phase 1D-C approval.

## Command Contract

The command entrypoint is `scripts/provision-initial-app-user.mjs`.

Dry-run is the default and requires an explicit UUID:

```powershell
node --no-warnings scripts/provision-initial-app-user.mjs --initial-owner-id <uuid>
```

There is deliberately no environment fallback, generated default, email,
provider subject, identity payload, or profile input. The command output never
contains the UUID. It contains only a one-way fingerprint and a sanitized
manifest hash.

This command is intentionally not exposed as an npm script. `npm run` may echo
forwarded arguments in its command banner, which is incompatible with the
UUID non-disclosure contract.

The dormant actual path requires both `--write` and the exact separate
confirmation value. Phase 1D-B does not authorize or invoke it.

## Fixed Row Shape

The only row that can be inserted is:

- caller-supplied UUID as `app_users.id`;
- `status=provisioning`;
- `role=user`;
- database defaults for timestamps.

It cannot create an admin or active user. It performs no `ON CONFLICT`, update,
repair, identity insert, or financial-table DML.

## Dry-Run Preconditions

The read-only preflight checks all of the following:

1. `app_users=0` for a new plan, or one exact idempotent
   `provisioning/user` row;
2. `auth_identities=0`;
3. all 14 canonical owner columns contain zero non-null rows;
4. identity columns, defaults, nullability, CHECK/FK constraints, and indexes
   match the Phase 1C contract;
5. all 14 canonical owner columns and indexes match the expand contract;
6. user-owned writers remain in shadow preparation mode;
7. no writer imports the shadow owner context at runtime;
8. no canonical owner appears in HTTP route input source;
9. no legacy-to-canonical owner inference path is detected.

The result is one of `planned_insert`, `already_provisioned`, or `blocked`.
For `planned_insert`, the manifest states an expected app-user count change of
`0 -> 1`, while all identity and financial planned writes remain zero.

## Actual-Path Safety Contract

The uncalled write path is fixed by tests:

- a transaction-scoped advisory lock is acquired in its own statement before
  the state recheck, so a waiting transaction gets a fresh READ COMMITTED
  snapshot after the first transaction commits;
- app-user, auth-identity, and canonical-owner counts are rechecked inside the
  transaction;
- one parameterized `INSERT INTO app_users` is the only DML;
- a different existing app user blocks the insert;
- an exact existing `provisioning/user` row is idempotent;
- a matching UUID with a different status or role blocks without repair;
- no `ON CONFLICT`, update, delete, cleanup, or backfill is present.

## Writer Status Policy

The trusted writer context now freezes status eligibility:

- `session`: active app users only;
- `migration_cli`: active, or explicitly approved provisioning users;
- `machine_job`: active app users only;
- `disabled`: rejected for every product and migration write.

This remains a pure contract in Phase 1D-B. Existing production writers do not
import or enforce it yet.

## Production Dry-Run Evidence

The production dry-run used an ephemeral UUID generated in process memory and
did not retain or print it. The result was:

- `planned_insert`;
- current/expected app users: `0 -> 1`;
- blocker count: 0;
- all schema and writer guards: true;
- planned app-user writes: 1;
- identity, financial, and canonical-owner planned writes: 0;
- committed: false;
- database side effects: false.

A subsequent tenant audit must continue to report:

- `app_users=0`;
- `auth_identities=0`;
- canonical owner non-null rows: 0;
- user-owned rows: 757.

## Next Gate

Stop after test, build, production dry-run, deployment, and invariant smoke.
Phase 1D-C requires an explicit user approval before calling the actual path.
That phase may create one `provisioning/user` row only.

Identity linking, activation, writer dual-write, owner backfill, owner-filtered
reads, social login, RLS, and Basic Auth removal remain separate later gates.
