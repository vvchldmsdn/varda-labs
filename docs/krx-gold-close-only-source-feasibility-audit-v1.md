# KRX Gold Close-Only Source Feasibility Audit v1

Last updated: 2026-07-17

Status: official Financial Services Commission public-data source and a
fixture-backed read-only dry-run are implemented. Actual response coverage,
schema, persistence, readers, and calculation authority remain blocked. This
audit performed no provider request, database read or write, schema change,
backfill, route, API, UI, job, or Cron work.

## Decision

KRX Gold daily closes have a viable official source. Broker holding evidence
reviewed on 2026-07-16 binds the imported holding to the KRX 1kg product with
gram-denominated quantity. On 2026-07-17, the Financial Services Commission
public-data specification resolved the provider identity and field mapping:

- dataset `15094805`, operation `getGoldPriceInfo`;
- `04020000` / `KRD040200002` / `금 99.99_1Kg`;
- trading date `basDt` and official close `clpr`;
- free automatic development and production approval;
- public-data-portal license scope reported as unrestricted.

No account number, holder name, or screenshot is stored in this repository.
Two independent blockers remain:

1. an authenticated read-only call has not yet verified row-level coverage,
   pagination, duplicate behavior, and current product labels;
2. the Investment Lab path uses fractional units, while executable KRX Gold
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
`KRW_PER_G` quote unit. The reviewed broker evidence selects the 1kg product;
the API mapping below must still match all three provider identifiers.

## Official API Binding

The selected authority is the Financial Services Commission public-data API,
not KRX's separately governed direct Open API.

Official references:

- [Financial Services Commission general-product price API](https://www.data.go.kr/data/15094805/openapi.do)
- [KRX Gold Market overview](https://open.krx.co.kr/contents/OPN/01/01050206/OPN01050206.jsp)

| Binding | Value |
| --- | --- |
| endpoint | `GetGeneralProductInfoService/getGoldPriceInfo` |
| authentication | public-data `serviceKey` query parameter |
| local environment variable | `FSC_PUBLIC_DATA_SERVICE_KEY` |
| product short code | `04020000` |
| ISIN | `KRD040200002` |
| product name | `금 99.99_1Kg` |
| trading-date field | `basDt` (`YYYYMMDD`) |
| official-close field | `clpr` |
| internal source | `fsc_public_data_gold_daily` |

The parser fixture is copied from the official guide sample. It accepts the
documented wrapped or unwrapped JSON root and singleton or array item shape,
but it requires all three provider identity fields to agree. A partial identity
match, malformed date, non-positive close, duplicate date, conflicting close,
incomplete pagination, or missing expected KRX trading date blocks readiness.

## Rights And Secret Boundary

The public-data-portal record reports free access, automatic development and
production approval, and an unrestricted license scope. This removes the prior
KRX-direct-API rights blocker for this selected source. The product should still
identify the Financial Services Commission public-data source and the delayed
publication date so users do not mistake it for a live KRX quote.

The server-only service key remains a secret. It must not be returned to a
browser, logged, persisted in Postgres, or included in provider URLs in error
messages. If the portal changes its license or approval status, runtime
readiness must be reviewed again.

## Date And Carry Policy

An official close observation belongs to its actual KRX trading date. The
existing snapshot cycle resolver labels the 24-hour cycle ending at 07:00 KST
with that KST calendar date. The selected provider does not make a D close
eligible merely because the D+1 07:00 boundary has passed.

The Financial Services Commission dataset publishes after 13:00 KST on the
following business day. This is later than the 07:00 snapshot cutoff, so a
future writer must classify an absent D close as `source_lag_not_published`,
not as a fresh zero-return close or an ordinary market-closure carry. The close
may be admitted only after both the publication window opens and the provider
actually returns the exact observation. The existing prior close may remain
visible with its original observation date and explicit source-lag state.

An observation returned before its documented publication window is not
admitted automatically. It requires separate review rather than silently
creating look-ahead evidence.

On weekends, holidays, or other KRX closures:

- valuation may carry the latest prior valid close;
- the original observation date remains visible;
- no copied row is created for the non-trading date;
- the carried value is not reported as a new zero-return observation.

Once a later KRX trading day is published and expected, an older close is stale
rather than an allowed carry. A newer fetch for the same product and trading
date may replace an earlier value only as an explicit correction. Older
observations never overwrite newer dates.

## Historical Coverage Dry-Run

The official guide sample proves the response shape and the API provides date
range filters. Row-level coverage does not pass yet because this change
intentionally made no authenticated provider request. The dry-run defaults to
the current Investment Lab anchor `2026-05-21` and a publication-safe end date.

It must verify:

- returned product identities and the exact 1kg binding;
- every expected KRX trading date from anchor through selected end date;
- duplicates, same-date conflicts, malformed rows, and complete pagination;
- a small set of close values against reviewed broker-statement evidence.

Run it with:

```text
npm run audit:krx-gold-source -- --from=2026-05-21 --to=YYYY-MM-DD
```

The command performs provider reads only. It has no database dependency and no
write mode. No interpolation is allowed for missing market closes. A missing
trading-date observation remains an explicit gap until repaired from this
approved authority.

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

1. Add a server-only public-data decoding key and run the read-only coverage
   audit with no persistence.
2. Verify anchor-through-end close coverage and broker-statement spot checks.
3. Choose fractional-research or integer-execution Investment Lab semantics.
4. Review an additive instrument/close schema and guarded source adapter.
5. Add one reviewed observation before any historical backfill or reader switch.

Fount is intentionally excluded from Investment Lab and Simulation by product
owner decision. The whole anchor basket still stays unavailable until Fount is
removed from both observed and scenario paths with one scope-consistent
transform and KRX Gold has approved close authority.
