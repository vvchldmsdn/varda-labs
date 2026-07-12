# Simulation Execution-Input Authority Contract

Last updated: 2026-07-13

Status: `docs_only_draft_for_review_not_approved`

This document is a candidate contract for review. It does not approve or create
schema, migrations, constraints, indexes, transaction SQL, database reads or
writes, repository code, auth/session integration, runtime jobs, APIs, UI,
provider calls, Cron, seeds, imports, backfills, RLS, or production execution.

## Decision Question

Before selecting physical simulation tables, varda-labs must answer:

> Which server-side authority may supply each execution vector and parameter,
> what evidence is pinned to the run, and when may two vectors be compared under
> one stochastic experiment?

The approved-vector storage model answers only the curated-scenario part of
that question. It must not become a generic container for observed current
holdings, one-off user commands, or optimizer output.

## Existing Boundaries Preserved

This draft does not change these existing contracts:

- canonical instrument identity is `(market, currency, ticker)`;
- `scenarioUniverseHash`, `matrixRequestHash`, `inputMatrixHash`,
  `drawPlanHash`, and the existing curated `scenarioVectorHash` remain distinct
  bindings;
- the normalized buy-and-hold path begins at literal NAV `1`, has no
  rebalancing or cash, and does not model investor-level fees or taxes;
- matrix consumers fail closed on incomplete rectangular evidence;
- a future authenticated request must resolve to a server-derived
  `TenantContext` before any owner-scoped lookup;
- the curated approved-vector resolver remains owner-first, exact-selector
  scoped, lifecycle-aware, and audit-verified;
- current holdings, target weights, browser payloads, Markdown, Git commits,
  hashes alone, and newest/singleton rows are not curated approval authority.

Calculation readiness and runtime trust remain separate. A pure helper may be
ready while production execution remains unauthorized.

The existing `scenarioVectorHash` is not a source-neutral weight hash. Its v1
serialization includes `scenarioId`, `scenarioVersion`, portfolio-path policy,
Gate 0 approval commit, and canonical rows. This draft preserves that meaning
and never relabels a joint-universe projection as the original approved hash.

## Source Taxonomy

One admitted execution vector has exactly one source kind:

```text
observed_current_baseline
curated_approved_scenario
explicit_user_scenario
optimizer_candidate
```

Source kinds may share canonical vector serialization and hashing. They do not
share authority, lifecycle, provenance, or persistence semantics.

| Source kind | Authority | Required pinned provenance | Must not imply |
| --- | --- | --- | --- |
| `observed_current_baseline` | Server-derived owner/account portfolio evidence at one admitted as-of point | raw observed-evidence hash, versioned derivation hash, as-of service date, complete position universe, valuation and FX provenance, canonical source rows | approval, target policy, recommendation |
| `curated_approved_scenario` | Owner-first approved-vector repository result | exact scenario selector, approval revision, lifecycle/audit status, original approved `scenarioVectorHash` and rows | current holdings or a product default |
| `explicit_user_scenario` | Authenticated bounded command after server validation and canonicalization | sanitized command digest, admitted source universe, canonical submitted rows, command time and policy version | durable target, curated approval, recommendation |
| `optimizer_candidate` | Complete derived optimizer artifact | optimizer artifact binding, training window, as-of boundary, objective, constraints, costs, seed/draw binding and candidate rows | out-of-sample validity, recommendation, order authority |

No source can silently fall back to another source kind. A blocked curated
scenario cannot use current holdings; a blocked observed baseline cannot use a
target vector; an invalid explicit command cannot use equal weights; and an
optimizer failure cannot return the current vector under an optimizer label.

`sourceIdentity` is a routing descriptor, not replay evidence by itself:

- observed baseline: source kind, selected account, as-of service date, and
  valuation-basis policy;
- curated scenario: exact scenario id, version, and portfolio-path policy;
- explicit scenario: server command policy and admitted command identity;
- optimizer candidate: exact optimizer artifact identity and version.

Replay also requires the source-specific evidence binding below. No descriptor,
newest row, or internal id can substitute for that binding.

## Common Admission Envelope

Every future execution request needs one server-owned admission envelope with:

