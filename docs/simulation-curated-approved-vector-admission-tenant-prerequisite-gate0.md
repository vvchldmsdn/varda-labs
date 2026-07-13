# Curated Approved-Vector Admission And Tenant-Prerequisite Gate 0

Last updated: 2026-07-13

Status: `docs_only_draft_for_review_not_approved`

This document proposes the authority gate that must exist before a curated
approved-vector revision may be inserted into the deployed empty tables. It
does not authorize a writer, repository, database access, approval row,
session integration, API, UI, job, seed, import, or backfill.

## Decision Boundary

This gate answers one question:

> Which verified server capability may admit one exact owner-scoped vector as
> an approved revision, and which prerequisites must fail closed before any
> transaction is attempted?

This is approval-row admission, not simulation-run admission. A later runtime
orchestrator must separately decide whether an already approved vector is
eligible for one execution.

The physical schema, approval lifecycle semantics, read-side resolver
contract, and simulation execution-input authority are already documented
elsewhere. This gate does not repeat or widen them.

## Current Repository Decision

Current approval admission is unconditionally:

```text
not_ready
```

The three approval tables exist and are empty, but an empty schema is not a
write capability. Current blockers are:

- the only app user remains `provisioning`;
- no active provider identity is linked to that user;
- no production request adapter can produce a verified active
  `TenantContext`;
- Basic Auth is a shared outer access gate, not a user or operator identity;
- admin and Cron secrets authorize machine boundaries but cannot select or
  impersonate a tenant;
- no independently authenticated operator handoff exists;
- no approval-admission planner, writer, repository transaction, or audited
  confirmation mechanism exists; and
- the finite vector-row resource cap and exact writer serialization policy are
  still deferred.

No Markdown or Git approval may be copied into the tables to work around these
blockers.

## Eligible Future Actor Modes

A later review may approve one or both of these modes. Neither exists today.

### Tenant Self-Approval

A user may approve a vector only when a server-verified active provider
session resolves through exactly one active identity mapping to the same
active `app_users` row and yields:

```text
TenantContext { ownerUserId, role }
```

The writer derives `owner_user_id` only from that capability. The request may
never supply or override an owner UUID. The same verified session must perform
an explicit confirmation of the exact canonical vector review envelope; an
earlier page view, cached packet, URL, query parameter, or client hash is not
confirmation.

### Reviewed Operator Approval

An operator may approve for another owner only through a separately approved,
independently authenticated operator capability plus a server-side reviewed
target handoff. Shared Basic Auth, `ADMIN_JOB_SECRET`, `CRON_SECRET`, an email,
the only app-user row, or a transported owner UUID is not that capability.

The operator path must preserve two distinct facts:

1. who was authorized to perform the administrative action; and
2. which canonical app user owns the resulting revision.

The current schema deliberately does not store actor identity. Any actor audit
model and retention policy therefore require a separate review before this
mode can exist.

An operator path is not required for ordinary tenant self-approval. It is
required for any migration or administrative admission performed on behalf of
an owner who cannot supply an active tenant session.

## Ineligible Authority Sources

None of the following can authorize approval-row admission or derive the
owner:

- Markdown approval, review, close-out, or decision documents;
- a Git commit, branch, tag, Vercel status, deployment environment, or fixture;
- Basic Auth username or password;
- admin, Cron, provider, KIS, or other machine secrets;
- request URL, search params, form, body, header, cookie field, or environment
  value containing an owner UUID;
- email, provider subject, legacy Base44 id, owner string, `created_by_id`, or
  account selector;
- `brokerage`, `isa`, `irp`, or `all`;
- current holdings, targets, recommendations, optimizer output, latest
  snapshot, newest row, singleton row, or only app-user row;
- a browser-supplied vector, vector hash, approval revision, timestamp,
  lifecycle state, or audit event; or
- seed, import, backfill, direct SQL, database console insertion, or a manual
  repair script.

A matching hash proves canonical content equality only. It does not prove
identity, owner authorization, human confirmation, lifecycle eligibility, or
permission to write.

## Candidate Admission Envelope

A future server-owned planner may receive only capabilities and normalized
evidence equivalent to:

```text
actor mode capability
canonical owner capability
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
canonicalVector[]
scenarioVectorHash
explicit confirmation evidence
```

For tenant self-approval, actor and owner are the same verified
`TenantContext`. For reviewed operator approval, both capabilities are
separate and server-derived.

The browser may propose scenario selectors and vector content only through a
future bounded review workflow. Every such field remains untrusted until the
server canonicalizes and validates the complete envelope. Server-owned fields
such as physical ids, `approvalRevision`, `approvedAt`, lifecycle status,
terminal time, event sequence, and audit timestamp are never accepted from a
client.

## Fail-Closed Validation Order

A future planner and writer must preserve this order:

1. verify that the selected actor mode is implemented and enabled;
2. verify the actor capability and derive the canonical owner capability;
3. require an active owner and reject provisioning, disabled, missing,
   ambiguous, or cross-owner state;
