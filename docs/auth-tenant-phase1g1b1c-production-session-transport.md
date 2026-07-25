# Auth/Tenant Phase 1G1-B1c: Production Session Transport

Last updated: 2026-07-25

Status: implementation candidate. The code is not yet merged or deployed to
Production.

## Decision

The first legacy-user bootstrap will use the Production Neon Auth subject, not
the subject copied from a Preview branch. Preview and Production remain
separate Auth and database environments.

This phase generalizes the already verified Google session transport so the
same server-only adapter can run in either Vercel Preview or Production when
that environment has complete server configuration. It does not link an
identity or read product data.

## Interim Access Boundary

The temporary dashboard Basic Auth remains in place.

- `/auth/sign-in` and `/api/auth/*` pass through Basic Auth before Google
  sign-in or sign-out can start.
- `/auth/session` bypasses Basic Auth only so the OAuth verifier can be
  exchanged for the signed HTTP-only session cookie.
- The session page projects presence classifications only.
- The auth route allows only Google social sign-in and current-session
  sign-out.

This prevents open self-service onboarding while the product still lacks
owner-filtered reads, two-user isolation, and RLS. An authenticated but
unlinked Neon Auth user receives no portfolio authority.

## Environment Boundary

The runtime is enabled only for `VERCEL_ENV=preview` or
`VERCEL_ENV=production`. Every enabled environment must provide:

- an HTTPS-shaped `NEON_AUTH_BASE_URL`;
- a server-only `NEON_AUTH_COOKIE_SECRET` of at least 32 characters.

Missing or malformed configuration fails closed without reflecting values.
Preview and Production cookie secrets must be distinct. Production deployment
must not proceed until the Production secret is configured.

## Still Closed

This phase does not add or change:

- `app_users`, `auth_identities`, ownership columns, or financial rows;
- pairing-intent schema, identity writes, app-user activation, or backfill;
- `TenantContext`, owner-filtered queries, RLS, or Basic Auth removal;
- ordinary new-user provisioning or public registration;
- provider subject, email, token, cookie, or internal user identifiers in UI,
  logs, response payloads, CLI arguments, or environment output.

## Verification

Run:

```bash
npm run audit:auth-transport
npm run test
npm run lint
npm run build
```

After a separately reviewed Production deployment:

1. unauthenticated `/` remains `401`;
2. Basic Auth is required for `/auth/sign-in`;
3. Google sign-in completes on Production;
4. `/auth/session` reports authenticated presence without identifiers;
5. portfolio link and product database read remain `Not attempted`;
6. sign-out removes authenticated presence;
7. protected product pages retain the existing Basic Auth behavior.

## Next Gate

After Production session transport is proven, the next unit is a durable,
short-lived, single-use bootstrap intent. The Production subject creates the
intent server-side, and one explicit manual operation consumes it for the
already reviewed provisioning user. Intent consumption, identity insertion,
and any activation remain separate reviewed writes.
