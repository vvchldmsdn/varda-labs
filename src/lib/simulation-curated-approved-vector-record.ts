import { SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY } from "./simulation-curated-approved-vector-record-policy.ts";
import type { SimulationCuratedApprovedVectorRecordV2Result } from "./simulation-curated-approved-vector-record-types.ts";
import { evaluateSimulationCuratedApprovedVectorRecordV2 } from "./simulation-curated-approved-vector-record-validation.ts";

export { SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY } from "./simulation-curated-approved-vector-record-policy.ts";
export type {
  SimulationCuratedApprovedVectorEvidenceV2,
  SimulationCuratedApprovedVectorRecordV2Blocker,
  SimulationCuratedApprovedVectorRecordV2Input,
  SimulationCuratedApprovedVectorRecordV2LifecycleEvent,
  SimulationCuratedApprovedVectorRecordV2Result,
  SimulationCuratedApprovedVectorRecordV2Selector,
  SimulationCuratedApprovedVectorRecordV2StoredRecord,
  SimulationCuratedApprovedVectorRecordV2StoredRow,
} from "./simulation-curated-approved-vector-record-types.ts";

export function validateSimulationCuratedApprovedVectorRecordV2(
  input: unknown,
): SimulationCuratedApprovedVectorRecordV2Result {
  const evaluation = evaluateSimulationCuratedApprovedVectorRecordV2(input);
  if (evaluation.evidence) {
    return Object.freeze({
      status: "validated",
      runtimeTrustStatus:
        SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.runtimeTrustStatus,
      evidence: evaluation.evidence,
      blocker: null,
    });
  }

  return Object.freeze({
    status: "blocked",
    runtimeTrustStatus:
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.runtimeTrustStatus,
    evidence: null,
    blocker: Object.freeze({ reason: evaluation.blocker! }),
  });
}
