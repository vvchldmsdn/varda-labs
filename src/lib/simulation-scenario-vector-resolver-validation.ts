import type { TenantContext } from "./session-resolver-contract.ts";
import {
  SIMULATION_APPROVAL_AUDIT_ENVELOPE_VERSION,
  SIMULATION_SCENARIO_SELECTOR_PATTERN,
  SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY,
} from "./simulation-scenario-vector-resolver-policy.ts";
import type {
  SimulationLoadedApprovalValidationResult,
  SimulationOwnerScopedApprovalRecord,
  SimulationScenarioSelector,
  SimulationScenarioVectorRepositoryPortResult,
  SimulationScenarioVectorResolverBlockerReason,
} from "./simulation-scenario-vector-resolver-types.ts";
import { buildSimulationScenarioVectorReviewPacket } from "./simulation-scenario-vector-review-packet.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CANONICAL_UTC_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const SIMPLE_REPOSITORY_STATES = new Set([
  "not_requested",
  "not_found",
  "not_current",
  "unavailable",
  "collision",
]);

export function isValidSimulationTenantContext(
  value: unknown,
): value is TenantContext {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["ownerUserId", "role"]) &&
    typeof value.ownerUserId === "string" &&
    UUID_PATTERN.test(value.ownerUserId) &&
    (value.role === "user" || value.role === "admin")
  );
}

export function isValidSimulationScenarioSelector(
  value: unknown,
): value is SimulationScenarioSelector {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["scenarioId", "scenarioVersion"]) &&
    typeof value.scenarioId === "string" &&
    typeof value.scenarioVersion === "string" &&
    SIMULATION_SCENARIO_SELECTOR_PATTERN.test(value.scenarioId) &&
    SIMULATION_SCENARIO_SELECTOR_PATTERN.test(value.scenarioVersion)
  );
}

export function isNotRequestedSimulationRepositoryResult(value: unknown) {
  return (
    isRecord(value) &&
    value.state === "not_requested" &&
    hasExactKeys(value, ["state"])
  );
}

export function isNormalizedSimulationRepositoryResult(
  value: unknown,
): value is SimulationScenarioVectorRepositoryPortResult {
  if (!isRecord(value) || typeof value.state !== "string") return false;

  if (SIMPLE_REPOSITORY_STATES.has(value.state)) {
    return hasExactKeys(value, ["state"]);
  }

  return (
    value.state === "loaded" &&
    hasExactKeys(value, ["state", "record", "auditStatus"]) &&
    isRecord(value.record) &&
    (value.auditStatus === "verified" ||
      value.auditStatus === "invalid" ||
      value.auditStatus === "unavailable")
  );
}

export function validateLoadedSimulationApproval(input: {
  tenantContext: TenantContext;
  selector: SimulationScenarioSelector;
  repositoryResult: Extract<
    SimulationScenarioVectorRepositoryPortResult,
    { state: "loaded" }
  >;
}): SimulationLoadedApprovalValidationResult {
  const { tenantContext, selector, repositoryResult } = input;
  const record = repositoryResult.record as SimulationOwnerScopedApprovalRecord;

  if (record.canonicalOwnerUserId !== tenantContext.ownerUserId) {
    return blocked("loaded_record_owner_mismatch");
  }
  if (
    record.scenarioId !== selector.scenarioId ||
    record.scenarioVersion !== selector.scenarioVersion
  ) {
    return blocked("loaded_record_selector_mismatch");
  }
  if (
    record.portfolioPathPolicyId !==
      SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.portfolioPathPolicyId ||
    record.gate0ApprovalCommit !==
      SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.gate0ApprovalCommit
  ) {
    return blocked("approval_policy_mismatch");
  }
  if (
    record.scenarioVectorHashVersion !==
    SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.scenarioVectorHashVersion
  ) {
    return blocked("scenario_vector_hash_version_mismatch");
  }
  if (record.lifecycleStatus !== "approved") {
    return blocked("approval_lifecycle_invalid");
  }
  if (repositoryResult.auditStatus === "invalid") {
    return blocked("approval_audit_invalid");
  }
  if (repositoryResult.auditStatus === "unavailable") {
    return blocked("approval_audit_unavailable");
  }

  if (!isPositiveSafeInteger(record.approvalRevision)) {
    return blocked("approval_revision_invalid");
  }
  if (!isCanonicalUtcInstant(record.approvedAt)) {
    return blocked("approval_audit_envelope_invalid");
  }

  const auditEnvelope = record.auditEnvelope;
  if (
    !isRecord(auditEnvelope) ||
    !hasExactKeys(auditEnvelope, [
      "version",
      "decisionKind",
      "approvalRevision",
      "approvedAt",
    ]) ||
    auditEnvelope.version !== SIMULATION_APPROVAL_AUDIT_ENVELOPE_VERSION ||
    auditEnvelope.decisionKind !==
      SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.auditDecisionKind
  ) {
    return blocked("approval_audit_envelope_invalid");
  }
  if (
    !isPositiveSafeInteger(auditEnvelope.approvalRevision) ||
    auditEnvelope.approvalRevision !== record.approvalRevision
  ) {
    return blocked("approval_revision_invalid");
  }
  if (
    !isCanonicalUtcInstant(auditEnvelope.approvedAt) ||
    auditEnvelope.approvedAt !== record.approvedAt
  ) {
    return blocked("approval_audit_envelope_invalid");
  }

  const vectorResult = validateScenarioVector(record, selector);
  if (!vectorResult.vector) return blocked(vectorResult.blocker);

  return Object.freeze({
    validated: Object.freeze({
      evidence: Object.freeze({
        portfolioPathPolicyId: record.portfolioPathPolicyId,
        gate0ApprovalCommit: record.gate0ApprovalCommit,
        scenarioId: record.scenarioId,
        scenarioVersion: record.scenarioVersion,
        canonicalVector: vectorResult.vector,
        scenarioVectorHashVersion:
          SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.scenarioVectorHashVersion,
        scenarioVectorHash: vectorResult.scenarioVectorHash,
      }),
    }),
    blocker: null,
  });
}

