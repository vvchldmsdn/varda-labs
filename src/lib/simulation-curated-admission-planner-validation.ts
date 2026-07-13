import {
  SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER,
  SIMULATION_CURATED_ADMISSION_PLANNER_CHALLENGE_LABEL_PATTERN,
  SIMULATION_CURATED_ADMISSION_PLANNER_COMMIT_PATTERN,
  SIMULATION_CURATED_ADMISSION_PLANNER_DESCRIPTOR_PATTERN,
  SIMULATION_CURATED_ADMISSION_PLANNER_MARKET_PATTERN,
  SIMULATION_CURATED_ADMISSION_PLANNER_POLICY,
  SIMULATION_CURATED_ADMISSION_PLANNER_SHA256_PATTERN,
  SIMULATION_CURATED_ADMISSION_PLANNER_TICKER_PATTERN,
  SIMULATION_CURATED_ADMISSION_PLANNER_UUID_PATTERN,
  compareSimulationCuratedAdmissionInstruments,
  type SimulationCuratedAdmissionPlannerBlocker,
} from "./simulation-curated-admission-planner-policy.ts";
import {
  parseSimulationCuratedAdmissionSyntheticInstant,
  serializeSimulationCuratedAdmissionEnvelope,
} from "./simulation-curated-admission-planner-serialization.ts";
import type {
  SimulationCuratedAdmissionCheckStatus,
  SimulationCuratedAdmissionPlannerChecks,
  SimulationCuratedAdmissionPlannerEvaluation,
  SimulationCuratedAdmissionVectorRow,
} from "./simulation-curated-admission-planner-types.ts";
import {
  createSimulationScenarioVectorHashV2,
  type SimulationScenarioVectorHashV2Input,
  type SimulationScenarioVectorHashV2Result,
} from "./simulation-scenario-vector-hash-v2.ts";

const OUTER_FIELDS = Object.freeze([
  "policyEvidence",
  "actorAssumptions",
  "exactIdentity",
  "vector",
  "scenarioVectorHash",
  "confirmationAssumptions",
  "durableStateAssumptions",
] as const);
const POLICY_FIELDS = Object.freeze([
  "evidenceSource",
  "plannerPolicyId",
  "plannerPolicyVersion",
  "actorMode",
  "confirmationPolicyId",
  "portfolioPathPolicyId",
  "gate0ApprovalCommit",
  "vectorHashVersion",
  "approvalEnvelopeDigestVersion",
] as const);
const ACTOR_FIELDS = Object.freeze([
  "sessionAssumption",
  "identityMappingAssumption",
  "appUserAssumption",
  "actorOwnerAssumption",
  "syntheticOwnerUserId",
] as const);
const IDENTITY_FIELDS = Object.freeze([
  "ownerUserId",
  "portfolioPathPolicyId",
  "gate0ApprovalCommit",
  "scenarioId",
  "scenarioVersion",
  "intent",
] as const);
const ROW_FIELDS = Object.freeze([
  "market",
  "currency",
  "ticker",
  "weightBps",
] as const);
const CONFIRMATION_FIELDS = Object.freeze([
  "state",
  "ownerBindingAssumption",
  "expectedChallengeInstanceLabel",
  "presentedChallengeInstanceLabel",
  "expectedApprovalEnvelopeDigest",
  "presentedApprovalEnvelopeDigest",
  "issuedAt",
  "expiresAt",
  "syntheticEvaluationTime",
] as const);
const DURABLE_FIELDS = Object.freeze([
  "approvalRevisionAssumption",
  "competingChallengeAssumption",
] as const);

type SnapshotRecord = Readonly<Record<string, unknown>>;
type SnapshotRow = Readonly<{
  market: unknown;
  currency: unknown;
  ticker: unknown;
  weightBps: unknown;
}>;
type PlannerSnapshot = Readonly<{
  policyEvidence: SnapshotRecord;
  actorAssumptions: SnapshotRecord;
  exactIdentity: SnapshotRecord;
  vector: readonly SnapshotRow[] | null;
  vectorStatus: "valid" | "row_cap_exceeded";
  scenarioVectorHash: unknown;
  confirmationAssumptions: SnapshotRecord;
  durableStateAssumptions: SnapshotRecord;
}>;
type SnapshotResult =
  | Readonly<{ status: "valid"; snapshot: PlannerSnapshot }>
  | Readonly<{ status: "invalid_shape" }>;
