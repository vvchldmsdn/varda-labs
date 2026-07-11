# Auth/Tenant Phase 1A: Identity And Session Strategy ADR

Last updated: 2026-07-11

Status: accepted pre-production planning decision with a production-readiness
hold. The current official Neon Auth quickstart labels the product Beta. This
ADR does not authorize installing an auth SDK, enabling a login route, changing
`src/proxy.ts`, creating public schema tables, applying an owner migration,
backfilling data, changing product queries or writers, enabling RLS, removing
Basic Auth, or exposing user-facing writes.

## Decision

varda-labs will use:

| Concern | Decision |
| --- | --- |
| Auth platform | Neon Auth for development/preview integration; production cutover is conditional |
| Initial social method | Google only |
| Session authority | Neon Auth database session in the managed `neon_auth` schema |
| Session acceleration | Signed HTTP-only session-data cache cookie, 60-second target TTL |
| Product user identity | `public.app_users.id uuid` |
| Auth-to-product mapping | `public.auth_identities(provider, provider_subject) -> app_users.id` |
| Mapping provider value | `neon_auth` |
| Mapping subject value | Stable Neon Auth user id, never email |
| v1 tenant shape | One individual app user is one tenant |
| Organizations/households | Not supported in v1 |
| Registration during migration | Closed; explicit provisioning/linking only |
| Basic Auth | Temporary outer deployment gate, never product identity |
| Admin/Cron auth | Remains separate from user sessions |

The product target is multi-user individual ownership. The migration remains a
single-initial-owner deployment until owner-filtered reads/writes, two-user
isolation, and auth production readiness are proven. A second real user must
not be enabled before those gates.

## Why Neon Auth

The decision was made against the actual varda-labs stack and current official
documentation, not by copying the Base44 auth model.

| Candidate | Fit | Decision |
| --- | --- | --- |
| Neon Auth | Already provisioned in the current Neon project; Better Auth-based database sessions; dedicated branchable auth schema; first-party Next.js SDK; Vercel/Neon preview alignment. Current official docs still label it Beta. | Selected for development/preview; production hold |
| Self-hosted Better Auth | Flexible and database-backed, but varda-labs would own auth server operation, schema lifecycle, and upgrades already provided by Neon Auth | Rejected for v1 |
| Auth.js with Drizzle | Flexible provider and schema adapters, but adds app-owned auth/session/account tables and maintenance; Auth.js is now part of Better Auth | Rejected for v1 |
| Clerk | Strong managed Next.js integration, but puts the auth control plane outside the existing Neon ownership/branching model and adds a second platform mapping/sync boundary | Rejected for v1 |
| Supabase Auth | Mature auth and RLS ecosystem, but creates an unnecessary split-platform boundary while Postgres is already on Neon | Rejected for v1 |

Current read-only evidence:

- the database already contains the `neon_auth` schema;
- it contains nine managed tables: `user`, `session`, `account`, `verification`,
  `jwks`, `project_config`, `organization`, `member`, and `invitation`;
- current auth user, session, and account counts are all zero;
- `.env.local` has `NEON_AUTH_BASE_URL` and the integration-provided Vite auth
  URL, but no `NEON_AUTH_COOKIE_SECRET`;
- `@neondatabase/auth` is not currently installed;
- no auth handler, sign-in UI, or Neon Auth session resolver exists in the app.

Table presence does not authorize using the organization plugin. The v1 product
model deliberately ignores Neon Auth organization/member identity.

### Production hold and fallback

Neon Auth must not replace Basic Auth or protect real multi-user financial data
until a separate review confirms one of these outcomes:

1. Neon Auth is no longer Beta and its current production support/operational
   terms are acceptable; or
2. the user explicitly accepts the remaining Beta risk after session,
   recovery, outage, export, and rollback tests pass.

If that gate fails, use Clerk or self-hosted Better Auth without changing
portfolio owner UUIDs. The provider-neutral `auth_identities` boundary makes
this possible: add a new provider namespace and mapping instead of rewriting
user-owned financial rows. No FK may point from product ownership directly to
`neon_auth.user`.

## Official References

