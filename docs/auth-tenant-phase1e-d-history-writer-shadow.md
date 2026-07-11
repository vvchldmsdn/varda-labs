# Auth/Tenant Phase 1E-D: History Import Split Shadow

Last updated: 2026-07-11

Status: completed as a read-only production shadow. No snapshot owner, FX,
identity, schema, route, daily writer, or Cron write was enabled.

## Scope

This phase covers only `base44_history_import`. The importer remains a mixed
writer, but its canonical shadow is split into two independent plans:

- `account_balance_snapshots`, `daily_portfolio_snapshots`, and
  `daily_position_snapshots` are explicit-context user-owned candidates;
- `fx_rates` is shared-reference evidence with zero owner actions.

The canonical path accepts an explicit `--canonical-owner-id`, an explicit
`--approve-provisioning-owner` for a provisioning candidate, sanitized Base44
history/core exports, and read-only database state. Combining the canonical
owner option with `--write` is rejected before database connection or DML.

## Minimal Source Contract

The owner shadow excludes financial values and descriptive holding data. It
uses only the evidence needed to identify rows and validate relationships:

| Source | Shadow fields |
| --- | --- |
| Account balance | Base44 identity, balance date |
| Portfolio snapshot | Base44 identity, snapshot date, account, fixed import source |
| Position snapshot | Base44 identity, snapshot date, account, legacy asset identity, fixed import source |
| FX rate | Base44 identity, date, status/source labels, sample flag |

Stored FX values, snapshot `fx_rate`, `close_price_krw`, ticker, asset name,
description, amounts, and legacy creator/user fields are never owner evidence.
The existing full legacy normalization and upsert path remains unchanged and
runs only outside canonical mode.

## Snapshot Owner Rules

Every snapshot row belongs to the explicit migration owner as one whole row.
Balance component columns do not represent separate owners and are not used to
infer one.

For each legacy identity:

- absent DB candidate produces an `insert` plan;
- existing null canonical owner produces an `update` plan;
- an exact same-owner candidate produces `skip`;
- a foreign owner, ambiguous identity, or contract collision produces `block`.

Source/database duplicate legacy identities, duplicate natural keys, and an
identity whose stored natural key differs from the source are blocked without
selecting, merging, or repairing a candidate.

Natural-key diagnostics use:

- balance date for account balances;
- snapshot date, account, and `base44_import` source for portfolio rows;
- snapshot date, account, resolved asset-or-legacy-asset evidence, and
  `base44_import` source for position rows.

No uniqueness constraint or schema change is introduced by this diagnostic.

## Parent Relationships

`daily_portfolio_snapshots.account="all"` is a parent-less aggregate. A null
`account_id` is required and the canonical owner comes only from the explicit
migration context.

For account-specific portfolio rows and all position rows:

| Parent state | Shadow result |
| --- | --- |
| Current parent missing and stored link null | `legacy_only_reference` |
| Parent has the same canonical owner | `compatible` |
| Parent owner null with a fresh matching core shadow proof | `compatible_planned` |
| Foreign/ambiguous parent, mismatched link, or null owner without fresh proof | `block` |

A position whose current asset is missing remains valid legacy history with
nullable `asset_id` and preserved `legacy_asset_id`. Ticker/name fallback is
not used to create a relation or infer ownership. This preserves the 52
known unmatched source rows.

## Fresh Core Proof

The history command reads the sanitized core source and current core DB state,
then runs the existing core canonical planner with the same explicit owner in
the same process. A proof is usable only when it is planned, read-only,
canonical-write disabled, side-effect free, and contains the exact account
code or legacy asset identity.

An old report or a parent with merely null ownership is not sufficient proof.
Core identities stay in process; canonical output contains only counts and
fingerprints.

## Shared FX Boundary

FX diagnostics are deliberately separate from snapshot ownership. They report
source/database duplicate identities, duplicate date groups, missing/non-OK
status rows, and sample rows. They always have:

- classification `shared_reference`;
- owner actions `0`;
- actual writes disabled;
- database side effects disabled.

An FX diagnostic can be `needs_review` while the snapshot owner plan remains
`planned`. FX duplicate-date policy and any future repair belong to the
separate FX writer contract and cannot pass or block snapshot ownership.

## Production Shadow Result

The 2026-07-11 production run used 12 SELECT operations across history and the
fresh core proof. It made no write.

| Evidence | Result |
| --- | ---: |
| Account balance actions | update 3, block 0 |
| Portfolio snapshot actions | update 74, block 0 |
| Position snapshot actions | update 418, block 0 |
| Total owner actions | update 495, insert/skip/block 0 |
| Account references | parent-less aggregate 5, compatible planned 487, block 0 |
| Asset references | compatible planned 366, legacy only 52, block 0 |
| Natural/identity collisions | 0 across all snapshot tables |
| Fresh core proof | planned: accounts 4, assets 17 |
| Canonical assignments | planned 495, written 0 |

The shared FX diagnostic read 467 source and 467 matching database rows. It
reported one duplicate date group and one missing status row, with no duplicate
identity and no sample row. Its result is `needs_review`; the snapshot result
remains `planned`.

The command reported `actualWriteAllowed=false`,
`canonicalOwnerWriteEnabled=false`, and `databaseSideEffects=false`.

## Output Boundary

Output contains aggregate action/reference/diagnostic counts and truncated
SHA-256 fingerprints only. It excludes canonical UUIDs, Base44 IDs, DB row
IDs, paths, legacy owner values, dates at row level, ticker/name/description,
financial values, raw SQL, DB URLs, and auth/provider material. Errors are
reduced to stable safe codes.

## Fixture Gate

Tests cover:

- canonical argument validation and `--write` hard block;
- minimal source DTO non-disclosure;
- single-owner balance planning;
- parent-less `account=all` behavior;
- same-owner and fresh-core account/asset relations;
- unproven null, foreign, and ambiguous parent blocking;
- unmatched position preservation;
- source/database identity and natural-key collisions;
- shared FX duplicate/status diagnostics isolated from snapshot ownership;
- identifier/value non-disclosure;
- SELECT-only state/source modules and canonical early return before legacy DML.

## Explicit Non-Actions

This phase does not:

- assign or backfill a canonical owner;
- write, repair, delete, or deduplicate snapshots or FX rows;
- change FK, nullability, uniqueness, RLS, readers, or response shapes;
- change the daily snapshot writer, KIS/FX providers, admin routes, or Cron;
- infer ownership from asset history, stored values, or legacy creator fields;
- activate identity or the provisioning user;
- change product UI or the excluded Goal/Cashflow scope.

The next mixed-writer shadow must be approved separately. This phase does not
authorize history importer activation or a global owner backfill.
