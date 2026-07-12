# Simulation Execution-Input Authority Approval

Last updated: 2026-07-13

Status: approved by explicit user decision on 2026-07-13. This record approves
the seven logical policy decisions in the reviewed contract. It does not
approve physical schema, database access, runtime execution, API, or UI work.

## Reviewed Artifact

| Field | Approved value |
| --- | --- |
| contract | `docs/simulation-execution-input-authority-contract.md` |
| reviewed commit | `87301b8` |
| full commit | `87301b821e62da7fb2ed538045213d580734c2e0` |
| approval date | `2026-07-13` |

The reviewed contract intentionally preserves its pre-approval artifact
status. This separate record documents the later human decision without
rewriting the exact reviewed artifact.

## Approved Decisions

Each underlying decision is approved independently. The four review groups in
the contract are presentation only and do not merge these meanings.

1. **Four-source authority taxonomy**
   - `observed_current_baseline`, `curated_approved_scenario`,
     `explicit_user_scenario`, and `optimizer_candidate` remain distinct
     authority and provenance kinds.
   - No source may silently fall back to another source kind.
2. **Observed-baseline complete-universe and as-of policy**
   - The server derives one owner/account-scoped complete positive-position
     universe at an admitted service-cycle boundary.
   - Position, price, and FX evidence must pass a versioned no-look-ahead
     mapping. Any allowed carry is bounded and preserves its original
     reference date.
   - Current/latest rows cannot substitute for unavailable historical as-of
     evidence.
3. **Observed valuation evidence and deterministic weight derivation**
   - Raw observed evidence and its derived source vector use separate bindings.
   - Position provenance, repair-lineage requirements, the reviewed exact-
     decimal bounds, and `largest_remainder_exact_decimal_v1` are approved.
   - Quantization consumes pinned KRW valuation evidence, totals exactly
     10,000 integer bps, and preserves explicit zero-bps rows for positive
     admitted holdings.
   - Provider-backfilled and reconstructed position evidence remain blocked
     until a later consumer-specific policy and new evidence-hash version bind
     their required lineage.
4. **Source-preserving joint-universe comparison**
   - Compared vectors expand onto the same sorted union universe while keeping
     their original source authority and evidence bindings distinct.
   - Both sides preserve explicit zero-bps rows and use the same eligible
     return matrix, draw or shock artifact, seed policy, horizon, path count,
     cost policy, and resource policy.
   - Common random numbers are required; independent draws, silent row drops,
     history intersection, and zero-return filling are not permitted.
5. **Diagnostics-only partial-result boundary**
   - `partial_diagnostics_only` may expose safe progress and failure details
     only.
   - It cannot supply distributions, paths, risk metrics, comparisons,
     optimizer input, or reusable calculation artifacts.
6. **Server-owned execution-parameter authority**
   - The server resolves admitted as-of dates and versioned execution,
     stochastic, cost, and resource policies.
   - Browser input expresses bounded intent only and is never execution
     authority.
7. **Logical persistence-category separation**
   - Curated approvals, immutable admitted run inputs, job diagnostics,
     complete result summaries, large calculation artifacts, optimizer
     artifacts, and walk-forward validation artifacts remain logically
     separate.
   - Approval lifecycle and mutable job state cannot be collapsed into one
     generic record.

## Deferred Values And Decisions

This approval does not select or imply:

- a maximum component-position count;
- exact position, price, or FX carry durations;
- an exact current-position read table, query, or source-kind eligibility
  adapter;
- production horizon, path count, seed, bootstrap block length, timeout,
  memory limit, concurrency, retry, or artifact-retention values;
- exact runtime blocker names, ordering, or response shapes; or
- which physical slice should be implemented first.

Each value must be selected by a later versioned server policy or separately
reviewed implementation gate. Existing historical return-matrix carry values
do not automatically become observed-baseline valuation values.

## Explicitly Not Approved

This decision does not authorize:

- tables, columns, constraints, indexes, migrations, or RLS;
- repository code, database reads or writes, imports, seeds, or backfills;
- tenant/auth/session activation or ownership enforcement;
- a runtime resolver, simulation run, provider call, job, or Cron change;
- API routes, pages, components, controls, or product projections;
- optimizer, recommendation, rebalance, order, cash, fee, tax, or transaction-
  cost behavior; or
- parsing this Markdown or Git commit metadata as runtime trust evidence.

## Authorized Next Gate

The next step may only prepare a reviewable selection between:

1. curated approved-vector physical persistence; and
2. immutable admitted run-input capture.

That selection must keep the two authorities separate and must return for
explicit approval before schema, migration, repository, database, auth,
runtime, API, UI, provider, job, or Cron implementation begins.

This Markdown record is audit documentation only. It is not imported by code
and is not a runtime trust source.
