# Auth/Tenant Phase 1F0: Runtime Writer Freeze and Context Convergence

Last updated: 2026-08-03

Status: the compatibility entity APIs remain frozen. The daily snapshot writer
now has an owner-enumerated machine-job implementation under review. Its schema
migration, legacy generated-row owner backfill, Production deployment, and Cron
activation are not applied by this change.

## 2026-08-03 Implementation Update

The daily snapshot route no longer needs or accepts a caller-selected owner.
`src/lib/snapshots/daily-job.ts` enumerates active owners from the canonical
`app_users -> accounts` relationship, then invokes one isolated snapshot run per
owner. The inner writer reads assets, groups, and events only through those
owned accounts and writes the same canonical owner onto generated position and
portfolio rows.

This is deliberately different from the interactive entity APIs. Those APIs
still require a trusted session repository before they may write user-owned
rows and remain frozen.

## Scope

Phase 1E prepared the import writers as canonical-owner shadows. The remaining
runtime writers have different trust boundaries and cannot share one owner
fallback:

- the completed two-row legacy asset cleanup is destructive migration CLI;
- four entity compatibility APIs are machine-admin HTTP endpoints;
- the daily snapshot route is a machine-admin job that currently receives only
  date and account-within-user inputs.

`account=brokerage|isa|irp|all` is not a tenant selector. An admin secret proves
job authorization but does not identify the user for whom a write is made.

## Machine-Readable Freeze Matrix

`src/lib/runtime-writer-convergence.ts` defines six writer rows across three
writer kinds. Every row records:

- current authorization;
- the only future canonical-owner source;
- activation status;
- freeze condition;
- unblock prerequisite;
- production boundary paths;
- explicit prohibitions on canonical-owner DML, singleton-user fallback, and
  legacy-owner inference.

The current decisions are:

| Writer kind | Current authorization | Canonical owner source | Status |
| --- | --- | --- | --- |
| Legacy nonportfolio cleanup | migration CLI | not applicable | Approved two-row cleanup is closed; future invocation frozen |
| Four entity compatibility APIs | machine admin | future active server session | Frozen until active identity/session context and owner-aware repository exist |
| Daily snapshot | machine admin | active owner enumeration from canonical product DB relationships | Implemented for review; Production schema/backfill and Cron remain disabled |

The cleanup remains in the DML inventory because it still exists as source.
Its target table remains part of the product ownership model, but the legacy
cleanup writer itself is not a canonical shadow or an activation candidate.

## Pure Fixtures Only

The F0 policy can evaluate hypothetical contexts without being imported by a
route or writer:

- canonical owner keys in body, query, or headers are rejected;
- a valid admin secret without a tenant context cannot select an owner;
- entity CRUD requires a future active session context;
- daily snapshots require an active machine-job context plus a separately
  verified explicit user target.

An eligible fixture still returns `productionContextConnected=false`. This is
readiness evidence, not runtime activation.

## Future Snapshot Contract

The outer job may enumerate multiple active owners. Each inner snapshot run
operates for exactly one owner and may read only that owner's:

- assets;
- accounts;
- asset groups and memberships;
- event ledger entries.
- owner-scoped market regime rows when available.

It may write that owner's daily position and portfolio snapshots for
`brokerage`, `isa`, and `irp`, then derive the same owner's `all` aggregate.
`all` never identifies an owner. Any null or different owner in the observed
read set fails the pure fixture.

## Static Audit

Run:

```bash
npm run audit:runtime-writer-convergence
```

The audit reads source files only. It does not load environment variables,
connect to Postgres, call providers, invoke routes, or execute a writer. It
fails on:

- a missing or unregistered F0 writer;
- authorization drift between the freeze matrix and writer registry;
- canonical-owner references or DML outside the exact active snapshot boundary;
- app-user singleton fallback;
- legacy-owner-to-canonical-owner inference;
- production import of the F0 pure policy;
- loss of the approved cleanup target/reference/write guards.

## Explicit Non-Actions

This implementation does not:

- execute or expand cleanup;
- change entity API request shapes, responses, Basic Auth, or admin-secret
  behavior;
- enable Vercel Cron or change provider write behavior;
- link an identity or activate the provisioning user;
- execute the generated-row owner backfill, apply its schema migration, add
  RLS, or infer an owner from legacy identity fields.

## Next Approval Boundary

The next operational boundary is one reviewed bundle: apply the inspected
expand migration with owner checks initially `NOT VALID`, run the deterministic
84-row generated-snapshot owner backfill and validate both checks in the same
transaction, deploy, and run read-only preflight smoke. Cron activation remains
a separate later decision.

The provider-neutral resolver prerequisite is now executable, without any
production integration, in
`docs/auth-tenant-phase1g0-session-resolver-contract.md`.
