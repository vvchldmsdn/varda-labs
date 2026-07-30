import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  digestIdentityBootstrapClaim,
} from "../src/lib/identity-bootstrap-claim.ts";
import {
  createSessionSubjectBinding,
} from "../src/lib/auth/session-subject-binding.ts";
import {
  createVerifiedSessionConsumeCapability,
} from "../scripts/lib/verified-session-consume-capability.mjs";
import {
  executeVerifiedSessionIdentityConsume,
  VERIFIED_SESSION_IDENTITY_CONSUME_POLICY,
} from "../scripts/lib/verified-session-identity-consume.mjs";

const RAW_CLAIM = `varda-bootstrap-claim-v1.${Buffer.alloc(32, 3).toString(
  "base64url",
)}`;
const OTHER_RAW_CLAIM = `varda-bootstrap-claim-v1.${Buffer.alloc(
  32,
  4,
).toString("base64url")}`;
const SUBJECT = "verified-session-consume-subject";
const HMAC_KEY = Uint8Array.from({ length: 32 }, () => 9);
const SUBJECT_BINDING = createSessionSubjectBinding({
  evidence: verifiedEvidence(),
  hmacKey: HMAC_KEY,
});
if (SUBJECT_BINDING.state !== "verified") {
  throw new Error("Synthetic subject binding fixture is invalid");
}

describe("verified session identity consume composition", () => {
  it("consumes one matching continuation with one session read and writer call", async () => {
    const session = syntheticSessionPort();
    const binding = executionBinding();
    const continuation = syntheticClaimContinuation(
      RAW_CLAIM,
      binding,
    );
    const writerCalls = [];
    const result = await executeVerifiedSessionIdentityConsume(
      {
        executionBinding: binding,
        claimContinuationPort: continuation.port,
        pool: syntheticPool(),
      },
      dependencies({
        session,
        async writer(input) {
          writerCalls.push(input);
          const evidence = await input.verifiedSessionSubjectPort.read();
          assert.deepEqual(evidence, verifiedEvidence());
          assert.deepEqual(input.hmacKey, HMAC_KEY);
          assert.equal(input.rawClaim, RAW_CLAIM);
          return Object.freeze({
            result: "consumed",
            committed: true,
          });
        },
      }),
    );

    assert.deepEqual(result, {
      operation: "verified_session_identity_consume_v1",
      result: "consumed",
      committed: true,
      retryCount: 0,
    });
    assert.equal(session.readCount(), 1);
    assert.equal(continuation.takeCount(), 1);
    assert.equal(writerCalls.length, 1);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(RAW_CLAIM), false);
    assert.equal(serialized.includes(SUBJECT), false);
  });

  it("blocks a session-binding mismatch before taking the claim", async () => {
    const session = syntheticSessionPort();
    const binding = executionBinding({
      subjectBinding: `hmac-sha256-v1:${"f".repeat(64)}`,
    });
    const continuation = syntheticClaimContinuation(
      RAW_CLAIM,
      binding,
    );
    let writerCalls = 0;
    const result = await executeVerifiedSessionIdentityConsume(
      {
        executionBinding: binding,
        claimContinuationPort: continuation.port,
        pool: syntheticPool(),
      },
      dependencies({
        session,
        async writer() {
          writerCalls += 1;
        },
      }),
    );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "session_binding_mismatch");
    assert.equal(result.claimContinuationTaken, false);
    assert.equal(result.restartRequired, false);
    assert.equal(continuation.takeCount(), 0);
    assert.equal(writerCalls, 0);
  });

  it("blocks a claim-binding mismatch before invoking the writer", async () => {
    const binding = executionBinding();
    const continuation = syntheticClaimContinuation(
      OTHER_RAW_CLAIM,
      binding,
    );
    let writerCalls = 0;
    const result = await executeVerifiedSessionIdentityConsume(
      {
        executionBinding: binding,
        claimContinuationPort: continuation.port,
        pool: syntheticPool(),
      },
      dependencies({
        session: syntheticSessionPort(),
        async writer() {
          writerCalls += 1;
        },
      }),
    );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "execution_binding_mismatch");
    assert.equal(result.claimContinuationTaken, true);
    assert.equal(result.restartRequired, true);
    assert.equal(continuation.takeCount(), 1);
    assert.equal(writerCalls, 0);
  });

  it("returns a safe partial result when the atomic writer fails", async () => {
    const result = await executeVerifiedSessionIdentityConsume(
      {
        executionBinding: executionBinding(),
        claimContinuationPort:
          syntheticClaimContinuation(
            RAW_CLAIM,
            executionBinding(),
          ).port,
        pool: syntheticPool(),
      },
      dependencies({
        session: syntheticSessionPort(),
        async writer() {
          throw Object.assign(new Error("sensitive detail"), {
            code: "database_timeout",
          });
        },
      }),
    );

    assert.deepEqual(result, {
      operation: "verified_session_identity_consume_v1",
      result: "partial",
      failedPhase: "identity_consume",
      blocker: "database_timeout",
      committedPhases: [],
      crossPhaseRollbackAttempted: false,
      restartRequired: true,
      retryCount: 0,
    });
  });

  it("keeps issuer, owner assignment, and HTTP transport disconnected", () => {
    const adapter = readFileSync(
      "src/lib/auth/private-verified-session-identity-consume.ts",
      "utf8",
    );
    const core = readFileSync(
      "scripts/lib/verified-session-identity-consume.mjs",
      "utf8",
    );
    const route = readFileSync(
      "src/app/api/identity/bootstrap-claim/present/route.ts",
      "utf8",
    );

    assert.match(adapter, /^import "server-only";/);
    assert.match(adapter, /consumeIdentityPairingClaim/);
    assert.match(adapter, /createPrivateSessionConsumeCapability/);
    assert.match(adapter, /executeVerifiedSessionIdentityConsume/);
    assert.doesNotMatch(
      adapter,
      /identity-bootstrap-claim-issuer|legacy-account-owner-assignment-writer/,
    );
    assert.doesNotMatch(
      core,
      /DATABASE_URL|process\.env|@\/db|drizzle|@neondatabase/,
    );
    assert.doesNotMatch(
      route,
      /private-verified-session-identity-consume|executeVerifiedSessionIdentityConsume/,
    );
    assert.match(
      route,
      /createDisabledIdentityPairingClaimPresentationResponse\(\)/,
    );
  });

  it("rejects continuation evidence drift before invoking the writer", async () => {
    const expectedBinding = executionBinding();
    const continuationBinding = executionBinding({
      identityPairingIntentSha256: `sha256:${"8".repeat(64)}`,
    });
    let writerCalls = 0;

    const result = await executeVerifiedSessionIdentityConsume(
      {
        executionBinding: expectedBinding,
        claimContinuationPort: syntheticClaimContinuation(
          RAW_CLAIM,
          continuationBinding,
        ).port,
        pool: syntheticPool(),
      },
      dependencies({
        session: syntheticSessionPort(),
        async writer() {
          writerCalls += 1;
        },
      }),
    );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "execution_binding_mismatch");
    assert.equal(result.claimContinuationTaken, true);
    assert.equal(writerCalls, 0);
  });

  it("keeps policy limits exact", () => {
    assert.deepEqual(VERIFIED_SESSION_IDENTITY_CONSUME_POLICY, {
      operation: "verified_session_identity_consume_v1",
      sessionReadsPerAttempt: 1,
      claimContinuationTakesPerAttempt: 1,
      writerInvocationsPerAttempt: 1,
      retryCount: 0,
    });
  });
});

