# Synthetic Curated Admission Planner Contract Approval

Last updated: 2026-07-13

Status: approved by explicit user decision on 2026-07-13. This record approves
the reviewed docs-only planner semantics only. It does not authorize helper or
test implementation, schema, database access, auth runtime, repository,
writer, API, UI, or data admission.

## Reviewed Artifact

| Field | Approved value |
| --- | --- |
| contract | `docs/simulation-curated-approved-vector-synthetic-admission-planner-contract.md` |
| reviewed commit | `38e7981` |
| full commit | `38e7981cc2c2e61b9ce50c2e52edc09770b0d70a` |
| approval date | `2026-07-13` |

The reviewed contract intentionally retains its pre-approval draft status.
This separate record preserves the later user decision without rewriting the
exact artifact that was reviewed.

## Approved Semantics

The user explicitly approved this bundle:

1. The planner evaluates synthetic-only normalized in-memory assumptions.
   - It cannot establish actual admission, authorization, runtime readiness,
     database state, lock ownership, receipt state, transaction state, or
     commit authority.
2. Version 1 supports only `initial_approval` static preconditions.
   - Reapproval, supersession, revocation, operator mode, cancellation,
     invalidation execution, and receipt recovery are unsupported.
3. The only decisions are:
   - `synthetic_preconditions_satisfied`; and
   - `blocked`.
   Every result also preserves:
   - `mode=synthetic_only`;
   - `runtimeTrustStatus=not_established`; and
   - `readinessStatus=not_ready`.
4. Expiry evaluation uses only caller-supplied strict canonical UTC
   `issuedAt`, `expiresAt`, and `syntheticEvaluationTime` under:

   ```text
   issuedAt <= syntheticEvaluationTime < expiresAt
   ```

   No system clock or implicit current time is permitted.
5. Actor and durable-state evidence are unverified synthetic assumptions.
   - Durable state is represented only by the approved minimal enums.
   - Persisted rows, revision objects, receipts, lifecycle objects, physical
     identifiers, or database-shaped projections are not accepted.
6. Output excludes owner, provider/session, challenge material, hashes, vector
   rows, SQL, physical identifiers, and approval evidence.

## Explicitly Not Approved

This decision does not authorize:

- source, types, tests, fixtures, test-runner, or package-script changes;
- schema, SQL, DDL, migration, database read or write, seed, import, or
  backfill;
- auth/session resolution, identity linking, user activation, RLS, or
  operator mode;
- lock, receipt, transaction, repository, writer, runtime binding, API,
  Server Action, UI, job, or Cron; or
- simulation execution, optimizer use, recommendation, rebalance, or order
  behavior.

## Authorized Next Review

The next artifact may be an unapproved local-only implementation packet for:

- pure helper and readonly types;
- bounded deterministic serialization and local hashing;
- ordered blockers and immutable bounded output;
- synthetic-only fixtures;
- mutation/getter/resource-bound tests; and
- forbidden-I/O and forbidden-production-evidence assertions.

That packet must return for explicit approval before any source, test, fixture,
or test-runner file is changed. Schema, DB, auth, repository, writer, runtime,
API, UI, and real approval data remain outside that implementation slice.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
