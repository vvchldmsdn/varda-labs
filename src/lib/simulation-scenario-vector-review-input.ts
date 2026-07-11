export type SimulationScenarioInstrumentInput = Readonly<{
  market: string | null;
  currency: string | null;
  ticker: string | null;
}>;

export type SimulationScenarioWeightInput = Readonly<{
  market: string | null;
  currency: string | null;
  ticker: string | null;
  weightBps: number | null;
}>;

export type NormalizedSimulationScenarioInstrument = Readonly<{
  sourceIndex: number;
  market: string | null;
  currency: string | null;
  ticker: string | null;
  instrumentKey: string | null;
}>;

export type NormalizedSimulationScenarioWeight = Readonly<{
  sourceIndex: number;
  market: string | null;
  currency: string | null;
  ticker: string | null;
  instrumentKey: string | null;
  weightBps: number | null;
  weightState: "finite" | "invalid";
}>;

export function normalizeSimulationScenarioVectorReviewInput(input: {
  scenarioId: string;
  scenarioVersion: string;
  matrixInstruments: readonly SimulationScenarioInstrumentInput[];
  weights: readonly SimulationScenarioWeightInput[];
}) {
  return Object.freeze({
    scenarioId: normalizeDescriptor(input.scenarioId),
    scenarioVersion: normalizeDescriptor(input.scenarioVersion),
    matrixInstruments: Object.freeze(
      input.matrixInstruments.map(normalizeInstrument),
    ),
    weights: Object.freeze(input.weights.map(normalizeWeight)),
  });
}

function normalizeInstrument(
  input: SimulationScenarioInstrumentInput,
  sourceIndex: number,
): NormalizedSimulationScenarioInstrument {
  return Object.freeze({ sourceIndex, ...normalizeIdentity(input) });
}

function normalizeWeight(
  input: SimulationScenarioWeightInput,
  sourceIndex: number,
): NormalizedSimulationScenarioWeight {
  const weightState = Number.isFinite(input.weightBps)
    ? "finite"
    : "invalid";
  return Object.freeze({
    sourceIndex,
    ...normalizeIdentity(input),
    weightBps: weightState === "finite" ? input.weightBps : null,
    weightState,
  });
}

function normalizeIdentity(input: {
  market: string | null;
  currency: string | null;
  ticker: string | null;
}) {
  const market = normalizeText(input.market)?.toLowerCase() ?? null;
  const currency = normalizeText(input.currency)?.toUpperCase() ?? null;
  const ticker = normalizeText(input.ticker)?.toUpperCase() ?? null;
  return {
    market,
    currency,
    ticker,
    instrumentKey:
      market && currency && ticker
        ? `${market}|${currency}|${ticker}`
        : null,
  };
}

function normalizeDescriptor(value: string) {
  const normalized = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(normalized)
    ? normalized
    : null;
}

function normalizeText(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
