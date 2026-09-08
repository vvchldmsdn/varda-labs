import type { getReadOnlyTenantInvestmentLabCounterfactualForScope } from "@/db/queries/investment-lab";
import type { InvestmentLabFixedMixSelection } from "./investment-lab-fixed-mix-selection";
type Research = Awaited<ReturnType<typeof getReadOnlyTenantInvestmentLabCounterfactualForScope>>;
/** Already calculated for main comparison; only the fields used by weight controls. */
export type InvestmentLabWeightEvidence = {
  period: Research["period"];
  selection: InvestmentLabFixedMixSelection;
  fixedMixScenario: Research["model"]["fixedMixScenario"];
  fixedMixComparison: Research["model"]["fixedMixComparison"];
  preperiodMinVolatility: Research["model"]["preperiodMinVolatility"];
  optimizer?: Research["preperiodOptimizer"];
  anchorBasket?: Research["anchorBasketScenario"];
  rollingComparison?: Research["rollingComparison"];
};
