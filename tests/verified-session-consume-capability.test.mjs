import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createVerifiedSessionConsumeCapability,
  VERIFIED_SESSION_CONSUME_CAPABILITY_POLICY,
} from "../scripts/lib/verified-session-consume-capability.mjs";

const HMAC_KEY = Uint8Array.from(
  { length: 32 },
  (_, index) => index + 1,
);
const SUBJECT = "verified-session-capability-subject";

describe("verified session consume capability", () => {
  it("seals one session read and exposes it to one exact-bound consume", async () => {
    const session = syntheticSessionPort();
    const capability = await createVerifiedSessionConsumeCapability({
      sessionPort: session.port,
      hmacKey: HMAC_KEY,
    });

    assert.equal(capability.state, "verified");
    assert.equal(session.readCount(), 1);
    assert.equal(capability.isAvailable(), true);
    assert.equal(JSON.stringify(capability).includes(SUBJECT), false);
    assert.equal(
      JSON.stringify(capability).includes(Buffer.from(HMAC_KEY).toString("hex")),
      false,
    );

    let executorCalls = 0;
    let subjectPortReads = 0;
    const result = await capability.consume({
      ...capability.binding,
      async execute({ verifiedSessionSubjectPort, hmacKey }) {
        executorCalls += 1;
        assert.notEqual(hmacKey, HMAC_KEY);
        assert.deepEqual(hmacKey, HMAC_KEY);

        const evidence = await verifiedSessionSubjectPort.read();
        subjectPortReads += 1;
        assert.deepEqual(evidence, verifiedEvidence());
        assert.deepEqual(await verifiedSessionSubjectPort.read(), {
          state: "unavailable",
        });
        subjectPortReads += 1;
        return Object.freeze({ result: "synthetic_consumed" });
      },
    });

    assert.deepEqual(result, { result: "synthetic_consumed" });
    assert.equal(executorCalls, 1);
    assert.equal(subjectPortReads, 2);
    assert.equal(capability.isAvailable(), false);
    await assert.rejects(
      () =>
        capability.consume({
          ...capability.binding,
          async execute() {},
        }),
      hasCode("session_capability_already_consumed"),
    );
  });

  it("burns a mismatched capability before invoking the executor", async () => {
    const capability = await createVerifiedSessionConsumeCapability({
      sessionPort: syntheticSessionPort().port,
      hmacKey: HMAC_KEY,
    });
    let executorCalls = 0;

    await assert.rejects(
      () =>
        capability.consume({
          subjectBindingVersion:
            capability.binding.subjectBindingVersion,
          subjectBinding: `hmac-sha256-v1:${"0".repeat(64)}`,
          async execute() {
            executorCalls += 1;
          },
        }),
      hasCode("session_binding_mismatch"),
    );

    assert.equal(executorCalls, 0);
    assert.equal(capability.isAvailable(), false);
  });

  it("preserves blocked states and rejects invalid keys before reading", async () => {
    for (const state of ["disabled", "missing", "unavailable"]) {
      const session = syntheticSessionPort({ state });
      assert.deepEqual(
        await createVerifiedSessionConsumeCapability({
          sessionPort: session.port,
          hmacKey: HMAC_KEY,
        }),
        { state },
      );
      assert.equal(session.readCount(), 1);
    }

    const session = syntheticSessionPort();
    await assert.rejects(
      () =>
        createVerifiedSessionConsumeCapability({
          sessionPort: session.port,
          hmacKey: new Uint8Array(31),
        }),
      hasCode("binding_key_invalid"),
    );
    assert.equal(session.readCount(), 0);
  });

  it("does not invoke accessor-backed subject evidence", async () => {
    let subjectReads = 0;
    const evidence = {
      state: "verified",
      provider: "neon_auth",
      verificationSource: "server_verified_session",
    };
    Object.defineProperty(evidence, "subject", {
      enumerable: true,
      get() {
        subjectReads += 1;
        return SUBJECT;
      },
    });

    assert.deepEqual(
      await createVerifiedSessionConsumeCapability({
        sessionPort: syntheticSessionPort(evidence).port,
        hmacKey: HMAC_KEY,
      }),
      { state: "unavailable" },
    );
    assert.equal(subjectReads, 0);
  });

  it("keeps policy limits exact", () => {
    assert.deepEqual(VERIFIED_SESSION_CONSUME_CAPABILITY_POLICY, {
      operation: "verified_session_consume_capability_v1",
      sessionReadsPerAttempt: 1,
      consumeInvocationsPerCapability: 1,
      retryCount: 0,
    });
  });
});

function syntheticSessionPort(evidence = verifiedEvidence()) {
  let reads = 0;
  return Object.freeze({
    port: Object.freeze({
      async read() {
        reads += 1;
        return evidence;
      },
    }),
    readCount() {
      return reads;
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

function hasCode(expected) {
  return (error) => error?.code === expected;
}
