# Analysis UI and simulation path storage follow-up

Base: `bfb6a5d7c1c63ede2f23e71ae70442cfd77980de` (master fetched at task start).
Branch: `codex/analysis-ui-path-detail`. The records below distinguish local implementation from the subsequently authorized release.

## Requested changes

- History: remove the dynamic live-price status line from above the hero value; retain detailed valuation evidence in its detail view.
- Allocation: remove pointer-focus rectangles from SVG wedges while preserving keyboard focus; replace the native holding select with the shared CairnSelect. The history snapshot comparison uses the same select design.
- Risk: flat period controls, page-colored correlation surface, holding names on matrix axes (full names remain accessible).
- Simulation: flat model/period selectors, full-width chart, compact horizontal metrics, icon-only expand control with accessible label, consolidated Details for economic starting values, evidence and distribution explanation. Coverage remains visible.

## Path-detail failure

A read-only production check confirmed that the affected owner retained two live executions, the configured owner limit. Global capacity, concurrent uploads, hourly budget, cooldown and cleanup freshness were not the blocking conditions at that check. No customer portfolio inputs were exported into this report.

The old limit message combined unrelated causes and provided no recovery action on the newly requested result. The new Manage stored runs dialog exposes only the signed-in owner's run date/model/horizon. Explicit deletion is confirmed in the dialog, reauthenticates the session, applies owner-scoped SQL/RLS, and refreshes the current simulation. The user subsequently approved automatic rotation: see the retention follow-up below. Manual deletion remains optional.

Also fixed: an owner-held expired row could consume global capacity, while preflight rejected the request before the existing prune operation ran. Preflight now permits an attempt when the same owner has a pruneable row. The INSERT trigger still checks every service gate, including cleanup freshness; another owner's rows are not pruned.

No financial-engine or portfolio-data change is part of this change set. Migration 0062 supplies the subsequently approved retention change; operational release was separately requested after implementation review.

## Validation

- Isolated storage tests: 18 passed, including expiration recovery, service-gate preservation, owner-only list/delete, changed-session and failure cases.
- Tenant writer boundaries: 23 passed.
- Simulation presentation/history unit checks: 16 passed.
- Allocation/risk related checks: 16 passed.
- TypeScript and targeted lint passed; final full regression and browser results are recorded after completion below.

Browser data is development-only synthetic preview, with the database directed to an unreachable loopback endpoint. Preview results validate layout and interaction, not production financial returns. Production read-only diagnosis is distinct from a production save verification; actual new-code production save is not run before deployment.

## Final verification record

- Real browser, synthetic local preview: 1440×900, 1366×768, 390px and 320px; allocation select keyboard/typeahead/Escape/outside click, pointer/keyboard ring focus, risk names and internal matrix scroll, History record dialogs, simulation Details/nested guide/factor dialog, expand/Escape/focus return, path number/previous/next and units passed. No document horizontal overflow.
- The final mobile toolbar regression (an old `display:none` rule) was removed and rechecked: model and 63/126 selectors are visible, with natural wrapping at 320px.
- Graph measured approximately 374px high at 1440×900, 242px at 1366×768 and 320px high on mobile.
- History endpoint-comparison select is absent from the synthetic preview: real interaction NOT RUN. TypeScript and form-contract source review complete.
- New storage-management dialog production interaction/save: NOT RUN. Authenticated actions and real SQL were verified in isolated tests; no production deletion was performed.
- Full `tests/run.mjs` was attempted but did not finish: the bounded Neon-adapter timeout test stalled in the combined runner. The adapter suite passes separately (13 cases). Before the stall, two old UI-placement assertions and the product-source ownership guard failed. The placement tests were updated for the requested detail-only presentation (12 cases pass), and owner extraction was moved to `lib/server`; the storage/entity-boundary cases pass. The writer registry was rechecked after this boundary adjustment (23 cases pass). This is not a claim that the entire combined suite passed.
- Final storage + entity-boundary tests pass (22 cases); no provider API or operational DB write was used by tests.
- Final local production build: PASS (`next build --webpack`, loopback-only dummy DB); compilation, TypeScript and page generation completed.
- Final changed-file ESLint and `git diff --check`: PASS.
- Existing dirty primary checkout preserved. No commit or deployment performed.

## Automatic retention follow-up (user approved)

Migration `0062_simulation_execution_rotation.sql` changes retention from a hard two-row admission stop to two completed runs plus one in-flight staging slot. The application still uses bounded chunk uploads and immutable content bindings. A ready transition validates the complete manifest/chunks before deleting older completed runs in the same owner-scoped transaction. A failure, including one after the delete but before commit, restores the prior completed runs. Identical content resumes/reuses the existing execution without extending its TTL or spending another admission.

Global byte/count/concurrency/rate/cleanup gates remain active. Rotation never deletes another user's execution, never changes portfolio or financial records, and never uses unbounded request payloads. Reusing an old browser tab after its run has been replaced explains the replacement and offers recalculation.

Release order: apply 0062, then deploy the application. Existing rows are unchanged by the migration itself, and old writers remain compatible. New code against the old guard returns a limit instead of an unhandled error. No operational migration or deployment has been performed in this follow-up.

Validation uses the actual SQL guards/writer with isolated PGlite: upgrade with existing runs, staging, rejected competing upload, corrupt/incomplete upload, rollback after eviction, successful rotation, exact reuse/TTL, counters, cross-owner isolation, and preserved service gates.

Follow-up result: 54 storage/presentation/owner-boundary cases passed together; 5 migration-plan cases passed. TypeScript, changed-file ESLint and diff checks passed. Full-suite/build from the previous UI turn were not repeated for this focused retention change. Migration and application changes remain local, uncommitted and unapplied to Production.

## Authorized release verification (2026-10-01 KST)

The user requested that the UI and retention changes be committed and deployed together. This supersedes the earlier local-only completion records above.

- Full ESLint and production-style webpack build passed with a loopback-only dummy database. TypeScript and static page generation completed.
- All 391 test files imported by `tests/run.mjs` were executed in isolated Node processes (concurrency 2), avoiding the combined runner's timeout stall. The only failure was the old migration-count assertion (62); updated to 63 and reran its entire eight-case suite successfully. The shared rehearsal allowlist now includes 0062, and the complete migration-chain/native-writer integration passes.
- Independent final storage/migration/owner-boundary review found no release-blocking defect. This is not a claim of native PostgreSQL concurrent-session testing.
- Read-only production preflight confirmed migration 0061 and the exact existing execution guard. Its migration hash differs solely by CRLF/LF serialization; both exact variants are checked. Production branch is currently `master`.
- Release sequence: apply only 0062 in one transaction, verify retained rows/counters unchanged, merge the reviewed application commit to `master`, then verify Vercel Ready, commit identity, alias and affected authenticated screens. Private preflight/receipt and verification logs stay under ignored `output/`.
- Existing primary-checkout work, secrets, authentication state and customer records are excluded from this release.
