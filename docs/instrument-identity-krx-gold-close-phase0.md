# Instrument Identity And KRX Gold Close-Only Phase 0

Last updated: 2026-07-19

Status: the active valuation policy is stored manual KRW-per-gram input. The
official-close source work remains available for a later phase but is not a
current implementation gate. No schema, migration, provider call, Cron,
authenticated user-edit UI, target resolver, or allocator behavior changed.

## Active Manual Valuation Direction

The user may explicitly replace the stored 1g valuation. Until that happens,
the service retains `assets.current_price` and continues to use it for current
valuation and future daily snapshots. A manual update also records
`price_source=manual_entry`, `price_quote_type=manual_valuation`, and the exact
update time. It is not a market quote or an official close.

The policy is forward-only:

- a newly entered value does not rewrite older snapshots;
- the current value is never copied backward to manufacture historical returns;
- Investment Lab and Simulation may use only explicit stored manual observations;
- missing historical observations remain disclosed until a separate fill policy
  or automated source is implemented;
- the Financial Services Commission provider is deferred and no longer blocks
  unrelated migration work.

The existing asset CRUD route remains admin-protected. A user-facing editor must
wait for the authenticated tenant session boundary rather than exposing a global
Basic-Auth mutation.

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

KRX gold is a manually valued spot commodity family in the active v1 path. It is not a live quote
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
| price mode | `stored_manual_price` |
| source | `manual_entry` |
| quote kind | `manual_valuation` |
| live quote eligible | `false` |
| automated provider | deferred (`fsc_public_data_gold_daily`) |

The two `productKey` values are internal product identities, not KRX or broker
symbols. This holding is bound only to `gold_9999_1kg`; it must never collapse
with `gold_9999_100g`. The Financial Services Commission public-data binding is
`04020000` / `KRD040200002` / `금 99.99_1Kg`, with `basDt` as trading date and
`clpr` as official close. Actual response coverage remains a separate source
concern.

The product boundary deliberately contains no ticker. A future shared
instrument identity must remain separate from a user-owned asset row, provider
mapping, and execution capability.

The provider, rights, date, and same-flow feasibility review is recorded in
`docs/krx-gold-close-only-source-feasibility-audit-v1.md`. It permits a
read-only provider dry-run but keeps persistence and runtime readers blocked.

## Explicit Non-Equivalence

These are different instruments or data products and must never be used as a
proxy for the KRX gold holding:

- `411060`, ACE KRX Gold Spot ETF;
- any KRX or overseas gold future;
- an international-gold converted reference price;
- a gold fund, bank gold account, or physical withdrawal product.

The fixture in `tests/instrument-identity.test.mjs` gives each a different
semantic identity and proves that the keys cannot collapse into one another.

## Deferred Official-Close Evidence

A usable observation must contain all of:

- `source=fsc_public_data_gold_daily`;
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
| daily snapshot writer | uses `assets.current_price` with manual provenance | retain the stored value until the next manual update; never backcast it |
| dashboard and structure reads | live quotes are ticker keyed; asset current price is the intended gold valuation | expose the manual source and as-of date without calling it live |
| today movement | tickerless gold uses stored current valuation evidence | compare only against an explicit prior stored observation |
| admin sync status | price and close coverage are ticker based | add separate close-only health evidence later |
| Gate B1 | `(market,currency,ticker)` makes brokerage fail closed | keep blocked until explicit instrument identity and policy treatment are reviewed |
| Additional Contribution | allocation identity is ticker based | do not include gold in a positive vector before a separate allocator decision |
| portfolio risk | tickerless holdings are excluded and price history is ticker keyed | add an explicit manual-observation history path before risk inclusion |
| Investment Lab | the reviewed gold product is identified, but a single current manual value is not historical authority | admit only explicit forward manual observations; do not wait for the deferred provider |
| event and movement matching | asset UUID and legacy asset id are primary fallbacks | no fake ticker is needed for historical event matching |

## Production Special-Holding Authority Audit

The 2026-07-15 SELECT-only audit uses the first exact-source three-account
anchor (`2026-05-21`) and groups stored history by legacy identity internally.
The legacy identity is never returned to the page or rendered in HTML.

The audit deliberately does not treat `price_basis=close`, `close_price`, or
`unit_price` as provider authority by themselves. A gold snapshot row is only
an official-close candidate when the exact source is
`fsc_public_data_gold_daily`, the basis is `official_close`, the price date is
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
product and holding unit are resolved. These values may remain explicit manual
valuation observations, but they are not silently relabeled as provider data.

The anchor basket remains unavailable until the Fount scope transform and a
bounded manual-observation history path are implemented. The official provider
is no longer a prerequisite. No provider call, database write, schema change,
backfill, proxy substitution, or partial-basket calculation was used.

## Deferred Additive Sequence

Each item is a separate future approval boundary:

1. Run the Financial Services Commission public-data read-only coverage audit
   with a server-only decoding key.
2. Confirm the exact product rows, coverage, duplicate behavior, and broker
   statement spot checks.
3. Design an expand-only shared instrument table, nullable
   `assets.instrument_id`, and an instrument-keyed official-close observation
   table. Do not mutate the existing ticker tables.
4. Add schema and migration with no backfill or reader switch.
5. Add a guarded provider adapter around the verified fixture parser.
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
