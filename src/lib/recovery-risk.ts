import type { PortfolioRiskReadModel } from "./portfolio-risk-read-model";
import type { RecoveryKind } from "./recovery-navigation";

/** Display actions only; source admission and risk calculations stay unchanged. */
export function riskRecoveryKind(model: Pick<PortfolioRiskReadModel, "inputHealth" | "provenance" | "calculation">): RecoveryKind | null {
  if (model.inputHealth.blockers.length > 0) return "retry";
  if (model.provenance.eligibleHoldingCount > 0 && model.provenance.usableReturnObservations === 0) return "market";
  if (model.calculation.calculationStatus === "invalid") return "retry";
  if (model.provenance.eligibleHoldingCount === 0) return "holdings";
  if (model.inputHealth.status === "partial" || model.inputHealth.status === "insufficient_coverage"
    || model.calculation.reason === "input_insufficient_coverage" || model.calculation.reason === "insufficient_observations") return "market";
  if (model.inputHealth.exclusions.length > 0) return "holdings";
  return model.calculation.calculationStatus === "unavailable" ? "retry" : null;
}
