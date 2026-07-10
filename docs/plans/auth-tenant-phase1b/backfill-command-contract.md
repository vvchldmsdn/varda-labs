# Guarded Initial-Owner Backfill Command Contract

Status: design only. The command does not exist yet and no owner UUID has been
approved.

## Proposed Interface

Dry-run is the default:

```text
npm run backfill:initial-owner -- --initial-owner-id <uuid>
```

Actual mode requires every gate:

```text
npm run backfill:initial-owner -- \
  --initial-owner-id <uuid> \
  --confirm-owner-id <same-uuid> \
  --confirm-manifest <dry-run-hash> \
  --confirm-writer-safety <freeze-ticket-or-dual-write-release> \
  --write
```

No environment variable, Basic Auth username, provider subject, legacy owner
string, email, or first database row may supply the initial owner implicitly.

## Dry-Run Contract

Dry-run performs SELECT-only checks and returns sanitized JSON:

```json
{
  "mode": "dry_run",
  "status": "ready_or_blocked",
  "classification": {
    "user_owned": 14,
    "shared_reference": 7,
    "admin_system": 1,
    "unresolved": 0
  },
  "tables": [
    {
      "table": "assets",
      "rows": 0,
      "nullCanonicalOwners": 0,
      "assignedToRequestedOwner": 0,
      "assignedToOtherOwner": 0,
      "relationshipMismatches": 0
    }
  ],
  "legacyOwnerDomain": {
    "nonNullRows": 0,
    "distinctValues": 0
  },
  "sharedAdminWriteTargets": 0,
  "manifest": "sha256:<sanitized-manifest-hash>",
  "blockers": []
}
```

Numbers above are schema examples, not current production counts. Output must
never contain row ids, provider subjects, legacy owner values, emails, tokens,
headers, credentials, or connection strings.

The manifest hash covers, in deterministic table-name order:

- schema/version marker;
- requested initial owner UUID hash, not the raw UUID;
- 14 / 7 / 1 / 0 classification counts;
- per-table row, null, requested-owner, other-owner, and mismatch counts;
- legacy-owner non-null and distinct counts;
- zero shared/admin write targets;
- writer-safety mode identifier.

Actual mode rejects a stale or mismatched manifest.

## Blocking Guards

The command stops before UPDATE when any condition is true:

1. arguments are unknown, duplicated, malformed, or missing;
2. `--write` is present without all four confirmation arguments;
3. initial and confirmation UUIDs differ;
4. the initial `app_users` row is absent;
5. initial user status is not `provisioning` or `active`;
6. public-table classification differs from 14 / 7 / 1 / 0;
7. any non-whitelisted table has `canonical_owner_user_id`;
8. any user-owned row is assigned to another canonical owner;
9. a writer freeze is not active and the deployed release is not verified to
   dual-write all user-owned writers;
10. any current parent reference is orphaned;
11. any post-assignment same-owner relationship would mismatch;
12. any approved tenant-aware unique would collide;
13. the manifest differs from the reviewed dry-run;
14. the transaction-scoped advisory lock cannot be obtained.

Current duplicate regime groups are reported but do not block owner assignment,
because Phase 1B deliberately does not add a regime natural unique.

## Actual-Write Contract

Actual mode:

1. opens one database transaction;
2. acquires `pg_advisory_xact_lock` for `varda:initial-owner-backfill:v1`;
3. reruns every dry-run guard inside that transaction;
4. records sanitized before-counts in transaction-local memory/temp state;
5. updates `canonical_owner_user_id` only where it is null, on exactly the 14
   whitelisted tables;
6. validates owner counts, row counts, same-owner relationships, and approved
   unique candidates;
7. proves the command's DML target set contains no shared/admin table;
8. commits only when every check passes.

Any exception rolls back all 14 updates. The command never inserts the initial
user, identity mapping, or financial row. Provisioning the reviewed app user is
a separate explicit operation.

## Rerun Semantics

| State | Result |
| --- | --- |
| all canonical owners null | dry-run `ready`; actual may assign after confirmations |
| mix of null and requested owner | blocked unless an approved interrupted-run investigation explains it |
| all rows assigned to requested owner | `already_assigned`; zero updates; success |
| any row assigned to another owner | blocked |
| no user-owned rows | no-op with explicit `empty` status |

A normal rerun after success must be read-only and report
`already_assigned`. It must not update timestamps or produce new identities.

## Writer-Safety Evidence

The confirmation value is not a free-form boolean. It must identify one
reviewed artifact:

- a maintenance/freeze ticket with all user-owned write routes disabled; or
- a deployed release whose tests prove canonical owner dual-write for every
  writer in the Phase 0 inventory.

Shared price, FX, ETF, benchmark, factor, and sync-run writes do not need to be
frozen because those tables are outside the user-owned whitelist. Their row
counts may legitimately change during the backfill and are not a manifest or
rollback guard.

## Logs And Exit Codes

Suggested exit contract:

| Code | Meaning |
| ---: | --- |
| 0 | dry-run ready, already assigned, or actual success |
| 1 | validation/blocker |
| 2 | invalid command arguments |
| 3 | database/auth availability failure before mutation |
| 4 | transaction rolled back after a failed in-transaction assertion |

Logs contain only command mode, status, sanitized counts, blocker codes, and
manifest hash. They never contain raw SQL parameters or owner values.