type VectorSnapshot =
  | Readonly<{ status: "valid"; rows: readonly SnapshotRow[] }>
  | Readonly<{ status: "row_cap_exceeded" }>
  | Readonly<{ status: "invalid_shape" }>;

export function evaluateSimulationCuratedAdmissionPlannerInput(
  input: unknown,
): SimulationCuratedAdmissionPlannerEvaluation {
  const snapshotResult = snapshotPlannerInput(input);
  if (snapshotResult.status === "invalid_shape") {
    return invalidShapeEvaluation();
  }

  const snapshot = snapshotResult.snapshot;
  const blockers = new Set<SimulationCuratedAdmissionPlannerBlocker>();
  const policyEvidence = snapshot.policyEvidence;
  const actor = snapshot.actorAssumptions;
  const identity = snapshot.exactIdentity;
  const confirmation = snapshot.confirmationAssumptions;
  const durable = snapshot.durableStateAssumptions;

  if (
    policyEvidence.evidenceSource !==
    SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.evidenceSource
  ) {
    blockers.add("unsupported_evidence_source");
  }

  const policyBindingValid =
    policyEvidence.plannerPolicyId ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.policyId &&
    policyEvidence.plannerPolicyVersion ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.policyVersion &&
    policyEvidence.portfolioPathPolicyId ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.portfolioPathPolicyId &&
    policyEvidence.gate0ApprovalCommit ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.gate0ApprovalCommit &&
    policyEvidence.vectorHashVersion ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.vectorHashVersion &&
    policyEvidence.approvalEnvelopeDigestVersion ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.approvalEnvelopeDigestVersion;
  if (!policyBindingValid) blockers.add("policy_binding_mismatch");

  if (
    policyEvidence.actorMode !==
    SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.supportedActorMode
  ) {
    blockers.add("unsupported_actor_mode");
  }
  if (actor.sessionAssumption !== "verified_active") {
    blockers.add("synthetic_session_not_verified_active");
  }
  if (actor.identityMappingAssumption !== "exactly_one_active") {
    blockers.add("synthetic_identity_mapping_not_exactly_one_active");
  }
  if (actor.appUserAssumption !== "active") {
    blockers.add("synthetic_app_user_not_active");
  }
  if (actor.actorOwnerAssumption !== "same_canonical_owner") {
    blockers.add("synthetic_actor_owner_mismatch");
  }

  const actorOwnerValid = isUuid(actor.syntheticOwnerUserId);
  const exactIdentityValid =
    isUuid(identity.ownerUserId) &&
    isDescriptor(identity.portfolioPathPolicyId) &&
    identity.portfolioPathPolicyId ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.portfolioPathPolicyId &&
    isCommit(identity.gate0ApprovalCommit) &&
    identity.gate0ApprovalCommit ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.gate0ApprovalCommit &&
    isDescriptor(identity.scenarioId) &&
    isDescriptor(identity.scenarioVersion) &&
    isDescriptor(identity.intent);
  if (!actorOwnerValid || !exactIdentityValid) {
    blockers.add("invalid_exact_identity");
  }
  if (
    actorOwnerValid &&
    isUuid(identity.ownerUserId) &&
    actor.syntheticOwnerUserId !== identity.ownerUserId
  ) {
    blockers.add("synthetic_actor_owner_mismatch");
  }

  const supportedIntent =
    identity.intent ===
    SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.supportedIntent;
  if (!supportedIntent) blockers.add("unsupported_admission_intent");

  const vectorMetrics = validateVector(snapshot, blockers);
  const sourceVectorValid = !hasAnyBlocker(blockers, VECTOR_BLOCKERS);

  let vectorHashStatus: SimulationCuratedAdmissionCheckStatus = "not_evaluated";
  let computedScenarioVectorHash: string | null = null;
  if (
    sourceVectorValid &&
    exactIdentityValid &&
    snapshot.vector !== null
  ) {
    const v2Input = createV2Projection(snapshot);
    const v2Result = createSimulationScenarioVectorHashV2(v2Input);
    if (
      isMatchedV2Result(
        v2Result,
        snapshot,
        vectorMetrics.rowCount,
        vectorMetrics.zeroWeightRowCount,
      ) &&
      isSha256(snapshot.scenarioVectorHash) &&
      v2Result.scenarioVectorHash === snapshot.scenarioVectorHash
    ) {
      vectorHashStatus = "pass";
      computedScenarioVectorHash = v2Result.scenarioVectorHash;
    } else {
      blockers.add("scenario_vector_hash_mismatch");
      vectorHashStatus = "blocked";
    }
  }

  let approvalEnvelopeStatus: SimulationCuratedAdmissionCheckStatus =
    "not_evaluated";
  if (
    vectorHashStatus === "pass" &&
    computedScenarioVectorHash !== null &&
    canSerializeEnvelope(snapshot)
  ) {
    const envelope = serializeSimulationCuratedAdmissionEnvelope({
      approvalEnvelopeDigestVersion:
        policyEvidence.approvalEnvelopeDigestVersion as string,
      actorMode: policyEvidence.actorMode as string,
      confirmationPolicyId: policyEvidence.confirmationPolicyId as string,
      intent: identity.intent as string,
      ownerUserId: identity.ownerUserId as string,
      portfolioPathPolicyId: identity.portfolioPathPolicyId as string,
      gate0ApprovalCommit: identity.gate0ApprovalCommit as string,
      scenarioId: identity.scenarioId as string,
      scenarioVersion: identity.scenarioVersion as string,
      vectorHashVersion: policyEvidence.vectorHashVersion as string,
      scenarioVectorHash: computedScenarioVectorHash,
      vector: toValidatedRows(snapshot.vector as readonly SnapshotRow[]),
    });
    if (
      envelope.status === "serialized" &&
      isSha256(confirmation.expectedApprovalEnvelopeDigest) &&
      isSha256(confirmation.presentedApprovalEnvelopeDigest) &&
      confirmation.expectedApprovalEnvelopeDigest ===
        envelope.approvalEnvelopeDigest &&
      confirmation.presentedApprovalEnvelopeDigest ===
        envelope.approvalEnvelopeDigest
    ) {
      approvalEnvelopeStatus = "pass";
    } else {
      blockers.add("approval_envelope_digest_mismatch");
      approvalEnvelopeStatus = "blocked";
    }
  }

  validateConfirmation(policyEvidence, confirmation, blockers);
  validateDurableState(durable, blockers);

  const checks = freezeChecks({
    policyBinding: statusForBlockers(blockers, [
      "unsupported_evidence_source",
      "policy_binding_mismatch",
    ]),
    actorAssumptions: statusForBlockers(blockers, [
      "unsupported_actor_mode",
      "synthetic_session_not_verified_active",
      "synthetic_identity_mapping_not_exactly_one_active",
      "synthetic_app_user_not_active",
      "synthetic_actor_owner_mismatch",
    ]),
    exactIdentityShape: statusForBlockers(blockers, [
      "invalid_exact_identity",
    ]),
    sourceVector: statusForBlockers(blockers, VECTOR_BLOCKERS),
    vectorHash: vectorHashStatus,
    approvalEnvelope: approvalEnvelopeStatus,
    confirmationAssumptions: statusForBlockers(
      blockers,
      CONFIRMATION_BLOCKERS,
    ),
    durableStateAssumptions: statusForBlockers(blockers, DURABLE_BLOCKERS),
  });

  return Object.freeze({
    blockers: orderBlockers(blockers),
    intent: "initial_approval",
    rowCount: vectorMetrics.rowCount,
    totalWeightBps: vectorMetrics.totalWeightBps,
    zeroWeightRowCount: vectorMetrics.zeroWeightRowCount,
    checks,
  });
}

