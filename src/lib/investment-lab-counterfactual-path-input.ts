import {
  isRiskDate,
  latestRiskObservationOnOrBefore,
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";
import type {
  InvestmentLabAdjustedClose,
  InvestmentLabAmountProvenance,
  InvestmentLabScheduledFlow,
  InvestmentLabScheduledMoneyFlow,
} from "./investment-lab-execution-schedule.ts";
import type {
  InvestmentLabActualPathPoint,
  InvestmentLabCounterfactualPathBlocker,
} from "./investment-lab-counterfactual-path.ts";

export type InvestmentLabValuationClose = InvestmentLabAdjustedClose &
  Readonly<{ serviceDate: string }>;
export type InvestmentLabValuePoint = Readonly<{ serviceDate: string; totalValue: number; at?: string }>;

export function prepareInvestmentLabCounterfactualPathInput(
  input: {
    actualPath: readonly InvestmentLabActualPathPoint[];
    closes: readonly InvestmentLabAdjustedClose[];
    scheduledFlows: readonly InvestmentLabScheduledFlow[];
    maxValuationCarryDays?: number;
  },
  defaultMaxValuationCarryDays: number,
) {
  const prepared = prepareInvestmentLabUnitPathInput({ ...input,
    actualPath: input.actualPath.map(({ totalMarketValueKrw, ...row }) => ({ ...row, totalValue: totalMarketValueKrw })),
    scheduledFlows: input.scheduledFlows.map(({ amountKrw, ...row }) => ({ ...row, amount: amountKrw })),
  }, defaultMaxValuationCarryDays);
  return { ...prepared,
    actualPath: prepared.actualPath.map(({ totalValue, ...row }) => ({ ...row, totalMarketValueKrw: totalValue })),
    scheduledFlows: prepared.scheduledFlows.map(({ amount, ...row }) => ({ ...row, amountKrw: amount, amountProvenance: row.amountProvenance as InvestmentLabAmountProvenance })),
  };
}

export function prepareInvestmentLabUnitPathInput(input: {
  actualPath: readonly InvestmentLabValuePoint[];
  closes: readonly InvestmentLabAdjustedClose[];
  scheduledFlows: readonly InvestmentLabScheduledMoneyFlow[];
  maxValuationCarryDays?: number;
  allowZeroValuations?: boolean;
}, defaultMaxValuationCarryDays: number) {
  const blockers: InvestmentLabCounterfactualPathBlocker[] = [];
  const actualPath = normalizeActualPath(input.actualPath, blockers, input.allowZeroValuations ?? false);
  const closes = normalizeCloses(input.closes, blockers);
  const scheduledFlows = normalizeScheduledFlows(
    input.scheduledFlows,
    closes,
    blockers,
  );
  const maxValuationCarryDays =
    input.maxValuationCarryDays ?? defaultMaxValuationCarryDays;

  if (
    !Number.isInteger(maxValuationCarryDays) ||
    maxValuationCarryDays < 0 ||
    maxValuationCarryDays > 31
  ) {
    blockers.push(
      pathBlocker("invalid_valuation_carry_limit", null, null),
    );
  }

  return {
    actualPath,
    closes,
    scheduledFlows,
    maxValuationCarryDays,
    blockers,
  };
}

export function investmentLabValuationOnOrBefore(
  closes: readonly InvestmentLabValuationClose[],
  serviceDate: string,
  maxCarryDays: number,
  blockers: InvestmentLabCounterfactualPathBlocker[],
) {
  const valuation = latestRiskObservationOnOrBefore(closes, serviceDate);
  if (!valuation) {
    blockers.push(pathBlocker("missing_valuation_close", null, serviceDate));
    return null;
  }
  if (valuation.carryDays > maxCarryDays) {
    blockers.push(
      pathBlocker("valuation_carry_limit_exceeded", null, serviceDate),
    );
    return null;
  }
  return valuation;
}

export function compareInvestmentLabEventOrder(
  left: Pick<InvestmentLabScheduledMoneyFlow, "eventDate" | "sequence" | "sourceIndex" | "eventAt">,
  right: Pick<InvestmentLabScheduledMoneyFlow, "eventDate" | "sequence" | "sourceIndex" | "eventAt">,
) {
  return (
    left.eventDate.localeCompare(right.eventDate) ||
    (left.eventAt && right.eventAt ? Date.parse(left.eventAt) - Date.parse(right.eventAt) : 0) ||
    left.sequence - right.sequence ||
    left.sourceIndex - right.sourceIndex
  );
}

export function compareInvestmentLabExecutionOrder(
  left: Pick<InvestmentLabScheduledMoneyFlow, "executionServiceDate" | "sequence" | "sourceIndex" | "eventAt">,
  right: Pick<InvestmentLabScheduledMoneyFlow, "executionServiceDate" | "sequence" | "sourceIndex" | "eventAt">,
) {
  return (
    left.executionServiceDate.localeCompare(right.executionServiceDate) ||
    (left.eventAt && right.eventAt ? Date.parse(left.eventAt) - Date.parse(right.eventAt) : 0) ||
    left.sequence - right.sequence ||
    left.sourceIndex - right.sourceIndex
  );
}

export function pathBlocker(
  reason: InvestmentLabCounterfactualPathBlocker["reason"],
  sourceIndex: number | null,
  serviceDate: string | null,
) {
  return Object.freeze({ reason, sourceIndex, serviceDate });
}

function normalizeActualPath(
  rows: readonly InvestmentLabValuePoint[],
  blockers: InvestmentLabCounterfactualPathBlocker[],
  allowZero: boolean,
) {
  if (rows.length < 2) {
    blockers.push(pathBlocker("insufficient_actual_path", null, null));
  }

  const seen = new Set<string>();
  const normalized: InvestmentLabValuePoint[] = [];
  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.serviceDate)) {
      blockers.push(pathBlocker("invalid_actual_date", sourceIndex, null));
      return;
    }
    if (row.at !== undefined && !Number.isFinite(Date.parse(row.at))) { blockers.push(pathBlocker("invalid_actual_date", sourceIndex, row.serviceDate)); return; }
    if (
      !Number.isFinite(row.totalValue) ||
      row.totalValue < 0 || (!allowZero && row.totalValue === 0)
    ) {
      blockers.push(
        pathBlocker("invalid_actual_value", sourceIndex, row.serviceDate),
      );
      return;
    }
    const identity = row.at === undefined ? row.serviceDate : String(Date.parse(row.at));
    if (seen.has(identity)) {
      blockers.push(
        pathBlocker("duplicate_actual_date", sourceIndex, row.serviceDate),
      );
      return;
    }
    seen.add(identity);
    normalized.push({ ...row });
  });

  return normalized.sort((left, right) =>
    left.at && right.at ? Date.parse(left.at) - Date.parse(right.at) : left.serviceDate.localeCompare(right.serviceDate),
  );
}

