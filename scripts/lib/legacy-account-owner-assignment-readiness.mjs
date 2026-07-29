import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import {
  hostError,
  projectOwnerAssignmentChildReadiness,
  projectVerifiedOwnerAssignmentChildStatic,
} from "./legacy-account-owner-assignment-rehearsal-host-policy.mjs";

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_READINESS_POLICY =
  Object.freeze({
    totalTimeoutMs: 30_000,
    maxPolls: 8,
    pollIntervalMs: 4_000,
    controlPlaneReadTimeoutMs: 8_000,
  });
const CHILD_READ_STAGES = new Set([
  "branch_get",
  "endpoint_list_get",
]);
const CHILD_READ_REASONS = new Set([
  "exact_not_found",
  "execution_failed",
  "response_invalid",
  "timeout",
]);

export async function waitForOwnerAssignmentChildReadiness({
  attestChild,
  createdChild,
  target,
  monotonicNow = () => performance.now(),
  sleep = delay,
  policy = LEGACY_ACCOUNT_OWNER_ASSIGNMENT_READINESS_POLICY,
} = {}) {
  assertOptions({
    attestChild,
    createdChild,
    target,
    monotonicNow,
    sleep,
    policy,
  });

  const deadline =
    readMonotonicNow(monotonicNow) + policy.totalTimeoutMs;
  let lastStaticAttestation = null;
  let lastReadDiagnostic = null;
  let completedPolls = 0;

  for (let pollCount = 1; pollCount <= policy.maxPolls; pollCount += 1) {
    const remainingBeforeRead =
      deadline - readMonotonicNow(monotonicNow);
    if (remainingBeforeRead < 1) {
      if (isRetryableVisibilityMiss(lastReadDiagnostic)) {
        return failedReadiness(
          "read_failed",
          completedPolls,
          lastStaticAttestation,
          lastReadDiagnostic,
        );
      }
      return failedReadiness(
        "timeout",
        completedPolls,
        lastStaticAttestation,
      );
    }

    let value;
    try {
      value = await attestChild({
        projectId: target.projectId,
        branchId: createdChild.branchId,
        branchName: createdChild.branchName,
        timeoutMs: Math.max(
          1,
          Math.min(
            policy.controlPlaneReadTimeoutMs,
            Math.floor(remainingBeforeRead),
          ),
        ),
      });
    } catch (error) {
      const readDiagnostic = projectReadDiagnostic(error);
      completedPolls = pollCount;
      lastReadDiagnostic = readDiagnostic;
      if (
        isRetryableVisibilityMiss(readDiagnostic) &&
        pollCount < policy.maxPolls
      ) {
        const remainingAfterRead =
          deadline - readMonotonicNow(monotonicNow);
        if (remainingAfterRead < 1) {
          return failedReadiness(
            "read_failed",
            pollCount,
            lastStaticAttestation,
            readDiagnostic,
          );
        }
        try {
          await sleep(
            Math.max(
              1,
              Math.min(
                policy.pollIntervalMs,
                Math.floor(remainingAfterRead),
              ),
            ),
          );
        } catch {
          return failedReadiness(
            "read_failed",
            pollCount,
            lastStaticAttestation,
          );
        }
        continue;
      }
      return failedReadiness(
        "read_failed",
        pollCount,
        lastStaticAttestation,
        readDiagnostic,
      );
    }
    completedPolls = pollCount;
    lastReadDiagnostic = null;

    let staticAttestation;
    try {
      staticAttestation =
        projectVerifiedOwnerAssignmentChildStatic(value, {
          createdChild,
          expectedProjectId: target.projectId,
          expectedParentBranchId: target.parentBranchId,
          expectedProductionEndpointId:
            target.productionEndpointId,
        });
    } catch {
      return failedReadiness("static_invalid", pollCount, null);
    }
    lastStaticAttestation = staticAttestation;

    const remainingAfterRead =
      deadline - readMonotonicNow(monotonicNow);
    if (remainingAfterRead < 1) {
      return failedReadiness(
        "timeout",
        pollCount,
        staticAttestation,
      );
    }

    let readiness;
    try {
      readiness =
        projectOwnerAssignmentChildReadiness(
          staticAttestation,
        );
    } catch {
      return failedReadiness(
        "state_invalid",
        pollCount,
        staticAttestation,
      );
    }
    if (readiness.outcome === "ready") {
      return Object.freeze({
        status: "ready",
        outcome: "ready",
        pollCount,
        attestation: Object.freeze({
          ...staticAttestation,
          branchReady: true,
          endpointReady: true,
        }),
      });
    }

    if (pollCount === policy.maxPolls) {
      return failedReadiness(
        "timeout",
        pollCount,
        staticAttestation,
      );
    }

    try {
      await sleep(
        Math.max(
          1,
          Math.min(
            policy.pollIntervalMs,
            Math.floor(remainingAfterRead),
          ),
        ),
      );
    } catch {
      return failedReadiness(
        "read_failed",
        pollCount,
        staticAttestation,
      );
    }
  }

  return failedReadiness(
    "timeout",
    completedPolls,
    lastStaticAttestation,
  );
}

function assertOptions({
  attestChild,
  createdChild,
  target,
  monotonicNow,
  sleep,
  policy,
}) {
  if (
    typeof attestChild !== "function" ||
    typeof monotonicNow !== "function" ||
    typeof sleep !== "function" ||
    !createdChild ||
    typeof createdChild !== "object" ||
    !target ||
    typeof target !== "object" ||
    !policy ||
    typeof policy !== "object" ||
    !Number.isInteger(policy.totalTimeoutMs) ||
    policy.totalTimeoutMs < 1 ||
    policy.totalTimeoutMs > 60_000 ||
    !Number.isInteger(policy.maxPolls) ||
    policy.maxPolls < 1 ||
    policy.maxPolls > 32 ||
    !Number.isInteger(policy.pollIntervalMs) ||
    policy.pollIntervalMs < 1 ||
    policy.pollIntervalMs > policy.totalTimeoutMs ||
    !Number.isInteger(policy.controlPlaneReadTimeoutMs) ||
    policy.controlPlaneReadTimeoutMs < 1 ||
    policy.controlPlaneReadTimeoutMs > policy.totalTimeoutMs
  ) {
    throw hostError("host_options_invalid");
  }
}

function readMonotonicNow(monotonicNow) {
  let value;
  try {
    value = monotonicNow();
  } catch {
    throw hostError("host_options_invalid");
  }
  if (!Number.isFinite(value) || value < 0) {
    throw hostError("host_options_invalid");
  }
  return value;
}

function failedReadiness(
  outcome,
  pollCount,
  staticAttestation,
  readDiagnostic = null,
) {
  return Object.freeze({
    status: "failed",
    outcome,
    pollCount,
    staticAttestation,
    ...(readDiagnostic === null ? {} : { readDiagnostic }),
  });
}

function projectReadDiagnostic(error) {
  const stage = readOwnPrimitiveString(error, "stage");
  const reason = readOwnPrimitiveString(error, "reason");
  if (
    !CHILD_READ_STAGES.has(stage) ||
    !CHILD_READ_REASONS.has(reason)
  ) {
    return null;
  }
  return Object.freeze({ stage, reason });
}

function isRetryableVisibilityMiss(readDiagnostic) {
  return readDiagnostic?.reason === "exact_not_found";
}

function readOwnPrimitiveString(value, property) {
  if (!value || typeof value !== "object") return null;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, property);
  } catch {
    return null;
  }
  if (!descriptor || !("value" in descriptor)) return null;
  return typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}
