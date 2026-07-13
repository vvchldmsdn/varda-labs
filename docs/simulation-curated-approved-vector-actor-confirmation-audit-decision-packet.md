# Curated Approved-Vector Actor, Confirmation, And Audit Decision Packet

Last updated: 2026-07-13

Status: `docs_only_draft_for_review_not_approved`

This packet proposes the first policy bundle requested by
`simulation-curated-approved-vector-admission-tenant-prerequisite-gate0.md`:

1. the first eligible actor mode;
2. exact confirmation evidence and expiry semantics; and
3. minimum actor/confirmation audit persistence.

It does not approve or implement auth, confirmation state, a writer,
repository, schema, migration, database read or write, API, Server Action, UI,
job, seed, import, backfill, or approval row.

## Recommendation Summary

The varda-labs recommendation for review is:

```text
first actor mode:
tenant_self_approval_v1

current runtime state:
not_ready

operator mode:
deferred_not_enabled

confirmation policy:
curated_vector_self_confirmation_v1

confirmation lifetime:
10 minutes over the half-open interval [issuedAt, expiresAt)

confirmation use:
one confirmation challenge instance may produce one committed admission at
most; only a committed receipt supports idempotent outcome replay

audit requirement:
one immutable minimal confirmation receipt committed atomically with the
approval revision
```

These are candidate policy values only. They require explicit user approval
before an implementation or physical-schema packet may be drafted.

## Product Meaning Of Curated

For this first mode, `curated_approved_scenario` means:

> one durable, owner-scoped research scenario whose exact canonical vector was
> reviewed and explicitly approved by that same authenticated owner.

It does not mean platform-endorsed, administrator-recommended, optimal,
target, default, current, or order-ready. The word `curated` describes durable
review and approval provenance, not investment quality.

This remains distinct from `explicit_user_scenario`:

| Source kind | Lifetime | Required evidence | Must not become |
| --- | --- | --- | --- |
| `curated_approved_scenario` | Durable immutable approval revision until terminal lifecycle state | Active owner session, exact canonical review envelope, confirmation receipt, current approval record | recommendation, target, order, current holdings |
| `explicit_user_scenario` | One admitted execution command | Active owner session and sanitized command digest for that run | durable curated approval or reusable default |

A one-off submitted vector must not be silently persisted as curated. A curated
approval must not be treated as an execution command without the later run-
admission boundary.

If a future product uses `curated` to mean platform review or shared research,
that is a different actor and ownership model. It requires a new policy id and
separate review rather than widening `tenant_self_approval_v1`.

## Decision 1: First Actor Mode

The recommended first supported mode is:

```text
tenant_self_approval_v1
```

The mode is eligible only when a future production request has already
resolved:

```text
verified active provider session
  -> exactly one active auth identity mapping
  -> the same active app_users row
  -> TenantContext { ownerUserId, role }
```

The same `TenantContext` is both actor and owner. The server derives
`owner_user_id` from that capability. No browser field, account selector,
email, provider subject, Basic Auth identity, machine secret, or singleton row
may provide or override the owner.

### Why Self-Approval First

This mode is the narrowest match for the current product intent:

- scenarios are private owner-scoped research assumptions;
- a user needs to preserve an explicitly reviewed scenario for later
  comparison;
- ordinary use does not require an administrator to approve on the user's
  behalf; and
- it avoids turning shared Basic Auth or an admin secret into a bootstrap
  owner authority.

The recommendation does not claim that the current app can satisfy this mode.
It cannot. The current provisioning user, absent active identity mapping, and
absent runtime session adapter keep the result `not_ready`.

## Operator Mode Is Deferred

`reviewed_operator_approval` remains `deferred_not_enabled`.

It must not be used for the initial research vector, migration, support,
backfill, or a user who lacks an active session. Before an operator mode can be
reviewed, the system needs all of the following:

- an independently authenticated operator capability;
- an explicit operator authorization policy;
- a server-side reviewed target-owner handoff that never transports an owner
  UUID through browser input or logs;
- immutable actor and target audit evidence;
- separation from Basic Auth, admin secrets, and Cron authorization; and
- two-user tests proving that the operator cannot select an unreviewed owner.

The self-approval receipt proposed below is not sufficient for operator mode.
No operator fallback exists when self-approval is unavailable.

