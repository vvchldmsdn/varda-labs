# Native trade settlement and 07:00 cutoff

Local change on `codex/trade-settlement-snapshot-repair`, based on `cacf3b33739a5bf5c5a8a8149bd400ddb09ef327`. Existing work in the original checkout and other worktrees was preserved. Production migration, data repair and release are separate gated operations; their current results are recorded in private operator reports rather than inferred from local test success.

## Financial contract

- Home holding actions and the advanced ledger use the same authenticated writer. New instrument creation and buy are one owner-locked operation; an exact archived account/market/ticker identity is reused.
- Quantity plus actual total settles only the reported settlement currency. Instrument currency remains separate. Order price is informational. A repeating derived average remains rational; a cross-currency total never fabricates an instrument-currency price.
- Fee/tax absence is stored as unknown, not a reported zero. Reported separate charges are expenses, not external flows. The form must receive execution gross amount excluding separately entered charges.
- A date-only trade preserves its date, KST convention and `service_day_midpoint` provenance. Internal 19:00 KST is a whole-service-day weighting convention, not a claimed execution time. Cross-currency historical costs/flows with date-only evidence require daily-reference FX; missing evidence stays unavailable.
- General mutations still cannot precede frozen snapshots. This work does not create a public historical-repair bypass.

## Daily baseline

`native_ledger_cutoff_v2` is the state immediately BEFORE 07:00 KST. Events exactly at 07:00 belong to the next interval. The snapshot frame is the cutoff, while `captured_at` is the actual worker time. Event writes no longer produce an intraday daily baseline.

The reader reconstructs quantity/cash from the last pre-cutoff ledger state, and only accepts price/FX observations known by cutoff. Post-cutoff current quantities/prices cannot be backdated. Repeated jobs insert at most one canonical source row per owner/account/date. A competing pre-cutoff mutation causes CAS rejection. Existing v1 captures are retained; projection switches to the canonical series from its first cutoff, preventing an old 07:05 capture from replacing Today's baseline.

Tenant-owned assets use the tenant/RLS connection. Shared market evidence uses the existing worker read authority; no shared-table grants were added to the tenant role. Stored Twelve reads do not schedule provider calls. License/retention are checked at real current time; cutoff freshness is checked at the valuation time. Corporate-action rejection disables snapshot fallback as well.

**Remaining provider limitation:** Twelve's current split-coverage contract only confirms a New York date on a later New York date. A latest US close and 07:00 KST cutoff can share the same NY date, so that close remains unavailable when coverage is provisional. This change does not weaken admission or claim latest Twelve cutoff completeness. The provider remains gated by existing rights/configuration.

## Broker evidence recovery

The approved recovery preserves the distinction between current securities, historical execution evidence and broker cash settlement. Private source statements, exact owner/account mapping, the frozen manifest and before/after records stay under ignored `.vercel/`; they must not enter commits or public test fixtures.

The target account has no native opening. The user confirmed the existing quantities precede the missing trades and requested cash be excluded from securities valuation. Consequently this correction does not create a native opening or cash balance. An orderable KRW amount is not proof of settled KRW cash. USD cash rows reconcile exactly, but this does not establish all earlier cash timestamps or gross/fee breakdowns.

`scripts/lib/broker-securities-recovery.mjs` corrects the confirmed current securities and records date-only historical evidence using the existing owner-scoped event ledger. It requires an exact account/state hash, unique instruments, explicit fractional quantity evidence, valid stored quotes for new holdings, duplicate checks, an owner advisory lock and an atomic transaction. Dry-run rolls back by default; writes require the exact manifest hash and verified restore evidence. Repeating the same applied manifest is a no-op. Account cash/native state and existing snapshots remain unchanged. Zero holdings are archived through the existing lifecycle and group-membership semantics.

Migration 0058 adds the private recovery audit and links to the event ledger. Tenant reads remain owner-scoped; tenant roles cannot run the recovery writer. Historical display distinguishes execution gross, original order display and explicitly confirmed net settlement/date. Reported order unit prices remain separate from execution gross. Known all-buy acquisition totals are preserved exactly with an explicit fee-excluded half-up four-decimal legacy average projection. Unknown fees, tax, execution prices and historical FX remain unknown; unmatched settlement candidates never appear as confirmed facts.

`scripts/reconcile-broker-cash.mjs` performs local-only exact Decimal reconciliation. It rejects gaps and conflicting duplicate rows, ignores zero-valued security-delivery rows as cash movements, and never invents an FX conversion or balancing transaction.

### Historical correction limits

Original snapshots are retained. Shared recovery predicates exclude captures affected by the missing trades until a corrected capture exists. Home/Today must not fall back to an older pre-trade baseline; aggregate scopes cannot silently use only unaffected accounts. The same exclusion reaches History, heatmap, snapshot queries and Investment Lab evidence. Historical daily returns cannot be reconstructed without admissible point-in-time quantities, prices and FX; those metrics remain unavailable instead of using current quantities or current FX.

The isolated exact-manifest rehearsal validates all 18 evidence rows and 13 final instrument quantities, unchanged cash/account/snapshots, transactional rollback and idempotent retry. This is a rehearsal, not proof of a Production write. Six newly required shared KIS quotes were collected and stored under explicit user approval through the existing provider/budget/admission path; no broker order was placed.

## Validation and rollout

