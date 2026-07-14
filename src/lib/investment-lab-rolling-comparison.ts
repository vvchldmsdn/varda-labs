import {
  buildInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadInput,
  type InvestmentLabCounterfactualReadModel,
} from "./investment-lab-counterfactual-read-model.ts";
import {
  sliceInvestmentLabCounterfactualInput,
  type InvestmentLabPeriodSelection,
} from "./investment-lab-period-selection.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";

export const INVESTMENT_LAB_ROLLING_COMPARISON_POLICY = Object.freeze({
  version: "observed_same_flow_rolling_v1",
  observationCount: 10,
  rankingBasis: "actual_cashflow_adjusted_estimated_return",
  incompleteWindowTreatment: "exclude_entire_window",
} as const);

export type InvestmentLabRollingWindow = Readonly<{
  startServiceDate: string;
  endServiceDate: string;
  observationCount: number;
  actualReturn: number;
  kodex200Return: number;
  vooReturn: number;
  kodex200DifferencePercentagePoints: number;
  vooDifferencePercentagePoints: number;
  actualEndValueKrw: number;
  kodex200EndValueKrw: number;
  vooEndValueKrw: number;
  actualFlowCount: number;
  kodex200FlowCount: number;
  vooFlowCount: number;
}>;

export type InvestmentLabRollingComparison = Readonly<{
  status: "ready" | "unavailable";
  policy: typeof INVESTMENT_LAB_ROLLING_COMPARISON_POLICY;
  availableStartServiceDate: string | null;
  availableEndServiceDate: string | null;
  candidateWindowCount: number;
  completeWindowCount: number;
  excludedWindowCount: number;
  bestWindow: InvestmentLabRollingWindow | null;
  worstWindow: InvestmentLabRollingWindow | null;
  reason: "insufficient_observations" | "insufficient_complete_windows" | null;
}>;

export function buildInvestmentLabRollingComparison(input: {
  source: InvestmentLabCounterfactualReadInput;
  availableServiceDates: readonly string[];
}): InvestmentLabRollingComparison {
  const serviceDates = uniqueSortedRiskDates(input.availableServiceDates);
  const observationCount =
    INVESTMENT_LAB_ROLLING_COMPARISON_POLICY.observationCount;
  const candidateWindowCount = Math.max(
    0,
    serviceDates.length - observationCount + 1,
  );
  const base = {
    policy: INVESTMENT_LAB_ROLLING_COMPARISON_POLICY,
    availableStartServiceDate: serviceDates[0] ?? null,
    availableEndServiceDate: serviceDates.at(-1) ?? null,
    candidateWindowCount,
  } as const;

  if (candidateWindowCount === 0) {
    return unavailable(base, 0, "insufficient_observations");
  }

  const completeWindows: InvestmentLabRollingWindow[] = [];
  for (let index = 0; index < candidateWindowCount; index += 1) {
    const windowDates = serviceDates.slice(index, index + observationCount);
    const startServiceDate = windowDates[0];
    const endServiceDate = windowDates.at(-1)!;
    const selection = selectedPeriod(
      startServiceDate,
      endServiceDate,
      base.availableStartServiceDate,
      base.availableEndServiceDate,
    );
    const model = buildInvestmentLabCounterfactualReadModel(
      sliceInvestmentLabCounterfactualInput(input.source, selection),
    );
    const window = completeWindow(model, {
      startServiceDate,
      endServiceDate,
      observationCount,
    });
    if (window) completeWindows.push(window);
  }

  if (completeWindows.length < 2) {
    return unavailable(
      base,
      completeWindows.length,
      "insufficient_complete_windows",
    );
  }

  const worstWindow = [...completeWindows].sort(compareWorstFirst)[0];
  const bestWindow = [...completeWindows].sort(compareBestFirst)[0];

  return Object.freeze({
    ...base,
    status: "ready" as const,
    completeWindowCount: completeWindows.length,
    excludedWindowCount: candidateWindowCount - completeWindows.length,
    bestWindow,
    worstWindow,
    reason: null,
  });
}

