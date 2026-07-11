# Target Policy Gate B1 Holding-Universe Contract

Last updated: 2026-07-11

Status: read-only production evidence adapter implemented. Gate A remains
approved. The adapter does not supply or approve numeric vectors. Its fresh ISA
evidence was bound to the separately approved `isa-v1` vector recorded in
`docs/target-policy-isa-v1-gate-b-approval.md`. The adapter is not connected to
a route, UI, resolver, allocator, provider, persistence path, or schema change.

## Purpose

Gate B0 can validate a caller-supplied vector but cannot prove that its holding
list matches production. Gate B1 supplies that missing evidence for one named
account and binds a reviewable universe to a deterministic `universeHash`.

The adapter does not generate target weights. A future Gate B packet must bind
both the fresh `universeHash` and its separately reviewed `vectorHash`.

## Current-Holding Policy

The v1 selection criterion is explicit:

```text
assets.account = named account
AND (assets.quantity > 0 OR assets.fractional_krw_value > 0)
```

The query does not filter by asset type. This is intentional: an unknown or
tickerless positive holding must remain visible and block review instead of
being silently omitted. `all` is not a target-policy account and fails closed.

Only these fields are projected:

- user-facing name;
- normalized market;
- normalized currency;
- normalized ticker;
- derived structural buyability.

Internal ids, legacy ids, ownership fields, quantities, prices, raw targets,
groups, members, ETF metadata, live quotes, and provider evidence are not part
of the safe DTO.

## Structural Buyability

Buyability means target-policy structural eligibility, not verified broker
orderability or quote freshness.

The initial supported pairs are exactly:

- `korea:KRW`;
- `us:USD`.

A row is `buyable` only when it has a complete normalized
`(market, currency, ticker)` and one supported pair. Missing tickers,
unsupported markets or currencies, and mismatched market/currency pairs block
the entire account universe. No proxy ticker, automatic exclusion, zero target,
or market inference is allowed.

Duplicate complete identities also block the account and remain separate rows;
the adapter never merges them.

## Universe Hash

A reviewable account receives a SHA-256 hash over canonical JSON containing
only:

1. universe-policy version;
2. named account;
3. sorted normalized market, currency, ticker, and buyability rows.

Display names are visible review evidence but are excluded from the hash.
Blocked or empty universes have no canonical serialization and no hash.

## Ownership Boundary

The current production assets are still in the pre-enforcement single-dataset
phase. Gate B1 therefore remains an administrative review adapter and is not
connected to a product route. Before multi-user runtime use, the read must be
bound to an authenticated tenant scope; account names alone are not tenant
boundaries.

## Read-Only Audit

`npm run audit:target-policy-holding-universe`:

- reads the three named account universes with the same explicit criterion;
- runs the pure classifier and hash builder;
- reports reviewable and blocked accounts without altering blockers;
- checks `assets` row counts before and after;
- performs zero database writes, provider calls, schema changes, route calls,
  allocator calls, or raw-target reads.

An audit passes when the read boundary is unchanged. An account may still be
correctly `blocked`; that is product evidence, not an audit failure.

## Next Gate

For ISA, the user-supplied `isa-v1` vector passed Gate B after a fresh
`universeHash` match. Its next allowed step is a separate pure resolver
validation phase; runtime and allocator connections remain forbidden.

For any other reviewable account, the next step is user-supplied
`policyVersion`, `effectiveServiceDate`, and a complete integer-bps vector that
is reviewed together with the fresh `universeHash`.

If an account is blocked, especially by a tickerless holding, the process stops
for an explicit product decision. Resolver and allocator integration remain
forbidden before Gate B approval.
