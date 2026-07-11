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
} from "./investment-lab-execution-schedule.ts";
import type {
  InvestmentLabActualPathPoint,
  InvestmentLabCounterfactualPathBlocker,
} from "./investment-lab-counterfactual-path.ts";

export type InvestmentLabValuationClose = InvestmentLabAdjustedClose &
  Readonly<{ serviceDate: string }>;

export function prepareInvestmentLabCounterfactualPathInput(
  input: {
    actualPath: readonly InvestmentLabActualPathPoint[];
    closes: readonly InvestmentLabAdjustedClose[];
    scheduledFlows: readonly InvestmentLabScheduledFlow[];
    maxValuationCarryDays?: number;
  },
  defaultMaxValuationCarryDays: number,
) {
  const blockers: InvestmentLabCounterfactualPathBlocker[] = [];
  const actualPath = normalizeActualPath(input.actualPath, blockers);
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
  left: InvestmentLabScheduledFlow,
  right: InvestmentLabScheduledFlow,
) {
  return (
    left.eventDate.localeCompare(right.eventDate) ||
    left.sequence - right.sequence ||
    left.sourceIndex - right.sourceIndex
  );
}

export function compareInvestmentLabExecutionOrder(
  left: InvestmentLabScheduledFlow,
  right: InvestmentLabScheduledFlow,
) {
  return (
    left.executionServiceDate.localeCompare(right.executionServiceDate) ||
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
  rows: readonly InvestmentLabActualPathPoint[],
  blockers: InvestmentLabCounterfactualPathBlocker[],
) {
  if (rows.length < 2) {
    blockers.push(pathBlocker("insufficient_actual_path", null, null));
  }

  const seen = new Set<string>();
  const normalized: InvestmentLabActualPathPoint[] = [];
  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.serviceDate)) {
      blockers.push(pathBlocker("invalid_actual_date", sourceIndex, null));
      return;
    }
    if (
      !Number.isFinite(row.totalMarketValueKrw) ||
      row.totalMarketValueKrw <= 0
    ) {
      blockers.push(
        pathBlocker("invalid_actual_value", sourceIndex, row.serviceDate),
      );
      return;
    }
    if (seen.has(row.serviceDate)) {
      blockers.push(
        pathBlocker("duplicate_actual_date", sourceIndex, row.serviceDate),
      );
      return;
    }
    seen.add(row.serviceDate);
    normalized.push({ ...row });
  });

  return normalized.sort((left, right) =>
    left.serviceDate.localeCompare(right.serviceDate),
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
  rows: readonly InvestmentLabScheduledFlow[],
  closes: readonly InvestmentLabValuationClose[],
  blockers: InvestmentLabCounterfactualPathBlocker[],
) {
  const closeByDate = new Map(closes.map((row) => [row.priceDate, row]));
  const seen = new Set<number>();
  const normalized: InvestmentLabScheduledFlow[] = [];

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
  row: InvestmentLabScheduledFlow,
): row is InvestmentLabScheduledFlow {
  return (
    isRiskDate(row.eventDate) &&
    Number.isInteger(row.sequence) &&
    row.sequence >= 0 &&
    (row.direction === "inflow" || row.direction === "outflow") &&
    Number.isFinite(row.amountKrw) &&
    row.amountKrw > 0 &&
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
): value is InvestmentLabAmountProvenance {
  return (
    value === "explicit_amount_krw" ||
    value === "derived_quantity_price_krw" ||
    value === "derived_quantity_price_fx"
  );
}

function nearlyEqual(left: number, right: number) {
  return (
    Math.abs(left - right) <=
    Math.max(1, Math.abs(left), Math.abs(right)) * 1e-12
  );
}
