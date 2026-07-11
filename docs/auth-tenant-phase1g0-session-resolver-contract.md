# Auth/Tenant Phase 1G0: Provider-Neutral Session Resolver Contract

Last updated: 2026-07-11

Status: completed as a pure executable contract. No production route, proxy,
query, writer, or auth provider imports it.

## Scope

Phase 1G0 fixes the state machine that a future `getCurrentAppUser()` adapter
must follow. It does not implement that adapter. Provider session access,
identity lookup, app-user lookup, request cookies, and provider caching remain
external ports.

The current database state remains one provisioning app user, no identity
mapping, and no canonical owner assignment. Consequently, no current request
can produce a successful tenant context.

## Internal And Public Results

A successful server-side resolver must contain the canonical `app_users.id` so
the DAL can apply an owner predicate. Removing that UUID from the internal
`TenantContext` would make owner-scoped queries impossible.

The no-UUID rule therefore applies to HTTP, RSC, client, and log projections,
not to the private server capability itself:

- internal success: `{ ownerUserId, role }` for server-side DAL use;
- public success: `{ ok: true, status: "resolved" }`;
- public failure: typed code and HTTP status only.

The public projection never includes app-user UUID, provider subject, email,
token, cookie, provider profile, or authorization material. Production source
does not import either result yet.

## Input Ports

`src/lib/session-resolver-contract.ts` accepts three already-normalized port
results. Tenant-source, credential, and request-cache boundaries are separated
in `src/lib/session-resolver-policy.ts`:

1. provider session: unauthenticated, unavailable, or authenticated;
2. identity mapping: not requested, unlinked, collision, or mapped;
3. app user: not requested, missing, or loaded with status and role.

The state machine never receives an email, provider subject, token, cookie,
Basic Auth username, account selector, or request owner field. A future adapter
may use the authenticated provider subject only to perform the explicit
`auth_identities` lookup; the subject itself never becomes an owner.

## Failure Contract

| State | Code | HTTP |
| --- | --- | ---: |
| Clean unauthenticated | `unauthenticated` | 401 |
| Provider or SDK unavailable | `auth_provider_unavailable` | 503 |
| No identity mapping | `identity_unlinked` | 403 |
| Mapping collision | `identity_mapping_collision` | 500 |
| Disabled identity | `identity_not_active` | 403 |
| Provisioning or disabled app user | `app_user_not_active` | 403 |
| Missing, malformed, or mismatched mapped app user | `identity_mapping_integrity` | 500 |
| Impossible port ordering/state combination | `resolver_state_invalid` | 500 |

Only an active identity mapped to the same active app-user UUID succeeds.
Specifically, the current provisioning app user always resolves to
`403 app_user_not_active` if a future mapping is supplied in a fixture.

## Tenant And Credential Boundaries

The only canonical tenant source is a verified active identity mapping plus an
active app-user lookup. Other inputs have narrower meanings:

- `brokerage`, `isa`, `irp`, and `all` are secondary account filters;
- Basic Auth is a temporary outer access gate;
- provider subject is an identity-mapping lookup key only;
- email and URL/body/header owner values are forbidden;
- machine secrets authorize machine jobs but cannot select a user tenant.

A mapped active user session cannot authorize an admin/Cron job. A machine
secret cannot resolve a product tenant. Basic Auth does neither.

## Cache Boundary

Phase 1G0 defines only a request-scoped `getOrLoad()` interface contract:

- deduplication scope is one request;
- cross-request result caching is forbidden at this layer;
- provider cookie/session TTL remains deferred until the selected SDK is
  installed and verified;
- React `cache()`, cookies, headers, and SDK calls are absent.

## Static Audit

Run:

```bash
npm run audit:session-resolver-contract
```

The audit verifies:

- the contract has no runtime imports, DB/provider/env/cookie/header/cache call,
  or identity DML;
- production `src`, registered writers, and proxy do not import the contract;
- no auth SDK dependency is installed;
- the existing Basic Auth proxy markers remain intact;
- audit execution performs zero DB, provider, route, or cache calls.

## Explicit Non-Actions

Phase 1G0 does not:

- install Neon Auth or another auth SDK;
- add auth handlers, sign-in UI, cookies, or secrets;
- query or write `auth_identities` or `app_users`;
- link an identity or activate the provisioning user;
- change Basic Auth, proxy, routes, DAL filters, writers, snapshots, Cron, RLS,
  schema, or financial data.

## Next Approval Boundary

G0 does not authorize an identity write. The next optional gate may design and
dry-run exactly one reviewed identity-link operation, but actual link creation
requires explicit approval. Provisioning-to-active remains a separate later
gate even after a link exists.