```text
tenantContextCapability
selectedAccount
sourceKind
sourceIdentity
asOfServiceDate
sourceUniverse
sourceVectorRows
sourceEvidenceBindingKind
sourceEvidenceBindingHash
executionProjectionUniverse
executionVectorProjectionRows
executionVectorProjectionHash
enginePolicyId
portfolioPathPolicyId
returnBasisPolicyId
matrixRequestIdentity
horizon
pathCount
seedPolicy
bootstrapPolicy
costPolicyId
resourcePolicyId
```

The envelope is a logical requirement, not a proposed database row. Internal
owner identifiers, session values, raw audit rows, and secrets are never part
of a product projection.

Admission requires:

1. a valid future `TenantContext` produced by an active identity/session path;
2. an allowed account selected within that owner boundary;
3. exactly one valid source-kind result;
4. a non-empty canonical source universe with no duplicate identity;
5. one canonical source vector row for every source-universe instrument,
   including explicit zero-weight rows, with an exact integer total of
   10,000bps;
6. one valid source-specific evidence binding that cannot be substituted by a
   hash from another source kind;
7. one separately derived execution projection for each admitted side; a
   standalone projection uses the source universe, while a joint comparison
   uses the exact union comparison universe for both sides;
8. one execution projection row for every projection-universe instrument,
   including explicit zero-weight rows, with an exact integer total of
   10,000bps;
9. a complete eligible return matrix and required FX evidence;
10. server-authorized execution parameters within explicit resource bounds;
11. exact source, projection, matrix, and draw bindings without substitution;
12. no unsupported cash, instrument, cost, or calculation semantic hidden by a
    fallback.

Basic Auth, a singleton database, a legacy owner string, an account code, or an
environment variable cannot stand in for `TenantContext`.

Candidate new bindings in this draft use lowercase `sha256:` over UTF-8
canonical JSON with fixed keys, fixed policy/version identifiers, canonical
decimal strings, and canonical row order. Unknown or extra fields are rejected;
objects are not hashed through runtime-dependent property enumeration.

## Observed Current Baseline

### Authority

The observed baseline is derived by a future server-only owner-scoped portfolio
read model. The browser may select an allowed account but cannot provide owner
ids, holdings, quantities, market values, weights, prices, or FX values.

The source read model must capture one coherent as-of portfolio:

- every included positive investment position in the selected account scope;
- canonical instrument identity and display metadata;
- quantity and valuation evidence at one admitted service-cycle boundary;
- date-specific FX evidence for non-KRW positions;
- explicit position and value totals before weight quantization;
- every exclusion or unsupported position with a stable reason.

For an aggregate `all` account, positions are loaded owner-first from every
included product account and then aggregated only by canonical instrument
identity. Account selection never substitutes for owner authorization.

### No Silent Universe Reduction

The server must not silently remove or zero:

- cash when the active path policy has no cash-return semantics;
- tickerless or ambiguous instruments;
- unsupported market or currency identities;
- positions missing eligible price or FX evidence;
- small positive positions that round to zero basis points;
- duplicate or conflicting position evidence.

Such evidence produces an admission preflight blocker. A future user-reviewed
repair, backfill, or explicit exclusion workflow may resolve it, but provider
calls and repair are never hidden inside execution.

### Observed Evidence Binding

An observed baseline needs a separate server-only
`observedBaselineEvidenceHash`. It is not `scenarioVectorHash` and cannot be
supplied by a browser. Its candidate canonical serialization is:

```text
hashVersion: simulation_observed_baseline_evidence_hash_v1
canonicalOwnerUserId
selectedAccount
asOfServiceDate
valuationBasisPolicyId
instrumentIdentityPolicyId
componentPositions:
  - account
    market
    currency
    ticker
    positionReferenceDate
    positionEvidenceKind
    quantityDecimal
    localPriceDecimal
    priceReferenceDate
    priceEvidenceKind
    fxRateDecimal
    fxReferenceDate
    fxEvidenceKind
    marketValueKrwDecimal
```

Component positions are aggregated before serialization by account plus
canonical instrument identity and sorted by account, market, currency, and
ticker. For `all`, per-account components remain in the evidence binding even
when the execution vector later aggregates the same instrument across accounts.
No database row id or legacy id participates in canonical order.

