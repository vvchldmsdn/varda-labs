# Operating recovery — verified code and remaining recovery work

Base: `d7d4472cc04a88cacec90b2ea80ee2236a10b56d` (master). Branch: `codex/operating-recovery-20260928`.
Primary dirty checkout is preserved. User authorized completion, confirmed financial recovery and Production release. The scoped 0061 migration was applied on 2026-09-28 UTC; original target revisions and application RLS privileges were verified unchanged. Financial application follows the compatible application release.

## Implemented connected paths

| Area | Connected changes | Evidence | Operating status |
| --- | --- | --- | --- |
| Daily / Today | `snapshots/daily.ts` keeps PostgreSQL microsecond CAS tokens; owner-scoped `snapshot-progress.ts` distinguishes failed/blocked/completed work. Existing lock, completed-cutoff immutability and 0059 fence remain. | Actual PostgreSQL microsecond/race/failure cases; actual route browser. | Not deployed. Original failed receipt has only a generic failure, so precision is a reproduced defect, not proof of the original exception. |
| Home scroll | `scrollable-nav-rail.tsx` moves only the rail horizontally. | Actual Next app at 1440/1366/390: manual refresh, focus refresh, queued polling. | Not deployed. |
| Targets / contribution | `portfolio-target-plan.ts`, real query/writer, tenant reader and 0061 preserve held/unheld identities, explicit zero, first-buy binding and archived holdings. New plan rows never create holdings. Server-resolved catalog and owned account validation, revision CAS, retained draft/retry feedback. Contribution consumes the same approved vector; unheld value is zero, cost unknown. | Actual PostgreSQL writer/query/RLS and full-app save/reload, stale tab and candidate flows. | 0061 and coordinated application release pending. Older schemas remain supported by the audit registry; new application target queries require 0061. |
| KIS / simulation | Distinct domestic 1/0 and overseas 0/1 raw/adjusted requests. `kis-paired-history-write.ts` locks a live queue claim, validates instrument/date/basis, preserves existing raw observations and rejects conflict. Expired workers cannot insert/update. New jobs use `paired_v1`; old jobs are rejected before calling provider. Actual legacy research requires validated adjusted history. | Synthetic HTTP response tests use actual adapter. Actual PostgreSQL queue/claim → paired writer → DAL → calendar/return engine; split raw100→50 / adjusted50→50 yields 0%. | Two current instruments passed actual provider normalization with four data requests; no full history collection yet. |
| Full liquidation evidence | `broker-securities-recovery.mjs` preserves broker-reported fill quantity alongside confirmed zero remaining holdings; rejects partial/stale misuse. Event disclosure keeps these distinct. | Unit and actual PostgreSQL mismatched quantity / retry / unchanged cash and snapshot cases. | No customer recovery applied. |

## Calendar and market semantics

The verified 2026 KR/US exchange-session union is independent of personal holding dates. Missing open-market closes remain missing; only confirmed closures carry within the existing seven-day limit. September 28 is not a Korean substitute holiday: September 28 cutoff uses September 23 close; September 29 uses September 28 close.

New adjusted research matrix: `simulation_return_matrix_calendar_adjusted_v2`. Previously stored versions retain their meaning. No KRW path is relabeled USD; no bootstrap model is presented as the economic model. Provider-adjusted price return does **not** claim dividend reinvestment or total return. Complete adjusted coverage and matching provider/source are required; endpoint-only coverage cannot pass.

