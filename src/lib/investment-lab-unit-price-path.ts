import type { InvestmentLabActualPathPoint } from "./investment-lab-counterfactual-path.ts";
import type { InvestmentLabAmountProvenance } from "./investment-lab-execution-schedule.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";

export type InvestmentLabUnitValuation = Readonly<{
  serviceDate: string;
  priceDate: string;
  unitPriceKrw: number;
}>;

export type InvestmentLabUnitExecution = Readonly<{
  sourceIndex: number;
  eventDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
  amountProvenance: InvestmentLabAmountProvenance;
  executionPriceDate: string;
  executionServiceDate: string;
  unitPriceKrw: number;
  pendingCalendarDays: number;
}>;

export type InvestmentLabUnitPathBlocker = Readonly<{
  reason:
    | "invalid_actual_path"
    | "valuation_axis_mismatch"
    | "invalid_valuation_evidence"
    | "invalid_execution_evidence"
    | "duplicate_execution_source"
    | "scenario_insolvent"
    | "unfinished_path"
    | "invalid_calculation_result";
  sourceIndex: number | null;
  serviceDate: string | null;
}>;

export type InvestmentLabUnitPathRow = Readonly<{
  serviceDate: string;
  actualMarketValueKrw: number;
  investedMarketValueKrw: number;
  units: number;
  valuationPriceDate: string;
  pendingBuyCashKrw: number;
  pendingSellObligationKrw: number;
  appliedFlowCount: number;
  hasPendingExecution: boolean;
}>;

export type InvestmentLabUnitPathResult =
  | Readonly<{
      status: "ready";
      rows: readonly InvestmentLabUnitPathRow[];
      appliedFlows: readonly (
        InvestmentLabUnitExecution & Readonly<{ unitsAfter: number }>
      )[];
      delayedExecutionRows: number;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      rows: readonly [];
      appliedFlows: readonly [];
      delayedExecutionRows: 0;
      blockers: readonly InvestmentLabUnitPathBlocker[];
    }>;

export function buildInvestmentLabUnitPricePath(input: Readonly<{
  actualPath: readonly InvestmentLabActualPathPoint[];
  valuations: readonly InvestmentLabUnitValuation[];
  executions: readonly InvestmentLabUnitExecution[];
}>): InvestmentLabUnitPathResult {
  const actualPath = [...input.actualPath];
  if (!isValidActualPath(actualPath)) {
    return blocked([blocker("invalid_actual_path")]);
  }
  if (
    input.valuations.length !== actualPath.length ||
    input.valuations.some(
      (row, index) => row.serviceDate !== actualPath[index].serviceDate,
    )
  ) {
    return blocked([blocker("valuation_axis_mismatch")]);
  }
  if (
    input.valuations.some(
      (row) =>
        !isRiskDate(row.priceDate) || !positiveFinite(row.unitPriceKrw),
    )
  ) {
    return blocked([blocker("invalid_valuation_evidence")]);
  }

  const executions = [...input.executions];
  const seenSources = new Set<number>();
  for (const execution of executions) {
    if (seenSources.has(execution.sourceIndex)) {
      return blocked([
        blocker(
          "duplicate_execution_source",
          execution.sourceIndex,
          execution.executionServiceDate,
        ),
      ]);
    }
    seenSources.add(execution.sourceIndex);
    if (
      !isValidExecution(
        execution,
        actualPath[0].serviceDate,
        actualPath.at(-1)!.serviceDate,
      )
    ) {
      return blocked([
        blocker(
          "invalid_execution_evidence",
          execution.sourceIndex,
          execution.executionServiceDate,
        ),
      ]);
    }
  }

  let units =
    actualPath[0].totalMarketValueKrw / input.valuations[0].unitPriceKrw;
  if (!positiveFinite(units)) {
    return blocked([blocker("invalid_calculation_result")]);
  }

  const flowsByEvent = [...executions].sort(compareEventOrder);
  const flowsByExecution = [...executions].sort(compareExecutionOrder);
  const activePending = new Set<number>();
  const appliedFlows: Array<
    InvestmentLabUnitExecution & Readonly<{ unitsAfter: number }>
  > = [];
  const rows: InvestmentLabUnitPathRow[] = [];
  let eventIndex = 0;
  let executionIndex = 0;
  let pendingBuyCashKrw = 0;
  let pendingSellObligationKrw = 0;

  for (let index = 0; index < actualPath.length; index += 1) {
    const actual = actualPath[index];
    const valuation = input.valuations[index];

    while (
      eventIndex < flowsByEvent.length &&
      flowsByEvent[eventIndex].eventDate <= actual.serviceDate
    ) {
      const flow = flowsByEvent[eventIndex];
      activePending.add(flow.sourceIndex);
      if (flow.direction === "inflow") pendingBuyCashKrw += flow.amountKrw;
      else pendingSellObligationKrw += flow.amountKrw;
      eventIndex += 1;
    }

    let appliedFlowCount = 0;
    while (
      executionIndex < flowsByExecution.length &&
      flowsByExecution[executionIndex].executionServiceDate <= actual.serviceDate
    ) {
      const flow = flowsByExecution[executionIndex];
      if (
        flow.direction === "outflow" &&
        units * flow.unitPriceKrw + 1e-6 < flow.amountKrw
      ) {
        return blocked([
          blocker("scenario_insolvent", flow.sourceIndex, actual.serviceDate),
        ]);
      }
      const unitDelta = flow.amountKrw / flow.unitPriceKrw;
      units =
        flow.direction === "inflow"
          ? units + unitDelta
          : cleanZero(units - unitDelta);
      if (!Number.isFinite(units) || units < 0) {
        return blocked([
          blocker(
            "invalid_calculation_result",
            flow.sourceIndex,
            actual.serviceDate,
          ),
        ]);
      }

      appliedFlows.push(Object.freeze({ ...flow, unitsAfter: units }));
      appliedFlowCount += 1;
      executionIndex += 1;
      if (activePending.delete(flow.sourceIndex)) {
        if (flow.direction === "inflow") {
          pendingBuyCashKrw = cleanZero(pendingBuyCashKrw - flow.amountKrw);
        } else {
          pendingSellObligationKrw = cleanZero(
            pendingSellObligationKrw - flow.amountKrw,
          );
        }
      }
    }

    const investedMarketValueKrw = units * valuation.unitPriceKrw;
    if (!nonNegativeFinite(investedMarketValueKrw)) {
      return blocked([blocker("invalid_calculation_result")]);
    }
    rows.push(
      Object.freeze({
        serviceDate: actual.serviceDate,
        actualMarketValueKrw: actual.totalMarketValueKrw,
        investedMarketValueKrw,
        units,
        valuationPriceDate: valuation.priceDate,
        pendingBuyCashKrw,
        pendingSellObligationKrw,
        appliedFlowCount,
        hasPendingExecution:
          pendingBuyCashKrw > 1e-6 || pendingSellObligationKrw > 1e-6,
      }),
    );
  }

  if (
    eventIndex !== flowsByEvent.length ||
    executionIndex !== flowsByExecution.length ||
    activePending.size !== 0 ||
    Math.abs(pendingBuyCashKrw) > 1e-6 ||
    Math.abs(pendingSellObligationKrw) > 1e-6
  ) {
    return blocked([blocker("unfinished_path")]);
  }

  return Object.freeze({
    status: "ready",
    rows: Object.freeze(rows),
    appliedFlows: Object.freeze(appliedFlows),
    delayedExecutionRows: executions.filter(
      (row) => row.pendingCalendarDays > 0,
    ).length,
    blockers: [] as const,
  });
}