- `tests/native-portfolio-ledger.test.mjs`: settlement currencies, fractional precision, reported order versus derived execution, date evidence.
- `tests/native-portfolio-persistence.test.mjs`: real writer/query/engine under PGlite RLS, retries, ownership, archived identity reuse, cutoff delays and old/new capture coexistence.
- `tests/native-currency-counterfactual.test.mjs`: exact-cutoff deposit is neither lost nor treated as return in actual/alternative paths.
- `tests/twelve-data-storage.test.mjs`: actual stored observation cutoff freshness without extending retention or making a new provider request.
- `scripts/native-trade-cutoff-rehearsal-cases.mjs`, connected to the existing isolated PostgreSQL rehearsal runner: full migration chain, actual TCP writer/query, settlement, RLS/rollback and delayed cutoff/Today. The runner creates a new loopback cluster, never accepts a database URL and filters inherited environment.
- Browser QA uses actual React components in a temporary local-only harness; API/auth responses are synthetic. This is not authenticated production QA. Temporary route must be removed before build/release.

Migrations 0057 and 0058 are additive and retain old event/snapshot formats. The full isolated PostgreSQL chain and historical correction rehearsal have passed. Apply migrations separately from user repair only after the final test, lint, build, browser and restore gates pass; local rehearsal is not Production completion. For rollback, pause new native mutations/jobs, retain all events/snapshots and investigate under an owner lock; do not delete v2 evidence or run a down migration against live data. An older app is not safe to resume native writes after new settlement-only events without compatibility review.


### Observed local verification (2026-09-24)

- PostgreSQL 17.11: all 58 migrations (0000–0057) applied to a newly created isolated loopback cluster. The three new real-writer cases passed: actual settlement + atomic first-buy idempotency; tenant boundary + failed-sale rollback; pre-07:00 state at delayed execution + Today attribution. Legacy rows were retained and the cluster was stopped. This did not rehearse the blocked real-user historical repair or its correction operator.
- Browser: actual components in Next.js, 1440×900, 1366×768, 390×844 and 320×844, Korean and English, reduced motion. All eight combinations passed fractional KRW execution input, full-sale selection, disabled zero-position sale, new instrument search/save, Escape/focus return, backdrop dismissal, and horizontal overflow. Screenshots inspected at desktop and mobile sizes. API responses and authentication were replaced at the HTTP boundary by synthetic accounts; no production write was made. The temporary `local-trade-qa` route was removed after the run.
- A lazy-load suspension initially hid the parent page; the trade dialog now owns its Suspense/loading boundary. Compact entry keeps the selected account/instrument, collapses cash detail and keeps Save reachable while scrolling.
- TypeScript: passed. Production build: passed, including static generation; inherited DB/provider/auth credentials were excluded and only an unreachable loopback DB was configured. This is a build check, not live DB/auth verification.
- Lint: final complete check passed with zero errors and zero warnings. The final production build also passed after all UI failure-path fixes.
- Full suite: 2,871/2,871 passed, no skipped/cancelled cases. Earlier writer-inventory, mocked-clock and PGlite-lifecycle test errors were corrected. Exact-boundary unallocated group income now restricts group return; its seven group tests passed. Final UI race fixes are additionally covered by 36/36 focused tests and the browser failure scenarios below.

Local diagnostic logs/screenshots are ignored under `output/`. Private recovery evidence is ignored under `.vercel/`. Neither directory is part of the intended commit.


### Final UI failure-path review

A second independent review found and fixed stale modal callbacks and stale holding hints. In-flight requests now lock editing/closing and have a 30-second network timeout. If a response is uncertain, closing the dialog preserves its component, input, action and pending operation ID in memory. Reopening resumes that same attempt; retry sends the identical request. Inputs cannot turn that unknown attempt into a different trade. A definitive 4xx or the known pre-writer release-gate 503 unlocks it; a 503 also offers a fresh availability check. Hints are revalidated on initial load and after a conflict reload, and an invalid compact hint cannot fall back to an unrelated deposit.

Playwright failure-path checks passed at 1440 and 390px: delayed response cannot close mid-save; unknown response survives close/opposite-action reopen with identical request/operation ID; stale initial asset is blocked; asset removal after 409 is blocked on reload; temporary 503 recovers. This preservation is component-session memory, not durable offline or cross-tab transaction storage. Browser reload or leaving the page is not claimed as a durable pending-transaction recovery feature.

### Recovery verification (2026-09-25)

- PostgreSQL 17.11: all 59 migrations and the broker recovery writer cases passed in a fresh loopback cluster, including RLS, other-owner isolation, duplicate detection, rollback, current-state conflict and idempotent retry. A separate real-PostgreSQL rehearsal of the exact 0057/0058 migration operator passed its preservation and repeat-execution guards. Both clusters were stopped.
- The private exact-manifest rehearsal passed dry-run rollback, final securities/evidence checks and retry. It uses the actual recovery writer and SQL; the cloned private data never leaves the local isolated database.
- Final release gates passed: 2,914/2,914 tests, full ESLint with no warnings, and optimized production build including TypeScript. Recovery details passed keyboard, refresh, date-only presentation and overflow checks at 1440/1366/390/320px in both languages. Screenshots were inspected. Temporary routes were removed; their generated development cache was cleared before the successful production build.
- The exact final private plan also passed the guarded operator on real PostgreSQL: exclusive before-image backup, dry-run rollback, injected other-owner change detection/rollback, exact event/quantity readback and retry. Only external email-to-owner lookup was replaced by an explicit local test callback; no real email authentication is claimed by this rehearsal.

The recovery feature branch disables automatic Vercel Git Preview deployment, following the existing release branches. This prevents a Preview build from inheriting unreviewed database configuration. Isolated local PostgreSQL/browser checks are the pre-merge gates; the master Production deployment remains enabled and the Cron schedule is unchanged.
