# Simulation Scenario Vector Review Packet Phase 0 Contract

Last updated: 2026-07-12

Status: pure review-packet helper and synthetic fixtures implemented after
explicit Gate 0 policy approval. Every result remains unapproved. No scenario
vector has received user approval, and no runtime aggregation is enabled.

## Product Question

> Can one explicit 10,000-bps Simulation scenario vector be reviewed against
> one caller-supplied execution-matrix instrument set without inferring,
> approving, persisting, or executing it?

The helper is `buildSimulationScenarioVectorReviewPacket` and its policy is
`simulation_scenario_vector_review_packet_v1`.

## Approved Policy Binding

The packet binds its canonical serialization to:

- portfolio path policy `gross_normalized_buy_and_hold_v1`;
- Gate 0 approval commit
  `652b9ea9c9b48f51dc4c68e8f148132ca8893d7e`;
- hash version `simulation_scenario_vector_hash_v1`.

This prevents a later document-semantics change from silently reusing an older
scenario hash under the same visible policy name.

## Explicit Input

- nonempty `scenarioId`;
- nonempty immutable `scenarioVersion`;
- complete caller-supplied execution-matrix identities;
- one explicit integer `weightBps` row for every matrix instrument.

Instrument identity is exact normalized `(market, currency, ticker)` and its
key format matches the Simulation matrix: `market|CURRENCY|TICKER`.

The pure helper does not receive a matrix object, `inputMatrixHash`, draw plan,
`drawPlanHash`, current holdings, target policy, account, tenant, price, or FX
row. The supplied universe is labeled `caller_supplied_unverified` and cannot
be treated as production evidence.

## Validation

The packet is invalid and has no canonical vector or hash when any condition
fails:

- invalid scenario id or version;
- empty matrix universe or weight vector;
- incomplete or unsupported-currency identity;
- duplicate matrix or weight identity;
- missing weight for a matrix instrument;
- weight for an instrument outside the matrix universe;
- non-finite, non-integer, negative, or above-10,000 weight;
- total other than exactly 10,000 bps.

Zero weight is explicit and valid. Missing instruments are never converted to
zero, external instruments are never appended, and valid rows are never
renormalized.

## Canonical Serialization And Hash

Reviewable rows are sorted by market, currency, and ticker. Canonical JSON
contains only:

1. hash version;
2. approved portfolio-path policy id;
3. approved Gate 0 commit;
4. scenario id and version;
5. complete ordered vector with integer `weightBps`.

SHA-256 over that JSON produces `scenarioVectorHash`.

Input order, display labels, matrix dates, matrix hash, draw-plan hash, prices,
returns, user identity, and internal ids do not affect the scenario hash.
Changing scenario metadata, instrument identity, or any weight does.

## Output Boundary

Output contains:

- `status`: `reviewable` or `invalid`;
- `approvalState`: always `unapproved`;
- policy and Gate 0 revision metadata;
- normalized scenario metadata;
- sanitized matrix-universe rows with proposed weights;
- aggregate row and weight counts;
- canonical vector, serialization, and hash only when reviewable;
- deterministic blockers.

It contains no matrix/draw-plan execution hash, UUID, Base44 id, owner evidence,
provider value, price, quantity, current weight, strategic target, or
persistence metadata.

## Verification

Fixtures cover:

- reviewable but unapproved exact-universe packet;
- pinned SHA-256 evidence;
- matrix and weight input-order independence;
- scenario metadata and weight hash sensitivity;
- missing, external, and duplicate instruments;
- incomplete and unsupported-currency identities;
- invalid metadata and numeric weights;
- explicit zero and exact-total behavior;
- same ticker separated by market and currency;
- no execution hashes, strategic target inference, I/O, DML, or approval.

## Next Gate

No numeric vector is approved by this phase. The user must explicitly approve
one complete visible vector, scenario id/version, and `scenarioVectorHash`.

Only after that separate approval may a pure Phase 1C helper validate the
approved vector against an actual Phase 1B result and bind
`scenarioVectorHash + inputMatrixHash + drawPlanHash` while calculating
normalized NAV.

Phase 1C, initial KRW scaling, current/target/equal-weight fallback, ISA target
reuse, DB/provider/UI/job/persistence, fan summaries, and optimizer behavior
remain forbidden.
