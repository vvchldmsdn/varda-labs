import {
  SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY,
  SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_SELECTOR_PATTERN,
  SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_SHA256_PATTERN,
  SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_UTC_PATTERN,
  SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_UUID_PATTERN,
  compareSimulationCuratedApprovedVectorRecordV2Rows,
} from "./simulation-curated-approved-vector-record-policy.ts";
import {
  snapshotSimulationCuratedApprovedVectorArray,
  snapshotSimulationCuratedApprovedVectorRecord,
} from "./simulation-curated-approved-vector-record-snapshot.ts";
import type {
  SimulationCuratedApprovedVectorRecordV2Blocker,
  SimulationCuratedApprovedVectorRecordV2Evaluation,
} from "./simulation-curated-approved-vector-record-types.ts";
import {
  createSimulationScenarioVectorHashV2,
  type SimulationScenarioVectorHashV2InputRow,
} from "./simulation-scenario-vector-hash-v2.ts";

const INPUT_FIELDS = Object.freeze([
  "expectedOwnerUserId",
  "selector",
  "record",
] as const);
const SELECTOR_FIELDS = Object.freeze([
  "scenarioId",
  "scenarioVersion",
] as const);
const RECORD_FIELDS = Object.freeze([
  "id",
  "ownerUserId",
  "portfolioPathPolicyId",
  "gate0ApprovalCommit",
  "scenarioId",
  "scenarioVersion",
  "approvalRevision",
  "scenarioVectorHashVersion",
  "scenarioVectorHash",
  "approvedAt",
  "lifecycleStatus",
  "terminalAt",
  "vectorRows",
  "lifecycleEvents",
] as const);
const VECTOR_ROW_FIELDS = Object.freeze([
  "approvalRevisionId",
  "market",
  "currency",
  "ticker",
  "weightBps",
] as const);
const LIFECYCLE_EVENT_FIELDS = Object.freeze([
  "approvalRevisionId",
  "eventSequence",
  "auditVersion",
  "transitionKind",
  "previousStatus",
  "resultingStatus",
  "transitionedAt",
  "replacementRevisionId",
] as const);

