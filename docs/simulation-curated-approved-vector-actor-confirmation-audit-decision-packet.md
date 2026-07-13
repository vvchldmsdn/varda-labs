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
10 minutes from server-owned issuance time

confirmation use:
one committed admission at most, with same-intent idempotent outcome replay

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

### Server-Owned Confirmation Intent

A future confirmation intent must be server-minted and bound to:

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
- a high-entropy single-use intent identity.

The approval-envelope digest is distinct from `scenarioVectorHash`. It binds
the owner-scoped approval context and confirmation policy as well as the vector
content. It must not be reused as a vector hash, approval identity, runtime
input hash, or public authorization token.

The raw intent handle may be returned to the browser only as an opaque short-
lived confirmation handle. It must contain no owner UUID, provider subject,
email, vector rows, hash, role, or secret. Server storage retains only a safe
digest of the raw handle. The raw value must not enter logs, analytics, URLs,
environment variables, or durable audit rows.

The intent must live in durable shared server state suitable for concurrent
Vercel instances. Process memory, module globals, client state, and unsigned
cookies are ineligible sources. The exact persistence model is deferred.

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

The projection must not expose the owner UUID, provider subject, raw intent,
internal row ids, audit digest, database hash, or secret-shaped values.

### Expiry

The proposed lifetime is exactly 10 minutes from server-owned issuance time.
Expiry is checked again inside the future approval transaction using server
time. There is no grace period. An intent that expires before its transaction-
time check is rejected and cannot be refreshed into validity.

Creating a replacement intent requires a new server-side canonical review and
new explicit confirmation. The expired intent must never be reactivated.

The 10-minute value is a product/security recommendation for explicit review,
not an auth-session lifetime and not a database lock timeout.

### Session And Envelope Revalidation

At confirmation time, the server must independently:

1. re-resolve the same active tenant-session capability;
2. prove the resolved owner matches the intent's server-side owner binding;
3. recompute the exact canonical approval envelope and digest;
4. reject changed, missing, expired, already-invalidated, or cross-session
   evidence; and
5. perform all later transaction-time lifecycle and concurrency checks.

Session cache data alone is insufficient if the authoritative provider
session or active app-user state cannot be verified under the approved auth
contract. A provisioning or disabled user is rejected even if the intent was
minted earlier while another state was observed.

## Replay And Idempotent Outcome Semantics

One confirmation intent may cause at most one committed approval transaction.
The semantics distinguish replay from a competing admission:

### Same Intent, Same Actor, Same Envelope

- The first eligible consumption may commit once.
- If the client loses the response and resubmits the same intent, the server
  may return the same sanitized committed outcome from the immutable receipt.
- The replay performs no new approval, supersession, revision allocation,
  confirmation consumption, or timestamp allocation.
- Concurrent requests for the same intent converge on the one receipt and one
  committed outcome.

This is idempotent outcome replay, not a second use of the intent.

### Same Intent With Any Mismatch

A different owner, actor capability, session capability, envelope digest,
scenario selector, vector, policy, or confirmation policy is rejected. It
must not receive the prior committed outcome or reveal whether another owner
used the intent.

### Different Intents For The Same Exact Approval Identity

Different intent identities are competing admission attempts even when their
vectors match. They enter the separately reviewed exact-identity concurrency
policy. One may commit; the others must receive typed conflicts. They must not
be converted automatically into supersession, reapproval, latest revision, or
idempotent success.

This packet does not select transaction isolation, advisory-lock SQL, lock
timeouts, or general retry policy. It fixes only the distinction between
same-intent outcome replay and different-intent conflict.

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
confirmationIntentDigest
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
intent, vector rows, or owner UUID in a second free-standing actor field.

The future receipt, complete approval header, vector rows, and initial
lifecycle event must become visible atomically in one database transaction.
If a proposed confirmation store cannot participate in that atomic boundary,
it is ineligible for the committed receipt. Pending intent mechanics may be
designed separately, but they cannot weaken committed receipt atomicity.

Failed, expired, rejected, or conflicting attempts must not create an approval
receipt that looks committed. Whether sanitized failure diagnostics require a
separate short-retention security log is a later operational decision, not
approval authority.

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
- a confirmation intent or receipt schema;
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
- an unbounded or non-expiring confirmation;
- a reusable confirmation handle;
- browser-generated timestamps, hashes, intent ids, or receipt ids;
- process-memory-only intent state on Vercel;
- logging raw confirmation handles or session identifiers;
- returning a prior outcome across an actor, owner, or envelope mismatch;
- retrying a different intent as though it were the same idempotent request;
- storing actor identity, provider data, or raw confirmation material on the
  approval header; and
- creating the confirmation receipt after the approval transaction commits.

## Explicit Non-Actions

This docs-only packet does not:

- approve the recommended policy values;
- edit application code, Drizzle schema, SQL, migrations, or tests;
- connect to or query the database;
- create confirmation intent or receipt persistence;
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
4. `curated_vector_self_confirmation_v1` uses a 10-minute server-owned intent
   bound to the exact actor, owner, and canonical approval envelope;
5. one intent commits at most once, while same-intent retransmission may return
   the same sanitized committed outcome without a new write;
6. different intents for one exact identity remain conflicts under the later
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
