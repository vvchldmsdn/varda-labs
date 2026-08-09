import type { InvestmentLabAnchorSelection } from "./investment-lab-anchor-basket-anchor.ts";
import type {
  InvestmentLabAnchorComponentEvidence,
  InvestmentLabAnchorEvidenceBlocker,
  InvestmentLabAnchorEvidenceResolution,
} from "./investment-lab-anchor-basket-evidence.ts";
import type { InvestmentLabActualPathPoint } from "./investment-lab-counterfactual-path.ts";
import {
  calculateInvestmentLabModifiedDietz,
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
  type InvestmentLabModifiedDietzPeriod,
  type InvestmentLabReturnFlow,
} from "./investment-lab-modified-dietz.ts";
import type { InvestmentLabPathRiskMetrics } from "./investment-lab-path-risk.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";

export const INVESTMENT_LAB_ANCHOR_SCHEDULED_REBALANCE_POLICY = Object.freeze({
  version: "anchor_listed_sleeve_monthly_rebalance_same_flow_v1",
  cadence: "first_comparison_service_date_of_new_kst_calendar_month",
  executionOrder: "due_external_flow_legs_then_rebalance",
  pendingFlowHandling: "defer_rebalance_until_no_active_pending_flow_leg",
  subsequentFlowAllocation: "listed_sleeve_target_weights",
  manualValuation:
    "fixed_anchor_units_excluded_from_rebalance_and_external_flow_allocation",
  rebalancing: "costless_fractional_units",
  transactionCostsKrw: 0,
  taxKrw: 0,
  fxSpreadKrw: 0,
  shortSelling: "forbidden_fail_closed",
  partialPath: "forbidden",
} as const);

export type InvestmentLabAnchorScheduledMode =
  | "current_weight_monthly"
  | "equal_weight_monthly";

export type InvestmentLabAnchorScheduledBlocker = Readonly<{
  reason:
    | "anchor_selection_unavailable"
    | "evidence_unavailable"
    | "invalid_actual_path"
    | "component_axis_mismatch"
    | "invalid_component_valuation"
    | "no_listed_rebalance_sleeve"
    | "invalid_anchor_allocation"
    | "flow_evidence_mismatch"
    | "scenario_insolvent"
    | "unfinished_path"
    | "invalid_scenario_value"
    | "scenario_return_unavailable"
    | "account_composition_incomplete"
    | "account_composition_mismatch";
  instrumentKey: string | null;
  detail: string | null;
}>;

export type InvestmentLabAnchorScheduledRebalanceScenario = Readonly<{
  status: "ready" | "unavailable";
  mode: InvestmentLabAnchorScheduledMode;
  policy: typeof INVESTMENT_LAB_ANCHOR_SCHEDULED_REBALANCE_POLICY;
  anchor: InvestmentLabAnchorSelection;
  weights: readonly Readonly<{
    instrumentKey: string;
    label: string;
    rebalanceEligible: boolean;
    targetListedSleeveWeight: number | null;
  }>[];
  summary: Readonly<{
    startServiceDate: string;
    endServiceDate: string;
    instrumentCount: number;
    listedInstrumentCount: number;
    fixedManualInstrumentCount: number;
    allocationBasis:
      | "single_scope_current_weight_monthly"
      | "single_scope_equal_weight_monthly"
      | "named_account_current_weight_monthly_then_sum"
      | "named_account_equal_weight_monthly_then_sum";
    rebalanceCount: number;
    deferredRebalanceCount: number;
    actualEndValueKrw: number;
    scenarioEndValueKrw: number;
    endDifferenceKrw: number;
    comparisonDateCount: number;
  }> | null;
  returnEstimate: Readonly<{
    method: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
    actualReturn: number;
    scenarioReturn: number;
    differencePercentagePoints: number;
    actualPeriods: readonly InvestmentLabModifiedDietzPeriod[];
    scenarioPeriods: readonly InvestmentLabModifiedDietzPeriod[];
    scenarioRiskMetrics: InvestmentLabPathRiskMetrics;
  }> | null;
  rows: readonly Readonly<{
    serviceDate: string;
    actualMarketValueKrw: number;
    scenarioMarketValueKrw: number;
    differenceKrw: number;
    hasPendingExecution: boolean;
    rebalanced: boolean;
  }>[];
  coverage: Readonly<{
    componentCount: number;
    listedComponentCount: number;
    fixedManualComponentCount: number;
    sourceFlowCount: number;
    scenarioFlowLegCount: number;
    splitExecutionDateRows: number;
    delayedExecutionLegs: number;
    pendingComparisonRows: number;
    rebalanceCount: number;
    deferredRebalanceCount: number;
    manualObservationRows: number;
    manualCarryRows: number;
  }>;
  evidenceBlockers: readonly InvestmentLabAnchorEvidenceBlocker[];
  blockers: readonly InvestmentLabAnchorScheduledBlocker[];
}>;

