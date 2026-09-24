# B/C release checkpoint — 2026-09-24

This is the current release record. The 2026-09-20 RC and shared-store documents retain earlier implementation measurements; their old NOT RUN statements and proposed five-minute scheduler are superseded only by the evidence below. Production migrations and application deployment are complete. Activation and public availability are separate states, recorded below.

## Preservation and targets

- Integration: `codex/bc-production-release-20260920`, based on current remote `master` `3a081f9922d2c20e7eaf0d8decae1589c88a7fa0`. Original dirty worktrees are preserved. Existing desktop UI and Google verification remain.
- Rollback Production: Vercel `varda-labs`, previous deployment `dpl_Q5DsAPoMp31tvaCL2C8JvA9Uz8CV`; Neon project `solitary-meadow-01101808`, main branch `br-wild-fire-atbal64r` remains unchanged. Release PR #194 merged as `9ba40050ecb6d10fe36de9f199196252b41c6ab1`. Initial feature-OFF deployment `dpl_6t4yVPUDou61DLVhKWyQNXc59nb8` and QA-enabled redeployment `dpl_3Wyapt7E2eVSsM4UC9y2GugHYQEM` both reached Ready at that SHA.
- Isolated Preview: separate Vercel project `cairn-bc-preview-20260924` without Git/Neon integration; independent empty Neon project `rapid-rain-28976365`, root branch `br-delicate-flower-auyins6i`. No Production data or Auth was cloned.
- Preview credentials, cookie secret and Cron secret are separate. All three DB connections are checked against the exact test endpoint; tenant role is restricted. Build verifies migrations/roles/RLS with SELECT only. Existing normal Preview safeguards remain.
- The release branch disables automatic deployments in the original Vercel project, whose inherited Preview configuration can point at Production. The dedicated test project is used explicitly.

## Evidence

Evidence files are ignored local artifacts and are not deployment inputs. Isolated tests use synthetic financial evidence; Production checks use only the approved QA account. Private credentials, authenticated browser state and per-account API responses stay in ignored `.vercel/` files. Reports contain selected non-secret results.

| Gate | Status | Evidence / limits |
|---|---|---|
| Full unit/integration suite | PASS | `output/full-test-release-r5.log`: 2,851 tests, 357 suites, zero failed/skipped |
| ESLint / optimized production build | PASS | `output/lint-release-r6.log`, `output/build-release-r6.log`; build uses isolated DB configuration |
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
| Production migrations | PASS | `output/production-migration-operator-result.json`: 0048–0056 in one 37.626s transaction; original47 tables preserved, catalog/RLS/privileges checked; old deployed app still worked |
| Commit / PR / merge / deployment | PASS | 53d5c91 + d035f47, PR #194, master merge9ba4005; both feature-OFF and QA-only Production deployments Ready |
| Production QA native ledger | PASS | `output/production-native-result.json`: new QA account, USD10 deposit →0.01 fee →9.99 withdrawal; Home10.00, final cash0, archived with history preserved, two existing accounts unchanged, duplicate retry and changed-session409 |
| Production QA selected paths | PASS | `output/production-c-economic-result.json`, `production-c-bootstrap-result.json`: actual cached evidence, 126 steps, same path after expand/close/re-request, 1440/390/320px, anonymous401, currency409, own delete then404 |
| Production cleanup / automatic schedule | PASS / NOT RUN | Authenticated manual invocation completed, empty backlog; actual Vercel project confirms daily05:00 KST cleanup. The first automatic daily run and a natural six-hour expiry were not observed during this smoke window |

Neon maximum kernel/storage case (64 assets × 126 steps × 1,000 paths): 63,156,121 compressed bytes, 125 chunks; generation 7.95s, packing 4.61s, actual storage 15.53s within the existing 20s storage deadline, selected-path read 1.73s, delete 248ms. Write transfer 84,405,581 bytes over 35 HTTP requests; read 731,440 bytes over two. Local process peak RSS 572.9MB is **not** Vercel memory. The connected route also has its existing bootstrap-baseline growth-cell admission limit; the 64-asset kernel test does not expand that route's support.

Restore rehearsal used the isolated Free plan's 21,600-second history window. The temporary source retained its later values while the restored branch showed the earlier value. No Production restore was attempted. Re-read actual Production restore coverage immediately before applying SQL.

