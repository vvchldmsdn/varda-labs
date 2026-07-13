# Scenario Vector Hash Versioning Approval

Last updated: 2026-07-13

Status: approved by explicit user decision on 2026-07-13. This record approves
only the docs-only versioning semantics reviewed at the pinned commit. It does
not authorize source, tests, database access, schema, runtime, or deployment.

## Reviewed Artifact

| Field | Approved value |
| --- | --- |
| decision packet | `docs/simulation-scenario-vector-hash-versioning-decision-packet.md` |
| reviewed commit | `c9c4488` |
| full commit | `c9c44889dbbf9f8910b3856cb01dcbf48328815f` |
| approval date | `2026-07-13` |

The reviewed decision packet retains its pre-approval status. This separate
record preserves the later user decision without rewriting the exact artifact
that was reviewed.

## Approved Semantics

The user explicitly approved this version boundary:

1. `simulation_scenario_vector_hash_v1` is frozen as legacy provenance.
   - Its comparator, serializer, hashes, fixtures, approval evidence, and
     durable evidence are not changed, recalculated, rewritten, migrated,
     backfilled, relabeled, or reclassified.
   - V1 is not the new cross-runtime admission hash.
2. A new deterministic hash is defined only as
   `simulation_scenario_vector_hash_v2`.
   - It uses exact ASCII code-unit canonical row order.
   - It uses the fixed canonical JSON and row property orders in the decision
     packet, UTF-8 JSON, and local SHA-256.
3. V2 does not call v1 and is not made by transforming a v1 serialized value or
   digest.
4. V2 persistence is forbidden until a later physical schema and repository
   review establishes an explicit durable hash-version binding.

## Explicitly Not Approved

This decision does not authorize:

- v2 policy, types, serializer, hash helper, fixture, or tests;
- any v1 source, fixture, hash, approval, or durable-data change;
- production or local database SELECT, write, schema, migration, seed, import,
  backfill, relabel, or data repair;
- planner implementation or planner source/test changes;
- repository, writer, auth/session, runtime, API, UI, job, or Cron; or
- simulation execution, optimizer, recommendation, rebalance, or order logic.

## Authorized Next Review

The next artifact may be an unapproved local-only v2 implementation packet
that defines:

- a new v2-only source boundary that does not import or edit v1;
- exact normalized input patterns, row and byte bounds, failure behavior, and
  deterministic ASCII comparison;
- synthetic-only canonical serialization and expected digest fixtures;
- focused purity, determinism, resource, and immutability tests; and
- a changed-file allowlist plus local verification commands.

That packet must return for explicit approval before source, fixture, test, or
test-runner files are changed. Database and persistence work remain later
independent gates.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