## Decision 2: Exact Confirmation Evidence

The recommended confirmation policy id is:

```text
curated_vector_self_confirmation_v1
```

Confirmation is a second, explicit action after the server has canonicalized
the proposed vector and produced the exact review envelope. A checkbox, page
view, Markdown statement, client timestamp, or vector hash by itself is not
confirmation.

### Challenge And Receipt Separation

The policy has two logically separate objects:

```text
confirmation challenge
  short-lived pre-commit coordination state
  never approval authority or durable committed audit evidence

immutable self-confirmation receipt
  exists only for a committed approval
  durable evidence of the consumed confirmation policy and envelope
```

The challenge may move through one controlled lifecycle:

```text
pending -> consumed
pending -> expired
pending -> invalidated
pending -> conflicted
```

Every state after `pending` is terminal. A terminal challenge is never
reactivated, refreshed, or reused for approval, supersession, revocation, or
reapproval. Only `consumed` has a matching immutable committed receipt.
`expired`, `invalidated`, and `conflicted` never create an approval receipt.

The challenge lifecycle is coordination state, not a substitute for the
append-only approval lifecycle. Its physical storage, retention, and cleanup
remain deferred.

### Server-Owned Confirmation Challenge

A future confirmation challenge must be server-minted and bound to:

- the exact active tenant-self actor capability;
- the canonical owner derived from that capability;
- `portfolioPathPolicyId`;
- `gate0ApprovalCommit`;
- exact `scenarioId` and `scenarioVersion`;
- the complete canonical vector row set, including zero-bps rows;
- `scenarioVectorHash`;
- a distinct canonical approval-envelope digest;
- the confirmation policy id;
- server-owned issuance and expiry instants; and
- a high-entropy single-use challenge-instance identity.

The approval-envelope digest is distinct from `scenarioVectorHash`. It binds
the owner-scoped approval context and confirmation policy as well as the vector
content. It must not be reused as a vector hash, approval identity, runtime
input hash, or public authorization token.

The raw challenge handle may be returned to the browser only as an opaque short-
lived confirmation handle. It must contain no owner UUID, provider subject,
email, vector rows, hash, role, or secret. Server storage retains only a safe
digest of the raw handle. The raw value must not enter logs, analytics, URLs,
environment variables, or durable audit rows.

The challenge must live in durable shared server state suitable for concurrent
Vercel instances. Process memory, module globals, client state, and unsigned
cookies are ineligible sources. The exact persistence model is deferred.

The pre-commit state must contain or derive a non-forgeable internal binding to
the canonical owner produced by the verified `TenantContext`. The prohibition
on exposing or duplicating owner, session, and provider values does not remove
this binding requirement. Its physical representation may later be an owner
reference or a server-keyed binding digest, but it must remain server-only and
must never be selected from request input.

`tenant_self_approval_v1` binds the actor to the canonical owner, not to a raw
provider-session identifier. A confirmation request may proceed only through
an active verified session that resolves again to that same owner. The policy
does not require copying a provider subject, session id, cookie, or token into
challenge state.

### Review Projection

Before confirmation, the user must be shown a safe server-derived review
projection containing at least:

- scenario id and version;
- policy label and Gate 0 revision label;
- every canonical instrument identity and weight, including explicit zero
  weights;
- row count and exact 10,000-bps total; and
- a clear statement that the action creates a durable research scenario, not
  a target, recommendation, or order.

The projection must not expose the owner UUID, provider subject, raw challenge,
internal row ids, audit digest, database hash, or secret-shaped values.

### Expiry

The proposed lifetime is exactly 10 minutes from server-owned issuance time.
The valid interval is:

```text
issuedAt <= now < expiresAt
```

Expiry is checked again inside the future approval transaction using server
time. `now >= expiresAt` is expired. There is no grace period. A challenge that
expires before its transaction-time check becomes terminal `expired` and
cannot be refreshed into validity.

Creating a replacement challenge requires a new server-side canonical review
and new explicit confirmation. The expired challenge must never be
reactivated. A later reapproval after revocation also requires a newly issued
challenge instance even when the canonical vector is identical.

The 10-minute value is a product/security recommendation for explicit review,
not an auth-session lifetime and not a database lock timeout.

### Session And Envelope Revalidation

