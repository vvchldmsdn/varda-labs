import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  finishOneUserBootstrapExecution,
  OneUserBootstrapExecutionError,
  startOneUserBootstrapExecution,
} from "../scripts/lib/one-user-bootstrap-execution.mjs";

const TARGET_SHA256 = `sha256:${"1".repeat(64)}`;
const CLAIM_DIGEST =
  `bootstrap-claim-sha256-v1:${"2".repeat(64)}`;
const INTENT_SHA256 = `sha256:${"3".repeat(64)}`;
const SUBJECT_BINDING = `hmac-sha256-v1:${"4".repeat(64)}`;
const CANDIDATE_SET_DIGEST = `sha256:${"5".repeat(64)}`;
const ELIGIBLE_SET_DIGEST = `sha256:${"6".repeat(64)}`;
const RAW_CLAIM = `varda-bootstrap-claim-v1.${"A".repeat(43)}`;

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
const FULL_BINDING = Object.freeze({
  ...SESSION_BINDING,
  candidateSetDigest: CANDIDATE_SET_DIGEST,
  eligibleSetDigest: ELIGIBLE_SET_DIGEST,
});

describe("one-user bootstrap execution", () => {
  it("requires committed issue and presentation receipts without exposing raw material", async () => {
    let presented = null;
    const issued = issueReceipt();
    const result = await startOneUserBootstrapExecution({
      targetAppUserSha256: TARGET_SHA256,
      claimIssuerPort: {
        async issue(input) {
          assert.deepEqual(input, {
            targetAppUserSha256: TARGET_SHA256,
          });
          return issued;
        },
        take(receipt) {
          assert.equal(receipt, issued);
          return Object.freeze({ rawClaim: RAW_CLAIM });
        },
      },
      claimPresentationPort: {
        async present(input) {
          presented = input;
          return presentationReceipt();
        },
      },
    });

    assert.equal(presented.rawClaim, RAW_CLAIM);
    assert.deepEqual(presented.executionBinding, CLAIM_BINDING);
    assert.deepEqual(result, {
      operation: "one_user_bootstrap_execution_v1",
      result: "claim_presented",
      executionBinding: SESSION_BINDING,
      committedPhases: ["claim_issue", "claim_presentation"],
      nextPhase: "identity_consume",
      retryCount: 0,
    });
    assert.equal(JSON.stringify(result).includes(RAW_CLAIM), false);
  });

  it("does not take claim material from an uncommitted issue receipt", async () => {
    let takeCalls = 0;
    const result = await startOneUserBootstrapExecution({
      targetAppUserSha256: TARGET_SHA256,
      claimIssuerPort: {
        async issue() {
          return issueReceipt({ committed: false });
        },
        take() {
          takeCalls += 1;
        },
      },
      claimPresentationPort: unusedPresentationPort(),
    });

    assert.equal(result.result, "partial");
    assert.equal(result.failedPhase, "claim_issue");
    assert.equal(result.blocker, "claim_issue_result_invalid");
    assert.equal(takeCalls, 0);
  });

  it("does not accept a missing or mismatched presentation receipt", async () => {
    for (const [presentation, blocker] of [
      [undefined, "claim_presentation_result_invalid"],
      [
        presentationReceipt({
          executionBinding: {
            ...SESSION_BINDING,
            identityPairingIntentSha256: `sha256:${"9".repeat(64)}`,
          },
        }),
        "execution_binding_mismatch",
      ],
    ]) {
      const result = await startOneUserBootstrapExecution({
        targetAppUserSha256: TARGET_SHA256,
        claimIssuerPort: issuerPort(),
        claimPresentationPort: {
          async present() {
            return presentation;
          },
        },
      });

      assert.equal(result.result, "partial");
      assert.equal(result.failedPhase, "claim_presentation");
      assert.equal(result.blocker, blocker);
      assert.deepEqual(result.committedPhases, ["claim_issue"]);
    }
  });

  it("keeps identity consume committed when account assignment fails", async () => {
    const result = await finishOneUserBootstrapExecution({
      executionBinding: SESSION_BINDING,
      checkpointPort: sequencePort([
        checkpoint("awaiting_consume"),
        checkpoint("consumed_active"),
      ]),
      identityConsumePort: consumePort(),
      accountAssignmentPort: {
        async assign() {
          throw codedError("account_evidence_digest_drift");
        },
      },
    });

    assert.equal(result.result, "partial");
    assert.equal(result.failedPhase, "account_owner_assignment");
    assert.equal(result.blocker, "account_evidence_digest_drift");
    assert.deepEqual(result.committedPhases, ["identity_consume"]);
    assert.equal(result.crossPhaseRollbackAttempted, false);
    assert.deepEqual(result.executionBinding, FULL_BINDING);
  });

  it("resumes after consume and completes an idempotent assignment", async () => {
    let consumeCalls = 0;
    const result = await finishOneUserBootstrapExecution({
      executionBinding: SESSION_BINDING,
      checkpointPort: sequencePort([
        checkpoint("consumed_active"),
        checkpoint("consumed_active"),
        checkpoint("owner_assignment_complete"),
      ]),
      identityConsumePort: {
        async consume() {
          consumeCalls += 1;
          throw new Error("must not run");
        },
      },
      accountAssignmentPort: assignmentPort("assigned"),
    });

    assert.equal(result.result, "completed");
    assert.equal(result.identityResult, "already_consumed");
    assert.equal(result.assignmentResult, "assigned");
    assert.equal(consumeCalls, 0);
    assert.deepEqual(result.executionBinding, FULL_BINDING);
  });

  it("blocks foreign-owner evidence without attempting a rollback", async () => {
    const result = await finishOneUserBootstrapExecution({
      executionBinding: SESSION_BINDING,
      checkpointPort: sequencePort([
        checkpoint("consumed_active"),
        checkpoint("consumed_active"),
      ]),
      identityConsumePort: unusedConsumePort(),
      accountAssignmentPort: {
        async assign() {
          throw codedError("foreign_owner_conflict");
        },
      },
    });

    assert.equal(result.result, "partial");
    assert.equal(result.blocker, "foreign_owner_conflict");
    assert.equal(result.crossPhaseRollbackAttempted, false);
    assert.deepEqual(result.committedPhases, ["identity_consume"]);
  });

  it("accepts a fully applied restart without running either writer", async () => {
    let writerCalls = 0;
    const result = await finishOneUserBootstrapExecution({
      executionBinding: SESSION_BINDING,
      checkpointPort: sequencePort([
        checkpoint("owner_assignment_complete"),
      ]),
      identityConsumePort: {
        async consume() {
          writerCalls += 1;
        },
      },
      accountAssignmentPort: {
        async assign() {
          writerCalls += 1;
        },
      },
    });

    assert.equal(result.result, "completed");
    assert.equal(result.assignmentResult, "already_applied");
    assert.equal(writerCalls, 0);
  });

  it("blocks phase drift when a later checkpoint changes account evidence", async () => {
    const result = await finishOneUserBootstrapExecution({
      executionBinding: SESSION_BINDING,
      checkpointPort: sequencePort([
        checkpoint("awaiting_consume"),
        checkpoint("consumed_active", {
          ...FULL_BINDING,
          eligibleSetDigest: `sha256:${"7".repeat(64)}`,
        }),
      ]),
      identityConsumePort: consumePort(),
      accountAssignmentPort: assignmentPort("assigned"),
    });

    assert.equal(result.result, "partial");
    assert.equal(result.failedPhase, "post_consume_check");
    assert.equal(result.blocker, "execution_binding_mismatch");
  });

  it("does not invoke accessor-backed port methods, result fields, or error codes", async () => {
    let accessorCalls = 0;
    const claimIssuerPort = {
      take() {
        throw new Error("must not run");
      },
    };
    Object.defineProperty(claimIssuerPort, "issue", {
      get() {
        accessorCalls += 1;
        return async () => issueReceipt();
      },
    });
    await assert.rejects(
      startOneUserBootstrapExecution({
        targetAppUserSha256: TARGET_SHA256,
        claimIssuerPort,
        claimPresentationPort: unusedPresentationPort(),
      }),
      (error) =>
        error instanceof OneUserBootstrapExecutionError &&
        error.code === "claim_issuer_port_invalid",
    );

    const accessorCheckpoint = { executionBinding: FULL_BINDING };
    Object.defineProperty(accessorCheckpoint, "state", {
      get() {
        accessorCalls += 1;
        return "consumed_active";
      },
    });
    const checkpointResult = await finishOneUserBootstrapExecution({
      executionBinding: SESSION_BINDING,
      checkpointPort: sequencePort([accessorCheckpoint]),
      identityConsumePort: unusedConsumePort(),
      accountAssignmentPort: assignmentPort("assigned"),
    });
    assert.equal(checkpointResult.blocker, "checkpoint_result_invalid");

    const error = new Error("blocked");
    Object.defineProperty(error, "code", {
      get() {
        accessorCalls += 1;
        return "foreign_owner_conflict";
      },
    });
    const errorResult = await finishOneUserBootstrapExecution({
      executionBinding: SESSION_BINDING,
      checkpointPort: sequencePort([
        checkpoint("consumed_active"),
        checkpoint("consumed_active"),
      ]),
      identityConsumePort: unusedConsumePort(),
      accountAssignmentPort: {
        async assign() {
          throw error;
        },
      },
    });
    assert.equal(
      errorResult.blocker,
      "account_owner_assignment_failed",
    );
    assert.equal(accessorCalls, 0);
  });
});

