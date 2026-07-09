# Today Holding Detail Read-Only Design

Status: design plus minimal v1 implementation. The v1 implementation uses the
existing `/today` route with search params. It does not add a separate route,
provider call, dry-run execution, write path, Cron behavior, schema change, or
migration.

## Decision

Do not implement a new holding detail route until the detail surface is clearly
different from the existing `/today` table.

The current `/today` page already shows:

- account filter tabs;
- aggregate ready/source/status;
- today change, FX impact, and trade-flow totals;
- previous value and coverage metrics;
- contribution rows by holding;
- exclusion rows with reason labels.

A future holding detail surface should therefore be an evidence drilldown, not a
second contribution table.

## Implemented V1

The first implementation keeps the detail surface inside `/today`:

- `/today?ticker=069500&market=korea`
- `/today?account=all&ticker=VOO&market=us`

The route remains a Server Component page. It still reads `searchParams`,
normalizes the account selector, calls `getPortfolioDashboard(selectedAccount)`,
and passes the resulting dashboard payload to `TodayMovement`.

Selection is handled by `src/lib/today-holding-detail.ts`, a pure helper that:

- resolves ticker and market from search params;
- selects from `DashboardData.holdings`;
- attaches matching `DashboardData.todayMovement.contributionRows`;
- attaches matching `DashboardData.todayMovement.exclusions`;
- returns sanitized display data without `assetId`, `holdingId`,
  `legacyBase44Id`, or legacy Base44 object ids.

The v1 panel displays current quote/value evidence, baseline/movement source
evidence, movement breakdown, and matching exclusion evidence. It intentionally
does not show charts, raw event JSON, provider controls, admin controls, or raw
internal ids.

## Intended Job

The holding detail surface should answer one narrow question:

> Why did this holding contribute this much to today's movement?

It should show the specific current, baseline, FX, and event evidence used by
the shared movement builder. It should not produce a separate movement result.

## Data Source Rule

The detail surface must reuse the same payload path used by `/` and `/today`.

Allowed source:

- `getPortfolioDashboard(selectedAccount)`
- `DashboardData.todayMovement`
- `DashboardData.holdings`
- contribution and exclusion rows produced by `src/lib/portfolio-movement.ts`

Not allowed:

- a second SQL/query path that recomputes movement;
- a client-side REST refetch for first render;
- direct KIS, FX provider, dry-run, write, admin, or Cron calls;
- duplicating formulas from `src/lib/portfolio-movement.ts`.

If the current dashboard payload lacks evidence needed by the detail view,
extend the shared server payload or movement output first, with tests. Do not
derive a different detail-only formula inside a route component.

## Route Shape

Preferred first route shape:

- `/today?account=brokerage&ticker=069500&market=korea`

Reasons:

- search params preserve the current App Router read pattern;
- account tabs can remain shareable and server-rendered;
- ticker, account, and market are human-readable and non-secret;
- no default product URL needs `assetId`, `holdingId`, `legacyBase44Id`, or a
  legacy Base44 object id.

Resolution rules:

- `account` uses the same normalization as the current dashboard.
- `ticker` is normalized with the existing ticker normalization helper.
- `market` is optional only when ticker plus account resolves exactly one
  current holding.
- If the selector resolves zero holdings, show a neutral not-found state.
- If it resolves multiple holdings, show an ambiguity state and ask the user to
  narrow by market/account. Do not pick one silently.

Deferred route alternatives:

- `/today/[ticker]`
- `/portfolio/holdings/[ticker]`
- `/portfolio/holdings/[ticker]?account=...&market=...`

These can be reconsidered after user review. Do not use raw internal ids in the
default route unless a separate operator/debug surface is approved.

## Display Sections

The first version should stay plain and data-focused.

### Summary

- ticker;
- asset name;
- account;
- market;
- currency;
- movement status;
- source: `daily_position_snapshot` or `asset_price_snapshot`;
- reason when excluded or aggregate is not ready.

### Current Evidence

- current quantity;
- current local price;
- current KRW value;
- current quote provider/source label;
- quote type and status;
- quote fetched/as-of time;
- latest stored USD/KRW used for valuation when currency is USD.