type ReadyComponent = InvestmentLabAnchorComponentEvidence &
  Readonly<{ targetWeight: number }>;

type FlowLeg = Readonly<{
  componentKey: string;
  sourceIndex: number;
  eventDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
  executionServiceDate: string;
  unitPriceKrw: number;
  pendingCalendarDays: number;
}>;

export function buildInvestmentLabAnchorScheduledRebalanceScenario(
  input: Readonly<{
    mode: InvestmentLabAnchorScheduledMode;
    anchor: InvestmentLabAnchorSelection;
    actualPath: readonly InvestmentLabActualPathPoint[];
    evidence: InvestmentLabAnchorEvidenceResolution | null;
    actualReturn: number | null;
    actualPeriods?: readonly InvestmentLabModifiedDietzPeriod[];
  }>,
): InvestmentLabAnchorScheduledRebalanceScenario {
  if (input.anchor.status !== "ready") {
    return unavailable(input, [blocker("anchor_selection_unavailable")]);
  }
  if (input.evidence?.status !== "ready") {
    return unavailable(
      input,
      [blocker("evidence_unavailable")],
      input.evidence?.blockers ?? [],
    );
  }
  if (!validActualPath(input.actualPath)) {
    return unavailable(input, [blocker("invalid_actual_path")]);
  }
  if (!componentsShareAxis(input.evidence.components, input.actualPath)) {
    return unavailable(input, [blocker("component_axis_mismatch")]);
  }
  const invalidValuation = input.evidence.components.find((component) =>
    component.valuations.some(
      (row) => !Number.isFinite(row.unitPriceKrw) || row.unitPriceKrw <= 0,
    ),
  );
  if (invalidValuation) {
    return unavailable(input, [
      blocker(
        "invalid_component_valuation",
        invalidValuation.instrument.key,
      ),
    ]);
  }

  const listed = input.evidence.components.filter(
    (component) => component.valuationBasis === "listed_close",
  );
  const manual = input.evidence.components.filter(
    (component) => component.valuationBasis === "stored_manual_valuation",
  );
  if (listed.length === 0) {
    return unavailable(input, [blocker("no_listed_rebalance_sleeve")]);
  }
  const listedAnchorValue = compensatedSum(
    listed.map((component) => component.instrument.storedMarketValueKrw),
  );
  const anchorValue = compensatedSum(
    input.evidence.components.map(
      (component) => component.instrument.storedMarketValueKrw,
    ),
  );
  if (!(anchorValue > 0) || !(listedAnchorValue > 0)) {
    return unavailable(input, [blocker("invalid_anchor_allocation")]);
  }

  const listedWithTargets: ReadyComponent[] = listed.map((component) => ({
    ...component,
    targetWeight:
      input.mode === "equal_weight_monthly"
        ? 1 / listed.length
        : component.instrument.storedMarketValueKrw / listedAnchorValue,
  }));
  if (
    listedWithTargets.some(
      (component) =>
        !Number.isFinite(component.targetWeight) || component.targetWeight < 0,
    ) ||
    !nearlyEqual(
      compensatedSum(listedWithTargets.map((row) => row.targetWeight)),
      1,
    )
  ) {
    return unavailable(input, [blocker("invalid_anchor_allocation")]);
  }

  const flowResolution = resolveFlowLegs(listedWithTargets);
  if (!flowResolution.ok) {
    return unavailable(input, [blocker("flow_evidence_mismatch")]);
  }

  const actualStartValue = input.actualPath[0].totalMarketValueKrw;
  const scale = actualStartValue / anchorValue;
  const fixedManualStartValue = compensatedSum(
    manual.map(
      (component) => component.instrument.storedMarketValueKrw * scale,
    ),
  );
  const listedStartValue = actualStartValue - fixedManualStartValue;
  if (!Number.isFinite(listedStartValue) || listedStartValue < -1e-6) {
    return unavailable(input, [blocker("invalid_anchor_allocation")]);
  }

  const units = new Map<string, number>();
  for (const component of listedWithTargets) {
    units.set(
      component.instrument.key,
      (Math.max(0, listedStartValue) * component.targetWeight) /
        component.valuations[0].unitPriceKrw,
    );
  }
  for (const component of manual) {
    units.set(
      component.instrument.key,
      (component.instrument.storedMarketValueKrw * scale) /
        component.valuations[0].unitPriceKrw,
    );
  }
  if ([...units.values()].some((value) => !nonNegativeFinite(value))) {
    return unavailable(input, [blocker("invalid_anchor_allocation")]);
  }

  const rows: InvestmentLabAnchorScheduledRebalanceScenario["rows"][number][] = [];
  const appliedFlows: InvestmentLabReturnFlow[] = [];
  const legs = flowResolution.legs;
  let legIndex = 0;
  let pendingRebalance = false;
  let rebalanceCount = 0;
  let deferredRebalanceCount = 0;

  for (let index = 0; index < input.actualPath.length; index += 1) {
    const actual = input.actualPath[index];
    while (
      legIndex < legs.length &&
      legs[legIndex].executionServiceDate <= actual.serviceDate
    ) {
      const leg = legs[legIndex];
      const currentUnits = units.get(leg.componentKey)!;
      if (
        leg.direction === "outflow" &&
        currentUnits * leg.unitPriceKrw + 1e-6 < leg.amountKrw
      ) {
        return unavailable(input, [
          blocker("scenario_insolvent", leg.componentKey, actual.serviceDate),
        ]);
      }
      const unitDelta = leg.amountKrw / leg.unitPriceKrw;
      const nextUnits =
        leg.direction === "inflow"
          ? currentUnits + unitDelta
          : cleanZero(currentUnits - unitDelta);
      if (!nonNegativeFinite(nextUnits)) {
        return unavailable(input, [
          blocker("scenario_insolvent", leg.componentKey, actual.serviceDate),
        ]);
      }
      units.set(leg.componentKey, nextUnits);
      appliedFlows.push(
        Object.freeze({
          effectiveServiceDate: leg.executionServiceDate,
          sequence: leg.sequence,
          direction: leg.direction,
          amountKrw: leg.amountKrw,
        }),
      );
      legIndex += 1;
    }

    const crossedMonth =
      index > 0 &&
      monthKey(input.actualPath[index - 1].serviceDate) !==
        monthKey(actual.serviceDate);
    if (crossedMonth) pendingRebalance = true;
    const hasPendingExecution = legs.some(
      (leg, pendingIndex) =>
        pendingIndex >= legIndex &&
        leg.eventDate <= actual.serviceDate &&
        leg.executionServiceDate > actual.serviceDate,
    );
    let rebalanced = false;
    if (pendingRebalance && !hasPendingExecution) {
      const listedValue = compensatedSum(
        listedWithTargets.map(
          (component) =>
            units.get(component.instrument.key)! *
            component.valuations[index].unitPriceKrw,
        ),
      );
      if (!nonNegativeFinite(listedValue)) {
        return unavailable(input, [blocker("invalid_scenario_value")]);
      }
      for (const component of listedWithTargets) {
        units.set(
          component.instrument.key,
          (listedValue * component.targetWeight) /
            component.valuations[index].unitPriceKrw,
        );
      }
      pendingRebalance = false;
      rebalanceCount += 1;
      rebalanced = true;
    } else if (crossedMonth && hasPendingExecution) {
      deferredRebalanceCount += 1;
    }

    const scenarioMarketValueKrw = compensatedSum(
      input.evidence.components.map(
        (component) =>
          units.get(component.instrument.key)! *
          component.valuations[index].unitPriceKrw,
      ),
    );
    if (!nonNegativeFinite(scenarioMarketValueKrw)) {
      return unavailable(input, [blocker("invalid_scenario_value")]);
    }
    rows.push(
      Object.freeze({
        serviceDate: actual.serviceDate,
        actualMarketValueKrw: actual.totalMarketValueKrw,
        scenarioMarketValueKrw,
        differenceKrw: scenarioMarketValueKrw - actual.totalMarketValueKrw,
        hasPendingExecution,
        rebalanced,
      }),
    );
  }

  if (legIndex !== legs.length) {
    return unavailable(input, [blocker("unfinished_path")]);
  }
  const scenarioReturn = calculateInvestmentLabModifiedDietz({
    valuations: rows.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row.scenarioMarketValueKrw,
    })),
    flows: appliedFlows,
  });
  const returnEstimate =
    input.actualReturn !== null &&
    Number.isFinite(input.actualReturn) &&
    scenarioReturn.status === "ready"
      ? Object.freeze({
          method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
          actualReturn: input.actualReturn,
          scenarioReturn: scenarioReturn.totalReturn,
          differencePercentagePoints:
            (scenarioReturn.totalReturn - input.actualReturn) * 100,
          actualPeriods: Object.freeze([...(input.actualPeriods ?? [])]),
          scenarioPeriods: scenarioReturn.periods,
          scenarioRiskMetrics: scenarioReturn.riskMetrics,
        })
      : null;
  const latest = rows.at(-1)!;
  const weights = Object.freeze(
    input.evidence.components.map((component) => {
      const listedComponent = listedWithTargets.find(
        (candidate) => candidate.instrument.key === component.instrument.key,
      );
      return Object.freeze({
        instrumentKey: component.instrument.key,
        label: component.instrument.label,
        rebalanceEligible: Boolean(listedComponent),
        targetListedSleeveWeight: listedComponent?.targetWeight ?? null,
      });
    }),
  );

  return Object.freeze({
    status: "ready" as const,
    mode: input.mode,
    policy: INVESTMENT_LAB_ANCHOR_SCHEDULED_REBALANCE_POLICY,
    anchor: input.anchor,
    weights,
    summary: Object.freeze({
      startServiceDate: rows[0].serviceDate,
      endServiceDate: latest.serviceDate,
      instrumentCount: input.evidence.components.length,
      listedInstrumentCount: listed.length,
      fixedManualInstrumentCount: manual.length,
      allocationBasis:
        input.mode === "equal_weight_monthly"
          ? ("single_scope_equal_weight_monthly" as const)
          : ("single_scope_current_weight_monthly" as const),
      rebalanceCount,
      deferredRebalanceCount,
      actualEndValueKrw: latest.actualMarketValueKrw,
      scenarioEndValueKrw: latest.scenarioMarketValueKrw,
      endDifferenceKrw: latest.differenceKrw,
      comparisonDateCount: rows.length,
    }),
    returnEstimate,
    rows: Object.freeze(rows),
    coverage: Object.freeze({
      componentCount: input.evidence.components.length,
      listedComponentCount: listed.length,
      fixedManualComponentCount: manual.length,
      sourceFlowCount: flowResolution.sourceFlowCount,
      scenarioFlowLegCount: legs.length,
      splitExecutionDateRows: flowResolution.splitExecutionDateRows,
      delayedExecutionLegs: legs.filter(
        (leg) => leg.pendingCalendarDays > 0,
      ).length,
      pendingComparisonRows: rows.filter((row) => row.hasPendingExecution)
        .length,
      rebalanceCount,
      deferredRebalanceCount,
      manualObservationRows: input.evidence.coverage.manualObservationRows,
      manualCarryRows: input.evidence.coverage.manualCarryRows,
    }),
    evidenceBlockers: [] as const,
    blockers: returnEstimate
      ? ([] as const)
      : ([blocker("scenario_return_unavailable")] as const),
  });
}

