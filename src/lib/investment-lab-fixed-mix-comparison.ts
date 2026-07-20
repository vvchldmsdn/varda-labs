import { buildInvestmentLabFixedMixScenario } from "./investment-lab-fixed-mix.ts";
import { resolveInvestmentLabFixedMixSelection } from "./investment-lab-fixed-mix-selection.ts";
import type {
  InvestmentLabFixedMixActualRow,
  InvestmentLabFixedMixComponentPath,
  InvestmentLabFixedMixReturnEvidence,
  InvestmentLabFixedMixScenario,
} from "./investment-lab-fixed-mix-types.ts";

export const INVESTMENT_LAB_FIXED_MIX_COMPARISON_POLICY = Object.freeze({
  version: "kodex_voo_standard_fixed_mix_comparison_v1",
  kodexWeightPresetsPct: Object.freeze([25, 50, 75] as const),
  ordering: "kodex_weight_ascending",
  sharedEvidence: "same_actual_path_component_paths_and_external_flows",
  ranking: "forbidden",
  recommendation: "forbidden",
  authority: "historical_research_only",
} as const);

export type InvestmentLabFixedMixComparisonEntry = Readonly<{
  id: `kodex_${25 | 50 | 75}_voo_${75 | 50 | 25}`;
  kodexWeightPct: 25 | 50 | 75;
  vooWeightPct: 75 | 50 | 25;
  scenario: InvestmentLabFixedMixScenario;
}>;

export type InvestmentLabFixedMixComparison = Readonly<{
  status: "ready" | "partial" | "unavailable";
  policy: typeof INVESTMENT_LAB_FIXED_MIX_COMPARISON_POLICY;
  scenarios: readonly InvestmentLabFixedMixComparisonEntry[];
  readyScenarioCount: number;
  unavailableScenarioCount: number;
}>;

type ComparisonInput = Readonly<{
  actualPath: readonly InvestmentLabFixedMixActualRow[];
  kodexPath: InvestmentLabFixedMixComponentPath;
  vooPath: InvestmentLabFixedMixComponentPath;
  kodexReturnEvidence: InvestmentLabFixedMixReturnEvidence | null;
  vooReturnEvidence: InvestmentLabFixedMixReturnEvidence | null;
}>;

export function buildInvestmentLabFixedMixComparison(
  input: ComparisonInput,
): InvestmentLabFixedMixComparison {
  const scenarios = INVESTMENT_LAB_FIXED_MIX_COMPARISON_POLICY.kodexWeightPresetsPct.map(
    (kodexWeightPct) => {
      const vooWeightPct = (100 - kodexWeightPct) as 75 | 50 | 25;
      const scenario = buildInvestmentLabFixedMixScenario({
        ...input,
        selection: resolveInvestmentLabFixedMixSelection(
          String(kodexWeightPct),
        ),
      });
      return Object.freeze({
        id: `kodex_${kodexWeightPct}_voo_${vooWeightPct}` as const,
        kodexWeightPct,
        vooWeightPct,
        scenario,
      });
    },
  );
  return summarizeInvestmentLabFixedMixComparison(scenarios);
}

export function summarizeInvestmentLabFixedMixComparison(
  scenarios: readonly InvestmentLabFixedMixComparisonEntry[],
): InvestmentLabFixedMixComparison {
  const readyScenarioCount = scenarios.filter(
    (entry) => entry.scenario.status === "ready",
  ).length;
  const unavailableScenarioCount = scenarios.length - readyScenarioCount;
  return Object.freeze({
    status:
      scenarios.length > 0 && readyScenarioCount === scenarios.length
        ? "ready"
        : readyScenarioCount > 0
          ? "partial"
          : "unavailable",
    policy: INVESTMENT_LAB_FIXED_MIX_COMPARISON_POLICY,
    scenarios: Object.freeze([...scenarios]),
    readyScenarioCount,
    unavailableScenarioCount,
  });
}
