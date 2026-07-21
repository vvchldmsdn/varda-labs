# Auth/Tenant Phase 1G1-B1a: Preview Session Transport Close-Out

Recorded: 2026-07-22

Status: `successful_preview_only_session_transport_smoke`

This record closes only the branch-bound Preview Neon Auth session transport
smoke. It proves that a managed Google OAuth session can complete its browser
and server round trip on the reviewed Preview deployment. It does not establish
a product user, tenant, owner, identity link, activation, authorization policy,
or production authentication readiness.

## Pinned Artifacts

```text
initial Preview-only smoke:
cfdef27a9d57ca6fc3e77d167c91207e6fc2232a

boundary hardening:
0c274f64347a6c555ceab21ed88b3ef5130a1b89

OAuth verifier exchange fix and verified HEAD:
618f22fe2e064048b1982d7c98ccfadf961c2343

deployment branch:
codex/neon-auth-preview-smoke-20260721

verified Preview deployment:
dpl_CYK5GxFT7DW7vAtVzxseSXm9bgWA
```

The runtime is enabled only when both conditions are true:

```text
VERCEL_ENV = preview
VERCEL_GIT_COMMIT_REF = codex/neon-auth-preview-smoke-20260721
```

Other Preview branches and Production remain outside this runtime gate.

## Completed Transport Path

The verified path was:

```text
unauthenticated
-> Google OAuth sign-in
-> Preview callback URL with Neon Auth session verifier
-> Next.js 16 Proxy verifier exchange
-> server getSession() reports an authenticated session
-> sign out
-> unauthenticated
```

The initial interactive attempt returned to `/auth/session` without a server
session because the route handler existed but the SDK middleware that exchanges
the OAuth verifier for session cookies was missing. Commit `618f22f` added a
dedicated `/auth/session` Proxy branch that invokes the managed Neon Auth
middleware before the existing product Basic Auth path.

The callback branch is deliberately narrow. It does not make `/auth/sign-in`,
`/api/auth/*`, or any product route part of the product Basic Auth matcher, and
it does not use Proxy as a product authorization source.

## Verification Evidence

The following checks completed against verified HEAD `618f22f`:

| Check | Result |
| --- | --- |
| Preview runtime boundary audit | passed |
| Auth runtime graph files inspected | 8 |
| Product database boundary files | 0 |
| Public auth environment references | 0 |
| Exact Preview git-ref gate | present |
| Existing product Basic Auth boundary | intact |
| Managed Neon Auth session I/O | expected |
| Full test suite | `1016/1016` passed |
| `npm run lint` | passed |
| `npm run build` | passed |
| Preview deployment | Ready |
| Interactive authenticated session | Present |
| Interactive sign-out | returned to unauthenticated state |
| Current Production `/auth/session` | `404` |

No environment value, cookie value, authorization header, provider subject,
email address, display name, token, secret, or database credential was recorded
as close-out evidence.

## Preserved Boundaries

This smoke permits managed Neon Auth session I/O only. The recursive runtime
audit found no product database or DAL dependency in the smoke graph.

The completed work did not:

- read or write `app_users` or `auth_identities`;
- derive or expose a provider subject for product use;
- select an existing app user or infer one from singleton cardinality;
- create a pairing intent or reviewed operator handoff;
- change `app_users.status` from `provisioning` to `active`;
- create or resolve `TenantContext`;
- add owner-scoped product reads or writes;
- change RLS, schema, migration, seed, import, backfill, job, or Cron behavior;
- remove or weaken the existing product Basic Auth boundary; or
- merge the Preview smoke branch into the production branch or deploy its Auth
  runtime to Production.

`session present` is transport evidence. It is not `tenant resolved` evidence.

## Relationship To B0

`docs/auth-tenant-phase1g1b0-preview-auth-readiness.md` remains an immutable
date-scoped record of the 2026-07-11 pre-runtime state. Its statements that the
SDK and auth routes were absent do not describe this later Preview smoke branch.
This close-out does not rewrite that historical evidence.

The B0 operator-handoff blocker, product identity boundary, Beta production
hold, and prohibition on using Basic Auth or a machine secret as tenant identity
remain in force.

## Next Boundary

Auth expansion remains blocked until a separately reviewed prerequisite can
provide all of the following without accepting a product-user UUID or provider
subject from the browser:

1. an independently authenticated operator;
2. explicit server-side selection of the intended provisioning app user; and
3. a short-lived, single-use, server-side pairing intent.

Even after that prerequisite exists, an `auth_identities` insert and a
`provisioning -> active` transition remain separate approval gates.

Until those gates are intentionally opened, auth work stops at this close-out.
The service migration should continue through a non-auth product slice.
