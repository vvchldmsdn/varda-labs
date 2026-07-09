# Portfolio Risk Structure v1 Contract And Legacy Parity Audit

Last updated: 2026-07-10

Status: docs-only design and source audit. This document does not add a route,
calculation helper, provider call, API, write path, Cron behavior, schema,
migration, cleanup, backfill, recommendation, or score.

## Decision

The existing `/portfolio/structure` page is an allocation evidence surface and
is user-facing as `자산 배분`. It is not a migration of the gyeol-fin screen
named `포트 구조`.

The legacy `포트 구조` capability remains pending. Its first varda slice will
be a separate read-only portfolio risk model with transparent calculations.
The Base44 function is evidence, not the canonical implementation.

## V1 Questions

For one selected account and one explicit analysis window, v1 should answer:

- how volatile the current portfolio has been;
- how strongly the included holdings have moved together;
- how many effective risk bets the current portfolio contains;
- which holdings contribute most to portfolio risk;
- how return efficiency compares with volatility under an explicit risk-free
  rate assumption;
- whether correlations rose on portfolio down days;
- which holdings or dates were excluded and why.

## V1 Output

Required portfolio metrics:

- annualized portfolio volatility;
- weighted average standalone volatility;
- weighted average pairwise correlation;
- full correlation matrix with display-safe ticker/name labels;
- risk-contribution ENB;
- portfolio Sharpe ratio;
- down-day average correlation and down-day observation count.

Required per-holding metrics:

- end-of-window weight;
- annualized volatility;
- signed and absolute risk contribution;
- risk contribution percentage;
- Sharpe ratio;
- sample size and data-health state.

Required provenance:

- selected account;
- requested and effective window;
- analysis start and end dates;
- weight as-of date;
- included and excluded holdings with reasons;
- return currency mode;
- calendar policy;
- FX policy;
- annualization factor;
- risk-free rate assumption;
- formula version.

## Non-Goals

V1 does not include:

- `divScore` or another composite diversification/risk score;
- recommendations, rebalance actions, target-weight changes, or trade sizing;
- beta, alpha, CAGR, momentum, MDD, or stress badges;
- ETF look-through risk aggregation;
- provider calls during render;
- public refresh controls or admin action controls;
- persistence of newly calculated results;
- treating imported scalar snapshots as current canonical calculations;
- internal or legacy ids in product output.

The deferred metrics may be added only through separate contracts. In
particular, snapshot-value CAGR is not a valid performance metric when cash
flows are present unless a flow-adjusted method is defined.

## Canonical Inputs

| Input | Canonical role | Rule |
| --- | --- | --- |
| `assets` | Current user holdings and account scope. | Select active, positive holdings with a usable ticker, supported market/currency, and price history. Capability and evidence decide eligibility; do not limit the universe to the legacy `etf` and `stock` strings. |
| `asset_price_snapshots` | Historical local close series. | Use adjusted close when usable, otherwise close. Read by normalized ticker and date. Do not fetch a provider during page render. |
| `fx_rates` | Historical KRW conversion series. | Join an approved USD/KRW value for every analysis date. Never multiply the entire history by one current FX rate. |
| `daily_position_snapshots` | Historical quantity evidence. | Not required for static current-portfolio risk v1. Reserve for a later time-varying holdings model. |
| `daily_portfolio_snapshots` | Historical run evidence. | Imported ENB/correlation/volatility scalars are not current truth because their universe, weights, window, and formula version are incomplete. |
| `market_regime_daily` | Historical run/context evidence. | Same restriction as daily portfolio snapshots. Do not feed these scalars back into the canonical calculation. |

Current database readiness evidence from the existing read-only audits:

- `asset_price_snapshots`: 11,329 rows, 22 tickers, 950 price dates;
- market/currency split: 9,354 Korea/KRW rows and 1,975 US/USD rows;
- ticker/date duplicate groups: 0, with the unique index present;
- `fx_rates`: 468 rows;
- 7 historical price tickers do not match current assets; keep them as
  historical evidence, but do not include them in the current universe;