const VECTOR_BLOCKERS = Object.freeze([
  "source_vector_empty",
  "source_vector_row_cap_exceeded",
  "invalid_instrument_identity",
  "duplicate_instrument_identity",
  "source_vector_not_canonical_order",
  "invalid_weight_bps",
  "source_vector_total_not_10000_bps",
] as const satisfies readonly SimulationCuratedAdmissionPlannerBlocker[]);
const CONFIRMATION_BLOCKERS = Object.freeze([
  "invalid_synthetic_instant",
  "confirmation_policy_mismatch",
  "confirmation_owner_binding_mismatch",
  "confirmation_instance_mismatch",
  "confirmation_not_pending",
  "confirmation_not_yet_valid",
  "confirmation_expired",
] as const satisfies readonly SimulationCuratedAdmissionPlannerBlocker[]);
const DURABLE_BLOCKERS = Object.freeze([
  "synthetic_current_approval_exists",
  "synthetic_prior_revision_exists",
  "synthetic_competing_challenge",
  "synthetic_durable_state_unproven",
] as const satisfies readonly SimulationCuratedAdmissionPlannerBlocker[]);

function snapshotPlannerInput(input: unknown): SnapshotResult {
  const outer = snapshotExactRecord(input, OUTER_FIELDS);
  if (!outer) return Object.freeze({ status: "invalid_shape" });

  const policyEvidence = snapshotExactRecord(
    outer.policyEvidence,
    POLICY_FIELDS,
  );
  const actorAssumptions = snapshotExactRecord(
    outer.actorAssumptions,
    ACTOR_FIELDS,
  );
  const exactIdentity = snapshotExactRecord(
    outer.exactIdentity,
    IDENTITY_FIELDS,
  );
  const confirmationAssumptions = snapshotExactRecord(
    outer.confirmationAssumptions,
    CONFIRMATION_FIELDS,
  );
  const durableStateAssumptions = snapshotExactRecord(
    outer.durableStateAssumptions,
    DURABLE_FIELDS,
  );
  if (
    !policyEvidence ||
    !actorAssumptions ||
    !exactIdentity ||
    !confirmationAssumptions ||
    !durableStateAssumptions
  ) {
    return Object.freeze({ status: "invalid_shape" });
  }

  const vector = snapshotVector(outer.vector);
  if (vector.status === "invalid_shape") {
    return Object.freeze({ status: "invalid_shape" });
  }

  const snapshot: PlannerSnapshot = Object.freeze({
    policyEvidence: toOrdinaryRecord(policyEvidence, POLICY_FIELDS),
    actorAssumptions: toOrdinaryRecord(actorAssumptions, ACTOR_FIELDS),
    exactIdentity: toOrdinaryRecord(exactIdentity, IDENTITY_FIELDS),
    vector: vector.status === "valid" ? vector.rows : null,
    vectorStatus: vector.status,
    scenarioVectorHash: outer.scenarioVectorHash,
    confirmationAssumptions: toOrdinaryRecord(
      confirmationAssumptions,
      CONFIRMATION_FIELDS,
    ),
    durableStateAssumptions: toOrdinaryRecord(
      durableStateAssumptions,
      DURABLE_FIELDS,
    ),
  });
  return Object.freeze({ status: "valid", snapshot });
}

