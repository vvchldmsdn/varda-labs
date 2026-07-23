# Provider History Commercial Terms Inquiry v1

Status: ready_to_send_external_inquiry

This inquiry is an external licensing gate. It does not select a provider,
authorize an API call, admit a shared-cache write, or change runtime behavior.

## Recipient

- To: `sales@eodhistoricaldata.com`
- Subject: Commercial licensing inquiry for historical ETF data in a multi-user portfolio analytics service

## Message

Hello EODHD Sales Team,

We are evaluating EODHD for a multi-user portfolio analytics web application
operated in South Korea. We would initially use daily historical data for:

- `069500.KO` (KODEX 200, Korea)
- `QQQ.US` (Invesco QQQ, United States)

The application would fetch data on the server, store a shared historical
cache in PostgreSQL, and show authenticated users historical research
analytics derived from that data. The planned derived outputs include
KRW-investor return series using date-specific FX rates, counterfactual
portfolio paths, bootstrap and Monte Carlo fan charts, percentiles, maximum
drawdown, volatility, and Sharpe-style metrics.

This data would not be used as a live quote, an official exchange close, an
order or execution price, or the source of the user's observed portfolio
valuation path.

Please confirm in writing whether a commercial agreement can grant each of the
following rights:

1. Server-side retrieval of daily historical EOD, adjusted close, dividend,
   and split data for the two instruments above.
2. Storage of the raw response fields in a shared database/cache used by
   multiple authenticated customers.
3. Display of transformed charts and derived analytics to those customers.
4. Display of source prices when needed as supporting evidence, with any
   required attribution.
5. Retention and display of derived results after the source rows have been
   corrected, replaced, or deleted.
6. Clear retention and deletion rules for raw source data and derived results
   after contract termination.
7. Use from South Korea, including any separate exchange license, user-count,
   geography, attribution, or redistribution requirements for XKRX and US ETF
   data.

Please also confirm the data contract:

1. For `069500.KO` and `QQQ.US`, does `adjusted_close` include both cash
   distributions and stock splits?
2. Are dividend and split components available separately for parity checks?
3. How are historical corrections or revisions communicated?
4. Can an exact date range be requested without hidden pagination loss, and
   how are duplicate dates handled?
5. Is this EOD series vendor-aggregated indicative data rather than an
   exchange-authoritative official close?

We would appreciate a quote and the applicable commercial terms that
explicitly cover these uses.

Kind regards,

Varda Labs

## Response Admission Rules

Map the reply into `provider_history_shortlist_v1` only as follows:

- `fetch`, `store`, `display`, and `multiUser` become `admitted` only when the
  written reply explicitly grants that dimension.
- A generic statement such as "commercial plan available" remains
  `contract_required`.
- Any denied required dimension makes this provider ineligible for the shared
  historical cache.
- Raw-data and derived-result retention must be recorded separately. Do not
  infer derived-result retention from raw-data storage permission.
- `adjusted_close` remains unverified until both its distribution/split
  semantics and a bounded corporate-action sample are checked.
- A positive licensing reply does not authorize a provider call. The bounded
  payload parity trial remains a separately reviewed step.

## Product Boundary

Even after a positive reply, admitted EODHD data is historical research
evidence only. It must not replace KIS live valuation, an official close, or
stored daily portfolio snapshots that represent the user's observed path.
