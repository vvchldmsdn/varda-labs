# Auth/Tenant Phase 1G1-B1a: Preview Session Transport

Last updated: 2026-07-25

Status: Preview-only Google session transport is implemented and interactively
verified. Product identity resolution, tenant access, and production auth remain
closed.

## Scope

This phase proves one narrow transport path:

1. a user starts Google sign-in from the reviewed Preview branch;
2. Neon Auth completes the managed OAuth exchange;
3. the `/auth/session` server component observes only whether a verified server
   session and user identifier are present;
4. the user signs out and the session is no longer present.

It does not link the provider identity to `app_users`, read product data, choose
a tenant, activate a user, or replace the production Basic Auth boundary.

## B0 To B1a Transition

`docs/auth-tenant-phase1g1b0-preview-auth-readiness.md` is immutable,
date-scoped evidence of the repository before an auth runtime existed. Its
command now fails with the expected transition findings:

- `auth_sdk_installed_during_b0`;
- `auth_route_added_during_b0`;
- `auth_runtime_import_added_during_b0`.

Those findings do not describe a current runtime regression. The current
transport audit is:

```bash
npm run audit:preview-auth-runtime
```

The B0 audit remains useful only through its frozen fixture test. It must not be
rewritten to make the historical audit pass against the B1a repository.

## Runtime Boundary

The auth runtime is enabled only when both conditions hold:

- `VERCEL_ENV` is `preview`;
- `VERCEL_GIT_COMMIT_REF` is
  `codex/preview-auth-transport-convergence`.

Missing or invalid server configuration fails closed. Production and every
other Preview branch return 404 for the auth transport. Secrets stay
server-only and are never rendered, logged, or included in public environment
variables.

The local `/api/auth/[...path]` proxy accepts only:

| Method | Path | Additional restriction |
| --- | --- | --- |
| `GET` | `/api/auth/get-session` | session evidence only |
| `POST` | `/api/auth/sign-in/social` | provider must be `google` |
| `POST` | `/api/auth/sign-out` | current session only |

All other methods, auth paths, and social providers are rejected before the
Neon Auth handler runs. The OAuth provider callback itself is managed by Neon
Auth. The app's `/auth/session` proxy branch only exchanges the returned
short-lived verifier for the local HTTP-only session cookie.

## Verification Evidence

Automated evidence on 2026-07-25:

- `npm run audit:preview-auth-runtime` passes;
- the runtime graph contains no product database imports;
- the managed `neon_auth` schema is not owned by Drizzle;
- the production Basic Auth boundary remains intact;
- the reviewed API allowlist contains exactly three method/path entries;
- the social sign-in entry is restricted to Google.

Interactive evidence on 2026-07-25:

- Google sign-in completed on the reviewed Preview deployment;
- `/auth/session` displayed `Authenticated session: Present`;
- no email, name, image, provider subject, token, or product identifier was
  exposed;
- sign-out completed and the authenticated session was no longer present.

Only the pass/fail classifications above are retained. No cookie, token,
provider subject, authorization header, environment value, or user identifier
is recorded here.

## Still Closed

This phase does not authorize:

- identity pairing or an `auth_identities` write;
- changing the provisioning `app_users` row to active;
- tenant resolution, owner filtering, RLS, or product database reads;
- self-service registration policy or non-Google providers;
- production Neon Auth, removal of Basic Auth, or broader route protection;
- operator target selection, pairing intents, API/UI mutations, jobs, or Cron.

## Next Gate

After this transport-only branch is reviewed and merged, the next auth work must
remain server-side and separately reviewed: an authenticated operator target,
an explicit reviewed app-user selection, and a short-lived single-use pairing
intent. No identity write may occur until that authority path is approved.