`positionReferenceDate` and `positionEvidenceKind` are required provenance, not
labels inferred from matching numbers. Candidate evidence kinds must distinguish
at least stored daily-position evidence, stored current-position valuation,
provider-backfilled position evidence, and reconstructed position evidence. A
future `valuationBasisPolicyId` must explicitly allow one or more exact kinds;
provider-backfilled or reconstructed evidence is blocked unless a separate
repair/provenance policy admits it. Equal quantities or values never allow one
kind or reference date to be substituted for another.

The candidate versioned values are:

```text
stored_daily_position_snapshot_v1
stored_current_position_valuation_v1
provider_backfilled_position_evidence_v1
reconstructed_position_evidence_v1
```

Their names and eligibility remain proposed, not approved. Missing, unknown, or
unversioned position provenance blocks observed-baseline admission.

Every decimal is a canonical finite base-10 string: no exponent, no sign for a
nonnegative field, no leading zero except before a decimal point, and no
trailing fractional zero. Quantity, local price, and KRW market value must be
strictly positive. Non-KRW FX must also be strictly positive. A malformed,
non-finite, zero, or negative required value blocks the evidence binding before
quantization.

For KRW instruments, `fxRateDecimal`, `fxReferenceDate`, and `fxEvidenceKind`
are literal JSON `null`; they are never inferred as numeric `1`. For non-KRW
instruments those fields are required. The owner UUID is server-only hash input
and never a product projection.

`valuationBasisPolicyId` must eventually fix price selection, FX selection,
date carry, multiplication, and rounding semantics. This draft does not choose
live versus close evidence or silently tolerate a recomputation mismatch.

The candidate decimal resource policy is
`observed_baseline_decimal_bounds_v1`:

| Field | Maximum precision | Maximum fractional scale |
| --- | ---: | ---: |
| `quantityDecimal` | 24 | 8 |
| `localPriceDecimal` | 24 | 6 |
| `fxRateDecimal` | 20 | 6 |
| `marketValueKrwDecimal` | 24 | 6 |

Precision counts digits only. Scale counts digits after the decimal point.
Canonical input exceeding either limit is blocked before hashing or arbitrary-
precision conversion. The valuation resource policy must also define a finite
maximum component-position count before runtime admission; this draft does not
select that count.

Changing account scope, service date, component quantity, valuation, price or FX
reference date, evidence kind, or valuation policy changes the observed-evidence
hash. The source vector and later execution projection pin this hash as their
origin; neither one can prove the underlying evidence without it.

### Candidate Weight Quantization

The candidate deterministic quantization policy is
`largest_remainder_exact_decimal_v1`:

1. consume only pinned canonical `marketValueKrwDecimal` evidence; never read
   `currentWeight`, target fields, legacy `weights_json`, or binary floating
   point values;
2. reject a malformed, non-finite, negative, or zero component valuation, an
   empty admitted universe, or a non-positive total;
3. aggregate positive KRW valuation by canonical instrument identity using exact
   decimal arithmetic;
4. align all canonical decimal values to their maximum fractional scale and
   convert them to nonnegative arbitrary-precision integers without rounding;
5. for each instrument calculate
   `scaledValue * 10,000 / totalScaledValue` using integer quotient and
   remainder;
6. assign the quotient as the initial basis-point weight;
7. distribute the remaining basis points by descending integer remainder;
8. break equal remainders by ascending canonical instrument identity;
9. retain every admitted identity exactly once, including a positive holding
   that receives an explicit zero-bps row.

This produces a deterministic 10,000bps vector without changing the admitted
universe. The quantization policy is proposed for review, not approved or
implemented by this draft.

### Observed Derivation Binding

Raw evidence and derived source weights remain separately identifiable. The
candidate `observedBaselineDerivationHash` canonical serialization is:

```text
hashVersion: simulation_observed_baseline_derivation_hash_v1
observedBaselineEvidenceHash
instrumentIdentityPolicyId
decimalBoundsPolicyId: observed_baseline_decimal_bounds_v1
quantizationPolicyId: largest_remainder_exact_decimal_v1
sourceVectorRows:
  - market
    currency
    ticker
    weightBps
```

