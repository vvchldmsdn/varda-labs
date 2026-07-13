import type { InvestmentLabActualPathPoint } from "./investment-lab-counterfactual-path.ts";
import type {
  InvestmentLabVooEvidenceResolution,
  InvestmentLabVooExecutionEvidence,
} from "./investment-lab-voo-evidence.ts";
import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";

export const INVESTMENT_LAB_VOO_PATH_POLICY = Object.freeze({
  version: "position_flow_counterfactual_usd_raw_close_v1",
  scenarioInstrumentKey: "us:USD:VOO",
  comparisonBasis: "position_value_only",
  priceBasis: "raw_close_usd_times_stored_snapshot_fx",
  fractionalUnits: true,
  residualCashKrw: 0,
  transactionCostsKrw: 0,
  shortSelling: "forbidden_fail_closed",
  insufficientSellHandling: "scenario_unavailable",
  eventNetting: "forbidden",
} as const);

export type InvestmentLabVooPathBlocker = Readonly<{
  reason:
    | "evidence_unavailable"
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

export type InvestmentLabVooPathRow = Readonly<{
  serviceDate: string;
  actualMarketValueKrw: number;
  investedMarketValueKrw: number;
  valuationPathDifferenceKrw: number;
  units: number;
  valuationPriceDate: string;
  rawCloseUsd: number;
  snapshotUsdKrw: number;
  pendingBuyCashKrw: number;
  pendingSellObligationKrw: number;
  appliedFlowCount: number;
  comparisonBasis:
    | "position_value_only"
    | "position_value_only_with_pending_flows";
}>;

export type InvestmentLabVooAppliedFlow = InvestmentLabVooExecutionEvidence &
  Readonly<{ unitsAfter: number }>;

export type InvestmentLabVooPathResult =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_VOO_PATH_POLICY;
      anchor: Readonly<{
        serviceDate: string;
        actualMarketValueKrw: number;
        valuationPriceDate: string;
        rawCloseUsd: number;
        snapshotUsdKrw: number;
        units: number;
      }>;
      rows: readonly InvestmentLabVooPathRow[];
      appliedFlows: readonly InvestmentLabVooAppliedFlow[];
      delayedExecutionRows: number;
      pendingAtEnd: Readonly<{
        flowCount: number;
        buyCashKrw: number;
        sellObligationKrw: number;
      }>;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      policy: typeof INVESTMENT_LAB_VOO_PATH_POLICY;
      anchor: null;
      rows: readonly [];
      appliedFlows: readonly [];
      delayedExecutionRows: 0;
      pendingAtEnd: Readonly<{
        flowCount: 0;
        buyCashKrw: 0;
        sellObligationKrw: 0;
      }>;
      blockers: readonly InvestmentLabVooPathBlocker[];
    }>;

