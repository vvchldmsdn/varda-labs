export const SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY = Object.freeze({
  version: "simulation_observed_return_comparison_v1",
  expectedInputCount: 2,
  expectedReturnCount: 90,
  expectedPointCount: 91,
  initialIndexValue: 100,
  mode: "aligned_complete_krw_observed_returns_only",
} as const);

type ObservedReturnRow = Readonly<{
  previousServiceDate: string;
  serviceDate: string;
  value: number;
}>;

export type SimulationObservedReturnComparisonInput = Readonly<{
  id: string;
  ticker: string;
  name: string;
  status: "matrix_ready" | "unavailable";
  observedReturns: readonly ObservedReturnRow[] | null;
}>;

export type SimulationObservedReturnComparison = ReturnType<
  typeof buildSimulationObservedReturnComparison
>;

export function buildSimulationObservedReturnComparison(
  inputs: readonly SimulationObservedReturnComparisonInput[],
) {
  if (
    inputs.length !==
      SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY.expectedInputCount ||
    new Set(inputs.map((input) => input.id)).size !== inputs.length
  ) {
    return unavailable("invalid_input_set");
  }

  if (
    inputs.some(
      (input) =>
        input.status !== "matrix_ready" ||
        !input.observedReturns ||
        input.observedReturns.length === 0,
    )
  ) {
    return unavailable("input_unavailable");
  }

  if (
    inputs.some(
      (input) =>
        input.observedReturns?.length !==
        SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY.expectedReturnCount,
    )
  ) {
    return unavailable("invalid_return_count");
  }

  const referenceRows = inputs[0].observedReturns;
  if (!referenceRows || !isInternallyCompleteSeries(referenceRows)) {
    return unavailable("invalid_return_series");
  }

  for (const input of inputs.slice(1)) {
    const rows = input.observedReturns;
    if (
      !rows ||
      !isInternallyCompleteSeries(rows) ||
      !hasSameAxis(referenceRows, rows)
    ) {
      return unavailable("axis_mismatch");
    }
  }

  const baselineServiceDate = referenceRows[0].previousServiceDate;
  const series = inputs.map((input) => {
    let indexValue =
      SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY.initialIndexValue;
    const points: Readonly<{ serviceDate: string; value: number }>[] = [
      Object.freeze({
        serviceDate: baselineServiceDate,
        value: indexValue,
      }),
    ];

    for (const row of input.observedReturns ?? []) {
      indexValue *= 1 + row.value;
      if (!Number.isFinite(indexValue) || indexValue < 0) {
        return null;
      }
      points.push(
        Object.freeze({
          serviceDate: row.serviceDate,
          value: indexValue,
        }),
      );
    }

    return Object.freeze({
      id: input.id,
      ticker: input.ticker,
      name: input.name,
      finalIndexValue: indexValue,
      totalReturn:
        indexValue /
          SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY.initialIndexValue -
        1,
      points: Object.freeze(points),
    });
  });

  if (series.some((item) => item === null)) {
    return unavailable("invalid_return_series");
  }

  const completeSeries = series.filter(
    (item): item is NonNullable<typeof item> => item !== null,
  );
  if (
    completeSeries.length !==
      SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY.expectedInputCount ||
    completeSeries.some(
      (item) =>
        item.points.length !==
        SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY.expectedPointCount,
    )
  ) {
    return unavailable("invalid_return_count");
  }
  return Object.freeze({
    status: "ready" as const,
    reason: null,
    baselineServiceDate,
    endServiceDate: referenceRows.at(-1)?.serviceDate ?? baselineServiceDate,
    pointCount:
      SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY.expectedPointCount,
    series: Object.freeze(completeSeries),
  });
}

function isInternallyCompleteSeries(rows: readonly ObservedReturnRow[]) {
  return rows.every(
    (row, index) =>
      isDateKey(row.previousServiceDate) &&
      isDateKey(row.serviceDate) &&
      row.previousServiceDate < row.serviceDate &&
      Number.isFinite(row.value) &&
      row.value >= -1 &&
      (index === 0 ||
        rows[index - 1].serviceDate === row.previousServiceDate),
  );
}

function hasSameAxis(
  referenceRows: readonly ObservedReturnRow[],
  candidateRows: readonly ObservedReturnRow[],
) {
  return (
    referenceRows.length === candidateRows.length &&
    candidateRows.every(
      (row, index) =>
        row.previousServiceDate ===
          referenceRows[index]?.previousServiceDate &&
        row.serviceDate === referenceRows[index]?.serviceDate,
    )
  );
}

function unavailable(
  reason:
    | "invalid_input_set"
    | "input_unavailable"
    | "invalid_return_count"
    | "invalid_return_series"
    | "axis_mismatch",
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    baselineServiceDate: null,
    endServiceDate: null,
    pointCount: 0,
    series: Object.freeze([]),
  });
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
