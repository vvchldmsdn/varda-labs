# Synthetic Curated Admission Planner v2 Dependency Approval

Last updated: 2026-07-13

Status: approved by explicit user decision on 2026-07-13. This record approves
only the docs-only v2 dependency and planner semantics reviewed at the pinned
commit. It does not authorize planner source, tests, commands, persistence,
runtime binding, product use, or deployment.

## Reviewed Artifact

| Field | Approved value |
| --- | --- |
| packet | `docs/simulation-curated-approved-vector-synthetic-admission-planner-implementation-packet.md` |
| reviewed commit | `44b9957` |
| full commit | `44b9957ed87255e4cec843fc3065e1bb81e165c0` |
| v2 pure implementation | `07dae7a8289ff403d6583506ae05034ec8c68df9` |
| v2 implementation close-out | `a6a9f56b132b2ea9222ccf325f16f4c05b107754` |
| approval date | `2026-07-13` |

The reviewed packet intentionally retains
`docs_only_implementation_plan_for_review_not_approved`. This separate record
preserves the later user decision without rewriting the exact artifact that
was reviewed or granting implementation authority.

## Approved V2 Dependency

The planner may use only this public value dependency:

```text
module: src/lib/simulation-scenario-vector-hash-v2.ts
export: createSimulationScenarioVectorHashV2
hashVersion: simulation_scenario_vector_hash_v2
portfolioPathPolicyId: gross_normalized_buy_and_hold_v1
gate0ApprovalCommit: 652b9ea9c9b48f51dc4c68e8f148132ca8893d7e
```

Type-only imports from that public module are limited to:

```text
SimulationScenarioVectorHashV2Input
SimulationScenarioVectorHashV2Result
```

All v1 modules and all v2 policy, validation, and internal type modules remain
forbidden direct planner dependencies.

## Approved Planner Semantics

The user explicitly approved these docs-only semantics:

1. Planner input must already be in exact ASCII canonical row order before the
   v2 helper is called.
   - The helper's input-order-independent sorting must not be used to repair,
     normalize, or hide an out-of-order planner input.
2. An invalid v2 result blocks planning.
3. A hashable v2 result is usable only when it matches the pinned:
   - hash version;
   - portfolio-path policy and Gate 0 approval commit;
   - scenario identity;
   - canonical row count and explicit zero-row count; and
   - exact 10,000-bps total.
4. The planner may consume only the matched `scenarioVectorHash` evidence.
5. `canonicalSerialization` must not be copied, returned, exposed, logged,
   persisted, or included in approval-envelope evidence.
6. The synthetic compatibility digest is pinned as:

   ```text
   sha256:80282313cbdf944335ad0136fe9fa7120bacd8e95dcc159fd8472f215d9aabc1
   ```

7. The planner remains:

   ```text
   mode = synthetic_only
   runtimeTrustStatus = not_established
   readinessStatus = not_ready
   ```

The pinned digest is synthetic compatibility evidence only. It is not an
approved vector, runtime input, durable approval, target, recommendation,
rebalance instruction, or order authority.

## Explicitly Not Approved

This decision does not authorize:

- planner source, types, tests, fixtures, or test-runner changes;
- npm, test, lint, build, database, migration, provider, deployment, or smoke
  commands;
- a local implementation commit or any push;
- database SELECT or write, schema, migration, seed, import, backfill, or
  production data use;
- repository, writer, auth/session, runtime, API, UI, job, Cron, or product
  admission; or
- simulation execution, optimizer use, recommendation, rebalance, or order
  behavior.

## Authorized Next Review

The revised eight-file local-only pure planner implementation plan may now
return for a separate approval decision. No source, test, fixture, test-runner,
command, or commit action is authorized until that implementation gate is
explicitly approved.

Runtime, persistence, durable admission, and product integration remain later
independent gates.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
