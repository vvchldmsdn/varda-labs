# Calculation Fixture Gap Audit

Last updated: 2026-07-10

This audit is docs-only. It does not change helper logic, route handlers,
database schema, migrations, imports, Cron behavior, KIS behavior, provider
calls, admin write paths, cleanup, delete, repair, or backfill work.

## Executive Decision

Do not add broad tests just because the migration has entered a calculation
heavy phase.

The current varda-labs fixture layer already covers the first read-only and
manual-pipeline safety cases that matter today:

- basic portfolio math helpers;
- event-ledger realized return inputs;
- market-cycle calendar resolution;
- history aggregate display behavior;
- Cron preflight response shaping and safety filtering;
- ETF and market-context read-only semantics.

The next useful test work should be tied to a specific approval gate:

1. recommendation schema or engine work;
2. simulation/investment lab helper extraction;
3. Cron controller or automated write work;
4. auth/tenant-owned user write work.

Until one of those gates is selected, keep fixture work narrow and avoid
porting Base44 formulas only to make tests pass.

## Current Fixture Coverage

| Area | Current test file | What is covered | Current gap |
| --- | --- | --- | --- |
| Shared math | `tests/portfolio-math.test.mjs` | ticker normalization, KRW conversion, percentage guards, numeric parsing, date delta, sum/dedupe helpers | Adequate for current read-only screens. |
| Realized return | `tests/portfolio-return-metrics.test.mjs` | chronological buy/sell ledger, explicit trade metrics priority, before/after fallback, unmatched sell rows, account filtering, legacy id mapping | Needs more cases before recommendation generation or automated snapshot writes depend on new event shapes. |
| Market calendar | `tests/market-calendar.test.mjs` | KST 07:00 cutoff, cycle window, Korean/US holidays, 2026-07-08 cycle, USD-denominated asset handling | Needs only new fixtures when a real observed market-calendar miss appears. |
| History display | `tests/history-balance.test.mjs` | query normalization, stored `all` row priority, derived all row with complete account set, partial group suppression | Adequate for the current `/history` read-only route. |
| Cron preflight | `tests/cron-preflight.test.mjs` | read-only query contract, secret/write-shaped query rejection, suggested dry-run URL sanitization, KIS cooldown blocker logic, stale/missing/duplicate blockers | Adequate for Phase 1 preflight. Cron controller work needs a separate fixture set. |

## Near-Term Fixture Priorities

### P1: Event Ledger Realized Return Edges

Add these only when the next selected work depends on realized PnL beyond the
current read-only dashboard and daily snapshot summaries:

- same-day event ordering with `recordedAt` and `createdAt` ties;
- partial sells across multiple buy lots with changing average cost;
- sell events that exceed known running quantity;
- zero or missing buy amount rows and their effect on `skippedBuyEventCount`;
- KRW and USD events for the same ticker in different accounts;
- asset resolution collision cases where ticker matches in multiple accounts;
- explicit `trade_metrics` versus memo fallback precedence when both exist.

Reason: recommendation sizing, contribution decisions, and future automated
write paths must not depend on ambiguous realized-return evidence.

### P1: Daily Snapshot Planner Pure Boundaries

Do not unit test `runDailySnapshot` as a monolith. It currently combines DB
reads, close-price coverage, event-ledger summaries, duplicate checks, and
planned writes.

Before Cron controller or broader automated writes, extract or fixture-test only
the pure planner boundaries that can run without DB/provider calls:

- close coverage classification from required assets and close rows;
- `closeSyncPlan` grouping and KIS batch splitting;
- duplicate/unmanaged-row blocker classification;
- planned insert/update/skip/block count aggregation;
- account versus aggregate `all` write readiness rules.

Reason: these are the parts that determine whether automation writes or stays
blocked. Provider calls and Neon writes should remain integration-gated, not
unit-tested through production-like routes.

### P1: Recommendation Input Guards

Add only after a recommendation lane is explicitly selected. Candidate fixture
targets:

- event-ledger cost basis and realized-return input summaries;
- account filters for `all`, `brokerage`, `isa`, and `irp`;
- USD/KRW conversion evidence used by recommendation inputs;
- cash allocation and contribution sizing formulas;
- minimum execution size;
- churn window and minimum holding-day guardrails;
- taxable-account penalty logic;
- blocked symbol or do-not-trade rules.

Do not implement a recommendation engine to satisfy these tests. First extract
small pure helpers with deterministic fixture inputs and expected outputs.

### P2: Market Calendar Expansion

The current market-calendar fixtures cover the migration-critical dates. Add
new fixtures only when a real miss or new market scope appears:

- additional KRX substitute holidays;
- year-end closure edge cases around weekend shifts;
- US early-close or special closure handling if it becomes product relevant;
- non-US/non-Korea markets if new assets require them.

Reason: calendar fixtures should mirror operational requirements, not become a
hand-maintained full exchange calendar.

The 2026-07-10 portfolio-risk readiness audit found a real miss: the shared
observed-fixed-holiday rule marks stored Korean close dates 2022-12-26,
2023-01-02, and 2025-02-28 as closed. Historical Korean substitute-holiday
fixtures are now an active prerequisite for portfolio-risk calendar work. Keep
the correction separate from snapshot/Cron changes until its operational blast
radius is reviewed.

### P2: Simulation / Investment Lab Math

Do not port Base44 simulation functions wholesale. If the product surface is
approved later, start with pure helpers and fixtures for:

- KRW return matrix normalization;
- weight normalization;
- simple historical weight backtest;
- scenario metric summaries;
- risk contribution or effective-number-of-bets calculations;
- legacy cashflow projection formulas, if the planning screen is selected.

Keep job state, shards, dense paths, provider reads, and artifact writes outside
these pure helper tests.

## Not Worth Testing Yet

These should not be pulled into the current fixture layer:

- Base44 simulation job orchestration;
- `SimulationChunk` or `SimulationSampleShard` payload shapes;
- deprecated `runSimulationPipeline`;
- recommendation LLM briefing or content generation;
- provider-specific KIS response parsing beyond the existing provider boundary;
- admin route actual writes;
- Cron enablement or `vercel.json` behavior;
- auth provider callbacks before a provider is chosen;
- RLS behavior before tenant schema is approved.

## Recommended Next Test Order

Use this order only after the matching product or automation gate is selected:

1. Add realized-return edge fixtures if recommendation, contribution sizing, or
   daily snapshot return semantics change.
2. Extract and test close coverage / close sync planning helpers before any
   Cron-safe close sync controller.
3. Add recommendation input guard fixtures before recommendation schema or
   engine implementation.
4. Add simulation math fixtures only after a specific simulation/investment lab
   product surface is selected.
5. Add auth/RLS integration tests only after the provider and tenant schema are
   approved.

## Current Recommendation

For the immediate migration state, pause code changes and let the user review
the production read-only surfaces. If the user explicitly continues before that
review, the safest next step is still docs-only planning or a very small P1
fixture from this audit, not new schema, routes, or write automation.
