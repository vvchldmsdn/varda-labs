# Auth/Tenant Phase 1G1-B1d: Private Session Subject Binding

Last updated: 2026-07-27

Status: implemented as a disconnected server-only adapter and a tested
binding core. It is not imported by any route, page, Server Component, job, or
writer.

## Purpose

The Production Neon Auth session contains a provider-owned user identifier.
Future bootstrap-claim authority needs stable evidence that the same verified
subject is present, but the raw identifier must not enter responses, logs,
URLs, database rows, or general application components.

This phase converts a verified `neon_auth` subject into the approved
`provider_subject_hmac_sha256_v1` binding. The returned verified result
contains only:

- provider `neon_auth`;
- binding version `provider_subject_hmac_sha256_v1`;
- binding value `hmac-sha256-v1:<64 lowercase hex>`;
- verification source `server_verified_session`.

The raw subject exists only inside the private read-and-bind call.

## Cryptographic Contract

- HMAC algorithm: SHA-256.
- Key: exactly 32 bytes, supplied as canonical unpadded base64url through the
  server-only `IDENTITY_PAIRING_EVIDENCE_HMAC_KEY` environment variable.
- Domain:
  `varda.identity-pairing.provider-subject-hmac-sha256.v1`.
- Payload: fixed-order JSON with `provider` followed by `subject`.
- Message: UTF-8 domain, one NUL separator, then UTF-8 payload.

This preserves the subject-binding format already accepted by the pairing and
bootstrap authority contracts. Invalid key material, malformed session
evidence, provider errors, and malformed subjects fail closed without
reflecting values.

## Runtime Boundary

The Production adapter:

- is marked `server-only`;
- reuses the existing Production-only auth runtime and its Preview-disabled
  policy;
- reads at most one managed session when the runtime and HMAC key are ready;
- performs no database read or write;
- performs no claim issuance or consumption;
- does not activate an `app_users` row;
- is not imported or executed by current runtime entry points.

Tests execute only the binding core with a mock verified-session port. They
also assert that no application source imports the Production adapter.

## Still Closed

- route enablement and request handling;
- bootstrap-claim issue or consume operations;
- identity or pairing-intent DML;
- `app_users` activation;
- TenantContext, owner-filtered reads, and RLS;
- Basic Auth removal;
- Preview Auth enablement;
- logs, metrics, UI, API, or persisted subject bindings.

Before an actual issuer or consumer writer is connected, the current
`master` writer code must pass a new disposable Neon concurrency rehearsal.