Source rows are sorted by canonical instrument identity. The derivation hash is
the observed source's `sourceEvidenceBindingHash`; the immutable run input must
also preserve the raw `observedBaselineEvidenceHash`. Changing raw evidence,
decimal bounds, quantization policy, instrument policy, or any resulting row
changes the derivation hash.

The derivation hash proves only the deterministic transformation from pinned
raw evidence to source rows. It does not establish tenant authorization,
historical matrix readiness, stochastic execution, or product recommendation.

## Curated Approved Scenario

The curated source continues to use the separate approved-vector trust
boundary. Admission requires:

- a valid future `TenantContext`;
- owner-first repository lookup;
- one exact scenario id/version/policy selector;
- exactly one current approved revision or an explicit blocked result;
- lifecycle state `approved` and verified audit evidence;
- canonical rows whose recomputed hash matches the stored vector hash;
- pinning the exact approval revision and original approved
  `scenarioVectorHash` as the curated source binding.

Revocation or supersession affects future admission only. It does not mutate a
committed historical run. No approved research vector becomes an automatic
product default.

## Explicit User Scenario

An explicit scenario begins as untrusted request input. A future server command
must:

1. resolve the authenticated tenant and allowed account context;
2. reject owner ids, approval fields, hashes, prices, FX, or execution evidence
   supplied by the client;
3. normalize requested instrument identities against a server-supported
   universe;
4. validate integer `0..10,000` basis-point rows and exact 10,000bps total;
5. preserve explicit zero rows and reject duplicates or inferred weights;
6. calculate one `explicitUserCommandDigest` over the normalized command policy,
   source universe, and canonical submitted rows without calling it the existing
   `scenarioVectorHash`;
7. use that digest as the explicit source binding and pin the admitted command
   policy and source rows to the run.

This is one execution instruction. It does not create a durable target policy,
curated approval revision, optimizer result, recommendation, or order.

## Optimizer Candidate

An optimizer candidate remains derived evidence. It may enter a comparison only
when it pins:

- owner/account and as-of boundary;
- exact training universe and training window ending no later than the admitted
  as-of date;
- objective and objective version;
- long-only, concentration, turnover, FX, and cost constraints;
- optimizer algorithm/version and deterministic seed policy;
- complete candidate rows and candidate hash;
- one immutable optimizer artifact binding that covers those rows and all
  preceding optimizer evidence;
- the baseline, matrix, and stochastic draw evidence used for evaluation;
- completion and validation status with no partial artifact.

In-sample improvement does not establish recommendation status. Walk-forward
evidence and a separate recommendation boundary remain required.

## Baseline And Candidate Compatibility

Current-versus-candidate comparison requires common random numbers and one
joint experiment:

1. preserve each side's original source universe, source rows, and
   source-specific evidence binding unchanged;
2. form the sorted union of both canonical instrument sets as a separate
   execution projection universe;
3. represent each vector over that exact joint universe, preserving explicit
   zero-bps rows;
4. require complete price/FX matrix evidence for every joint-universe cell;
5. use the same return basis, matrix hash, stochastic engine, draw plan or shock
   artifact, seed policy, horizon, path count, and resource policy;
6. use the same path and cost semantics;
7. calculate one separate execution-vector projection hash per side while
   keeping projection-universe, matrix, and draw bindings equal;
8. compare only complete eligible artifacts.

The candidate projection serialization is:

```text
hashVersion: simulation_execution_vector_projection_hash_v1
instrumentIdentityPolicyId
portfolioPathPolicyId
projectionUniverseHash
vectorRows:
  - market
    currency
    ticker
    weightBps
```

Rows are sorted by canonical instrument identity. The projection hash is a
derived execution/comparison binding only. It does not include or replace the
source-specific observed evidence hash, approved `scenarioVectorHash`, explicit
command digest, or optimizer artifact binding.

`projectionUniverseHash` is not a new competing universe hash. It must be the
exact Phase 0B `scenarioUniverseHash` produced for the projection's instrument
set and return-basis policy. If Phase 0B cannot produce that ready binding, no
execution projection is eligible.

