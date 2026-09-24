# C-stage shared execution store — implementation and release evidence

Current release status is tracked in [the 2026-09-24 B/C release checkpoint](bc-production-release-20260924.md). The measurements and NOT RUN statements below describe the earlier 2026-09-20 implementation checkpoint; the proposed five-minute schedule below is superseded by the bounded daily schedule and service-wide admission policy in that record.

2026-09-20. Worktree `krw-usd-foundation`, branch `codex/krw-usd-foundation`, baseline `59ea52a`. Existing B/C changes retained. No commit, deployment, production SQL, credentials, provider, or scheduler change.

## Status and scope

Code connects the existing private KRW economic/bootstrap render to the existing tenant Neon client. Development preview alone keeps its explicitly volatile memory store. Production never falls back to memory. USD native/economic support is not expanded by this change.

**Release blocked:** native PostgreSQL A→B→kill A→C test, real Neon round-trip/time/memory, isolated Preview authentication and deployment environment/cleanup validation have not run. PGlite evidence below is not evidence of different PostgreSQL server processes or Neon service limits.

## Files / architecture

| Responsibility | Files |
|---|---|
| Lossless binary encoding and one-group decoding | `src/lib/simulation-execution-codec.ts` |
| Existing tenant transactions, immutable writer/read/delete | `src/db/queries/simulation-execution-storage.ts` |
| Metadata + bytea groups + owner/FORCE RLS/constraints/triggers | `drizzle/0054_simulation_executions.sql`, `drizzle/meta/_journal.json`, `src/db/schema.ts` |
| Private render registration / explicit development store | `src/lib/server/simulation-path-details.ts`, `src/app/simulation/page.tsx` |
| Existing same-origin authenticated POST + DELETE | `src/app/api/simulation/path-detail/route.ts` |
| Error/retry/delete UI | `src/components/simulation/simulation-path-detail-panel.tsx`, `simulation-fan-explorer.tsx`, existing chart/section prop forwarding |
| Feature/environment gate / server-only cleanup | `src/lib/simulation-execution-availability.ts`, `src/db/queries/simulation-execution-cleanup.ts`, `src/app/api/cron/simulation-executions/route.ts` |
| SQL and exact-engine tests | `tests/simulation-execution-storage.test.mjs`, `tests/support/shared-execution-fixture.mjs`, existing `tests/simulation-path-detail.test.mjs` |
| Existing write/ownership inventory | `src/lib/tenant-writer-registry.ts`, `scripts/lib/tenant-ownership-policy.mjs`, their readiness tests |
| Measurements | `scripts/measure-simulation-execution.mjs`, `scripts/measure-simulation-execution-sql.mjs` |
| Separate-process rehearsal | `scripts/rehearse-simulation-execution.mjs`, `simulation-execution-process-cases.mjs`, `simulation-execution-process-worker.mjs`, existing isolated `krw-usd-rc-rehearsal.mjs` |

One metadata row + 125 groups of eight paths for 1,000 paths. Common names/weights/provenance live once. Common binary stores UInt32LE JSON-header length, small metadata JSON, historical returns in Float64LE. Each path group stores step-major asset growth, chart values and factor states as Float64LE; bootstrap additionally stores Int32LE draw row and one-byte block flag. gzip level 6 is lossless. Raw/compressed SHA-256, sizes, shape, codec/projection versions are checked. Only the chosen path is projected through the existing C-stage formula.

Metadata is admitted in `creating`; four chunks per transaction; only a complete verified manifest can become `ready`. A repeated render locates the same owner+binding; admission rechecks under an owner lock. A unique owner+binding index prevents duplicate executions. The same-ID different-content case is rejected. Resume never extends expiry. The existing chart is still returned if detail persistence fails.

## Whole execution measurements (all 1,000 paths)

Deterministic existing engines, 90 historical input rows. Raw means original numeric arrays, not a single-path response. Minimum includes common metadata/history. Bytes are decimal; times depend on local contention and are not service SLOs.

