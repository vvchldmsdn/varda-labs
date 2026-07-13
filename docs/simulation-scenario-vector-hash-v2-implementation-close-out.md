# Scenario Vector Hash v2 Pure Implementation Close-Out

Last updated: 2026-07-13

Status: `docs_only_local_implementation_close_out`

This record closes the approved local-only pure implementation slice for
`simulation_scenario_vector_hash_v2`. It records already completed source,
test, and verification evidence. It is not imported by code and is not a
runtime, approval, planner, repository, or persistence trust source.

## Evidence Chain

| Stage | Artifact | Pinned commit |
| --- | --- | --- |
| versioning decision | `docs/simulation-scenario-vector-hash-versioning-decision-packet.md` | `c9c44889dbbf9f8910b3856cb01dcbf48328815f` |
| local implementation packet | `docs/simulation-scenario-vector-hash-v2-implementation-packet.md` | `73069071cbaae1c0e96aee1fb8f2bf97c2307b5a` |
| pure implementation | seven-file source/test slice below | `07dae7a8289ff403d6583506ae05034ec8c68df9` |

The separate versioning approval record freezes v1 as legacy provenance and
defines v2 as a distinct exact-ASCII canonicalization policy. The implementation
commit does not edit, import, call, relabel, recalculate, or migrate v1.

## Closed Implementation Scope

The local implementation commit contains exactly these seven files:

1. `src/lib/simulation-scenario-vector-hash-v2-policy.ts`
2. `src/lib/simulation-scenario-vector-hash-v2-types.ts`
3. `src/lib/simulation-scenario-vector-hash-v2-validation.ts`
4. `src/lib/simulation-scenario-vector-hash-v2.ts`
5. `tests/fixtures/simulation-scenario-vector-hash-v2.mjs`
6. `tests/simulation-scenario-vector-hash-v2.test.mjs`
7. `tests/run.mjs`

The implementation is pure and in-memory. Its only built-in source dependency
is local `node:crypto` SHA-256. It has no database, filesystem, network,
environment, clock, random, locale, provider, planner, repository, runtime,
Next.js, React, API, UI, auth, writer, job, or Cron dependency.

## Implemented V2 Boundary

The implementation pins:

```text
hashVersion = simulation_scenario_vector_hash_v2
portfolioPathPolicyId = gross_normalized_buy_and_hold_v1
gate0ApprovalCommit = 652b9ea9c9b48f51dc4c68e8f148132ca8893d7e
maxVectorRows = 64
requiredWeightTotalBps = 10000
```

The completed boundary:

- accepts only exact plain outer and row records and an exact dense ordinary
  vector array;
- snapshots allowed data properties through descriptors without invoking
  getters, accessors, coercion hooks, or input iteration;
- rejects noncanonical scenario or instrument fields rather than normalizing,
  repairing, trimming, changing case, deduplicating, or inferring values;
- preserves explicit zero-bps rows, requires unique exact instrument
  identities, and requires an exact 10,000-bps total;
- rejects JavaScript negative zero before JSON can collapse it to numeric zero;
- applies one fixed unique blocker order and returns no canonical string or
  digest for invalid input;
- sorts a copied row array with exact ASCII `<` and `>` comparisons over
  `market`, `currency`, and `ticker`, without `localeCompare()`;
- builds canonical root and row values as new null-prototype records in fixed
  property order; and
- gives the canonical dense array an own non-enumerable `toJSON = undefined`
  property so inherited `Object.prototype.toJSON` and
  `Array.prototype.toJSON` hooks cannot change its JSON bytes.

The standard ECMAScript `JSON.stringify` intrinsic remains an explicit
assumption. The implementation does not claim to recover from replacement of
the global intrinsic itself or to make hostile Proxy traps pure.

## Pinned Synthetic Evidence

The synthetic punctuation fixture uses the source identities:

```text
us / USD / A:B / 5000
us / USD / A.B / 5000
```

V2 canonical order is `A.B`, then `A:B`. The verified canonical serialization
is exactly 393 UTF-8 bytes and produces:

```text
sha256:80282313cbdf944335ad0136fe9fa7120bacd8e95dcc159fd8472f215d9aabc1
```

This is synthetic implementation evidence only. It is not an approved
scenario, production vector, current holding, target, recommendation, order,
runtime input, or durable approval record.

## Completed Verification

The following checks completed against the implementation diff before the
local review commit:

| Check | Result |
| --- | --- |
| focused v2 test | `16/16` passed |
| full test suite | `617/617` passed |
| `npm run lint` | passed |
| `npm run build` | passed |
| `git diff --check` | passed |
| changed-file allowlist | exactly seven approved files |
| v1 source, fixture, and test diff | zero |
| forbidden dependency and boundary scan | no match |
| pinned serialization | 393 UTF-8 bytes, exact match |
| pinned digest | exact match |

Focused coverage includes input-order independence, ASCII punctuation order,
identity and weight hash sensitivity, explicit zero rows, empty/1/64/65-row
boundaries, duplicate identities, exact three-letter currencies, invalid
strings and weights, negative zero, fixed blockers, no hash on invalid input,
input immutability, descriptor-only accessor rejection, dense-array shape
enforcement, inherited numeric indices, inherited `toJSON` isolation, exact
prototype descriptor restoration, and frozen results.

No npm command was rerun for this docs-only close-out. The current change adds
only this evidence record and is checked through one-file diff and whitespace
review.

## V1 Non-Interference

`simulation_scenario_vector_hash_v1` remains frozen as legacy provenance.
This slice did not:

- edit its comparator, serializer, fixtures, tests, hashes, or approval
  evidence;
- import or call v1 from v2;
- transform a v1 serialization or digest into v2;
- recalculate, relabel, rewrite, migrate, backfill, or reclassify v1 evidence;
  or
- claim that v1 and v2 are interchangeable because both use a `sha256:` text
  envelope.

## Explicitly Not Established

This close-out does not establish or authorize:

- planner readiness or planner source/test changes;
- runtime trust, scenario admission, execution-input authority, or simulation
  execution;
- durable hash-version binding, schema, migration, database SELECT or write,
  repository, seed, import, backfill, or data repair;
- writer, auth/session, API, UI, job, Cron, provider, deployment, or production
  data use; or
- optimizer, recommendation, rebalance, or order behavior.

The planner remains blocked until a separate docs-only review pins the exact
v2 module, export, hash version, and synthetic evidence, followed by a separate
implementation approval. Persistence remains blocked until a separate durable
hash-version schema and repository contract is reviewed and approved.

This Markdown close-out records local implementation evidence only. It grants
no additional authority beyond the explicitly approved pure implementation
slice.
