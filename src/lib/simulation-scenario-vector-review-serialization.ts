import { createHash } from "node:crypto";

export const SIMULATION_PORTFOLIO_PATH_POLICY_ID =
  "gross_normalized_buy_and_hold_v1" as const;

export const SIMULATION_PORTFOLIO_PATH_GATE0_APPROVAL_COMMIT =
  "652b9ea9c9b48f51dc4c68e8f148132ca8893d7e" as const;

export type SimulationScenarioVectorRow = Readonly<{
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
}>;

export function canonicalizeSimulationScenarioVector(input: {
  scenarioId: string;
  scenarioVersion: string;
  vector: readonly SimulationScenarioVectorRow[];
}) {
  return JSON.stringify({
    hashVersion: "simulation_scenario_vector_hash_v1",
    portfolioPathPolicyId: SIMULATION_PORTFOLIO_PATH_POLICY_ID,
    gate0ApprovalCommit: SIMULATION_PORTFOLIO_PATH_GATE0_APPROVAL_COMMIT,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    vector: [...input.vector].sort(compareSimulationScenarioVectorRows),
  });
}

export function hashSimulationScenarioVector(serialized: string) {
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

export function compareSimulationScenarioVectorRows(
  left: Pick<SimulationScenarioVectorRow, "market" | "currency" | "ticker">,
  right: Pick<SimulationScenarioVectorRow, "market" | "currency" | "ticker">,
) {
  return (
    left.market.localeCompare(right.market) ||
    left.currency.localeCompare(right.currency) ||
    left.ticker.localeCompare(right.ticker)
  );
}
