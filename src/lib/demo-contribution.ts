import { calculateExplainableAdditionalContribution } from "./additional-contribution-policy-engine.ts";
import type { AdditionalContributionResultPreview } from "./additional-contribution-view.ts";
import type { PortfolioStructureHoldingRow } from "./portfolio-structure.ts";

export function buildDemoContribution(holdings: readonly PortfolioStructureHoldingRow[], amount: number, equalTargets = false): AdditionalContributionResultPreview | null {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000 || holdings.length === 0) return null;
  const weights = holdings.map(row => equalTargets ? 1 : row.effectiveTargetPct ?? 0);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const targets = weights.map(weight => Math.floor(weight / total * 10_000));
  let remaining = 10_000 - targets.reduce((sum, value) => sum + value, 0);
  const order = weights.map((weight, index) => ({ index, remainder: weight / total * 10_000 - targets[index] })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const row of order) { if (remaining-- <= 0) break; targets[row.index]++; }
  const calculation = calculateExplainableAdditionalContribution({ cashAmountKrw: amount, minimumExecutionRatioPct: 85, trimDriftThresholdPct: 12,
    rows: holdings.map((row, index) => ({ allocationKey: `${row.account}:${row.ticker}`, assetType: row.assetType, buyable: true,
      costBasisKrw: null, currentValueKrw: row.currentValueKrw, targetWeightBps: targets[index], maAssetClass: null, maRuleEnabled: true,
      ma120Evidence: { status: "unavailable", distanceFromMaPct: null }, metadata: row })) });
  if (calculation.status !== "ready") return null;
  return { status: "ready", cashAmountKrw: amount, currentPortfolioTotalKrw: calculation.currentPortfolioTotalKrw,
    postTopupTotalKrw: calculation.postContributionTotalKrw, totalAllocatedKrw: calculation.totalAllocatedKrw,
    residualCashKrw: calculation.residualCashKrw, totalTrimProceedsKrw: calculation.totalTrimProceedsKrw,
    totalAvailableFundsKrw: calculation.totalAvailableFundsKrw, totalBaseNeedKrw: calculation.totalBaseNeedKrw,
    minimumExecutionTargetKrw: calculation.minimumExecutionTargetKrw, minimumExecutionSatisfied: calculation.minimumExecutionSatisfied,
    calculationParameters: calculation.parameters, calculationPolicy: calculation.policy, effectiveServiceDate: "2026-08-21",
    policyLabel: equalTargets ? "체험용 동일 비중" : "체험용 목표 비중", serviceDate: "2026-08-21",
    ma120Evidence: { mode: "enabled", status: "unavailable", usableCount: 0, totalReductionKrw: 0 },
    rows: calculation.rows.map(row => ({ allocationKey: row.allocationKey, accountCode: row.metadata.account, accountName: row.metadata.account,
      action: row.action, allocationKrw: row.allocationKrw, baseNeedKrw: row.baseNeedKrw, costBasisKrw: null,
      currentValueKrw: row.currentValueKrw, currentWeightPct: row.currentWeightPct, currency: row.metadata.currency,
      driftRatioPct: row.driftRatioPct, effectiveTargetWeightPct: row.effectiveTargetWeightBps / 100, ma120ReductionKrw: 0,
      maAdjustmentReason: row.maAdjustmentReason, maEffectiveMultiplier: row.maEffectiveMultiplier,
      market: row.metadata.market, name: row.metadata.name, postTopupValueKrw: row.postTradeValueKrw,
      postTopupWeightPct: row.postTradeWeightPct, postTrimValueKrw: row.postTrimValueKrw, strategicAllocationKrw: row.strategicAllocationKrw,
      targetWeightPct: row.targetWeightBps / 100, ticker: row.metadata.ticker, trimAmountKrw: row.trimAmountKrw,
      trimReason: row.trimReason, unrealizedReturnPct: row.unrealizedReturnPct,
      ma120Evidence: { status: "unavailable", priceBasis: null, availableObservationCount: 0, latestWindowPriceDate: null, ma120: null, distanceFromMaPct: null } })) };
}