Additional native concurrency evidence: `output/concurrency-verification-report.json`, ten PASS cases. Two distinct PostgreSQL backend PIDs were observed waiting concurrently for the service lock before release. Creating/count/byte caps each admitted exactly one owner; failed admission rolled back counters. Two-query reads crossing actual TTL expiry, in-flight upload/finalize/cleanup, simultaneous cleanup and expired-lease takeover were verified. These tests replace the earlier sequential admission/TTL checks as concurrency evidence.

Actual Vercel Node.js `iad1` measurement used a 60-second function and the unmodified `registerTenantSimulationPath` admission/packing/20-second storage budget. Ordinary 3/63/1,000: generation1.25s, register0.92s, read24ms, total2.31s, process peakRSS147.4MB. Kernel maximum64/126/1,000: generation3.82s, register6.52s, read48ms, total10.47s, process peakRSS529.6MB; exact selected-path projection, 344,239-byte detail response. All synthetic owners/executions were deleted and the prior service policy restored. The temporary function exists only in ignored output and an ephemeral isolated deployment; it is not part of the application or release. These two samples are not sustained-load or multi-Vercel-instance proof.

## Admission and cleanup

- Application and DB service-policy admission default OFF. QA activation requires an explicit server-side owner list. Twelve Data and unsupported USD economic models stay OFF.
- Per owner: two retained executions, 192MiB, one creating execution. Per execution: 96MiB. Service-wide: 128MiB, eight retained executions, one creating, four admissions/hour, 60s owner cooldown. Creating and expired-but-not-deleted rows count. Global admission serializes on the service-policy row; deletion does not reset frequency counters.
- Vercel Hobby supports daily Cron. Actual Production project metadata confirms cleanup `0 20 * * *` UTC (05:00 Asia/Seoul), separate from unchanged market recording `0 22 * * *` UTC (07:00 Asia/Seoul). Manual authenticated cleanup passed; a scheduled invocation has not yet been observed.
- TTL stays six hours. Physical deletion is daily and can lag expiry; expired data cannot be read. Successful cleanup must be within 26 hours for new admission, with backlog checks. No valid run is evicted to make room.
- Cleanup: two parents per transaction, at most 32 per invocation, 45s loop / 50s cancellation deadline, 60s lease, 7s SQL statement timeout. Lease ownership is checked after each batch and before release. Only C execution tables are touched.
- QA-only rollout remains appropriate until actual Production available storage, TOAST/index/WAL overhead and daily draining are accepted. Logical deletion does not shrink PostgreSQL files immediately.

## Migration and rollback checkpoints

Production pre-migration read-only catalog check: 48 applied migrations (0000–0047), 39,452,672 DB bytes, 47 public tables. Additive range0048–0056 is now applied; do not run the Preview migrator against Production. No financial backfill was performed. After QA cleanup, database size40,394,752bytes; C parent/chunk relation sizes212,992/204,800bytes, logical retained payload0 and executions0.

0047 is byte-identical SQL after newline normalization: Production journal SHA-256 `9cc1fd0c45f7a9e41c7679876042460c89575bf808583b9630e09e8c97868391` is the CRLF artifact; repository LF SHA-256 `16682f2e10957052ab3d8af41c7b2d4c1c7406edec06fab8c4ec28f5d4a0ab1d` was verified to produce that CRLF hash. Do not alter the applied file or journal. Any other hash mismatch must stop release.

The operator acquired one advisory migration lock, bounded lock/statement timeouts and a transaction-wide original-table preservation check. Historical schema access was confirmed immediately before the operation at2026-09-24T07:55:37.597Z, with WAL LSN0/C15DD48 and six-hour retention. This timestamp is a historical release checkpoint, not a permanent backup or a promise that the restore point remains available later.

Rollback first disables new native writes and C storage/rollout, preserves Home and existing read paths, and keeps bounded C cleanup available. Restore the verified prior app only if needed; keep additive tables and financial records. Vercel rollback does not undo DB, environment or Cron changes. If the prior app lacks the cleanup endpoint, use the reviewed server-only C cleanup script after target verification. Never restore all Production data merely to undo this feature.

Standalone rollback cleanup: `node --conditions=react-server --import tsx scripts/cleanup-simulation-executions.mjs` only checks the explicitly supplied environment and performs no DB access. Append `--execute` for one bounded invocation of the same app cleanup function. No dotenv files are loaded. The command requires either the pinned Production target or the exact isolated Preview, matching cleanup environment, cleanup ON, storage explicitly false and rollout off. Tests reject wrong targets/arguments/flags before importing the writer. A real isolated Neon invocation completed with zero backlog (`output/rollback-cleanup-command.log`). Secrets are supplied privately by the operator, never command-line arguments.

