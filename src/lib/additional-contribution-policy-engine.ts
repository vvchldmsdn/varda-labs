export const ADDITIONAL_CONTRIBUTION_REBALANCE_POLICY = Object.freeze({
  version: "gyeol_fin_explainable_rebalance_v1",
  targetWeightTotalBps: 10_000,
  trimLandingTargetMultiplier: 1.05,
  ma120BufferPct: 3,
  ma120ClassMultipliers: Object.freeze({
    broad_index: 0.8,
    dividend_quality: 0.8,
    large_growth: 0.7,
    thematic: 0.5,
    defensive_gold: 1,
    bond: 1,
    other: 0.8,
  }),
  unsupportedDynamicModifiers: Object.freeze([
    "fx_entry_timing",
    "risk_contribution",
    "market_regime",
    "news_event",
    "performance_watch",
  ]),
  orders: "calculation_only",
} as const);

export type AdditionalContributionMa120Status =
  | "above_ma"
  | "at_ma"
  | "below_ma"
  | "insufficient_history"
  | "invalid_history"
  | "unavailable";

export type AdditionalContributionPolicyBlocker =
  | "invalid_cash_amount"
  | "empty_valuation_universe"
  | "invalid_current_value"
  | "invalid_cost_basis"
  | "invalid_target_weight"
  | "duplicate_allocation_key"
  | "target_policy_incomplete"
  | "unallocatable_target_deficit"
  | "invalid_policy_parameter"
  | "allocation_invariant_failed";

export type AdditionalContributionPolicyRow<T> = Readonly<{
  allocationKey: string;
  assetType: string | null;
  buyable: boolean;
  costBasisKrw: number | null;
  currentValueKrw: number;
  ma120Evidence: Readonly<{
    distanceFromMaPct: number | null;
    status: AdditionalContributionMa120Status;
  }>;
  maAssetClass: string | null;
  maRuleEnabled: boolean;
  metadata: T;
  targetWeightBps: number;
}>;

type MaAdjustmentReason =
  | "above_or_at_ma120"
  | "below_ma120_buffer"
  | "below_ma120_full_adjustment"
  | "asset_class_exempt"
  | "asset_rule_disabled"
  | "evidence_unavailable";

type TrimReason =
  | "eligible_overweight"
  | "eligible_zero_target_exit"
  | "not_overweight"
  | "loss_position"
  | "cost_basis_unavailable"
  | "target_zero_but_loss"
  | "target_zero_cost_basis_unavailable";

type WorkingRow<T> = AdditionalContributionPolicyRow<T> & {
  action: "buy" | "hold" | "trim";
  allocationKrw: number;
  baseNeedKrw: number;
  currentWeightPct: number;
  driftRatioPct: number | null;
  effectiveTargetValueKrw: number;
  effectiveTargetWeightBps: number;
  maAdjustmentReason: MaAdjustmentReason;
  maBaseMultiplier: number;
  maEffectiveMultiplier: number;
  postTradeValueKrw: number;
  postTradeWeightPct: number;
  postTrimValueKrw: number;
  strategicAllocationKrw: number;
  strategicNeedKrw: number;
  strategicTargetValueKrw: number;
  trimAmountKrw: number;
  trimReason: TrimReason;
  trimTriggered: boolean;
  unrealizedReturnPct: number | null;
};

