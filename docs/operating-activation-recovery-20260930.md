# Operating activation recovery — 2026-09-30

Base: `737b38f89350a6b7bfe41fd347f3b3abc8bf011b` (same tree as Production `8187ca3f069f351f6187d6bf268fa0e805fda6b0`). Existing unrelated work stays in the primary checkout.

## Implemented boundaries

- KIS paired writes preserve conflicting old/candidate raw price, source, provider symbol and exchange atomically in `market_data_sync_runs`. Conflict jobs are terminal and retained by cleanup; no automatic raw overwrite or blind retry.
- An approved, private operator reconciliation preserved the full old rows, reviewed matching provider identity, and applied newer explicitly paired raw/adjusted responses. Operator receipts and customer inputs are deliberately excluded from Git.
- Historical reconstruction accepts owner/account-bound confirmations of execution AFTER the daily cutoff without inventing exact execution timestamps. Date-specific manual amounts are total valuations, not unit prices. Original ledger and holdings remain untouched.
- Previously stored, unchanged KRW manual valuations may carry forward with snapshot provenance. Cross-owner/account, late capture, changed quantity/value, sample and foreign-currency carry are rejected.
- Today compares matching movement-eligible positions, including real exits; it does not copy current manual values into a supposed past total. Stale unmatched positions do not inflate the return denominator.
- Today position baselines keep account authorization plus explicit snapshot ownership. Each account's recovery validity is independent. The stricter whole-scope History recovery guard remains intact.
- The simulation default endpoint requires KIS adjusted-close evidence. New raw-only rows cannot displace a complete adjusted window. Provider binding conflicts still block; the full matrix still validates every return cell. The UI retains the actual historical reference date and excluded manual holdings.

## Evidence

- Real KIS response bodies and paired row comparisons retained privately; no credentials in reports.
- Exact reconstruction input exercised through PostgreSQL 17.11 / all 62 migrations: immutable 14-date insert, repeat idempotence, unchanged original holdings/ledger and original snapshots.
- Actual IRP daily writer through PostgreSQL: full snapshots, unchanged manual amount/quantity and explicit carry provenance.
- PostgreSQL queue tests: terminal conflict, re-enqueue refusal, stale-claim rejection and atomic conflict evidence.
- Actual generated baseline SQL: allowed accounts admitted while foreign owner, outside account, wrong account code and outdated recovered position excluded.
- Tests: `broker-history-reconstruction`, `kis-paired-conflict-evidence`, `manual-cutoff-carry`, `portfolio-movement`, `portfolio-dashboard-query-demand`, `simulation-adjusted-endpoint`.
- Production browser: Brokerage bootstrap and economic models rendered 1,000 paths, 90 common historical returns and explicit listed-subset/manual-gold exclusion before the new daily cycle.

## Distinct current cutoff limitation

The 2026-09-29 baseline repair and 2026-09-30 missing cutoff are different events. At the new cycle, retained price/FX observations were absent. The first refreshed KIS FX receipt was after 07:00; it cannot be backdated. No freshness relaxation, timestamp fabrication, customer ledger change or Cron configuration change is part of this release. KRW-only scopes are evaluated independently when their evidence is sufficient. Future automatic readiness still needs a genuinely pre-cutoff collection schedule; a job starting at/after 07:00 is not precollection.

## Release / recovery

No schema migration. Deploy only this change list after tests, lint, build and review. Preserve market conflict audits and reconstruction snapshots. If a defect appears, pause affected writes and use a revision-aware compatible fix; do not delete financial history or roll back to pre-revision writers. Production postflight must distinguish visible simulation success, scope-specific Today results and missing current-cutoff evidence.

## Final local and current-cycle checks

- Final related regression set: 31 passing; movement/manual regression set: 44 passing. The adjusted-endpoint actual SQL regression passes independently after the full suite started.
- ESLint passed. Production webpack build passed with unreachable loopback-only database URLs. The worktree dependency junction prevents Turbopack root resolution locally; this is separate from the passing production compile.
- The actual application query against operating data returns Brokerage history `ready` and simulation `ready` after the new daily cycle.
- ISA and IRP 2026-09-30 full baseline writes completed with sufficient KRW evidence. ISA Today displays its actual calculated result and four contribution rows; 390px viewport has no horizontal overflow.
- Brokerage 2026-09-30 cutoff FX remains unavailable. Its first FX receipt after the cutoff is not retroactive evidence. This is an explicit remaining operating limitation, not a completed repair.
- Full isolated test suite: 3,077 passed, zero failures/skips; plus the final adjusted-endpoint SQL regression passed separately. No provider requests or operating database writes were used by these test commands.
