export const ADDITIONAL_CONTRIBUTION_CASH_RESERVE_POLICY = Object.freeze({
  version: "additional_contribution_user_cash_reserve_v1",
  authority: "explicit_user_assumption_comparison_only",
  defaultMode: "off",
  fundingAttribution: "pooled_funds_proportional_integer_krw_largest_remainder",
  attributionMeaning: "calculation_convention_not_observed_cash_provenance",
  reserveBasis: "minimum_share_of_new_cash_including_existing_new_cash_residual",
  reserveRounding: "floor_integer_krw",
  trimFundedAllocation: "unchanged",
  redistribution: "forbidden",
  targetRewrite: "forbidden",
  orderAuthority: "forbidden",
  forecast: "none",
} as const);

export type AdditionalContributionCashReserveBaseline = Readonly<{
  cashAmountKrw: number;
  totalTrimProceedsKrw: number;
  totalAllocatedKrw: number;
  residualCashKrw: number;
  rows: readonly Readonly<{
    allocationKey: string;
    allocationKrw: number;
    trimAmountKrw: number;
  }>[];
}>;

type CashReserveBlocker =
  | "invalid_mode"
  | "invalid_reserve_ratio"
  | "invalid_baseline_totals"
  | "invalid_baseline_row"
  | "duplicate_allocation_key"
  | "cash_reserve_invariant_failed";

/** Compare a user-selected cash assumption without rerunning targets or trims. */
export function compareAdditionalContributionCashReserve<T extends AdditionalContributionCashReserveBaseline>({
  baseline,
  mode,
  reserveRatioPct,
}: {
  baseline: T;
  mode: "off" | "enabled";
  reserveRatioPct: number;
}) {
  const blockers = validateBaseline(baseline);
  if (mode !== "off" && mode !== "enabled") blockers.add("invalid_mode");
  if (!Number.isInteger(reserveRatioPct) || reserveRatioPct < 0 || reserveRatioPct > 100) blockers.add("invalid_reserve_ratio");
  if (blockers.size > 0) return blocked(baseline, blockers);

  // Every baseline destination, including unspent cash, receives a share of
  // each funding source. This is an explicit calculation convention; actual
  // banknotes are fungible and this does not claim to track real transactions.
  const sources = apportion(baseline.cashAmountKrw, [
    ...baseline.rows.map((row) => ({ key: `buy:${row.allocationKey}`, weightKrw: row.allocationKrw })),
    { key: "residual", weightKrw: baseline.residualCashKrw },
  ]);
  const baselineNewCashResidualKrw = sources.get("residual") ?? 0;
  const baselineTrimCashResidualKrw = baseline.residualCashKrw - baselineNewCashResidualKrw;
  const requestedNewCashReserveKrw = mode === "enabled"
    ? Number(BigInt(baseline.cashAmountKrw) * BigInt(reserveRatioPct) / BigInt(100))
    : 0;
  const totalAdditionalReserveKrw = Math.max(0, requestedNewCashReserveKrw - baselineNewCashResidualKrw);
  const reductions = apportion(totalAdditionalReserveKrw, baseline.rows.map((row) => ({
    key: row.allocationKey,
    weightKrw: sources.get(`buy:${row.allocationKey}`) ?? 0,
  })));
  const rows = baseline.rows.map((row) => {
    const newCashFundedBuyKrw = sources.get(`buy:${row.allocationKey}`) ?? 0;
    const trimFundedBuyKrw = row.allocationKrw - newCashFundedBuyKrw;
    const reserveKrw = reductions.get(row.allocationKey) ?? 0;
    return Object.freeze({
      allocationKey: row.allocationKey,
      baselineAllocationKrw: row.allocationKrw,
      scenarioAllocationKrw: row.allocationKrw - reserveKrw,
      newCashFundedBuyKrw,
      trimFundedBuyKrw,
      scenarioNewCashFundedBuyKrw: newCashFundedBuyKrw - reserveKrw,
      reserveKrw,
      trimAmountKrw: row.trimAmountKrw,
    });
  }).sort((left, right) => compareKey(left.allocationKey, right.allocationKey));
  const scenarioAllocatedKrw = sum(rows, (row) => row.scenarioAllocationKrw);
  const scenarioResidualCashKrw = baseline.residualCashKrw + totalAdditionalReserveKrw;
  const scenarioNewCashResidualKrw = baselineNewCashResidualKrw + totalAdditionalReserveKrw;
  const totalAvailableFundsKrw = baseline.cashAmountKrw + baseline.totalTrimProceedsKrw;

  if (scenarioAllocatedKrw + scenarioResidualCashKrw !== totalAvailableFundsKrw ||
    sum(rows, (row) => row.reserveKrw) !== totalAdditionalReserveKrw ||
    sum(rows, (row) => row.scenarioNewCashFundedBuyKrw) + scenarioNewCashResidualKrw !== baseline.cashAmountKrw ||
    sum(rows, (row) => row.trimFundedBuyKrw) + baselineTrimCashResidualKrw !== baseline.totalTrimProceedsKrw ||
    rows.some((row) => row.reserveKrw < 0 || row.reserveKrw > row.newCashFundedBuyKrw ||
      row.scenarioAllocationKrw < 0 || row.scenarioAllocationKrw > row.baselineAllocationKrw)) {
    return blocked(baseline, new Set<CashReserveBlocker>(["cash_reserve_invariant_failed"]));
  }

  return Object.freeze({
    status: "ready" as const,
    policy: ADDITIONAL_CONTRIBUTION_CASH_RESERVE_POLICY,
    mode,
    reserveRatioPct: mode === "enabled" ? reserveRatioPct : 0,
    baseline,
    totalAvailableFundsKrw,
    requestedNewCashReserveKrw,
    baselineNewCashResidualKrw,
    baselineTrimCashResidualKrw,
    scenarioNewCashResidualKrw,
    scenarioTrimCashResidualKrw: baselineTrimCashResidualKrw,
    totalAdditionalReserveKrw,
    scenarioAllocatedKrw,
    scenarioResidualCashKrw,
    rows: Object.freeze(rows),
    blockers: Object.freeze([] as CashReserveBlocker[]),
  });
}

