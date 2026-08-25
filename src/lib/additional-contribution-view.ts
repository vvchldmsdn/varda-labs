export type AdditionalContributionViewInput = Readonly<{
  cashAmountKrw: number;
  currentPortfolioTotalKrw: number;
  postTopupTotalKrw: number;
  totalAllocatedKrw: number;
  residualCashKrw: number;
  rows: readonly AdditionalContributionViewInputRow[];
}>;

export type AdditionalContributionViewInputRow = Readonly<{
  accountCode: string;
  accountName: string;
  allocationKrw: number;
  currentValueKrw: number;
  currentWeightPct: number;
  currency: string | null;
  ma120ReductionKrw: number;
  market: string | null;
  name: string;
  postTopupValueKrw: number;
  postTopupWeightPct: number;
  strategicAllocationKrw: number;
  targetWeightPct: number;
  ticker: string | null;
}>;

export type AdditionalContributionMa120EvidenceView = Readonly<{
  status:
    | "above_ma"
    | "at_ma"
    | "below_ma"
    | "insufficient_history"
    | "invalid_history"
    | "unavailable";
  priceBasis: "provider_adjusted_close" | "private_kis_raw_close" | null;
  availableObservationCount: number;
  latestWindowPriceDate: string | null;
  ma120: number | null;
  distanceFromMaPct: number | null;
}>;

export type AdditionalContributionResultRow = AdditionalContributionViewInputRow &
  Readonly<{
    ma120Evidence: AdditionalContributionMa120EvidenceView;
  }>;

export type AdditionalContributionResultPreview = Omit<
  AdditionalContributionViewInput,
  "rows"
> &
  Readonly<{
    status: "ready";
    effectiveServiceDate: string | null;
    policyLabel: string;
    serviceDate: string;
    ma120Evidence: Readonly<{
      mode: "off" | "enabled";
      status: "ready" | "partial" | "unavailable" | "read_failed";
      usableCount: number;
      totalReductionKrw: number;
    }>;
    rows: readonly AdditionalContributionResultRow[];
  }>;

export type AdditionalContributionFlowRow = Readonly<{
  id: string;
  name: string;
  ticker: string | null;
  accountName: string;
  allocationKrw: number;
  strategicAllocationKrw: number;
  reductionKrw: number;
  targetWeightPct: number;
  postTopupWeightPct: number;
  aggregatedHoldingCount: number;
  kind: "holding" | "other" | "cash";
}>;

export type AdditionalContributionView = Readonly<{
  allocatedPct: number;
  recipientCount: number;
  reducedHoldingCount: number;
  totalReductionKrw: number;
  targetDistanceBeforePct: number;
  targetDistanceAfterPct: number;
  targetDistanceImprovementPct: number;
  flowRows: readonly AdditionalContributionFlowRow[];
}>;

const MAX_NAMED_FLOW_ROWS = 9;