Actual authenticated isolated Preview: QA deployment dpl_CSofZjiiR11EsSCLSPe4BwCe7kwr on https://cairn-bc-preview-20260924.vercel.app. Three holdings created through the real server action. Synthetic external price/macro responses were persisted with real writers and loaded by actual queries; no paid provider was called. Economic and bootstrap path #2, 126 steps: shared handle, exact repeated detail, anonymous401, changed currency409, delete then404; 1440/390/320px without overflow (output/preview-c-economic-result.json, preview-c-bootstrap-result.json). Native authenticated API deposit/buy/dividend/fee/sell/withdraw ends at USD1,246 cash, six shares and USD600 remaining cost, idempotent repeat, changed-session409 and anonymous401 (output/preview-native-result.json).

The authenticated economic case additionally verifies expand → details → Escape → close expanded chart → exact same execution read. The existing approved Production QA account can sign in and open the old app before migration (`output/production-login-result.json`). No other Production user's records were changed.

The guarded operator itself passed five disposable PostgreSQL cases (`output/production-operator-local-report.json`): read-only preflight, mid-DDL rollback, original-data mismatch rollback, atomic nine-migration commit with RLS/privilege checks, and repeat rejection. Only the connection/target and output paths were substituted. Live Production preflight and execution then passed separately. Remote metadata reported Free512MiB, approximately63MB storage, six-hour restore retention and no active Production builds at2026-09-24T07:47:47Z.

## Production smoke scope and limitations

Actual Production checks ran from08:18 to08:23 UTC on2026-09-24, not for24hours. Both selected-path models were opened once and repeatedly read through their original handles; each checked anonymous access, currency binding and deletion. One newly created QA account exercised four native writes and an idempotent retry, then was closed at zero balance. No other account was edited. Existing approved QA holdings supplied the simulation evidence; no synthetic market data was seeded into Production.

Manual cleanup was accepted only after an immediate proof that C execution/chunk tables were empty and QA admission allowed one designated owner. It removed0 with backlog0. Production TTL metadata/guards were not bypassed to manufacture expiry. Actual expiry races and deletion of expired rows were exercised in isolated PostgreSQL/Neon. Runtime transport failures were injected only in the isolated environment. Multiple real Vercel instances and long-duration load were not proven.

C remains QA-only: the Free-plan payload budget is not a generally available capacity promise. Native/USD historical bootstrap uses the currency research engine but currently does not register C shared executions. USD economic-state simulation remains unsupported. Native KRW economic paths additionally require complete valuation, an exact input/weight match and no cash component. KIS history without corporate-action coverage can correctly leave native research unavailable. Twelve Data stays disabled; commercial rights, credentials and actual provider verification remain pending.

## Follow-up: long native histories

Release review found that the bounded historical read previously threw after10,000 events or1,000 snapshots, also blocking new transactions and current balances. The fix separates mutation preflight into affected accounts, exact operation-ID lookup and latest snapshot time. Historical SQL first checks row and16MiB payload limits before exporting JSON. Missing historical coverage disables dependent performance/movement/realized results while retaining independently supported current cash, quantities and cost lots. Accounts beyond the200-account view limit do not produce a partial whole-portfolio total; scoped reads/writes remain usable. Twelve Data's corporate-action check cannot be bypassed when the history/account window is incomplete.

Evidence: persistence23/23 and provider-loader5/5; real disposable PostgreSQL17.11 `output/native-history-window-pg-report.json`74/74 (57migrations, existing15cases and new2long-history cases), five distinct backend sessions. Over10,000 events: current cash10,251→10,256, original retry remains idempotent. Over1,000 snapshots: cash250→251, newest snapshot/peer fence preserved. Isolated actual Neon financial regression rerun passed6/6 (`output/neon-native-report.json`), with generated fixture records removed. The change adds no migration and rewrites no historical record.

Local build initially included the ignored old-app compatibility fixture under `output/` through TypeScript's broad include. `tsconfig.json` now excludes that generated artifact directory, matching the existing deployment exclusion. Application type checking remains enabled; the subsequent optimized build passed (`output/build-release-r6.log`).

Rollout decision: after the follow-up commit passes full tests, isolated Preview and authenticated Production QA, native KRW/USD ledger writes may be enabled for signed-in users. C shared execution storage remains owner-allowlisted independently. Neither native activation nor this history fix enables unsupported models or the new data supplier.

Original working directories were not reset or cleaned. The release worktree contains the reviewed integration; earlier user work remains in its original branches. The previous application deployment and additive schema are retained for rollback.
