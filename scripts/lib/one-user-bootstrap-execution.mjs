export const ONE_USER_BOOTSTRAP_EXECUTION_POLICY = Object.freeze({
  operation: "one_user_bootstrap_execution_v1",
  phaseOrder: Object.freeze([
    "claim_issue",
    "identity_consume",
    "post_consume_check",
    "account_owner_assignment",
    "final_check",
  ]),
  crossPhaseTransaction: false,
  retryCount: 0,
});

const CHECKPOINT_STATES = new Set([
  "awaiting_consume",
  "consumed_active",
  "owner_assignment_complete",
]);

export class OneUserBootstrapExecutionError extends Error {
  constructor(code) {
    super("One-user bootstrap execution failed");
    this.name = "OneUserBootstrapExecutionError";
    this.code = code;
  }
}

export async function startOneUserBootstrapExecution({
  claimIssuerPort,
  claimPresentationPort,
}) {
  assertPort(claimIssuerPort, "issue", "claim_issuer_port_invalid");
  assertPort(
    claimPresentationPort,
    "present",
    "claim_presentation_port_invalid",
  );

  let issued;
  try {
    issued = await claimIssuerPort.issue();
  } catch (error) {
    return partialResult({
      failedPhase: "claim_issue",
      blocker: errorCode(error, "claim_issue_failed"),
      committedPhases: [],
    });
  }
  if (
    issued?.result !== "issued" ||
    typeof issued.continuation?.take !== "function"
  ) {
    return partialResult({
      failedPhase: "claim_issue",
      blocker: "claim_issue_result_invalid",
      committedPhases: [],
    });
  }

  let privateContinuation;
  try {
    privateContinuation = issued.continuation.take();
    await claimPresentationPort.present(privateContinuation);
  } catch (error) {
    return partialResult({
      failedPhase: "claim_presentation",
      blocker: errorCode(error, "claim_presentation_failed"),
      committedPhases: ["claim_issue"],
    });
  } finally {
    privateContinuation = null;
  }

  return Object.freeze({
    operation: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.operation,
    result: "claim_presented",
    committedPhases: Object.freeze(["claim_issue"]),
    nextPhase: "identity_consume",
    retryCount: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.retryCount,
  });
}

export async function finishOneUserBootstrapExecution({
  checkpointPort,
  identityConsumePort,
  accountAssignmentPort,
}) {
  assertPort(checkpointPort, "read", "checkpoint_port_invalid");
  assertPort(
    identityConsumePort,
    "consume",
    "identity_consume_port_invalid",
  );
  assertPort(
    accountAssignmentPort,
    "assign",
    "account_assignment_port_invalid",
  );

  let checkpoint;
  try {
    checkpoint = await readCheckpoint(checkpointPort);
  } catch (error) {
    return partialResult({
      failedPhase: "initial_check",
      blocker: errorCode(error, "initial_checkpoint_failed"),
      committedPhases: [],
    });
  }

  const committedPhases = [];
  let identityResult = "already_consumed";
  if (checkpoint.state === "owner_assignment_complete") {
    return completedResult({
      identityResult: "already_consumed",
      assignmentResult: "already_applied",
    });
  }

  if (checkpoint.state === "awaiting_consume") {
    try {
      const consumed = await identityConsumePort.consume();
      if (consumed?.result !== "consumed" || consumed.committed !== true) {
        throw new OneUserBootstrapExecutionError(
          "identity_consume_result_invalid",
        );
      }
      committedPhases.push("identity_consume");
      identityResult = "consumed";
    } catch (error) {
      return partialResult({
        failedPhase: "identity_consume",
        blocker: errorCode(error, "identity_consume_failed"),
        committedPhases,
      });
    }
  } else {
    committedPhases.push("identity_consume");
  }

  try {
    checkpoint = await readCheckpoint(checkpointPort);
  } catch (error) {
    return partialResult({
      failedPhase: "post_consume_check",
      blocker: errorCode(error, "post_consume_checkpoint_failed"),
      committedPhases,
    });
  }
  if (checkpoint.state === "owner_assignment_complete") {
    return completedResult({
      identityResult: "already_consumed",
      assignmentResult: "already_applied",
    });
  }
  if (checkpoint.state !== "consumed_active") {
    return partialResult({
      failedPhase: "post_consume_check",
      blocker: "post_consume_state_invalid",
      committedPhases,
    });
  }

  let assignment;
  try {
    assignment = await accountAssignmentPort.assign();
    if (
      !["assigned", "already_applied"].includes(assignment?.result) ||
      assignment.committed !== true
    ) {
      throw new OneUserBootstrapExecutionError(
        "account_assignment_result_invalid",
      );
    }
    committedPhases.push("account_owner_assignment");
  } catch (error) {
    return partialResult({
      failedPhase: "account_owner_assignment",
      blocker: errorCode(error, "account_owner_assignment_failed"),
      committedPhases,
    });
  }

  try {
    checkpoint = await readCheckpoint(checkpointPort);
  } catch (error) {
    return partialResult({
      failedPhase: "final_check",
      blocker: errorCode(error, "final_checkpoint_failed"),
      committedPhases,
    });
  }
  if (checkpoint.state !== "owner_assignment_complete") {
    return partialResult({
      failedPhase: "final_check",
      blocker: "final_state_invalid",
      committedPhases,
    });
  }

  return completedResult({
    identityResult,
    assignmentResult: assignment.result,
  });
}

async function readCheckpoint(checkpointPort) {
  const checkpoint = await checkpointPort.read();
  if (
    checkpoint === null ||
    typeof checkpoint !== "object" ||
    !CHECKPOINT_STATES.has(checkpoint.state)
  ) {
    throw new OneUserBootstrapExecutionError(
      "checkpoint_result_invalid",
    );
  }
  return checkpoint;
}

function completedResult({ identityResult, assignmentResult }) {
  return Object.freeze({
    operation: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.operation,
    result: "completed",
    identityResult,
    assignmentResult,
    committedPhases: Object.freeze([
      "identity_consume",
      "account_owner_assignment",
    ]),
    retryCount: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.retryCount,
  });
}

function partialResult({ failedPhase, blocker, committedPhases }) {
  return Object.freeze({
    operation: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.operation,
    result: "partial",
    failedPhase,
    blocker,
    committedPhases: Object.freeze([...committedPhases]),
    crossPhaseRollbackAttempted: false,
    restartRequired: committedPhases.length > 0,
    retryCount: ONE_USER_BOOTSTRAP_EXECUTION_POLICY.retryCount,
  });
}

function assertPort(port, method, code) {
  if (!port || typeof port[method] !== "function") {
    throw new OneUserBootstrapExecutionError(code);
  }
}

function errorCode(error, fallback) {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : fallback;
}