function snapshotExactRecord(
  value: unknown,
  fields: readonly string[],
): SnapshotRecord | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length ||
      keys.some((key) => typeof key !== "string" || !fields.includes(key))
    ) {
      return null;
    }

    const result: Record<string, unknown> = Object.create(null);
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      result[field] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    return null;
  }
}

function snapshotVector(value: unknown): VectorSnapshot {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return Object.freeze({ status: "invalid_shape" });
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !Object.hasOwn(lengthDescriptor, "value") ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return Object.freeze({ status: "invalid_shape" });
    }
    const rowCount = lengthDescriptor.value as number;
    if (rowCount > SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.maxVectorRows) {
      return Object.freeze({ status: "row_cap_exceeded" });
    }

    const keys = Reflect.ownKeys(value);
    const expectedKeys = new Set<string>(["length"]);
    for (let index = 0; index < rowCount; index += 1) {
      expectedKeys.add(String(index));
    }
    if (
      keys.length !== expectedKeys.size ||
      keys.some(
        (key) => typeof key !== "string" || !expectedKeys.has(key),
      )
    ) {
      return Object.freeze({ status: "invalid_shape" });
    }

    const rows = new Array<SnapshotRow>(rowCount);
    for (let index = 0; index < rowCount; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return Object.freeze({ status: "invalid_shape" });
      }
      const row = snapshotExactRecord(descriptor.value, ROW_FIELDS);
      if (!row) return Object.freeze({ status: "invalid_shape" });
      rows[index] = Object.freeze({
        market: row.market,
        currency: row.currency,
        ticker: row.ticker,
        weightBps: row.weightBps,
      });
    }
    return Object.freeze({ status: "valid", rows: Object.freeze(rows) });
  } catch {
    return Object.freeze({ status: "invalid_shape" });
  }
}

