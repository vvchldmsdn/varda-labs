import {
  additionalContributionBlocker,
  prepareAdditionalContributionInput,
  type AdditionalContributionNormalizedHolding,
} from "./additional-contribution-input.ts";

export const ADDITIONAL_CONTRIBUTION_POLICY = Object.freeze({
  version: "deficit_proportional_capped_v1",
  supportedAccounts: Object.freeze(["brokerage", "isa", "irp"] as const),
  targetWeightUnit: "basis_points",
  targetWeightTotalBps: 10_000,
  allocationUnit: "integer_krw",
  allocationMethod: "post_topup_deficit_proportional",
  rounding: "largest_remainder_then_instrument_key_with_cap_guard",
  sells: "forbidden",
  targetInference: "forbidden",
} as const);

export type AdditionalContributionAccount =
  (typeof ADDITIONAL_CONTRIBUTION_POLICY.supportedAccounts)[number];

export type AdditionalContributionBuyability =
  | "buyable"
  | "not_buyable"
  | "tickerless"
  | "unsupported_market"
  | "unsupported_currency";

export type AdditionalContributionHolding = Readonly<{
  market: string | null;
  currency: string | null;
  ticker: string | null;
  currentValueKrw: number;
  targetWeightBps: number;
  buyability: AdditionalContributionBuyability;
}>;

export type AdditionalContributionBlockerReason =
  | "invalid_account"
  | "invalid_target_policy_version"
  | "invalid_cash_amount"
  | "empty_valuation_universe"
  | "invalid_current_value"
  | "invalid_target_weight"
  | "invalid_buyability"
  | "invalid_instrument_identity"
  | "duplicate_instrument"
  | "target_policy_incomplete"
  | "unallocatable_target_deficit"
  | "allocation_invariant_failed";

type WorkingAllocation = AdditionalContributionNormalizedHolding & {
  targetValueAfterTopupKrw: number;
  cappedDeficitKrw: number;
  idealAllocationKrw: number;
  allocationKrw: number;
};

export function allocateAdditionalContribution(input: {
  account: string;
  targetPolicyVersion: string;
  cashAmountKrw: number;
  holdings: readonly AdditionalContributionHolding[];
}) {
  const { account, targetPolicyVersion, holdings, blockers } =
    prepareAdditionalContributionInput(input, ADDITIONAL_CONTRIBUTION_POLICY);

  if (blockers.length > 0) {
    return blockedAllocation(account, targetPolicyVersion, blockers);
  }

  const currentPortfolioTotalKrw = holdings.reduce(
    (sum, holding) => sum + holding.currentValueKrw,
    0,
  );
  const postTopupTotalKrw = currentPortfolioTotalKrw + input.cashAmountKrw;
  if (!Number.isFinite(postTopupTotalKrw)) {
    return blockedAllocation(account, targetPolicyVersion, [
      additionalContributionBlocker("allocation_invariant_failed", null),
    ]);
  }

  const rows: WorkingAllocation[] = holdings.map((holding) => {
    const targetValueAfterTopupKrw =
      (holding.targetWeightBps /
        ADDITIONAL_CONTRIBUTION_POLICY.targetWeightTotalBps) *
      postTopupTotalKrw;
    const cappedDeficitKrw = cleanZero(
      Math.max(0, targetValueAfterTopupKrw - holding.currentValueKrw),
    );
    return {
      ...holding,
      targetValueAfterTopupKrw,
      cappedDeficitKrw,
      idealAllocationKrw: 0,
      allocationKrw: 0,
    };
  });

  for (const row of rows) {
    if (
      row.cappedDeficitKrw > EPSILON_KRW &&
      (row.buyability !== "buyable" || row.instrumentKey === null)
    ) {
      blockers.push(
        additionalContributionBlocker(
          "unallocatable_target_deficit",
          row.sourceIndex,
        ),
      );
    }
  }
  if (blockers.length > 0) {
    return blockedAllocation(account, targetPolicyVersion, blockers);
  }

  const allocatable = rows.filter(
    (
      row,
    ): row is WorkingAllocation & Readonly<{ instrumentKey: string }> =>
      row.buyability === "buyable" &&
      row.instrumentKey !== null &&
      row.cappedDeficitKrw > EPSILON_KRW,
  );
  const totalCappedDeficitKrw = allocatable.reduce(
    (sum, row) => sum + row.cappedDeficitKrw,
    0,
  );
  const scale =
    totalCappedDeficitKrw > 0
      ? Math.min(1, input.cashAmountKrw / totalCappedDeficitKrw)
      : 0;

  for (const row of allocatable) {
    row.idealAllocationKrw = row.cappedDeficitKrw * scale;
    row.allocationKrw = Math.floor(row.idealAllocationKrw);
  }

  let undistributedKrw =
    input.cashAmountKrw -
    allocatable.reduce((sum, row) => sum + row.allocationKrw, 0);
  const remainderOrder = [...allocatable].sort(
    (left, right) =>
      fractionalPart(right.idealAllocationKrw) -
        fractionalPart(left.idealAllocationKrw) ||
      left.instrumentKey.localeCompare(right.instrumentKey),
  );

  for (const row of remainderOrder) {
    if (undistributedKrw === 0) break;
    if (row.allocationKrw + 1 <= row.cappedDeficitKrw + EPSILON_KRW) {
      row.allocationKrw += 1;
      undistributedKrw -= 1;
    }
  }

  const totalAllocatedKrw = rows.reduce(
    (sum, row) => sum + row.allocationKrw,
    0,
  );
  const residualCashKrw = input.cashAmountKrw - totalAllocatedKrw;
  if (!allocationInvariantsHold(rows, input.cashAmountKrw, residualCashKrw)) {
    return blockedAllocation(account, targetPolicyVersion, [
      additionalContributionBlocker("allocation_invariant_failed", null),
    ]);
  }

  return Object.freeze({
    status: "ready",
    policy: ADDITIONAL_CONTRIBUTION_POLICY,
    account,
    targetPolicyVersion,
    cashAmountKrw: input.cashAmountKrw,
    currentPortfolioTotalKrw,
    postTopupTotalKrw,
    totalCappedDeficitKrw,
    totalAllocatedKrw,
    residualCashKrw,
    residualReason:
      residualCashKrw > 0 ? "integer_krw_cap_rounding" : null,
    allocations: Object.freeze(
      rows
        .sort(compareOutputRows)
        .map((row) =>
          Object.freeze({
            instrumentKey: row.instrumentKey,
            market: row.market,
            currency: row.currency,
            ticker: row.ticker,
            targetWeightBps: row.targetWeightBps,
            currentValueKrw: row.currentValueKrw,
            targetValueAfterTopupKrw: row.targetValueAfterTopupKrw,
            cappedDeficitKrw: row.cappedDeficitKrw,
            allocationKrw: row.allocationKrw,
            allocationStatus: allocationStatus(row),
          }),
        ),
    ),
    blockers: Object.freeze([]),
  } as const);
}