| Model / assets / steps | Raw numeric | Minimum packed raw | gzip stored payload | Pack ms | Decode ms | Codec-process peak RSS |
|---|---:|---:|---:|---:|---:|---:|
| Economic / 3 / 63 | 3,584,000 | 3,590,112 | 3,306,665 | 200 | 3.6 | 94,478,336 |
| Economic kernel upper bound / 64 / 126 | 69,088,000 | 69,097,892 | 63,156,121 | 2,932 | 16.0 | 357,896,192 |
| Bootstrap / 3 / 63 | 2,368,000 | 2,374,512 | 1,968,374 | 143 | 12.0 | 183,296,000 |
| Bootstrap / 15 / 126 | 16,891,000 | 16,906,895 | 15,038,905 | 795 | 6.2 | 438,030,336 |

Economic kernel supports 64 assets/126 steps/1,000 paths. The connected owner route also requires a bootstrap baseline whose existing 2,000,000 growth-cell budget admits at most 15 assets at 126 steps/1,000 paths. **The 64-asset measurement is kernel/storage stress, not a claim that the actual route admits 64 assets.** No limit or path count was reduced here.

Actual installed Neon serializer with fetch replaced by an in-process PGlite SQL bridge (no socket). This exercises actual writer/query/driver encoding and parsing, but emulates the HTTP response envelope. Headers/TLS overhead are excluded. Times include PGlite, not remote Neon network latency. Main table + TOAST/index physical size (including owner-binding uniqueness) measured before delete.

| Case | Write requests | Request-body bytes total / largest | SQL write ms | Two-query read ms | PGlite physical relation bytes | Delete ms |
|---|---:|---:|---:|---:|---:|---:|
| Economic 3/63 | 35 | 4,605,768 / 146,582 | 947 | 21.1 | 3,923,968 | 11.9 |
| Economic 64/126 | 35 | 84,405,581 / 2,702,834 | 6,992 | 40.3 | 65,904,640 | 57.1 |
| Bootstrap 15/126 | 35 | 20,249,252 / 647,814 | 2,422 | 43.3 | 15,917,056 | 37.9 |

The PGlite+engine+Neon-bridge process RSS was 1,125MB / 1,130MB / 1,071MB respectively, including the embedded DB and its WASM heap. Do not present it as the production server footprint. Real server memory must be measured separately. Max-case remote transfer is about 84MB across 35 requests; no claim that a Vercel request deadline or current Neon plan can serve this safely until the remote upper-bound test runs.

### A single selected path

Metadata query followed by common bytes + one eight-path group. No entire-execution read and no latest-price query, RNG, model fitting, or simulation call.

| Case | Binary common + selected group | Emulated Neon response bodies, both queries | Public one-path JSON |
|---|---:|---:|---:|
| Economic 3/63 | 28,169 | 71,514 | 13,349 |
| Economic 64/126 | 507,462 | 727,646 | 344,239 |
| Bootstrap 15/126 | 132,159 | 214,059 | 87,783 |

Read wire size includes base64 and manifest/envelope. Public response hard cap remains 512KiB. Raw decompression cap: common 2MiB, group 600KiB. Both compressed and expanded lengths/hashes are checked before projection; no Float32/decimal truncation.

## Identity / permissions / errors

