# ISA Target Policy Gate B Approval

Last updated: 2026-07-11

Status: approved by explicit user decision on 2026-07-11. This artifact records
the approved review evidence only. It does not persist a runtime policy or
authorize resolver, allocator, UI, API, provider, order, schema, migration, or
database-write behavior.

## Approved Policy

| Field | Approved value |
| --- | --- |
| policy id | `account_scoped_explicit_instrument_targets_v1` |
| account | `isa` |
| policy version | `isa-v1` |
| effective service date | `2026-07-11` |
| target unit | integer basis points |
| target total | `10000` |

## Approved Vector

| Market | Currency | Ticker | Display name | Target bps |
| --- | --- | --- | --- | ---: |
| korea | KRW | 133690 | TIGER 미국나스닥 100 | 3500 |
| korea | KRW | 360200 | ACE 미국S&P500 | 3500 |
| korea | KRW | 475350 | RISE 버크셔포트폴리오TOP10 | 1000 |
| korea | KRW | 489250 | KODEX 미국배당다우존스 | 2000 |

Display names are review labels and are not part of either hash. The exact
instrument identity is `(market, currency, ticker)`.

## Approval Binding

Fresh production holding-universe evidence:

```text
universeHash:
sha256:3dfed5a3d43ae4531227b5b75fabb295c2575f7959261b530e05fdde14596c66
```

Canonical vector evidence:

```text
vectorHash:
sha256:85e6181e6e5f54ca9d1eda2cc8940c6cd576970a5f5136fdc6920227f200f2ca
```

The approval explicitly named the policy version, effective service date,
complete four-row vector, 10,000-bps total, `universeHash`, and `vectorHash`.

## Approval-Time Revalidation

Immediately after receiving approval,
`npm run audit:target-policy-holding-universe` was rerun against production:

- audit status: `passed`;
- adapter mode: read-only;
- ISA status: `reviewable`;
- ISA holdings: four;
- structurally buyable ISA holdings: four;
- observed `universeHash`: exact match with the approved hash;
- assets row count: 17 before and 17 after;
- database writes: zero;
- provider, schema, route, allocator, and raw-target calls: zero.

The B0 packet was recomputed from the approved values:

- status: `reviewable`;
- helper approval state: `unapproved` by design;
- vector rows: four;
- positive targets: four;
- zero targets and exclusions: zero;
- total: 10,000 bps;
- blockers: none;
- observed `vectorHash`: exact match with the approved hash.

The pure B0 helper never grants approval. This external artifact records the
user decision after B0 and fresh B1 evidence matched.

## Invalidation Rules

This approval is invalid for runtime resolution if any of these changes:

- account, policy id, policy version, or effective service date;
- any market, currency, ticker, or target weight;
- target total;
- the production holding universe or its `universeHash`;
- buyability evidence for a positive target;
- a new, missing, or duplicate ISA holding.

There is no fallback to raw target fields, current weights, equal weights,
group ratios, partial vectors, or an older policy version.

## Authorized Next Gate

This approval permitted the separate pure Target Policy Resolver Phase 1A
validation documented in `docs/target-policy-resolver-phase1a-contract.md`.
That phase consumes explicit trusted-port input, not this Markdown file, and
proves fail-closed matching against a fresh holding universe.

Persistence, runtime activation, allocator connection, product UI/API,
tenant-scoped storage, and order execution remain separate approval gates.
