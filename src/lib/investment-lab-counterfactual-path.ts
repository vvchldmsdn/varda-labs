import {
  applyInvestmentLabScheduledFlow,
  type InvestmentLabAdjustedClose,
  type InvestmentLabScheduledFlow,
} from "./investment-lab-execution-schedule.ts";
import {
  compareInvestmentLabEventOrder,
  compareInvestmentLabExecutionOrder,
  investmentLabValuationOnOrBefore,
  pathBlocker,
  prepareInvestmentLabCounterfactualPathInput,
} from "./investment-lab-counterfactual-path-input.ts";

export const INVESTMENT_LAB_PATH_POLICY = Object.freeze({
  version: "position_flow_counterfactual_v1",
  scenarioInstrumentKey: "korea:KRW:069500",
  comparisonBasis: "position_value_only",
  fractionalUnits: true,
  transactionCostsKrw: 0,
  maxValuationCarryDays: 7,
  cashflowAdjustedReturn: "deferred_until_cashflow_fixture",
} as const);

export type InvestmentLabActualPathPoint = Readonly<{
  serviceDate: string;
  totalMarketValueKrw: number;
}>;

export type InvestmentLabCounterfactualPathBlocker = Readonly<{
  reason:
    | "insufficient_actual_path"
    | "invalid_actual_date"
    | "invalid_actual_value"
    | "duplicate_actual_date"
    | "invalid_close_date"
    | "invalid_adjusted_close"
    | "duplicate_close_date"
    | "invalid_scheduled_flow"
    | "duplicate_flow_source_index"
    | "execution_policy_mismatch"
    | "execution_close_mismatch"
    | "invalid_valuation_carry_limit"
    | "missing_valuation_close"
    | "valuation_carry_limit_exceeded"
    | "scenario_insolvent";
  sourceIndex: number | null;
  serviceDate: string | null;
}>;

export function buildInvestmentLabCounterfactualPath(input: {
  actualPath: readonly InvestmentLabActualPathPoint[];
  closes: readonly InvestmentLabAdjustedClose[];
  scheduledFlows: readonly InvestmentLabScheduledFlow[];
  maxValuationCarryDays?: number;
}) {
  const prepared = prepareInvestmentLabCounterfactualPathInput(
    input,
    INVESTMENT_LAB_PATH_POLICY.maxValuationCarryDays,
  );
  const {
    actualPath,
    closes,
    scheduledFlows,
    maxValuationCarryDays,
    blockers,
  } = prepared;

  if (blockers.length > 0) return blockedPath(blockers);

  const anchor = actualPath[0];
  const endServiceDate = actualPath.at(-1)?.serviceDate ?? anchor.serviceDate;
  const anchorValuation = investmentLabValuationOnOrBefore(
    closes,
    anchor.serviceDate,
    maxValuationCarryDays,
    blockers,
  );
  if (!anchorValuation) return blockedPath(blockers);

  let units = anchor.totalMarketValueKrw / anchorValuation.row.adjustedClose;
  const inWindowFlows = scheduledFlows.filter(
    (flow) =>
      flow.eventDate > anchor.serviceDate &&
      flow.eventDate <= endServiceDate,
  );
  const flowsByEvent = [...inWindowFlows].sort(compareInvestmentLabEventOrder);
  const flowsByExecution = [...inWindowFlows].sort(
    compareInvestmentLabExecutionOrder,
  );
  const activePending = new Set<number>();
  const appliedFlows: Array<
    InvestmentLabScheduledFlow & Readonly<{ unitsAfter: number }>
  > = [];
  const rows = [];
  let eventIndex = 0;
  let executionIndex = 0;
  let pendingBuyCashKrw = 0;
  let pendingSellObligationKrw = 0;

  for (const actual of actualPath) {
    while (
      eventIndex < flowsByEvent.length &&
      flowsByEvent[eventIndex].eventDate <= actual.serviceDate
    ) {
      const flow = flowsByEvent[eventIndex];
      activePending.add(flow.sourceIndex);
      if (flow.direction === "inflow") {
        pendingBuyCashKrw += flow.amountKrw;
      } else {
        pendingSellObligationKrw += flow.amountKrw;
      }
      eventIndex += 1;
    }

    let appliedFlowCount = 0;
    while (
      executionIndex < flowsByExecution.length &&
      flowsByExecution[executionIndex].executionServiceDate <=
        actual.serviceDate
    ) {
      const flow = flowsByExecution[executionIndex];
      const applied = applyInvestmentLabScheduledFlow(units, flow);
      if (applied.status === "blocked") {
        return blockedPath([
          pathBlocker(
            applied.reason === "scenario_insolvent"
              ? "scenario_insolvent"
              : "invalid_scheduled_flow",
            flow.sourceIndex,
            flow.executionServiceDate,
          ),
        ]);
      }

      units = applied.units;
      appliedFlows.push({ ...flow, unitsAfter: units });
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

    const valuation = investmentLabValuationOnOrBefore(
      closes,
      actual.serviceDate,
      maxValuationCarryDays,
      blockers,
    );
    if (!valuation) return blockedPath(blockers);

    const investedMarketValueKrw = units * valuation.row.adjustedClose;
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
        valuationPriceDate: valuation.row.priceDate,
        adjustedClose: valuation.row.adjustedClose,
        valuationCarryDays: valuation.carryDays,
        pendingBuyCashKrw,
        pendingSellObligationKrw,
        appliedFlowCount,
        comparisonBasis: hasPendingFlows
          ? "position_value_only_with_pending_flows"
          : "position_value_only",
      }),
    );
  }

  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_PATH_POLICY,
    scenarioInstrumentKey: INVESTMENT_LAB_PATH_POLICY.scenarioInstrumentKey,
    anchor: Object.freeze({
      serviceDate: anchor.serviceDate,
      actualMarketValueKrw: anchor.totalMarketValueKrw,
      valuationPriceDate: anchorValuation.row.priceDate,
      adjustedClose: anchorValuation.row.adjustedClose,
      units: anchor.totalMarketValueKrw / anchorValuation.row.adjustedClose,
    }),
    rows: Object.freeze(rows),
    appliedFlows: Object.freeze(appliedFlows),
    ignoredFlows: Object.freeze({
      throughAnchor: scheduledFlows.filter(
        (flow) => flow.eventDate <= anchor.serviceDate,
      ).length,
      afterWindow: scheduledFlows.filter(
        (flow) => flow.eventDate > endServiceDate,
      ).length,
    }),
    pendingAtEnd: Object.freeze({
      flowCount: activePending.size,
      buyCashKrw: pendingBuyCashKrw,
      sellObligationKrw: pendingSellObligationKrw,
    }),
    blockers: Object.freeze([]),
  } as const);
}

function blockedPath(blockers: InvestmentLabCounterfactualPathBlocker[]) {
  return Object.freeze({
    status: "blocked",
    policy: INVESTMENT_LAB_PATH_POLICY,
    scenarioInstrumentKey: INVESTMENT_LAB_PATH_POLICY.scenarioInstrumentKey,
    anchor: null,
    rows: Object.freeze([]),
    appliedFlows: Object.freeze([]),
    ignoredFlows: Object.freeze({ throughAnchor: 0, afterWindow: 0 }),
    pendingAtEnd: Object.freeze({
      flowCount: 0,
      buyCashKrw: 0,
      sellObligationKrw: 0,
    }),
    blockers: Object.freeze([...blockers]),
  } as const);
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-6 ? 0 : value;
}
