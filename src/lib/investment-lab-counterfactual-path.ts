import {
  applyInvestmentLabUnitFlow,
  type InvestmentLabAdjustedClose,
  type InvestmentLabScheduledFlow,
  type InvestmentLabScheduledMoneyFlow,
  type InvestmentLabMoneyFlow,
  type InvestmentLabPendingMoneyFlow,
  scheduleInvestmentLabMoneyFlows,
} from "./investment-lab-execution-schedule.ts";
import { Decimal, isCurrency, type Currency } from "./money.ts";
import { convertMoney, selectValuationFxAt, type FxEvidence } from "./currency-valuation.ts";
import { calculateCurrencyModifiedDietz, type PortfolioCashFlow } from "./currency-performance.ts";
import { resolveSnapshotCycle } from "./snapshots/market-calendar.ts";
import { shiftRiskDate, isRiskDate } from "./portfolio-risk-calendar.ts";
import type { CurrencyResearchHistory } from "./currency-research.ts";
import {
  compareInvestmentLabEventOrder,
  compareInvestmentLabExecutionOrder,
  investmentLabValuationOnOrBefore,
  pathBlocker,
  prepareInvestmentLabUnitPathInput,
  type InvestmentLabValuePoint,
} from "./investment-lab-counterfactual-path-input.ts";

