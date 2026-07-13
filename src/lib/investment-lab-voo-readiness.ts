import {
  resolveInvestmentLabVooEvidence,
  type InvestmentLabVooEvidenceInput,
  type InvestmentLabVooReadiness,
} from "./investment-lab-voo-evidence.ts";

export {
  INVESTMENT_LAB_VOO_READINESS_POLICY,
  type InvestmentLabVooEvidenceInput,
  type InvestmentLabVooEvidenceResolution,
  type InvestmentLabVooExecutionEvidence,
  type InvestmentLabVooFlowRow,
  type InvestmentLabVooFxRow,
  type InvestmentLabVooPriceRow,
  type InvestmentLabVooReadiness,
  type InvestmentLabVooReadinessBlocker,
  type InvestmentLabVooSnapshotFxRow,
  type InvestmentLabVooValuationEvidence,
} from "./investment-lab-voo-evidence.ts";

export function assessInvestmentLabVooReadiness(
  input: InvestmentLabVooEvidenceInput,
): InvestmentLabVooReadiness {
  return resolveInvestmentLabVooEvidence(input).readiness;
}