export function calculateExplainableAdditionalContribution<T>({
  cashAmountKrw,
  minimumExecutionRatioPct,
  rows: sourceRows,
  trimDriftThresholdPct,
}: {
  cashAmountKrw: number;
  minimumExecutionRatioPct: number;
  rows: readonly AdditionalContributionPolicyRow<T>[];
  trimDriftThresholdPct: number;
}) {
  const blockers = validateInputs({
    cashAmountKrw,
    minimumExecutionRatioPct,
    rows: sourceRows,
    trimDriftThresholdPct,
  });
  if (blockers.size > 0) return blocked(blockers);

  const currentPortfolioTotalKrw = sum(sourceRows, (row) => row.currentValueKrw);
  if (currentPortfolioTotalKrw <= 0 || !Number.isFinite(currentPortfolioTotalKrw)) {
    return blocked(new Set(["empty_valuation_universe"]));
  }
  const postContributionTotalKrw = currentPortfolioTotalKrw + cashAmountKrw;
  const rows: WorkingRow<T>[] = sourceRows.map((row) => {
    const currentWeightPct = (row.currentValueKrw / currentPortfolioTotalKrw) * 100;
    const targetWeightPct = row.targetWeightBps / 100;
    const driftRatioPct = targetWeightPct > 0
      ? ((currentWeightPct - targetWeightPct) / targetWeightPct) * 100
      : null;
    const unrealizedReturnPct = row.costBasisKrw !== null && row.costBasisKrw > 0
      ? ((row.currentValueKrw - row.costBasisKrw) / row.costBasisKrw) * 100
      : null;
    const trim = resolveTrim({
      currentValueKrw: row.currentValueKrw,
      driftRatioPct,
      postContributionTotalKrw,
      targetWeightBps: row.targetWeightBps,
      trimDriftThresholdPct,
      unrealizedReturnPct,
    });
    const ma = resolveMaAdjustment(row);
    const strategicTargetValueKrw =
      (row.targetWeightBps / ADDITIONAL_CONTRIBUTION_REBALANCE_POLICY.targetWeightTotalBps) *
      postContributionTotalKrw;
    const postTrimValueKrw = Math.max(0, row.currentValueKrw - trim.amountKrw);

    return {
      ...row,
      action: "hold",
      allocationKrw: 0,
      baseNeedKrw: 0,
      currentWeightPct,
      driftRatioPct,
      effectiveTargetValueKrw: 0,
      effectiveTargetWeightBps: row.targetWeightBps * ma.multiplier,
      maAdjustmentReason: ma.reason,
      maBaseMultiplier: ma.baseMultiplier,
      maEffectiveMultiplier: ma.multiplier,
      postTradeValueKrw: 0,
      postTradeWeightPct: 0,
      postTrimValueKrw,
      strategicAllocationKrw: 0,
      strategicNeedKrw: Math.max(0, strategicTargetValueKrw - postTrimValueKrw),
      strategicTargetValueKrw,
      trimAmountKrw: trim.amountKrw,
      trimReason: trim.reason,
      trimTriggered: trim.triggered,
      unrealizedReturnPct,
    };
  });

  const totalTrimProceedsKrw = sum(rows, (row) => row.trimAmountKrw);
  const totalAvailableFundsKrw = cashAmountKrw + totalTrimProceedsKrw;
  for (const row of rows) {
    row.effectiveTargetValueKrw =
      (row.effectiveTargetWeightBps /
        ADDITIONAL_CONTRIBUTION_REBALANCE_POLICY.targetWeightTotalBps) *
      postContributionTotalKrw;
    row.baseNeedKrw = Math.max(0, row.effectiveTargetValueKrw - row.postTrimValueKrw);
    if (!row.trimTriggered && row.baseNeedKrw > EPSILON_KRW && !row.buyable) {
      blockers.add("unallocatable_target_deficit");
    }
  }
  if (blockers.size > 0) return blocked(blockers);

  const strategic = allocateWithCaps(
    totalAvailableFundsKrw,
    rows.filter(isBuyCandidate).map((row) => ({
      capKrw: Math.max(0, Math.round(row.strategicNeedKrw)),
      key: row.allocationKey,
    })),
  );
  const final = allocateWithCaps(
    totalAvailableFundsKrw,
    rows.filter(isBuyCandidate).map((row) => ({
      capKrw: Math.max(0, Math.round(row.baseNeedKrw)),
      key: row.allocationKey,
    })),
  );
  const strategicByKey = new Map(strategic.map((row) => [row.key, row.amountKrw]));
  const finalByKey = new Map(final.map((row) => [row.key, row.amountKrw]));

  for (const row of rows) {
    row.strategicAllocationKrw = strategicByKey.get(row.allocationKey) ?? 0;
    row.allocationKrw = finalByKey.get(row.allocationKey) ?? 0;
    row.action = row.trimAmountKrw > 0 ? "trim" : row.allocationKrw > 0 ? "buy" : "hold";
    row.postTradeValueKrw = row.postTrimValueKrw + row.allocationKrw;
    row.postTradeWeightPct = (row.postTradeValueKrw / postContributionTotalKrw) * 100;
  }

  const totalAllocatedKrw = sum(rows, (row) => row.allocationKrw);
  const residualCashKrw = totalAvailableFundsKrw - totalAllocatedKrw;
  const totalBaseNeedKrw = sum(rows.filter(isBuyCandidate), (row) => row.baseNeedKrw);
  const minimumExecutionTargetKrw = Math.min(
    totalAvailableFundsKrw,
    Math.round(totalBaseNeedKrw),
    Math.round(totalAvailableFundsKrw * (minimumExecutionRatioPct / 100)),
  );
  if (!invariantsHold({
    currentPortfolioTotalKrw,
    postContributionTotalKrw,
    residualCashKrw,
    rows,
    totalAllocatedKrw,
    totalAvailableFundsKrw,
    totalTrimProceedsKrw,
  })) {
    return blocked(new Set(["allocation_invariant_failed"]));
  }

  return Object.freeze({
    status: "ready" as const,
    policy: ADDITIONAL_CONTRIBUTION_REBALANCE_POLICY,
    parameters: Object.freeze({ minimumExecutionRatioPct, trimDriftThresholdPct }),
    cashAmountKrw,
    currentPortfolioTotalKrw,
    postContributionTotalKrw,
    totalTrimProceedsKrw,
    totalAvailableFundsKrw,
    totalBaseNeedKrw,
    minimumExecutionTargetKrw,
    minimumExecutionSatisfied: totalAllocatedKrw + EPSILON_KRW >= minimumExecutionTargetKrw,
    totalAllocatedKrw,
    residualCashKrw,
    rows: Object.freeze(rows.toSorted((a, b) => a.allocationKey.localeCompare(b.allocationKey)).map((row) => Object.freeze({
      action: row.action,
      allocationKey: row.allocationKey,
      allocationKrw: row.allocationKrw,
      baseNeedKrw: row.baseNeedKrw,
      costBasisKrw: row.costBasisKrw,
      currentValueKrw: row.currentValueKrw,
      currentWeightPct: row.currentWeightPct,
      driftRatioPct: row.driftRatioPct,
      effectiveTargetValueKrw: row.effectiveTargetValueKrw,
      effectiveTargetWeightBps: row.effectiveTargetWeightBps,
      maAdjustmentReason: row.maAdjustmentReason,
      maBaseMultiplier: row.maBaseMultiplier,
      maEffectiveMultiplier: row.maEffectiveMultiplier,
      metadata: row.metadata,
      postTradeValueKrw: row.postTradeValueKrw,
      postTradeWeightPct: row.postTradeWeightPct,
      postTrimValueKrw: row.postTrimValueKrw,
      strategicAllocationKrw: row.strategicAllocationKrw,
      strategicNeedKrw: row.strategicNeedKrw,
      strategicTargetValueKrw: row.strategicTargetValueKrw,
      targetWeightBps: row.targetWeightBps,
      trimAmountKrw: row.trimAmountKrw,
      trimReason: row.trimReason,
      trimTriggered: row.trimTriggered,
      unrealizedReturnPct: row.unrealizedReturnPct,
    }))),
    blockers: Object.freeze([] as AdditionalContributionPolicyBlocker[]),
  });
}