Authenticated current owner is resolved server-side. No browser owner parameter. Binding hashes owner, codec/projection, common input evidence and all raw/compressed group checksums. Handle also checks UUID, model, currency and exact expiry. Original path index remains zero-based internally (#142 = 141), independent of sorting/sample paths. Existing sample-path/whole-chart identity tests remain in place. Source matrices mutated after save do not change the result.

Both tables FORCE RLS and require active owner through the existing helper. Tenant client is checked not to be superuser/BYPASSRLS, and owner context uses transaction-local `set_config`. Metadata/chunks use a composite owner+execution foreign key. Deletes and account deletion cascade. Tenant chunk UPDATE/DELETE is denied; ready metadata is immutable. Private API is same-origin bounded JSON and `private, no-store`, `Vary: Cookie`; no sensitive inputs in URLs/logs.

| State | API / UI |
|---|---|
| Creating | 409 `execution_preparing`; wait/retry same ID |
| Other owner / absent / physically deleted | Same 404; no existence disclosure; user-driven new calculation |
| Owner-confirmed expired | 410; user-driven new calculation |
| Binding/currency/model mismatch | 409; refresh whole graph and handle together |
| DB unavailable | 503; retry same ID, no automatic replacement simulation |
| Missing/corrupt bytes | 422; reject rather than infer values; user-driven new calculation |
| Unsupported codec/projection | 422; no reinterpretation with new model |
| Save/quota failure | Chart remains; short unavailable/quota message, no private RAM fallback |

Delete is explicit in private detail panel; success displays unavailable/new-calculation action. Supported compatible deployments preserve codec v1/projection1 readers and IDs. Incompatible format needs its own decoder or explicit rejection; no deployment-version salt invalidates all executions.

## TTL, physical cleanup and capacity

- DB clock sets 6 hours from initial creation, never sliding on read/retry. Incomplete/failed after 30 minutes can be removed.
- Per owner: at most 2 retained rows, 192MiB payload total, 1 creating execution. Per execution: 96MiB; four chunks per write batch. Valid executions are not evicted to admit another one.
- Owner admission prunes only its expired/incomplete rows. Explicit delete and account deletion also cascade.
- Authenticated cleanup route deletes at most 2 parents per transaction, 16 transactions/32 executions per invocation, 40-second loop deadline, statement timeout10s. `SKIP LOCKED` avoids blocking other jobs. Cleanup stays available when new storage is switched off.
- **Proposed schedule is every 5 minutes; not configured or running in Production.** Require successful scheduled runs, failures/backlog monitoring, and follow-up draining when `mayHaveMore=true` before enabling storage. A boolean flag alone does not prove a scheduler exists.
- Nominal maximum service rate: 32 ×12 =384 expirations/hour, only if all batches fit the deadline. Two new executions per user per6h corresponds to ~333/hour at1,000 regularly active users. A synchronized burst can exceed one job's capacity;5minutes is not a guaranteed deletion bound. Measure backlog age; shorten/repeat jobs or restrict rollout if drain throughput is insufficient. No production cadence or plan capability assumed.
- For N distinct retained owners, hard logical payload bound is N×192MiB (including stale rows until cleanup; admission prunes its own rows before adding). N should include users active over6h plus the observed cleanup lag, not only currently online users. At1,000 owners this is187.5GiB, before TOAST/index/WAL/dead tuples. Two measured normal economic runs per1,000 users ≈7.31GiB physical; two64-asset runs ≈122.76GiB. These numbers make unconditional rollout inappropriate without capacity/cost evidence.
- DELETE removes logical rows, not an immediate reduction of allocated PostgreSQL file size. Autovacuum/dead-tuple/WAL/storage behavior and cleanup concurrent with reads still need native PostgreSQL/Neon measurement.

## Verification / reproducible commands

1. `node --no-warnings tests/simulation-execution-storage.test.mjs`: real writer/query SQL, real engine snapshots and real migration, isolated PGlite role. No global DB URL. Covers exact economic/bootstrap paths, owner/currency/path/ID, TTL, stale cleanup, incomplete visibility, resumability, quota, concurrent-render interleaving, corruption/version, deletion/account cascade, transaction-local context and SQL privileges. PGlite serializes transactions; not native concurrency proof.
2. `node --no-warnings scripts/measure-simulation-execution.mjs economic 64 126`: no DB/network.
3. `node --no-warnings scripts/measure-simulation-execution-sql.mjs economic 64 126`: installed Neon serializer + embedded PGlite; HTTP replaced, no network.
4. `node --no-warnings scripts/rehearse-simulation-execution.mjs --validate-only`: **BLOCKED**, migration list validation only. Current machine has no native PostgreSQL tools/Docker or Node `pg` package.
5. With an approved native local PostgreSQL installation and Node `pg` available: `node --no-warnings scripts/rehearse-simulation-execution.mjs --execute-local --pg-bin "C:/Program Files/PostgreSQL/17/bin"` (use actual installed absolute directory). Creates a new loopback-only cluster in contained output, validates address/data directory, uses app role, never accepts existing DB URLs; stops its cluster on completion. Uses current ordered55 migrations in disposable DB. No production migration command.

The separate-process runner writes in A, reads path142 in B, kills A and reads in C, compares all steps/hash, blocks alternate owner/currency/path, retries same execution concurrently, and kills a partial uploader. Read worker does not import/run the model; forbidden engine ports fail the test. **None of A/B/C is marked PASS here.** Native lock/snapshot/concurrent-cleanup behaviors and real Neon end-to-end are release blockers.

Final outcomes:

- Full runner: **2,838 passed, 0 failed, 0 skipped**, 357 suites, 500.7s (`output/shared-storage-full-tests-final.log`). The earlier full run found missing writer-inventory registration; registered the owner store/server-only cleanup and new table policies, preserving legacy backfill scope, then reran the entire suite successfully.
- Shared-store focused suite: **10 passed**, including the additional cleanup HTTP authorization test added after the full runner had imported its tests (`output/shared-storage-tests-final.log`). No claim that this extra case was part of the2,838 run.
- Full ESLint passed (`output/shared-storage-lint-final.log`); optimized `next build --webpack` including TypeScript and19 prerendered pages passed (`output/shared-storage-build-final.log`). Initial sandbox build could not spawn a child process; retry used approved local execution with scrubbed credentials and unreachable loopback DB. No `build:vercel` or migrations were run.
- Browser: actual development fixtures at1440×900,1366×768,390×844 and320×740; economic142 end104.22, step20=104.86, maxdrawdown4.88%; bootstrap1000 end102.23, step1=99.68 and2026-08-13→2026-08-14 new block. Expand preserves selection/step; Escape closes detail before expanded chart and restores focus. KO/EN, mobile internal scrolling and no horizontal overflow checked from screenshots and DOM (390 viewport/page375/panel318;320 viewport/page305/panel256). Viewport/language restored after verification. This browser test uses the explicit development memory fixture, not shared PostgreSQL.
- `git diff --check` passed; staging remained empty. Logs/metrics under `output/shared-storage-*` contain synthetic measurements only. No private external login, Neon, provider or production mutation was used.

Existing C-stage report documents prior UI/projection evidence, not shared-store deployment readiness.

## Rollout / rollback conditions (not performed)

1. Review/extract C changes separately from existing dirty B globalization work. 0054 follows current local0053; production order must be checked at release. C tables depend on existing `app_users`, tenant role and0045's active-owner helper, not on turning USD on. Do not blindly apply all pending B migrations to deploy C.
2. Run native A/B/C tests and native RLS/table-owner/concurrent TTL checks. Test measured upper bound through approved isolated Neon/Preview and actual session resolution; record timeouts, memory and quotas. No provider data needed.
3. Authorize additive migration and production change separately. Apply while feature off with backup/transaction rollback verification. No financial row update/backfill.
4. Confirm `TENANT_DATABASE_URL` uses the existing restricted app role; private endpoints must never use administrative URL. Cleanup uses the existing server-job administrative client only and existing job-secret authorization.
5. Prove Preview and Production point to distinct DB branches/environments; retain existing deployment guards. Feature also requires `SIMULATION_EXECUTION_ENVIRONMENT` equal to `VERCEL_ENV` (or explicit development/production target). This string is an admission check, not proof that two URLs are different.
6. Configure/approve/verify cleanup every5min and backlog draining, existing job auth, data retention/capacity; only then enable `SIMULATION_EXECUTION_CLEANUP_ENABLED=true` and `SIMULATION_EXECUTION_STORAGE_ENABLED=true` in that validated environment. No flags have been enabled by this task.
7. Rollback: disable STORAGE, keep CLEANUP on until artifacts expire/drain; leave additive tables and v1 readers where compatible. Do not drop live executions or alter financial data. Failed SQL migration rolls back its transaction. Any destructive table removal needs explicit later approval.

Local interactive fixtures (dev server required, volatile preview store intentionally):

- `http://127.0.0.1:3198/simulation?preview=design&model=economic&horizon=63` → path142 → details → step slider; prior baseline end104.22. This UI URL does not exercise Neon.
- `http://127.0.0.1:3198/simulation?preview=design&model=bootstrap&horizon=63` → path1000 → details; prior baseline end102.23 and step1 index99.68. No economic factor table.

Private shared-store UI requires an isolated authenticated account + approved local/Preview tenant DB +0054 +explicit flags. External email/OAuth and private browser DB journey remain unverified; no authentication bypass was introduced to make screenshots pass.
