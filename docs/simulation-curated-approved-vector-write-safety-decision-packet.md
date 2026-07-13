# Curated Approved-Vector Write-Safety Decision Packet

Last updated: 2026-07-13

Status: `docs_only_draft_for_review_not_approved`

This packet proposes the remaining finite-resource and exact-identity
serialization semantics required before a curated approved-vector writer can
be planned. It follows the approved self-confirmation semantics pinned by
`simulation-curated-approved-vector-actor-confirmation-audit-approval.md`.

It does not approve or implement a planner, repository, writer, transaction,
schema, migration, database operation, auth/session adapter, API, UI, job,
seed, import, backfill, approval row, challenge, or receipt.

## Recommendation Summary

The varda-labs recommendation for review is:

```text
source vector row cap:
64 canonical rows, inclusive of explicit 0-bps rows

exact-identity serialization:
versioned canonical identity text -> hashtextextended(..., 0)
-> transaction-scoped PostgreSQL advisory lock

transaction isolation:
READ COMMITTED plus mandatory exact-identity advisory serialization and
transaction-time state revalidation

lock timeout:
2 seconds

statement timeout:
8 seconds

automatic writer retries:
0

lock-timeout result:
approval_identity_busy; confirmed rollback; pending challenge remains pending
only if it is otherwise still valid

confirmed statement-timeout or deadlock result:
approval_transaction_rolled_back; pending challenge remains pending only if it
is otherwise still valid

unknown commit-visibility result:
approval_temporarily_unavailable; receipt/state recovery reads only; no new
write or inferred challenge transition

state race result:
typed conflict; no partial approval authority

challenge terminal-state race:
consume, expiry, cancellation, invalidation, and conflict use the same
exact-identity serialization boundary; exactly one terminal state wins
```

These values are candidates only. They require explicit user approval before
an implementation or writer packet may be drafted.

## Decision 1: Finite Source-Vector Row Cap

The proposed maximum is:

```text
1 <= canonical source vector row count <= 64
```

Every explicit zero-bps row counts toward the limit. The cap is applied to the
complete canonical source vector before vector hashing, confirmation-envelope
hashing, challenge issuance, revision allocation, or transaction entry.

An over-limit vector fails closed. The system must not:

- truncate rows;
- drop zero-bps rows;
- merge instruments;
- split one approval across revisions;
- silently select a subset;
- renormalize remaining weights; or
- fall back to a smaller current, target, recommended, or observed vector.

The value 64 is intentionally larger than the current personal-account
portfolios while keeping review projections, normalized inserts, canonical
hashing, and confirmation evidence bounded. A future product that needs more
than 64 source instruments requires a new reviewed policy version rather than
widening this limit in place.

This is a source approval-vector cap. It is not a simulation execution
joint-universe cap, matrix-column cap, optimizer-universe cap, path cap, or UI
display limit. A later execution projection may have separate limits and must
not relabel a projected vector as the approved source vector.

## Decision 2: Exact Approval Identity

Serialization uses the already-approved full exact identity:

```text
ownerUserId
portfolioPathPolicyId
gate0ApprovalCommit
scenarioId
scenarioVersion
```

The canonical lock input recommendation is a versioned, length-prefixed tuple:

```text
domain = varda:simulation-curated-approval-lock:v1
fields in fixed order:
  ownerUserId
  portfolioPathPolicyId
  gate0ApprovalCommit
  scenarioId
  scenarioVersion

encoded field = <base-10 UTF-8 byte length>:<exact validated UTF-8 bytes>
canonical lock input =
  <domain>|<encoded ownerUserId>|<encoded portfolioPathPolicyId>
  |<encoded gate0ApprovalCommit>|<encoded scenarioId>
  |<encoded scenarioVersion>
```

The physical value is one compact UTF-8 byte sequence with no line breaks or
whitespace insertion. The displayed line breaks above are explanatory only.
Every component must first pass the already-approved schema-compatible
validation. Field order, domain/version prefix, byte-length encoding, exact
validated bytes, and separators are fixed; implementations must not use JSON,
locale-sensitive formatting, implicit Unicode normalization, delimiter-only
concatenation, or platform-default string encoding.