export function evaluateSimulationCuratedApprovedVectorRecordV2(
  input: unknown,
): SimulationCuratedApprovedVectorRecordV2Evaluation {
  const outer = snapshotSimulationCuratedApprovedVectorRecord(
    input,
    INPUT_FIELDS,
  );
  if (!outer) return blocked("invalid_input_shape");

  if (!isUuid(outer.expectedOwnerUserId)) {
    return blocked("expected_owner_invalid");
  }

  const selector = snapshotSimulationCuratedApprovedVectorRecord(
    outer.selector,
    SELECTOR_FIELDS,
  );
  if (
    !selector ||
    !isSelector(selector.scenarioId) ||
    !isSelector(selector.scenarioVersion)
  ) {
    return blocked("scenario_selector_invalid");
  }

  const record = snapshotSimulationCuratedApprovedVectorRecord(
    outer.record,
    RECORD_FIELDS,
    ["scenarioVectorHashVersion"],
  );
  if (!record) return blocked("invalid_input_shape");

  if (!isUuid(record.id) || !isUuid(record.ownerUserId)) {
    return blocked("approval_identity_invalid");
  }
  if (record.ownerUserId !== outer.expectedOwnerUserId) {
    return blocked("approval_owner_mismatch");
  }
  if (
    record.scenarioId !== selector.scenarioId ||
    record.scenarioVersion !== selector.scenarioVersion
  ) {
    return blocked("approval_selector_mismatch");
  }
  if (
    record.portfolioPathPolicyId !==
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.portfolioPathPolicyId ||
    record.gate0ApprovalCommit !==
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.gate0ApprovalCommit
  ) {
    return blocked("approval_policy_mismatch");
  }
  if (
    record.scenarioVectorHashVersion !==
    SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.scenarioVectorHashVersion
  ) {
    return blocked("scenario_vector_hash_version_mismatch");
  }
  if (!isPositiveSafeInteger(record.approvalRevision)) {
    return blocked("approval_revision_invalid");
  }
  if (
    !isCanonicalUtcInstant(record.approvedAt) ||
    record.lifecycleStatus !== "approved" ||
    record.terminalAt !== null
  ) {
    return blocked("approval_lifecycle_invalid");
  }

  const events = snapshotSimulationCuratedApprovedVectorArray(
    record.lifecycleEvents,
    2,
  );
  if (!events || events.length !== 1) {
    return blocked("approval_audit_invalid");
  }
  const approvalEvent = snapshotSimulationCuratedApprovedVectorRecord(
    events[0],
    LIFECYCLE_EVENT_FIELDS,
  );
  if (
    !approvalEvent ||
    approvalEvent.approvalRevisionId !== record.id ||
    approvalEvent.eventSequence !== 1 ||
    approvalEvent.auditVersion !==
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.auditVersion ||
    approvalEvent.transitionKind !==
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.auditDecisionKind ||
    approvalEvent.previousStatus !== null ||
    approvalEvent.resultingStatus !== "approved" ||
    approvalEvent.transitionedAt !== record.approvedAt ||
    approvalEvent.replacementRevisionId !== null
  ) {
    return blocked("approval_audit_invalid");
  }

  const storedRows = snapshotSimulationCuratedApprovedVectorArray(
    record.vectorRows,
    SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.maxVectorRows,
  );
  if (!storedRows || storedRows.length === 0) {
    return blocked("scenario_vector_invalid");
  }

  const vector: Array<Record<string, unknown>> = [];
  for (const value of storedRows) {
    const row = snapshotSimulationCuratedApprovedVectorRecord(
      value,
      VECTOR_ROW_FIELDS,
    );
    if (!row || row.approvalRevisionId !== record.id) {
      return blocked("scenario_vector_invalid");
    }
    vector.push({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      weightBps: row.weightBps,
    });
  }

  const v2Result = createSimulationScenarioVectorHashV2({
    scenarioId: record.scenarioId,
    scenarioVersion: record.scenarioVersion,
    vector,
  });
  if (v2Result.status !== "hashable") {
    return blocked("scenario_vector_invalid");
  }
  if (
    v2Result.hashVersion !==
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.scenarioVectorHashVersion ||
    v2Result.portfolioPathPolicyId !==
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.portfolioPathPolicyId ||
    v2Result.gate0ApprovalCommit !==
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.gate0ApprovalCommit ||
    v2Result.rowCount !== vector.length ||
    v2Result.totalWeightBps !==
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.requiredWeightTotalBps
  ) {
    return blocked("approval_policy_mismatch");
  }

  const validatedRows = vector as SimulationScenarioVectorHashV2InputRow[];
  if (!isCanonicalOrder(validatedRows)) {
    return blocked("scenario_vector_invalid");
  }
  if (
    typeof record.scenarioVectorHash !== "string" ||
    !SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_SHA256_PATTERN.test(
      record.scenarioVectorHash,
    ) ||
    record.scenarioVectorHash !== v2Result.scenarioVectorHash
  ) {
    return blocked("scenario_vector_hash_mismatch");
  }

  const canonicalVector = Object.freeze(
    validatedRows.map((row) =>
      Object.freeze({
        market: row.market,
        currency: row.currency,
        ticker: row.ticker,
        weightBps: row.weightBps,
      }),
    ),
  );

  return Object.freeze({
    evidence: Object.freeze({
      portfolioPathPolicyId:
        SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.portfolioPathPolicyId,
      gate0ApprovalCommit:
        SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.gate0ApprovalCommit,
      scenarioId: record.scenarioId as string,
      scenarioVersion: record.scenarioVersion as string,
      approvalRevision: record.approvalRevision as number,
      scenarioVectorHashVersion:
        SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.scenarioVectorHashVersion,
      scenarioVectorHash: record.scenarioVectorHash,
      canonicalVector,
    }),
    blocker: null,
  });
}

function blocked(
  blocker: SimulationCuratedApprovedVectorRecordV2Blocker,
): SimulationCuratedApprovedVectorRecordV2Evaluation {
  return Object.freeze({ evidence: null, blocker });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_UUID_PATTERN.test(value)
  );
}

function isSelector(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_SELECTOR_PATTERN.test(value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isCanonicalUtcInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_UTC_PATTERN.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isCanonicalOrder(
  rows: readonly SimulationScenarioVectorHashV2InputRow[],
) {
  for (let index = 1; index < rows.length; index += 1) {
    if (
      compareSimulationCuratedApprovedVectorRecordV2Rows(
        rows[index - 1],
        rows[index],
      ) >= 0
    ) {
      return false;
    }
  }
  return true;
}