function isValidActualPath(rows: readonly InvestmentLabActualPathPoint[]) {
  return (
    rows.length >= 2 &&
    rows.every(
      (row, index) =>
        isRiskDate(row.serviceDate) &&
        positiveFinite(row.totalMarketValueKrw) &&
        (index === 0 || rows[index - 1].serviceDate < row.serviceDate),
    )
  );
}

function isValidExecution(
  row: InvestmentLabUnitExecution,
  startServiceDate: string,
  endServiceDate: string,
) {
  return (
    Number.isInteger(row.sourceIndex) &&
    row.sourceIndex >= 0 &&
    isRiskDate(row.eventDate) &&
    Number.isInteger(row.sequence) &&
    row.sequence >= 0 &&
    (row.direction === "inflow" || row.direction === "outflow") &&
    positiveFinite(row.amountKrw) &&
    isAmountProvenance(row.amountProvenance) &&
    isRiskDate(row.executionPriceDate) &&
    isRiskDate(row.executionServiceDate) &&
    row.executionServiceDate > startServiceDate &&
    row.executionServiceDate <= endServiceDate &&
    positiveFinite(row.unitPriceKrw) &&
    Number.isInteger(row.pendingCalendarDays) &&
    row.pendingCalendarDays >= 0
  );
}

function compareEventOrder(
  left: InvestmentLabUnitExecution,
  right: InvestmentLabUnitExecution,
) {
  return (
    left.eventDate.localeCompare(right.eventDate) ||
    left.sequence - right.sequence ||
    left.sourceIndex - right.sourceIndex
  );
}

function compareExecutionOrder(
  left: InvestmentLabUnitExecution,
  right: InvestmentLabUnitExecution,
) {
  return (
    left.executionServiceDate.localeCompare(right.executionServiceDate) ||
    left.executionPriceDate.localeCompare(right.executionPriceDate) ||
    left.sequence - right.sequence ||
    left.sourceIndex - right.sourceIndex
  );
}

function isAmountProvenance(value: InvestmentLabAmountProvenance) {
  return (
    value === "explicit_amount_krw" ||
    value === "derived_quantity_price_krw" ||
    value === "derived_quantity_price_fx"
  );
}

function blocker(
  reason: InvestmentLabUnitPathBlocker["reason"],
  sourceIndex: number | null = null,
  serviceDate: string | null = null,
) {
  return Object.freeze({ reason, sourceIndex, serviceDate });
}

function blocked(
  blockers: readonly InvestmentLabUnitPathBlocker[],
): InvestmentLabUnitPathResult {
  return Object.freeze({
    status: "blocked",
    rows: [] as const,
    appliedFlows: [] as const,
    delayedExecutionRows: 0 as const,
    blockers: Object.freeze([...blockers]),
  });
}

function positiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-6 ? 0 : value;
}
