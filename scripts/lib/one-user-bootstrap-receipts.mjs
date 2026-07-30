import {
  assertBindingMatches,
  CLAIM_BINDING_KEYS,
  FULL_BINDING_KEYS,
  OneUserBootstrapExecutionError,
  readClaimBinding,
  readFullBinding,
  readRequiredBoolean,
  readRequiredObject,
  readRequiredString,
  readSessionBinding,
  SESSION_BINDING_KEYS,
} from "./one-user-bootstrap-binding.mjs";

const CHECKPOINT_STATES = new Set([
  "awaiting_consume",
  "consumed_active",
  "owner_assignment_complete",
]);

export function readIssueReceipt(
  receipt,
  expectedTargetAppUserSha256,
) {
  if (
    readRequiredString(
      receipt,
      "result",
      "claim_issue_result_invalid",
    ) !== "issued" ||
    readRequiredBoolean(
      receipt,
      "committed",
      "claim_issue_result_invalid",
    ) !== true
  ) {
    throw new OneUserBootstrapExecutionError(
      "claim_issue_result_invalid",
    );
  }
  const binding = readClaimBinding(
    readRequiredObject(
      receipt,
      "executionBinding",
      "claim_issue_result_invalid",
    ),
  );
  if (binding.targetAppUserSha256 !== expectedTargetAppUserSha256) {
    throw new OneUserBootstrapExecutionError(
      "execution_binding_mismatch",
    );
  }
  return binding;
}

export function readPresentationReceipt(
  receipt,
  expectedClaimBinding,
) {
  if (
    readRequiredString(
      receipt,
      "result",
      "claim_presentation_result_invalid",
    ) !== "presented" ||
    readRequiredBoolean(
      receipt,
      "committed",
      "claim_presentation_result_invalid",
    ) !== true
  ) {
    throw new OneUserBootstrapExecutionError(
      "claim_presentation_result_invalid",
    );
  }
  const binding = readSessionBinding(
    readRequiredObject(
      receipt,
      "executionBinding",
      "claim_presentation_result_invalid",
    ),
  );
  assertBindingMatches(binding, expectedClaimBinding, CLAIM_BINDING_KEYS);
  return binding;
}

export async function readCheckpoint({
  checkpointPort,
  readCheckpointMethod,
  expectedSessionBinding,
  expectedFullBinding,
}) {
  const checkpoint = await Reflect.apply(
    readCheckpointMethod,
    checkpointPort,
    [Object.freeze({ executionBinding: expectedSessionBinding })],
  );
  const state = readRequiredString(
    checkpoint,
    "state",
    "checkpoint_result_invalid",
  );
  if (!CHECKPOINT_STATES.has(state)) {
    throw new OneUserBootstrapExecutionError(
      "checkpoint_result_invalid",
    );
  }
  const executionBinding = readFullBinding(
    readRequiredObject(
      checkpoint,
      "executionBinding",
      "checkpoint_result_invalid",
    ),
  );
  assertBindingMatches(
    executionBinding,
    expectedSessionBinding,
    SESSION_BINDING_KEYS,
  );
  if (expectedFullBinding !== null) {
    assertBindingMatches(
      executionBinding,
      expectedFullBinding,
      FULL_BINDING_KEYS,
    );
  }
  return Object.freeze({ state, executionBinding });
}

export function readWriterReceipt({
  receipt,
  allowedResults,
  expectedBinding,
  invalidCode,
}) {
  const result = readRequiredString(receipt, "result", invalidCode);
  if (
    !allowedResults.includes(result) ||
    readRequiredBoolean(receipt, "committed", invalidCode) !== true
  ) {
    throw new OneUserBootstrapExecutionError(invalidCode);
  }
  const binding = readFullBinding(
    readRequiredObject(receipt, "executionBinding", invalidCode),
  );
  assertBindingMatches(binding, expectedBinding, FULL_BINDING_KEYS);
  return result;
}
