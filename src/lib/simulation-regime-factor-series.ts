import {
  isRiskDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";
import {
  SIMULATION_REGIME_BOOTSTRAP_POLICY,
  SIMULATION_REGIME_FACTOR_DEFINITIONS,
  type SimulationRegimeFactorKey,
  type SimulationRegimeFactorObservation,
} from "./simulation-regime-bootstrap-policy.ts";

export type CanonicalSimulationRegimeFactorObservation = Readonly<{
  factorKey: SimulationRegimeFactorKey;
  factorDate: string;
  periodEndDate: string;
  releaseDate: string;
  values: readonly [number, number];
}>;

export type SimulationRegimeFactorSeries = Map<
  SimulationRegimeFactorKey,
  CanonicalSimulationRegimeFactorObservation[]
>;

export function normalizeSimulationRegimeFactorRows(
  rows: readonly SimulationRegimeFactorObservation[],
) {
  const allowedKeys = new Set<SimulationRegimeFactorKey>(
    SIMULATION_REGIME_FACTOR_DEFINITIONS.map((row) => row.factorKey),
  );
  const grouped: SimulationRegimeFactorSeries = new Map();
  let invalid = false;

  for (const row of rows) {
    if (!allowedKeys.has(row.factorKey as SimulationRegimeFactorKey)) {
      invalid = true;
      continue;
    }
    const factorKey = row.factorKey as SimulationRegimeFactorKey;
    const value = finiteNumber(row.value);
    const volatility = finiteNumber(row.volatility20dPct);
    if (
      !isRiskDate(row.factorDate) ||
      !isRiskDate(row.periodEndDate) ||
      !isRiskDate(row.releaseDate) ||
      row.factorDate > row.releaseDate ||
      row.periodEndDate > row.releaseDate ||
      value === null ||
      volatility === null ||
      volatility < 0
    ) {
      invalid = true;
      continue;
    }
    const series = grouped.get(factorKey) ?? [];
    series.push(
      Object.freeze({
        factorKey,
        factorDate: row.factorDate,
        periodEndDate: row.periodEndDate,
        releaseDate: row.releaseDate,
        values: Object.freeze([value, volatility] as const),
      }),
    );
    grouped.set(factorKey, series);
  }

  for (const definition of SIMULATION_REGIME_FACTOR_DEFINITIONS) {
    const series = grouped.get(definition.factorKey) ?? [];
    series.sort(
      (left, right) =>
        left.releaseDate.localeCompare(right.releaseDate) ||
        left.factorDate.localeCompare(right.factorDate),
    );
    if (
      series.some(
        (row, index) =>
          index > 0 && row.releaseDate === series[index - 1].releaseDate,
      )
    ) {
      invalid = true;
    }
    grouped.set(definition.factorKey, series);
  }

  return invalid ? null : grouped;
}

export function resolveSimulationRegimeFactorVector(
  series: SimulationRegimeFactorSeries,
  stateDate: string,
  staleAsMissing: boolean,
):
  | Readonly<{ status: "ready"; values: readonly number[] }>
  | Readonly<{ status: "missing" | "stale"; values: null }> {
  if (!isRiskDate(stateDate)) {
    return Object.freeze({ status: "missing" as const, values: null });
  }

  const values: number[] = [];
  for (const definition of SIMULATION_REGIME_FACTOR_DEFINITIONS) {
    const observation = latestSimulationRegimeFactorOnOrBefore(
      series.get(definition.factorKey) ?? [],
      stateDate,
    );
    if (!observation) {
      return Object.freeze({ status: "missing" as const, values: null });
    }
    const carryDays = riskCalendarDayDistance(
      observation.releaseDate,
      stateDate,
    );
    if (
      carryDays < 0 ||
      carryDays > SIMULATION_REGIME_BOOTSTRAP_POLICY.factorMaxCarryDays
    ) {
      return Object.freeze({
        status: staleAsMissing ? ("missing" as const) : ("stale" as const),
        values: null,
      });
    }
    values.push(...observation.values);
  }
  return Object.freeze({
    status: "ready" as const,
    values: Object.freeze(values),
  });
}

export function buildSimulationRegimeFactorSourceSummaries(
  series: SimulationRegimeFactorSeries,
  currentStateDate: string,
  stateDates: readonly string[],
) {
  return Object.freeze(
    SIMULATION_REGIME_FACTOR_DEFINITIONS.map((definition) => {
      const rows = series.get(definition.factorKey) ?? [];
      const current = latestSimulationRegimeFactorOnOrBefore(
        rows,
        currentStateDate,
      );
      const currentCarryDays = current
        ? riskCalendarDayDistance(current.releaseDate, currentStateDate)
        : null;
      const alignedStateCount = stateDates.filter((stateDate) => {
        const row = latestSimulationRegimeFactorOnOrBefore(rows, stateDate);
        if (!row) return false;
        const carryDays = riskCalendarDayDistance(row.releaseDate, stateDate);
        return (
          carryDays >= 0 &&
          carryDays <= SIMULATION_REGIME_BOOTSTRAP_POLICY.factorMaxCarryDays
        );
      }).length;
      return Object.freeze({
        factorKey: definition.factorKey,
        label: definition.label,
        latestReleaseDate: rows.at(-1)?.releaseDate ?? null,
        currentReleaseDate: current?.releaseDate ?? null,
        currentCarryDays,
        alignedStateCount,
      });
    }),
  );
}

function latestSimulationRegimeFactorOnOrBefore(
  rows: readonly CanonicalSimulationRegimeFactorObservation[],
  stateDate: string,
) {
  let low = 0;
  let high = rows.length - 1;
  let selected: CanonicalSimulationRegimeFactorObservation | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const row = rows[middle];
    if (row.releaseDate <= stateDate) {
      selected = row;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return selected;
}

function finiteNumber(value: number | string) {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
