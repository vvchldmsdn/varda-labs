export type SimulationHistoricalOutcomePrediction = Readonly<{
  p10ReturnPct: number;
  p50ReturnPct: number;
  p90ReturnPct: number;
  lossProbabilityPct: number;
  maxDrawdownP50Pct: number;
  maxDrawdownP90Pct: number;
}>;

export type SimulationHistoricalOutcomeObservation = Readonly<{
  terminalReturnPct: number;
  terminalLoss: boolean;
  maxDrawdownPct: number;
}>;

export type SimulationHistoricalOutcomeReadyRow = Readonly<{
  outcomeEndServiceDate: string;
  status: "ready";
  reason: null;
  trainingEndServiceDate: string;
  outcomeStartServiceDate: string;
  trainingReturnStepCount: number;
  outcomeReturnStepCount: number;
  predictedP10ReturnPct: number;
  predictedP50ReturnPct: number;
  predictedP90ReturnPct: number;
  actualReturnPct: number;
  inP10P90Band: boolean;
  signedP50ErrorPctPoints: number;
  absoluteP50ErrorPctPoints: number;
  predictedLossProbabilityPct: number;
  actualTerminalLoss: boolean;
  predictedMaxDrawdownP50Pct: number;
  predictedMaxDrawdownP90Pct: number;
  actualMaxDrawdownPct: number;
  actualWithinPredictedMddP90: boolean;
  signedMddP50ErrorPctPoints: number;
  absoluteMddP50ErrorPctPoints: number;
}>;

export type SimulationHistoricalOutcomeUnavailableRow<
  Reason extends string = string,
> = Readonly<{
  outcomeEndServiceDate: string;
  status: "unavailable";
  reason: Reason;
  trainingEndServiceDate: null;
  outcomeStartServiceDate: null;
  trainingReturnStepCount: null;
  outcomeReturnStepCount: null;
  predictedP10ReturnPct: null;
  predictedP50ReturnPct: null;
  predictedP90ReturnPct: null;
  actualReturnPct: null;
  inP10P90Band: null;
  signedP50ErrorPctPoints: null;
  absoluteP50ErrorPctPoints: null;
  predictedLossProbabilityPct: null;
  actualTerminalLoss: null;
  predictedMaxDrawdownP50Pct: null;
  predictedMaxDrawdownP90Pct: null;
  actualMaxDrawdownPct: null;
  actualWithinPredictedMddP90: null;
  signedMddP50ErrorPctPoints: null;
  absoluteMddP50ErrorPctPoints: null;
}>;

export type SimulationHistoricalOutcomeRow<Reason extends string = string> =
  | SimulationHistoricalOutcomeReadyRow
  | SimulationHistoricalOutcomeUnavailableRow<Reason>;

export function buildSimulationHistoricalOutcomeReadyRow(input: {
  outcomeEndServiceDate: string;
  trainingEndServiceDate: string;
  outcomeStartServiceDate: string;
  trainingReturnStepCount: number;
  outcomeReturnStepCount: number;
  predicted: SimulationHistoricalOutcomePrediction;
  observed: SimulationHistoricalOutcomeObservation;
}): SimulationHistoricalOutcomeReadyRow {
  const actualReturnPct = input.observed.terminalReturnPct;
  const signedP50ErrorPctPoints =
    actualReturnPct - input.predicted.p50ReturnPct;
  const signedMddP50ErrorPctPoints =
    input.observed.maxDrawdownPct -
    input.predicted.maxDrawdownP50Pct;

  return Object.freeze({
    outcomeEndServiceDate: input.outcomeEndServiceDate,
    status: "ready" as const,
    reason: null,
    trainingEndServiceDate: input.trainingEndServiceDate,
    outcomeStartServiceDate: input.outcomeStartServiceDate,
    trainingReturnStepCount: input.trainingReturnStepCount,
    outcomeReturnStepCount: input.outcomeReturnStepCount,
    predictedP10ReturnPct: input.predicted.p10ReturnPct,
    predictedP50ReturnPct: input.predicted.p50ReturnPct,
    predictedP90ReturnPct: input.predicted.p90ReturnPct,
    actualReturnPct,
    inP10P90Band:
      actualReturnPct >= input.predicted.p10ReturnPct &&
      actualReturnPct <= input.predicted.p90ReturnPct,
    signedP50ErrorPctPoints,
    absoluteP50ErrorPctPoints: Math.abs(signedP50ErrorPctPoints),
    predictedLossProbabilityPct: input.predicted.lossProbabilityPct,
    actualTerminalLoss: input.observed.terminalLoss,
    predictedMaxDrawdownP50Pct:
      input.predicted.maxDrawdownP50Pct,
    predictedMaxDrawdownP90Pct:
      input.predicted.maxDrawdownP90Pct,
    actualMaxDrawdownPct: input.observed.maxDrawdownPct,
    actualWithinPredictedMddP90:
      input.observed.maxDrawdownPct <=
      input.predicted.maxDrawdownP90Pct,
    signedMddP50ErrorPctPoints,
    absoluteMddP50ErrorPctPoints: Math.abs(
      signedMddP50ErrorPctPoints,
    ),
  });
}

