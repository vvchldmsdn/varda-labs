export type SimulationNavigationInput = Readonly<{
  endServiceDate: string | null;
  researchHorizon: 63 | 126;
  kodexWeightPct: number | null;
  researchUniverse: string | null;
}>;

export function buildSimulationHref(input: SimulationNavigationInput) {
  const params = new URLSearchParams({
    horizon: String(input.researchHorizon),
  });
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
