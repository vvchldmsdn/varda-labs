import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  executeVerifiedSessionClaimPresentation,
  VERIFIED_SESSION_CLAIM_PRESENTATION_POLICY,
} from "../scripts/lib/verified-session-claim-presentation.mjs";
import {
  OneUserBootstrapExecutionError,
  startOneUserBootstrapExecution,
} from "../scripts/lib/one-user-bootstrap-execution.mjs";

const TARGET_SHA256 = `sha256:${"1".repeat(64)}`;
const CLAIM_DIGEST =
  `bootstrap-claim-sha256-v1:${"2".repeat(64)}`;
const INTENT_SHA256 = `sha256:${"3".repeat(64)}`;
const SUBJECT_BINDING = `hmac-sha256-v1:${"4".repeat(64)}`;
const RAW_CLAIM = `varda-bootstrap-claim-v1.${"A".repeat(43)}`;
const RAW_SUBJECT = "user_raw_subject_must_not_escape";

const CLAIM_BINDING = Object.freeze({
  targetAppUserSha256: TARGET_SHA256,
  provider: "neon_auth",
  claimDigestVersion: "bootstrap_claim_sha256_v1",
  claimDigest: CLAIM_DIGEST,
  identityPairingIntentSha256: INTENT_SHA256,
});
const SESSION_BINDING = Object.freeze({
  ...CLAIM_BINDING,
  subjectBindingVersion: "provider_subject_hmac_sha256_v1",
  subjectBinding: SUBJECT_BINDING,
});