function resolveFlowLegs(components: readonly ReadyComponent[]) {
  const reference = new Map(
    components[0].executions.map((row) => [row.sourceIndex, row]),
  );
  if (reference.size !== components[0].executions.length) {
    return { ok: false as const };
  }
  for (const component of components.slice(1)) {
    const rows = new Map(component.executions.map((row) => [row.sourceIndex, row]));
    if (rows.size !== component.executions.length || rows.size !== reference.size) {
      return { ok: false as const };
    }
    for (const [sourceIndex, expected] of reference) {
      const actual = rows.get(sourceIndex);
      if (
        !actual ||
        actual.eventDate !== expected.eventDate ||
        actual.direction !== expected.direction ||
        actual.amountProvenance !== expected.amountProvenance ||
        !nearlyEqual(actual.amountKrw, expected.amountKrw)
      ) {
        return { ok: false as const };
      }
    }
  }

  const legs: readonly FlowLeg[] = components
    .flatMap((component, componentIndex) =>
      component.executions.flatMap((execution) => {
        const amountKrw = execution.amountKrw * component.targetWeight;
        if (amountKrw <= 1e-9) return [];
        return [
          Object.freeze({
            componentKey: component.instrument.key,
            sourceIndex: execution.sourceIndex,
            eventDate: execution.eventDate,
            sequence: execution.sourceIndex * components.length + componentIndex,
            direction: execution.direction,
            amountKrw,
            executionServiceDate: execution.executionServiceDate,
            unitPriceKrw: execution.unitPriceKrw,
            pendingCalendarDays: execution.pendingCalendarDays,
          }),
        ];
      }),
    )
    .sort(
      (left, right) =>
        left.executionServiceDate.localeCompare(right.executionServiceDate) ||
        left.sequence - right.sequence ||
        left.componentKey.localeCompare(right.componentKey),
    );
  const splitExecutionDateRows = [...reference.keys()].filter(
    (sourceIndex) =>
      new Set(
        legs
          .filter((leg) => leg.sourceIndex === sourceIndex)
          .map((leg) => leg.executionServiceDate),
      ).size > 1,
  ).length;
  return {
    ok: true as const,
    legs: Object.freeze(legs),
    sourceFlowCount: reference.size,
    splitExecutionDateRows,
  };
}

