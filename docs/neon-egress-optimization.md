# Neon outbound data reduction

This change reduces database result transfer. It does not increase the Neon plan,
clear an exhausted quota, change authentication lifetime, or fabricate missing
financial evidence. Production savings require measurement after service access
is restored; synthetic test counts are not billed-byte measurements.

## Read boundaries

- Anonymous requests with no Neon auth cookie skip the remote session read. Any
  Neon cookie, including chunks and OAuth challenges, still goes through the SDK.
  Authenticated requests share that read only inside the current React request;
  member activity, tenant admission and RLS checks remain authoritative.
- Original navigation links no longer prefetch authenticated portfolio routes.
- Manual quote collection still finishes its existing queue. Lightweight progress
  polling continues, while full-page data refreshes coalesce within ten seconds.
  Terminal, timeout and retry-limit paths flush the last confirmed change.
  This does not introduce automatic quote collection.
- Current valuation readers request only valuation sources. Investment cost reads
  omit ledger snapshots they never consume. Dashboard history selects the six
  fields needed by its projection, not full snapshot evidence.
- The initial beta structure and target reads share one scoped source promise.
  Post-calculation target checks still reread policy, valuation, accounts and
  identities, so concurrent changes remain detectable.
- Beta home requests recent history first. Full history loads when requested;
  simulation research loads when its detail opens. Request binding, scope,
  currency and read epoch guard late responses and account changes. Historical
  completeness, nulls, corrections and return baselines retain their meanings.
  Lazy reads time out after 30 seconds and can be retried without hiding period
  controls. Full history remains available; the recent subset is never labeled ALL.

## Shared market history cache

Only the bounded public instrument-price and FX history projections used by
research are cached. No holdings, ledgers, imports, owners or personalized
calculations enter this cache. Callers still authorize the current scope first.

Each call reads a compact PostgreSQL content signature over the selected rows.
The cache key includes source, SQL, parameters and that signature. Corrections,
deletions, provider changes and restored rows therefore choose another entry.
A cold load verifies the signature again before storing the result. Concurrent
changes fall back to a fresh, uncached read. Source failure remains a failure;
the cache does not conceal unavailable evidence. Cache backend failure can use
a new source read. Dates have consistent string representations on both paths.

This trades aggregation work in Postgres for fewer outbound rows. The one-hour
revalidation interval is not permission to show an hour-old price: the content signature
is checked every call. Benchmark database CPU/latency as well as bytes before
extending it to larger histories. Next Data Cache availability and Vercel cache
charges are separate from Neon network transfer.

## Measurement and rollout

Local regression entry points are `tests/neon-egress-*.test.mjs` (also included in
the full runner) and `node scripts/neon-egress-browser.mjs --run`. The latter uses
a disposable source copy, a fresh browser, synthetic history/API replies, and
1440/390/360px viewports. It verifies real UI interactions, not live authentication,
production evidence, provider behavior or physical-device touch.

`CAIRN_DB_READ_METRICS_ENABLED=true` enables opt-in numeric diagnostics for tenant
read transactions and the shared-history signature/result paths. The default is
off. Logs contain the fixed read group, success, row count, elapsed milliseconds
and estimated JSON result bytes. They contain no SQL, parameters, row contents,
owner identity, session values or exception text. The estimate excludes protocol
overhead and does not cover every SDK or direct query; it is not Neon's bill.

After an authorized deployment and restored quota:

1. Compare Neon main-branch outbound counters over matched observation windows.
   Include request counts and local/admin traffic; previews can use other branches.
2. Measure cold/warm home, account/currency switches, full history, simulation and
   one explicit quote refresh. Compare query/result counts and p95 latency.
3. Confirm account switching/sign-out masks stale results; edit/correct evidence
   and confirm cache invalidation without weakening owner or null handling.
4. Monitor CPU and Vercel cache reads/writes. Avoid claiming a percentage reduction
   until representative production observations exist.

No production environment flags, cron settings, migrations, provider requests,
auth permissions or billing plans are changed by this implementation. A switch
to a new Auth SDK, global Cache Components, Redis, or user-result persistence
requires a separately measured need; none is necessary for these reductions.

## Validation recorded on 2026-11-20

- Full isolated regression suite: 3,710 passed, zero failures or skipped tests
  (`output/reliability-ci/unit-tests-2I7s3x/report.json`).
- Final lint, generated route types and TypeScript checks passed
  (`output/reliability-ci/lint-type-2YXrOM/report.json`).
- Production build passed with the final runtime implementation
  (`output/reliability-ci/production-build-fXVQDG/report.json`).
- Synthetic browser journeys passed at 1440x900, 390x844 and 360x800
  (`output/neon-egress-browser-iDqEmx/results.json`). Checks include lazy reads,
  retry with controls retained, close cancellation and stale-owner masking.
- `git diff --check` passed. Existing untracked `debug.log` was preserved.

These checks do not establish production Auth recovery, actual Neon billed-byte
savings, provider resilience, real PostgreSQL multi-session behavior or physical
device touch behavior. At this implementation-validation milestone, no commit,
push, merge or deployment had been performed; release status is verified separately.
