export const SIMULATION_RESEARCH_HORIZON_POLICY = Object.freeze({
  version: "simulation_research_horizon_v1",
  queryParameter: "horizon",
  allowedHorizons: Object.freeze([63, 126] as const),
  defaultHorizon: 63 as const,
  unit: "trading_steps",
  invalidFallback: "forbidden",
  regimeExtension: "forbidden_until_strict_pit_evidence_is_ready",
} as const);

export type SimulationResearchHorizon =
  (typeof SIMULATION_RESEARCH_HORIZON_POLICY.allowedHorizons)[number];

export type SimulationResearchHorizonSelection = ReturnType<
  typeof resolveSimulationResearchHorizon
>;

export function resolveSimulationResearchHorizon(
  suppliedValue: string | string[] | undefined,
) {
  if (suppliedValue === undefined) {
    return Object.freeze({
      status: "valid" as const,
      source: "default" as const,
      horizon: SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon,
    });
  }

  if (Array.isArray(suppliedValue)) {
    return invalidSelection();
  }

  const horizon =
    suppliedValue === "63" ? 63 : suppliedValue === "126" ? 126 : null;
  return horizon !== null
    ? Object.freeze({
        status: "valid" as const,
        source: "query" as const,
        horizon,
      })
    : invalidSelection();
}

export function isSimulationResearchHorizon(
  value: number,
): value is SimulationResearchHorizon {
  return SIMULATION_RESEARCH_HORIZON_POLICY.allowedHorizons.some(
    (horizon) => horizon === value,
  );
}

function invalidSelection() {
  return Object.freeze({
    status: "invalid" as const,
    source: "query" as const,
    horizon: null,
  });
}
