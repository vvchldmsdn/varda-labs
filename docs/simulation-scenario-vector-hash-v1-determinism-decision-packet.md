# Scenario Vector Hash v1 Determinism Decision Packet

Last updated: 2026-07-13

Status: `docs_only_decision_for_review_not_approved`

This packet records a determinism defect discovered before implementing the
synthetic curated-vector admission planner. It proposes a compatibility-first
decision. It does not authorize source, test, schema, database, repository,
auth, runtime, API, UI, writer, migration, or data changes.

## Observed Defect

`simulation_scenario_vector_hash_v1` currently sorts vector rows with
JavaScript `localeCompare()` over `market`, `currency`, and `ticker`.

The proposed planner validates canonical order with exact ASCII code-unit
comparison. Those orders are not equivalent for all identities already
allowed by the repository's ASCII punctuation rules. For example:

```text
ASCII order: A.B, A:B
current localeCompare order: A:B, A.B
```

Validating ASCII order before calling the current serializer therefore does
not make its internal sort a no-op. A wrapper that merely forwards to the
current helper also preserves the defect.

`localeCompare()` additionally delegates to locale-sensitive collation. It is
not an appropriate primitive for a cross-runtime canonical hash contract.

## Existing Authority Boundary

The approved v1 review contract says rows are sorted by exact normalized
`market`, `currency`, and `ticker`, but it does not approve locale-sensitive
collation as part of the hash semantics.

The existing approved research vector uses `069500` and `QQQ`. Its relative
order is the same under the current comparator and exact ASCII comparison.
That observation is not enough to authorize a v1 implementation change. All
pinned fixtures and any durable rows must still be checked at the later
implementation and data-review gates.

## Proposed Decision

Choose a compatibility-guarded correction of v1 before the synthetic planner
implementation:

1. Define v1 canonical instrument order as ascending exact ASCII code-unit
   order over `market`, then `currency`, then `ticker`.
2. Implement comparison with explicit `<` and `>` checks returning `-1`, `0`,
   or `1`.
3. Prohibit `localeCompare()`, `Intl.Collator`, locale options, Unicode
   normalization, case folding, numeric collation, and platform defaults.
4. Preserve the existing canonical JSON property order, policy id, Gate 0
   commit, scenario metadata, complete vector rows, and SHA-256 representation.
5. Keep the version label `simulation_scenario_vector_hash_v1` only if the
   compatibility audit proves that every pinned approved artifact and fixture
   in scope retains its exact hash and no durable affected row requires legacy
   locale ordering.
6. If any pinned hash changes or any durable affected row exists, stop. Do not
   rewrite hashes or rows. Return for a separately versioned v2 hash and
   migration decision.

This treats ASCII ordering as a correction to the intended canonical
serialization, not as permission to silently replace established evidence.
The stop condition protects evidence that may already depend on the current
implementation.

## Why Not Retain Locale-Sensitive v1

Retaining the current implementation would require describing v1 as
environment-sensitive legacy evidence. It would remain unsuitable for a new
approval envelope or cross-runtime admission boundary and would force a v2
hash immediately.

That option adds two live hash policies before any curated approval writer
exists. The compatibility-guarded correction is narrower if and only if the
audit proves no evidence changes.

## Why A Wrapper Is Insufficient

A wrapper has only two behaviors:

- forwarding to the existing helper, which retains locale-sensitive sorting;
  or
- replacing the sort, which is the same semantic correction that requires
  explicit review.

The correction should be visible in the canonical serializer and pinned by
tests rather than hidden in a planner-only wrapper.

## Later Implementation Gate

After this docs-only decision is explicitly approved, a separate local-only
hash-hardening implementation packet must define a narrow changed-file
allowlist. At minimum it must require:

- the existing serializer comparator change;
- focused punctuation-order fixtures such as `A.B` and `A:B`;
- exact unchanged hashes for every existing pinned fixture and approved
  research artifact in scope;
- input-order independence under the deterministic comparator;
- no locale, environment, clock, filesystem, network, database, or provider
  dependency; and
- full `npm run test`, `npm run lint`, and `npm run build` verification.

Any production database compatibility read is a separate SELECT-only review
gate. This packet does not authorize it and does not infer current database
state from earlier zero-row evidence.

## Planner Dependency

The synthetic curated-vector admission planner must not implement vector-hash
validation until one of these is complete:

```text
approved and verified v1 ASCII correction
or
separately approved deterministic v2 policy
```

Until then:

```text
runtimeTrustStatus = not_established
readinessStatus = not_ready
```

## Explicit Non-Actions

This decision packet does not:

- approve this proposed hash decision;
- edit the existing serializer, helper, fixture, or test;
- recalculate, rewrite, migrate, approve, or persist a scenario hash;
- read or write production data;
- change the approved research vector or curated-vector schema; or
- authorize planner, repository, writer, auth, runtime, API, UI, job, or Cron
  behavior.

## Requested Review Decision

The user may approve, reject, or revise only this docs-only decision:

1. exact ASCII code-unit order is the intended deterministic v1 canonical
   row order;
2. a later v1 correction is allowed only after all pinned and durable evidence
   compatibility checks pass;
3. any hash difference or affected durable row forces a stop and separate v2
   decision; and
4. the synthetic admission planner remains blocked on the completed hash gate.

Approval would authorize only the semantic decision. Source, tests, database
reads or writes, schema, runtime, and deployment remain separate gates.

This Markdown packet is not imported by code and is not a runtime trust source.
