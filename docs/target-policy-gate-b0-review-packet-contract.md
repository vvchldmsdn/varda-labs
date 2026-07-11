# Target Policy Gate B0 Review Packet Contract

Last updated: 2026-07-11

Status: pure review-packet contract implemented. Gate A is approved. No Gate B
numeric vector is supplied or approved. This phase has no database read/write,
provider call, route, UI, schema, migration, resolver, or allocator connection.

The production holding-universe evidence boundary is now documented separately
in `docs/target-policy-gate-b1-holding-universe-contract.md`. B0 is not yet
composed with that adapter, so its production-approval prohibition remains.

## Product Question

> How can one complete, user-supplied account vector be validated and bound to
> an exact approval reference without generating or approving its weights?

`buildTargetPolicyReviewPacket` accepts explicit review input only. It never
reads current raw target fields or fills a missing decision.

B0 validates completeness only against the caller-supplied holding universe.
It does not prove that this universe matches production DB state. The policy
therefore reports `caller_supplied_unverified`, and production approval remains
forbidden until a separately reviewed read-only universe adapter supplies and
proves the complete account holdings.

## Required Input

- one named account: `brokerage`, `isa`, or `irp`;
- one immutable `policyVersion`;
- one explicit `effectiveServiceDate` using the KST 07:00 service-day model;
- the complete current holding review universe with user-facing name, exact
  `(market, currency, ticker)`, and explicit buyability evidence;
- one explicit decision for every holding.

The three decision states are:

| Decision | Required weight | Meaning |
| --- | --- | --- |
| `positive_target` | integer 1-10,000 bps | Included in the vector and must be buyable. |
| `zero_target` | exactly 0 bps | Included in the vector with an explicit zero. |
| `excluded` | `null` | Outside the v1 vector and requires a nonempty review reason. |

An exclusion is not an automatic zero and is not silently passed to the
Additional Contribution allocator. Any future adapter must separately prove
that its valuation universe exactly matches the approved non-excluded vector.

An incomplete identity, including a tickerless holding, cannot enter a
reviewable packet. The current production evidence therefore must not be
turned into a Gate B vector automatically; the known incomplete identity must
first receive an explicit product decision outside this helper.

## Validation

The packet is `invalid` and has no vector hash when any of these conditions
holds:

- invalid account, policy version, or service date;
- empty current universe or decision list;
- missing holding name or incomplete instrument identity;
- unknown buyability or decision value;
- duplicate holding or decision identity;
- a current holding has no decision;
- a decision references an external instrument;
- a positive target is not a positive integer or is not buyable;
- a zero target does not carry exactly zero bps;
- an excluded row carries a weight or lacks an exclusion reason;
- non-excluded target rows do not total exactly 10,000 bps.

Missing decisions are never converted to zero. New or external instruments are
not admitted in v1. Equal splitting, normalization, and raw-target fallback are
forbidden.

## Canonical Serialization And Hash

A packet with no blockers is `reviewable`, never `approved`. Its canonical
serialization contains exactly:

1. approved policy id;
2. policy version;
3. named account;
4. effective service date;
5. the complete non-excluded vector sorted by market, currency, and ticker.

The SHA-256 `vectorHash` is calculated from that serialization. User-facing
names, raw evidence, prices, provider metadata, internal ids, and legacy ids
are excluded from the hash. Changing any approval metadata, instrument
identity, or target weight changes the hash and requires a new approval.

## Output Boundary

The review packet contains:

- `status`: `reviewable` or `invalid`;
- `approvalState`: always `unapproved` in B0;
- normalized account, version, and service date;
- sanitized holding rows and explicit decisions;
- counts and target total;
- canonical vector, serialization, and hash only when valid;
- deterministic fail-closed blockers.

It contains no UUID, Base44 id, owner evidence, provider value, price, quantity,
raw target field, or persistence metadata.

## Gate B Approval

Approval remains account-specific. A valid approval must name all of these:

- `policyVersion`;
- account;
- `effectiveServiceDate`;
- `vectorHash`;
- the complete vector represented by that hash.

Statements such as "use current targets", one approval for `all`, or approval
of only a hash without the full visible vector are insufficient.

No production packet exists yet because no account's numeric vector has been
provided and B0 has not yet been bound to the reviewed production-universe
adapter. B0 fixtures use synthetic values only.

## Verification

Fixture coverage includes:

- valid packet and unapproved state;
- order-independent serialization and hash;
- metadata or weight change invalidating the prior hash;
- missing, external, and duplicate instruments;
- non-buyable positive target;
- explicit zero and exclusion behavior;
- invalid totals and numeric values;
- same ticker separated by market and currency;
- invalid metadata and incomplete identity;
- no internal identifiers, raw target inference, I/O, or DML.

Only after one account packet receives explicit Gate B approval may a separate
pure resolver validation phase begin. Persistence and allocator integration
remain later, separately approved slices.
