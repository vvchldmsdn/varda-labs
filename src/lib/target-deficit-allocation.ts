export const TARGET_DEFICIT_ALLOCATION_POLICY = Object.freeze({
  version: "target_deficit_proportional_capped_v1",
  targetWeightTotalBps: 10_000,
  allocationUnit: "integer_krw",
  rounding: "largest_remainder_then_allocation_key_with_cap_guard",
  sells: "forbidden",
} as const);

export type TargetDeficitAllocationBlocker =
  | "invalid_cash_amount"
  | "empty_valuation_universe"
  | "invalid_current_value"
  | "invalid_target_weight"
  | "duplicate_allocation_key"
  | "target_policy_incomplete"
  | "unallocatable_target_deficit"
  | "allocation_invariant_failed";

export type TargetDeficitAllocationRow<T> = Readonly<{
  allocationKey: string;
  buyable: boolean;
  currentValueKrw: number;
  targetWeightBps: number;
  metadata: T;
}>;

type WorkingRow<T> = TargetDeficitAllocationRow<T> & {
  targetValueAfterTopupKrw: number;
  cappedDeficitKrw: number;
  idealAllocationKrw: number;
  allocationKrw: number;
};

export function allocateTargetDeficits<T>({
  cashAmountKrw,
  rows: sourceRows,
}: {
  cashAmountKrw: number;
  rows: readonly TargetDeficitAllocationRow<T>[];
}) {
  const blockers = new Set<TargetDeficitAllocationBlocker>();
  if (!Number.isSafeInteger(cashAmountKrw) || cashAmountKrw <= 0) {
    blockers.add("invalid_cash_amount");
  }
  if (sourceRows.length === 0) blockers.add("empty_valuation_universe");

  const seenKeys = new Set<string>();
  for (const row of sourceRows) {
    if (
      !row.allocationKey ||
      seenKeys.has(row.allocationKey)
    ) {
      blockers.add("duplicate_allocation_key");
    }
    seenKeys.add(row.allocationKey);
    if (!Number.isFinite(row.currentValueKrw) || row.currentValueKrw < 0) {
      blockers.add("invalid_current_value");
    }
    if (
      !Number.isSafeInteger(row.targetWeightBps) ||
      row.targetWeightBps < 0 ||
      row.targetWeightBps > TARGET_DEFICIT_ALLOCATION_POLICY.targetWeightTotalBps
    ) {
      blockers.add("invalid_target_weight");
    }
  }
  const targetWeightTotalBps = sourceRows.reduce(
    (total, row) => total + row.targetWeightBps,
    0,
  );
  if (
    sourceRows.length > 0 &&
    targetWeightTotalBps !== TARGET_DEFICIT_ALLOCATION_POLICY.targetWeightTotalBps
  ) {
    blockers.add("target_policy_incomplete");
  }
  if (blockers.size > 0) return blocked(blockers);

  const currentPortfolioTotalKrw = sourceRows.reduce(
    (total, row) => total + row.currentValueKrw,
    0,
  );
  const postTopupTotalKrw = currentPortfolioTotalKrw + cashAmountKrw;
  if (!Number.isFinite(postTopupTotalKrw)) {
    return blocked(new Set(["allocation_invariant_failed"]));
  }

  const rows: WorkingRow<T>[] = sourceRows.map((row) => {
    const targetValueAfterTopupKrw =
      (row.targetWeightBps /
        TARGET_DEFICIT_ALLOCATION_POLICY.targetWeightTotalBps) *
      postTopupTotalKrw;
    const cappedDeficitKrw = cleanZero(
      Math.max(0, targetValueAfterTopupKrw - row.currentValueKrw),
    );
    if (cappedDeficitKrw > EPSILON_KRW && !row.buyable) {
      blockers.add("unallocatable_target_deficit");
    }
    return {
      ...row,
      targetValueAfterTopupKrw,
      cappedDeficitKrw,
      idealAllocationKrw: 0,
      allocationKrw: 0,
    };
  });
  if (blockers.size > 0) return blocked(blockers);

  const allocatable = rows.filter(
    (row) => row.buyable && row.cappedDeficitKrw > EPSILON_KRW,
  );
  const totalCappedDeficitKrw = allocatable.reduce(
    (total, row) => total + row.cappedDeficitKrw,
    0,
  );
  const scale =
    totalCappedDeficitKrw > 0
      ? Math.min(1, cashAmountKrw / totalCappedDeficitKrw)
      : 0;
  for (const row of allocatable) {
    row.idealAllocationKrw = row.cappedDeficitKrw * scale;
    row.allocationKrw = Math.floor(row.idealAllocationKrw);
  }

  let undistributedKrw =
    cashAmountKrw -
    allocatable.reduce((total, row) => total + row.allocationKrw, 0);
  const remainderOrder = allocatable.toSorted(
    (left, right) =>
      fractionalPart(right.idealAllocationKrw) -
        fractionalPart(left.idealAllocationKrw) ||
      left.allocationKey.localeCompare(right.allocationKey),
  );
  for (const row of remainderOrder) {
    if (undistributedKrw === 0) break;
    if (row.allocationKrw + 1 <= row.cappedDeficitKrw + EPSILON_KRW) {
      row.allocationKrw += 1;
      undistributedKrw -= 1;
    }
  }

  const totalAllocatedKrw = rows.reduce(
    (total, row) => total + row.allocationKrw,
    0,
  );
  const residualCashKrw = cashAmountKrw - totalAllocatedKrw;
  if (!allocationInvariantsHold(rows, cashAmountKrw, residualCashKrw)) {
    return blocked(new Set(["allocation_invariant_failed"]));
  }

  return Object.freeze({
    status: "ready" as const,
    policy: TARGET_DEFICIT_ALLOCATION_POLICY,
    cashAmountKrw,
    currentPortfolioTotalKrw,
    postTopupTotalKrw,
    totalCappedDeficitKrw,
    totalAllocatedKrw,
    residualCashKrw,
    rows: Object.freeze(
      rows
        .toSorted((left, right) =>
          left.allocationKey.localeCompare(right.allocationKey),
        )
        .map((row) =>
          Object.freeze({
            allocationKey: row.allocationKey,
            metadata: row.metadata,
            currentValueKrw: row.currentValueKrw,
            targetWeightBps: row.targetWeightBps,
            targetValueAfterTopupKrw: row.targetValueAfterTopupKrw,
            cappedDeficitKrw: row.cappedDeficitKrw,
            allocationKrw: row.allocationKrw,
            allocationStatus: allocationStatus(row),
          }),
        ),
    ),
    blockers: Object.freeze([] as TargetDeficitAllocationBlocker[]),
  });
}

