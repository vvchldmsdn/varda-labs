# Multi-user collection and contribution comparisons

Implementation: 2026-09-09. This document records the executable subset of
`market-data-expansion-plan.md` and `additional-contribution-adjustment-policy.md`.

## Market collection

- Authenticated requests inspect the owner's holdings and existing shared evidence.
  Missing live quotes, USD/KRW evidence and requested history enter a durable queue.
  The queue contains instrument identity and observation periods, never account
  holdings, quantities, user identifiers, credentials or tokens.
- Matching instrument jobs coalesce. Live/FX requests have a short initial priority;
  aging ensures old ready work can run. Duplicate requests do not jump the queue.
  This is fairness between instrument jobs, not a weighted per-user quota.
  A claim expires after interruption; bounded attempts and randomized
  exponential backoff prevent a failing symbol from monopolizing collection.
- Each actual KIS HTTP call, including token issuance and exchange probes, reserves
  a credential-scoped database budget. Defaults are conservative operating settings:
  60 requests/minute, at least 1 second between reservations, and at least 60 seconds
  between token issuance attempts. These are not a provider-guaranteed entitlement.
  `KIS_REQUESTS_PER_MINUTE`, `KIS_MIN_REQUEST_INTERVAL_MS` and
  `KIS_TOKEN_MIN_INTERVAL_SECONDS` can lower or configure them for the account.
- Provider throttling, including KIS rate-limit codes in HTTP 200 responses, defers
  work. A policy wait is not an instrument failure. Token failures also coalesce
  within a warm process and respect a retry cooldown. Tokens remain in server
  memory; this does not implement cross-instance token sharing.
- The worker runs after responses, and existing cron execution also wakes it.
  Visible waiting screens can recheck and wake pending work for a bounded period.
  Closing every client does not create a continuously running worker: pending work
  remains durable until the next authorized wake or existing daily cron. A separate
  continuously scheduled service is needed to promise unattended minute-level SLAs.
- Existing owner/tenant/RLS boundaries and provider job mutual exclusion remain.
  Ordinary display reads do not synchronously traverse a provider call chain.
  Missing values are not saved as zero or represented as a successful collection.
- `/api/admin/market/collection` returns queue and request-budget aggregates under
  the existing admin authorization. It does not expose queue symbols, credential
  hashes, account details or raw provider errors to public callers.
  Merged-request counts describe retained jobs' current collection cycles; they
  are not a lifetime count of provider calls saved.

The two new operational tables have RLS enabled with no tenant policies. This
change introduces no financial-position migration and stores no provider secrets.
Technical request sharing does not establish additional KIS or exchange display
rights. Those remain a separate provider-contract matter; no new feed was purchased.
See the [KIS partnership guidance](https://apiportal.koreainvestment.com/provider-info).

## Contribution evidence and choices

- Operational MA120 evidence version 2 requires both the actual comparison-price
  timestamp and the final history observation. Unknown/future timestamps, a price
  over 168 hours old, or history over 7 KST calendar days old make trend evidence
  unavailable. Collection timestamps cannot substitute for price timestamps.
  This is a data-freshness ceiling, not a claim that seven days is an optimal
  investment parameter. Holidays are not converted to synthetic zero returns.
- Existing target totals, drift/trim rules, class multipliers, gold/bond exemptions,
  original target storage and integer-won fund conservation are unchanged. An
  unusable trend does not invent a reduction; the base target calculation remains.
- The optional cash-reserve comparison starts off. It retains a user-selected
  percentage of **new money**, counting new money already left unspent. The target
  reserve is rounded down to whole won. Baseline buys and leftover cash are first
  attributed proportionately to new money and calculated sale proceeds using exact
  largest remainder. That is a calculation convention, not observed cash tracing.
  Additional reserve reduces only new-money-funded buys; sale-funded buys remain.
  No holding receives a compensating increase and no sale or saved target changes.
- The screen compares baseline and scenario purchases, cash and each holding's
  changes. Results join by allocation key, not display order. The comparison is
  loaded on opening its dialog and does not call an external API.
- The market panel reads bounded stored USD/KRW observations in parallel with the
  contribution query. It rejects missing provenance/time, invalid/future values;
  observations over 3 days old remain visible as stale. A range needs at least 20
  distinct dates from the same source within the last 90 days as of evaluation.
  Equal-valued or insufficient histories have no invented range-position score.
- A separate FX slider mechanically compares current USD-priced holdings under
  a chosen translation-rate change, keeping asset prices fixed. It does not infer
  exposure for KRW-listed global ETFs, hedges or derivatives, does not measure total
  currency risk, and does not change the contribution allocation.
- Rates, news and industry outlooks are not assigned unvalidated automatic money
  multipliers. Official-source links are navigation, not claims of collected facts.
  Adding automated modifiers still requires identified exposure, publication-time
  evidence, a policy version and out-of-sample comparison against the baseline.

Neither comparison places an order, rewrites private history or changes the 07:00
KST service-record boundary. Korean and English use the same amounts and rules.
