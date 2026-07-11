# Auth/Tenant Phase 1E-E: Market Context Mixed Writer Shadow

Last updated: 2026-07-11

Status: completed as a read-only production shadow. No market regime owner,
global factor, identity, schema, reader, route, or Cron write was enabled.

## Scope

This phase covers only `base44_market_context_import` and splits its two target
classes:

- `market_regime_daily` is user-owned portfolio-derived evidence;
- `global_market_factors` is shared-reference evidence with zero owner actions.

The canonical path requires an explicit `--canonical-owner-id` and an explicit
`--approve-provisioning-owner` for a provisioning candidate. Combining the
canonical option with `--write` is rejected before source read, database
connection, or DML.

## Source Contract

The market regime shadow follows the Base44 entity contract rather than the
stricter current importer:

- Base44 identity and date are required;
- missing or blank account is normalized to `all`;
- label and `drivers_json` are optional owner-shadow inputs;
- missing label/driver evidence is counted as `regime_payload_incomplete` data
  health and does not create values or infer ownership.

The current legacy importer still requires account, label, and `drivers_json`.
Its normalization, allowlist, and DML are not relaxed by this phase.

The factor shadow includes only identity, date, factor key, and health-presence
evidence. It omits factor value, driver/derived JSON, descriptions, source URL,
provider metadata, and all valuation fields.

## Market Regime Owner Rules

Each unique Base44 regime identity is planned independently under the explicit
migration owner:

- absent candidate produces `insert`;
- existing null owner produces `update`;
- exact same owner produces `skip`;
- foreign owner, duplicate identity, stored natural-key mismatch, or invalid
  account relation produces `block`.

`account=all` is a user-owned portfolio aggregate, not a shared global row. It
requires a null `account_id` and uses only the explicit owner context.

Named account rows require exactly one matching account. A null-owner account
is `compatible_planned` only when the same process has a fresh matching core
shadow proof. Same-owner parents are `compatible`; missing, foreign, ambiguous,
mismatched, or unproven parents block the row.

## Preserved Natural Duplicates

Base44 did not make `(date, account)` unique. Current varda-labs readers select
one display row with an explicit timestamp/legacy-identity tie-break, while the
database preserves all source identities.

Therefore a date/account duplicate group is not itself an owner conflict:

- unique legacy identities under the same explicit owner context are all
  planned and preserved;
- source and database duplicate group/row counts are reported as data health;
- no row is selected, merged, deleted, repaired, or made unique;
- if any row in the duplicate group has a foreign or ambiguous owner/identity
  contract, the complete group is blocked.

This policy is intentionally different from history snapshot natural keys,
whose schema and writer contract treat collisions as invalid.

## Global Factor Health Boundary

Global factors remain shared reference and always report owner actions `0`.
Their diagnostic separates:

- legacy status buckets: `ok`, `revised`, `preliminary`, `non_trading`,
  `missing`, `fetch_failed`, absent, and unknown;
- legacy `is_estimated`: true, false, absent, and unknown;
- current-export `is_preliminary`: true, false, absent, and unknown;
- source/database legacy identity duplicates;
- source/database `(factor_key, date)` duplicate groups;
- sample rows.

`is_preliminary` is not treated as a synonym for Base44 `status` or
`is_estimated`. A legacy identity duplicate blocks only the shared factor
diagnostic. Natural-key duplicates are preserved `needs_review` evidence and
do not block the regime owner plan. Future simulation/risk duplicate policy is
a separate calculation contract.

The current sanitized export has no `status` or `is_estimated` fields. Their
absence is reported explicitly instead of being synthesized from
`is_preliminary`.

## Fresh Core Proof

The command reads sanitized core source plus current core DB state and runs the
existing core canonical planner with the same explicit owner in the same
process. Named account proof is accepted only when that result is planned,
read-only, canonical-write disabled, side-effect free, and contains the exact
account code.

## Production Shadow Result

The 2026-07-11 production shadow used nine SELECT operations across market
context and fresh core state. It made no write.

| Evidence | Result |
| --- | ---: |
| Regime source/database candidates | 69 / 69 |
| Regime actions | update 69, insert/skip/block 0 |
| Named account references | compatible planned 69, block 0 |
| Regime identity ambiguity/mismatch | 0 |
| Date/account duplicates | source 3 groups/6 rows; DB 3 groups/6 rows |
| Incomplete regime payload | 0 |
| Fresh core proof | planned: accounts 4 |
| Canonical assignments | planned 69, written 0 |

The factor diagnostic read 2,401 source and 2,401 matching DB candidates:

- legacy identity duplicates: 0;
- factor/date duplicate groups: 0;
- legacy status absent: 2,401;
- legacy `is_estimated` absent: 2,401;
- current `is_preliminary=false`: 2,401;
- sample rows: 0;
- result: `needs_review`, owner actions 0.

The regime owner result remains `planned`. The command reports
`actualWriteAllowed=false`, `canonicalOwnerWriteEnabled=false`, and
`databaseSideEffects=false`.

## Output Boundary

Canonical output contains aggregate action/reference/health counts, safe reason
codes, and truncated SHA-256 fingerprints only. It excludes UUIDs, Base44 IDs,
DB row IDs, dates at row level, label/driver JSON, factor keys/values,
descriptions, source URLs, provider metadata, paths, raw SQL, DB URLs, and auth
material. Errors are reduced to stable safe codes.

## Fixture Gate

Tests cover:

- explicit canonical arguments and `--write` hard block;
- missing account normalized to `all`;
- optional regime label/driver evidence;
- parent-less `all` and named-account fresh core proof;
- same-owner, foreign, ambiguous, and unproven accounts;
- same-context natural duplicate preservation;
- complete duplicate-group blocking for foreign ownership;
- source/database identity ambiguity;
- distinct factor status, estimated, and current preliminary evidence;
- factor natural duplicate preservation and identity-duplicate isolation;
- identifier/value/provider non-disclosure;
- SELECT-only modules and canonical early return before legacy DML.

## Explicit Non-Actions

This phase does not:

- assign or backfill a canonical owner;
- write, repair, merge, delete, or deduplicate regimes or factors;
- add unique constraints, FK/NOT NULL, RLS, or reader filters;
- change the current market-context tie-break or `/market` presentation;
- reinterpret factor values for risk, recommendations, or simulation;
- change providers, admin jobs, Cron, KIS, FX, or daily snapshots;
- activate identity or the provisioning user.

Any actual owner assignment or mixed-writer activation requires a separate
approval after the remaining in-scope writer readiness work is reviewed.
