# B/C release checkpoint — 2026-09-24

This is the current release record. The 2026-09-20 RC and shared-store documents retain earlier implementation measurements; their old NOT RUN statements and proposed five-minute scheduler are superseded only by the evidence below. Production has **not** been migrated or deployed at this checkpoint.

## Preservation and targets

- Integration: `codex/bc-production-release-20260920`, based on current remote `master` `3a081f9922d2c20e7eaf0d8decae1589c88a7fa0`. Original dirty worktrees are preserved. Existing desktop UI and Google verification remain.
- Existing Production: Vercel `varda-labs`, deployment `dpl_Q5DsAPoMp31tvaCL2C8JvA9Uz8CV`; Neon project `solitary-meadow-01101808`, main branch `br-wild-fire-atbal64r`.
- Isolated Preview: separate Vercel project `cairn-bc-preview-20260924` without Git/Neon integration; independent empty Neon project `rapid-rain-28976365`, root branch `br-delicate-flower-auyins6i`. No Production data or Auth was cloned.
- Preview credentials, cookie secret and Cron secret are separate. All three DB connections are checked against the exact test endpoint; tenant role is restricted. Build verifies migrations/roles/RLS with SELECT only. Existing normal Preview safeguards remain.
- The release branch disables automatic deployments in the original Vercel project, whose inherited Preview configuration can point at Production. The dedicated test project is used explicitly.

## Evidence

Evidence files are ignored local artifacts; they contain only synthetic results and are not deployment inputs.

| Gate | Status | Evidence / limits |
|---|---|---|
| Full unit/integration suite | PASS | `output/full-test-release-r4.log`: 2,847 tests, 357 suites, zero failed/skipped |
| ESLint / optimized production build | PASS | `output/lint-release-r3.log`, `output/build-release-r4.log`; build uses isolated DB configuration |
| Native PostgreSQL 17.11 | PASS | `output/b-native-final-r2-20260924.json`: 57 migrations + 15 cases; five separate TCP backends |
| Separate A/B/kill A/C processes | PASS | `output/c-native-process-20260924.json`: exact economic/bootstrap values, owner/currency/path rejection, partial upload and same-ID retry |
| Existing-schema upgrade / old-app compatibility | PASS | `output/upgrade-compat-report-r5.json`, `upgrade-baseline-manifest.json`: exact master48 migration baseline, 11 legacy tables preserved, old actual query/engine/CRUD, lock conflict and full rollback. Old writers intentionally cannot mutate native holdings |
| Actual Neon native writer/query/engine | PASS | `output/neon-native-report.json`: six cases, including USD gain/KRW loss, transaction cash flows, missing evidence and restricted owner access |
| Actual Neon shared store and failures | PASS | `output/neon-shared-report.json`, `neon-failure-report.json`, `neon-rollback-report.json`; transport failure injected at HTTP boundary, real SQL transactions |
| Actual Neon point-in-time restore | PASS | `output/neon-restore-report.json`: independent schema-only root, restore to saved LSN, before/after values checked, both temporary branches removed |
| Isolated Preview DB separation | PASS | Strict endpoint/role guard and remote read-only build verifier; 57 migration hashes match |
| Existing desktop / mobile / selected-path UI | PASS | `output/playwright/c-release-ui/qa-summary.json`: existing regression9/9 and C12/12 (KO/EN ×1440/390/320 ×economic/bootstrap). Actual API values, keyboard/resize/focus and no horizontal overflow. These are explicit development fixtures, separate from authenticated Preview |
| Actual email + authenticated Preview Home | PASS | `output/preview-auth-result.json`: real email OTP, automatic verified sign-in, three mixed-currency inputs preserved exactly, $1,334.56 total, EN/New York settings; refresh produces one draft, anonymous reads return401. OAuth was not used; authenticated C results are recorded below |
| Vercel runtime normal/maximum storage measurement | PASS | `output/vercel-runtime-normal.json`, `vercel-runtime-maximum.json`; same real engine/register/store/read code bundled in an isolated secret-protected temporary function, actual Neon, no auth bypass in the app. This measures runtime limits, not the authenticated page journey |
| Production migrations / commits / PR / merge / deployment / activation | NOT RUN | Conditional release gates still pending |

Neon maximum kernel/storage case (64 assets × 126 steps × 1,000 paths): 63,156,121 compressed bytes, 125 chunks; generation 7.95s, packing 4.61s, actual storage 15.53s within the existing 20s storage deadline, selected-path read 1.73s, delete 248ms. Write transfer 84,405,581 bytes over 35 HTTP requests; read 731,440 bytes over two. Local process peak RSS 572.9MB is **not** Vercel memory. The connected route also has its existing bootstrap-baseline growth-cell admission limit; the 64-asset kernel test does not expand that route's support.

Restore rehearsal used the isolated Free plan's 21,600-second history window. The temporary source retained its later values while the restored branch showed the earlier value. No Production restore was attempted. Re-read actual Production restore coverage immediately before applying SQL.

Additional native concurrency evidence: `output/concurrency-verification-report.json`, ten PASS cases. Two distinct PostgreSQL backend PIDs were observed waiting concurrently for the service lock before release. Creating/count/byte caps each admitted exactly one owner; failed admission rolled back counters. Two-query reads crossing actual TTL expiry, in-flight upload/finalize/cleanup, simultaneous cleanup and expired-lease takeover were verified. These tests replace the earlier sequential admission/TTL checks as concurrency evidence.

