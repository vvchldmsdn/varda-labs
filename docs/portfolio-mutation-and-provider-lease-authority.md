# Portfolio mutation and provider lease authority

Reviewed implementation: 2026-09-08. This records the current runtime contract;
the historical Phase 1D/1F audit documents retain their original scope.

## Session portfolio mutations

`holding-onboarding-write.ts`, `holding-lifecycle-write.ts`,
`portfolio-group-management-write.ts`, and `account-management-write.ts` resolve
the active tenant on the server and validate a trusted session write context.
An HTTP field never supplies the canonical owner. Onboarding now uses raw,
parameterized SQL for its existing four user-owned target tables; its owner is
the first parameter from `resolution.tenantContext.ownerUserId`.

These writers share `runPortfolioMutation` in
`src/lib/portfolio-mutation-transaction.ts`. This server-only executor does not
define a DML target or independently authorize a caller. Each registered writer
retains its target SQL and authorization checks. The executor acquires an owner
advisory lock in a separate statement before executing that SQL in the same
explicit READ COMMITTED transaction. The subsequent statement therefore reads
after the preceding lock holder has committed. Statement and lock timeouts are
bounded. Account/group lifecycle and owner checks occur inside this transaction.

Onboarding inserts the asset, its evidence, and optional group/membership
together. An inactive or foreign account/group cannot admit a holding. Account
archival and holding restoration use the same lock, so neither can invalidate
the other operation's lifecycle checks between validation and mutation.

## KIS provider refresh

`src/lib/market-data/kis-refresh-lease.ts` writes only the admin-system
`market_data_sync_runs` table. It adds no canonical-owner field, provider secret,
schema, or migration. Its callers remain independently authorized:

| Registered writer | Authorization | Entry point |
| --- | --- | --- |
| `admin_market_price_sync` | Machine admin | `/api/admin/market/prices/sync` |
| `session_portfolio_live_price_sync` | Verified active session | `/api/portfolio/live-prices/sync` |
| `cron_market_cycle_controller` | Machine admin | `/api/cron/market-cycle/run` |

The session route selects targets through tenant-scoped holdings reads. It can
refresh shared quote/FX evidence and write its shared job bookkeeping; it cannot
select another owner or mutate user-owned portfolio data. Its existing shared
price/FX repositories are recorded under that session entry point as well as
their machine callers. The complete registry has 32 logical writers and 39
distinct DML implementation paths; shared implementations can have multiple
authorized entry points.

The provider claim uses a separate advisory-lock statement, then atomically
checks active leases/recent non-dry-run price jobs and inserts the claim. Price
and FX branches of one session refresh, and the stages of one market-cycle job,
share a private AsyncLocalStorage capability. Neither a request parameter nor
an exported token can create that capability. Non-KIS and dry-run price jobs do
not claim it. The session route waits for both parallel branches to settle before
releasing the lease, even if a price-log DB failure occurs while FX is pending.
Success and thrown failures release the claim in `finally`; a
terminated process expires after 600 seconds. The deployment's longest market
job is bounded to 300 seconds. Completed attempts retain the configured shared
provider cooldown, including attempts containing only an FX refresh.

## Verification boundary

`tests/tenant-writer-readiness.test.mjs` still discovers all DML paths, verifies
table ownership classifications, rejects owner fields at HTTP boundaries, and
permits raw canonical-owner assignment only in the explicit reviewed writers.
It also checks the new provider entry point and onboarding's session owner
parameter. No blanket raw-SQL exemption was added.

`tests/portfolio-mutation-integration.test.mjs` and
`tests/kis-refresh-lease-integration.test.mjs` execute the real production
orchestration and SQL through an in-memory PGlite port. They cover controlled
archive/onboarding interleavings, foreign-owner rejection, transactional
onboarding, account limits, competing provider claims, nested work, expiry,
failure cleanup, dry-run isolation, and shared price/FX cooldown. PGlite is a
single-connection engine: this verifies SQL and application interleavings, not
a live multi-session PostgreSQL stress test. No production DB writes or provider
calls are part of these tests.