export function buildAdditionalContributionView(
  input: AdditionalContributionViewInput,
): AdditionalContributionView {
  const recipientRows = input.rows
    .filter(
      (row) => row.allocationKrw > 0 || row.strategicAllocationKrw > 0,
    )
    .toSorted(
      (left, right) =>
        Math.max(right.allocationKrw, right.strategicAllocationKrw) -
          Math.max(left.allocationKrw, left.strategicAllocationKrw) ||
        stableRowId(left).localeCompare(stableRowId(right)),
    );
  const namedRows = recipientRows.slice(0, MAX_NAMED_FLOW_ROWS);
  const overflowRows = recipientRows.slice(MAX_NAMED_FLOW_ROWS);
  const flowRows: AdditionalContributionFlowRow[] = namedRows.map((row) =>
    Object.freeze({
      id: stableRowId(row),
      name: row.name,
      ticker: row.ticker,
      accountName: row.accountName,
      allocationKrw: row.allocationKrw,
      strategicAllocationKrw: row.strategicAllocationKrw,
      reductionKrw: row.ma120ReductionKrw,
      targetWeightPct: row.targetWeightPct,
      postTopupWeightPct: row.postTopupWeightPct,
      aggregatedHoldingCount: 1,
      kind: "holding" as const,
    }),
  );

  if (overflowRows.length > 0) {
    flowRows.push(
      Object.freeze({
        id: "other-holdings",
        name: `기타 ${overflowRows.length}종목`,
        ticker: null,
        accountName: "여러 계좌",
        allocationKrw: sum(overflowRows, (row) => row.allocationKrw),
        strategicAllocationKrw: sum(
          overflowRows,
          (row) => row.strategicAllocationKrw,
        ),
        reductionKrw: sum(overflowRows, (row) => row.ma120ReductionKrw),
        targetWeightPct: sum(overflowRows, (row) => row.targetWeightPct),
        postTopupWeightPct: sum(
          overflowRows,
          (row) => row.postTopupWeightPct,
        ),
        aggregatedHoldingCount: overflowRows.length,
        kind: "other" as const,
      }),
    );
  }

  const strategicAllocatedKrw = sum(
    input.rows,
    (row) => row.strategicAllocationKrw,
  );
  const strategicResidualCashKrw = Math.max(
    0,
    input.cashAmountKrw - strategicAllocatedKrw,
  );
  if (input.residualCashKrw > 0 || strategicResidualCashKrw > 0) {
    flowRows.push(
      Object.freeze({
        id: "residual-cash",
        name: "현금 보류",
        ticker: null,
        accountName: "미배분",
        allocationKrw: input.residualCashKrw,
        strategicAllocationKrw: strategicResidualCashKrw,
        reductionKrw: Math.max(
          0,
          input.residualCashKrw - strategicResidualCashKrw,
        ),
        targetWeightPct: 0,
        postTopupWeightPct:
          input.postTopupTotalKrw > 0
            ? (input.residualCashKrw / input.postTopupTotalKrw) * 100
            : 0,
        aggregatedHoldingCount: 0,
        kind: "cash" as const,
      }),
    );
  }

  const targetDistanceBeforePct = totalVariationDistance(
    input.rows.map((row) => ({
      actualPct: row.currentWeightPct,
      targetPct: row.targetWeightPct,
    })),
  );
  const targetDistanceAfterPct = totalVariationDistance([
    ...input.rows.map((row) => ({
      actualPct: row.postTopupWeightPct,
      targetPct: row.targetWeightPct,
    })),
    {
      actualPct:
        input.postTopupTotalKrw > 0
          ? (input.residualCashKrw / input.postTopupTotalKrw) * 100
          : 0,
      targetPct: 0,
    },
  ]);

  return Object.freeze({
    allocatedPct:
      input.cashAmountKrw > 0
        ? (input.totalAllocatedKrw / input.cashAmountKrw) * 100
        : 0,
    recipientCount: input.rows.filter((row) => row.allocationKrw > 0).length,
    reducedHoldingCount: input.rows.filter(
      (row) => row.ma120ReductionKrw > 0,
    ).length,
    totalReductionKrw: sum(input.rows, (row) => row.ma120ReductionKrw),
    targetDistanceBeforePct,
    targetDistanceAfterPct,
    targetDistanceImprovementPct:
      targetDistanceBeforePct - targetDistanceAfterPct,
    flowRows: Object.freeze(flowRows),
  });
}

function totalVariationDistance(
  rows: readonly Readonly<{ actualPct: number; targetPct: number }>[],
) {
  return sum(rows, (row) => Math.abs(row.actualPct - row.targetPct)) / 2;
}

function stableRowId(row: AdditionalContributionViewInputRow) {
  return [
    row.accountCode,
    row.market ?? "unknown",
    row.currency ?? "unknown",
    row.ticker ?? row.name,
  ].join(":");
}

function sum<T>(rows: readonly T[], select: (row: T) => number) {
  return rows.reduce((total, row) => total + select(row), 0);
}