- current `assets` has 19 rows, including 4 tickerless rows that require an
  explicit exclusion rather than a synthetic zero return.

These counts prove useful history exists. They do not yet prove that every
current holding meets the selected window's minimum observations.

## Account And Universe Policy

Supported account scopes:

- `brokerage`
- `isa`
- `irp`
- `all`

Eligibility is evaluated after account filtering:

1. Active current holding.
2. Positive quantity or positive explicitly modeled fractional value.
3. Stable display identity from ticker/name/market/account.
4. Supported currency conversion path.
5. Enough aligned price observations for the requested window.

Do not filter solely on `asset_type in ('etf', 'stock')`. A market-priced
commodity or pension holding may be eligible if it has a ticker and canonical
history. Cash, deposits, subscriptions, and tickerless holdings remain outside
market-risk math and appear as exclusions.

If two holdings share a ticker, keep account/market identity in the universe.
A ticker-keyed map must not silently overwrite one holding with another.

## Tenant Boundary

The current app is still a single-user migration verification surface protected
by Basic Auth. A future risk adapter may initially follow the same scope as the
dashboard, but that is not a multi-tenant authorization model.

Before social login or multiple users are enabled:

- user-owned assets, accounts, position evidence, and calculated results must
  be filtered by the authenticated app user;
- shared price and FX history may remain tenant-neutral;
- account codes are filters inside one tenant, not tenant identifiers;
- app-level authorization must be complete before optional Postgres RLS is
  treated as defense in depth;
- no risk cache key may omit the user/tenant identity.

This contract does not authorize auth schema or RLS changes. Those remain under
`docs/auth-and-tenant-model-design.md`.

## Weight Policy

V1 is a static current-portfolio risk view:

1. Use current quantities.
2. Value them at the latest complete close and historical FX available on the
   analysis end date.
3. Normalize only included market-risk holdings to weights summing to 1.
4. Show the value and count excluded from the risk universe.
5. Hold the end-date weights constant across the return window.

This is not a historical strategy return and does not claim that the user held
the same quantities throughout the window. The UI must label it as risk of the
current portfolio under historical returns.

## Currency Policy

The canonical v1 mode is `krw_investor` because the portfolio and user-facing
totals are KRW based.

For each USD price date:

1. Prefer a valid `asset_price_snapshots.fx_rate` from the same row when its
   provenance is date-consistent.
2. Otherwise use `fx_rates.usdkrw` for that date.
3. If the exact date is unavailable, use the latest prior approved rate within
   the configured staleness limit and mark the row as carried forward.
4. If no approved rate exists, exclude that observation or holding according
   to the minimum-coverage rule. Never use a future rate.

KRW price for return calculation is `local close * date-specific USD/KRW`.
This includes both security-price and FX movement. A future secondary
`local_currency` view may isolate security return, but it must not replace the
KRW investor view silently.

## Calendar Policy

The legacy all-asset date intersection discards every date not shared by all
included markets. V1 instead uses a portfolio reference-date calendar:

1. Build the sorted union of actual close dates for included markets.
2. Remove dates on which no included market has a new close.
3. For a holding whose market was closed, carry forward its last known close
   without looking ahead, subject to a bounded staleness rule.
4. Apply date-specific FX after price carry-forward.
5. Start the usable window only after every included holding has an initial
   value.

This preserves Korea-only and US-only sessions while making closed-market
zero movement explicit. The calendar policy must be versioned because it can
materially change correlation and volatility.

The portfolio service's 07:00 KST cycle still governs the meaning of the
latest completed reference date. Risk calculations must not use an incomplete
current market cycle as the analysis end date.

## Return And Formula Policy

Use simple KRW returns:

`r(i,t) = value(i,t) / value(i,t-1) - 1`

For `n` included holdings, weight vector `w`, and sample covariance matrix
`Sigma`:

