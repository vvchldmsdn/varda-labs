import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  finishOneUserBootstrapExecution,
  startOneUserBootstrapExecution,
} from "../scripts/lib/one-user-bootstrap-execution.mjs";

describe("one-user bootstrap execution", () => {
  it("issues and presents a claim without exposing the private continuation", async () => {
    const privateValue = Object.freeze({
      identityPairingIntentId: "internal-intent",
      rawClaim: "private-claim",
    });
    let presented = null;
    const result = await startOneUserBootstrapExecution({
      claimIssuerPort: {
        async issue() {
          return {
            result: "issued",
            continuation: {
              take() {
                return privateValue;
              },
            },
          };
        },
      },
      claimPresentationPort: {
        async present(value) {
          presented = value;
        },
      },
    });

    assert.equal(result.result, "claim_presented");
    assert.equal(presented, privateValue);
    assert.doesNotMatch(JSON.stringify(result), /private|internal-intent/);
  });

  it("keeps phase one committed when account assignment fails", async () => {
    const states = ["awaiting_consume", "consumed_active"];
    const result = await finishOneUserBootstrapExecution({
      checkpointPort: sequencePort(states),
      identityConsumePort: {
        async consume() {
          return { result: "consumed", committed: true };
        },
      },
      accountAssignmentPort: {
        async assign() {
          throw codedError("account_evidence_digest_drift");
        },
      },
    });

    assert.deepEqual(result, {
      operation: "one_user_bootstrap_execution_v1",
      result: "partial",
      failedPhase: "account_owner_assignment",
      blocker: "account_evidence_digest_drift",
      committedPhases: ["identity_consume"],
      crossPhaseRollbackAttempted: false,
      restartRequired: true,
      retryCount: 0,
    });
  });

  it("resumes after consume and completes an idempotent assignment", async () => {
    let consumeCalls = 0;
    const result = await finishOneUserBootstrapExecution({
      checkpointPort: sequencePort([
        "consumed_active",
        "consumed_active",
        "owner_assignment_complete",
      ]),
      identityConsumePort: {
        async consume() {
          consumeCalls += 1;
          throw new Error("must not run");
        },
      },
      accountAssignmentPort: {
        async assign() {
          return { result: "assigned", committed: true };
        },
      },
    });

    assert.equal(result.result, "completed");
    assert.equal(result.identityResult, "already_consumed");
    assert.equal(result.assignmentResult, "assigned");
    assert.equal(consumeCalls, 0);
  });

  it("blocks foreign-owner evidence without attempting a rollback", async () => {
    const result = await finishOneUserBootstrapExecution({
      checkpointPort: sequencePort([
        "consumed_active",
        "consumed_active",
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
      checkpointPort: sequencePort(["owner_assignment_complete"]),
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
});

function sequencePort(states) {
  let index = 0;
  return {
    async read() {
      const state = states[Math.min(index, states.length - 1)];
      index += 1;
      return { state };
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

function codedError(code) {
  return Object.assign(new Error(code), { code });
}