function validActualPath(rows: readonly InvestmentLabActualPathPoint[]) {
  return (
    rows.length >= 2 &&
    rows.every(
      (row, index) =>
        isRiskDate(row.serviceDate) &&
        Number.isFinite(row.totalMarketValueKrw) &&
        row.totalMarketValueKrw > 0 &&
        (index === 0 || rows[index - 1].serviceDate < row.serviceDate),
    )
  );
}

function componentsShareAxis(
  components: readonly InvestmentLabAnchorComponentEvidence[],
  actualPath: readonly InvestmentLabActualPathPoint[],
) {
  return (
    components.length > 0 &&
    components.every(
      (component) =>
        component.valuations.length === actualPath.length &&
        component.valuations.every(
          (row, index) => row.serviceDate === actualPath[index].serviceDate,
        ),
    )
  );
}

function unavailable(
  input: Pick<
    Parameters<typeof buildInvestmentLabAnchorScheduledRebalanceScenario>[0],
    "mode" | "anchor"
  >,
  blockers: readonly InvestmentLabAnchorScheduledBlocker[],
  evidenceBlockers: readonly InvestmentLabAnchorEvidenceBlocker[] = [],
): InvestmentLabAnchorScheduledRebalanceScenario {
  return Object.freeze({
    status: "unavailable" as const,
    mode: input.mode,
    policy: INVESTMENT_LAB_ANCHOR_SCHEDULED_REBALANCE_POLICY,
    anchor: input.anchor,
    weights: [] as const,
    summary: null,
    returnEstimate: null,
    rows: [] as const,
    coverage: emptyCoverage(),
    evidenceBlockers: Object.freeze([...evidenceBlockers]),
    blockers: Object.freeze([...blockers]),
  });
}

