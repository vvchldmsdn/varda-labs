# Auth/Tenant Phase 1G1-B0: Preview Auth Readiness

Last updated: 2026-07-11

Status: static audit complete. The B0 safety scope passes, but G1-B1 preview
integration readiness is blocked. Auth runtime remains frozen.

## Decision

Do not install the Neon Auth SDK or add auth routes yet. The repository can
preserve the required boundaries, but three operational prerequisites are not
ready:

- local and preview cookie-secret evidence is incomplete;
- preview versus production isolation is not verified;
- there is no trusted reviewed-operator channel that can select the existing
  provisioning app user without a singleton or transported UUID fallback.

The safe fallback is to retain Basic Auth and continue non-auth product
migration. This is a readiness conclusion, not a failed code audit.

## Date-Scoped Evidence

Evidence checked on 2026-07-11:

| Evidence | Result |
| --- | --- |
| Application | Next.js 16.2.10 |
| Neon Auth package metadata | `0.4.2-beta`; peer dependency `next >=16.0.0` |
| Neon Auth lifecycle | Official docs still label Neon Auth with Better Auth Beta |
| SDK dependency | Not installed |
| Auth handler/UI/session adapter | Absent |
| Basic Auth | Existing `src/proxy.ts` boundary intact |
| Managed schema | `neon_auth` is not owned by Drizzle schema or migrations |

The SDK is version-range compatible with this Next.js version, but compatibility
does not clear the Beta production hold or the missing operational gates.

## Environment Evidence

Only classifications are recorded. No environment value, length, token, URL,
cookie secret, authorization header, provider subject, or database credential is
emitted.

| Environment | Base URL | Cookie secret | Runtime decision |
| --- | --- | --- | --- |
| Local | Present and HTTPS-shaped | Missing | Not ready |
| Preview | Unverified | Unverified | Not enabled |
| Production | Unverified | Unverified | Must remain disabled |

`VITE_NEON_AUTH_URL` exists locally but belongs to the previous browser-oriented
integration and is not used by the planned server SDK boundary. No
`NEXT_PUBLIC_*AUTH*` reference exists in production source.

The linked Vercel CLI returned no environment-variable rows for either the
environment-specific or aggregate listing. That does not prove variables are
absent because integration-managed values or project-link state can differ from
the CLI view. Preview and production therefore remain `unverified`, not
`missing`.

## Request Topology

A future, separately approved preview integration must keep these boundaries:

| Route class | Responsibility | Product DB access |
| --- | --- | --- |
| `/api/auth/[...path]` | Neon Auth handler and OAuth callback only | No |
| `/auth/[path]` | Preview sign-in UI only | No |
| Product routes | Basic Auth outer gate, then secure DAL authorization | Yes, owner-scoped later |
| Admin/Cron routes | Existing machine-secret authorization | Yes, never tenant-selected by the secret |

Next.js 16 supports one `proxy.ts`. A future G1-B1 cannot replace the current
proxy wholesale with the quickstart example. It must compose any preview-only
optimistic auth behavior with the existing Basic Auth boundary. Secure identity
resolution still belongs near the DAL; Proxy is not the authorization source.

`/api/auth/*` must remain outside portfolio imports and cannot read or write
`app_users`, `auth_identities`, ownership columns, snapshots, settings, or other
product data.

## Pairing Handoff Blocker

The provider subject can only come from a server-verified provider session. It
cannot be accepted from CLI arguments, environment variables, URL parameters,
request bodies, request headers, logs, Basic Auth, or a machine secret.

The target app user also lacks a safe handoff channel today:

- selecting the only provisioning row is a forbidden singleton fallback;
- Basic Auth is a shared outer gate, not an operator identity;
- a machine secret may authorize a job but cannot choose a tenant;
- email, account scope, legacy owner evidence, and request values are not
  canonical target selectors;
- putting the app-user UUID in a URL, body, header, environment variable, or log
  would violate the existing reviewed-target contract.

A future design would need an independently authenticated operator, explicit
server-side target selection, and a short-lived single-use server-side pairing
intent. Any browser-visible handle would have to be opaque and bound to that
review, while the target UUID and provider subject remain server-side. No such
operator or pairing-intent implementation exists or is authorized in B0.

## Session And Rollback Policy

- Neon Auth database sessions remain the future authority.
- A signed HTTP-only session-data cookie may only be a short cache. The current
  design target remains 60 seconds, below the SDK default of 300 seconds.
- Internal `app_users.status` must be checked at the secure data boundary so a
  disabled app user is denied independently of cached provider session data.
- Revocation, other-device revocation, outage behavior, and cache-expiry tests
  remain required before production use.
- Because B0 adds no runtime, rollback is already satisfied: current production
  Basic Auth and all product routes are unchanged.

## Static Audit

Run:

```bash
npm run audit:preview-auth-readiness
```

The command exits successfully when the frozen B0 scope is intact. Its separate
`previewReadiness` field remains `blocked` until all prerequisites are explicit.
It emits only aggregate counts and classifications.

## Explicit Non-Actions

Phase 1G1-B0 does not:

- install `@neondatabase/auth`;
- add auth handler, callback, sign-in UI, cookie configuration, or session code;
- read or write `auth_identities` or change `app_users.status`;
- change proxy, Basic Auth, DAL, readers, writers, RLS, schema, snapshots, or
  Cron;
- accept or emit a real provider subject or app-user UUID;
- authorize G1-B1, G1-B2, identity INSERT, or activation.

## Next Boundary

G1-B1 is not ready for approval. Auth work should remain frozen until a trusted
operator handoff and verifiable preview/production environment isolation are
designed. The next implementation slice should return to the approved non-auth
product scope.