Actual Vercel Node.js `iad1` measurement used a 60-second function and the unmodified `registerTenantSimulationPath` admission/packing/20-second storage budget. Ordinary 3/63/1,000: generation1.25s, register0.92s, read24ms, total2.31s, process peakRSS147.4MB. Kernel maximum64/126/1,000: generation3.82s, register6.52s, read48ms, total10.47s, process peakRSS529.6MB; exact selected-path projection, 344,239-byte detail response. All synthetic owners/executions were deleted and the prior service policy restored. The temporary function exists only in ignored output and an ephemeral isolated deployment; it is not part of the application or release. These two samples are not sustained-load or multi-Vercel-instance proof.

## Admission and cleanup

- Application and DB service-policy admission default OFF. QA activation requires an explicit server-side owner list. Twelve Data and unsupported USD economic models stay OFF.
- Per owner: two retained executions, 192MiB, one creating execution. Per execution: 96MiB. Service-wide: 128MiB, eight retained executions, one creating, four admissions/hour, 60s owner cooldown. Creating and expired-but-not-deleted rows count. Global admission serializes on the service-policy row; deletion does not reset frequency counters.
- Vercel Hobby supports daily Cron. Prepared cleanup is `0 20 * * *` UTC (05:00 Asia/Seoul), separate from unchanged market recording `0 22 * * *` UTC (07:00 Asia/Seoul). This is **not yet active on the existing Production project**.
- TTL stays six hours. Physical deletion is daily and can lag expiry; expired data cannot be read. Successful cleanup must be within 26 hours for new admission, with backlog checks. No valid run is evicted to make room.
- Cleanup: two parents per transaction, at most 32 per invocation, 45s loop / 50s cancellation deadline, 60s lease, 7s SQL statement timeout. Lease ownership is checked after each batch and before release. Only C execution tables are touched.
- QA-only rollout remains appropriate until actual Production available storage, TOAST/index/WAL overhead and daily draining are accepted. Logical deletion does not shrink PostgreSQL files immediately.

## Migration and rollback checkpoints

Production read-only catalog check: 48 applied migrations (0000–0047), 39,452,672 DB bytes, 47 public tables. Pending additive range is 0048–0056; do not run the Preview migrator against Production.

0047 is byte-identical SQL after newline normalization: Production journal SHA-256 `9cc1fd0c45f7a9e41c7679876042460c89575bf808583b9630e09e8c97868391` is the CRLF artifact; repository LF SHA-256 `16682f2e10957052ab3d8af41c7b2d4c1c7406edec06fab8c4ec28f5d4a0ab1d` was verified to produce that CRLF hash. Do not alter the applied file or journal. Any other hash mismatch must stop release.

Before release: verify additive upgrade/old-app compatibility, acquire one migration lock with bounded statement/lock timeouts, retain old application deployment, then check catalog/RLS and original synthetic/Production invariants as authorized. No financial backfill or source-record rewriting.

Rollback first disables new native writes and C storage/rollout, preserves Home and existing read paths, and keeps bounded C cleanup available. Restore the verified prior app only if needed; keep additive tables and financial records. Vercel rollback does not undo DB, environment or Cron changes. If the prior app lacks the cleanup endpoint, use the reviewed server-only C cleanup script after target verification. Never restore all Production data merely to undo this feature.

Standalone rollback cleanup: `node --conditions=react-server --import tsx scripts/cleanup-simulation-executions.mjs` only checks the explicitly supplied environment and performs no DB access. Append `--execute` for one bounded invocation of the same app cleanup function. No dotenv files are loaded. The command requires either the pinned Production target or the exact isolated Preview, matching cleanup environment, cleanup ON, storage explicitly false and rollout off. Tests reject wrong targets/arguments/flags before importing the writer. A real isolated Neon invocation completed with zero backlog (`output/rollback-cleanup-command.log`). Secrets are supplied privately by the operator, never command-line arguments.

Actual authenticated isolated Preview: QA deployment dpl_CSofZjiiR11EsSCLSPe4BwCe7kwr on https://cairn-bc-preview-20260924.vercel.app. Three holdings created through the real server action. Synthetic external price/macro responses were persisted with real writers and loaded by actual queries; no paid provider was called. Economic and bootstrap path #2, 126 steps: shared handle, exact repeated detail, anonymous401, changed currency409, delete then404; 1440/390/320px without overflow (output/preview-c-economic-result.json, preview-c-bootstrap-result.json). Native authenticated API deposit/buy/dividend/fee/sell/withdraw ends at USD1,246 cash, six shares and USD600 remaining cost, idempotent repeat, changed-session409 and anonymous401 (output/preview-native-result.json).

The authenticated economic case additionally verifies expand → details → Escape → close expanded chart → exact same execution read. The existing approved Production QA account can sign in and open the old app before migration (`output/production-login-result.json`). No other Production user's records were changed.

The guarded operator itself passed five disposable PostgreSQL cases (`output/production-operator-local-report.json`): read-only preflight, mid-DDL rollback, original-data mismatch rollback, atomic nine-migration commit with RLS/privilege checks, and repeat rejection. Only the connection/target and output paths were substituted. Its live Production preflight and execution remain separate pending operations. Current remote metadata reports Free512MiB, approximately63MB storage, six-hour restore retention and no active Production builds at 2026-09-24T07:47:47Z; this will be refreshed at the operation checkpoint.
