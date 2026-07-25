# Auth/Tenant Phase 1G1-B2: Durable Bootstrap Claim Schema

Last updated: 2026-07-26

Status: corrected and verified locally. Migration
`0021_strange_sinister_six.sql` is generated but not applied to any database.

Normalized file SHA-256:
`e7713662bdbbedef69f7358128abe62e2ea4085335a6134396d68a5bcccbf90a`.

## Purpose

Preview and Production Google sign-in prove that Neon Auth can establish and
clear a server session. A session does not prove which existing provisioning
portfolio user the subject may claim. Basic Auth is also an application access
boundary, not identity-link authority.

This phase gives a future, separately preissued bootstrap claim a durable
physical shape. It does not issue a claim, connect an identity, activate an app
user, or expose a mutation route.

## Storage Model

`identity_pairing_intents` is an immutable claim header. It stores:

- one explicitly reviewed provisioning app-user target;
- the fixed bootstrap-claim authority and target-review policies;
- provider `neon_auth`;
- a unique SHA-256 digest of a high-entropy one-time claim;
- issue and expiry timestamps no more than ten minutes apart.

It does not store the raw claim, provider subject, email, token, cookie,
profile, Basic Auth credential, operator session, or identity-link plan. A
future local preissue tool may reveal the raw claim once through an
out-of-band channel, but that tool is not implemented here.

`identity_pairing_intent_events` is the append-only terminal evidence:

- `consumed` requires the created `auth_identity_id`, server-derived subject
  HMAC, and exact G1-A plan commitment;
- `revoked` requires those consume-only fields to remain null.

A unique index permits at most one terminal event per claim. Expiry is derived
from `expires_at`; it is not represented by mutable status. Database triggers
reject `UPDATE`, `DELETE`, and `TRUNCATE` on both evidence tables.

A deferred constraint trigger also verifies that a consumed event references
an identity whose `app_user_id` and provider match the immutable intent header.
It locks that identity row while validating the event. A companion constraint
trigger prevents a later identity rebind from invalidating consumed evidence.

## Authority Boundary

The separate factors are:

1. possession of the preissued one-time claim;
2. a current server-verified Neon Auth subject session;
3. one explicitly reviewed `provisioning/user` target;
4. a current G1-A plan commitment bound to that subject and target.

There is no synthetic operator principal in this model. Operator-subject
inequality is therefore not a stored invariant; the separately preissued claim
is the independent authority factor. Session-only, Basic Auth-only, machine
secret-only, singleton-row, email, or request-target claims remain
insufficient.

## Future Atomic Consume

A future writer must perform one reviewed transaction:

1. hash the presented raw claim and lock the exact pending header;
2. re-check DB time, expiry, target role/status/cardinality, and terminal-event
   absence;
3. verify the server session and current G1-A commitment;
4. insert the active identity;
5. activate the exact target;
6. append the `consumed` event;
7. commit all changes together.

None of that writer, claim preissuer, repository, or transaction exists in this
phase.

## Verification

`tests/identity-pairing-intent-schema.test.mjs` pins:

- the exact two-table migration and file hash;
- claim-header and consume-event field separation;
- fixed policy and digest formats;
- one terminal event and ten-minute lifetime;
- restrictive foreign keys;
- two append-only triggers plus the consumed-identity relationship guards;
- absence of identity DML, destructive DDL, RLS, and secrets.

`npm run audit:identity-pairing-schema` is SELECT-only. Before migration it must
report `state=absent`. After a separately approved migration it will verify the
exact columns; complete constraint definitions and FK actions; index
uniqueness, validity, predicates, expressions, and key order; complete trigger
metadata and definitions; normalized function bodies and execution
attributes; zero rows; and the Drizzle ledger hash. Its product-row-count
digest can be passed back as
`--expect-product-row-counts-sha256` for same-window pre/post comparison.

## Still Closed

Migration `0021`, claim issuance, identity linking, app-user activation,
ownership backfill, RLS, Basic Auth changes, product DB reads, and every
portfolio, Investment Lab, Simulation, provider-history, job, and Cron path
remain unchanged and unapproved.