export function unavailableInvestmentLabAnchorScheduledRebalanceScenario(
  input: Pick<
    InvestmentLabAnchorScheduledRebalanceScenario,
    "mode" | "anchor"
  >,
  reason: "account_composition_incomplete" | "account_composition_mismatch",
  detail: string | null = null,
) {
  return unavailable(input, [blocker(reason, null, detail)]);
}

function emptyCoverage() {
  return Object.freeze({
    componentCount: 0,
    listedComponentCount: 0,
    fixedManualComponentCount: 0,
    sourceFlowCount: 0,
    scenarioFlowLegCount: 0,
    splitExecutionDateRows: 0,
    delayedExecutionLegs: 0,
    pendingComparisonRows: 0,
    rebalanceCount: 0,
    deferredRebalanceCount: 0,
    manualObservationRows: 0,
    manualCarryRows: 0,
  });
}

function blocker(
  reason: InvestmentLabAnchorScheduledBlocker["reason"],
  instrumentKey: string | null = null,
  detail: string | null = null,
) {
  return Object.freeze({ reason, instrumentKey, detail });
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function compensatedSum(values: readonly number[]) {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation +=
      Math.abs(total) >= Math.abs(value)
        ? total - next + value
        : value - next + total;
    total = next;
  }
  return total + compensation;
}

function nearlyEqual(left: number, right: number) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <=
      1e-8 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function nonNegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-6 ? 0 : value;
}