Adding joint-universe zero rows to a curated scenario would change the existing
scenario-vector serialization. Therefore the original approved rows and
`scenarioVectorHash` remain untouched, and only the separate execution
projection receives the added zero rows. The projection must never be written
back as an approval revision or presented as the approved vector hash.

The current pure normalized-NAV contract expects its existing scenario-vector
binding. It is not automatically authorized to consume this new projection
hash. A later separately approved adapter/hash-binding contract must define how
an admitted execution projection enters the pure calculation without
reinterpreting the curated approval hash.

Common-history intersection, row dropping, zero-filled returns, independent
draws, different horizons, different costs, or different model versions block
the comparison. A separately valid standalone run is not automatically a valid
paired comparison.

For future parametric-factor simulation, "same draw plan" means the same
versioned factor/residual shock artifact rather than the stationary-bootstrap
draw plan. Different engine families are separate model views and are not
pooled into one distribution.

## Execution-Parameter Authority

Each parameter must have one declared authority:

| Parameter | Candidate authority | Draft boundary |
| --- | --- | --- |
| account | bounded authenticated user selection | Server validates membership inside `TenantContext`; no owner input accepted. |
| source kind and selector | bounded user command plus server resolution | Client request is intent, not authority evidence. |
| as-of service date | server resolution from fixed policy or bounded user date intent | The server selects exact eligible stored evidence; no latest-row or current-date fallback when that boundary is unavailable. |
| engine and path policy | fixed server policy | Current pure bootstrap path remains gross normalized buy-and-hold only. |
| horizon | bounded user selection | Initial product candidates are 63 or 126 steps; final allowed set remains pending runtime resource review. |
| historical return window | server policy | Must supply the required `N + 1` points without all-history fallback. |
| path count | server policy | No client arbitrary count and no production default yet. Must satisfy all pure-helper and runtime resource caps. |
| seed | server generated, then pinned | Replay reuses the committed run binding; a client cannot choose or replace raw seed evidence. |
| expected block length | fixed versioned server policy | No implicit helper default; value remains pending. |
| matrix and draw hashes | server-derived artifacts | Never accepted from client or substituted from another run. |
| cost policy | fixed versioned server policy | Current no-rebalance path has no trading cost. Candidate trading comparisons remain blocked until cost semantics exist. |
| resource limits | fixed server policy | Timeout, memory, concurrency, work, and artifact-size caps remain pending. |

The pure one-million-point limits are hard upper bounds, not product defaults or
latency promises. For normalized NAV, `pathCount * (horizon + 1)` must remain
within the pure cap before any stricter runtime limit is applied.

## Job State And Artifact Eligibility

Job progress and calculation eligibility are independent:

| Job state | Allowed product evidence | Calculation artifact eligibility |
| --- | --- | --- |
| `admission_blocked` | stable blockers and repair guidance | blocked |
| `queued` | queued time and policy label | blocked |
| `running` | progress counters and current stage | blocked |
| `partial_diagnostics_only` | completed/failed work counts and failure reasons | blocked |
| `failed` | failure category and retry eligibility | blocked |
| `completed` | completion metadata | eligible only after complete shape, count, policy, and hash validation |

`partial_diagnostics_only` must never expose p10/p50/p90, representative paths,
terminal loss, drawdown summaries, current-versus-candidate differences,
optimizer inputs, or a reusable result artifact. Missing paths cannot reduce the
denominator. `completed` alone also does not prove calculation eligibility.

## Missing Evidence And Repair Boundary

Admission preflight should return a minimized, user-readable readiness result:

- source and requested account;
- admitted as-of date when one exists;
- candidate universe and coverage counts;
- unsupported or incomplete instrument reasons;
- missing price/FX/date evidence categories;
- parameter or resource blockers;
- whether a separately reviewed repair, backfill, or exclusion command could
  make the request eligible.

Execution must not call providers, interpolate values, average neighbors, carry
outside bounded policies, or silently exclude evidence. Repair can be offered
as a separate explicit workflow and must complete before a fresh admission.

## Logical Persistence Categories

The future model needs distinct logical categories even if implementation later
shares low-level serialization utilities:

