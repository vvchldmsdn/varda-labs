import { SIMULATION_CURATED_ADMISSION_PLANNER_POLICY } from "./simulation-curated-admission-planner-policy.ts";
import type {
  SimulationCuratedAdmissionPlannerInput,
  SimulationCuratedAdmissionPlannerResult,
} from "./simulation-curated-admission-planner-types.ts";
import { evaluateSimulationCuratedAdmissionPlannerInput } from "./simulation-curated-admission-planner-validation.ts";

export type {
  SimulationCuratedAdmissionActorAssumptions,
  SimulationCuratedAdmissionCheckStatus,
  SimulationCuratedAdmissionConfirmationAssumptions,
  SimulationCuratedAdmissionDurableStateAssumptions,
  SimulationCuratedAdmissionExactIdentity,
  SimulationCuratedAdmissionPlannerChecks,
  SimulationCuratedAdmissionPlannerInput,
  SimulationCuratedAdmissionPlannerResult,
  SimulationCuratedAdmissionPolicyEvidence,
  SimulationCuratedAdmissionVectorRow,
} from "./simulation-curated-admission-planner-types.ts";
export {
  SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER,
  SIMULATION_CURATED_ADMISSION_PLANNER_POLICY,
  type SimulationCuratedAdmissionPlannerBlocker,
} from "./simulation-curated-admission-planner-policy.ts";

export function planSyntheticCuratedVectorAdmission(
  input: SimulationCuratedAdmissionPlannerInput | unknown,
): SimulationCuratedAdmissionPlannerResult {
  const evaluation = evaluateSimulationCuratedAdmissionPlannerInput(input);
  return Object.freeze({
    policyId: SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.policyId,
    policyVersion: SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.policyVersion,
    mode: SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.mode,
    runtimeTrustStatus:
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.runtimeTrustStatus,
    readinessStatus:
      SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.readinessStatus,
    decision:
      evaluation.blockers.length === 0
        ? "synthetic_preconditions_satisfied"
        : "blocked",
    intent: evaluation.intent,
    blockers: evaluation.blockers,
    rowCount: evaluation.rowCount,
    totalWeightBps: evaluation.totalWeightBps,
    zeroWeightRowCount: evaluation.zeroWeightRowCount,
    checks: evaluation.checks,
  });
}