function validateInputs<T>({ cashAmountKrw, minimumExecutionRatioPct, rows, trimDriftThresholdPct }: {
  cashAmountKrw: number;
  minimumExecutionRatioPct: number;
  rows: readonly AdditionalContributionPolicyRow<T>[];
  trimDriftThresholdPct: number;
}) {
  const blockers = new Set<AdditionalContributionPolicyBlocker>();
  if (!Number.isSafeInteger(cashAmountKrw) || cashAmountKrw <= 0) blockers.add("invalid_cash_amount");
  if (rows.length === 0) blockers.add("empty_valuation_universe");
  if (!validPercent(minimumExecutionRatioPct) || !validPercent(trimDriftThresholdPct)) blockers.add("invalid_policy_parameter");
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.allocationKey || keys.has(row.allocationKey)) blockers.add("duplicate_allocation_key");
    keys.add(row.allocationKey);
    if (!Number.isFinite(row.currentValueKrw) || row.currentValueKrw < 0) blockers.add("invalid_current_value");
    if (row.costBasisKrw !== null && (!Number.isFinite(row.costBasisKrw) || row.costBasisKrw < 0)) blockers.add("invalid_cost_basis");
    if (!Number.isSafeInteger(row.targetWeightBps) || row.targetWeightBps < 0 || row.targetWeightBps > 10_000) blockers.add("invalid_target_weight");
  }
  if (rows.length > 0 && sum(rows, (row) => row.targetWeightBps) !== 10_000) blockers.add("target_policy_incomplete");
  return blockers;
}