1. curated approval revision and lifecycle audit;
2. immutable admitted run-input capture;
3. job/progress diagnostics;
4. complete calculation result summary;
5. large path/draw artifacts;
6. optimizer training and candidate artifacts;
7. walk-forward validation artifacts.

The approved-vector header is not a run-input row. A run-input row is not an
approval. Job state is mutable operational metadata, while admitted inputs and
committed results are immutable evidence. Physical relation, blob, transaction,
retention, and cleanup choices remain unapproved.

An admitted run input must preserve both the source-specific evidence binding
and any derived execution projection binding. Keeping only the projection hash
would lose source provenance; keeping only the source hash would not prove the
joint-universe comparison vector.

## Projection And Leakage Boundary

Future server loaders and repositories use explicit projections. Product DTOs
may expose user-relevant source labels, as-of dates, coverage, policy versions,
and result metrics, but must not expose:

- canonical owner UUIDs, auth identity ids, session data, or internal row ids;
- approval audit internals beyond safe scenario/version/revision labels;
- raw command envelopes, raw provider responses, or database rows;
- seeds when replay can be represented by a safe run identifier;
- secrets, tokens, headers, environment values, or provider credentials;
- dense path or matrix payloads in first-render HTML when a minimized summary
  is sufficient.

Server Components may render safe stored summaries directly. Interactive chart
or run controls can be isolated client components, but they cannot become input
authority or orchestrate multi-step provider/database mutation chains.

## Candidate Blocker Taxonomy

Any future executable contract should define a stable ordered blocker list. The
candidate categories are:

```text
tenant_context_unavailable
account_not_allowed
source_not_admitted
source_ambiguous
baseline_universe_empty
observed_evidence_binding_invalid
observed_derivation_binding_invalid
position_provenance_invalid
decimal_bounds_exceeded
unsupported_instrument
cash_policy_unavailable
valuation_evidence_incomplete
fx_evidence_incomplete
vector_shape_invalid
vector_total_invalid
source_binding_mismatch
execution_projection_invalid
execution_parameters_unapproved
matrix_incomplete
comparison_universe_incompatible
comparison_policy_mismatch
resource_limit_exceeded
partial_result_ineligible
```

This draft does not approve exact runtime names, ordering, or response shapes.
Blockers must not reflect owner ids, hashes, raw values, or secret-shaped input.

## Explicit Non-Actions

This draft does not:

- approve the candidate position-evidence enum or eligibility policy, decimal
  bounds, observed derivation binding, or quantization policy;
- select a current portfolio read table or query;
- select production horizon, path count, seed, block length, or resource limits;
- approve all VOO or any multi-instrument Investment Lab scenario as currently
  ready;
- enable cash, TWR, transaction costs, expected shortfall, CVaR, turnover,
  optimization, recommendation, rebalance, or order semantics;
- create a scenario, vector, run, job, result, optimizer, validation, or audit
  record;
- add or modify code, schema, SQL, migrations, indexes, constraints,
  repositories, APIs, pages, components, jobs, Cron, auth, ownership, or RLS;
- access production data or call any market-data provider.

## Review Decisions Before A Physical Contract

The next review should approve, reject, or amend:

1. the four-source authority taxonomy;
2. the observed-baseline as-of and complete-universe requirements;
3. the observed valuation-evidence binding and proposed exact-decimal
   bounds, versioned derivation binding, and largest-remainder quantization;
4. the source-preserving joint-universe execution projection and
   common-random-number comparison rule;
5. the diagnostics-only partial-result boundary;
6. the execution-parameter authority table;
7. the logical persistence-category separation.

For review, those seven decisions should be grouped without merging their
meaning:

1. source taxonomy plus observed complete-universe/as-of policy;
2. observed valuation-evidence binding plus deterministic exact-decimal
   bounds, position provenance, quantization, and derivation binding;
3. source-preserving joint-universe projection plus common-random-number policy;
4. partial eligibility, parameter authority, and logical persistence
   separation.

Only after those decisions should varda-labs choose whether the first physical
slice is curated approved-vector persistence or immutable admitted run-input
capture. Either choice remains separately gated and must not merge the two
authorities.
