# Scenario Vector Hash v2 Local Implementation Packet

Last updated: 2026-07-13

Status: `docs_only_implementation_plan_for_review_not_approved`

This packet proposes one local-only pure source/test implementation for the
docs-only versioning decision approved at
`c9c44889dbbf9f8910b3856cb01dcbf48328815f`.

It does not authorize source or test edits, database access, schema,
migration, repository, auth, runtime, API, UI, writer, job, or deployment.

## Objective

Implement a new deterministic v2 hash boundary without importing, calling,
editing, relabeling, or rewriting v1.

The proposed entry point is:

```text
createSimulationScenarioVectorHashV2(input)
```

It validates one bounded normalized in-memory scenario vector, canonicalizes a
copy with exact ASCII ordering, and returns either one v2 hash artifact or a
bounded invalid result. It performs no product admission or persistence.

## Proposed File Allowlist

Only these files may be created or changed after a separate implementation
approval:

| File | Purpose |
| --- | --- |
| `src/lib/simulation-scenario-vector-hash-v2-policy.ts` | Frozen version, policy bindings, caps, regexes, blocker order, and ASCII comparator. |
| `src/lib/simulation-scenario-vector-hash-v2-types.ts` | Readonly input rows and discriminated result types. |
| `src/lib/simulation-scenario-vector-hash-v2-validation.ts` | Closed-shape snapshot and fail-closed validation. |
| `src/lib/simulation-scenario-vector-hash-v2.ts` | Canonical JSON construction, UTF-8 SHA-256, and immutable result orchestration. |
| `tests/fixtures/simulation-scenario-vector-hash-v2.mjs` | Synthetic-only inputs plus pinned canonical JSON and digest. |
| `tests/simulation-scenario-vector-hash-v2.test.mjs` | Focused v2 policy, determinism, validation, and purity tests. |
| `tests/run.mjs` | One import line for the focused test file. |

No v1, planner, resolver, schema, migration, package, route, auth, component,
provider, or script file may change. If another file is required, the slice
stops and returns for review.

## Frozen V2 Policy

The proposed policy module pins:

```text
hashVersion = simulation_scenario_vector_hash_v2
portfolioPathPolicyId = gross_normalized_buy_and_hold_v1
gate0ApprovalCommit = 652b9ea9c9b48f51dc4c68e8f148132ca8893d7e
maxVectorRows = 64
requiredWeightTotalBps = 10000
```

These constants are part of v2 canonical JSON. They are not caller-supplied
overrides and are not read from Markdown, Git, environment variables, the
database, or runtime configuration.

## Exact Input Boundary

The entry point accepts one readonly object with exactly these fields:

```text
scenarioId
scenarioVersion
vector
```

Each vector row has exactly:

```text
market
currency
ticker
weightBps
```

No matrix, account, owner, tenant, approval revision, current holding, target,
price, FX row, provider value, or hash evidence is accepted.

The v2 boundary does not normalize. It does not trim, change case, coerce with
`String()` or `Number()`, fill, deduplicate, renormalize, or infer. Upstream
callers must supply exact normalized values.

## Exact Field Rules

The proposed v2 domain rejects rather than repairs:

| Field | Exact rule |
| --- | --- |
| `scenarioId` | 1-100 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]*` |
| `scenarioVersion` | 1-100 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]*` |
| `market` | 1-20 lowercase ASCII characters matching `[a-z][a-z0-9._:-]*` |
| `currency` | exactly three uppercase ASCII letters matching `[A-Z]{3}` |
| `ticker` | 1-50 uppercase ASCII characters matching `[A-Z0-9][A-Z0-9._:-]*` |
| `weightBps` | finite integer from 0 through 10,000 |
| vector row count | 1 through 64, including explicit zero-bps rows |
| total weight | exactly 10,000 bps |

V2's three-letter currency identity domain is deliberately broader than the
current planner's KRW/USD support. Hash identity and product support are
separate concerns. A planner may reject an otherwise hashable currency without
changing v2 canonicalization.

Every exact `(market, currency, ticker)` identity must be unique. Explicit
zero-bps rows remain present and affect the hash.

The fixed field and row caps bound the canonical payload; v2 does not add an
independent unreachable byte-limit policy.

## Closed Shape And Snapshot Rules

Validation must fail closed before hashing:

- the outer value and every row must have exactly `Object.prototype` as their
  prototype; null-prototype records and class instances are rejected;