function validateScenarioVector(
  record: SimulationOwnerScopedApprovalRecord,
  selector: SimulationScenarioSelector,
):
  | {
      vector: readonly Readonly<{
        market: string;
        currency: string;
        ticker: string;
        weightBps: number;
      }>[];
      scenarioVectorHash: string;
      blocker: null;
    }
  | {
      vector: null;
      scenarioVectorHash: null;
      blocker: "scenario_vector_invalid" | "scenario_vector_hash_mismatch";
    } {
  if (
    !Array.isArray(record.canonicalVector) ||
    !record.canonicalVector.every(isExactScenarioVectorRow)
  ) {
    return invalidVector("scenario_vector_invalid");
  }

  const packet = buildSimulationScenarioVectorReviewPacket({
    scenarioId: selector.scenarioId,
    scenarioVersion: selector.scenarioVersion,
    matrixInstruments: record.canonicalVector.map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
    })),
    weights: record.canonicalVector.map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      weightBps: row.weightBps,
    })),
  });

  if (
    packet.status !== "reviewable" ||
    packet.canonicalVector === null ||
    !sameScenarioVectorRows(record.canonicalVector, packet.canonicalVector)
  ) {
    return invalidVector("scenario_vector_invalid");
  }
  if (
    typeof record.scenarioVectorHash !== "string" ||
    !SHA256_PATTERN.test(record.scenarioVectorHash) ||
    packet.scenarioVectorHash !== record.scenarioVectorHash
  ) {
    return invalidVector("scenario_vector_hash_mismatch");
  }

  return {
    vector: Object.freeze(
      packet.canonicalVector.map((row) => Object.freeze({ ...row })),
    ),
    scenarioVectorHash: record.scenarioVectorHash,
    blocker: null,
  };
}

function isExactScenarioVectorRow(value: unknown): value is Readonly<{
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
}> {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["market", "currency", "ticker", "weightBps"]) &&
    typeof value.market === "string" &&
    typeof value.currency === "string" &&
    typeof value.ticker === "string" &&
    typeof value.weightBps === "number"
  );
}

function sameScenarioVectorRows(
  left: readonly Readonly<{
    market: string;
    currency: string;
    ticker: string;
    weightBps: number;
  }>[],
  right: readonly Readonly<{
    market: string;
    currency: string;
    ticker: string;
    weightBps: number;
  }>[],
) {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.market === right[index].market &&
        row.currency === right[index].currency &&
        row.ticker === right[index].ticker &&
        row.weightBps === right[index].weightBps,
    )
  );
}

function invalidVector(
  blocker: "scenario_vector_invalid" | "scenario_vector_hash_mismatch",
) {
  return { vector: null, scenarioVectorHash: null, blocker } as const;
}

function blocked(
  blocker: SimulationScenarioVectorResolverBlockerReason,
): SimulationLoadedApprovalValidationResult {
  return Object.freeze({ validated: null, blocker });
}

function isCanonicalUtcInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !CANONICAL_UTC_INSTANT_PATTERN.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
