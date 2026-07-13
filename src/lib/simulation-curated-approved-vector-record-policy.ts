export const SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY =
  Object.freeze({
    validatorVersion:
      "simulation_curated_approved_vector_record_validator_v1",
    scenarioVectorHashVersion: "simulation_scenario_vector_hash_v2",
    portfolioPathPolicyId: "gross_normalized_buy_and_hold_v1",
    gate0ApprovalCommit: "652b9ea9c9b48f51dc4c68e8f148132ca8893d7e",
    auditVersion: "scenario_vector_approval_audit_v1",
    auditDecisionKind: "explicit_approval",
    maxVectorRows: 64,
    requiredWeightTotalBps: 10_000,
    runtimeTrustStatus: "not_established",
    repositoryAccess: "forbidden_in_pure_validator",
    rawRecordOutput: "forbidden",
    outputKind: "minimized_approved_vector_evidence_v2",
  } as const);

export const SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_SELECTOR_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export const SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_SHA256_PATTERN =
  /^sha256:[0-9a-f]{64}$/;

export const SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type ComparableInstrument = Readonly<{
  market: string;
  currency: string;
  ticker: string;
}>;

export function compareSimulationCuratedApprovedVectorRecordV2Rows(
  left: ComparableInstrument,
  right: ComparableInstrument,
) {
  return (
    compareAscii(left.market, right.market) ||
    compareAscii(left.currency, right.currency) ||
    compareAscii(left.ticker, right.ticker)
  );
}

function compareAscii(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
