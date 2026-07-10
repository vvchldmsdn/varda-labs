import { buildPortfolioRiskInput } from "./portfolio-risk-input.ts";
import { calculatePortfolioRisk } from "./portfolio-risk.ts";
import type {
  PortfolioRiskAssetSourceRow,
  PortfolioRiskFxSourceRow,
  PortfolioRiskPriceSourceRow,
  PortfolioRiskQueryRange,
  PortfolioRiskSelection,
} from "./portfolio-risk-read-model-types.ts";

export const PORTFOLIO_RISK_READ_POLICY = {
  maxPriceCarryDays: 7,
  maxFxCarryDays: 3,
  minimumReturnCoveragePct: 80,
  minimumInstruments: 2,
} as const;

export function composePortfolioRiskReadModel({
  selection,
  queryRange,
  assetRows,
  priceRows,
  fxRows,
}: {
  selection: PortfolioRiskSelection;
  queryRange: PortfolioRiskQueryRange;
  assetRows: readonly PortfolioRiskAssetSourceRow[];
  priceRows: readonly PortfolioRiskPriceSourceRow[];
  fxRows: readonly PortfolioRiskFxSourceRow[];
}) {
  const selectedAssets = assetRows.filter((row) =>
    selection.account === "all"
      ? isTrackedAccount(row.account)
      : row.account === selection.account,
  );
  const canonicalPriceRows = priceRows.filter((row) => !row.isSample);
  const nonSampleFxRows = fxRows.filter((row) => !row.isSample);
  const canonicalFxRows = nonSampleFxRows.filter(
    (row) => row.status?.trim().toLowerCase() === "ok",
  );
  const input = buildPortfolioRiskInput({
    holdings: selectedAssets,
    priceRows: canonicalPriceRows,
    fxRows: canonicalFxRows,
    policy: {
      requestedReturnObservations: selection.window,
      maxPriceCarryDays: PORTFOLIO_RISK_READ_POLICY.maxPriceCarryDays,
      maxFxCarryDays: PORTFOLIO_RISK_READ_POLICY.maxFxCarryDays,
      minimumReturnCoveragePct:
        PORTFOLIO_RISK_READ_POLICY.minimumReturnCoveragePct,
      minimumInstruments: PORTFOLIO_RISK_READ_POLICY.minimumInstruments,
    },
  });
  const calculation = calculatePortfolioRisk({
    inputStatus: input.status,
    instruments: input.instruments,
    returnRows: input.returnRows,
    annualRiskFreeRate: 0,
  });
  const observations = input.valueRows.flatMap((row) => row.observations);

  return {
    selection,
    provenance: {
      serviceCycleDate: queryRange.serviceCycleDate,
      priceSourceDateFrom: queryRange.priceSourceDateFrom,
      fxSourceDateFrom: queryRange.fxSourceDateFrom,
      sourceDateTo: queryRange.sourceDateTo,
      firstServiceDate: input.firstServiceDate,
      lastServiceDate: input.lastServiceDate,
      weightAsOfServiceDate: input.weightAsOfDate,
      requestedReturnObservations: selection.window,
      usableReturnObservations: input.usableReturnObservations,
      returnCoveragePct: input.returnCoveragePct,
      selectedHoldingCount: input.selectedHoldingCount,
      eligibleHoldingCount: input.eligibleHoldingCount,
      includedInstrumentCount: input.instruments.length,
      excludedHoldingCount: input.exclusions.length,
      maxPriceCarryDaysPolicy:
        PORTFOLIO_RISK_READ_POLICY.maxPriceCarryDays,
      maxFxCarryDaysPolicy: PORTFOLIO_RISK_READ_POLICY.maxFxCarryDays,
      maxObservedPriceCarryDays: maxOrNull(
        observations.map((row) => row.priceCarryDays),
      ),
      maxObservedFxCarryDays: maxOrNull(
        observations
          .filter((row) => row.sourceFxDate !== null)
          .map((row) => row.fxCarryDays),
      ),
      formulaVersion: calculation.formulaVersion,
      returnCurrencyMode: calculation.returnCurrencyMode,
      returnType: calculation.returnType,
      annualizationFactor: calculation.annualizationFactor,
      annualRiskFreeRate: calculation.annualRiskFreeRate,
      dailyRiskFreeRate: calculation.dailyRiskFreeRate,
    },
    inputHealth: {
      status: input.status,
      blockers: input.blockers,
      exclusions: input.exclusions,
      invalidPriceRowCount: input.invalidPriceRowCount,
      invalidFxRowCount: input.invalidFxRowCount,
      undefinedCorrelationPairCount: countUndefinedPairs(
        calculation.portfolio?.correlationMatrix ?? null,
      ),
      zeroVarianceInstruments: calculation.dataHealth.zeroVarianceInstruments,
      downDayObservations:
        calculation.portfolio?.stress.downDayObservations ?? null,
      sourceRows: {
        price: {
          queried: priceRows.length,
          canonical: canonicalPriceRows.length,
          sampleExcluded: priceRows.length - canonicalPriceRows.length,
          sources: countSources(canonicalPriceRows),
        },
        fx: {
          queried: fxRows.length,
          canonical: canonicalFxRows.length,
          sampleExcluded: fxRows.length - nonSampleFxRows.length,
          invalidStatusExcluded:
            nonSampleFxRows.length - canonicalFxRows.length,
          sources: countSources(canonicalFxRows),
        },
      },
    },
    calculation,
  };
}

export type PortfolioRiskReadModel = ReturnType<
  typeof composePortfolioRiskReadModel
>;

function isTrackedAccount(account: string) {
  return account === "brokerage" || account === "isa" || account === "irp";
}

function countSources(rows: readonly { source: string | null }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const source = row.source?.trim() || "(blank)";
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function countUndefinedPairs(matrix: Array<Array<number | null>> | null) {
  if (!matrix) return null;
  let count = 0;
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = row + 1; column < matrix.length; column += 1) {
      if (matrix[row][column] === null) count += 1;
    }
  }
  return count;
}

function maxOrNull(values: readonly number[]) {
  return values.length > 0 ? Math.max(...values) : null;
}
