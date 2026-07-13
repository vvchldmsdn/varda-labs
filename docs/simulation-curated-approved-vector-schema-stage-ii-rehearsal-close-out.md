# Curated Approved-Vector Schema Stage II Rehearsal Close-Out

Recorded: 2026-07-13

Status: `docs_only_close_out`

This record closes the target-scoped rollback rehearsal for the curated
approved-vector schema. It records reviewed artifacts, execution evidence, and
non-claims only. It is not migration approval, runtime trust, repository
authority, or evidence about the whole database.

## Reviewed Artifact

Corrected Stage I and Stage II rehearsal code HEAD:

```text
e3904568e8a4a1c97ed519e3add3a7f797ff6791
```

Migration:

```text
drizzle/0017_workable_jimmy_woo.sql
```

CRLF/LF-normalized SHA-256:

```text
8f736749953d3c5f1f814a87a803729be1eb91932eb1694d64feb69e728930b8
```

The migration remained unapplied after this rehearsal. No product or runtime
module directly referenced the three new table exports.

## Invocation History

An earlier rehearsal invocation against commit `289cb5c` ended as
`failed_inconclusive`. It did not observe the expected rollback marker and did
not complete script-internal postflight verification. It is not treated as
successful rehearsal evidence.

After local-only error-envelope and catalog-assertion corrections, exactly one
retry invocation was executed against the reviewed HEAD above:

```text
npm run rehearse:curated-vector-schema -- --confirm-rollback-rehearsal
```

No second retry or separate manual database query was performed.

## Successful Target-Scoped Evidence

The corrected retry returned the following sanitized result:

```text
rehearsal: curated_approved_vector_schema
committed: false
expectedRollbackObserved: true
databaseSideEffects: false
statementsExercised: 11
```

The script verified:

- the three target tables were absent before the transaction;
- `app_users.id` had the expected UUID primary-key catalog shape;
- the pinned migration contained exactly three table statements, four named
  foreign-key statements, three named unique indexes, and one named regular
  index;
- the transaction contained only the approved DDL and rehearsal-local
  session guards;
- the created target tables had the pinned table, column, constraint, index,
  and zero-row evidence inside the transaction;
- the exact top-level marker arrived as an authentic driver
  `NeonDbError` and forced transaction rollback; and
- the three target tables were absent after rollback while the reviewed
  `app_users.id` catalog signature remained unchanged.

The close-out status is:

```text
successful_target_scoped_rollback_rehearsal
```

## Write And Deployment Boundary

The rehearsal performed no approval, vector, lifecycle-event, owner, auth,
product, or fixture DML. It did not run `db:migrate`, apply migration journal
state, push a branch, or trigger deployment.

The persistent database schema therefore remained unchanged by the successful
rehearsal. The three candidate tables remained absent after rollback.

## Explicit Non-Claims

This close-out does not prove or approve:

- global database equality or absence of unrelated concurrent activity;
- tenant, identity, session, owner, auth, writer, or RLS readiness;
- runtime repository trust or approval-vector lookup authority;
- product query, API, route, page, UI, job, or Cron integration;
- approval, vector, lifecycle-event, seed, import, or backfill rows;
- production migration safety beyond the reviewed target-scoped rehearsal;
- migration application, deployment success, or rollback of a persistent
  migration.

## Next Gate

Stage II is closed only for the reviewed target-scoped rollback rehearsal.
Stage III persistent empty-schema migration and deployment requires a separate
explicit approval pinned to the same corrected HEAD, migration path, and
normalized hash.

If Stage III is later approved, it must verify exactly one pending reviewed
migration, apply the migration before deployment-branch push, confirm the
three tables have the approved catalog shape and zero rows, and stop without
creating a repository, writer, authority row, or product integration.