- `vector` must be a real array;
- outer and row own keys must exactly match the approved fields;
- symbol, accessor, inherited replacement, and extra fields are rejected;
- vector length is checked before row snapshots, sorting, or hashing;
- allowed scalar data properties are copied once into new plain records;
- custom iteration, `toJSON`, `valueOf`, coercion hooks, and callbacks are not
  invoked; and
- no mutable input reference is retained in the result.

The helper does not attempt to make hostile JavaScript Proxy traps pure. Proxy
objects are outside the accepted plain-object boundary and must not be used as
synthetic fixtures or runtime authority.

## Deterministic Validation Result

The invalid blocker vocabulary and order are proposed as:

```text
invalid_input_shape
invalid_scenario_id
invalid_scenario_version
source_vector_empty
source_vector_row_cap_exceeded
invalid_instrument_identity
duplicate_instrument_identity
invalid_weight_bps
source_vector_total_not_10000_bps
```

Every applicable blocker appears at most once in that fixed order. Invalid
input returns a bounded result; expected input errors do not throw.

If shape or row-cap validation prevents safe row inspection, later row checks
are not evaluated. Hashing never runs for an invalid result.

`rowCount` is reported only when `vector` is a safely bounded real array.
`zeroWeightRowCount` and `totalWeightBps` are reported only when every row and
weight needed for those summaries is valid; otherwise they are `null`.

## Result Types

The success result is equivalent to:

```text
status = hashable
hashVersion = simulation_scenario_vector_hash_v2
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
rowCount
zeroWeightRowCount
totalWeightBps = 10000
canonicalSerialization
scenarioVectorHash
```

The invalid result is equivalent to:

```text
status = invalid
hashVersion = simulation_scenario_vector_hash_v2
blockers[]
rowCount = validated count or null
zeroWeightRowCount = validated count or null
totalWeightBps = validated total or null
canonicalSerialization = null
scenarioVectorHash = null
```

All results and nested arrays are frozen. `canonicalSerialization` is internal
hash evidence that contains scenario/vector data. This packet does not approve
returning it from an API, Server Action, page, log, metric, or database row.

## ASCII Comparator

The policy module exports a comparator over exact validated identities. It
compares:

```text
market, then currency, then ticker
```

For each ASCII string:

```text
left < right => -1
left > right => 1
otherwise continue
```

It must not use `localeCompare()`, `Intl.Collator`, locale options, numeric
collation, Unicode normalization, case folding, or platform defaults.

The hash function sorts a new validated row array. It never mutates the input.
Input row order therefore does not affect v2 canonical JSON or the digest.

## Canonical Serialization

The main module constructs a new plain object in exactly this property order:

```text
hashVersion
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
vector
```

Each sorted row is constructed in exactly this property order:

```text
market
currency
ticker
weightBps
```

`JSON.stringify()` is called only on these newly constructed plain records.
The exact returned string is encoded as UTF-8. Local `node:crypto` SHA-256 is
represented as:

```text
sha256:<64 lowercase hexadecimal characters>
```

No v1 source, serialized value, digest, comparator, or helper participates.

## Pinned Synthetic Fixture Candidate

The primary fixture is visibly synthetic and intentionally exercises the
punctuation-order defect:

```text
scenarioId = synthetic-punctuation-order
scenarioVersion = v2-fixture-1
input rows:
  us / USD / A:B / 5000
  us / USD / A.B / 5000
```

V2 canonical order is `A.B`, then `A:B`. The proposed exact canonical JSON is:

```json
{"hashVersion":"simulation_scenario_vector_hash_v2","portfolioPathPolicyId":"gross_normalized_buy_and_hold_v1","gate0ApprovalCommit":"652b9ea9c9b48f51dc4c68e8f148132ca8893d7e","scenarioId":"synthetic-punctuation-order","scenarioVersion":"v2-fixture-1","vector":[{"market":"us","currency":"USD","ticker":"A.B","weightBps":5000},{"market":"us","currency":"USD","ticker":"A:B","weightBps":5000}]}
```

The proposed expected digest is:

```text
sha256:80282313cbdf944335ad0136fe9fa7120bacd8e95dcc159fd8472f215d9aabc1
```

This candidate was calculated from the docs-only canonical definition. It is
not a production artifact or runtime trust source. If the approved
implementation produces any other byte string or digest, implementation must
stop rather than updating the fixture.

## Complexity And Resource Boundary

For at most 64 rows:

- validation and duplicate detection are `O(n)` time and `O(n)` memory;
- canonical sorting is `O(n log n)` time and `O(n)` bounded memory;
- integer accumulation is safe because the maximum inspected sum is bounded by
  64 x 10,000; and