export function unavailableSimulationHistoricalOutcomeRow<
  Reason extends string,
>(
  outcomeEndServiceDate: string,
  reason: Reason,
): SimulationHistoricalOutcomeUnavailableRow<Reason> {
  return Object.freeze({
    outcomeEndServiceDate,
    status: "unavailable" as const,
    reason,
    trainingEndServiceDate: null,
    outcomeStartServiceDate: null,
    trainingReturnStepCount: null,
    outcomeReturnStepCount: null,
    predictedP10ReturnPct: null,
    predictedP50ReturnPct: null,
    predictedP90ReturnPct: null,
    actualReturnPct: null,
    inP10P90Band: null,
    signedP50ErrorPctPoints: null,
    absoluteP50ErrorPctPoints: null,
    predictedLossProbabilityPct: null,
    actualTerminalLoss: null,
    predictedMaxDrawdownP50Pct: null,
    predictedMaxDrawdownP90Pct: null,
    actualMaxDrawdownPct: null,
    actualWithinPredictedMddP90: null,
    signedMddP50ErrorPctPoints: null,
    absoluteMddP50ErrorPctPoints: null,
  });
}

export function summarizeSimulationHistoricalOutcomeRows<
  Reason extends string,
>(rows: readonly SimulationHistoricalOutcomeRow<Reason>[]) {
  const readyRows = rows.filter(isReadyRow);
  const readyEndpointCount = readyRows.length;
  const unavailableEndpointCount = rows.length - readyEndpointCount;
  const bandHitCount = readyRows.filter(
    (row) => row.inP10P90Band,
  ).length;
  const actualLossEndpointCount = readyRows.filter(
    (row) => row.actualTerminalLoss,
  ).length;
  const actualWithinPredictedMddP90Count = readyRows.filter(
    (row) => row.actualWithinPredictedMddP90,
  ).length;
  const status =
    readyEndpointCount === rows.length
      ? ("ready" as const)
      : readyEndpointCount > 0
        ? ("partial" as const)
        : ("unavailable" as const);

  return Object.freeze({
    status,
    reason:
      status === "ready"
        ? null
        : status === "partial"
          ? ("some_endpoints_unavailable" as const)
          : ("all_endpoints_unavailable" as const),
    summary: Object.freeze({
      endpointCount: rows.length,
      readyEndpointCount,
      unavailableEndpointCount,
      bandHitCount,
      bandCoveragePct:
        readyEndpointCount > 0
          ? (bandHitCount / readyEndpointCount) * 100
          : null,
      meanAbsoluteP50ErrorPctPoints:
        readyEndpointCount > 0
          ? compensatedMean(
              readyRows.map(
                (row) => row.absoluteP50ErrorPctPoints,
              ),
            )
          : null,
    }),
    downsideSummary: Object.freeze({
      readyEndpointCount,
      unavailableEndpointCount,
      meanPredictedLossProbabilityPct:
        readyEndpointCount > 0
          ? compensatedMean(
              readyRows.map(
                (row) => row.predictedLossProbabilityPct,
              ),
            )
          : null,
      actualLossEndpointCount,
      actualWithinPredictedMddP90Count,
      meanAbsoluteMddP50ErrorPctPoints:
        readyEndpointCount > 0
          ? compensatedMean(
              readyRows.map(
                (row) => row.absoluteMddP50ErrorPctPoints,
              ),
            )
          : null,
    }),
  });
}

function isReadyRow<Reason extends string>(
  row: SimulationHistoricalOutcomeRow<Reason>,
): row is SimulationHistoricalOutcomeReadyRow {
  return row.status === "ready";
}

function compensatedMean(values: readonly number[]) {
  return neumaierSum(values) / values.length;
}

function neumaierSum(values: readonly number[]) {
  let sum = 0;
  let compensation = 0;
  for (const term of values) {
    const next = sum + term;
    const correction =
      Math.abs(sum) >= Math.abs(term)
        ? (sum - next) + term
        : (term - next) + sum;
    sum = next;
    compensation += correction;
  }
  return sum + compensation;
}
