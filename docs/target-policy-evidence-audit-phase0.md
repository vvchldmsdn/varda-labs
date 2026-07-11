# Target Policy Evidence Audit Phase 0

Last updated: 2026-07-11

Status: implemented read-only evidence audit. This phase does not select a
target-policy authority, derive an effective target, create a 10,000-bps
vector, call the Additional Contribution allocator, or authorize any UI, API,
provider, schema, migration, or database write.

## Question

> Is the currently stored asset, group, and member policy evidence complete
> and internally consistent enough to become an explicit per-account target
> vector under a separately approved policy?

The answer is evidence classification only. `resolvable` means the raw shape
passes the current candidate checks; it does not approve a resolver or make
the candidate canonical.

## Evidence Sources

The audit reads these sources without joining their meaning implicitly:

| Evidence | Stored field | Phase 0 treatment |
| --- | --- | --- |
| Asset target | `assets.target_weight` | Standalone raw-percent candidate only. |
| Direct group membership | `assets.group_id` | Independent membership evidence. |
| Group target | `asset_groups.target_weight` | Group raw-percent candidate only. |
| Execution mode | `asset_groups.execution_mode` | `priority` and `gap_first` are execution policies, not target vectors. |
| Member membership | `asset_group_members.group_id` plus `asset_id` | Must agree with direct membership evidence. |
| Member ratio | `asset_group_members.allocation_ratio` | Fixed-ratio evidence only; never normalized or repaired. |
| Member priority | `asset_group_members.priority` | Presence is counted separately and never converted to a weight. |

Only named accounts `brokerage`, `isa`, and `irp` are classified. `all` is an
aggregate display scope and cannot be an actionable allocation account.

## Classification Rules

- `standalone_asset_target_candidate`: an ungrouped asset has a finite target
  between 0 and 100 percent.
- `group_fixed_ratio_candidate`: an active `fixed_ratio` group has a valid
  group target, complete positive member ratios, and an exact ratio sum of
  100 percent.
- `group_target_unresolved`: required group target, mode, or fixed-ratio
  evidence is absent or invalid.
- `execution_policy_not_target_vector`: `priority` or `gap_first` describes
  execution order but does not allocate the group target among members.
- `target_conflict`: positive asset and group targets overlap or structural
  membership evidence conflicts.
- `cross_account_scope_unresolved`: one group spans more than one named
  account.
- `unallocatable_target_candidate`: a positive target exists without the
  market, currency, and ticker identity required by the current allocator.

Missing, zero, non-finite, incomplete, or non-100 fixed ratios fail closed.
No equal split, market-value split, missing-ratio repair, or target
normalization is allowed.

## Production Audit Evidence

Command:

```text
npm run audit:target-policy-evidence
```

The 2026-07-11 read-only production run returned:

- audit execution: `passed`;
- policy readiness: `unresolved`;
- database rows before and after: 17 assets, 1 group, 1 member, unchanged;
- provider calls, writes, schema changes, routes, and allocator calls: zero;
- canonical target vector: `null`.

Account evidence:

| Account | Raw rows | Candidate state | Blocking evidence |
| --- | --- | --- | --- |
| brokerage | 11 assets, 1 active group, 1 active member | 10 standalone candidates; 1 execution-policy-only group | member ratio and priority absent; one positive candidate lacks the current allocator identity; candidate total not evaluable |
| ISA | 4 assets | 4 standalone candidates | raw candidate targets do not total 100 percent |
| IRP | 2 assets | 2 standalone candidates | raw candidate targets do not total 100 percent |

There were no global orphan reasons in this production run. This does not
resolve whether stored targets are per-account percentages, whole-portfolio
percentages, or legacy display policy.

## Required Decision Before Phase 1

A future resolver remains blocked until one reviewed policy explicitly states:

1. whether raw asset and group targets are scoped per named account or across
   the whole portfolio;
2. whether and when a group target supersedes member asset targets;
3. how `priority` and `gap_first` groups obtain an explicit member target
   vector, if they ever do;
4. whether the structurally unallocatable positive candidate is excluded,
   modeled as manually allocatable, or given an explicit supported identity;
5. whether incomplete per-account totals are invalid input or belong to a
   different target scope.

Any approved resolver must be a new pure, versioned, fixture-backed boundary.
It must emit an explicit 10,000-bps vector before the existing allocator can
run. Phase 0 does not choose that policy.

The non-authoritative policy proposal is documented in
`docs/target-policy-decision-contract-v1.md`. Its model and numeric vectors
remain separately gated and unapproved.
