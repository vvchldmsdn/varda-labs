# Auth/Tenant Phase 1G1-B1b: Pairing Authority Dry-Run

Last updated: 2026-07-25

Status: implemented as a pure synthetic dry-run contract. It has no runtime,
database, provider, route, or identity-write integration.

## Purpose

Preview Google sign-in now proves only that a verified server session can
exist. It must not automatically claim the existing provisioning portfolio
user. This phase adds the missing authority checks before any future identity
link:

1. an independently authenticated operator explicitly reviews one target and
   is represented by a server-created, domain-separated opaque binding;
2. the signed-in subject is represented only by a server-created HMAC binding;
3. a target- and subject-bound pairing intent is pending and no more than ten
   minutes old;
4. the challenge is carried only by a secure HTTP-only SameSite cookie;
5. the existing G1-A identity-link planner independently reports
   `planned_link` with a server-created commitment bound to its policy,
   provider, subject binding, and target.

The signed-in subject session, Basic Auth, a machine secret, a singleton
`app_users` row, email, account scope, or request-provided owner cannot approve
the pairing.

## Single-Use Boundary

The future intent must be a durable server record with one lifecycle:

`pending -> consumed | revoked | expired`

This pure phase does not create or mutate that record. A consumed, revoked,
expired, not-yet-valid, overlong, mismatched, or malformed intent is blocked.
The intent carries the exact operator binding and G1-A plan commitment; neither
can be substituted by another otherwise-valid operator session or
`planned_link` result.
Actual intent consumption and identity insertion must eventually occur in one
reviewed transaction, but neither operation is implemented here.

## Result Boundary

The only success is `synthetic_dry_run_ready`. Every result keeps:

- `runtimeTrustStatus=not_established`;
- `identityDmlEnabled=false`;
- `intentConsumptionEnabled=false`;
- `appUserMutation=none`.

Public projection contains only outcome and a typed reason. It never contains
an app-user UUID, intent id, provider, subject binding, email, token, cookie, or
operator identifier.

## Verification

Run:

```bash
npm run audit:identity-pairing-authority
```

The audit proves the contract is disconnected from production imports, DB
queries and writes, provider calls, routes, subject CLI/env inputs, intent
writes, and app-user status changes. It also checks that the current Basic Auth
boundary remains present.

## Still Closed

This phase does not add a pairing table, schema, migration, repository, operator
login, session adapter, route, UI, writer, identity row, app-user activation,
TenantContext, owner filtering, RLS, product DB access, Production Neon Auth,
or Basic Auth removal.

The next gate is not an identity write. It is a separate review of the minimum
durable intent schema and transaction semantics needed to make the currently
synthetic single-use guarantee real.
