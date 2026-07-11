# Target Policy Decision Contract v1

Last updated: 2026-07-11

Status: draft awaiting explicit user approval. This document proposes product
semantics only. It does not approve any account vector, make legacy target
evidence canonical, authorize a resolver, or allow UI, API, provider, schema,
migration, database write, or allocator integration.

Candidate policy id:

```text
account_scoped_explicit_instrument_targets_v1
```

## Decision Question

> What exact, reviewed target policy may supply the 10,000-bps input required
> by the Additional Contribution allocator?

The Phase 0 evidence audit established that current asset, group, and member
fields cannot answer this question automatically. The policy model and each
numeric vector therefore require separate approval.

## Proposed Product Semantics

If approved, v1 uses these rules:

1. Targets are user-owned and independently scoped to one named account:
   `brokerage`, `isa`, or `irp`.
2. `all` remains an analytical aggregate and never has an actionable target
   vector.
3. One approved vector maps exact normalized
   `(market, currency, ticker)` identities to integer `targetWeightBps`.
4. Every account vector covers its complete current valuation universe,
   contains no duplicate identity, and totals exactly 10,000 bps.
5. A positive target is allowed only for an existing v1 holding with complete
   identity and explicit buyability evidence.
6. Zero target is allowed for a held but non-buyable instrument. A positive
   target for a tickerless, unsupported, or otherwise non-buyable instrument
   blocks approval and runtime use.
7. Missing rows, proxy instruments, synthetic tickers, equal splitting, and
   automatic renormalization are forbidden.
8. Each approved account vector has an immutable `targetPolicyVersion` and an
   explicit `effectiveServiceDate` under the existing KST 07:00 service-day
   boundary.

Account labels are not tenant boundaries. When multi-user runtime ownership is
enabled later, each user must have separate approved vectors for their own
named accounts. This contract does not choose a storage model or modify the
currently frozen auth/ownership rollout.

## Authority Boundary

Only an explicitly reviewed vector may become canonical under this proposal.
These current fields remain non-authoritative evidence:

- `assets.target_weight`;
- `asset_groups.target_weight`;
- `asset_groups.execution_mode`;
- `asset_group_members.allocation_ratio`;
- `asset_group_members.priority`;
- snapshot-derived `target_weight_effective`;
- legacy ids, owner strings, or historical display values.

Raw evidence may later prefill a clearly labeled review proposal, but it must
never become an approved vector without an explicit user decision on every
instrument weight and version.

## Group Policy

Groups remain display and evidence structures in v1.

- `gap_first` and `priority` describe execution ordering and cannot generate a
  static target vector.
- `fixed_ratio` is also excluded from v1 authority. It may be considered in a
  later version only after account scope, complete positive ratios, exact
  ratio sum, and user approval are independently proven.
- A group target never overrides or fills an instrument target in v1.

## Version And Effective Date

Each named account requires its own nonempty, immutable
`targetPolicyVersion`. Approval must bind together:

- account;
- version;
- effective service date;
- complete ordered instrument vector;
- explicit buyability review;
- approval state.

A newer version supersedes an older version prospectively. It must not rewrite
or recalculate earlier portfolio history, risk evidence, daily snapshots, or
Investment Lab actual paths. A historical or counterfactual feature may use a
target policy only when its scenario explicitly names the version and as-of
date; it cannot silently apply the latest target to the past.

## Fail-Closed Runtime Contract

A future resolver, if separately approved, must return no vector and one
stable blocker when any gate fails:

| Condition | Required result |
| --- | --- |
| No approved vector for account/date | `target_policy_unavailable` |
| Version absent or not approved | `target_policy_version_unavailable` |
| Unsupported account or `all` | `target_policy_account_invalid` |
| Missing or duplicate instrument | `target_policy_universe_mismatch` |
| Sum is not exactly 10,000 bps | `target_policy_total_invalid` |
| Positive target is not buyable | `target_policy_instrument_unbuyable` |
| Conflicting effective versions | `target_policy_version_conflict` |

There is no fallback to raw target fields, current weights, equal weights,
group ratios, previous policy versions, or partial vectors.

## Two Separate Approval Gates

### Gate A: policy-model approval

The user must explicitly approve or reject the proposed
`account_scoped_explicit_instrument_targets_v1` semantics in this document.
Proceeding with migration work in general is not approval of this policy.

### Gate B: numeric-vector approval

After Gate A, each account still needs an explicit approval packet:

| Required field | Rule |
| --- | --- |
| account | exactly one of `brokerage`, `isa`, `irp` |
| targetPolicyVersion | nonempty and immutable |
| effectiveServiceDate | explicit `YYYY-MM-DD` service date |
| instrument rows | exact market, currency, ticker, and integer bps |
| total | exactly 10,000 bps |
| buyability | explicit for every positive target |

No current account has passed Gate B. This draft intentionally contains no
numeric vector.

## Follow-On Gate

Only after both gates pass may a separate **Target Policy Resolver Phase 1**
implement a pure, fixture-backed adapter from one approved account vector to
the existing Additional Contribution allocator input.

That later phase must still exclude persistence, UI, routes, providers,
recommendation language, MA120 or market overlays, order sizing, and sells.