- [Next.js authentication guide](https://nextjs.org/docs/app/guides/authentication)
- [Next.js data security guide](https://nextjs.org/docs/app/guides/data-security)
- [Neon Auth overview](https://neon.com/docs/auth/overview)
- [Neon Auth Next.js Server SDK](https://neon.com/docs/auth/reference/nextjs-server)
- [Neon Auth Next.js quickstart](https://neon.com/docs/auth/quick-start/nextjs)
- [Better Auth session management](https://better-auth.com/docs/concepts/session-management)
- [Auth.js session strategy comparison](https://authjs.dev/concepts/session-strategies)
- [Clerk Next.js server/proxy reference](https://clerk.com/docs/reference/nextjs/clerk-middleware)

The Next.js guidance requires authorization near the data source through a
server-side data access layer. Proxy is useful as an optimistic/outer check but
must not be the only protection. Server Actions and Route Handlers remain
publicly reachable server entry points and must authorize independently.

## Session Strategy

### Authoritative state

The authoritative session is the Neon Auth database session. varda-labs will
not issue its own application JWT and will not create a public
`auth_sessions` table.

Why database sessions:

- server-side session revocation and device/session listing are required for a
  finance application;
- Neon Auth already manages database session rows and exposes session revoke
  methods;
- the database and auth endpoint branch with Neon preview environments;
- there is no need to duplicate provider account/token material in public
  product tables.

### Cookie cache

Neon Auth's Next.js SDK caches session data in a signed HTTP-only cookie and
uses a 300-second default. The implementation target is a 60-second
`cookies.sessionDataTtl`, subject to SDK integration verification.

This is a performance cache, not the source of product authorization.

- revoked provider sessions can remain represented in another device's cache
  until the cache expires;
- every protected product read still resolves and checks the internal
  `app_users` row;
- an inactive internal user is denied immediately even if provider session
  cache is still valid;
- future sensitive mutations must either disable the cookie cache for that
  operation or perform a fresh-session check if the SDK supports it;
- no user-facing mutations are enabled in this ADR phase.

### Revocation and lifecycle

| Event | Product result |
| --- | --- |
| Normal sign-out | Neon Auth session and local auth cookies are cleared |
| Revoke one device | Revoke the selected Neon Auth session; cached access may last no longer than the configured cache TTL |
| Revoke other devices | Use Neon Auth `revokeOtherSessions()` |
| Internal user disabled | `getCurrentAppUser()` denies immediately regardless of session cache |
| Neon Auth user deleted | Financial rows remain owned by `app_users`; access is denied until an approved identity is linked |
| Provider unavailable with no valid cached session | Fail closed as auth unavailable; never fall back to the initial owner |

## Canonical Identity Flow

```text
Google sign-in
  -> Neon Auth session
  -> Neon Auth user id
  -> public.auth_identities(provider = 'neon_auth', provider_subject)
  -> public.app_users.id
  -> TenantContext { ownerUserId }
  -> owner-filtered product query or command
```

The application maps the Neon Auth user id, not the Google subject, Google
email, or a Basic Auth username. Social account details and OAuth token
material remain in the managed `neon_auth` schema. Public product tables must
not copy access tokens, refresh tokens, ID tokens, auth cookies, or raw provider
profiles.

## App User Provisioning And Linking

### Initial imported owner

The initial `app_users` row is created with an explicit reviewed UUID during a
future owner migration. It does not depend on an email or provider account.

After the owner has signed in through Neon Auth, a reviewed one-time link maps
that Neon Auth user id to the existing initial app user. There is no production
fallback that assigns an unmapped session to the initial owner.

### Future users

During migration, authentication and product provisioning are separate:

1. Neon Auth may authenticate a valid Google user.
2. If no approved `auth_identities` row exists, product access returns
   `identity_unlinked` and no financial query runs.
3. An explicit admin provisioning flow, designed later, creates an `app_users`
   row and its identity mapping transactionally.
4. Automatic first-login creation remains disabled until two-user isolation,
   owner-aware writers, and production authorization smoke all pass.

### Linking and collision policy

- unique `(provider, provider_subject)` prevents one Neon Auth principal from
  mapping to more than one app user;
- v1 should also allow at most one active `neon_auth` identity per app user;
- email is profile/contact data only and never a linking key;
- two separate Neon Auth users are never merged by matching email in the
  product database;
- adding another OAuth method inside one Neon Auth user must not create another
  app user because the mapped Neon Auth user id stays the same;
- an identity collision fails closed and requires an audited admin resolution;
- unlinking the last identity does not delete or reassign financial data.

## `getCurrentAppUser()` Contract

The future resolver is a `server-only` data-access function with no arguments.
It must not accept an owner id from a URL, form, header, or browser payload.

Candidate contract:

```ts
type CurrentAppUser = {
  id: string; // canonical app_users UUID
  role: "user" | "admin";
};

getCurrentAppUser(): Promise<CurrentAppUser | null>;
```

Required behavior:

1. Call Neon Auth `auth.getSession()` using request cookies.
2. If the SDK reports an operational error, throw a typed `AuthUnavailable`
   result rather than treating it as an anonymous user.
3. Return `null` only for a clean unauthenticated request.
4. Read the provider subject only inside the server-only resolver.
5. Resolve exactly one active `auth_identities` mapping.
6. Load the mapped `app_users` row and require active status.
7. Return only internal app user id and minimal authorization role.
8. Never return provider subject, email, token, cookie, or provider profile to a
   product query.
9. Deduplicate repeated resolution during one render/request with React
   `cache()` or an equivalent request-scoped mechanism.

Typed failure mapping:

| Resolution state | Page behavior | Route/Action behavior |
| --- | --- | --- |
| No valid session | Redirect to sign-in | `401` |
| Auth provider/SDK failure | Auth unavailable page | `503` |
| Valid session, no identity mapping | Access not provisioned | `403` |
| Mapping collision | Access blocked and audited | `500` integrity failure, no data |
| Inactive app user | Access disabled | `403` |
| Active mapped app user | Continue with `TenantContext` | Continue with `TenantContext` |

Product query helpers receive a trusted `TenantContext`, not a provider session:

```ts
type TenantContext = {
  ownerUserId: string;
};
```

Phase 1G0 implements this as a provider-neutral pure state-machine contract in
`src/lib/session-resolver-contract.ts`, with source and credential policy in
`src/lib/session-resolver-policy.ts`. The internal context necessarily keeps the
canonical UUID for DAL predicates, while its explicit public projection
contains no UUID or provider/session material. No production code imports
either contract in Phase 1G0.

## Next.js Responsibility Boundaries

| Boundary | Responsibility |
| --- | --- |
| `src/proxy.ts` | Temporary Basic Auth outer gate, then optional optimistic Neon Auth redirect. Never supplies owner identity and never replaces DAL authorization. |
| Server Components/pages | Resolve current app user near the page/query boundary, then call owner-scoped server query helpers. Do not rely only on a layout because layouts do not re-check on every navigation. |
| Server query/DAL modules | Require trusted `TenantContext`; filter every user-owned table before account/date/search filters; return sanitized DTOs. |
| Route Handlers | Resolve session and ownership independently; return typed 401/403/503 results; treat request owner fields as untrusted. |
| Server Actions | Treat as public mutation endpoints; resolve current user, validate input, verify resource ownership, and use transactions. |
| Client Components | May display minimal session UI, but never receive owner UUID, provider subject, tokens, or authorization secrets. |
| `/api/auth/*` | Neon Auth handler only. It does not read or write portfolio data. |
| Admin/Cron routes | Continue using `ADMIN_JOB_SECRET`/`CRON_SECRET`; never accept a user session as machine authorization. |
| Human admin pages | Future user session plus internal admin role. This does not replace machine job secrets. |

## Basic Auth Transition

Basic Auth is retained temporarily to avoid changing the deployed access
boundary while schema and identity work is incomplete.

Ordered transition:

1. Keep current Basic Auth behavior unchanged during ADR and schema planning.
2. Provision identity/owner schema and backfill while the product remains
   single-user and owner filters are not yet switched on.
3. Install Neon Auth and link the reviewed initial owner.
4. Run a dual-gate verification period: Basic Auth remains the outer gate while
   the DAL requires a valid mapped Neon Auth session.
5. Prove every product query and writer is owner-scoped, two users are isolated,
   and auth failure modes fail closed.
6. Remove Basic Auth from product routes.
7. Move the human admin page to session plus internal admin role in a separate
   review; keep admin/Cron machine secrets unchanged.

Removal gate:

- no product query has a global or implicit-initial-owner path;
- Basic Auth username/password is never used as owner identity;
- the initial owner has a verified Neon Auth mapping;
- two-user isolation and session lifecycle tests pass;
- all owner-producing writers require trusted server context;
- production auth, ID/secret leakage, and DB side-effect smoke passes;
- Neon Auth production-readiness hold is explicitly cleared, or an approved
  replacement provider passes the same contract;
- rollback behavior is documented.

## Environment And Secret Policy

| Variable/config | Exposure | Policy |
| --- | --- | --- |
| `NEON_AUTH_BASE_URL` | Server only | Required by the Next.js server SDK; do not copy into product DTOs/logs |
| `NEON_AUTH_COOKIE_SECRET` | Secret, server only | 32+ characters; stable within one environment; distinct between production and local/test; intentional rotation invalidates cached session data |
| `VITE_NEON_AUTH_URL` | Browser-oriented integration value | Present locally but not used by the planned Next.js server boundary; do not introduce a `NEXT_PUBLIC_` copy unless the selected client SDK proves it is required |
| Google OAuth client id/secret | Neon Auth configuration | Configure in Neon, not public product tables; secret never enters browser bundles or logs |
| `VARDA_APP_PASSWORD` / `APP_ACCESS_PASSWORD` | Temporary secret | Remove only after the Basic Auth transition gate |
| `ADMIN_JOB_SECRET` / `CRON_SECRET` | Machine secret | Remains separate from user auth and owner resolution |
| `DATABASE_URL` | Server secret | No browser exposure; unchanged by this ADR |

Never log or render raw session tokens, cookies, authorization headers, OAuth
tokens, provider subjects, emails, cookie secrets, admin secrets, or database
credentials. Internal app user UUIDs may be used in server-side predicates but
must not appear as product labels or default RSC payload fields.

## Isolation And Session Test Contract

The implementation phases must include:

1. Two Neon Auth test users mapped to two app users with colliding account
   codes, ticker symbols, dates, and labels.
2. Unit tests for every `getCurrentAppUser()` state: active, unauthenticated,
   auth unavailable, unlinked, inactive, and collision.
3. Product query tests proving A cannot read B across dashboard, movement,
   history, structure, risk, market regime, settings, events, and snapshots.
4. Write tests proving a missing/spoofed browser owner is rejected and the
   server context supplies ownership.
5. Session expiry, sign-out, one-session revoke, other-session revoke, and
   disabled-user tests.
6. A cache-TTL test proving revoked sessions are revalidated within the chosen
   limit and sensitive paths can require a fresh session.
7. Basic Auth-only requests fail after the dual gate is enabled.
8. User sessions cannot authorize admin/Cron routes, and admin/Cron secrets
   cannot resolve a product user.
9. Auth provider failures return no portfolio data and never fall back to the
   initial owner.
10. HTML/RSC/log scans for internal IDs, provider subjects, emails, tokens,
    cookies, auth headers, and secret patterns.
11. Preview-branch end-to-end auth tests before production; no live production
    financial writes are needed for identity verification.

## Deferred Decisions

- Kakao, Naver, GitHub, Microsoft, email/password, passkeys, and email OTP
  login methods
- Neon Auth organization/household support
- open self-service registration
- account-recovery/admin linking UI
- identity linking operation and future-user provisioning flows
- implementation of the reviewed guarded backfill command
- RLS policies and Data API/JWT integration
- recommendation persistence and user-facing mutations

## Next Approval Gate

Phase 1B completed the plan-only exact identity/owner schema, transition matrix,
staged SQL drafts, and guarded backfill contract in
`docs/auth-tenant-phase1b-migration-plan.md`.

Phase 1C0 hardened entity API and product response boundaries. Phase 1C then
applied the empty identity-table and nullable canonical-owner expansion recorded
in `docs/auth-tenant-phase1c-expand.md`.

A separately approved one-row operation later created one provisioning app
user. There is still no identity link, active app user, canonical owner
assignment, auth SDK, query filter, writer dual-write, RLS policy, or Basic Auth
change. Phase 1G0 now freezes the provider-neutral resolver state machine as a
pure contract; production integration and any identity write remain separate
approval gates.

Phase 1G1-A also freezes the reviewed initial identity-link planner as a pure
contract. It accepts no real provider subject transport and performs no
identity or app-user write.

Phase 1G1-B0 records the current preview integration readiness in
`docs/auth-tenant-phase1g1b0-preview-auth-readiness.md`. The safety audit passes,
but G1-B1 is blocked because preview/production environment isolation and a
trusted reviewed-operator target handoff are not available. Auth runtime remains
frozen and Basic Auth remains unchanged.