- UTF-8 hashing runs once only after complete validation.

The implementation performs deterministic in-memory work only. The sole
allowed built-in dependency is `node:crypto` in the main hash module.

## Focused Test Matrix

The proposed tests cover:

1. exact canonical JSON and pinned digest for the punctuation fixture;
2. reversed input rows producing the same canonical JSON and digest;
3. `A.B` sorting before `A:B` without calling locale-sensitive APIs;
4. changes to scenario id, scenario version, market, currency, ticker,
   weight, or explicit zero row changing the digest;
5. explicit zero-bps row preservation and hash sensitivity;
6. empty, one-row, 64-row, and 65-row vectors;
7. duplicate exact identities and identical tickers in different markets or
   currencies;
8. invalid scenario strings, field casing, punctuation, lengths, and
   unsupported shapes;
9. non-number, non-finite, negative, fractional, above-10,000, and wrong-total
   weights;
10. exact three-letter currency acceptance independent of planner support;
11. fixed blocker order and no duplicate blockers;
12. no hash or canonical string on invalid input;
13. input and rows unchanged after success and failure;
14. frozen success and invalid results plus nested blocker arrays;
15. accessor and extra-key rejection without coercion hooks; and
16. no DB, filesystem, network, environment, clock, random, locale, logging,
   cache, provider, Next.js, React, route, auth, or runtime behavior.

The existing full test suite must continue to prove all v1 fixtures and hashes
unchanged. No existing v1 test is edited for v2.

## Forbidden Dependency Boundary

The new source import graph is limited to:

```text
node:crypto
the four new v2 modules
```

No new source may import:

- `simulation-scenario-vector-review-serialization.ts` or any other v1 module;
- `src/db`, Drizzle, Neon, schema, query, repository, or migration code;
- Next.js, React, routes, Server Actions, middleware, or components;
- auth/session, cookies, headers, admin, Basic Auth, or Cron code;
- provider, KIS, market data, filesystem, environment, fetch, timers, random,
  logging, or cache code; or
- planner, resolver, optimizer, simulation runtime, recommendation, rebalance,
  order, or job code.

## Verification Commands After Separate Approval

The later local-only implementation would run:

1. `node --no-warnings tests/simulation-scenario-vector-hash-v2.test.mjs`;
2. `npm run test`;
3. `npm run lint`;
4. `npm run build`;
5. `git diff --check`;
6. changed-file and import allowlist review; and
7. explicit confirmation that every v1 file is byte-unchanged from the pinned
   pre-implementation commit.

No database command, provider call, migration, dev server, browser, Vercel
deployment, or production smoke is part of this slice.

## Stop Conditions

Implementation stops and returns for review if:

- any v1 source, fixture, test, hash, approval evidence, or durable evidence
  would change;
- the exact synthetic canonical JSON or digest differs from this packet;
- v2 requires importing or calling v1;
- any input requires normalization, inference, fallback, or repair;
- any file outside the seven-file allowlist must change;
- a package dependency or script change is needed;
- a DB, filesystem, network, environment, clock, locale, provider, auth,
  runtime, API, UI, or writer dependency appears; or
- implementation would be exposed to a product or persistence boundary.

## Explicit Non-Actions

This packet does not:

- approve the seven-file source/test implementation;
- create a v2 module, fixture, test, or test-runner import;
- edit or recalculate v1;
- run test, lint, build, database, provider, migration, deployment, or smoke
  commands;
- implement durable hash-version storage, schema, repository, writer, planner,
  auth, runtime, API, UI, job, or Cron; or
- authorize simulation execution, optimizer use, recommendation, rebalance,
  or order behavior.

## Requested Review Decision

The user may approve, reject, or revise only this local-only implementation
plan:

1. the seven-file changed-file allowlist;
2. frozen v2 constants, exact input domain, and 64-row/10,000-bps bounds;
3. closed no-normalization validation and ordered invalid blockers;
4. exact ASCII comparator and input-order-independent canonical sorting;
5. exact JSON/row property order, UTF-8, local SHA-256, and pinned synthetic
   fixture/digest;
6. immutable bounded result and no-hash-on-invalid behavior;
7. focused test, complexity, dependency, verification, and stop boundaries;
   and
8. strict non-interference with v1 and all product/persistence boundaries.

Approval would authorize only the listed local source/test edits and local
verification commands. It would not authorize database reads or writes,
schema, migration, planner, repository, writer, auth, runtime, API, UI, job,
deployment, or production data.

This Markdown packet is not imported by code and is not a runtime trust source.