At confirmation time, the server must independently:

1. resolve an active tenant-session capability again;
2. prove the resolved owner matches the challenge's non-forgeable server-side
   owner binding;
3. recompute the exact canonical approval envelope and digest;
4. reject changed, missing, expired, already-terminal, or cross-owner
   evidence; and
5. perform all later transaction-time lifecycle and concurrency checks.

Session cache data alone is insufficient if the authoritative provider
session or active app-user state cannot be verified under the approved auth
contract. A provisioning or disabled user is rejected even if the challenge was
minted earlier while another state was observed. No raw provider subject,
session token, or cookie needs to be copied into the challenge or receipt to
enforce this request-time revalidation.

## Replay And Idempotent Outcome Semantics

One issued confirmation challenge instance may cause at most one committed
approval transaction. `Same challenge` means the same single server-minted
challenge-instance identity, not merely the same owner, selector, vector,
envelope digest, or hash. The semantics distinguish a committed replay from a
competing admission:

### Same Consumed Challenge, Same Actor, Same Envelope

- The first eligible consumption may commit once.
- If the client loses the response and resubmits the same consumed challenge,
  the server may return the same sanitized committed outcome from the
  immutable receipt.
- The replay performs no new approval, supersession, revision allocation,
  confirmation consumption, or timestamp allocation.
- Concurrent requests for the same challenge instance converge on the one
  receipt and one committed outcome.

This is idempotent outcome replay, not a second use of the challenge. The
receipt is read only to recover the outcome of that already committed
operation. It is not authority for another approval or a simulation run.

### Same Handle With Any Actor Or Envelope Mismatch

A different owner, actor capability, envelope digest, scenario selector,
vector, policy, or confirmation policy is rejected. It
must not receive the prior committed outcome or reveal whether another owner
used the challenge. A cross-owner or otherwise unauthorized mismatch returns a
generic rejection and must not consume, invalidate, or reveal the legitimate
owner's pending challenge.

### Non-Commit Terminal Outcomes

An eligible same-owner attempt that reaches one of these outcomes closes the
challenge without creating a receipt:

```text
expired
invalidated
conflicted
```

The closed handle cannot be retried into approval. A later submission receives
only a generic sanitized `confirmation_not_usable` result and must begin a new
canonical review with a newly issued challenge. The policy does not promise an
immutable or indefinitely replayable failure outcome.

Malformed, cross-owner, or unauthorized requests are rejected without gaining
state visibility and without consuming another actor's challenge.

### Different Challenge Instances For The Same Exact Approval Identity

Different challenge-instance identities are competing admission attempts even
when their vectors match. They enter the separately reviewed exact-identity
concurrency policy. One may commit; the others become terminal `conflicted`
and receive typed conflicts. They must not be converted automatically into
supersession, reapproval, latest revision, or idempotent success.

This packet does not select transaction isolation, advisory-lock SQL, lock
timeouts, or general retry policy. It fixes only the distinction between
same-consumed-challenge outcome replay, non-commit terminal challenges, and
different-challenge conflict.

## Decision 3: Minimum Confirmation Audit Persistence

Tenant self-approval requires one minimal immutable confirmation receipt. A
lifecycle event saying `explicit_approval` is not enough to prove which
confirmation policy and exact review envelope were consumed.

The receipt is a separate logical persistence category from:

- the approval revision header;
- normalized vector rows;
- lifecycle events;
- admitted simulation run inputs;
- job diagnostics; and
- calculation results.

Its candidate logical evidence is:

```text
confirmationPolicyId
actorMode = tenant_self
approvalRevisionReference
confirmationChallengeDigest
approvalEnvelopeDigest
issuedAt
expiresAt
confirmedAt
committedAt
outcome = committed
```

This is not a table or column proposal. Physical names, keys, retention,
indexes, and DDL remain deferred.

For `tenant_self_approval_v1`, the approval revision's canonical owner is also
the actor by policy. The receipt therefore must not duplicate email, provider
subject, profile data, Basic Auth identity, session token, cookie, role, raw
challenge, vector rows, or owner UUID in a second free-standing actor field.

The future receipt, complete approval header, vector rows, and initial
lifecycle event must become visible atomically in one database transaction.
If a proposed confirmation store cannot participate in that atomic boundary,
it is ineligible for the committed receipt. Pending challenge mechanics may be
designed separately, but they cannot weaken committed receipt atomicity. If
the approval transaction rolls back, no committed receipt remains.