function toOrdinaryRecord(
  source: SnapshotRecord,
  fields: readonly string[],
): SnapshotRecord {
  const result: Record<string, unknown> = {};
  for (const field of fields) result[field] = source[field];
  return Object.freeze(result);
}

function validateVector(
  snapshot: PlannerSnapshot,
  blockers: Set<SimulationCuratedAdmissionPlannerBlocker>,
) {
  if (snapshot.vectorStatus === "row_cap_exceeded") {
    blockers.add("source_vector_row_cap_exceeded");
    return Object.freeze({
      rowCount: null,
      totalWeightBps: null,
      zeroWeightRowCount: null,
    });
  }

  const rows = snapshot.vector as readonly SnapshotRow[];
  const rowCount = rows.length;
  if (rowCount === 0) blockers.add("source_vector_empty");

  let invalidIdentity = false;
  let duplicateIdentity = false;
  let outOfOrder = false;
  const identities = new Set<string>();
  let previous: SimulationCuratedAdmissionVectorRow | null = null;
  let invalidWeight = false;
  let totalWeightBps = 0;
  let zeroWeightRowCount = 0;

  for (const row of rows) {
    const identityValid = isInstrumentIdentity(row);
    if (!identityValid) {
      invalidIdentity = true;
    } else {
      const typedRow = row as SimulationCuratedAdmissionVectorRow;
      const key = `${typedRow.market}\u0000${typedRow.currency}\u0000${typedRow.ticker}`;
      if (identities.has(key)) duplicateIdentity = true;
      identities.add(key);
      if (
        previous !== null &&
        compareSimulationCuratedAdmissionInstruments(previous, typedRow) > 0
      ) {
        outOfOrder = true;
      }
      previous = typedRow;
    }

    if (!isWeight(row.weightBps)) {
      invalidWeight = true;
    } else if (!invalidWeight) {
      const nextTotal = totalWeightBps + row.weightBps;
      if (!Number.isSafeInteger(nextTotal)) {
        invalidWeight = true;
      } else {
        totalWeightBps = nextTotal;
        if (row.weightBps === 0) zeroWeightRowCount += 1;
      }
    }
  }

  if (invalidIdentity) blockers.add("invalid_instrument_identity");
  if (duplicateIdentity) blockers.add("duplicate_instrument_identity");
  if (outOfOrder) blockers.add("source_vector_not_canonical_order");
  if (invalidWeight) {
    blockers.add("invalid_weight_bps");
  } else if (
    totalWeightBps !==
    SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.requiredWeightTotalBps
  ) {
    blockers.add("source_vector_total_not_10000_bps");
  }

  return Object.freeze({
    rowCount,
    totalWeightBps: invalidWeight ? null : totalWeightBps,
    zeroWeightRowCount: invalidWeight ? null : zeroWeightRowCount,
  });
}