function allocationInvariantsHold(
  rows: readonly WorkingAllocation[],
  cashAmountKrw: number,
  residualCashKrw: number,
) {
  if (!Number.isSafeInteger(residualCashKrw) || residualCashKrw < 0) {
    return false;
  }
  let allocated = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.allocationKrw) || row.allocationKrw < 0) {
      return false;
    }
    if (row.allocationKrw > row.cappedDeficitKrw + EPSILON_KRW) {
      return false;
    }
    allocated += row.allocationKrw;
  }
  return allocated + residualCashKrw === cashAmountKrw;
}

function allocationStatus(row: WorkingAllocation) {
  if (row.allocationKrw > 0) return "allocated";
  if (row.targetWeightBps === 0) return "target_weight_zero";
  if (row.buyability !== "buyable") return "not_buyable_no_deficit";
  if (row.cappedDeficitKrw <= EPSILON_KRW) return "no_positive_deficit";
  return "rounded_to_zero";
}

function compareOutputRows(left: WorkingAllocation, right: WorkingAllocation) {
  if (left.instrumentKey === null) return right.instrumentKey === null ? 0 : 1;
  if (right.instrumentKey === null) return -1;
  return left.instrumentKey.localeCompare(right.instrumentKey);
}

function blockedAllocation(
  account: AdditionalContributionAccount | null,
  targetPolicyVersion: string | null,
  blockers: Array<{
    reason: AdditionalContributionBlockerReason;
    sourceIndex: number | null;
  }>,
) {
  return Object.freeze({
    status: "blocked",
    policy: ADDITIONAL_CONTRIBUTION_POLICY,
    account,
    targetPolicyVersion,
    cashAmountKrw: null,
    currentPortfolioTotalKrw: null,
    postTopupTotalKrw: null,
    totalCappedDeficitKrw: null,
    totalAllocatedKrw: null,
    residualCashKrw: null,
    residualReason: null,
    allocations: Object.freeze([]),
    blockers: Object.freeze([...blockers]),
  } as const);
}

function fractionalPart(value: number) {
  return value - Math.floor(value);
}

function cleanZero(value: number) {
  return Math.abs(value) <= EPSILON_KRW ? 0 : value;
}

const EPSILON_KRW = 1e-6;
