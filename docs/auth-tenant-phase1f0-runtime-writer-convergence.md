# Auth/Tenant Phase 1F0: Runtime Writer Freeze and Context Convergence

Last updated: 2026-07-11

Status: completed as a static, non-mutating audit. No production writer imports
the F0 policy and no runtime authorization behavior changed.

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
| Daily snapshot | machine admin | future explicit verified machine-job user target | Frozen until one active user can be selected by trusted server context |

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

One snapshot run may operate for exactly one active owner. It may read only
that owner's:

- assets;
- accounts;
- asset groups and memberships;
- settings;
- event ledger entries.

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
- canonical-owner references or DML in the production paths;
- app-user singleton fallback;
- legacy-owner-to-canonical-owner inference;
- production import of the F0 pure policy;
- loss of the approved cleanup target/reference/write guards.

## Explicit Non-Actions

Phase 1F0 does not:

- execute or expand cleanup;
- change entity API request shapes, responses, Basic Auth, or admin-secret
  behavior;
- change daily snapshot, Cron, or provider code;
- link an identity or activate the provisioning user;
- assign/backfill canonical owners, filter readers, add RLS, or migrate schema.

## Next Approval Boundary

Runtime owner activation remains blocked. The next decision must choose between
keeping all user-owned runtime writers frozen or separately opening identity
link plus active server-side session context. Machine snapshot targeting needs
its own later approval even after interactive session identity exists.

The provider-neutral resolver prerequisite is now executable, without any
production integration, in
`docs/auth-tenant-phase1g0-session-resolver-contract.md`.