function dependencies({ session, writer }) {
  return Object.freeze({
    createSessionCapability() {
      return createVerifiedSessionConsumeCapability({
        sessionPort: session.port,
        hmacKey: HMAC_KEY,
      });
    },
    consumeIdentityPairingClaim: writer,
  });
}

function executionBinding(extra = {}) {
  return Object.freeze({
    targetAppUserSha256: `sha256:${"1".repeat(64)}`,
    provider: "neon_auth",
    claimDigestVersion: "bootstrap_claim_sha256_v1",
    claimDigest: digestIdentityBootstrapClaim(RAW_CLAIM),
    identityPairingIntentSha256: `sha256:${"2".repeat(64)}`,
    subjectBindingVersion: SUBJECT_BINDING.subjectBindingVersion,
    subjectBinding: SUBJECT_BINDING.subjectBinding,
    ...extra,
  });
}

function syntheticSessionPort() {
  let reads = 0;
  return Object.freeze({
    port: Object.freeze({
      async read() {
        reads += 1;
        return verifiedEvidence();
      },
    }),
    readCount() {
      return reads;
    },
  });
}

function syntheticClaimContinuation(rawClaim, binding) {
  let takes = 0;
  let available = true;
  return Object.freeze({
    port: Object.freeze({
      take() {
        if (!available) {
          throw Object.assign(new Error("already taken"), {
            code: "claim_continuation_unavailable",
          });
        }
        available = false;
        takes += 1;
        return Object.freeze({
          rawClaim,
          executionBinding: binding,
        });
      },
    }),
    takeCount() {
      return takes;
    },
  });
}

function syntheticPool() {
  return Object.freeze({
    async connect() {
      throw new Error("The synthetic writer must not connect");
    },
  });
}

function verifiedEvidence() {
  return Object.freeze({
    state: "verified",
    provider: "neon_auth",
    subject: SUBJECT,
    verificationSource: "server_verified_session",
  });
}