export const INVESTMENT_LAB_PATH_POLICY = Object.freeze({
  version: "position_flow_counterfactual_v1",
  scenarioInstrumentKey: "korea:KRW:069500",
  comparisonBasis: "position_value_only",
  fractionalUnits: true,
  transactionCostsKrw: 0,
  maxValuationCarryDays: 7,
  cashflowAdjustedReturn:
    "separate_modified_dietz_daily_weighted_eod_v1",
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

/** Legacy KRW DTO remains unchanged; both entrypoints use one execution core. */
export function buildInvestmentLabCounterfactualPath(input: {
  actualPath: readonly InvestmentLabActualPathPoint[];
  closes: readonly InvestmentLabAdjustedClose[];
  scheduledFlows: readonly InvestmentLabScheduledFlow[];
  maxValuationCarryDays?: number;
}) {
  const result = buildInvestmentLabUnitCounterfactualPath({ ...input,
    actualPath: input.actualPath.map(({ totalMarketValueKrw, ...row }) => ({ ...row, totalValue: totalMarketValueKrw })),
    scheduledFlows: input.scheduledFlows.map(({ amountKrw, ...row }) => ({ ...row, amount: amountKrw })),
  });
  const anchor = result.anchor ? { serviceDate: result.anchor.serviceDate, actualMarketValueKrw: result.anchor.actualValue, valuationPriceDate: result.anchor.valuationPriceDate, adjustedClose: result.anchor.adjustedClose, units: result.anchor.units } : null;
  const mapped = { ...result, anchor,
    rows: Object.freeze(result.rows.map(({ actualValue, investedValue, valuationPathDifference, pendingBuyCash, pendingSellObligation, ...row }) => ({ ...row, actualMarketValueKrw: actualValue, investedMarketValueKrw: investedValue, valuationPathDifferenceKrw: valuationPathDifference, pendingBuyCashKrw: pendingBuyCash, pendingSellObligationKrw: pendingSellObligation }))),
    appliedFlows: Object.freeze(result.appliedFlows.map(({ amount, ...row }) => ({ ...row, amountKrw: amount, amountProvenance: row.amountProvenance as InvestmentLabScheduledFlow["amountProvenance"] }))),
    pendingAtEnd: Object.freeze({ flowCount: result.pendingAtEnd.flowCount, buyCashKrw: result.pendingAtEnd.buyCash, sellObligationKrw: result.pendingAtEnd.sellObligation }),
  };
  return result.status === "ready" ? Object.freeze({ ...mapped, status: "ready" as const, anchor: anchor! }) : Object.freeze({ ...mapped, status: "blocked" as const, anchor: null });
}

export function buildInvestmentLabUnitCounterfactualPath(input: {
  actualPath: readonly InvestmentLabValuePoint[];
  closes: readonly InvestmentLabAdjustedClose[];
  scheduledFlows: readonly InvestmentLabScheduledMoneyFlow[];
  pendingFlows?: readonly InvestmentLabPendingMoneyFlow[];
  maxValuationCarryDays?: number;
  allowZeroValuations?: boolean;
  valuationPrices?: readonly { at: string; price: number }[];
}) {
  const prepared = prepareInvestmentLabUnitPathInput(
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
  const valuationPrices = new Map((input.valuationPrices ?? []).map(row => [row.at, row.price]));
  if (input.valuationPrices && (valuationPrices.size !== input.valuationPrices.length || valuationPrices.size !== actualPath.length || actualPath.some(row => !row.at || !Number.isFinite(valuationPrices.get(row.at)) || valuationPrices.get(row.at)! <= 0))) blockers.push(pathBlocker("invalid_adjusted_close", null, null));

  const pendingFlows = input.pendingFlows ?? [];
  const seen = new Set(scheduledFlows.map(flow => flow.sourceIndex));
  for (const flow of pendingFlows) {
    if (!isRiskDate(flow.eventDate) || !Number.isFinite(Date.parse(flow.eventAt ?? "")) || !Number.isSafeInteger(flow.sourceIndex) || flow.sourceIndex < 0 || seen.has(flow.sourceIndex) || !Number.isSafeInteger(flow.sequence) || flow.sequence < 0 || !["inflow", "outflow"].includes(flow.direction) || !Number.isFinite(flow.amount) || flow.amount <= 0 || flow.amountProvenance !== "dated_reporting_money") blockers.push(pathBlocker("invalid_scheduled_flow", flow.sourceIndex, flow.eventDate));
    seen.add(flow.sourceIndex);
  }

  if (blockers.length > 0) return blockedPath(blockers);

  const anchor = actualPath[0];
  if (anchor.totalValue <= 0) return blockedPath([pathBlocker("invalid_actual_value", null, anchor.serviceDate)]);
  const endServiceDate = actualPath.at(-1)?.serviceDate ?? anchor.serviceDate;
  const anchorValuation = investmentLabValuationOnOrBefore(
    closes,
    anchor.serviceDate,
    maxValuationCarryDays,
    blockers,
  );
  if (!anchorValuation) return blockedPath(blockers);

  const anchorPrice = anchor.at ? valuationPrices.get(anchor.at) ?? anchorValuation.row.adjustedClose : anchorValuation.row.adjustedClose;
  let units = anchor.totalValue / anchorPrice;
  const inWindowFlows = scheduledFlows.filter(
    (flow) =>
      (anchor.at && flow.eventAt ? Date.parse(flow.eventAt) > Date.parse(anchor.at) || (anchor.boundary === "before" && Date.parse(flow.eventAt) === Date.parse(anchor.at)) : flow.eventDate > anchor.serviceDate) &&
      flow.eventDate <= endServiceDate,
  );
  const flowsByEvent = [...inWindowFlows, ...pendingFlows.filter(flow => anchor.at && (Date.parse(flow.eventAt!) > Date.parse(anchor.at) || (anchor.boundary === "before" && Date.parse(flow.eventAt!) === Date.parse(anchor.at))) && flow.eventDate <= endServiceDate)].sort(compareInvestmentLabEventOrder);
  const flowsByExecution = [...inWindowFlows].sort(
    compareInvestmentLabExecutionOrder,
  );
  const activePending = new Set<number>();
  const appliedFlows: Array<
    InvestmentLabScheduledMoneyFlow & Readonly<{ unitsAfter: number }>
  > = [];
  const rows = [];
  let eventIndex = 0;
  let executionIndex = 0;
  let pendingBuyCash = 0;
  let pendingSellObligation = 0;

  for (const actual of actualPath) {
    while (
      eventIndex < flowsByEvent.length &&
      flowsByEvent[eventIndex].eventDate <= actual.serviceDate &&
      (!actual.at || !flowsByEvent[eventIndex].eventAt || (Date.parse(flowsByEvent[eventIndex].eventAt!) < Date.parse(actual.at) || (actual.boundary !== "before" && Date.parse(flowsByEvent[eventIndex].eventAt!) === Date.parse(actual.at))))
    ) {
      const flow = flowsByEvent[eventIndex];
      activePending.add(flow.sourceIndex);
      if (flow.direction === "inflow") {
        pendingBuyCash += flow.amount;
      } else {
        pendingSellObligation += flow.amount;
      }
      eventIndex += 1;
    }

    let appliedFlowCount = 0;
    while (
      executionIndex < flowsByExecution.length &&
      flowsByExecution[executionIndex].executionServiceDate <=
        actual.serviceDate &&
      (!actual.at || Date.parse(`${flowsByExecution[executionIndex].executionServiceDate}T07:00:00+09:00`) < Date.parse(actual.at) || (actual.boundary !== "before" && Date.parse(`${flowsByExecution[executionIndex].executionServiceDate}T07:00:00+09:00`) === Date.parse(actual.at)))
    ) {
      const flow = flowsByExecution[executionIndex];
      const applied = applyInvestmentLabUnitFlow(units, flow);
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
          pendingBuyCash = cleanZero(
            pendingBuyCash - flow.amount,
          );
        } else {
          pendingSellObligation = cleanZero(
            pendingSellObligation - flow.amount,
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

    const valuationPrice = actual.at ? valuationPrices.get(actual.at) ?? valuation.row.adjustedClose : valuation.row.adjustedClose;
    const investedValue = units * valuationPrice;
    const hasPendingFlows =
      pendingBuyCash > 1e-6 || pendingSellObligation > 1e-6;

    rows.push(
      Object.freeze({
        serviceDate: actual.serviceDate,
        ...(actual.at ? { at: actual.at } : {}),
        actualValue: actual.totalValue,
        investedValue,
        valuationPathDifference:
          investedValue - actual.totalValue,
        units,
        valuationPriceDate: valuation.row.priceDate,
        adjustedClose: valuationPrice,
        valuationCarryDays: valuation.carryDays,
        pendingBuyCash,
        pendingSellObligation,
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
      actualValue: anchor.totalValue,
      valuationPriceDate: anchorValuation.row.priceDate,
      adjustedClose: anchorPrice,
      units: anchor.totalValue / anchorPrice,
    }),
    rows: Object.freeze(rows),
    appliedFlows: Object.freeze(appliedFlows),
    ignoredFlows: Object.freeze({
      throughAnchor: scheduledFlows.filter(
        (flow) => anchor.at && flow.eventAt ? Date.parse(flow.eventAt) <= Date.parse(anchor.at) : flow.eventDate <= anchor.serviceDate,
      ).length,
      afterWindow: scheduledFlows.filter(
        (flow) => flow.eventDate > endServiceDate,
      ).length,
    }),
    pendingAtEnd: Object.freeze({
      flowCount: activePending.size,
      buyCash: pendingBuyCash,
      sellObligation: pendingSellObligation,
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
      buyCash: 0,
      sellObligation: 0,
    }),
    blockers: Object.freeze([...blockers]),
  } as const);
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-6 ? 0 : value;
}

export type CurrencyCounterfactualEvidence = Readonly<{
  reportingCurrency: Currency; asOf: string; complete: boolean;
  actualPath: readonly { at: string; totalValue: string; boundary?: "before" }[];
  externalFlows: readonly { id: string; at: string; amount: string; currency: Currency; direction: "inflow" | "outflow" }[];
}>;
export const CURRENCY_COUNTERFACTUAL_POLICY = Object.freeze({
  version: "native_portfolio_same_external_flow_v1", executionPolicy: "eod_admitted_close_on_or_after_v2",
  comparisonBasis: "portfolio_including_cash", initialAllocation: "all_initial_wealth_in_explicit_selected_instrument",
  pendingCash: "reporting_currency_no_interest", valuationFx: "each_actual_capture_with_frozen_pair_preference", fractionalUnits: true, costs: "excluded_from_hypothetical",
  distributions: "price_return_without_dividend_reinvestment", returnMethod: "observed_timestamp_modified_dietz_v1",
  recommendation: "none", persistence: "none",
} as const);

/** Same unit execution core as the legacy path, with an explicit full-portfolio
 * boundary and dated reporting money. No USD amount enters a legacy KRW DTO. */
export function buildCurrencyInvestmentLabCounterfactual(input: {
  evidence: CurrencyCounterfactualEvidence; scenario: CurrencyResearchHistory;
  fx: readonly FxEvidence[]; maxFxAgeMs: number;
}) {
  const { evidence, scenario, fx, maxFxAgeMs } = input;
  const blocked = (reason: string) => ({ status: "blocked" as const, reason, policy: CURRENCY_COUNTERFACTUAL_POLICY, reportingCurrency: evidence.reportingCurrency, scenarioInstrumentId: scenario.instrumentId, rows: [], actualReturnPct: null, alternativeReturnPct: null, returnDifferencePct: null });
  if (!evidence.complete || !isCurrency(evidence.reportingCurrency) || !Number.isFinite(Date.parse(evidence.asOf)) || Date.parse(evidence.asOf) > Date.now()) return blocked("actual_portfolio_evidence_incomplete");
  const historicalFx = fx.filter(row => row.kind === "daily_reference" || row.kind === "historical_spot");
  const points = scenario.points;
  const expectedActions = ["provider_adjusted", "normalized_provider_raw"].includes(scenario.admission) ? "verified_split_adjusted" : "verified_no_actions";
  if (!["shared_kis_raw", "provider_adjusted", "normalized_provider_raw"].includes(scenario.admission) || !scenario.source.trim() || !points.length || !scenario.corporateActions || scenario.corporateActions.status !== expectedActions || !scenario.corporateActions.source.trim() ||
    !Number.isFinite(Date.parse(scenario.corporateActions.from)) || !Number.isFinite(Date.parse(scenario.corporateActions.through)) ||
    Date.parse(scenario.corporateActions.from) > Date.parse(points[0].at) || Date.parse(scenario.corporateActions.through) < Date.parse(points.at(-1)!.at)) return blocked("corporate_action_evidence_missing");
  if (points.some((point, index) => !Number.isFinite(Date.parse(point.at)) || Date.parse(point.at) > Date.parse(evidence.asOf) || (index > 0 && Date.parse(point.at) <= Date.parse(points[index - 1].at)) || point.currency !== points[0].currency || point.dataset !== points[0].dataset || !point.dataset || point.basis !== (expectedActions === "verified_split_adjusted" ? "split_adjusted" : "raw_price"))) return blocked("scenario_history_invalid");
  if (points.some(point => Date.parse(point.at) !== Date.parse(`${resolveSnapshotCycle(new Date(point.at)).snapshotDate}T07:00:00+09:00`))) return blocked("scenario_history_invalid");
  try {
    const actualPath: { at: string; serviceDate: string; totalValue: number; boundary?: "before" }[] = [];
    for (const row of evidence.actualPath) {
      if (!Number.isFinite(Date.parse(row.at)) || Date.parse(row.at) > Date.parse(evidence.asOf) || Decimal.from(row.totalValue).compare(0) < 0) return blocked("actual_portfolio_evidence_incomplete");
      const serviceDate = resolveSnapshotCycle(new Date(row.at)).snapshotDate;
      actualPath.push({ boundary: row.boundary, at: row.at, serviceDate, totalValue: Decimal.from(row.totalValue).toNumber() });
    }
    actualPath.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (actualPath.length < 2) return blocked("insufficient_actual_path");
    const first = actualPath[0], last = actualPath.at(-1)!;
    const closes = [];
    for (const point of points) {
      const converted = convertMoney(point.price, point.currency, evidence.reportingCurrency, point.at, selectValuationFxAt(point.at, evidence.asOf, fx, true), maxFxAgeMs);
      if (!converted.ok) return blocked(converted.reason);
      closes.push({ priceDate: shiftRiskDate(resolveSnapshotCycle(new Date(point.at)).snapshotDate, -1), adjustedClose: converted.value.toNumber() });
    }
    if (new Set(evidence.externalFlows.map(flow => flow.id)).size !== evidence.externalFlows.length) return blocked("duplicate_flow");
    const events: InvestmentLabMoneyFlow[] = [], flows: PortfolioCashFlow[] = [];
    for (const [sequence, flow] of evidence.externalFlows.entries()) {
      if (!flow.id || !Number.isFinite(Date.parse(flow.at)) || !["inflow", "outflow"].includes(flow.direction)) return blocked("invalid_flow");
      if ((Date.parse(flow.at) < Date.parse(first.at) || (first.boundary !== "before" && Date.parse(flow.at) === Date.parse(first.at))) || (Date.parse(flow.at) > Date.parse(last.at) || (last.boundary === "before" && Date.parse(flow.at) === Date.parse(last.at)))) continue;
      const converted = convertMoney(flow.amount, flow.currency, evidence.reportingCurrency, flow.at, historicalFx, maxFxAgeMs);
      if (!converted.ok) return blocked(converted.reason);
      const amount = converted.value.toNumber();
      const eventDate = resolveSnapshotCycle(new Date(flow.at)).snapshotDate;
      events.push({ eventDate, eventAt: flow.at, sequence, direction: flow.direction, amount, amountProvenance: "dated_reporting_money" as const });
      flows.push({ id: flow.id, at: flow.at, serviceDate: eventDate, amount: String(amount), currency: evidence.reportingCurrency, source: "native_external_flow", kind: flow.direction === "inflow" ? "external_in" as const : "external_out" as const });
    }
    const schedule = scheduleInvestmentLabMoneyFlows({ events, closes, windowEndPriceDate: shiftRiskDate(last.serviceDate, -1), allowPendingAtWindowEnd: true });
    if (schedule.status !== "ready") return blocked(schedule.blockers[0]?.reason ?? "execution_schedule_unavailable");
    const valuationPrices = [];
    for (const actual of actualPath) {
      const native = points.findLast(point => Date.parse(point.at) <= Date.parse(actual.at));
      if (!native) return blocked("missing_valuation_close");
      const converted = convertMoney(native.price, native.currency, evidence.reportingCurrency, actual.at, selectValuationFxAt(actual.at, evidence.asOf, fx, actual.at !== evidence.asOf), maxFxAgeMs);
      if (!converted.ok) return blocked(converted.reason);
      valuationPrices.push({ at: actual.at, price: converted.value.toNumber() });
    }
    const path = buildInvestmentLabUnitCounterfactualPath({ actualPath, closes, scheduledFlows: schedule.scheduledFlows, pendingFlows: schedule.pendingFlows, valuationPrices, allowZeroValuations: true });
    if (path.status !== "ready") return blocked(path.blockers[0]?.reason ?? "counterfactual_path_unavailable");
    const rows = path.rows.map(row => ({ at: row.at!, serviceDate: row.serviceDate, actualValue: row.actualValue,
      alternativeValue: row.investedValue + row.pendingBuyCash - row.pendingSellObligation, pendingCash: row.pendingBuyCash, pendingWithdrawal: row.pendingSellObligation }));
    const returns = (side: "actualValue" | "alternativeValue") => calculateCurrencyModifiedDietz({ reporting: evidence.reportingCurrency, cashFlowEvidence: "complete", fx: [], maxFxAgeMs,
      valuations: rows.map(row => ({ boundary: actualPath.find(point => point.at === row.at)?.boundary, at: row.at, serviceDate: row.serviceDate, amount: String(row[side]), currency: evidence.reportingCurrency, source: "native_same_flow_counterfactual" })), flows });
    const actual = returns("actualValue"), alternative = returns("alternativeValue");
    if (actual.status !== "ready" || alternative.status !== "ready") return blocked("cash_flow_return_unavailable");
    return { status: "ready" as const, reason: null, policy: CURRENCY_COUNTERFACTUAL_POLICY, reportingCurrency: evidence.reportingCurrency, scenarioInstrumentId: scenario.instrumentId, rows,
      actualReturnPct: actual.totalReturn * 100, alternativeReturnPct: alternative.totalReturn * 100, returnDifferencePct: (alternative.totalReturn - actual.totalReturn) * 100 };
  } catch { return blocked("invalid_counterfactual_evidence"); }
}