function createV2Projection(
  snapshot: PlannerSnapshot,
): SimulationScenarioVectorHashV2Input {
  const rows = toValidatedRows(snapshot.vector as readonly SnapshotRow[]);
  return Object.freeze({
    scenarioId: snapshot.exactIdentity.scenarioId as string,
    scenarioVersion: snapshot.exactIdentity.scenarioVersion as string,
    vector: rows,
  });
}

function toValidatedRows(rows: readonly SnapshotRow[]) {
  const copied = new Array<SimulationCuratedAdmissionVectorRow>(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    copied[index] = Object.freeze({
      market: row.market as string,
      currency: row.currency as "KRW" | "USD",
      ticker: row.ticker as string,
      weightBps: row.weightBps as number,
    });
  }
  return Object.freeze(copied);
}

function isMatchedV2Result(
  result: SimulationScenarioVectorHashV2Result,
  snapshot: PlannerSnapshot,
  rowCount: number | null,
  zeroWeightRowCount: number | null,
): result is Extract<SimulationScenarioVectorHashV2Result, { status: "hashable" }> {
  return (
    result.status === "hashable" &&
    result.hashVersion ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.vectorHashVersion &&
    result.portfolioPathPolicyId ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.portfolioPathPolicyId &&
    result.gate0ApprovalCommit ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.gate0ApprovalCommit &&
    result.scenarioId === snapshot.exactIdentity.scenarioId &&
    result.scenarioVersion === snapshot.exactIdentity.scenarioVersion &&
    result.rowCount === rowCount &&
    result.zeroWeightRowCount === zeroWeightRowCount &&
    result.totalWeightBps ===
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.requiredWeightTotalBps
  );
}

function canSerializeEnvelope(snapshot: PlannerSnapshot) {
  const policy = snapshot.policyEvidence;
  const identity = snapshot.exactIdentity;
  return (
    snapshot.vector !== null &&
    isDescriptor(policy.approvalEnvelopeDigestVersion) &&
    isDescriptor(policy.actorMode) &&
    isDescriptor(policy.confirmationPolicyId) &&
    isDescriptor(policy.vectorHashVersion) &&
    isDescriptor(identity.intent) &&
    isUuid(identity.ownerUserId) &&
    isDescriptor(identity.portfolioPathPolicyId) &&
    isCommit(identity.gate0ApprovalCommit) &&
    isDescriptor(identity.scenarioId) &&
    isDescriptor(identity.scenarioVersion)
  );
}

function validateConfirmation(
  policy: SnapshotRecord,
  confirmation: SnapshotRecord,
  blockers: Set<SimulationCuratedAdmissionPlannerBlocker>,
) {
  if (
    policy.confirmationPolicyId !==
    SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.confirmationPolicyId
  ) {
    blockers.add("confirmation_policy_mismatch");
  }
  if (confirmation.ownerBindingAssumption !== "matches") {
    blockers.add("confirmation_owner_binding_mismatch");
  }
  if (
    !isChallengeLabel(confirmation.expectedChallengeInstanceLabel) ||
    !isChallengeLabel(confirmation.presentedChallengeInstanceLabel) ||
    confirmation.expectedChallengeInstanceLabel !==
      confirmation.presentedChallengeInstanceLabel
  ) {
    blockers.add("confirmation_instance_mismatch");
  }
  if (confirmation.state !== "pending") {
    blockers.add("confirmation_not_pending");
  }

  const issuedAt = parseSimulationCuratedAdmissionSyntheticInstant(
    confirmation.issuedAt,
  );
  const expiresAt = parseSimulationCuratedAdmissionSyntheticInstant(
    confirmation.expiresAt,
  );
  const evaluationTime = parseSimulationCuratedAdmissionSyntheticInstant(
    confirmation.syntheticEvaluationTime,
  );
  if (
    issuedAt === null ||
    expiresAt === null ||
    evaluationTime === null ||
    issuedAt >= expiresAt
  ) {
    blockers.add("invalid_synthetic_instant");
    return;
  }
  if (evaluationTime < issuedAt) {
    blockers.add("confirmation_not_yet_valid");
  } else if (evaluationTime >= expiresAt) {
    blockers.add("confirmation_expired");
  }
}