function validateBaseline(baseline: AdditionalContributionCashReserveBaseline) {
  const blockers = new Set<CashReserveBlocker>();
  const totals = [baseline.cashAmountKrw, baseline.totalTrimProceedsKrw, baseline.totalAllocatedKrw, baseline.residualCashKrw];
  if (!totals.every(validKrw)) blockers.add("invalid_baseline_totals");
  const totalAvailableFundsKrw = baseline.cashAmountKrw + baseline.totalTrimProceedsKrw;
  if (!validKrw(totalAvailableFundsKrw) ||
    baseline.totalAllocatedKrw + baseline.residualCashKrw !== totalAvailableFundsKrw ||
    sum(baseline.rows, (row) => row.allocationKrw) !== baseline.totalAllocatedKrw ||
    sum(baseline.rows, (row) => row.trimAmountKrw) !== baseline.totalTrimProceedsKrw) {
    blockers.add("invalid_baseline_totals");
  }
  const keys = new Set<string>();
  for (const row of baseline.rows) {
    if (!row.allocationKey || !validKrw(row.allocationKrw) || !validKrw(row.trimAmountKrw) ||
      (row.allocationKrw > 0 && row.trimAmountKrw > 0)) blockers.add("invalid_baseline_row");
    if (keys.has(row.allocationKey)) blockers.add("duplicate_allocation_key");
    keys.add(row.allocationKey);
  }
  return blockers;
}

/** Exact integer largest remainder; BigInt products avoid unsafe KRW products. */
function apportion(budgetKrw: number, rows: readonly { key: string; weightKrw: number }[]) {
  const totalWeight = rows.reduce((total, row) => total + BigInt(row.weightKrw), BigInt(0));
  if (budgetKrw === 0 || totalWeight === BigInt(0)) return new Map(rows.map((row) => [row.key, 0]));
  const budget = BigInt(budgetKrw);
  const working = rows.map((row) => {
    const numerator = budget * BigInt(row.weightKrw);
    return { key: row.key, capKrw: row.weightKrw, amountKrw: Number(numerator / totalWeight), remainder: numerator % totalWeight };
  });
  let remainderKrw = budgetKrw - sum(working, (row) => row.amountKrw);
  working.sort((left, right) => left.remainder === right.remainder
    ? compareKey(left.key, right.key)
    : left.remainder > right.remainder ? -1 : 1);
  for (const row of working) {
    if (remainderKrw === 0) break;
    if (row.amountKrw < row.capKrw) { row.amountKrw += 1; remainderKrw -= 1; }
  }
  return new Map(working.map((row) => [row.key, row.amountKrw]));
}

function blocked<T extends AdditionalContributionCashReserveBaseline>(baseline: T, blockers: ReadonlySet<CashReserveBlocker>) {
  return Object.freeze({ status: "blocked" as const, policy: ADDITIONAL_CONTRIBUTION_CASH_RESERVE_POLICY,
    baseline, rows: Object.freeze([]), blockers: Object.freeze([...blockers].sort()) });
}

function compareKey(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }
function validKrw(value: number) { return Number.isSafeInteger(value) && value >= 0; }
function sum<T>(rows: readonly T[], select: (row: T) => number) { return rows.reduce((total, row) => total + select(row), 0); }
