# Migration Modeling Guidelines

These guidelines define how varda-labs should translate Base44 data and code
into the Next.js/Postgres application. They are the default rule when Base44
schema and current varda-labs schema disagree.

## Default Stance

Base44 is a reference for behavior and historical evidence, not the target data
model. Prefer a small, explicit varda-labs model over a 1:1 copy of Base44
entities.

## Modeling Layers

| Layer | Purpose | varda-labs examples |
| --- | --- | --- |
| static master | relatively stable identity/config | accounts, assets, asset groups, ETF master |
| current state | current holdings and editable policy | current asset quantity, target weights |
| event ledger | append-only changes | event ledger entries, future trade/cashflow commands |
| time-series source | observed daily/periodic facts | asset prices, FX rates, benchmarks, factors |
| snapshot evidence | point-in-time portfolio facts | daily portfolio and position snapshots |
| derived read model | recomputable display/decision helper | dashboard movement, MA status, risk summaries |
| run artifact | result of a calculation run | recommendation run, candidate scores, debug reasons |
| settings | explicit user or portfolio policy | trend-filter toggle, allocation thresholds |
| secrets | provider credentials and tokens | environment variables or future secret store only |

## Promotion Rules

Promote a field into a canonical table only when all are true:

- it has a clear owner and update path
- it is not trivially recomputable from imported source data
- it is needed for joins, filtering, or product decisions
- it is stable enough to enforce constraints around
- sensitive values have been excluded or redacted

Keep a field as JSONB or raw legacy evidence when:

- it is needed mainly for audit or historical replay
- the shape is unstable across Base44 functions
- it is not queried directly by the first varda-labs UI
- it contains legacy calculation debug context

Do not import or persist:

- app secrets, provider app keys, access tokens, authorization headers
- owner/user ids until a varda-labs tenant model exists
- one-off diagnostic payloads with no product value
- transient UI state

## Derived Value Rule

If a value changes because time passes, market data changes, or a calculation is
rerun, it is not a static master field.

Examples:

- MA120 comes from price history.
- current quote is a cache with provider metadata.
- current portfolio weight is derived from quantity, price, FX, and account.
- recommendation score is an artifact of a specific engine run.

Store derived values only as:

- latest cache with `as_of`, `source`, and status metadata
- point-in-time snapshot evidence
- calculation run artifact

## Snapshot Rule

Snapshots should preserve the facts used at that time, even when current master
rows later change or disappear. This is why nullable UUID foreign keys and raw
legacy identifiers are intentional for imported history.

Historical snapshot rows may keep denormalized fields such as ticker, asset
name, account string, market, currency, source, and trend evidence.

## Recommendation Rule

Do not build a recommendation UI directly on old Base44 output tables. First
decide whether legacy recommendations are:

- audit history to preserve as imported artifacts
- training/comparison fixtures for a new engine
- obsolete outputs to ignore

The target shape should be:

- recommendation run
- recommendation candidate/item rows
- structured scalar fields for frequently queried values
- JSONB for detailed reasons/debug artifacts

## Simulation Rule

Simulation chunks, sample shards, and large result blobs are not core finance
tables. Treat them as future job/artifact storage. Import only summarized output
after the product surface is defined.

## Write Path Rule

Do not port browser-side multi-step mutations. Any varda-labs write flow should
be implemented as a server-side command with:

- authorization
- input validation
- database transaction
- event ledger append where applicable
- idempotency or duplicate guard
- dry-run or preview mode for admin/backfill operations

## Pre-Cron Guardrail

Until the next automation validation gate is complete, allowed work is limited
to:

- docs and audits
- read-only query helpers
- read-only pages
- tests for pure calculations
- no-op refactors that do not touch admin write paths

Blocked work:

- Cron config
- KIS write behavior changes
- daily snapshot writer behavior changes
- schema/FK/unique migrations touching snapshot or market-data writes
- cleanup/delete/backfill
- recommendation or simulation write paths
