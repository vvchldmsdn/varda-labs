# Auth/Tenant Phase 1E-C1: Event Writer Canonical Owner Shadow

Last updated: 2026-07-11

Status: completed as a read-only production shadow. No canonical owner, event
relationship, identity, schema, route, snapshot, or Cron write was enabled.

## Scope

This phase covers only `base44_event_import` and
`event_ledger_entries`. Event Ledger remains in product scope because Home,
Today movement, return metrics, and the daily snapshot calculation read it.
It is not part of the excluded legacy Goal/Cashflow model.

The canonical path accepts only:

- an explicit `--canonical-owner-id`;
- an explicit `--approve-provisioning-owner` when the candidate user is still
  provisioning;
- sanitized Base44 event and core exports;
- read-only database state.

Combining `--canonical-owner-id` with `--write` is rejected before source or
database mutation.

## Source Contract

The shadow DTO follows the Base44 EventLedger relationship semantics:

- event identity, `event_date`, and `event_type` are required for migration
  planning;
- account, legacy asset, legacy group, and correction references are optional;
- an assetless deposit or cash adjustment is valid shadow input;
- ticker, name, memo, description, amount, and before/after values are not
  included in the owner plan.

The existing legacy importer DML and database nullability are not changed in
this phase. Current production source rows all have a legacy asset reference,
so the assetless fixture is a forward contract rather than a schema migration.

## Parent Reference Rules

Each account, asset, and group reference is classified independently:

| Source/DB state | Shadow result |
| --- | --- |
| Source reference absent and DB link absent | `not_applicable` |
| Source reference present but DB parent absent and DB link absent | `legacy_only_reference` |
| DB parent exists with the same canonical owner | `compatible` |
| DB parent owner is null and the same run has a fresh matching core shadow proof | `compatible_planned` |
| Foreign owner, ambiguous parent, mismatched DB link, or unproven resolved null-owner parent | `block` |

Ticker, name, legacy owner strings, snapshots, and current asset metadata are
never used to infer a canonical owner or create a missing parent.

## Fresh Core Proof

Resolved null-owner parents are not accepted from an old report. The event
command reads the sanitized core source graph and current core database state,
then runs `buildBase44CoreCanonicalPlan` with the same explicit canonical owner
inside the same process.

The proof is usable only when it is:

- `planned`;
- read-only;
- canonical-write disabled;
- free of database side effects;
- inclusive of the exact account code or Base44 asset/group identity used by
  the event reference.

The proof identities remain process-local. Output includes only counts and a
fingerprint.

## Correction Rules

- No correction reference is normal and produces `not_applicable`.
- A missing correction target produces `legacy_only_reference` with reason
  `unresolved_correction_reference`.
- A forward target in the same source batch is `compatible_planned` when both
  events remain valid under the same owner context.
- A same-owner external target is `compatible`.
- Ambiguous, foreign, self-referencing, cyclic, mismatched, or blocked-batch
  targets block the source event.

The legacy importer's global correction repair `UPDATE` remains in its existing
write path. The canonical shadow does not call, copy, or simulate that update
and does not populate `corrects_event_id`.

## Output Boundary

Canonical output contains only:

- action counts;
- reference-status counts by relationship kind;
- reason counts;
- aggregate candidate/core-proof counts;
- SHA-256 fingerprints.

It excludes canonical UUIDs, Base44 IDs, event/parent DB IDs, paths, legacy
owner values, memo, description, financial values, raw SQL, DB URLs, and
provider/auth material. Errors are reduced to stable safe codes.

## Production Shadow Result

The 2026-07-11 production shadow used 51 sanitized source events and 10 SELECT
operations across the event and fresh core proof paths.

| Evidence | Result |
| --- | ---: |
| Event actions | update 51, insert 0, skip 0, block 0 |
| Account references | not applicable 34, compatible planned 17 |
| Asset references | compatible planned 40, legacy only 11 |
| Group references | not applicable 47, compatible planned 3, legacy only 1 |
| Correction references | not applicable 51 |
| Fresh core proof | planned: accounts 4, assets 17, groups 1 |
| Canonical assignments | planned 51, written 0 |

The result was `planned`, with `actualWriteAllowed=false`,
`canonicalOwnerWriteEnabled=false`, and `databaseSideEffects=false`.

## Fixture Gate

Tests cover:

- canonical argument validation and `--write` hard block;
- assetless event input;
- missing legacy asset preservation;
- resolved null parent with and without fresh core proof;
- same-owner, foreign-owner, ambiguous, and mismatched parents;
- missing and forward correction targets;
- self and cyclic corrections;
- blocked same-batch correction propagation;
- duplicate source/database event identities;
- identifier and value non-disclosure;
- read-only state/core loaders and early return before legacy DML.

## Explicit Non-Actions

This phase does not:

- write or backfill a canonical owner;
- change Event Ledger schema or nullability;
- link, repair, replay, offset, or deduplicate corrections;
- activate identity, readers, RLS, constraints, or tenant filters;
- change Home, Today movement, snapshots, Cron, KIS, or any route;
- delete or alter legacy Goal/Cashflow data.

The next writer-safety slice must be selected separately. C1 does not approve
event activation or global owner backfill.
