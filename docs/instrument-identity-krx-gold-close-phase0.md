# Instrument Identity And KRX Gold Close-Only Phase 0

Last updated: 2026-07-15

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

## Product Boundary

KRX gold is a close-only spot commodity family in v1. It is not a live quote
target. Broker holding evidence reviewed on 2026-07-16 binds this imported
holding to the KRX 99.99% 1kg product. The holding quantity is denominated in
grams because both KRX products trade in 1g units and are quoted in KRW per
gram. Sensitive broker evidence is not stored in this repository.

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

The two `productKey` values are internal product identities, not KRX or broker
symbols. This holding is bound only to `gold_9999_1kg`; it must never collapse
with `gold_9999_100g`. A provider instrument code and official-close field
mapping remain separate unresolved source concerns.

The product boundary deliberately contains no ticker. A future shared
instrument identity must remain separate from a user-owned asset row, provider
mapping, and execution capability.

The provider, rights, date, and same-flow feasibility review is recorded in
`docs/krx-gold-close-only-source-feasibility-audit-v1.md`. That audit keeps
runtime readiness blocked.

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
| Investment Lab | stored ticker or a single-ticker consensus from same-identity Base44-imported position snapshots can establish listed identity; current asset metadata is not historical authority and tickerless commodity remains blocked | require a bound gold instrument identity and instrument-keyed official-close history before inclusion |
| event and movement matching | asset UUID and legacy asset id are primary fallbacks | no fake ticker is needed for historical event matching |

## Production Special-Holding Authority Audit

The 2026-07-15 SELECT-only audit uses the first exact-source three-account
anchor (`2026-05-21`) and groups stored history by legacy identity internally.
The legacy identity is never returned to the page or rendered in HTML.

The audit deliberately does not treat `price_basis=close`, `close_price`, or
`unit_price` as provider authority by themselves. A gold snapshot row is only
an official-close candidate when the exact source is
`krx_open_api_gold_daily`, the basis is `official_close`, the price date is
present, the currency is KRW, and a positive price is present. The canonical
product binding is now resolved, but provider field mapping, rights, and date
coverage are still required before runtime use.

| Evidence | Fount tickerless position | KRX gold position |
| --- | ---: | ---: |
| stored position rows | 27 | 27 |
| rows with a price date | 20 | 20 |
| distinct price dates | 14 | 14 |
| legacy `close` label rows | 20 | 20 |
| `close` rows without a source | 19 | 19 |
| official-close candidate rows | 0 | 0 |
| distinct stored current prices | 1 | 2 |
| event rows | 0 | 1 |
| valuation arithmetic mismatches | 0 | 0 |

Fount's stored rows are now explicitly excluded from Investment Lab and
Simulation by product owner decision. A SELECT-only parity audit found one
exact Fount row on every one of the 26 complete comparison dates from the
2026-05-21 anchor, with no duplicates, invalid values, subtraction overflow,
or related event rows. Runtime still needs one scope-consistent transform that
removes Fount from both the observed path and scenario capital.

KRX gold has two stored values (`211,500` and `225,750 KRW`) and one trade
event. The event is quantity/cost evidence, not official-close history. The
product and holding unit are resolved, while the official KRX close series
remains `separate_valuation_model_required`.

Therefore the anchor basket remains wholly unavailable until the Fount scope
transform and KRX Gold close authority are implemented. No provider call,
database write, schema change, backfill, proxy substitution, or partial-basket
calculation was used.

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
