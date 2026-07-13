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

The Stage III close-out recorded that the three approval tables existed and
were empty at deployment. This docs-only gate does not perform a current
database or provider read, so a future writer must reverify that state before
any transaction. An empty schema is not a write capability. Current code and
contract blockers are:

- the latest reviewed identity baseline recorded one `provisioning` app user
  and no active provider identity, but current durable state remains unverified
  by this gate;
- no production request adapter can produce a verified active
  `TenantContext`;
- Basic Auth is a shared outer access gate, not a user or operator identity;
- admin and Cron secrets authorize machine boundaries but cannot select or
  impersonate a tenant;
- no independently authenticated operator handoff exists;
- the approval header has no durable `scenario_vector_hash_version`, so v2
  approval persistence must remain blocked until the separate additive schema
  amendment is approved and deployed;
- the existing scenario-vector resolver is v1-only and no version-aware v2
  repository/resolver path exists;
- no runtime-trusted approval-admission planner, writer, repository
  transaction, or production confirmation adapter exists;
- the implemented pure planner is fixed to `synthetic_only`, runtime trust
  `not_established`, and readiness `not_ready`, so it cannot admit or persist
  a vector; and
- the approved 64-row cap and docs-only write-safety semantics have no concrete
  repository, transaction, challenge/receipt persistence, or writer
  implementation.

No Markdown or Git approval may be copied into the tables to work around these
blockers.

## Actor Mode Semantics

The docs-only semantics approve `tenant_self_approval_v1` as the first future
actor mode, but no production session adapter, admission runtime, or writer
implements it. Reviewed operator approval remains deferred and disabled, with
no fallback from unavailable tenant self-approval.

### Tenant Self-Approval

Under the approved future tenant-self semantics, a user may approve a vector
only when a server-verified active provider session resolves through exactly
one active identity mapping to the same active `app_users` row and yields:

```text
TenantContext { ownerUserId, role }
```

The writer derives `owner_user_id` only from that capability. The request may
never supply or override an owner UUID. The same verified session must perform
an explicit confirmation of the exact canonical vector review envelope; an
earlier page view, cached packet, URL, query parameter, or client hash is not
confirmation.

### Reviewed Operator Approval

Operator mode is not approved or implemented. A future operator could approve
for another owner only through a separately approved, independently
authenticated operator capability plus a server-side reviewed target handoff.
Shared Basic Auth, `ADMIN_JOB_SECRET`, `CRON_SECRET`, an email, the only
app-user row, or a transported owner UUID is not that capability.

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

A future server-owned runtime planner may receive only capabilities and
normalized evidence equivalent to:

```text
actor mode capability
canonical owner capability
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
canonicalVector[]
scenarioVectorHashVersion
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

A future runtime planner and writer must preserve this order:

1. verify that the selected actor mode is implemented and enabled;
2. verify the actor capability and derive the canonical owner capability;
3. require an active owner and reject provisioning, disabled, missing,
   ambiguous, or cross-owner state;
4. validate exact policy, Gate 0 commit, scenario id, and scenario version;
5. enforce the approved 64-row vector cap before hashing;
6. validate canonical instrument identities, exact order, uniqueness, integer
   weights, explicit zero-bps rows, non-empty rows, and an exact 10,000-bps
   total;
7. require an explicitly supported durable vector-hash version without
   inferring it from the digest, policy, commit, or scenario version;
8. recompute the canonical vector hash with that exact implementation and
   compare it to the reviewed server envelope;
9. verify explicit confirmation for the exact canonical envelope and actor;
10. enter one transaction serialized on the full exact approval identity;
11. re-read current lifecycle evidence inside that transaction and validate
    the intended initial approval, supersession, revocation, or reapproval;
12. allocate revision numbers and timestamps on the server; and
13. commit the header, complete vector rows, and lifecycle event atomically.

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

The approved docs-only write-safety semantics pin the 64-row cap, versioned
lock input, `READ COMMITTED`, 2-second lock timeout, 8-second statement
timeout, and zero automatic retries. Concrete advisory-lock SQL, challenge and
receipt persistence, repository transaction code, and the writer remain
unimplemented. Until those runtime pieces are separately reviewed and built,
the writer is `not_ready` even if authentication later becomes available.

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

This draft does not authorize implementation of any outcome. In current
product and runtime code, only the policy conclusion `not_ready` is valid and
there is no runtime planner call. The pure synthetic helper can report only
untrusted synthetic precondition evidence; it cannot produce `would_admit`,
`committed`, or any runtime authority.

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

## Resolved Semantics And Remaining Runtime Preconditions

The following docs-only semantics are already resolved and must not be
reopened by this Gate 0:

1. the first actor mode is `tenant_self_approval_v1`, while reviewed operator
   approval remains disabled without a fallback path;
2. explicit confirmation uses a server-minted exact challenge valid for 10
   minutes over `[issuedAt, expiresAt)`, with atomic consumption and committed
   receipt semantics;
3. the complete source vector contains 1 through 64 rows, including explicit
   zero-bps rows;
4. write safety uses the approved exact-identity lock input, PostgreSQL
   `READ COMMITTED`, a 2-second lock timeout, an 8-second statement timeout,
   zero automatic retries, and typed conflict and recovery meanings; and
5. the pure I/O-free synthetic planner is implemented, but reports only
   `synthetic_only` precondition evidence with runtime trust `not_established`
   and readiness `not_ready`.

Those decisions grant no runtime authority. The following physical and runtime
preconditions still require separate contracts, implementation scopes, and
verification before approval admission can become ready:

1. a production session adapter that resolves one verified active provider
   identity to one active app user and an internal `TenantContext`;
2. a physical durable challenge and committed-receipt model with owner,
   envelope, lifecycle, uniqueness, retention, and terminal-state invariants;
3. a concrete repository and transaction writer, including advisory-lock SQL,
   transaction-time revalidation, revision allocation, atomic lifecycle
   writes, rollback behavior, and receipt recovery;
4. sanitized runtime result projections and same-owner authorization without
   exposing owner ids, provider subjects, challenge material, hashes, rows,
   advisory keys, or raw database errors;
5. concurrency, replay, cross-owner, timeout, rollback, unknown-commit, and
   two-user integration tests; and
6. a separate actor-audit and authentication review before any operator mode
   can be considered.

No source, schema, database, auth, runtime, API, UI, or data-row change is
authorized by this factual status correction.
