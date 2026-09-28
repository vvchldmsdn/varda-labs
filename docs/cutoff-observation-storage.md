# 07:00 cutoff receipt preservation

`0060_snapshot_cutoff_observations` adds two shared tables. They contain no owner,
account, holding, transaction, credential or personal input. Existing KIS quote
and FX cache writes capture eligible receipts in an AFTER trigger in the **same
transaction**. An unchanged FX refresh explicitly records its new receipt; it
does not modify a provider observation timestamp. No new provider or paid source
is enabled.

## Time and admission

- Target T is 07:00 Asia/Seoul. Capture only completed responses in [T−15m,T].
  A request started at 06:59 and completed at 07:01 cannot qualify. KIS live and
  KIS FX adapters now stamp response completion after the response body is read.
- KIS live/FX responses do not supply a verified exchange observation time.
  Stored `observed_at` is null and `timestamp_basis` is `collection`; the KIS FX
  `rate_kind` also remains null. The existing valuation adapter uses receipt time
  as a collection reference and a spot FX category while retaining those original
  nulls in `providerObservedAt`/`providerRateKind` and the explicit timestamp basis.
- Actual provider publication times (the existing er-api daily reference) remain
  separate from receipt and storage time. They are not relabeled as live ticks.
- Numeric storage keeps price scale 12 and FX scale 6. The shared reader returns
  decimal strings. It makes no provider requests and does not substitute a late
  cache value for missing cutoff evidence.
- Incomplete/late/missing receipts still require the common exact-close fallback
  or an unavailable result. Installing this migration does not recover evidence
  already overwritten before installation.

## Bounded cost and retention

Per cutoff date and instrument/provider, retain the latest 32 unique receipts;
FX is likewise 32 per pair/provider. A repeat of the same receipt is a no-op.
Updates are rejected. A transaction-scoped identity lock serializes pruning.

Keep 35 days. Each eligible write prunes its own excess receipts and up to 2,048
expired rows through an indexed date scan. If collection stops, expiration waits
until collection resumes; it does not require a new scheduled cleanup job. These
tables are a small pre-cutoff buffer, not a full intraday/tick archive. At 100
instruments the upper bound is approximately 112,000 price rows plus 1,120 FX rows
per provider; roughly 50–100 MB including indexes is a capacity estimate, not a
measured production bill. Size scales linearly with supported instruments. Full
archived values are not joined to every account during collection.

Finalized daily/native snapshots keep their own complete selected evidence. The
35-day shared-buffer cleanup never deletes or rewrites a finalized snapshot.
Late corrections outside retention can reuse that retained private evidence or
fail closed; they cannot reconstruct lost intraday prices from today's cache.

## Operational boundary

Existing production market-cycle records observed during this task started near
07:59 KST. That schedule does **not** guarantee pre-07:00 receipts. The code's
pre-cutoff collection phase must be invoked before T by an approved operating
schedule before this path can be considered operational. This work does not
change a production schedule, environment variable, provider contract or secret.
Retry-only snapshot processing remains provider-free.

## Local verification and release order

1. Review/apply **new** migration 0060 on an isolated PostgreSQL instance. Earlier
   migrations are unchanged. The empty database chain and 0058→0059 compatibility
   matrix remain in the existing reliability runner.
2. The service connection needs SELECT/INSERT/DELETE on the two shared tables and
   EXECUTE on `snapshot_cutoff_receipt_date` and `record_snapshot_cutoff_fx` when
   it differs from the migration owner. PUBLIC and `varda_tenant_app` have none.
   It must already be the trusted worker connection; never elevate the tenant.
3. Verify real `price-sync` and FX writer → cache trigger → shared reader → common
   daily writer. The synthetic invariant is 10 × $105 × 1300 = 1,365,000 KRW.
   A 07:20 refresh to $110 / 1310 must not replace that cutoff value.
4. The reviewed disposable runner is
   `scripts/cutoff-observation-postgres.mjs --execute-local --pg-bin <absolute bin>`.
   It creates a fresh loopback PostgreSQL cluster, injects its worker connections
   into actual app modules, replaces only external quote responses, verifies
   permissions/concurrency, then stops that exact cluster. It accepts no DB URL.
5. Migration and code activation require separate deployment approval. Validate
   writer privileges and synthetic readiness first, then approve the operating
   preparation schedule. Do not claim live-provider receipt coverage from local
   fixtures.

Verification on 2026-09-27: PostgreSQL 17.11 combined reliability run passed
104/104 cases, including the 61-migration chain, prior writer compatibility,
durable recovery and six new cutoff cases. It used nine actual TCP sessions
overall and eight in the cutoff cases, and confirmed the exact disposable
cluster stopped. Artifact: `output/krw-usd-rc-rehearsal/local-mRk31t/report.json`.
Cutoff storage PGlite tests passed 5/5; KIS response-completion test passed 1/1;
ownership classification passed 12/12; writer readiness passed 22/22.

The combined run exposed an intermittent historical retry race: another request
could commit between exact-operation preflight and the replay read. A separate
actual-SQL test first reproduced `invalid/conflict`, then passed after the
writer rechecked the original operation only when its replay sequence changed.
The final PostgreSQL run includes a forced interleaving with one revision and
one operation, quantity 9 and cash USD 1,130. SQL revision/tombstone rules were
not changed. Earlier failed reports remain preserved, including a 30-second
cleanup timeout whose PostgreSQL log subsequently confirmed orderly shutdown;
the harness now allows 60 seconds for its final filesystem checkpoint.

## Stop and recovery

On code failure, stop the new preparation invocation and use only the reviewed
0059-compatible prior application version (baseline `99da6fe`). Pause writers
through the existing `paused` reliability gate before replacement, then return
to `compatible` after that version's read/write checks pass. Never roll back to
0058/legacy writers after a 0059 correction has been recorded. Shared capture is
additive: existing cache rows, holdings,
ledger data and finalized snapshots remain intact. If a trigger itself prevents
ordinary cache writes, an approved operator may disable the two new capture
triggers transactionally after recording the error and checking worker privileges.
Keep the evidence tables for diagnosis; do not delete or roll back financial data.
Re-enable only after the actual writer regression passes. A migration failure
rolls back its new DDL atomically; no existing migration file should be edited.