The owner is derived only from the verified active `TenantContext`. It is
never accepted from a browser field, search parameter, form, body, header,
cookie field, Basic Auth value, machine secret, email, legacy id, or singleton
row.

The lock text and derived lock key are server-only coordination material. They
must not be logged, returned, persisted as approval evidence, placed in an
error, or treated as an identity or authorization token.

## Decision 3: Lock Derivation And Scope

The candidate lock derivation is PostgreSQL-owned:

```sql
select pg_advisory_xact_lock(hashtextextended($1, 0));
```

`$1` is the validated canonical lock input supplied as a bound parameter. The
seed is exactly zero and the lock namespace/version prefix is part of the
canonical input.

The lock is transaction-scoped. It is acquired after authentication,
canonicalization, row-cap validation, vector validation, hash recomputation,
and challenge validation have succeeded, but before reading or allocating any
approval revision or terminal challenge state that determines the write.

Every authorized transition from `pending` to a terminal challenge state must
acquire this same exact-identity lock, including:

- approval consumption;
- server-time expiry;
- same-owner cancellation;
- policy or Gate 0 drift invalidation;
- separately approved server-security invalidation; and
- conflict after another live challenge wins admission.

No cancellation, invalidation, expiry, cleanup, support path, or future job may
use a weaker or separate serialization namespace. Physical challenge-row
locking and compare-and-set mechanics remain deferred, but they must operate
inside this exact-identity serialization boundary rather than replace it.

After acquiring the lock, the transaction must re-read and revalidate:

- the active app-user and same-owner capability required by the approved actor
  policy;
- challenge state, owner binding, exact envelope digest, and server-time
  expiry;
- all existing revisions and the zero-or-one current approved revision for the
  exact identity;
- the requested lifecycle intent; and
- the next immutable revision number and event sequence.

Only a re-read `pending` challenge may transition. The first committed
terminal transition wins. Every later contender observes the committed
terminal state, performs no challenge or approval mutation, and returns only
the same-owner sanitized outcome allowed by the approved challenge policy.
For an approval attempt, any non-`pending` state yields
`confirmation_not_usable`; a consumed same challenge may instead use its
committed receipt under the approved replay rules.

If terminal-transition lock acquisition times out, that transition rolls back
and must not be inferred. The challenge remains in its prior durable state.
Malformed, cross-owner, or unauthorized callers never enter this transition
competition and cannot mutate the challenge.

A 64-bit advisory-key collision may serialize two unrelated identities, but
must never merge their database predicates, approvals, ownership, or results.
Every read and write still uses the full exact identity and existing database
constraints. An advisory lock is coordination, not data identity or authority.

## Decision 4: Transaction Isolation

The proposed isolation level is PostgreSQL `READ COMMITTED` with mandatory
transaction-scoped exact-identity advisory serialization.

`SERIALIZABLE` is not selected for the first writer because exact-identity
serialization plus transaction-time revalidation and the existing unique
constraints already protect the approved write boundary. Adding general
serialization failures would create a retry surface without improving the
single-identity invariant.

The writer must keep the transaction narrow:

1. set local timeout values;
2. acquire the exact-identity advisory lock;
3. perform transaction-time owner, challenge, lifecycle, and current-state
   revalidation;
4. allocate server-owned revision and timestamps;
5. write the complete approval header, all normalized vector rows, initial
   lifecycle event, committed receipt, and `pending -> consumed` transition;
6. assert complete row count, 10,000-bps total, hash, and lifecycle coherence;
   and
7. commit once.

No provider, network, browser confirmation, long calculation, simulation,
optimizer, or unrelated database work may occur inside this transaction.

## Decision 5: Timeouts

The proposed local transaction limits are:

```text
lock_timeout = 2 seconds
statement_timeout = 8 seconds
```

These are writer candidates, not the 5-second/30-second DDL-rehearsal values
used by the earlier empty-schema migration. They are also unrelated to the
10-minute confirmation lifetime.

`statement_timeout = 8 seconds` is a per-SQL-statement guard. It does not cap
the total transaction duration at 8 seconds and is not an end-to-end admission
deadline or runtime SLA. An end-to-end admission deadline remains unselected
and requires a later review before implementation planning.

