# Auth/Tenant Phase 1G1-B2: Durable Pairing Intent Schema

Last updated: 2026-07-25

Status: implemented and verified locally. Migration `0021` is generated but
not applied to any database.

Migration SHA-256:
`ef49f7d2b9074daf10dbb2d7890875cc895cf6dd87a4d9b39d01c8a9df0a3c50`.

## Purpose

This phase gives the B1b single-use pairing contract a durable physical shape.
It does not create an intent, connect a Google identity, activate an app user,
or expose a mutation route.

## Storage Model

`identity_pairing_intents` is the immutable approval header. It binds:

- one explicitly reviewed provisioning app user;
- the fixed pairing and planner policy versions;
- server-derived HMAC bindings for the subject, operator, and principals;
- the verified identity-link plan commitment;
- a unique digest of a high-entropy challenge;
- an issue time and expiry no more than ten minutes apart.

It stores no raw provider subject, email, token, cookie, profile, or Basic Auth
credential. The challenge value itself remains only in a future secure,
HTTP-only, SameSite cookie.

`identity_pairing_intent_events` is the append-only terminal record. It permits
only:

- `consumed`, with a required `auth_identity_id`;
- `revoked`, without an identity.

A unique index permits at most one terminal event per intent. Expiry is derived
from `expires_at`; it is not a mutable status or cleanup write.

## Transaction Boundary

The schema makes a future atomic consume transaction possible:

1. lock and re-read the exact intent;
2. verify the unexpired challenge, independent operator, subject bindings,
   reviewed target, and current G1-A commitment;
3. insert the active `auth_identities` row;
4. append the `consumed` event;
5. commit both writes together.

No part of that repository or transaction is implemented here. The future
writer must also re-check that the target remains exactly one
`provisioning/user` row because a cross-table check constraint cannot enforce
that condition.

## Verification

`tests/identity-pairing-intent-schema.test.mjs` checks:

- the exact two-table migration scope;
- fixed policy and HMAC formats;
- unique challenge and terminal-event constraints;
- the ten-minute lifetime limit;
- restrictive foreign keys;
- absence of identity DML, destructive DDL, RLS, and secret columns.

The read-only Production ownership audits also pass against the current
27-table schema. They classify the three existing simulation approval tables
as user-owned authority data (one direct owner and two parent-FK owner paths).
The future post-`0021` schema resolves to 29 classified tables without changing
the 14-table transitional owner-column set.

## Still Closed

This phase does not apply migration `0021`, read or write the new tables, create
an operator authority, issue a challenge, resolve a product tenant, activate an
app user, backfill ownership, enable RLS, change Basic Auth, or alter any
portfolio, Investment Lab, Simulation, provider-history, job, or Cron path.
