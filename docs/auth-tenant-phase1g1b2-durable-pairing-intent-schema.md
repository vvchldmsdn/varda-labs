# Auth/Tenant Phase 1G1-B2: Durable Bootstrap Claim Schema

Last updated: 2026-07-26

Status: applied to Production as an empty expand migration and verified
SELECT-only on 2026-07-26.

Normalized file SHA-256:
`e3590cbe4e787bb32ca6fa9fdb27ae6f50295701dcd22bfb9b3edd8997fb1553`.

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
profile, Basic Auth credential, operator session, or identity-link plan. The
server-only local preissue tool may reveal the raw claim once through its
reviewed local stdout boundary, but never stores it.

`identity_pairing_intent_events` is the append-only terminal evidence:

- `consumed` requires the created `auth_identity_id`, server-derived subject
  HMAC, and exact G1-A plan commitment;
- `revoked` requires those consume-only fields to remain null.

A unique index permits at most one terminal event per claim. Expiry is derived
from `expires_at`; it is not represented by mutable status. Database triggers
reject `UPDATE`, `DELETE`, and `TRUNCATE` on both evidence tables.

A non-deferrable, immediate constraint trigger verifies, using the database clock, that a
consumed event occurs within the intent's issue/expiry window and references an
identity whose `app_user_id` and provider match the immutable intent header.
It locks that identity row while validating the event. A companion constraint
trigger freezes the consumed identity's owner, provider, and
`provider_subject`, preventing a later principal rebind from invalidating the
stored subject-binding evidence. Neither trigger may be changed to deferred
mode with `SET CONSTRAINTS`.

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

## Future Atomic Consume Contract

The future writer uses one `READ COMMITTED` transaction and this fixed lock
order:

1. hash the presented raw claim outside logging and select the exact claim
   header `FOR UPDATE`;
2. select the exact target `app_users` row `FOR UPDATE`;
3. select every existing identity row that matches either the verified
   provider/subject or target/provider, in stable `id` order, `FOR UPDATE`;
4. rely on the unique indexes for an absent-row insertion race.

The writer must not issue `SET CONSTRAINTS`. After the locks are held it reads
`clock_timestamp()` and revalidates the unconsumed claim window, the exact
`provisioning/user` target, terminal-event absence, and the same
server-verified provider subject. It reruns the current G1-A plan against those
locked rows and accepts only a new `planned_link`; an existing, disabled,
ambiguous, or colliding link fails closed.

The subject HMAC and plan commitment must be computed from that same locked
input snapshot. The writer then inserts one active identity, changes exactly
one target from `provisioning/user` to `active/user`, and appends one consumed
event. The non-deferrable trigger runs before the insert statement completes.
Any state mismatch, uniqueness conflict, timeout, or DML failure rolls the
entire transaction back. The automatic retry count is zero; a caller must
obtain a fresh state review instead of replaying a stale decision.

The database can compare owner and provider, but cannot recompute the subject
HMAC without the server secret. Therefore subject-to-session equality is a
mandatory writer invariant, not a database claim.

The claim preissuer is implemented as a separate server-only CLI and has not
been run in Production. The atomic consume writer and server-verified Neon
session subject port are implemented and have passed local tests plus an
isolated Preview transaction rehearsal. No runtime route invokes them, no
Production claim has been consumed, and runtime claim presentation remains
closed.

## Rehearsal Target Evidence

The local guard proves that pooled and unpooled URLs identify one Neon
endpoint, that it is not the pinned Production endpoint, and that the supplied
project id matches the reviewed integration. It does not prove that the
supplied branch id owns that endpoint. Every destructive rehearsal therefore
requires separate Neon control-plane evidence binding branch id to endpoint,
plus post-run branch deletion evidence.

## Verification

`tests/identity-pairing-intent-schema.test.mjs` pins:

- the exact two-table migration and file hash;
- claim-header and consume-event field separation;
- fixed policy and digest formats;
- one terminal event and ten-minute lifetime;
- restrictive foreign keys;
- two append-only triggers plus the consumed-identity relationship guards;
- database-clock issue/expiry enforcement and consumed provider-principal
  immutability;
- absence of identity DML, destructive DDL, RLS, and secrets.

`npm run audit:identity-pairing-schema` is SELECT-only. Before migration it must
report `state=absent`. After a separately approved migration it will verify the
exact columns; complete constraint definitions and FK actions; index
uniqueness, validity, predicates, expressions, and key order; complete trigger
metadata, constraint-trigger catalog rows, and definitions; normalized
function bodies and execution
attributes; zero rows; and the Drizzle ledger hash. Its product-row-count
digest can be passed back as
`--expect-product-row-counts-sha256` for same-window pre/post comparison.
The audit compares the complete applied ledger with the local journal. In the
absent state it permits only reviewed `0021` as the exact pending suffix; in
the present state it requires no pending migration. Migration SQL files are
kept LF-only so platform checkout behavior cannot change their Drizzle hashes.

The disposable-branch rehearsal verified absent and present catalog states,
zero initial pairing rows, rejection of constraint deferral, claim-window and
relationship failures, append-only enforcement, database-clock behavior under
lock wait, and concurrent consume/rebind serialization. The branch was deleted
after the rehearsal.

Production migration `0021` was then applied exactly once from commit
`90d14da3ae6bca6cb2a6750ff69b06b50f538af9`. Postflight verified ledger
`22/22`, no pending migration, 29 public tables, exact catalog counts of 20
columns, 12 constraints, 7 indexes, 4 triggers, and 2 functions, zero intent
and event rows, and an unchanged existing-product row-count digest.

## Still Closed

Claim issuance execution, identity linking, app-user activation, ownership
backfill, RLS, Basic Auth changes, product DB reads, and every
portfolio, Investment Lab, Simulation, provider-history, job, and Cron path
remain unchanged and unapproved.
