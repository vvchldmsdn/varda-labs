# Portfolio Risk Readiness Audit

Last updated: 2026-07-10

Status: SELECT-only readiness evidence. No providers, writes, schema changes,
migrations, Cron changes, snapshot changes, cleanup, or backfill were run.

Command:

`npm run audit:portfolio-risk`

Detailed per-instrument output:

`node --no-warnings scripts/audit-portfolio-risk-readiness.mjs --details`

## Scope

The audit reads current `assets`, matching `asset_price_snapshots`, and
`fx_rates`. It:

- maps a row dated D to the KST 07:00 service cycle D+1;
- aggregates holdings by normalized market/currency/ticker before risk math;
- checks price and FX duplicates and market/currency conflicts;
- measures 30, 90, and 252 requested return observations;
- compares 0, 3, 5, 7, and 10 calendar-day carry limits;
- emits no UUID or Base44 legacy id.

## Database Evidence

- Current-ticker price rows: 9,637 across 15 tickers and 950 dates.
- `asset_price_snapshots(ticker,date)` duplicate groups: 0.
- Price ticker market/currency conflicts: 0.
- Current asset ticker market/currency conflicts: 0.
- Matching USD legacy FX/close-KRW rows: 1,305; retained as parity evidence,
  not canonical FX.
- FX rows: 468 across 467 dates.
- FX date unique index: absent.
- Duplicate FX date: 2025-05-08, two rows with the same numeric value.
- FX statuses: 467 `ok`, one blank.

The duplicate FX date is before the current 252-observation range, so it does
not change the latest readiness result. A future selected range containing the
date must still block deterministic canonical FX selection until the duplicate
policy or data is resolved.

## Current Universe

| Scope | Selected holdings | Market-risk instruments | Explicit exclusions | Multivariate ready |
| --- | ---: | ---: | ---: | --- |
| brokerage | 13 | 10 | 3 tickerless | yes |
| ISA | 4 | 4 | 0 | yes |
| IRP | 2 | 1 | 1 tickerless | no |
| all | 19 | 15 | 4 tickerless | yes |

There are currently no same-instrument holdings across accounts, but the audit
and contract aggregate them if they appear later. This prevents duplicate
return columns and ENB inflation.

## Coverage Results

Brokerage and all-account results are identical at the limiting windows because
the three shortest histories are brokerage holdings.

| Scope | Window | Result with price carry 7 / FX carry 3 | Status |
| --- | ---: | --- | --- |
| brokerage | 30 | 30/30 returns | ready |
| brokerage | 90 | 90/90 returns | ready |
| brokerage | 252 | 142/252 returns (56.35%) | insufficient_coverage |
| ISA | 30 | 30/30 returns | ready |
| ISA | 90 | 90/90 returns | ready |
| ISA | 252 | 252/252 returns | ready |
| IRP | 30/90/252 | price history is complete for one instrument | insufficient_instruments |
| all | 30 | 30/30 returns | ready |
| all | 90 | 90/90 returns | ready |
| all | 252 | 142/252 returns (56.35%) | insufficient_coverage |

The limiting 252-observation histories are:

| Ticker | Value-date coverage | First stored close |
| --- | ---: | --- |
| `0092B0` | 90.12% | 2025-08-19 |
| `0101N0` | 80.24% | 2025-09-23 |
| `0139P0` | 56.52% | 2025-12-16 |

The short history is not a carry-forward problem. Raising the carry limit from
7 to 10 days leaves the full-universe 252 result at 142 returns. V1 therefore
does not remove those current instruments just to manufacture a one-year
metric; it reports the 252 window as insufficient and keeps the 90 window
available.

## Threshold Decision

Fixture-design parameters:

- price carry: maximum 7 calendar days;
- FX carry: maximum 3 calendar days;
- minimum return coverage: 80%;
- minimum multivariate universe: 2 instruments;
- no automatic low-coverage instrument deletion.

The price limit covers observed long cross-market holiday gaps in the latest
252-date range. The FX maximum observed in all current windows is two calendar
days, so three days provides a bounded weekend margin.

## Calendar Blocker

The audit found 21 unique current-ticker price rows that disagree with the
existing static Korean holiday helper. Repeated affected dates include:

- 2022-12-26;
- 2023-01-02;
- 2025-02-28.

The rows are positive stored closes. The helper incorrectly applies a shared
US-style observed-fixed-holiday rule to historical Korean dates, including
moving some Saturday holidays to the previous Friday. The audit preserves the
rows and reports the mismatch.

Do not modify the production snapshot calendar as part of this audit. Before
portfolio-risk fixtures use the helper as canonical historical truth, correct
the Korean holiday policy with focused historical fixtures and separately
review its snapshot/Cron blast radius.

## Next Gate

Do not start the risk DB adapter or UI yet. The next safe slice is:

1. focused Korean historical calendar correction plan and fixtures;
2. selected-window duplicate FX policy fixture;
3. normalized portfolio-risk input fixtures;
4. pure calculation helper only after those boundaries pass.
