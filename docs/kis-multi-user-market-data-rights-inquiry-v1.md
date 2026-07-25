# KIS Multi-User Market Data Rights Inquiry v1

Status: ready_to_send_external_inquiry

This inquiry is an external licensing gate. It does not authorize a provider
call, shared-cache implementation, user-facing display, or Simulation and
Investment Lab admission.

## Current Official Evidence

As of 2026-07-25, the KIS Developers pages distinguish these uses:

- Personal and general corporate customers may use Open API for their own
  assets and strategies.
- A corporation providing a KIS-powered service to third parties is a
  partnership target.
- The partnership proposal page says that non-regulated fintech companies
  cannot enter the partnership route.
- Displaying KRX or overseas exchange market data in a partner application
  requires the relevant exchange information-use agreement.

Official references:

- https://apiportal.koreainvestment.com/about-howto
- https://apiportal.koreainvestment.com/provider
- https://apiportal.koreainvestment.com/provider-apply

The 24-hour access-token lifetime is an operational fact only. It does not
grant storage, redistribution, display, or multi-user rights.

## Recipient

- To: `openapi@koreainvestment.com`
- Subject: KIS Open API market-data use in a multi-user portfolio analytics service

## Message

Hello KIS Developers Team,

Varda Labs is developing a portfolio analytics web application in South
Korea. We are not currently a licensed investment advisory or discretionary
investment management business.

Today, a personal KIS Open API key is used only for the key owner's private
portfolio operation and bounded technical verification. We are evaluating a
future multi-user service that would not place orders or expose another
customer's account data.

The possible market-data flow would be:

1. The server retrieves Korean and overseas current or daily historical prices.
2. Raw price rows are stored once in a shared PostgreSQL cache.
3. Authenticated users see portfolio valuation and historical analytics.
4. Investment Lab and Simulation may show derived returns, comparison paths,
   bootstrap or Monte Carlo distributions, percentiles, drawdown, volatility,
   and Sharpe-style metrics.

Please confirm each item separately in writing:

1. Does this analytics-only service count as providing a KIS-powered service
   to third parties and therefore require a partnership?
2. If a non-regulated fintech company is not eligible for partnership, are
   server retrieval, shared raw-price storage, raw-price display, and derived
   analytics for multiple users all prohibited?
3. May derived analytics be displayed when raw source prices are not exposed,
   or does that still require a KIS partnership and exchange information-use
   agreements?
4. Do the answers differ for delayed or daily historical prices versus live
   prices?
5. Do the answers differ between KRX data and overseas exchange data?
6. If source prices may be displayed as supporting evidence, what attribution,
   delay, user-count, geography, or exchange-contract conditions apply?
7. What raw-data and derived-result retention and deletion rules apply during
   service operation and after termination?
8. If one shared provider key is not allowed, may each authenticated user
   connect and use their own KIS credentials through the service? If so, what
   security, consent, account-linking, and display conditions apply?
9. Do KIS daily-price APIs provide raw prices only, or is there a documented
   adjusted-price or total-return series that incorporates stock splits and
   cash distributions?

No KIS credentials, account numbers, tokens, customer information, or
confidential implementation details are included in this inquiry.

Kind regards,

Varda Labs

## Response Admission Rules

Record the response dimensions independently:

- `serverFetch`
- `sharedRawCache`
- `rawPriceDisplay`
- `derivedAnalyticsDisplay`
- `multiUser`
- `krx`
- `overseasExchanges`
- `rawRetention`
- `derivedRetention`
- `userOwnedCredentials`
- `adjustedPriceSemantics`

A dimension becomes `admitted` only when a written reply explicitly grants it
and all stated prerequisites are met. Generic product documentation, a
successful API call, token reuse, or the absence of an error is not permission.

If any required dimension is denied or remains unanswered:

- Keep KIS provider calls behind the existing private/admin boundary.
- Do not create a shared multi-user raw-price cache.
- Do not admit KIS raw-price rows as public Simulation or Investment Lab input.
- Do not label a KIS raw-price series as adjusted or total return.

## Product Boundary While Pending

Existing bounded KIS rows remain operational and audit evidence for the current
single migration tenant. They are not evidence of multi-user rights.

No Redis token cache, public provider route, user-triggered provider job,
multi-user market-data display, or Simulation and Investment Lab promotion is
authorized by this packet.
