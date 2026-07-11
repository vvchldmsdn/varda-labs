# Auth/Tenant Phase 1E-B: Settings Writer Canonical Shadow

## Scope

Phase 1E-B prepares only `scripts/import-base44-settings.mjs` for canonical
owner planning. It reuses the migration CLI shadow context introduced for the
core import, but it does not enable canonical owner DML.

This phase does not define `settings` as a canonical-owner singleton. It only
validates the ownership plan for one exact sanitized Base44 candidate.

## Arguments

The canonical shadow path requires:

- `--canonical-owner-id <reviewed-uuid>`;
- `--approve-provisioning-owner` while the reviewed app user is provisioning;
- direct `node --no-warnings` execution so npm does not echo the UUID.

There is no canonical owner env/default fallback. `--canonical-owner-id` with
`--write` fails during argument parsing. The existing legacy dry-run and
`--write` contract remains separate.

## Candidate Rules

The planner reads the sanitized export and all current `settings` rows without
writing. It permits a plan only when:

1. the source contains exactly one candidate;
2. the database contains zero or one candidate;
3. an existing database candidate has the same `legacy_base44_id` as the
   source candidate;
4. the explicitly supplied canonical app user is valid for the migration CLI
   context;
5. the existing canonical owner is null or already matches.

It never picks the latest row, merges rows, repairs identity, or infers an owner
from assets, accounts, legacy owner strings, or current table cardinality.

The ownership actions are:

- missing database candidate: `insert` plan;
- existing candidate with null owner: `update` plan;
- existing candidate with the same owner: `skip`;
- foreign owner, duplicate candidates, or identity mismatch: `block`.

## Output Safety

Canonical shadow output contains aggregate candidate counts, a sanitized
reason, and SHA-256 fingerprints. It does not contain:

- canonical owner UUID;
- Base44/legacy row ID;
- database row ID;
- migration data path;
- setting values;
- blocked sensitive key names or values.

Both the state loader and canonical path are read-only. The existing settings
upsert contains no `canonical_owner_user_id` assignment.

The writer-readiness test also scans every registered DML implementation and
fails if any raw SQL or Drizzle insert/update assigns a canonical owner. This
keeps partial activation disabled while additional writers are prepared.

## Verified State

Production shadow verification observed:

- source candidates: 1;
- database candidates: 1;
- planned action: update 1;
- skipped/inserted/blocked: 0;
- reason: `canonical_owner_missing`;
- `actualWriteAllowed=false`;
- `canonicalOwnerWriteEnabled=false`;
- `databaseSideEffects=false`.

The core shadow regression remained 23 planned assignments with zero blocks.
After both runs, the tenant audit remained:

- phase: `provisioned_empty_owner`;
- app users: 1 provisioning/user;
- auth identities: 0;
- canonical owner non-null rows: 0;
- user-owned rows: 757.

## Still Forbidden

- settings or core canonical owner writes;
- partial writer activation;
- owner backfill or repair;
- identity link or app-user activation;
- owner-scoped singleton constraints;
- reader filtering, FK, NOT NULL, unique changes, or RLS;
- user-facing auth, snapshot, Cron, or machine-job changes.

No canonical write can be activated until all user-owned writers are shadow
ready or the remaining writers are covered by an approved global freeze.
