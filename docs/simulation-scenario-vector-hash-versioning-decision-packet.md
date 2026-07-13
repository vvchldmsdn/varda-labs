# Scenario Vector Hash Versioning Decision Packet

Last updated: 2026-07-13

Status: `docs_only_decision_for_review_not_approved`

This packet proposes a version boundary after a determinism defect was found
before implementing the synthetic curated-vector admission planner. It does
not authorize source, tests, schema, database access, repository, auth,
runtime, API, UI, writer, migration, or data changes.

## Observed Defect

`simulation_scenario_vector_hash_v1` currently sorts vector rows with
JavaScript `localeCompare()` over `market`, `currency`, and `ticker`.

The proposed planner requires exact ASCII code-unit canonical order. Those
orders differ for identities already allowed by the repository's punctuation
rules. For example, in the current Node runtime:

```text
ASCII order: A.B, A:B
v1 localeCompare order: A:B, A.B
```

Validating ASCII order before calling v1 does not make v1's internal sort a
no-op. `localeCompare()` also delegates to locale-sensitive collation and is
not suitable for a new cross-runtime canonical hash.

## Corrected Versioning Principle

A hash version identifies serialization semantics over the complete allowed
input domain, not only the fixtures or durable rows that currently exist.

Even if every currently pinned hash happens to remain unchanged, replacing
v1's comparator would change the meaning of v1 for valid future punctuation
inputs. Compatibility checks are necessary evidence, but they cannot make two
different canonicalization algorithms one version.

Therefore v1 must not be corrected in place.

## Decision 1: Freeze v1

`simulation_scenario_vector_hash_v1` remains legacy provenance with its
existing implementation semantics.

The proposed decision forbids:

- changing the v1 comparator or canonical serializer;
- relabeling an ASCII hash as v1;
- recalculating, rewriting, migrating, or reclassifying an existing v1 hash;
- changing approved research-vector evidence or v1 fixtures to match v2;
- using v1 as the new cross-runtime admission-envelope hash policy; and
- treating v1 and v2 hashes as interchangeable because their digest text has
  the same `sha256:` shape.

This packet does not claim that v1 is cross-runtime deterministic. It remains
only the provenance algorithm for evidence already created under v1.

## Decision 2: Define Deterministic v2

The proposed new version is:

```text
simulation_scenario_vector_hash_v2
```

Its canonical row order is ascending exact ASCII code-unit order over:

```text
market, then currency, then ticker
```

The comparator uses explicit `<` and `>` checks over already validated ASCII
strings and returns `-1`, `0`, or `1`. It must not use:

- `localeCompare()` or `Intl.Collator`;
- locale options or platform-default collation;
- Unicode normalization or case folding;
- numeric collation; or
- trimming, case conversion, deduplication, or input repair.

The complete canonical JSON property order is proposed as:

```text
hashVersion = simulation_scenario_vector_hash_v2
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
vector
```

`vector` contains every already validated row, including explicit zero-bps
rows, sorted by the v2 comparator. Each row uses this property order:

```text
market
currency
ticker
weightBps
```

`JSON.stringify()` over a newly constructed plain object in that exact order,
encoded as UTF-8, is hashed with local SHA-256 and represented as:

```text
sha256:<64 lowercase hexadecimal characters>
```

The v2 serializer does not call v1 and does not derive v2 by modifying a v1
serialized string or digest.

## Policy And Input Boundary

V2 remains bound to the separately approved portfolio-path policy and Gate 0
commit supplied by its future implementation packet. This decision does not
select a runtime scenario, vector, tenant, approval row, or execution input.

The serializer consumes normalized, validated in-memory values. Validation
must reject unsupported shape, over-limit rows, duplicate identities, invalid
weights, noncanonical identifiers, and totals other than 10,000 bps before the
hash becomes admissible evidence. The exact source/test implementation gate
must pin field caps and failure behavior.

## Persistence Consequence

The current curated approval header stores `scenarioVectorHash` but does not
store a separate vector-hash version. A future system that can persist v2 must
not infer its version from the `sha256:` text or silently assume all hashes are
v2.

Before any v2 approval row or runtime write is allowed, a separate physical
schema and repository review must choose an explicit durable version binding,
such as a constrained `scenario_vector_hash_version` column or an equally
unambiguous approved policy binding. This packet does not choose or implement
that storage change.

Existing v1 rows, if any, must not be relabeled through a default, backfill, or
implicit version inference.

## Planner Dependency

The synthetic curated-vector admission planner must not implement vector-hash
validation until all of these gates complete in order:

1. this docs-only v1-freeze/v2-definition decision is explicitly approved;
2. a separate v2-only local source/test implementation packet is approved;
3. the v2 pure implementation and verification complete without changing v1;
4. the planner packet is revised to pin the verified v2 helper and hash
   version; and
5. that revised planner implementation slice receives separate approval.

Until then:

```text
runtimeTrustStatus = not_established
readinessStatus = not_ready
```

## Later V2 Implementation Gate

After this docs-only decision is approved, the next artifact may be a
v2-specific local-only implementation packet. It must define a narrow file
allowlist and require at least:

- a new v2 serializer/hash module that does not edit or call v1;
- exact ASCII punctuation-order fixtures such as `A.B` and `A:B`;
- input-order independence under the deterministic v2 comparator;
- scenario metadata, identity, zero-row, and weight sensitivity tests;
- pinned synthetic-only v2 canonical JSON and expected digest fixtures;
- explicit assertions that v1 source and pinned v1 hashes are unchanged;
- no locale, environment, clock, filesystem, network, database, provider,
  random, or process-global dependency; and
- focused tests followed by `npm run test`, `npm run lint`, and
  `npm run build`.

No production database read is needed to define or locally implement v2.
Persistence compatibility and any DB read remain later separate gates.

## Rejected Alternatives

This packet rejects:

- changing v1 in place when current evidence happens to be unaffected;
- selecting v1 versus v2 by attempting both hashes;
- silently falling back to v1 after v2 validation fails;
- writing both digests into one unversioned hash field;
- a wrapper that forwards to locale-sensitive v1;
- a wrapper that changes v1 ordering while retaining the v1 label; and
- introducing schema or runtime branching before the v2 pure boundary is
  separately approved and verified.

## Explicit Non-Actions

This decision packet does not:

- approve the proposed versioning decision;
- edit v1 or create a v2 source module, fixture, or test;
- recalculate, rewrite, migrate, approve, or persist any scenario hash;
- read or write production data;
- change schema, migration, repository, writer, auth, runtime, API, UI, job,
  or Cron behavior; or
- authorize planner implementation, simulation execution, recommendation,
  rebalance, optimizer, or order behavior.

## Requested Review Decision

The user may approve, reject, or revise only this docs-only decision:

1. v1 is frozen as legacy provenance and is not changed or used as the new
   cross-runtime admission hash;
2. deterministic exact ASCII canonicalization receives the separate version
   `simulation_scenario_vector_hash_v2`;
3. v2 uses the exact canonical JSON, row order, UTF-8, and SHA-256 semantics
   above without calling or rewriting v1;
4. no existing v1 evidence is recalculated, relabeled, backfilled, or migrated;
5. v2 persistence requires a later explicit durable hash-version binding; and
6. the planner remains blocked until the separate v2 pure implementation and
   revised planner approval gates complete.

Approval would authorize only these versioning semantics. Source, tests,
database reads or writes, schema, runtime, and deployment remain separate
gates.

This Markdown packet is not imported by code and is not a runtime trust source.