function resolveTrim({ currentValueKrw, driftRatioPct, postContributionTotalKrw, targetWeightBps, trimDriftThresholdPct, unrealizedReturnPct }: {
  currentValueKrw: number;
  driftRatioPct: number | null;
  postContributionTotalKrw: number;
  targetWeightBps: number;
  trimDriftThresholdPct: number;
  unrealizedReturnPct: number | null;
}) {
  if (targetWeightBps === 0 && currentValueKrw > 0) {
    if (unrealizedReturnPct === null) return trimResult(0, "target_zero_cost_basis_unavailable");
    if (unrealizedReturnPct < 0) return trimResult(0, "target_zero_but_loss");
    return trimResult(Math.max(0, Math.round(currentValueKrw)), "eligible_zero_target_exit");
  }
  if (driftRatioPct === null || driftRatioPct < trimDriftThresholdPct) return trimResult(0, "not_overweight");
  if (unrealizedReturnPct === null) return trimResult(0, "cost_basis_unavailable");
  if (unrealizedReturnPct < 0) return trimResult(0, "loss_position");
  const landingValueKrw =
    (targetWeightBps / 10_000) *
    ADDITIONAL_CONTRIBUTION_REBALANCE_POLICY.trimLandingTargetMultiplier *
    postContributionTotalKrw;
  return trimResult(Math.max(0, Math.round(currentValueKrw - landingValueKrw)), "eligible_overweight");
}

function trimResult(amountKrw: number, reason: TrimReason) {
  return { amountKrw, reason, triggered: amountKrw > 0 };
}

function resolveMaAdjustment<T>(row: AdditionalContributionPolicyRow<T>) {
  const assetType = normalize(row.assetType);
  const assetClass = normalize(row.maAssetClass) ?? "other";
  const baseMultiplier = maClassMultiplier(assetClass);
  if (!row.maRuleEnabled) return { baseMultiplier, multiplier: 1, reason: "asset_rule_disabled" as const };
  if (["savings", "pension", "housing_subscription", "fixed_deposit"].includes(assetType ?? "") || assetClass === "defensive_gold" || assetClass === "bond") {
    return { baseMultiplier: 1, multiplier: 1, reason: "asset_class_exempt" as const };
  }
  if (row.ma120Evidence.status !== "below_ma" || row.ma120Evidence.distanceFromMaPct === null || !Number.isFinite(row.ma120Evidence.distanceFromMaPct)) {
    const known = row.ma120Evidence.status === "above_ma" || row.ma120Evidence.status === "at_ma";
    return { baseMultiplier, multiplier: 1, reason: known ? "above_or_at_ma120" as const : "evidence_unavailable" as const };
  }
  const gapPct = Math.max(0, -row.ma120Evidence.distanceFromMaPct);
  if (gapPct >= ADDITIONAL_CONTRIBUTION_REBALANCE_POLICY.ma120BufferPct) {
    return { baseMultiplier, multiplier: baseMultiplier, reason: "below_ma120_full_adjustment" as const };
  }
  const progress = gapPct / ADDITIONAL_CONTRIBUTION_REBALANCE_POLICY.ma120BufferPct;
  return { baseMultiplier, multiplier: 1 - progress * (1 - baseMultiplier), reason: "below_ma120_buffer" as const };
}

