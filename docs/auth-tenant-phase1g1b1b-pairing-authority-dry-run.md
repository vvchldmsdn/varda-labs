# Auth/Tenant Phase 1G1-B1b: Pairing Authority Dry-Run

Last updated: 2026-07-25

Status: implemented as a pure synthetic dry-run contract. The separate B2
phase now defines its local-only physical persistence shape, but this contract
still has no runtime, provider, route, or identity-write integration.

## Purpose

Preview Google sign-in now proves only that a verified server session can
exist. It must not automatically claim the existing provisioning portfolio
user. This phase adds the missing authority checks before any future identity
link:

1. an independently authenticated operator explicitly reviews one target;
2. a future trusted producer represents the operator and signed-in subject in
   the same canonical principal-binding namespace, and the two values differ;
3. a target- and subject-bound pairing intent is pending and no more than ten
   minutes old;
4. the challenge is carried only by a secure HTTP-only SameSite cookie;
5. a future server-only producer runs the existing G1-A identity-link planner
   and provides a verified commitment bound to its policy, provider, subject
   binding, target, and result.

The signed-in subject session, Basic Auth, a machine secret, a singleton
`app_users` row, email, account scope, or request-provided owner cannot approve
the pairing.

This phase does not implement either trusted producer. Its fixtures validate
the required port shape, canonical-principal inequality, and exact commitment
equality only. The current G1-A planner itself still returns only its
outcome/reason/mutation flags and does not create a commitment.

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

This phase does not add a repository, operator login, session adapter, route,
UI, writer, identity row, app-user activation, TenantContext, owner filtering,
RLS, product DB access, or Basic Auth removal. The B2 schema and generated
migration remain unapplied until separately reviewed.

The next gate is not an identity write. It is review and application of the B2
empty schema migration. A repository and the atomic consume transaction remain
later, separate gates.
