# KRX Gold Close-Only Source Feasibility Audit v1

Last updated: 2026-07-15

Status: official-source feasibility reviewed; runtime remains blocked. This
audit performed no provider request, database read or write, schema change,
backfill, route, API, UI, job, or Cron work.

## Decision

KRX Gold daily closes are technically plausible as a future historical-price
source, but the source is not ready for product use. Four independent blockers
remain:

1. the imported `금현물` row is not bound to the KRX 1kg or 100g product;
2. the exact Open API instrument and close fields are not verified from an
   approved development specification or response;
3. the current Open API terms do not establish the storage and multi-user
   display rights required by Varda Labs;
4. the Investment Lab path uses fractional units, while executable KRX Gold
   trades use integer grams.

The existing Investment Lab anchor basket therefore remains wholly
unavailable. No proxy, partial basket, or source-less stored price is admitted.

## Official Market Facts

| Question | Verified result | Official source |
| --- | --- | --- |
| Market type | KRX-operated gold spot market, opened 2014-03-24 | [KRX Gold Market overview](https://open.krx.co.kr/contents/OPN/01/01050206/OPN01050206.jsp) |
| Eligible products | 99.99% purity 1kg and 100g gold bars | [KRX Gold Market overview](https://open.krx.co.kr/contents/OPN/01/01050206/OPN01050206.jsp) |
| Trading and quote quantity | 1g | [KRX trading-unit rules](https://regulation.krx.co.kr/contents/RGL/04/04010104/RGL04010104.jsp) |
| Price expression | KRW per gram; quote tick is KRW 10 | [KRX trading-unit rules](https://regulation.krx.co.kr/contents/RGL/04/04010104/RGL04010104.jsp) |
| Close formation | Closing auction runs 15:20-15:30 KST | [KRX trading hours and holidays](https://global.krx.co.kr/contents/GLB/06/0606/0606010101/GLB0606010101T2.jsp) |
| Prior-close role | The prior trading day's close is the next trading day's base price | [KRX trading-unit rules](https://regulation.krx.co.kr/contents/RGL/04/04010104/RGL04010104.jsp) |

These facts verify the broad commodity family, `g` holding unit, and
`KRW_PER_G` quote unit. They do not identify which bar-size product the imported
asset represents. Both products share those units.

## Open API Candidate

KRX lists `금시장 일별매매정보` as an Open API service and states that data is
available from 2014-03-24. Access requires an issued authentication key and
separate service-use approval. The key is sent in the `AUTH_KEY` request header.

Official references:

- [Gold daily trading API service](https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES006_S2.cmd?BO_ID=sxveSnWzWNzWxQASsgEG)
- [Open API usage steps](https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO003.jsp)
- [Open API terms](https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO002.jsp)

The public service page did not expose an approved instrument code, product
name mapping, or exact close-field definition during this audit. Therefore
`krx_open_api_gold_daily` remains an internal source candidate, not a runtime
provider binding. A future response parser must be built from the approved
development specification and fixture, not guessed field names.

## Rights Boundary

The current Open API terms state that use is non-commercial, results may not be
provided to third parties, and a screen using the result must identify it as
KRX statistical information. The usage guide also requires administrator
approval before an external service is launched.

Those clauses do not prove that Varda Labs may retain historical rows and show
them to multiple signed-in users. This is a product-readiness blocker, not a
legal conclusion. Before implementation, obtain written KRX confirmation or an
appropriate market-data distribution agreement covering:

- server-side storage and retention;
- derived calculations and charts;
- display to multiple end users;
- required attribution and delayed-data labeling;
- termination behavior when API approval or the key expires.

## Date And Carry Policy

An official close observation belongs to its actual KRX trading date. For a
daily snapshot written at 07:00 KST on D+1, the D close maps to snapshot
`reference_date=D`.

On weekends, holidays, or other KRX closures:

- valuation may carry the latest prior valid close;
- the original observation date remains visible;
- no copied row is created for the non-trading date;
- the carried value is not reported as a new zero-return observation.

A newer fetch for the same product and trading date may replace an earlier
value only as an explicit correction. Older observations never overwrite newer
dates. The future storage key should include canonical instrument, source, and
trading date, but schema design is outside this audit.

## Historical Coverage

The advertised source range begins before the current Investment Lab anchor of
2026-05-21, so range feasibility passes in principle. Row-level coverage does
not pass yet because this audit intentionally made no provider request.

A separately approved read-only dry run must verify:

- both KRX product rows and their exact codes/names;
- every required KRX trading date from anchor through selected end date;
- duplicates, same-date corrections, nulls, and publication latency;
- the selected product's close values against a small broker-statement sample.

No interpolation is allowed for missing market closes. A non-trading date may
carry a prior close; a missing trading-date observation must remain an explicit
gap until repaired from an approved authority.

## Investment Lab Compatibility

The deployed anchor model equal-splits each external flow and permits
fractional units. KRX Gold is executable only in 1g increments. Two valid but
different future policies are possible:

| Policy | Meaning | Current status |
| --- | --- | --- |
| Fractional research path | Treat fractional grams as a mathematical counterfactual, preserve exact same-flow allocation, and disclose that the path is not executable | decision required |
| Execution-faithful path | Trade integer grams, retain residual cash, apply a reviewed fee policy, and reject sales exceeding accumulated grams | not implemented |

The existing fractional model must not silently claim execution fidelity. The
integer model must preserve no-short solvency and cannot discard residual cash.
Neither choice is approved by this audit.

## Next Safe Sequence

1. Confirm the broker product identity: 1kg or 100g.
2. Obtain the KRX development specification and product-use permission.
3. Approve one read-only API fixture/dry-run packet with no persistence.
4. Verify anchor-through-end close coverage and broker-statement spot checks.
5. Choose fractional-research or integer-execution Investment Lab semantics.
6. Only then review an additive instrument/close schema and provider adapter.

The separate Fount managed-sleeve decision can proceed in parallel. The whole
anchor basket stays unavailable while either special holding lacks authority.