describe("verified-session claim presentation adapter", () => {
  it("reads one verified session before issuer creation and binds the private presentation", async () => {
    const calls = {
      session: 0,
      factory: 0,
      issue: 0,
      take: 0,
      presentation: 0,
    };
    const issued = issueReceipt();
    const result = await executeVerifiedSessionClaimPresentation(
      {
        targetAppUserSha256: TARGET_SHA256,
        createClaimIssuerPort() {
          calls.factory += 1;
          return {
            async issue(input) {
              calls.issue += 1;
              assert.deepEqual(input, {
                targetAppUserSha256: TARGET_SHA256,
              });
              return issued;
            },
            take(receipt) {
              calls.take += 1;
              assert.equal(receipt, issued);
              return Object.freeze({ rawClaim: RAW_CLAIM });
            },
          };
        },
        privateClaimPresentationPort: {
          async present(input) {
            calls.presentation += 1;
            assert.equal(Object.isFrozen(input), true);
            assert.equal(input.rawClaim, RAW_CLAIM);
            assert.deepEqual(input.executionBinding, CLAIM_BINDING);
            assert.equal("subjectBinding" in input.executionBinding, false);
            return Object.freeze({
              result: "presented",
              committed: true,
              executionBinding: Object.freeze({
                ...SESSION_BINDING,
                subjectBinding: `hmac-sha256-v1:${"9".repeat(64)}`,
              }),
            });
          },
        },
      },
      dependencies(async () => {
        calls.session += 1;
        return verifiedSessionBinding({ subject: RAW_SUBJECT });
      }),
    );

    assert.deepEqual(calls, {
      session: 1,
      factory: 1,
      issue: 1,
      take: 1,
      presentation: 1,
    });
    assert.deepEqual(result, {
      operation: "one_user_bootstrap_execution_v1",
      result: "claim_presented",
      executionBinding: SESSION_BINDING,
      committedPhases: ["claim_issue", "claim_presentation"],
      nextPhase: "identity_consume",
      retryCount: 0,
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(RAW_CLAIM), false);
    assert.equal(serialized.includes(RAW_SUBJECT), false);
    assert.equal(Object.isFrozen(result), true);
  });

  it("blocks every non-verified session before issuer creation", async () => {
    for (const [sessionResult, blocker] of [
      [{ state: "disabled" }, "verified_session_disabled"],
      [{ state: "missing" }, "verified_session_missing"],
      [{ state: "unavailable" }, "verified_session_unavailable"],
      [{ state: "unexpected" }, "verified_session_unavailable"],
      [
        {
          state: "verified",
          provider: "neon_auth",
          subjectBindingVersion:
            "provider_subject_hmac_sha256_v1",
          subjectBinding: "invalid",
          verificationSource: "server_verified_session",
        },
        "verified_session_unavailable",
      ],
    ]) {
      let sessionReads = 0;
      let factoryCalls = 0;
      let executionCalls = 0;
      const result = await executeVerifiedSessionClaimPresentation(
        {
          targetAppUserSha256: TARGET_SHA256,
          createClaimIssuerPort() {
            factoryCalls += 1;
            throw new Error("must not run");
          },
          privateClaimPresentationPort: unusedPresentationPort(),
        },
        {
          async readSessionBinding() {
            sessionReads += 1;
            return sessionResult;
          },
          async startExecution() {
            executionCalls += 1;
            throw new Error("must not run");
          },
        },
      );

      assert.deepEqual(result, {
        operation: "verified_session_claim_presentation_v1",
        result: "blocked",
        blocker,
        issuerCapabilityCreated: false,
        claimIssued: false,
        retryCount: 0,
      });
      assert.equal(sessionReads, 1);
      assert.equal(factoryCalls, 0);
      assert.equal(executionCalls, 0);
    }
  });

  it("fails closed when the private session reader throws", async () => {
    let factoryCalls = 0;
    const result = await executeVerifiedSessionClaimPresentation(
      {
        targetAppUserSha256: TARGET_SHA256,
        createClaimIssuerPort() {
          factoryCalls += 1;
        },
        privateClaimPresentationPort: unusedPresentationPort(),
      },
      dependencies(async () => {
        throw new Error("opaque provider failure");
      }),
    );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "verified_session_unavailable");
    assert.equal(factoryCalls, 0);
  });

  it("does not execute accessor-backed configuration", async () => {
    let accessorCalls = 0;
    const input = {
      targetAppUserSha256: TARGET_SHA256,
      privateClaimPresentationPort: unusedPresentationPort(),
    };
    Object.defineProperty(input, "createClaimIssuerPort", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return () => issuerPort();
      },
    });

    await assert.rejects(
      executeVerifiedSessionClaimPresentation(
        input,
        dependencies(async () => verifiedSessionBinding()),
      ),
      (error) =>
        error instanceof OneUserBootstrapExecutionError &&
        error.code === "claim_issuer_factory_invalid",
    );
    assert.equal(accessorCalls, 0);
  });

  it("does not retry issuer capability creation", async () => {
    let sessionReads = 0;
    let factoryCalls = 0;
    const result = await executeVerifiedSessionClaimPresentation(
      {
        targetAppUserSha256: TARGET_SHA256,
        createClaimIssuerPort() {
          factoryCalls += 1;
          throw codedError("database_timeout");
        },
        privateClaimPresentationPort: unusedPresentationPort(),
      },
      dependencies(async () => {
        sessionReads += 1;
        return verifiedSessionBinding();
      }),
    );

    assert.deepEqual(result, {
      operation: "verified_session_claim_presentation_v1",
      result: "partial",
      failedPhase: "claim_issuer_capability",
      blocker: "database_timeout",
      committedPhases: [],
      crossPhaseRollbackAttempted: false,
      restartRequired: false,
      retryCount: 0,
    });
    assert.equal(sessionReads, 1);
    assert.equal(factoryCalls, 1);
  });

  it("keeps a failed presentation receipt out of the returned result", async () => {
    const result = await executeVerifiedSessionClaimPresentation(
      {
        targetAppUserSha256: TARGET_SHA256,
        createClaimIssuerPort() {
          return issuerPort();
        },
        privateClaimPresentationPort: {
          async present() {
            return Object.freeze({
              result: "presented",
              committed: false,
              rawClaim: RAW_CLAIM,
              subject: RAW_SUBJECT,
            });
          },
        },
      },
      dependencies(async () => verifiedSessionBinding()),
    );

    assert.equal(result.result, "partial");
    assert.equal(result.failedPhase, "claim_presentation");
    assert.equal(result.blocker, "claim_presentation_result_invalid");
    assert.deepEqual(result.committedPhases, ["claim_issue"]);
    assert.equal(JSON.stringify(result).includes(RAW_CLAIM), false);
    assert.equal(JSON.stringify(result).includes(RAW_SUBJECT), false);
  });

  it("keeps the concrete adapter server-only and the HTTP route disabled", () => {
    const adapter = readFileSync(
      "src/lib/auth/private-verified-session-claim-presentation.ts",
      "utf8",
    );
    const core = readFileSync(
      "scripts/lib/verified-session-claim-presentation.mjs",
      "utf8",
    );
    const route = readFileSync(
      "src/app/api/identity/bootstrap-claim/present/route.ts",
      "utf8",
    );
    const issuer = readFileSync(
      "scripts/lib/identity-bootstrap-claim-issuer.mjs",
      "utf8",
    );

    assert.match(adapter, /^import "server-only";/);
    assert.match(adapter, /readPrivateSessionSubjectBinding/);
    assert.match(adapter, /startOneUserBootstrapExecution/);
    assert.doesNotMatch(
      adapter,
      /identity-bootstrap-claim-issuer|identity-pairing-consume-writer/,
    );
    assert.doesNotMatch(
      core,
      /DATABASE_URL|process\.env|@\/db|drizzle|identity-bootstrap-claim-issuer/,
    );
    assert.doesNotMatch(
      route,
      /private-verified-session-claim-presentation|executeVerifiedSessionClaimPresentation|readPrivateSessionSubjectBinding/,
    );
    assert.match(
      route,
      /createDisabledIdentityPairingClaimPresentationResponse\(\)/,
    );
    assert.doesNotMatch(
      issuer,
      /readPrivateSessionSubjectBinding|subjectBindingVersion|subjectBinding:/,
    );
    assert.equal(
      VERIFIED_SESSION_CLAIM_PRESENTATION_POLICY.presentationEvidence,
      "same_server_invocation_transient",
    );
  });
});

function dependencies(readSessionBinding) {
  return Object.freeze({
    readSessionBinding,
    startExecution: startOneUserBootstrapExecution,
  });
}

function verifiedSessionBinding(extra = {}) {
  return Object.freeze({
    state: "verified",
    provider: "neon_auth",
    subjectBindingVersion: "provider_subject_hmac_sha256_v1",
    subjectBinding: SUBJECT_BINDING,
    verificationSource: "server_verified_session",
    ...extra,
  });
}

function issueReceipt() {
  return Object.freeze({
    result: "issued",
    committed: true,
    executionBinding: CLAIM_BINDING,
  });
}

function issuerPort() {
  const issued = issueReceipt();
  return Object.freeze({
    async issue() {
      return issued;
    },
    take(receipt) {
      assert.equal(receipt, issued);
      return Object.freeze({ rawClaim: RAW_CLAIM });
    },
  });
}

function unusedPresentationPort() {
  return Object.freeze({
    async present() {
      throw new Error("must not run");
    },
  });
}

function codedError(code) {
  return Object.assign(new Error("opaque"), { code });
}