Timeouts are set with `SET LOCAL` inside the transaction. A lock or statement
timeout rolls back the complete transaction. It must not leave:

- a consumed challenge;
- a receipt;
- a partial header or vector;
- a lifecycle event;
- an allocated durable revision; or
- an inferred successful outcome.

If waiting causes `now >= expiresAt`, the transaction-time expiry check wins.
The challenge becomes terminal only through the separately approved lifecycle
rule; it cannot be extended because lock acquisition was slow.

## Decision 6: Retry Policy

The proposed automatic writer retry count is zero.

The server must not automatically rerun an approval transaction after:

- lock timeout;
- statement timeout;
- deadlock detection;
- connection loss with unknown commit visibility;
- unique or lifecycle conflict;
- actor, owner, challenge, hash, or envelope mismatch; or
- transaction rollback.

This avoids replaying explicit confirmation across an ambiguous outcome. A
same-owner client may submit the same challenge again only through the normal
confirmation boundary while it remains valid:

- if the original transaction committed, the immutable receipt returns the
  same sanitized committed outcome;
- if no commit occurred and the challenge is still pending and unexpired, a
  new request may attempt the same exact challenge once again; and
- if the challenge is terminal or expired, a new canonical review and new
  challenge are required.

This is request-level outcome recovery under the approved challenge contract,
not an internal transaction retry loop.

### Definite Rollback Versus Unknown Commit Outcome

A lock timeout, statement timeout, or deadlock for which PostgreSQL confirms
transaction rollback leaves the challenge in its pre-transaction `pending`
state. It does not create a receipt or a terminal challenge transition. While
the challenge remains unexpired, the same owner may explicitly submit that
same challenge again. The server does not schedule or perform that submission
automatically.

A transport or connection failure after a commit request may leave commit
visibility unknown to the caller. In that case:

1. no automatic write attempt is allowed;
2. the only immediate recovery operation is an authenticated same-owner read
   for the exact challenge's committed receipt and durable challenge state;
3. a found receipt yields `committed_replay` and no write;
4. a conclusively terminal non-commit state yields
   `confirmation_not_usable`; and
5. an absent or inconclusive result yields
   `approval_temporarily_unavailable`, performs no challenge mutation, and
   must not be translated into success or failure.

A later explicit same-owner resubmission must first repeat receipt/state
recovery. Only if the exact challenge is then durably proven `pending`, still
valid, and eligible may it enter the normal exact-identity serialized path.
The path must acquire the same advisory lock and revalidate state before any
write, so a late original commit converges on receipt recovery rather than a
second approval.

## Decision 7: Typed Outcomes

The proposed server-internal normalized outcomes are:

| Outcome | Meaning | Challenge effect | Transaction |
| --- | --- | --- | --- |
| `committed` | This exact challenge committed the complete approval evidence. | `consumed` with receipt | committed |
| `committed_replay` | The same consumed challenge and same active owner recovered the prior sanitized outcome. | unchanged | read only |
| `approval_identity_busy` | The exact-identity lock was not acquired before timeout and rollback is confirmed. | remains `pending` if otherwise valid | rolled back |
| `approval_transaction_rolled_back` | A statement timeout or deadlock produced a confirmed rollback after lock acquisition. | remains `pending` if otherwise valid | rolled back |
| `approval_state_conflict` | A different live challenge won or transaction-time exact-identity state no longer matches the reviewed intent. | `conflicted` only under the approved challenge lifecycle | conflict transition only or rolled back |
| `confirmation_not_usable` | The challenge is expired, invalidated, conflicted, mismatched, or otherwise terminal. | terminal or unchanged | no approval commit |
| `approval_temporarily_unavailable` | Commit visibility or durable state could not be established after authenticated receipt/state recovery. | no inferred terminal mutation | no new write; outcome remains unresolved |
| `rejected` | Actor, owner, vector, policy, row cap, hash, envelope, or lifecycle validation failed. | no unauthorized mutation | not started or rolled back |

Public projections may collapse these into fewer sanitized categories. They
must not expose owner ids, challenge existence across owners, advisory keys,
hashes, raw SQL errors, constraint names, revision ids, provider/session data,
or whether another owner has a matching scenario selector.

