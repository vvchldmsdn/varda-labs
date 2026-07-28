# Auth/Tenant Phase 1G2: Read-Only Account Scope v1

Last updated: 2026-07-28

Status: implemented as a server-only runtime slice. Identity pairing,
canonical-owner assignment, product writes, and RLS remain closed.

## Runtime Flow

For `/portfolio/accounts`, the server performs this sequence once per request:

1. Read the server-verified Neon Auth session.
2. Use its provider subject only as the lookup key for
   `auth_identities(provider, provider_subject)`.
3. Require exactly one active identity linked to the same active `app_users`
   row.
4. Create the private `TenantContext` from `app_users.id`.
5. Query active `accounts` with
   `accounts.canonical_owner_user_id = TenantContext.ownerUserId`.
6. Apply `brokerage`, `isa`, `irp`, or `all` only as a secondary account
   filter.
7. Return a narrow account DTO without owner UUID or provider identity.

React `cache()` deduplicates the resolver only within the current render
request. The Neon Auth session cache remains 60 seconds. Cross-request
TenantContext caching is forbidden.

## Fail-Closed States

Financial data is not queried when the session is missing, the auth provider
is unavailable, the identity is unlinked or disabled, the app user is not
active, or mapping integrity fails. Identity-store outages are reported
separately from auth-provider outages.

The account read also blocks duplicate/noncanonical account codes and malformed
account metadata. Database failures produce an unavailable result rather than
falling back to unowned rows.

## Deliberate Compatibility Boundary

Existing portfolio pages other than this evidence route still use the legacy
single-portfolio read models.
Switching them now would hide all imported rows while canonical owner columns
remain unassigned. This phase proves the secure read path without changing
current dashboard behavior.

The current Production database cannot resolve a successful TenantContext until
the separately reviewed bootstrap flow:

- links the verified identity;
- activates the reviewed provisioning app user; and
- assigns that app user as canonical owner of the imported portfolio.

None of those writes are performed here.

## Explicit Non-Actions

- no schema or migration;
- no claim route activation or identity write;
- no automatic user creation;
- no owner backfill;
- no existing portfolio query cutover;
- no provider backfill, recommendation, Lab, or Simulation changes;
- no Basic Auth removal, TenantContext write path, or RLS enablement.
