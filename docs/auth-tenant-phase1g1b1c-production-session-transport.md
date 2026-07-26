# Auth/Tenant Phase 1G1-B1c: Production Session Transport

Last updated: 2026-07-25

Status: implemented, merged, deployed to Production, and verified by the
interactive session/sign-out smoke. Product identity and database authority
remain disconnected.

## Decision

The first legacy-user bootstrap will use the Production Neon Auth subject, not
the subject copied from a Preview branch. Preview Auth is disabled because the
current integration does not provide an isolated target. Production product
data remains outside this transport.

This phase moves the already verified Google session transport to Vercel
Production. It does not link an identity or read product data.

## Interim Access Boundary

The temporary dashboard Basic Auth remains in place.

- `/auth/sign-in` and `/api/auth/*` pass through Basic Auth before Google
  sign-in or sign-out can start.
- `/auth/callback` is the only Basic Auth exception. It exchanges the OAuth
  verifier and immediately redirects to `/auth/session`.
- `/auth/session` remains behind Basic Auth and projects presence
  classifications only.
- The auth route allows only Google redirect sign-in with server-fixed callback
  fields and current-session sign-out. Token sign-in, explicit sign-up flags,
  custom scopes, custom callback URLs, and unknown fields are rejected before
  the managed handler runs.
- Dashboard `Authorization` and `Proxy-Authorization` credentials are removed
  before every managed sign-in, sign-out, and callback exchange request. Neon
  Auth cookies, the verifier URL, origin evidence, and reviewed JSON remain.

This prevents open self-service onboarding while the product still lacks
owner-filtered reads, two-user isolation, and RLS. An authenticated but
unlinked Neon Auth user receives no portfolio authority.

The first reviewed Production Google login may create a provider-managed Neon
Auth user and session. That enrollment is available only behind the temporary
Basic Auth boundary and does not create an `app_users` row, link an identity,
or grant product authority.

## Environment Boundary

The runtime is enabled only for `VERCEL_ENV=production`. Preview remains
disabled because an operational fingerprint comparison on 2026-07-25 found
that the current Vercel Preview and Production integrations resolve to the
same Neon Auth target. No target values or fingerprints were printed.

Every enabled environment must provide:

- an HTTPS-shaped `NEON_AUTH_BASE_URL`;
- a reviewed `NEON_AUTH_BASE_URL_SHA256` that exactly matches the canonical
  server URL;
- a server-only `NEON_AUTH_COOKIE_SECRET` of at least 32 characters.

Missing or malformed configuration fails closed without reflecting values.
Production deployment must not proceed until the Production secret and
endpoint fingerprint are configured. Preview Auth must remain disabled until a
future isolated target is independently verified.

## Still Closed

This phase does not add or change:

- `app_users`, `auth_identities`, ownership columns, or financial rows;
- pairing-intent schema, identity writes, app-user activation, or backfill;
- `TenantContext`, owner-filtered queries, RLS, or Basic Auth removal;
- ordinary product-user provisioning, public product registration, or
  `app_users` auto-creation;
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
4. `/auth/callback` exchanges the verifier and redirects to the Basic
   Auth-protected `/auth/session`;
5. `/auth/session` reports authenticated presence without identifiers;
6. portfolio link and product database read remain `Not attempted`;
7. sign-out removes authenticated presence;
8. protected product pages retain the existing Basic Auth behavior.

## Next Gate

After Production session transport is proven, the next unit is a durable,
short-lived, single-use bootstrap intent. The Production subject creates the
intent server-side, and one explicit manual operation consumes it for the
already reviewed provisioning user. Intent consumption, identity insertion,
and any activation remain separate reviewed writes.
