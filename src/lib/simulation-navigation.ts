import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";

export type SimulationNavigationInput = Readonly<{
  account?: PortfolioAccountScope | null;
  endServiceDate: string | null;
  researchHorizon: 63 | 126;
  kodexWeightPct: number | null;
  researchUniverse: string | null;
}>;

export function buildSimulationHref(input: SimulationNavigationInput) {
  const params = new URLSearchParams({
    horizon: String(input.researchHorizon),
  });
  if (input.account) {
    params.set("account", input.account);
  }
  if (input.endServiceDate) {
    params.set("end", input.endServiceDate);
  }
  if (input.kodexWeightPct !== null) {
    params.set("kodexWeight", String(input.kodexWeightPct));
  }
  if (input.researchUniverse !== null) {
    params.set("researchUniverse", input.researchUniverse);
  }
  return `/simulation?${params}`;
}