### Baseline Evidence

For `daily_position_snapshot` source:

- baseline snapshot date;
- baseline quantity if available;
- baseline local price;
- baseline KRW market value;
- baseline FX rate for USD positions;
- snapshot source label.

For `asset_price_snapshot` fallback source:

- previous close date;
- previous close price;
- close source label;
- FX rate used or inferred;
- previous-close coverage state.

### Movement Breakdown

- previous value KRW;
- current value KRW;
- today change KRW;
- return percentage;
- price contribution;
- FX contribution;
- trade-flow adjustment.

The breakdown should be copied from shared movement output. If the output does
not expose price contribution separately yet, the first implementation should
show available shared fields and leave price contribution as a documented gap.

### Post-Baseline Events

- buy/sell events after the baseline date that affected trade flow;
- event date;
- event type;
- ticker/name;
- amount KRW;
- quantity delta when available;
- source label.

Do not show raw event JSON by default.

### Exclusion Evidence

When the selected holding is excluded:

- exclusion reason;
- whether the exclusion is holding-level, snapshot-level, or aggregate-level;
- missing data type, such as baseline snapshot, fresh live price, baseline FX,
  current FX, previous close, unsupported currency, or coverage threshold;
- the human-facing ticker/name/account fields available.

Do not use internal ids as fallback labels.

## Component Boundary

The future implementation should split by data lifecycle, not just visual size.

Server components:

- route/page component that reads search params;
- server data loader using `getPortfolioDashboard`;
- detail selector that resolves the selected holding from the shared payload.

Shared presentational components:

- metric card;
- evidence row;
- movement breakdown table;
- status/reason badge;
- account/ticker selector shell.

Client components only when needed:

- local table sorting;
- local row expansion;
- compact/mobile section toggles.

Client components must receive already-derived read-only data. They must not
fetch providers, call admin routes, or recompute movement.

## URL Search Param Contract

Supported params for the first design:

| Param | Required | Meaning |
| --- | --- | --- |
| `account` | no | `brokerage`, `isa`, `irp`, or `all`; same fallback as dashboard. |
| `ticker` | yes for detail | Human-facing ticker selector. |
| `market` | when needed | Disambiguates duplicate tickers across markets. |

Do not add `assetId`, `holdingId`, or `legacyBase44Id` as default product
params. They can exist in data payloads for matching and reconciliation, but
they should not become normal product navigation.

## Differences From `/today`

`/today` should remain the account-level evidence page:

- aggregate status;
- aggregate totals;
- contribution table;
- exclusion table.

The detail surface should add:

- selected holding resolution;
- current quote evidence;
- baseline snapshot or previous-close evidence;
- row-level movement breakdown;
- post-baseline event evidence;
- row-level exclusion explanation.

It should not add:

- a second aggregate formula;
- another full contribution table;
- a live refresh button;
- admin write controls;
- provider status controls.

## Verification Gate Before Further Implementation

Before adding a separate route, richer event drilldown, or component
abstraction:

1. Add or confirm fixture coverage for the shared movement builder:
   - KRW snapshot movement;
   - USD price movement;
   - USD FX-only movement;
   - trade-flow adjustment;
   - stale current price exclusion;
   - missing baseline FX exclusion;
   - unsupported currency exclusion.
2. Confirm selected detail values are selected from the same contribution row
   that `/today` displays.
3. Confirm aggregate movement still equals the shared contribution model plus
   removed-position accounting.
4. Confirm no provider/admin/write/Cron route is called during render.
5. Confirm authenticated and unauthenticated production smoke behavior remains
   unchanged.
6. Confirm no default product HTML exposes `holdingId`, `assetId`,
   `legacyBase44Id`, legacy Base44 object ids, secrets, provider auth headers,
   or raw provider responses.

## Explicit Non-Goals

- No separate route beyond the `/today` query-based v1 panel.
- No visual polish.
- No chart work.
- No public refresh button.
- No admin action button.
- No provider call.
- No dry-run or actual write.
- No snapshot write.
- No Cron or automation.
- No schema or migration change.
- No recommendation, risk, or scoring integration.