Failed, expired, rejected, or conflicting attempts must not create an approval
receipt that looks committed. Whether sanitized failure diagnostics require a
separate short-retention security log is a later operational decision, not
approval authority.

The committed receipt is retained with the immutable approval evidence and is
never rewritten into a later confirmation. It cannot authorize a new approval,
reapproval, execution, recommendation, or order. Exact physical retention and
delete-restriction mechanics remain a later schema decision.

Operator mode requires a separate richer actor/handoff audit contract. The
self receipt must not be widened later by inserting operator identity into a
free-form field.

## Fail-Closed Outcome For Current Code

Even if this policy package is approved, current code remains:

```text
not_ready
```

Approval of semantics would not create:

- an active user or identity link;
- a provider/session adapter or `TenantContext` runtime capability;
- a confirmation challenge or receipt schema;
- a canonical review UI or endpoint;
- a planner, repository, transaction, or writer; or
- an approval, vector, lifecycle, or receipt row.

No current request may claim `would_admit` or `committed` from this document.

## Rejected Alternatives

The following are rejected for this candidate policy:

- operator-first admission under Basic Auth or admin secret;
- selecting the provisioning user because it is the only row;
- approving the existing research vector from Markdown or Git history;
- treating an `explicit_user_scenario` command as durable approval;
- one-click approval without a distinct exact-envelope confirmation step;
- an unbounded or non-expiring confirmation challenge;
- a reusable confirmation handle;
- browser-generated timestamps, hashes, challenge ids, or receipt ids;
- process-memory-only challenge state on Vercel;
- logging raw confirmation handles or session identifiers;
- returning a prior outcome across an actor, owner, or envelope mismatch;
- retrying a terminal non-commit challenge or a different challenge as though
  it were the same committed idempotent request;
- storing actor identity, provider data, or raw confirmation material on the
  approval header; and
- creating the confirmation receipt after the approval transaction commits.

## Explicit Non-Actions

This docs-only packet does not:

- approve the recommended policy values;
- edit application code, Drizzle schema, SQL, migrations, or tests;
- connect to or query the database;
- create confirmation challenge or receipt persistence;
- install auth, activate a user, link an identity, or change Basic Auth;
- implement cryptography, cookies, CSRF handling, sessions, routes, Server
  Actions, pages, components, or logs;
- implement a planner, repository, writer, lock, transaction, timeout, retry,
  revocation, supersession, or reapproval;
- seed, import, backfill, or manually insert the approved research vector; or
- authorize simulation execution, optimizer use, recommendation, rebalance,
  or order behavior.

## Requested Review Decision

The user may approve, reject, or revise this package only as one review bundle:

1. `tenant_self_approval_v1` is the first actor mode;
2. operator approval remains deferred and has no fallback path;
3. `curated` means durable owner-reviewed research, not platform endorsement;
4. `curated_vector_self_confirmation_v1` uses one 10-minute server-owned
   challenge instance bound to the exact actor, owner, and canonical approval
   envelope, valid only over `[issuedAt, expiresAt)`;
5. one challenge instance commits at most once; only a consumed challenge with
   a committed receipt may return the same sanitized committed outcome;
6. expired, invalidated, or conflicted challenges create no receipt, cannot be
   reused, and require a newly issued challenge, while different challenge
   instances for one exact identity remain conflicts under the later
   concurrency policy; and
7. one minimal immutable self-confirmation receipt commits atomically with the
   approval revision and excludes PII, provider data, session data, and raw
   confirmation material.

Approval of this bundle would approve semantics only. It would not approve a
schema, implementation, auth runtime, database operation, API, UI, or row.

## Later Review Order

If this first bundle is explicitly approved, the remaining Gate 0 review order
should be:

1. finite source-vector row cap, separate from execution joint-universe caps;
2. exact-identity lock derivation, transaction isolation, timeout, retry, and
   typed conflict semantics; and
3. a pure synthetic-only `would_admit` planner contract that cannot establish
   auth, current database state, serialization, or commit authority.

Only after all three later policy groups are approved should a physical
confirmation-receipt schema or writer implementation packet be considered.