Official request references: [KIS domestic parameter](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py), [KIS overseas parameter](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/dailyprice/dailyprice.py), [KIS backtester adjusted request](https://github.com/koreainvestment/open-trading-api/blob/main/backtester/kis_backtest/providers/kis/data.py).

Actual provider check used only the existing shared lease/HTTP budget and saved a private response receipt. It did not write market observations or customer data. This proves a small response/normalization sample, not full-window coverage or all corporate-action semantics.

## Verification (separate checkpoints)

- Full-app production build / browser: `output/operating-recovery/target-fullapp-confirmed-result.log` PASS. Actual local PostgreSQL, real route/query/writer; only external identity and collection boundaries substituted in a disposable build. Candidate desktop/mobile screenshots visually inspected. Real email/OAuth NOT RUN.
- General actual PostgreSQL: `output/reliability-ci/postgres-integration-2W9w6V/report.json` PASS, including confirmed liquidation with differing reported quantity and unchanged cash/snapshots/other owner.
- Latest cutoff/target/paired-history PostgreSQL: `output/krw-usd-rc-rehearsal/local-zLg0so/report.json` PASS, including raw immutability, conflict, stale worker, missing-open-day and idempotent collection cases.
- Latest isolated lint / route types / TypeScript: `output/reliability-ci/lint-type-UAxCsw/report.json` PASS.
- Final isolated full tests: **3,061 passed, zero failed/skipped**, `output/reliability-ci/unit-tests-NqBLGM/report.json`, source SHA256 `3a5121f86a614f3ef4fb4569cc24d7175eeb576aec90d9ca9c5d3e862b53ef51`. Final Production build: `output/reliability-ci/production-build-UlkD9y/report.json` PASS. Earlier full run failed obsolete shape assertions and an omitted writer-registry entry; these were corrected, not waived. Only documentation/private operator artifacts changed after these final checks.
- Source and authorization registries include the new writer and plan table. Existing earlier schema stages remain distinct; no tenant direct financial DML is granted.

## Remaining real recovery work — not represented as finished

1. Private reconciliation: old recovery identity matched; photographed accounts and full-liquidation residuals confirmed; execution dates/foreign display timezone newly confirmed in the private receipt. Exact intraday times, fees, taxes and net settlement are not inferred. Reservations and zero-filled originals are excluded. The exact seven-row application plan was confirmed and passed the private disposable PostgreSQL clone, rollback and idempotency checks; it is not a public fixture.
2. Historical replay: this account is legacy, not native. The existing securities-recovery writer changes current holdings/events and deliberately leaves snapshots unchanged. The unchanged-holdings gap backfill cannot replay a traded interval. `scripts/lib/broker-history-reconstruction.mjs` now replays original manifest/event quantities, requires dated raw closes and dated FX, and inserts immutable, evidence-hashed reconstructed revisions. It processes the bounded full requested interval, including dates with no original row. Same-day date-only ambiguity blocks that date. Existing native replay is not used to invent an opening cash/quantity history. Original snapshots remain stored; newer reconstructed revisions supersede only reconstructed revisions. A valid post-recovery daily cutoff record is preserved.
3. Missing manual-asset cutoff evidence remains a separate blocker. No current manual value may be copied back to a historical 07:00 cutoff. Existing dated manual carry is admitted only with the existing manual source/basis/reference policy, explicitly labeled stored carry rather than an observed cutoff quote; future/fallback/unknown provenance is rejected. Date-only events require an uncertain boundary where appropriate; do not fabricate a timestamp.
4. Current quotes for the two new instruments were explicitly approved and successfully fetched with the existing KIS connection: two requested, two successful shared `live_price_quotes` inserts, zero failures. Read-back confirmed both. No customer assets, ledger, cash or snapshots changed. The initial automatic approval rejection was resolved by the explicit two-instrument approval. Whole-window market-history collection remains pending the compatible worker release; the two current quotes do not establish historical coverage.
5. Native currency research is a separate admission path; the corrected legacy adjusted-history path does not by itself certify native/USD corporate-action admission.
6. 0061 operating migration PASS: pinned Production endpoint, exact applied journal comparison including byte-verified historical mixed-newline equivalence, atomic new schema/journal write, original revision digest unchanged, RLS and SELECT-only tenant privileges checked. Application deployment, financial application and real-user screen verification follow this checkpoint; do not infer these from migration success.

## Rollout / recovery constraints

Keep 0059 compatible/paused protection, owner locks, CAS, lease generations, original ledger and tombstones. Apply 0061 only after approval, before releasing the new target reader/writer. Older code must not replace a v2 target plan by dropping unheld rows. Do not roll back to pre0059 code. Market history must use versioned paired claims; do not enqueue new jobs while an incompatible older worker can consume them. Customer recovery is a separate owner-bounded operation, with before-state hash, private backup, rehearsed restore, idempotent operation identity, and final re-read.

No Topup activation, new news/performance policy, paid plan, pre-07 scheduler, new provider, unrelated home redesign or dirty-worktree consolidation is included.

## Final historical recovery checkpoint

- Six pure historical tests cover dated quantity replay, strict cutoff boundaries, missing price/FX, reconciliation, manual evidence absence, and invalid/future manual provenance. Actual reader tests preserve other owners and normal originals while choosing the latest reconstructed revision.
- Actual PostgreSQL compatible/paused writer tests include dry-run rollback, repeated writes, no changes to cash/holdings/ledger during history reconstruction, and preservation of a valid post-recovery cutoff snapshot. Lock and statement timeouts precede release-lock acquisition.
- Private disposable PostgreSQL clone (ignored private evidence): seven confirmed trades applied once; five reconstructable dates saved and nine dates blocked by explicit evidence gaps; repeated application inserted zero. This is not operating completion evidence.
- Existing KIS lease/budget collected 24 missing raw close observations with 14 data requests; no existing observation was overwritten. This supports dated valuation, not the full adjusted simulation training window.
- Final lint/type: `output/reliability-ci/lint-type-0p0ngK/report.json` PASS.
- Final actual PostgreSQL: `output/reliability-ci/postgres-integration-Nb9bBX/report.json` PASS.
- Final Production build: `output/reliability-ci/production-build-VgPkFy/report.json` PASS; source SHA256 `7bc7586c7da46758e584b6fe6f97eeb67853a44d65dad9066d99f85a709dd103`.
- Final full tests: `output/reliability-ci/unit-tests-KlJxzE/report.json` (completion recorded in release evidence). Prior full tests passed at the preceding history checkpoint; they do not substitute for this final source run.
- Customer inputs, raw broker evidence, IDs, balances, credentials and operator receipts remain in ignored private storage, never in source/test fixtures or this document.
