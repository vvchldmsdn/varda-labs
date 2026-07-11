# Auth/Tenant Phase 1G1-A: Reviewed Initial Identity-Link Planner

Last updated: 2026-07-11

Status: completed as a pure, fixture-only planner. No provider session, database,
identity write, app-user transition, or production import exists.

## Scope

Phase 1G1-A defines when a future initial identity link could be planned. It does
not obtain a real provider subject and cannot create a link.

The planner requires two separate trusted ports:

- a `VerifiedProviderSubjectPort` produced later from a server-verified session;
- a `ReviewedAppUserTargetPort` containing one explicitly reviewed target.

Provider names are trimmed and lowercased. Subjects are trimmed but preserve
case and remain opaque. Missing or unverified values are discarded without
retaining the supplied string.

## Target Contract

The only eligible target is exactly one explicitly reviewed app user with:

- status `provisioning`;
- role `user`;
- a valid canonical UUID;
- review source `explicit_review`.

The planner cannot select a target by singleton `app_users` cardinality, email,
Basic Auth username, account scope, legacy owner evidence, request owner value,
or machine secret.

## Plan Outcomes

The planner returns only:

- `planned_link` when no identity conflict exists;
- `already_linked` for exactly the same active provider/subject/app-user link;
- `blocked` with a typed non-sensitive reason.

Every outcome includes `appUserMutation=none` and
`identityDmlEnabled=false`. Results and public projections contain no UUID,
provider subject, email, fingerprint, token, cookie, or profile data.

Collision rules match the expanded schema:

- the same provider/subject linked to a different app user is blocked;
- a different active subject already linked to the target for that provider is
  blocked;
- duplicate or malformed identity evidence is blocked;
- an exact disabled link is blocked rather than silently reactivated;
- subject comparison remains case-sensitive.

## Provider Subject Transport

The only allowed transport is a future verified server-session port. Actual
subjects are forbidden in:

- CLI arguments;
- environment variables;
- URLs;
- request bodies or headers;
- logs.

The current audit command accepts no provider or subject argument and emits
aggregate static evidence only.

## Resolver Cross-Check

Even a synthetic active identity mapping does not activate the current app
user. Because the target remains `provisioning`, the Phase 1G0 resolver still
returns `403 app_user_not_active`.

## Static Audit

Run:

```bash
npm run audit:initial-identity-link-planner
```

The audit checks both pure contracts and all production source/registered
writer paths for:

- production imports;
- identity DML;
- SDK, DB, provider, route, cookie, env, or cache integration;
- provider-subject CLI/env entrypoints;
- Basic Auth proxy drift;
- app-user status changes.

## Explicit Non-Actions

Phase 1G1-A does not:

- insert, update, or delete `auth_identities`;
- activate or otherwise update `app_users`;
- install an auth SDK or add handler, UI, cookie, env, or session code;
- change Basic Auth, proxy, DAL, writers, snapshots, Cron, schema, RLS, or data;
- accept or emit a real provider subject.

## Next Approval Boundary

The next optional phase is a preview-only, server-verified session adapter that
feeds a read-only planner. It must still perform no identity write. Creating one
identity row and changing `provisioning` to `active` remain two later, separate,
explicit approval gates.
