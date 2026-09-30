# First recorded trade: holdings presentation continuity

Base: `1b2717f2a233414ecf848a6d3073d35e64fac41a` (same tree as production merge `b1ae78fecef6cb94e471d75cf529ad52922a9c20`).

## Incident and repair

Creating a native opening/first trade populated `accounts.native_state`. Seven KRW routes and the daily-job selector treated this storage fact as a request to replace the established holdings presentation with the currency-native presentation. That reader excludes existing non-native history and needs stronger FX metadata than existing collection-time KIS observations. A valid trade therefore changed all screens and their valuation coverage.

`holdingsPortfolioSql` keeps accounts with established non-sample holdings history/events in their existing presentation and daily writer. Native-only accounts and explicit USD selections keep the existing native path. This is a derived compatibility cohort, not a new user setting; mixed scopes containing native-only accounts still use their existing native presentation.

`loadNativeLegacyTrades` reads effective revision-aware native trades with tenant RLS and exact owner/account/asset joins, including archived sold holdings. It projects them for existing movement, return and history readers without changing stored trades, cash, positions or snapshots. Unknown KRW settlement/FX/cost stays unknown. Failed trade projection is explicit, never silently omitted. Remaining original native cost lots supersede a touched holding's stale legacy average; foreign lots are not translated with today's FX.

The durable queue, non-durable daily selector, progress reader and optimistic snapshot guard use the same compatibility predicate. Native revisions and paused/compatible protections are retained. No migration, provider request, Cron schedule change or financial-data repair is needed.

## Verification

- `tests/native-legacy-trade-projection.test.mjs`: full exit bridge, signed quantity, effective revisions, foreign settlement/FX gaps, unknown cost, fee currency gaps and remaining cost vs stale average.
- `tests/native-service-integration.test.mjs`: actual writer/migrations/effective query with isolated PGlite tenant RLS; first full sale, retry idempotency, archived identity, owner isolation, read-side immutability, native-only/inactive account routing; actual durable queue discovery/claim/completion and rediscovery.
- Existing route, activation, deferred-history, movement and return suites cover unchanged native/legacy contracts.
- Read-only production replay used the actual modified query + shared dashboard engine. Existing account surfaces and current movement became available; the sold position was absent, with its sale proceeds excluded from investment loss. No customer records were modified by verification.

PGlite is not a natural future Cron execution or multi-session production PostgreSQL test. Original missing acquisition-cost evidence is not repaired or inferred by this change. There is no rollback or duplicate entry of the valid sale.

Final release validation: all 391 test modules (3,104 cases) ran in sequential batches. Four initial fixture/mock failures were corrected; the three affected modules then passed 5/5, 12/12 and 31/31. The focused first-sale integration and projection suites passed 10/10 each. ESLint and the Production webpack build passed on the release source. The build used an unreachable loopback database URL solely for module initialization, with no production credentials. Private read-only replay outputs and customer data are excluded from this commit.
