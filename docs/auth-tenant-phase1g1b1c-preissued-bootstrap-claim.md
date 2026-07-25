# Auth/Tenant Phase 1G1-B1c: Preissued Bootstrap Claim Authority

Last updated: 2026-07-25

Status: pure synthetic contract only. Runtime trust remains unestablished.

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

## Still Closed

There is no claim generator, secure delivery channel, repository, session
adapter, route, UI, DB read/write, identity insertion, target activation,
ownership backfill, or RLS change. The corrected empty schema migration remains
unapplied pending review.