An infrastructure or connection ambiguity is never reported as committed
without a same-owner receipt read proving the commit. It is also never retried
with a different challenge, vector, owner, selector, revision, or lifecycle
intent.

Cancellation, expiry, invalidation, and conflict are not background overrides
of `consumed`. They are competing terminal transitions from `pending` and
cannot rewrite a terminal state after it commits.

## Current Runtime Result

Even if this packet is approved, current code remains:

```text
not_ready
```

Approval would define writer safety semantics only. It would not create:

- an active user or identity link;
- a verified `TenantContext` runtime adapter;
- challenge or receipt persistence;
- a planner, repository, transaction, lock, or writer;
- an API, Server Action, review UI, or admin path; or
- an approval, vector, lifecycle, challenge, or receipt row.

## Rejected Alternatives

This candidate rejects:

- an unbounded source vector;
- counting only positive-weight rows while ignoring explicit zero rows;
- trimming or renormalizing an over-limit vector;
- using scenario id alone, owner alone, current row id, vector hash, or
  challenge handle as the serialization identity;
- deriving owner or lock identity from request input;
- process-memory mutexes or module globals on Vercel;
- session-scoped advisory locks that may survive the intended transaction;
- using the advisory key as a database predicate or authorization fact;
- running the first writer under `SERIALIZABLE` with automatic retries;
- unbounded lock waits or reusing DDL-rehearsal timeout values by accident;
- retrying with changed data or a new hidden challenge;
- translating a timeout, unknown outcome, or constraint error into success;
  and
- provider calls, simulations, or optimizer calculations inside the approval
  transaction; and
- cancellation, expiry, invalidation, cleanup, or conflict transitions that do
  not acquire the same exact-identity serialization lock as consumption.

## Explicit Non-Actions

This docs-only packet does not:

- approve its recommended values;
- edit Drizzle schema, SQL, migrations, constraints, indexes, or tests;
- connect to, read, or write any database;
- implement lock derivation, transaction SQL, timeout handling, retry logic,
  receipt lookup, or challenge lifecycle;
- implement a planner, repository, writer, auth/session adapter, route, Server
  Action, page, component, job, or Cron;
- activate a user, link an identity, change Basic Auth, add RLS, or enable an
  operator;
- seed, import, backfill, revoke, supersede, reapprove, or insert data; or
- authorize simulation execution, optimizer use, recommendation, rebalance,
  or order behavior.

## Requested Review Decision

The user may approve, reject, or revise this package only as one docs-only
bundle:

1. maximum 64 canonical source-vector rows, including explicit zero-bps rows;
2. full exact-identity versioned, fixed-order, UTF-8 byte-length-prefixed
   canonical lock input and PostgreSQL
   `hashtextextended(..., 0)` transaction advisory serialization;
3. `READ COMMITTED` plus mandatory transaction-time revalidation and existing
   database constraints;
4. every authorized `pending -> terminal` challenge transition, including
   consume, expiry, same-owner cancellation, policy/Gate 0 invalidation,
   reviewed security invalidation, and conflict, uses the same exact-identity
   serialization boundary and only the first committed terminal state wins;
5. 2-second local lock timeout and per-statement 8-second local statement
   timeout, with the end-to-end admission deadline still unselected;
6. zero automatic writer retries, with same-challenge outcome recovery only
   through the approved receipt semantics; and
7. the typed busy, confirmed-rollback, conflict, unusable, temporarily
   unavailable, rejected, committed, and committed-replay meanings above.

Approval of this bundle would approve semantics only. It would not approve a
schema, migration, database operation, planner, repository, writer,
auth/session runtime, API, UI, row, or operator mode.

## Later Review Order

If this bundle is explicitly approved, the next safe order is:

1. a pure synthetic-only `would_admit` planner contract that cannot establish
   auth, database state, serialization, challenge consumption, or commit
   authority;
2. a separate physical challenge-and-receipt persistence contract that does
   not widen the existing approval tables or make challenge state runtime
   authority; and
3. verified `TenantContext` and writer admission prerequisites as later,
   independently approved gates.

This Markdown packet is not imported by code and is not a runtime trust source.