- portfolio return: `r(p,t) = sum(w(i) * r(i,t))`;
- portfolio volatility: `sqrt(w' * Sigma * w)`;
- annualized volatility: daily volatility times `sqrt(252)`;
- pair correlation: sample Pearson correlation;
- weighted average correlation: pair correlations weighted by
  `w(i) * w(j)` and divided by the sum of pair weights;
- marginal risk: `(Sigma * w)(i) / portfolio volatility`;
- signed risk contribution: `w(i) * (Sigma * w)(i) / portfolio volatility`;
- risk contribution percent: signed contribution divided by the sum of signed
  contributions when the denominator is valid;
- ENB share: absolute risk contribution divided by total absolute risk
  contribution;
- risk-contribution ENB: `1 / sum(ENB share(i)^2)`.

The UI must call this `risk-contribution ENB`. Correlation-matrix effective
rank is a different metric and must not be presented under the same label.

Zero-variance rows make correlation undefined. Return `null` with a
data-health reason; do not convert undefined correlation to `0`.

## Sharpe Policy

V1 uses an explicit annual risk-free rate parameter. Until a canonical
risk-free data source is approved, the supported default is `0` and the UI
must disclose `risk-free rate 0% assumption`.

Convert the annual assumption to a daily rate before calculating annualized
Sharpe from simple returns. Never describe the result as risk-free-adjusted
without showing the assumption.

## Stress Correlation Policy

Stress observations are dates where the static-weight portfolio return is
below zero. Compute the same weighted pairwise correlation and matrix over
those dates only.

- minimum down-day observations: 10;
- below the minimum: return `null` and the observed count;
- do not substitute zeros for missing holding returns.

## Window And Coverage Policy

Initial selectable windows:

- 30 observations;
- 90 observations;
- 252 observations.

The result must return requested and actual observations. A window can be
`ready`, `partial`, or `insufficient`; it must never appear complete merely
because low-coverage holdings were dropped.

Before runtime implementation, fixture work must approve exact minimum
coverage thresholds and maximum price/FX carry-forward days. These are policy
parameters, not incidental constants.

## Legacy Parity Audit

Legacy sources inspected read-only:

- `base44/functions/calcDiversification/entry.ts`;
- `base44/functions/_shared/portfolioData.ts`;
- `src/components/portfolio/desktop/visual/CreativeStructureScreen.jsx`;
- `src/components/portfolio/mobile/StructureScreen.jsx`;
- `src/components/portfolio/PortfolioDashboardDesktop.jsx`.

| Legacy behavior/output | V1 decision | Reason |
| --- | --- | --- |
| Handler fetches KIS/Finnhub/Alpha Vantage while calculating. | Replace. Query stored history, then call a pure helper. | Render latency, provider limits, retry behavior, and calculation must be separate. |
| Universe permits only `etf` and `stock`. | Replace with capability-based eligibility. | Current modeled market assets use additional types. |
| `seriesMap` is keyed only by ticker. | Replace with stable holding identity plus normalized market/ticker. | Same-ticker holdings must not overwrite each other. |
| All assets are aligned by full date intersection. | Replace with versioned portfolio reference-date calendar. | Cross-market holidays unnecessarily shrink and bias the sample. |
| Cached USD rows can use row FX, while provider fallback multiplies all history by one current settings FX. | Replace with date-specific historical FX for every USD observation. | The two paths have different return semantics; constant FX removes FX return. |
| Current values determine static weights. | Preserve with explicit end-date/as-of semantics. | Appropriate for current-portfolio risk, but not a historical strategy return. |
| Log returns. | Replace with documented simple KRW returns. | Easier contribution and user-facing return interpretation; parity differences must be fixture-recorded. |
| Annualized volatility with `sqrt(252)`. | Preserve. | Standard for the approved close-date calendar. |
| Weighted average correlation. | Preserve after null/coverage hardening. | Formula is transparent and useful. |
| Risk contribution from `w(i) * (Sigma*w)(i) / sigma(p)`. | Preserve. | Standard Euler volatility contribution. |
| ENB from normalized absolute risk contribution. | Preserve and name precisely. | This is not correlation eigenvalue effective rank. |
| Undefined correlation becomes zero. | Replace with null plus reason. | Zero means no measured relationship, not insufficient variance. |
| Sharpe silently uses risk-free rate zero. | Preserve only as an explicit versioned assumption. | Existing UI wording does not disclose the actual assumption. |
| Benchmark comments and variables say SPY while data uses `069500`. | Defer beta/alpha and define benchmark later. | Labels and source disagree. |
| Per-asset benchmark metrics slice arrays after benchmark-date filtering. | Do not port. | This can pair returns from different dates. |
| Snapshot-value CAGR. | Do not port in v1. | Contributions/withdrawals make start-to-end value growth an invalid investment return. |
| `divScore`, stress badges, alpha, beta, momentum, MDD, CAGR. | Defer. | Composite or separate analytical products need their own contracts and tests. |
| Stored ENB/correlation/volatility scalars lack full input provenance. | Historical evidence only. | They cannot reproduce a current calculation reliably. |

