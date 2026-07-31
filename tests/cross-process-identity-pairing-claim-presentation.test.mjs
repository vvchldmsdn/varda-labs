import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY,
  executeCrossProcessIdentityPairingClaimPresentation,
} from "../scripts/lib/cross-process-identity-pairing-claim-presentation.mjs";
import {
  createVerifiedSessionConsumeCapability,
} from "../scripts/lib/verified-session-consume-capability.mjs";

const RAW_CLAIM = `varda-bootstrap-claim-v1.${Buffer.alloc(32, 5).toString(
  "base64url",
)}`;
const SUBJECT = "cross-process-presentation-subject";
const HMAC_KEY = Uint8Array.from({ length: 32 }, () => 11);

describe("cross-process identity pairing claim presentation", () => {
  it("consumes one canonical claim with one session read and writer call", async () => {
    const session = syntheticSessionPort();
    const writerCalls = [];
    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: RAW_CLAIM, pool: syntheticPool() },
        dependencies({
          session,
          async writer(input) {
            writerCalls.push(input);
            assert.equal(Object.hasOwn(input.pool, "connect"), true);
            assert.equal(input.rawClaim, RAW_CLAIM);
            assert.deepEqual(
              await input.verifiedSessionSubjectPort.read(),
              verifiedEvidence(),
            );
            assert.deepEqual(input.hmacKey, HMAC_KEY);
            return Object.freeze({ result: "consumed", committed: true });
          },
        }),
      );

    assert.deepEqual(result, {
      operation: "cross_process_identity_pairing_claim_presentation_v1",
      result: "consumed",
      committed: true,
      writerInvoked: true,
      retryCount: 0,
    });
    assert.equal(session.readCount(), 1);
    assert.equal(writerCalls.length, 1);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(RAW_CLAIM), false);
    assert.equal(serialized.includes(SUBJECT), false);
  });

  it("blocks malformed claims before reading the session", async () => {
    const session = syntheticSessionPort();
    let writerCalls = 0;
    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: "not-a-claim", pool: syntheticPool() },
        dependencies({
          session,
          async writer() {
            writerCalls += 1;
          },
        }),
      );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "claim_invalid");
    assert.equal(session.readCount(), 0);
    assert.equal(writerCalls, 0);
  });

  it("blocks an unavailable session without invoking the writer", async () => {
    let writerCalls = 0;
    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: RAW_CLAIM, pool: syntheticPool() },
        Object.freeze({
          async createSessionCapability() {
            return Object.freeze({ state: "missing" });
          },
          async consumeIdentityPairingClaim() {
            writerCalls += 1;
          },
        }),
      );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "verified_session_unavailable");
    assert.equal(writerCalls, 0);
  });

  it("returns a secret-free failure when the atomic writer fails", async () => {
    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: RAW_CLAIM, pool: syntheticPool() },
        dependencies({
          session: syntheticSessionPort(),
          async writer() {
            throw new Error(`sensitive ${RAW_CLAIM} ${SUBJECT}`);
          },
        }),
      );

    assert.deepEqual(result, {
      operation: "cross_process_identity_pairing_claim_presentation_v1",
      result: "failed",
      blocker: "identity_consume_failed",
      committed: false,
      writerInvoked: true,
      retryCount: 0,
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(RAW_CLAIM), false);
    assert.equal(serialized.includes(SUBJECT), false);
  });

  it("rejects accessor database ports without invoking the accessor", async () => {
    let accessorReads = 0;
    let sessionReads = 0;
    const pool = {};
    Object.defineProperty(pool, "connect", {
      get() {
        accessorReads += 1;
        return () => {};
      },
    });

    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: RAW_CLAIM, pool },
        Object.freeze({
          async createSessionCapability() {
            sessionReads += 1;
          },
          async consumeIdentityPairingClaim() {},
        }),
      );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "database_port_invalid");
    assert.equal(accessorReads, 0);
    assert.equal(sessionReads, 0);
  });

  it("keeps the runtime adapter separate from issuer and owner assignment", () => {
    const adapter = readFileSync(
      "src/lib/auth/private-cross-process-claim-presentation.ts",
      "utf8",
    );
    const core = readFileSync(
      "scripts/lib/cross-process-identity-pairing-claim-presentation.mjs",
      "utf8",
    );
    const route = readFileSync(
      "src/app/api/identity/bootstrap-claim/present/route.ts",
      "utf8",
    );

    assert.match(adapter, /^import "server-only";/);
    assert.match(adapter, /createPrivateSessionConsumeCapability/);
    assert.match(adapter, /consumeIdentityPairingClaim/);
    assert.match(
      adapter,
      /executeCrossProcessIdentityPairingClaimPresentation/,
    );
    assert.doesNotMatch(
      `${adapter}\n${core}\n${route}`,
      /identity-bootstrap-claim-issuer|legacy-account-owner-assignment-writer/,
    );
    assert.doesNotMatch(
      core,
      /DATABASE_URL|process\.env|@\/db|drizzle|@neondatabase|next\/server/,
    );
    assert.doesNotMatch(
      route,
      /private-verified-session-claim-presentation|private-verified-session-identity-consume/,
    );
  });

  it("keeps policy limits exact", () => {
    assert.deepEqual(
      CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY,
      {
        operation: "cross_process_identity_pairing_claim_presentation_v1",
        claimSource: "canonical_http_request_body",
        clientBindingFields: 0,
        sessionReadsPerAttempt: 1,
        writerInvocationsPerAttempt: 1,
        retryCount: 0,
      },
    );
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

function syntheticPool() {
  return Object.freeze({
    async connect() {
      throw new Error("The synthetic writer should not connect directly");
    },
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

function verifiedEvidence() {
  return Object.freeze({
    state: "verified",
    provider: "neon_auth",
    subject: SUBJECT,
    verificationSource: "server_verified_session",
  });
}