function validateDurableState(
  durable: SnapshotRecord,
  blockers: Set<SimulationCuratedAdmissionPlannerBlocker>,
) {
  if (durable.approvalRevisionAssumption === "current_approval_exists") {
    blockers.add("synthetic_current_approval_exists");
  } else if (durable.approvalRevisionAssumption === "prior_revision_exists") {
    blockers.add("synthetic_prior_revision_exists");
  } else if (durable.approvalRevisionAssumption !== "no_prior_revision") {
    blockers.add("synthetic_durable_state_unproven");
  }

  if (durable.competingChallengeAssumption === "live_competitor_present") {
    blockers.add("synthetic_competing_challenge");
  } else if (durable.competingChallengeAssumption !== "none") {
    blockers.add("synthetic_durable_state_unproven");
  }
}

function isInstrumentIdentity(
  row: SnapshotRow,
): row is SimulationCuratedAdmissionVectorRow {
  return (
    typeof row.market === "string" &&
    SIMULATION_CURATED_ADMISSION_PLANNER_MARKET_PATTERN.test(row.market) &&
    (row.currency === "KRW" || row.currency === "USD") &&
    typeof row.ticker === "string" &&
    SIMULATION_CURATED_ADMISSION_PLANNER_TICKER_PATTERN.test(row.ticker)
  );
}

function isWeight(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    !Object.is(value, -0) &&
    value >= 0 &&
    value <= SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.requiredWeightTotalBps
  );
}

function isDescriptor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SIMULATION_CURATED_ADMISSION_PLANNER_DESCRIPTOR_PATTERN.test(value)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SIMULATION_CURATED_ADMISSION_PLANNER_UUID_PATTERN.test(value)
  );
}

function isCommit(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SIMULATION_CURATED_ADMISSION_PLANNER_COMMIT_PATTERN.test(value)
  );
}

function isSha256(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SIMULATION_CURATED_ADMISSION_PLANNER_SHA256_PATTERN.test(value)
  );
}

function isChallengeLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SIMULATION_CURATED_ADMISSION_PLANNER_CHALLENGE_LABEL_PATTERN.test(value)
  );
}

function hasAnyBlocker(
  blockers: ReadonlySet<SimulationCuratedAdmissionPlannerBlocker>,
  candidates: readonly SimulationCuratedAdmissionPlannerBlocker[],
) {
  return candidates.some((candidate) => blockers.has(candidate));
}

function statusForBlockers(
  blockers: ReadonlySet<SimulationCuratedAdmissionPlannerBlocker>,
  candidates: readonly SimulationCuratedAdmissionPlannerBlocker[],
): SimulationCuratedAdmissionCheckStatus {
  return hasAnyBlocker(blockers, candidates) ? "blocked" : "pass";
}

function orderBlockers(
  blockers: ReadonlySet<SimulationCuratedAdmissionPlannerBlocker>,
) {
  return Object.freeze(
    SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER.filter((blocker) =>
      blockers.has(blocker),
    ),
  );
}

function freezeChecks(
  checks: SimulationCuratedAdmissionPlannerChecks,
): SimulationCuratedAdmissionPlannerChecks {
  return Object.freeze({ ...checks });
}

function invalidShapeEvaluation(): SimulationCuratedAdmissionPlannerEvaluation {
  return Object.freeze({
    blockers: Object.freeze([
      "invalid_synthetic_input",
    ] as const satisfies readonly SimulationCuratedAdmissionPlannerBlocker[]),
    intent: "initial_approval",
    rowCount: null,
    totalWeightBps: null,
    zeroWeightRowCount: null,
    checks: freezeChecks({
      policyBinding: "not_evaluated",
      actorAssumptions: "not_evaluated",
      exactIdentityShape: "not_evaluated",
      sourceVector: "not_evaluated",
      vectorHash: "not_evaluated",
      approvalEnvelope: "not_evaluated",
      confirmationAssumptions: "not_evaluated",
      durableStateAssumptions: "not_evaluated",
    }),
  });
}