function normalizeCloses(
  rows: readonly InvestmentLabAdjustedClose[],
  blockers: InvestmentLabCounterfactualPathBlocker[],
) {
  const seen = new Set<string>();
  const normalized: InvestmentLabValuationClose[] = [];
  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.priceDate)) {
      blockers.push(pathBlocker("invalid_close_date", sourceIndex, null));
      return;
    }
    if (!Number.isFinite(row.adjustedClose) || row.adjustedClose <= 0) {
      blockers.push(
        pathBlocker("invalid_adjusted_close", sourceIndex, row.priceDate),
      );
      return;
    }
    if (seen.has(row.priceDate)) {
      blockers.push(
        pathBlocker("duplicate_close_date", sourceIndex, row.priceDate),
      );
      return;
    }
    seen.add(row.priceDate);
    normalized.push({
      ...row,
      serviceDate: mapRiskEvidenceDateToServiceDate(row.priceDate),
    });
  });

  return normalized.sort((left, right) =>
    left.serviceDate.localeCompare(right.serviceDate),
  );
}

function normalizeScheduledFlows(
  rows: readonly InvestmentLabScheduledMoneyFlow[],
  closes: readonly InvestmentLabValuationClose[],
  blockers: InvestmentLabCounterfactualPathBlocker[],
) {
  const closeByDate = new Map(closes.map((row) => [row.priceDate, row]));
  const seen = new Set<number>();
  const normalized: InvestmentLabScheduledMoneyFlow[] = [];

  rows.forEach((row) => {
    const sourceIndex = Number.isInteger(row.sourceIndex)
      ? row.sourceIndex
      : null;
    if (!isScheduledFlow(row)) {
      blockers.push(pathBlocker("invalid_scheduled_flow", sourceIndex, null));
      return;
    }
    if (seen.has(row.sourceIndex)) {
      blockers.push(
        pathBlocker(
          "duplicate_flow_source_index",
          row.sourceIndex,
          row.executionServiceDate,
        ),
      );
      return;
    }
    seen.add(row.sourceIndex);

    const expectedServiceDate = mapRiskEvidenceDateToServiceDate(
      row.executionPriceDate,
    );
    const expectedPendingDays = riskCalendarDayDistance(
      row.eventDate,
      row.executionPriceDate,
    );
    if (
      row.executionPriceDate < row.eventDate ||
      row.executionServiceDate !== expectedServiceDate ||
      row.pendingCalendarDays !== expectedPendingDays ||
      expectedPendingDays < 0 ||
      expectedPendingDays > 7
    ) {
      blockers.push(
        pathBlocker(
          "execution_policy_mismatch",
          row.sourceIndex,
          row.executionServiceDate,
        ),
      );
      return;
    }

    const close = closeByDate.get(row.executionPriceDate);
    if (!close || !nearlyEqual(close.adjustedClose, row.adjustedClose)) {
      blockers.push(
        pathBlocker(
          "execution_close_mismatch",
          row.sourceIndex,
          row.executionServiceDate,
        ),
      );
      return;
    }
    normalized.push({ ...row });
  });

  return normalized;
}

function isScheduledFlow(
  row: InvestmentLabScheduledMoneyFlow,
): row is InvestmentLabScheduledMoneyFlow {
  return (
    isRiskDate(row.eventDate) &&
    Number.isInteger(row.sequence) &&
    row.sequence >= 0 &&
    (row.direction === "inflow" || row.direction === "outflow") &&
    Number.isFinite(row.amount) &&
    row.amount > 0 &&
    (row.eventAt === undefined || Number.isFinite(Date.parse(row.eventAt))) &&
    isAmountProvenance(row.amountProvenance) &&
    Number.isInteger(row.sourceIndex) &&
    row.sourceIndex >= 0 &&
    isRiskDate(row.executionPriceDate) &&
    isRiskDate(row.executionServiceDate) &&
    Number.isFinite(row.adjustedClose) &&
    row.adjustedClose > 0 &&
    Number.isInteger(row.pendingCalendarDays) &&
    row.pendingCalendarDays >= 0
  );
}

function isAmountProvenance(
  value: string,
): value is InvestmentLabAmountProvenance | "dated_reporting_money" {
  return (
    value === "explicit_amount_krw" ||
    value === "derived_quantity_price_krw" ||
    value === "derived_quantity_price_fx" ||
    value === "dated_reporting_money"
  );
}

function nearlyEqual(left: number, right: number) {
  return (
    Math.abs(left - right) <=
    Math.max(1, Math.abs(left), Math.abs(right)) * 1e-12
  );
}
