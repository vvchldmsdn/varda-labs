# KIS historical close reliability

## Incident and verified scope

Twelve previously collected raw closes disagreed with later KIS raw/adjusted responses. All twelve had automated KIS provenance and no adjusted companion. The historical paired writer required exact equality with the existing raw value and permanently stopped conflicting jobs. Separately, the scheduled gap detector considered raw presence sufficient and did not independently request the missing adjusted companion. This left the bootstrap input window incomplete even though raw price rows existed.

Two independent KIS observations agreed on the corrected raw and adjusted values for all twelve historical rows. The repair used a full-row compare-and-swap, all-or-none count guard, before/after audit, and private rollback artifact. It changed reference market data only. Full-content fingerprints of nine protected tables were identical before and after repair and the follow-up collection: holdings, event ledger, cash balances, saved portfolio/position snapshots, saved cutoff price/FX observations, recovered valuations, and saved simulation executions. Raw provider responses and account-specific validation output remain outside the repository.

The exact historical cause of the twelve discrepancies cannot be proved because the original HTTP response bodies were not retained. They were fetched after regular US close; the replacement raw and adjusted values matched, so this is not evidence of a split adjustment. A separate live reproduction did verify the unsafe finality assumption: the current New York day's KIS dailyprice `clos` changed between independent queries a few seconds apart after regular close. Thus the KST 07:00 service cutoff is not itself evidence that this provider's daily bar is final.

KIS's official [dailyprice implementation](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/dailyprice/dailyprice.py) supports raw/adjusted selection. Its [example field mapping](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/overseas_stock/dailyprice/chk_dailyprice.py) calls `clos` a close, but provides no finality flag or guaranteed finalization time. The policy below is deliberately conservative; it is not a claim of a vendor finality guarantee.

## Admission and automatic correction

- A US historical bar is admitted only if its receipt was collected after the New York calendar date ended. A stored provisional receipt never becomes admitted just because the system clock advances; a fresh provider receipt is required. Exchange holidays remain governed by the shared market calendar.
- Both apps use the same generated research module and select the latest common admitted source day by default. Explicit historical end dates remain explicit and never silently move. US source trade day and service observation day are displayed separately.
- A changed raw value requires two independent, chronologically ordered provider reads with matching raw and adjusted values, identical symbol/exchange/source identity, and valid adjusted provenance. No UI input can authorize a revision.
- The atomic writer locks the current collection claim and existing rows, checks the lease and window, and records old/new values with the first confirming observation. Manual/foreign provenance, newer evidence, absent raw receipt, or discrepancies beyond the existing 3% operational review limit remain protected. That limit is an escalation boundary, not a financial normalization rule.
- Raw gap insertion has a separate claim-fenced `ON CONFLICT DO NOTHING` writer. A row created concurrently, including a manual override, wins. The collector does not use a general update/upsert for missing raw data.
- Missing adjusted companions are collected independently from missing raw closes. Legacy exact-equality failures get one policy-version recheck. Current unfinalized or changing provider values remain pending without exhausting ordinary retry attempts; protected discrepancies remain explicit failures.

## Schedule and current frontier

The original application owns collection. Beta is a read-only consumer of the same shared reference data.

Existing schedules remain unchanged:

| Route | UTC | KST | Scope |
| --- | --- | --- | --- |
| `/api/cron/market-cycle/run` | 22:00 | 07:00 next day | Existing market cycle |
| `/api/cron/simulation-executions` | 20:00 | 05:00 next day | Existing saved research job |
| `/api/cron/market-history/run` | 05:15 | 14:15 | New bounded history catch-up only |

The new catch-up runs after New York midnight in both standard time and daylight saving time. It retains admin/cron authentication and the existing `MARKET_CYCLE_CRON_WRITE_ENABLED` gate, rejects query parameters, and drains only history jobs for at most 120 seconds. It does not write account snapshots or saved research. Provider outages can leave work pending for the next invocation; current values are never fabricated to fill gaps.

At the 2026-10-28 KST verification, the latest admitted US source day was 2026-10-26 and the service observation day was 2026-10-27. The still-updating US 2026-10-27 bar remained pending. Both actual default bootstrap readers returned ready, selected the same window automatically, and produced exactly equal weights, coverage, all terminal metrics, bands, and all 1,000 paths. The previous fixed historical recovery date was not used.

## Verification and rollback

Run the portable checks in the original application:

```sh
node --test tests/market-data/kis-history-revisions.test.mjs tests/market-data/history-cron.test.mjs
```

For the PostgreSQL writer checks, provide `CAIRN_SQL_TEST_URL` through the environment and run:

```sh
node --test tests/market-data/history-writers.integration.test.mjs
```

The SQL test writes only transaction-local temporary copies of the public table schemas, removed on commit. It covers matching confirmations, manual protection, missing confirmation, the review threshold, foreign/newer adjusted receipts, expired claims, absent-row insertion, and a concurrently created manual row. It does not modify public rows. Without the environment variable the integration test is explicitly skipped.

In beta, `node --test tests/cairn-simulation-ui/*.test.mjs` verifies the canonical/generated hashes, holiday and split handling, missing adjusted data, provisional receipts, latest versus explicit date labels, recovery bounds, and actual path parity. Both application builds also verify the generated shared-domain manifest.

Each automatic revision records a market-data audit. The incident's private rollback script requires explicit execution confirmation and full current-row equality with the recorded post-repair row before restoring the touched fields. If newer collection has changed a row, rollback refuses to overwrite it and requires a fresh evidence review. Never roll back user trades, cash, saved observations, or saved research to undo a reference-price repair.
