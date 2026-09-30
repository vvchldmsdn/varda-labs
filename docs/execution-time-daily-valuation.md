# Execution-time daily valuation and simulation detail availability

Date: 2026-09-30. Base: 61e66533427943eb1cd9a0604e708dde5e71fa3e (same deployed tree as master 1147494).

## Daily records

For current-cycle legacy accounts, the service date still identifies one daily record. Its valuation boundary is the actual execution time; it does not claim an exact 07:00 observation. Cron collects FX and live prices before planning/writing. A verified official close remains a fallback when a live quote is unavailable. FX retrieval preserves publication time separately, requires a fresh receipt, and updates the receipt even when the rate is unchanged. Neither a late scheduler nor post-07 receipt alone blocks saving.

Past-date recovery retains its original policy. Completed same-date records, including old-policy records, remain unchanged. The existing tenant lock/revision checks reject concurrent holding changes. Today excludes trades already included in an execution-time baseline. The UI shows actual valuation and baseline FX retrieval times.

Native-ledger snapshots retain their existing cutoff model and are processed before shared FX overwrites. They are not relabeled as execution-time valuations. Current operating recovery targets use the legacy account writer. No migration, scheduler schedule, subscription, user ledger, cost or quantity changes are included.

## Simulation details

The previous UI classified a QA-disabled feature as a storage failure. Disabled, capacity-limited and genuine storage failures now have separate outcomes. SQL capacity rejection under concurrency reports a limit without partial writes. Tenant ownership, TTL, per-owner and global budgets are unchanged.

General-user activation requires both the existing application rollout (`SIMULATION_EXECUTION_ROLLOUT=all`) and the existing DB service setting (`qa_only=false`). This is an operational configuration change, not an auth/RLS bypass. Expiry cleanup and bounded budgets remain required.

## Verification and operations

Relevant local tests: FX selection/storage/runner 56 passed before final collection ordering; final runner 32 passed; daily writer/Today trade attribution 38 passed; simulation storage 15 passed. Full CI, deployment and live postflight are recorded separately after execution. Local Windows memory pressure interrupted earlier tests; those interrupted runs are not counted as passes.

No Investment Lab changes. Original primary-workspace dirty files are excluded. A rollback must retain new record timestamps/policy tags and must not overwrite completed valuations. The targeted policy can be corrected forward without deleting history.