function maClassMultiplier(assetClass: string) {
  const values = ADDITIONAL_CONTRIBUTION_REBALANCE_POLICY.ma120ClassMultipliers;
  return assetClass in values ? values[assetClass as keyof typeof values] : values.other;
}

function allocateWithCaps(availableKrw: number, rows: readonly { capKrw: number; key: string }[]) {
  const totalCapKrw = sum(rows, (row) => row.capKrw);
  const deployKrw = Math.min(availableKrw, totalCapKrw);
  if (deployKrw <= 0 || totalCapKrw <= 0) return rows.map((row) => ({ ...row, amountKrw: 0 }));
  const working = rows.map((row) => {
    const idealKrw = deployKrw * (row.capKrw / totalCapKrw);
    return { ...row, amountKrw: Math.min(row.capKrw, Math.floor(idealKrw)), idealKrw };
  });
  let remainder = deployKrw - sum(working, (row) => row.amountKrw);
  for (const row of working.toSorted((a, b) => fractionalPart(b.idealKrw) - fractionalPart(a.idealKrw) || a.key.localeCompare(b.key))) {
    if (remainder <= 0) break;
    if (row.amountKrw < row.capKrw) { row.amountKrw += 1; remainder -= 1; }
  }
  return working;
}

function isBuyCandidate<T>(row: WorkingRow<T>) {
  return !row.trimTriggered && row.buyable;
}

function invariantsHold<T>({ currentPortfolioTotalKrw, postContributionTotalKrw, residualCashKrw, rows, totalAllocatedKrw, totalAvailableFundsKrw, totalTrimProceedsKrw }: {
  currentPortfolioTotalKrw: number;
  postContributionTotalKrw: number;
  residualCashKrw: number;
  rows: readonly WorkingRow<T>[];
  totalAllocatedKrw: number;
  totalAvailableFundsKrw: number;
  totalTrimProceedsKrw: number;
}) {
  if (![totalAllocatedKrw, totalTrimProceedsKrw, residualCashKrw].every(Number.isSafeInteger)) return false;
  if (residualCashKrw < 0 || totalAllocatedKrw + residualCashKrw !== totalAvailableFundsKrw) return false;
  if (rows.some((row) => !Number.isSafeInteger(row.allocationKrw) || !Number.isSafeInteger(row.trimAmountKrw) || row.allocationKrw < 0 || row.trimAmountKrw < 0 || row.allocationKrw > Math.round(row.baseNeedKrw) || (row.trimAmountKrw > 0 && row.allocationKrw > 0))) return false;
  const holdingsAfterTradeKrw = sum(rows, (row) => row.postTradeValueKrw);
  const holdingsAfterTrimKrw = sum(rows, (row) => row.postTrimValueKrw);
  return Math.abs(holdingsAfterTrimKrw - (currentPortfolioTotalKrw - totalTrimProceedsKrw)) <= EPSILON_KRW &&
    Math.abs(holdingsAfterTradeKrw + residualCashKrw - postContributionTotalKrw) <= EPSILON_KRW;
}

function blocked(blockers: Set<AdditionalContributionPolicyBlocker>) {
  return Object.freeze({
    status: "blocked" as const,
    policy: ADDITIONAL_CONTRIBUTION_REBALANCE_POLICY,
    parameters: null,
    cashAmountKrw: null,
    currentPortfolioTotalKrw: null,
    postContributionTotalKrw: null,
    totalTrimProceedsKrw: null,
    totalAvailableFundsKrw: null,
    totalBaseNeedKrw: null,
    minimumExecutionTargetKrw: null,
    minimumExecutionSatisfied: null,
    totalAllocatedKrw: null,
    residualCashKrw: null,
    rows: Object.freeze([]),
    blockers: Object.freeze([...blockers].toSorted()),
  });
}

function validPercent(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function normalize(value: string | null) {
  return value?.trim().toLowerCase() || null;
}

function fractionalPart(value: number) {
  return value - Math.floor(value);
}

function sum<T>(rows: readonly T[], select: (row: T) => number) {
  return rows.reduce((total, row) => total + select(row), 0);
}

const EPSILON_KRW = 1e-6;
