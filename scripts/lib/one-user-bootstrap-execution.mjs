import { isCanonicalIdentityBootstrapClaim } from "../../src/lib/identity-bootstrap-claim.ts";
import {
  assertSha256Fingerprint,
  OneUserBootstrapExecutionError,
  readRequiredMethod,
  readRequiredObject,
  readRequiredString,
  readSessionBinding,
  safeErrorCode,
} from "./one-user-bootstrap-binding.mjs";
import {
  readCheckpoint,
  readIssueReceipt,
  readPresentationReceipt,
  readWriterReceipt,
} from "./one-user-bootstrap-receipts.mjs";

export { OneUserBootstrapExecutionError };

export const ONE_USER_BOOTSTRAP_EXECUTION_POLICY = Object.freeze({
  operation: "one_user_bootstrap_execution_v1",
  phaseOrder: Object.freeze([
    "claim_issue",
    "claim_presentation",
    "identity_consume",
    "post_consume_check",
    "account_owner_assignment",
    "final_check",
  ]),
  crossPhaseTransaction: false,
  retryCount: 0,
});

export async function startOneUserBootstrapExecution(input) {
  const targetAppUserSha256 = readRequiredString(
    input,
    "targetAppUserSha256",
    "target_app_user_fingerprint_invalid",
  );
  assertSha256Fingerprint(
    targetAppUserSha256,
    "target_app_user_fingerprint_invalid",
  );

  const claimIssuerPort = readRequiredObject(
    input,
    "claimIssuerPort",
    "claim_issuer_port_invalid",
  );
  const issue = readRequiredMethod(
    claimIssuerPort,
    "issue",
    "claim_issuer_port_invalid",
  );
  const take = readRequiredMethod(
    claimIssuerPort,
    "take",
    "claim_issuer_port_invalid",
  );
  const claimPresentationPort = readRequiredObject(
    input,
    "claimPresentationPort",
    "claim_presentation_port_invalid",
  );
  const present = readRequiredMethod(
    claimPresentationPort,
    "present",
    "claim_presentation_port_invalid",
  );

  let issued;
  let claimBinding;
  try {
    issued = await Reflect.apply(issue, claimIssuerPort, [
      Object.freeze({ targetAppUserSha256 }),
    ]);
    claimBinding = readIssueReceipt(issued, targetAppUserSha256);
  } catch (error) {
    return partialResult({
      failedPhase: "claim_issue",
      blocker: safeErrorCode(error, "claim_issue_failed"),
      committedPhases: [],
      executionBinding: null,
    });
  }

  let privateContinuation;
  try {
    privateContinuation = await Reflect.apply(take, claimIssuerPort, [
      issued,
    ]);
    const rawClaim = readRequiredString(
      privateContinuation,
      "rawClaim",
      "claim_continuation_invalid",
    );
    if (!isCanonicalIdentityBootstrapClaim(rawClaim)) {
      throw new OneUserBootstrapExecutionError(
        "claim_continuation_invalid",
      );
    }

    const presentation = await Reflect.apply(
      present,
      claimPresentationPort,
      [
        Object.freeze({
          rawClaim,
          executionBinding: claimBinding,
        }),
      ],
    );
    const executionBinding = readPresentationReceipt(
      presentation,
      claimBinding,
    );

    return Object.freeze({
      operation: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.operation,
      result: "claim_presented",
      executionBinding,
      committedPhases: Object.freeze([
        "claim_issue",
        "claim_presentation",
      ]),
      nextPhase: "identity_consume",
      retryCount: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.retryCount,
    });
  } catch (error) {
    return partialResult({
      failedPhase: "claim_presentation",
      blocker: safeErrorCode(error, "claim_presentation_failed"),
      committedPhases: ["claim_issue"],
      executionBinding: claimBinding,
    });
  } finally {
    privateContinuation = null;
  }
}