function completeWindow(
  model: InvestmentLabCounterfactualReadModel,
  expected: {
    startServiceDate: string;
    endServiceDate: string;
    observationCount: number;
  },
): InvestmentLabRollingWindow | null {
  if (
    model.status !== "ready" ||
    !model.summary ||
    model.summary.startServiceDate !== expected.startServiceDate ||
    model.summary.endServiceDate !== expected.endServiceDate ||
    model.summary.comparisonDateCount !== expected.observationCount ||
    model.rows.length !== expected.observationCount ||
    model.returnEstimate?.status !== "ready" ||
    model.vooComparison?.status !== "ready" ||
    model.vooComparison.returnEstimate.status !== "ready" ||
    model.vooComparison.summary.startServiceDate !== expected.startServiceDate ||
    model.vooComparison.summary.endServiceDate !== expected.endServiceDate ||
    model.vooComparison.summary.comparisonDateCount !== expected.observationCount
  ) {
    return null;
  }

  const actualReturn = model.returnEstimate.actualReturn;
  const vooActualReturn = model.vooComparison.returnEstimate.actualReturn;
  const values = [
    actualReturn,
    model.returnEstimate.scenarioReturn,
    model.vooComparison.returnEstimate.scenarioReturn,
    model.summary.actualEndValueKrw,
    model.summary.scenarioEndValueKrw,
    model.vooComparison.summary.scenarioEndValueKrw,
  ];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    Math.abs(actualReturn - vooActualReturn) > 1e-10
  ) {
    return null;
  }

  return Object.freeze({
    startServiceDate: expected.startServiceDate,
    endServiceDate: expected.endServiceDate,
    observationCount: expected.observationCount,
    actualReturn,
    kodex200Return: model.returnEstimate.scenarioReturn,
    vooReturn: model.vooComparison.returnEstimate.scenarioReturn,
    kodex200DifferencePercentagePoints:
      model.returnEstimate.differencePercentagePoints,
    vooDifferencePercentagePoints:
      model.vooComparison.returnEstimate.differencePercentagePoints,
    actualEndValueKrw: model.summary.actualEndValueKrw,
    kodex200EndValueKrw: model.summary.scenarioEndValueKrw,
    vooEndValueKrw: model.vooComparison.summary.scenarioEndValueKrw,
    actualFlowCount: model.returnEstimate.actualFlowCount,
    kodex200FlowCount: model.returnEstimate.scenarioFlowCount,
    vooFlowCount: model.vooComparison.returnEstimate.scenarioFlowCount,
  });
}

function selectedPeriod(
  startServiceDate: string,
  endServiceDate: string,
  availableStartServiceDate: string | null,
  availableEndServiceDate: string | null,
): InvestmentLabPeriodSelection {
  return Object.freeze({
    status: "selected" as const,
    requestedStartServiceDate: startServiceDate,
    requestedEndServiceDate: endServiceDate,
    selectedStartServiceDate: startServiceDate,
    selectedEndServiceDate: endServiceDate,
    availableStartServiceDate,
    availableEndServiceDate,
    reason: null,
  });
}

function uniqueSortedRiskDates(values: readonly string[]) {
  return [...new Set(values.filter(isRiskDate))].sort();
}

function compareWorstFirst(
  left: InvestmentLabRollingWindow,
  right: InvestmentLabRollingWindow,
) {
  return (
    left.actualReturn - right.actualReturn ||
    left.startServiceDate.localeCompare(right.startServiceDate)
  );
}

function compareBestFirst(
  left: InvestmentLabRollingWindow,
  right: InvestmentLabRollingWindow,
) {
  return (
    right.actualReturn - left.actualReturn ||
    left.startServiceDate.localeCompare(right.startServiceDate)
  );
}

function unavailable(
  base: Readonly<{
    policy: typeof INVESTMENT_LAB_ROLLING_COMPARISON_POLICY;
    availableStartServiceDate: string | null;
    availableEndServiceDate: string | null;
    candidateWindowCount: number;
  }>,
  completeWindowCount: number,
  reason: "insufficient_observations" | "insufficient_complete_windows",
): InvestmentLabRollingComparison {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    completeWindowCount,
    excludedWindowCount: base.candidateWindowCount - completeWindowCount,
    bestWindow: null,
    worstWindow: null,
    reason,
  });
}
