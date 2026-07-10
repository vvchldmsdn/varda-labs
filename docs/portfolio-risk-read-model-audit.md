# Portfolio Risk Read Model Audit

Last updated: 2026-07-10

## Scope

This slice connects the existing portfolio-risk input normalizer and pure math
core to stored Postgres evidence. It remains read-only and now feeds the
minimal `/portfolio/risk` Server Component route.

Implemented boundaries:

- pure read-model composer in `src/lib/portfolio-risk-read-model.ts`;
- dependency-injected loader in `src/lib/portfolio-risk-read-loader.ts`;
- `server-only` Drizzle repository in `src/db/queries/portfolio-risk.ts`;
- SELECT-only Neon smoke in `scripts/audit-portfolio-risk-read-model.mjs`.

No provider, API mutation, render write, cache persistence, schema, migration,
snapshot, or Cron path is part of this slice.

## Query Order

The loader does not treat all reads as independent:

1. Read the selected account assets.
2. Derive normalized ticker identities and whether USD/KRW is required.
3. Read bounded price history and FX history in parallel.
4. Compose normalized input and calculate only when its status permits.

The FX lower bound is three calendar days earlier than the price lower bound.
This preserves the approved FX carry candidates before the first queried price
date. Both lower bounds are returned as provenance.

## Safe Output

The repository explicitly selects only display and calculation fields. The
read model does not return DB UUIDs, Base44 ids, provider payloads, provider
errors, imported KRW close values, row-level imported FX values, or auth
metadata. Price/FX source labels are reduced to aggregate counts.

Sample price rows, sample FX rows, and non-`ok` FX rows are excluded before
canonical duplicate checks. A duplicate approved FX date in the relevant
window remains a hard blocker. Matrix indexes use the exact order of
`calculation.instruments`, and nullable metrics keep their reason instead of
falling back to zero.

## Production Database Smoke

The 2026-07-10 SELECT-only run used service cycle `2026-07-10` and latest
source evidence through `2026-07-09`.

| Account | Window | Input status | Calculation | Usable / requested | Instruments |
| --- | ---: | --- | --- | ---: | ---: |
| brokerage | 30 | ready | complete | 30 / 30 | 10 |
| brokerage | 90 | ready | complete | 90 / 90 | 10 |
| brokerage | 252 | insufficient_coverage | unavailable | 142 / 252 | 10 |
| isa | 30 | ready | complete | 30 / 30 | 4 |
| isa | 90 | ready | complete | 90 / 90 | 4 |
| isa | 252 | ready | complete | 252 / 252 | 4 |
| irp | 30 | insufficient_instruments | standalone_only | 30 / 30 | 1 |
| irp | 90 | insufficient_instruments | standalone_only | 90 / 90 | 1 |
| irp | 252 | insufficient_instruments | standalone_only | 252 / 252 | 1 |
| all | 30 | ready | complete | 30 / 30 | 15 |
| all | 90 | ready | complete | 90 / 90 | 15 |
| all | 252 | insufficient_coverage | unavailable | 142 / 252 | 15 |

For brokerage, `10 / 13` means ten risk-eligible instruments out of thirteen
selected asset rows. `금현물`, `적금`, and `청약` are excluded because they
have no ticker and therefore no canonical historical price series. The route
labels this as `리스크 계산 대상`, not a total portfolio holding count.

The v1 Sharpe calculation intentionally uses an explicit annual risk-free-rate
assumption of 0% until a canonical KRW-investor source is approved. The route
labels this value as an assumption; it is not a fetched current policy rate.

The audit made 32 SELECTs. Relevant row counts were unchanged before and
after: 19 assets, 11,329 asset price snapshots, and 468 FX rows. The compact
audit output passed the internal-id and secret-pattern scan.

## Route Smoke

Local production-mode smoke covered:

- no auth `/portfolio/risk` -> 401;
- brokerage/90 -> complete sections;
- brokerage/252 -> unavailable provenance and data health only;
- IRP/90 -> standalone volatility/Sharpe and instrument table only;
- ISA/252 -> complete sections;
- authenticated responses -> 200 with no internal-id or secret-pattern match;
- relevant DB counts unchanged before and after all renders.

The same smoke passed against `https://varda-labs.vercel.app` after commit
`3299d98` deployed. The in-app browser blocked both protected targets, so a
responsive visual review remains separate from the verified HTTP and overflow
contracts.

The route uses server links for account/window changes and has no client-side
first-render refetch. Tables and matrices own their horizontal overflow.

## V1 Closure

After user mobile review, the dashboard sidebar keeps `자산 배분` linked to
`/portfolio/structure` and adds a separate `위험·분산` link to
`/portfolio/risk`. Protected smoke verifies both links and their order.

Portfolio Risk v1 is closed. Gold proxy mapping, historical risk-free data,
provider refresh, API mutation, recommendation, composite score, schema, and
Cron work remain separate future decisions.