4. validate exact policy, Gate 0 commit, scenario id, and scenario version;
5. enforce the separately approved finite vector-row cap before hashing;
6. validate canonical instrument identities, exact order, uniqueness, integer
   weights, explicit zero-bps rows, non-empty rows, and an exact 10,000-bps
   total;
7. recompute the canonical vector hash and compare it to the reviewed server
   envelope;
8. verify explicit confirmation for the exact canonical envelope and actor;
9. enter one transaction serialized on the full exact approval identity;
10. re-read current lifecycle evidence inside that transaction and validate
    the intended initial approval, supersession, revocation, or reapproval;
11. allocate revision numbers and timestamps on the server; and
12. commit the header, complete vector rows, and lifecycle event atomically.

No later validation may repair an earlier failure. The writer must not trim,
sort, renormalize, fill missing rows, infer zero rows, choose the newest
revision, change scenario version, or retry a conflict into a different
outcome.

## Serialization Responsibility

The database partial unique index is the final zero-or-one-current constraint,
not the complete concurrency protocol. A future writer transaction must also:

- serialize by the full exact identity
  `(ownerUserId, portfolioPathPolicyId, gate0ApprovalCommit, scenarioId,
  scenarioVersion)`;
- allocate a strictly higher immutable revision under that serialization;
- distinguish initial approval, identical-vector supersession, revocation,
  and reapproval after revocation;
- commit lifecycle state and lifecycle evidence together; and
- turn concurrent admission into one commit and explicit conflicts for the
  other contenders.

Exact advisory-lock SQL, lock key derivation, timeout, retry count, and maximum
vector-row count remain deferred. Until those values are reviewed, the writer
is `not_ready` even if authentication later becomes available.

## Candidate Gate Outcomes

The future boundary should normalize outcomes without exposing owner ids,
physical ids, provider subjects, hashes, rows, secrets, or raw database
errors:

| Outcome | Meaning | Database transaction |
| --- | --- | --- |
| `not_ready` | Required actor, tenant, policy, resource, or writer prerequisite is not implemented or enabled. | not started |
| `rejected` | Supplied selector, vector, confirmation, lifecycle intent, or capability combination is invalid. | not started or rolled back |
| `conflict` | Another valid transaction won exact-identity serialization or current-state evidence changed. | rolled back |
| `would_admit` | A future dry-run planner found the envelope eligible under pinned evidence. | not started |
| `committed` | A separately approved writer atomically persisted the complete revision. | committed |

This draft does not authorize implementation of any outcome. In current code,
only the policy conclusion `not_ready` is valid; there is no planner call.

`would_admit` is not permission to execute a simulation and is not authority
to perform a later write without repeating all transaction-time checks.

## Seed, Import, And Manual Write Boundary

Before an approved writer exists, all of the following remain forbidden:

- seeding the approved 069500/QQQ research vector;
- importing approval from Base44, Markdown, Git history, or a fixture;
- backfilling an owner or approval revision;
- inserting rows through Neon Console, Drizzle Studio, ad hoc SQL, CLI, admin
  route, server action, or migration DML;
- creating a temporary singleton/default approval; and
- using the current provisioning app user as an inferred owner.

If historical human approval is later admitted, it must be presented again at
an approved actor boundary and become a new prospective database approval. It
must not be treated as a retroactive runtime record.

## Read, Runtime, And Product Separation

Successful future approval admission would prove only that one immutable
owner-scoped vector revision exists. It would not by itself authorize:

- a read repository or Scenario Vector Resolver adapter;
- default, current, target, recommended, or order authority;
- simulation-run admission or runtime trust;
- matrix, draw, NAV, distribution, risk, optimizer, or fan-chart execution;
- API, Server Action, page, component, or client projection; or
- RLS, social-login rollout, provider calls, jobs, or Cron.

Those boundaries remain separate approvals. Revocation and supersession affect
future run admission prospectively; they do not rewrite a previously committed
run input or result.

## Explicit Non-Actions

This docs-only Gate 0 does not:

- edit Drizzle schema, SQL, migrations, constraints, or indexes;
- query or write the database;
- implement a repository, planner, writer, transaction, lock, or retry;
- add auth SDKs, sessions, identity links, user activation, operator auth,
  cookies, routes, or UI;
- create approval, vector, lifecycle, actor-audit, seed, import, or backfill
  rows;
- change Basic Auth, admin/Cron authorization, RLS, providers, jobs, or product
  behavior; or
- make the existing research vector a runtime source.

## Review Questions Before Implementation Planning

The next review must explicitly decide:

1. whether the first supported actor mode is tenant self-approval, reviewed
   operator approval, or neither;
2. the exact explicit-confirmation evidence and expiry boundary;
3. the finite maximum vector-row count;
4. exact-identity lock-key derivation and transaction isolation behavior;
5. timeout, no-retry or bounded-retry policy, and typed conflict semantics;
6. whether actor audit requires a separate persistence model; and
7. whether a pure, I/O-free `would_admit` planner is useful before any writer
   contract is drafted.

Only a later explicit approval may select those decisions. After that, a
separate implementation packet must still precede any source, database,
runtime, API, UI, auth, or data-row change.
