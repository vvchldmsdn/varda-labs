import type {
  PortfolioStructureExclusion,
  PortfolioStructureHoldingRow,
  PortfolioStructureResult,
} from "./portfolio-structure.ts";
import {
  analyzePortfolioDirectHoldings,
  calculatePortfolioDirectHoldingMetrics,
} from "./portfolio-direct-holdings.ts";
import {
  INVESTMENT_LAB_SMALL_ADJUSTMENT_POLICY,
  type InvestmentLabSmallAdjustmentAccount,
  type InvestmentLabSmallAdjustmentAccountBlocker,
  type InvestmentLabSmallAdjustmentAccountModel,
  type InvestmentLabSmallAdjustmentCalculation,
  type InvestmentLabSmallAdjustmentCalculationBlocker,
  type InvestmentLabSmallAdjustmentConcentration,
  type InvestmentLabSmallAdjustmentHolding,
  type InvestmentLabSmallAdjustmentModel,
} from "./investment-lab-small-adjustment-types.ts";

export { INVESTMENT_LAB_SMALL_ADJUSTMENT_POLICY } from "./investment-lab-small-adjustment-types.ts";
export type {
  InvestmentLabSmallAdjustmentAccount,
  InvestmentLabSmallAdjustmentAccountBlocker,
  InvestmentLabSmallAdjustmentAccountModel,
  InvestmentLabSmallAdjustmentCalculation,
  InvestmentLabSmallAdjustmentCalculationBlocker,
  InvestmentLabSmallAdjustmentConcentration,
  InvestmentLabSmallAdjustmentCurrencyExposure,
  InvestmentLabSmallAdjustmentHolding,
  InvestmentLabSmallAdjustmentModel,
} from "./investment-lab-small-adjustment-types.ts";

const ACCOUNTS = ["brokerage", "isa", "irp"] as const;

export function buildInvestmentLabSmallAdjustmentModel(
  portfolio: Pick<PortfolioStructureResult, "holdingRows" | "exclusions">,
): InvestmentLabSmallAdjustmentModel {
  return Object.freeze({
    policy: INVESTMENT_LAB_SMALL_ADJUSTMENT_POLICY,
    accounts: Object.freeze(
      ACCOUNTS.map((account) =>
        buildAccountModel(
          account,
          portfolio.holdingRows.filter((row) => row.account === account),
          portfolio.exclusions.filter((row) => row.account === account),
        ),
      ),
    ),
  });
}

export function calculateInvestmentLabSmallAdjustment(input: {
  account: InvestmentLabSmallAdjustmentAccountModel;
  sourceKey: string;
  destinationKey: string;
  transferAmountKrw: number;
}): InvestmentLabSmallAdjustmentCalculation {
  const { account, sourceKey, destinationKey, transferAmountKrw } = input;
  if (account.status !== "ready") {
    return blocked(account.account, "account_unavailable");
  }
  if (sourceKey === destinationKey) {
    return blocked(account.account, "same_holding");
  }

  const source = account.holdings.find((row) => row.key === sourceKey);
  if (!source) {
    return blocked(account.account, "source_holding_unavailable");
  }
  const destination = account.holdings.find(
    (row) => row.key === destinationKey,
  );
  if (!destination) {
    return blocked(account.account, "destination_holding_unavailable");
  }
  if (!Number.isSafeInteger(transferAmountKrw) || transferAmountKrw <= 0) {
    return blocked(account.account, "invalid_transfer_amount");
  }
  if (transferAmountKrw > source.currentValueKrw) {
    return blocked(account.account, "insufficient_source_value");
  }

  const afterHoldings = account.holdings.map((row) => {
    if (row.key === source.key) {
      return { ...row, currentValueKrw: row.currentValueKrw - transferAmountKrw };
    }
    if (row.key === destination.key) {
      return { ...row, currentValueKrw: row.currentValueKrw + transferAmountKrw };
    }
    return row;
  });
  const beforeSnapshot = createSnapshot(account.holdings);
  const afterSnapshot = createSnapshot(afterHoldings);
  if (
    !beforeSnapshot ||
    !afterSnapshot ||
    !approximatelyEqual(beforeSnapshot.totalValueKrw, afterSnapshot.totalValueKrw)
  ) {
    return blocked(account.account, "invalid_calculation_result");
  }

  const sourceAfter = afterHoldings.find((row) => row.key === source.key);
  const destinationAfter = afterHoldings.find(
    (row) => row.key === destination.key,
  );
  if (!sourceAfter || !destinationAfter) {
    return blocked(account.account, "invalid_calculation_result");
  }

  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_SMALL_ADJUSTMENT_POLICY,
    account: account.account,
    transferAmountKrw,
    totalValueKrw: beforeSnapshot.totalValueKrw,
    source: Object.freeze({
      key: source.key,
      name: source.name,
      ticker: source.ticker,
      beforeValueKrw: source.currentValueKrw,
      afterValueKrw: sourceAfter.currentValueKrw,
      beforeWeightPct: weightPct(
        source.currentValueKrw,
        beforeSnapshot.totalValueKrw,
      ),
      afterWeightPct: weightPct(
        sourceAfter.currentValueKrw,
        afterSnapshot.totalValueKrw,
      ),
    }),
    destination: Object.freeze({
      key: destination.key,
      name: destination.name,
      ticker: destination.ticker,
      beforeValueKrw: destination.currentValueKrw,
      afterValueKrw: destinationAfter.currentValueKrw,
      beforeWeightPct: weightPct(
        destination.currentValueKrw,
        beforeSnapshot.totalValueKrw,
      ),
      afterWeightPct: weightPct(
        destinationAfter.currentValueKrw,
        afterSnapshot.totalValueKrw,
      ),
    }),
    beforeConcentration: beforeSnapshot.concentration,
    afterConcentration: afterSnapshot.concentration,
    currencyExposures: createCurrencyExposures(
      beforeSnapshot,
      afterSnapshot,
    ),
    blockers: [] as const,
  });
}