export function buildInvestmentLabVooPath(input: {
  actualPath: readonly InvestmentLabActualPathPoint[];
  evidence: InvestmentLabVooEvidenceResolution;
}): InvestmentLabVooPathResult {
  if (input.evidence.status !== "ready") {
    return blocked([blocker("evidence_unavailable")]);
  }

  const actualPath = [...input.actualPath];
  if (!isValidActualPath(actualPath)) {
    return blocked([blocker("invalid_actual_path")]);
  }
  const valuations = input.evidence.valuations;
  if (
    valuations.length !== actualPath.length ||
    valuations.some(
      (row, index) => row.serviceDate !== actualPath[index].serviceDate,
    )
  ) {
    return blocked([blocker("valuation_axis_mismatch")]);
  }
  if (
    valuations.some(
      (row) =>
        !isRiskDate(row.priceDate) ||
        !positiveFinite(row.rawCloseUsd) ||
        !positiveFinite(row.snapshotUsdKrw) ||
        !positiveFinite(row.unitValueKrw) ||
        !nearlyEqual(
          row.unitValueKrw,
          row.rawCloseUsd * row.snapshotUsdKrw,
        ),
    )
  ) {
    return blocked([blocker("invalid_valuation_evidence")]);
  }

  const executions = [...input.evidence.executions];
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

  const anchor = actualPath[0];
  const anchorValuation = valuations[0];
  let units = anchor.totalMarketValueKrw / anchorValuation.unitValueKrw;
  if (!positiveFinite(units)) {
    return blocked([blocker("invalid_calculation_result")]);
  }

  const flowsByEvent = [...executions].sort(compareEventOrder);
  const flowsByExecution = [...executions].sort(compareExecutionOrder);
  const activePending = new Set<number>();
  const appliedFlows: InvestmentLabVooAppliedFlow[] = [];
  const rows: InvestmentLabVooPathRow[] = [];
  let eventIndex = 0;
  let executionIndex = 0;
  let pendingBuyCashKrw = 0;
  let pendingSellObligationKrw = 0;

  for (let index = 0; index < actualPath.length; index += 1) {
    const actual = actualPath[index];
    const valuation = valuations[index];

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
      flowsByExecution[executionIndex].executionServiceDate <=
        actual.serviceDate
    ) {
      const flow = flowsByExecution[executionIndex];
      if (
        flow.direction === "outflow" &&
        units * flow.unitPriceKrw + 1e-6 < flow.amountKrw
      ) {
        return blocked([
          blocker(
            "scenario_insolvent",
            flow.sourceIndex,
            flow.executionServiceDate,
          ),
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
            flow.executionServiceDate,
          ),
        ]);
      }

      appliedFlows.push(Object.freeze({ ...flow, unitsAfter: units }));
      appliedFlowCount += 1;
      executionIndex += 1;
      if (activePending.delete(flow.sourceIndex)) {
        if (flow.direction === "inflow") {
          pendingBuyCashKrw = cleanZero(
            pendingBuyCashKrw - flow.amountKrw,
          );
        } else {
          pendingSellObligationKrw = cleanZero(
            pendingSellObligationKrw - flow.amountKrw,
          );
        }
      }
    }

    const investedMarketValueKrw = units * valuation.unitValueKrw;
    if (!Number.isFinite(investedMarketValueKrw) || investedMarketValueKrw < 0) {
      return blocked([blocker("invalid_calculation_result")]);
    }
    const hasPendingFlows =
      pendingBuyCashKrw > 1e-6 || pendingSellObligationKrw > 1e-6;
    rows.push(
      Object.freeze({
        serviceDate: actual.serviceDate,
        actualMarketValueKrw: actual.totalMarketValueKrw,
        investedMarketValueKrw,
        valuationPathDifferenceKrw:
          investedMarketValueKrw - actual.totalMarketValueKrw,
        units,
        valuationPriceDate: valuation.priceDate,
        rawCloseUsd: valuation.rawCloseUsd,
        snapshotUsdKrw: valuation.snapshotUsdKrw,
        pendingBuyCashKrw,
        pendingSellObligationKrw,
        appliedFlowCount,
        comparisonBasis: hasPendingFlows
          ? "position_value_only_with_pending_flows"
          : "position_value_only",
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
    policy: INVESTMENT_LAB_VOO_PATH_POLICY,
    anchor: Object.freeze({
      serviceDate: anchor.serviceDate,
      actualMarketValueKrw: anchor.totalMarketValueKrw,
      valuationPriceDate: anchorValuation.priceDate,
      rawCloseUsd: anchorValuation.rawCloseUsd,
      snapshotUsdKrw: anchorValuation.snapshotUsdKrw,
      units: anchor.totalMarketValueKrw / anchorValuation.unitValueKrw,
    }),
    rows: Object.freeze(rows),
    appliedFlows: Object.freeze(appliedFlows),
    delayedExecutionRows: executions.filter(
      (row) => row.pendingCalendarDays > 0,
    ).length,
    pendingAtEnd: Object.freeze({
      flowCount: activePending.size,
      buyCashKrw: pendingBuyCashKrw,
      sellObligationKrw: pendingSellObligationKrw,
    }),
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
  row: InvestmentLabVooExecutionEvidence,
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
    row.eventDate <= row.executionPriceDate &&
    row.executionServiceDate ===
      mapRiskEvidenceDateToServiceDate(row.executionPriceDate) &&
    row.executionServiceDate > startServiceDate &&
    row.executionServiceDate <= endServiceDate &&
    positiveFinite(row.rawCloseUsd) &&
    positiveFinite(row.usdKrw) &&
    positiveFinite(row.unitPriceKrw) &&
    nearlyEqual(row.unitPriceKrw, row.rawCloseUsd * row.usdKrw) &&
    Number.isInteger(row.pendingCalendarDays) &&
    row.pendingCalendarDays >= 0 &&
    row.pendingCalendarDays <= 7 &&
    row.pendingCalendarDays ===
      riskCalendarDayDistance(row.eventDate, row.executionPriceDate)
  );
}

function compareEventOrder(
  left: InvestmentLabVooExecutionEvidence,
  right: InvestmentLabVooExecutionEvidence,
) {
  return (
    left.eventDate.localeCompare(right.eventDate) ||
    left.sequence - right.sequence ||
    left.sourceIndex - right.sourceIndex
  );
}

function compareExecutionOrder(
  left: InvestmentLabVooExecutionEvidence,
  right: InvestmentLabVooExecutionEvidence,
) {
  return (
    left.executionServiceDate.localeCompare(right.executionServiceDate) ||
    left.executionPriceDate.localeCompare(right.executionPriceDate) ||
    left.eventDate.localeCompare(right.eventDate) ||
    left.sequence - right.sequence ||
    left.sourceIndex - right.sourceIndex
  );
}

function isAmountProvenance(value: unknown) {
  return (
    value === "explicit_amount_krw" ||
    value === "derived_quantity_price_krw" ||
    value === "derived_quantity_price_fx"
  );
}

function blocker(
  reason: InvestmentLabVooPathBlocker["reason"],
  sourceIndex: number | null = null,
  serviceDate: string | null = null,
): InvestmentLabVooPathBlocker {
  return Object.freeze({ reason, sourceIndex, serviceDate });
}

function blocked(
  blockers: readonly InvestmentLabVooPathBlocker[],
): InvestmentLabVooPathResult {
  return Object.freeze({
    status: "blocked",
    policy: INVESTMENT_LAB_VOO_PATH_POLICY,
    anchor: null,
    rows: [] as const,
    appliedFlows: [] as const,
    delayedExecutionRows: 0,
    pendingAtEnd: Object.freeze({
      flowCount: 0 as const,
      buyCashKrw: 0 as const,
      sellObligationKrw: 0 as const,
    }),
    blockers: Object.freeze([...blockers]),
  });
}

function positiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function nearlyEqual(left: number, right: number) {
  return (
    Math.abs(left - right) <=
    Math.max(1, Math.abs(left), Math.abs(right)) * 1e-10
  );
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-10 ? 0 : value;
}