function allocationInvariantsHold<T>(
  rows: readonly WorkingRow<T>[],
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
    if (row.allocationKrw > row.cappedDeficitKrw + EPSILON_KRW) return false;
    allocated += row.allocationKrw;
  }
  return allocated + residualCashKrw === cashAmountKrw;
}

function allocationStatus<T>(row: WorkingRow<T>) {
  if (row.allocationKrw > 0) return "allocated" as const;
  if (row.targetWeightBps === 0) return "target_weight_zero" as const;
  if (!row.buyable) return "not_buyable_no_deficit" as const;
  if (row.cappedDeficitKrw <= EPSILON_KRW) {
    return "no_positive_deficit" as const;
  }
  return "rounded_to_zero" as const;
}

function blocked(blockers: Set<TargetDeficitAllocationBlocker>) {
  return Object.freeze({
    status: "blocked" as const,
    policy: TARGET_DEFICIT_ALLOCATION_POLICY,
    cashAmountKrw: null,
    currentPortfolioTotalKrw: null,
    postTopupTotalKrw: null,
    totalCappedDeficitKrw: null,
    totalAllocatedKrw: null,
    residualCashKrw: null,
    rows: Object.freeze([]),
    blockers: Object.freeze([...blockers].toSorted()),
  });
}

function fractionalPart(value: number) {
  return value - Math.floor(value);
}

function cleanZero(value: number) {
  return Math.abs(value) <= EPSILON_KRW ? 0 : value;
}

const EPSILON_KRW = 1e-6;