function issueReceipt(overrides = {}) {
  return {
    result: "issued",
    committed: true,
    executionBinding: CLAIM_BINDING,
    ...overrides,
  };
}

function presentationReceipt(overrides = {}) {
  return {
    result: "presented",
    committed: true,
    executionBinding: SESSION_BINDING,
    ...overrides,
  };
}

function issuerPort() {
  const receipt = issueReceipt();
  return {
    async issue() {
      return receipt;
    },
    take() {
      return Object.freeze({ rawClaim: RAW_CLAIM });
    },
  };
}

function checkpoint(state, executionBinding = FULL_BINDING) {
  return { state, executionBinding };
}

function sequencePort(results) {
  let index = 0;
  return {
    async read() {
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      return result;
    },
  };
}

function consumePort() {
  return {
    async consume({ executionBinding }) {
      assert.deepEqual(executionBinding, FULL_BINDING);
      return {
        result: "consumed",
        committed: true,
        executionBinding: FULL_BINDING,
      };
    },
  };
}

function unusedConsumePort() {
  return {
    async consume() {
      throw new Error("must not run");
    },
  };
}

function assignmentPort(result) {
  return {
    async assign({ executionBinding }) {
      assert.deepEqual(executionBinding, FULL_BINDING);
      return {
        result,
        committed: true,
        executionBinding: FULL_BINDING,
      };
    },
  };
}

function unusedPresentationPort() {
  return {
    async present() {
      throw new Error("must not run");
    },
  };
}

function codedError(code) {
  return Object.assign(new Error(code), { code });
}
