# Instrument Identity And KRX Gold Close-Only Phase 0

Last updated: 2026-07-11

Status: pure contract and dependency audit implemented. No schema, migration,
database write, provider call, Cron, route, API, UI, snapshot reader, target
resolver, or allocator behavior changed.

## Ordering Decision

The ISA Gate B vector and KRX gold are independent product boundaries. The
current ISA universe is reviewable and can proceed as soon as the user supplies
the complete four-instrument integer-bps vector. KRX gold does not block that
account.

Phase 0 is performed first only because the Gate B numbers cannot be inferred
and have not been supplied. This is useful independent work, not a dependency
claim between ISA and the brokerage gold holding.

The production Gate B1 read-only audit on 2026-07-11 confirmed:

- ISA is reviewable with four complete identities;
- brokerage is blocked by one tickerless KRX gold holding;
- IRP is independently blocked by one tickerless managed-service holding;
- the assets row count remained 17 before and after;
- database writes and provider calls were zero.

## Product Decision

KRX gold is a close-only spot commodity in v1. It is not a live quote target.

| Field | Value |
| --- | --- |
| instrument kind | `commodity_spot` |
| venue | `KRX_GOLD` |
| product key | `gold_9999_1kg` |
| holding unit | `g` |
| quote currency | `KRW` |
| quote unit | `KRW_PER_G` |
| price mode | `official_close_only` |
| source | `krx_open_api_gold_daily` |
| quote kind | `official_close` |
| live quote eligible | `false` |

`productKey` is an internal semantic label, not a KRX or broker symbol. No
provider symbol is approved in this phase.

The semantic identity deliberately contains no ticker. The shared instrument
identity must remain separate from a user-owned asset row, provider mapping,
and execution capability.

## Explicit Non-Equivalence

These are different instruments or data products and must never be used as a
proxy for the KRX gold holding:

- `411060`, ACE KRX Gold Spot ETF;
- any KRX or overseas gold future;
- an international-gold converted reference price;
- a gold fund, bank gold account, or physical withdrawal product.

The fixture in `tests/instrument-identity.test.mjs` gives each a different
semantic identity and proves that the keys cannot collapse into one another.

## Official-Close Evidence

A usable observation must contain all of:

- `source=krx_open_api_gold_daily`;
- `quoteKind=official_close`;
- positive finite price in KRW per gram;
- valid `priceDate`;
- valid `fetchedAt`.

The pure selection contract has these rules:

1. Select the first valid official close when no valid prior close exists.
2. Select a newer `priceDate`.
3. Accept a same-date correction only when it was fetched later.
4. Ignore an older close or an earlier conflicting fetch.
5. Retain the last valid close on provider failure, market closure, unpublished
   data, or invalid response.
6. Never replace a valid close with zero, null, or malformed evidence.

No time-of-day assumption proves freshness. A future reader or writer must use
the returned `priceDate`, KRX trading-calendar evidence, and publication status.

## Today-Movement Semantics

Stored close and live movement are not the same lifecycle.

| Baseline versus latest close | Status | Today aggregate |
| --- | --- | --- |
| latest `priceDate` is newer | comparable close-to-close movement | include |
| same `priceDate` | awaiting a new close | exclude, do not report zero |
| latest date is older | stale/inconsistent evidence | exclude |
| either close is missing or invalid | unavailable | exclude |

When comparable, valuation is `quantity_g * close_krw_per_g`, and movement is
`quantity_g * (latest_close - baseline_close)`. A same-date close means there
is no new comparison period; it is not evidence of a zero return.

## Current Dependency Audit

| Boundary | Current behavior | Required later change |
| --- | --- | --- |
| `assets` | ticker is nullable; tickerless values use generic current-price metadata | add nullable shared instrument reference only in an expand-only phase |
| `asset_price_snapshots` | ticker is required and uniqueness is `(ticker,date)` | do not reuse for tickerless KRX gold |
| `live_price_quotes` | ticker is required and key is market/ticker/provider | never store close-only gold here |
| KIS price sync | silently excludes rows without ticker | keep gold outside this target builder; do not invent a ticker |
| daily snapshot writer | uses `assets.current_price` with `manual_current` fallback | later read explicit official-close evidence and preserve its `priceDate` |
| dashboard and structure reads | live quotes are ticker keyed; asset current price is fallback | later expose latest close with source and as-of date, not as live |
| today movement | asset freshness is modeled as a live-window timestamp | add an isolated close-only comparison path before including gold |
| admin sync status | price and close coverage are ticker based | add separate close-only health evidence later |
| Gate B1 | `(market,currency,ticker)` makes brokerage fail closed | keep blocked until explicit instrument identity and policy treatment are reviewed |
| Additional Contribution | allocation identity is ticker based | do not include gold in a positive vector before a separate allocator decision |
| portfolio risk | tickerless holdings are excluded and price history is ticker keyed | require instrument-keyed close history before risk inclusion |
| Investment Lab | ticker-only identity is an explicit readiness blocker | require instrument identity and historical close coverage before inclusion |
| event and movement matching | asset UUID and legacy asset id are primary fallbacks | no fake ticker is needed for historical event matching |

## Deferred Additive Sequence

Each item is a separate future approval boundary:

1. Confirm KRX data storage, retention, and display rights for the intended
   multi-user product.
2. Design an expand-only shared instrument table, nullable
   `assets.instrument_id`, and an instrument-keyed official-close observation
   table. Do not mutate the existing ticker tables.
3. Add schema and migration with no backfill or reader switch.
4. Add a read-only KRX daily-close adapter and fixture-backed response parser.
5. Run a one-observation dry-run plan.
6. Perform one guarded actual close upsert only after explicit approval.
7. Backfill only the reviewed KRX gold asset-to-instrument link under a separate
   gate.
8. Switch dashboard valuation, today movement, and daily snapshot reads one at
   a time with source-date coverage tests.
9. Re-run brokerage Gate B1 and make a separate target-policy decision for the
   gold instrument.

ISA Gate B does not wait for this sequence. It waits only for the user's
explicit policy version, effective service date, and complete 10,000-bps
vector.

## Phase 0 Verification

- `tests/instrument-identity.test.mjs` is pure and performs no I/O except reading
  source files for the dependency boundary assertions.
- The fixture covers initial close, newer close, same-date correction, provider
  failure retention, older-close rejection, unchanged-date movement exclusion,
  and close-to-close calculation.
- Existing runtime files are inspected but not changed.
