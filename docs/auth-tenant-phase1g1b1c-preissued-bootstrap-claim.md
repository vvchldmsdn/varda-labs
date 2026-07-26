# Auth/Tenant Phase 1G1-B1c: Preissued Bootstrap Claim Authority

Last updated: 2026-07-26

Status: server-only issuer implemented locally; no claim has been issued.
Runtime consume trust remains unestablished.

## Decision

The initial portfolio owner will use a separately preissued, short-lived,
single-use claim to authorize the first Neon Auth identity link. This avoids
inventing an operator login that the product does not have.

The claim complements the signed-in subject session:

- the session proves who is present now;
- the claim proves that this session may claim one reviewed provisioning
  portfolio target.

Neither factor is sufficient alone.

## Pure Contract

`planIdentityBootstrapClaim` returns `synthetic_dry_run_ready` only when:

- the claim digest was server-verified and uses the fixed v1 format;
- the Neon Auth subject binding came from a verified server session;
- exactly one explicitly reviewed target remains `provisioning/user`;
- the pending durable header binds the same claim, provider, and target;
- strict UTC timestamps are valid and no more than ten minutes apart;
- the current G1-A commitment is `planned_link` for the same subject and
  target.

Every output keeps identity DML, intent consumption, and app-user mutation
disabled. Public projection exposes only outcome and typed reason.

## Non-Authority Inputs

The contract rejects these as substitutes for the preissued claim:

- the verified subject session itself;
- Basic Auth;
- a generic machine secret;
- a request-provided target.

It also stores or exposes no raw claim, provider subject, email, token, cookie,
target UUID, subject HMAC, or plan binding at a public boundary.

## Server-Only Issuer

`scripts/issue-identity-bootstrap-claim.mjs` is a local CLI, not a route or
product runtime integration. It:

- requires one explicit `target_app_user_id` and never infers a singleton;
- defaults to dry-run and requires a fixed confirmation for an actual write;
- requires pooled and unpooled URLs to identify one target and pins that target
  to the reviewed Production endpoint before any database read or write;
- returns one combined database-and-app-user target fingerprint in dry-run and
  requires that exact fingerprint again in the same write invocation;
- locks only the reviewed target row, then evaluates current intent state in a
  second `READ COMMITTED` statement in the same transaction;
- rejects a non-`provisioning/user` target, an existing provider identity, or
  an unexpired unterminated intent;
- generates 256 bits with the Node CSPRNG and stores only the versioned SHA-256
  digest for ten minutes using the database clock;
- reveals the raw claim once only after one intent row was committed;
- performs no automatic retry and uses no global or advisory lock.

Different targets do not block one another. Two issuers for the same target
serialize on that target row, and the second statement sees the first
transaction's committed intent before deciding whether it may insert.

The writer is implemented but has not been run. An actual Production issue
requires a separate approval naming the exact reviewed target and command
boundary. The approved write command must carry both
`--reviewed-target-fingerprint <dry-run fingerprint>` and the fixed
confirmation.

## Still Closed

The atomic claim consume writer and the server-verified Neon session subject
port are implemented and have passed local tests plus an isolated Preview
transaction rehearsal. They are not connected to a runtime route, and no
Production claim has been consumed. Claim presentation, UI, Production
identity insertion and target activation, ownership backfill, and RLS changes
remain closed. Local stdout is only the one-time operator handoff boundary; no
general delivery system is claimed. No raw claim is stored.