function buildAccountModel(
  account: InvestmentLabSmallAdjustmentAccount,
  holdings: readonly PortfolioStructureHoldingRow[],
  exclusions: readonly PortfolioStructureExclusion[],
): InvestmentLabSmallAdjustmentAccountModel {
  const blockers: InvestmentLabSmallAdjustmentAccountBlocker[] = [];
  const analysis = analyzePortfolioDirectHoldings(holdings);
  const grouped: InvestmentLabSmallAdjustmentHolding[] = analysis.holdings.map(
    (row) => ({
      ...row,
      account,
    }),
  );
  const totalValueKrw = analysis.metrics?.totalValueKrw ?? 0;

  if (
    analysis.invalidValueCount > 0 ||
    (analysis.resolvedInputHoldingCount > 0 && !analysis.metrics)
  ) {
    blockers.push("invalid_portfolio_values");
  }
  if (exclusions.length > 0) {
    blockers.push("incomplete_valuation_coverage");
  }
  if (analysis.unresolvedIdentityCount > 0) {
    blockers.push("unresolved_holding_identity");
  }
  if (grouped.length < 2) {
    blockers.push("insufficient_holdings");
  }

  const weightedHoldings = grouped.map((row) => Object.freeze(row));

  return Object.freeze({
    account,
    status: blockers.length === 0 ? "ready" : "unavailable",
    totalValueKrw,
    holdings: Object.freeze(weightedHoldings),
    excludedHoldingCount: exclusions.length,
    unresolvedInstrumentCount: analysis.unresolvedIdentityCount,
    exclusionReasonCounts: Object.freeze({
      missingPrice: exclusions.filter((row) => row.reason === "missing_price")
        .length,
      missingFx: exclusions.filter((row) => row.reason === "missing_fx").length,
      unsupportedCurrency: exclusions.filter(
        (row) => row.reason === "unsupported_currency",
      ).length,
    }),
    blockers: Object.freeze(blockers),
  });
}

type AdjustmentSnapshot = Readonly<{
  totalValueKrw: number;
  concentration: InvestmentLabSmallAdjustmentConcentration;
  currencyValues: ReadonlyMap<string, number>;
}>;

function createSnapshot(
  holdings: readonly Pick<
    InvestmentLabSmallAdjustmentHolding,
    "currency" | "currentValueKrw"
  >[],
): AdjustmentSnapshot | null {
  if (holdings.length < 2) return null;
  const metrics = calculatePortfolioDirectHoldingMetrics(holdings);
  if (!metrics) return null;

  return Object.freeze({
    totalValueKrw: metrics.totalValueKrw,
    concentration: Object.freeze({
      largestHoldingWeightPct: metrics.largestHoldingWeightPct,
      hhiPoints: metrics.hhiPoints,
    }),
    currencyValues: new Map(
      metrics.currencyExposures.map((row) => [
        row.currency,
        row.currentValueKrw,
      ]),
    ),
  });
}

function createCurrencyExposures(
  before: AdjustmentSnapshot,
  after: AdjustmentSnapshot,
) {
  const currencies = new Set([
    ...before.currencyValues.keys(),
    ...after.currencyValues.keys(),
  ]);
  return Object.freeze(
    [...currencies].sort().map((currency) => {
      const beforeValueKrw = before.currencyValues.get(currency) ?? 0;
      const afterValueKrw = after.currencyValues.get(currency) ?? 0;
      const beforeWeightPct = weightPct(beforeValueKrw, before.totalValueKrw);
      const afterWeightPct = weightPct(afterValueKrw, after.totalValueKrw);
      return Object.freeze({
        currency,
        beforeValueKrw,
        afterValueKrw,
        beforeWeightPct,
        afterWeightPct,
        changePercentagePoints: afterWeightPct - beforeWeightPct,
      });
    }),
  );
}

function blocked(
  account: InvestmentLabSmallAdjustmentAccount,
  reason: InvestmentLabSmallAdjustmentCalculationBlocker,
): InvestmentLabSmallAdjustmentCalculation {
  return Object.freeze({
    status: "blocked",
    policy: INVESTMENT_LAB_SMALL_ADJUSTMENT_POLICY,
    account,
    blockers: Object.freeze([reason]),
  });
}

function weightPct(value: number, total: number) {
  return total > 0 && Number.isFinite(value) ? (value / total) * 100 : 0;
}

function approximatelyEqual(left: number, right: number) {
  const tolerance = Math.max(0.000001, Math.abs(left) * 1e-12);
  return Math.abs(left - right) <= tolerance;
}
