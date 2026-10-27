import {
  CORE_MARKET_FACTOR_REFRESH_POLICY,
  type CoreMarketFactorDefinition,
  type CoreMarketFactorObservation,
} from "./core-market-factor-policy.ts";

export function buildCoreMarketFactorRows({
  definition,
  observations,
  observedAt,
  writeFromDate,
}: {
  definition: CoreMarketFactorDefinition;
  observations: readonly CoreMarketFactorObservation[];
  observedAt: Date;
  writeFromDate: string;
}) {
  const ordered = validateObservations(observations, definition.factorKey);
  const changes = ordered.map((row, index) =>
    index === 0
      ? null
      : transformedChange(
          ordered[index - 1].value,
          row.value,
          definition.transform,
        ),
  );

  return Object.freeze(
    ordered.flatMap((row, index) => {
      if (row.date < writeFromDate || index === 0) return [];
      const previous = ordered[index - 1];
      const oneYearStart = shiftDate(row.date, -366);
      const oneYearValues = ordered
        .slice(0, index + 1)
        .filter((candidate) => candidate.date >= oneYearStart)
        .map((candidate) => candidate.value);
      const changeWindow20 = finiteTail(changes, index, 20);
      const changeWindow60 = finiteTail(changes, index, 60);
      if (changeWindow20.length < 10 || changeWindow60.length < 20) return [];

      const changePct = relativeChange(previous.value, row.value);
      return [
        Object.freeze({
          factorDate: row.date,
          factorKey: definition.factorKey,
          factorFamily: definition.factorFamily,
          factorName: definition.factorName,
          frequency: CORE_MARKET_FACTOR_REFRESH_POLICY.frequency,
          source: definition.source,
          sourceSeriesId: definition.sourceSeriesId,
          benchmarkKey: null,
          countryCode: definition.countryCode,
          region: definition.region,
          relatedCurrency: definition.relatedCurrency,
          tenor: definition.tenor,
          description: `${definition.factorName} canonical provider refresh`,
          derivedMetricsJson: {
            calculationVersion: CORE_MARKET_FACTOR_REFRESH_POLICY.version,
            sourceSeriesId: definition.sourceSeriesId,
            volatilityTransform: definition.transform,
          },
          isPreliminary: false,
          isSample: false,
          value: decimal(row.value),
          prevValue: decimal(previous.value),
          changePct: nullableDecimal(changePct),
          change1mPct: nullableDecimal(laggedChange(ordered, index, 21)),
          change3mPct: nullableDecimal(laggedChange(ordered, index, 63)),
          change6mPct: nullableDecimal(laggedChange(ordered, index, 126)),
          changeSpeed20d: nullableDecimal(
            changes[index] === null
              ? null
              : changes[index]! - mean(changeWindow20),
          ),
          percentile1y: decimal(percentileRank(oneYearValues, row.value)),
          volatility20dPct: decimal(sampleStandardDeviation(changeWindow20)),
          volatility60dPct: decimal(sampleStandardDeviation(changeWindow60)),
          carrySpreadValue: null,
          periodEndDate: row.date,
          releaseDate: row.date,
          observedAt,
          updatedAt: observedAt,
        }),
      ];
    }),
  );
}

function validateObservations(
  observations: readonly CoreMarketFactorObservation[],
  factorKey: string,
) {
  const ordered = [...observations].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  const seen = new Set<string>();
  for (const row of ordered) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isFinite(row.value) ||
      seen.has(row.date)
    ) {
      throw new Error(`Invalid ${factorKey} observation series`);
    }
    seen.add(row.date);
  }
  return ordered;
}

function transformedChange(
  previous: number,
  current: number,
  transform: CoreMarketFactorDefinition["transform"],
) {
  if (transform === "log_return_pct") {
    return previous > 0 && current > 0
      ? Math.log(current / previous) * 100
      : null;
  }
  return current - previous;
}

function relativeChange(previous: number, current: number) {
  return Math.abs(previous) > 1e-12
    ? ((current / previous) - 1) * 100
    : null;
}

function laggedChange(
  rows: readonly CoreMarketFactorObservation[],
  index: number,
  lag: number,
) {
  const previous = rows[index - lag];
  return previous ? relativeChange(previous.value, rows[index].value) : null;
}

function finiteTail(
  values: readonly (number | null)[],
  endIndex: number,
  size: number,
) {
  return values
    .slice(Math.max(0, endIndex - size + 1), endIndex + 1)
    .filter((value): value is number => value !== null && Number.isFinite(value));
}

function percentileRank(values: readonly number[], current: number) {
  if (values.length === 0) return 0;
  return (values.filter((value) => value <= current).length / values.length) * 100;
}

function sampleStandardDeviation(values: readonly number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function mean(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function decimal(value: number) {
  return Number(value.toFixed(12)).toString();
}

function nullableDecimal(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : decimal(value);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