## Pure Helper Boundary

Future calculation code should be independent of Next.js, Drizzle, Neon, and
provider clients. A helper such as `src/lib/portfolio-risk.ts` should accept a
fully normalized input:

- formula policy and version;
- selected account and window;
- sanitized holding identities and end weights;
- aligned KRW return series and dates;
- risk-free rate.

It should return only the display-ready metrics and data-health metadata. A
separate server-only DB adapter should load `assets`, price history, and FX,
construct the aligned input, and call the helper.

Expected complexity for `n` holdings and `t` observations is `O(n^2 * t)` for
covariance/correlation and `O(n^2)` memory. That is appropriate for the current
portfolio size. Do not add eigenvalue decomposition unless correlation
effective rank becomes an explicitly approved output.

## Fixture Gate

Before a DB adapter or route is added, fixtures must cover:

1. Two equal-weight perfectly correlated holdings.
2. Two equal-weight independent synthetic series.
3. A hedge with negative signed risk contribution.
4. USD local price unchanged while USD/KRW changes.
5. USD price and FX changing on the same reference date.
6. Korea-only and US-only holidays with bounded carry-forward.
7. Missing/stale FX and missing price exclusions.
8. A zero-variance series producing null correlation.
9. Duplicate ticker across accounts without identity collision.
10. Account filtering and weight renormalization.
11. Requested versus partial versus insufficient windows.
12. Sanitized output with no UUID, legacy id, provider auth, or raw metadata.

Add captured legacy fixtures for at least brokerage 30/90/252 and all-account
90-day cases. Store expected legacy outputs separately from canonical expected
outputs so intended formula corrections are visible rather than hidden behind
one parity number.

## Runtime Sequence After Policy Approval

1. Approve calendar, FX, risk-free rate, coverage, and asset-universe policies.
2. Add normalized fixture files and pure calculation tests.
3. Implement the pure helper.
4. Add a server-only Drizzle adapter that reads stored data in parallel where
   independent.
5. Add a minimal read-only Server Component surface using URL search params
   for account and window.
6. Add local client components only for matrix/table interaction that does not
   refetch first-render data.
7. Run lint, tests, build, read-only DB count checks, auth/render/leak smoke,
   and responsive table overflow smoke.

## Decisions Still Required

- Maximum price carry-forward days.
- Maximum FX carry-forward days.
- Minimum observations and coverage percentage per window.
- Whether `all` mixes account holdings into one covariance model or also shows
  account-separated summaries.
- Whether risk-free rate stays at explicit 0% or receives a versioned stored
  source.
- Final future route and whether allocation and risk share one tabbed surface.
- Whether imported historical scalar evidence needs an operator-only audit
  view.
