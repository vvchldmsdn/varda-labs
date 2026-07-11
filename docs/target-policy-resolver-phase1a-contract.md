# Target Policy Resolver Phase 1A Contract

Last updated: 2026-07-11

Status: pure approval-evidence validation implemented. No database adapter,
approval persistence, schema, migration, route, UI, provider, allocator call,
recommendation, or order behavior is enabled.

## Purpose

Phase 1A answers one narrow question:

> Does a requested account policy still match one explicitly approved vector
> and the current sanitized holding universe for this service date?

It does not discover, infer, store, or approve a target policy.

## Trust Boundary

`ApprovedTargetPolicyPort` is a trusted input port, not a persistence model.
The pure resolver can verify internal consistency but cannot prove who approved
the input or where it came from.

The approval Markdown artifact is audit evidence only. Production code must
not parse it, import a test fixture, or hardcode the ISA vector. A future
trusted tenant-scoped adapter must supply approved policy data under a separate
schema, persistence, and activation gate.

For that reason, Phase 1A is not connected to a product route or allocator even
when it returns `ready`.

## Input Ports

The resolver receives three explicit values:

1. Request:
   - named account;
   - requested policy version;
   - current KST service date.
2. Approved policy evidence:
   - `approvalState=approved`;
   - approved policy id, account, version, and effective service date;
   - complete vector;
   - approved `universeHash` and `vectorHash`.
3. Current universe evidence:
   - named account;
   - sanitized user-facing name, market, currency, and ticker rows accepted by
     the existing B1 input boundary.

No internal id, owner field, quantity, price, raw target, group, provider, or
legacy evidence is accepted.

## Validation

The resolver reuses the existing pure boundaries:

- B1 rebuilds the current universe and recomputes `universeHash`;
- B0 rebuilds the complete vector against that universe and recomputes
  `vectorHash`.

`ready` requires all of these:

- explicit approved state;
- exact approved policy id;
- valid named account, with request, approval, and universe account equal;
- exact requested and approved policy version;
- valid effective and requested service dates;
- requested date on or after the effective date;
- reviewable current universe and exact `universeHash` match;
- reviewable 10,000-bps B0 packet and exact `vectorHash` match;
- no B0 or B1 blocker.

Input order cannot affect the result. There is no fallback to raw target fields,
current weights, equal weights, group ratios, partial vectors, old versions, or
the `all` aggregate.

## Output

Success returns:

- `status=ready`;
- normalized account, policy version, service date, and effective date;
- verified hashes;
- deterministic target rows containing only instrument key, market, currency,
  ticker, integer target bps, and structural buyability.

These rows are shaped for a future adapter to combine with current valuation
evidence. They do not include current value and do not call or import the
Additional Contribution allocator.

Failure returns:

- `status=blocked`;
- no vector;
- no evidence object;
- sorted stable blocker codes.

## Stable Blockers

- `target_policy_approval_missing`
- `target_policy_policy_id_mismatch`
- `target_policy_account_invalid`
- `target_policy_version_unavailable`
- `target_policy_effective_date_invalid`
- `target_policy_service_date_invalid`
- `target_policy_not_effective`
- `target_policy_universe_mismatch`
- `target_policy_vector_mismatch`
- `target_policy_total_invalid`
- `target_policy_instrument_unbuyable`

Any new, removed, duplicated, renamed-identity, or structurally changed holding
invalidates the approved universe. Display-name-only changes do not affect the
hash because names are review labels rather than instrument identity.

## Verification

Fixture coverage includes:

- the approved ISA `isa-v1` vector and hashes resolving to `ready`;
- order independence;
- unapproved state and wrong policy id;
- holding addition, deletion, identity change, and buyability change;
- vector weight, hash, missing-row, and duplicate-row drift;
- invalid total without normalization;
- account, version, effective-date, and service-date mismatch;
- blocked results returning no vector or evidence;
- no DB, file, document, provider, route, allocator, or write dependency.

## Next Gate

Phase 1A does not authorize runtime use. The next possible phase is a separately
reviewed trusted approved-policy adapter design. It must resolve tenant scope,
version selection, supersession, and persistence without reading Markdown or
accepting policy data from HTTP input.

Allocator connection remains a later gate after the trusted adapter and fresh
valuation-universe composition are independently validated.