export async function finishOneUserBootstrapExecution(input) {
  const expectedSessionBinding = readSessionBinding(
    readRequiredObject(
      input,
      "executionBinding",
      "execution_binding_invalid",
    ),
  );
  const checkpointPort = readRequiredObject(
    input,
    "checkpointPort",
    "checkpoint_port_invalid",
  );
  const readCheckpointMethod = readRequiredMethod(
    checkpointPort,
    "read",
    "checkpoint_port_invalid",
  );
  const identityConsumePort = readRequiredObject(
    input,
    "identityConsumePort",
    "identity_consume_port_invalid",
  );
  const consume = readRequiredMethod(
    identityConsumePort,
    "consume",
    "identity_consume_port_invalid",
  );
  const accountAssignmentPort = readRequiredObject(
    input,
    "accountAssignmentPort",
    "account_assignment_port_invalid",
  );
  const assign = readRequiredMethod(
    accountAssignmentPort,
    "assign",
    "account_assignment_port_invalid",
  );

  let checkpoint;
  try {
    checkpoint = await readCheckpoint({
      checkpointPort,
      readCheckpointMethod,
      expectedSessionBinding,
      expectedFullBinding: null,
    });
  } catch (error) {
    return partialResult({
      failedPhase: "initial_check",
      blocker: safeErrorCode(error, "initial_checkpoint_failed"),
      committedPhases: [],
      executionBinding: expectedSessionBinding,
    });
  }

  const executionBinding = checkpoint.executionBinding;
  const committedPhases = [];
  let identityResult = "already_consumed";
  if (checkpoint.state === "owner_assignment_complete") {
    return completedResult({
      identityResult,
      assignmentResult: "already_applied",
      executionBinding,
    });
  }

  if (checkpoint.state === "awaiting_consume") {
    try {
      const consumed = await Reflect.apply(consume, identityConsumePort, [
        Object.freeze({ executionBinding }),
      ]);
      readWriterReceipt({
        receipt: consumed,
        allowedResults: ["consumed"],
        expectedBinding: executionBinding,
        invalidCode: "identity_consume_result_invalid",
      });
      committedPhases.push("identity_consume");
      identityResult = "consumed";
    } catch (error) {
      return partialResult({
        failedPhase: "identity_consume",
        blocker: safeErrorCode(error, "identity_consume_failed"),
        committedPhases,
        executionBinding,
      });
    }
  } else {
    committedPhases.push("identity_consume");
  }

  try {
    checkpoint = await readCheckpoint({
      checkpointPort,
      readCheckpointMethod,
      expectedSessionBinding,
      expectedFullBinding: executionBinding,
    });
  } catch (error) {
    return partialResult({
      failedPhase: "post_consume_check",
      blocker: safeErrorCode(error, "post_consume_checkpoint_failed"),
      committedPhases,
      executionBinding,
    });
  }
  if (checkpoint.state === "owner_assignment_complete") {
    return completedResult({
      identityResult,
      assignmentResult: "already_applied",
      executionBinding,
    });
  }
  if (checkpoint.state !== "consumed_active") {
    return partialResult({
      failedPhase: "post_consume_check",
      blocker: "post_consume_state_invalid",
      committedPhases,
      executionBinding,
    });
  }

  let assignmentResult;
  try {
    const assignment = await Reflect.apply(assign, accountAssignmentPort, [
      Object.freeze({ executionBinding }),
    ]);
    assignmentResult = readWriterReceipt({
      receipt: assignment,
      allowedResults: ["assigned", "already_applied"],
      expectedBinding: executionBinding,
      invalidCode: "account_assignment_result_invalid",
    });
    committedPhases.push("account_owner_assignment");
  } catch (error) {
    return partialResult({
      failedPhase: "account_owner_assignment",
      blocker: safeErrorCode(
        error,
        "account_owner_assignment_failed",
      ),
      committedPhases,
      executionBinding,
    });
  }

  try {
    checkpoint = await readCheckpoint({
      checkpointPort,
      readCheckpointMethod,
      expectedSessionBinding,
      expectedFullBinding: executionBinding,
    });
  } catch (error) {
    return partialResult({
      failedPhase: "final_check",
      blocker: safeErrorCode(error, "final_checkpoint_failed"),
      committedPhases,
      executionBinding,
    });
  }
  if (checkpoint.state !== "owner_assignment_complete") {
    return partialResult({
      failedPhase: "final_check",
      blocker: "final_state_invalid",
      committedPhases,
      executionBinding,
    });
  }

  return completedResult({
    identityResult,
    assignmentResult,
    executionBinding,
  });
}

function completedResult({
  identityResult,
  assignmentResult,
  executionBinding,
}) {
  return Object.freeze({
    operation: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.operation,
    result: "completed",
    identityResult,
    assignmentResult,
    executionBinding,
    committedPhases: Object.freeze([
      "identity_consume",
      "account_owner_assignment",
    ]),
    retryCount: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.retryCount,
  });
}

function partialResult({
  failedPhase,
  blocker,
  committedPhases,
  executionBinding,
}) {
  const result = {
    operation: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.operation,
    result: "partial",
    failedPhase,
    blocker,
    committedPhases: Object.freeze([...committedPhases]),
    crossPhaseRollbackAttempted: false,
    restartRequired: committedPhases.length > 0,
    retryCount: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.retryCount,
  };
  if (executionBinding !== null) {
    result.executionBinding = executionBinding;
  }
  return Object.freeze(result);
}
