import type { InvestmentLabAnchorSelection } from "./investment-lab-anchor-basket-anchor.ts";
import type {
  InvestmentLabAnchorEvidenceBlocker,
  InvestmentLabAnchorEvidenceResolution,
} from "./investment-lab-anchor-basket-evidence.ts";
import type { InvestmentLabActualPathPoint } from "./investment-lab-counterfactual-path.ts";
import {
  calculateInvestmentLabModifiedDietz,
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
  type InvestmentLabReturnFlow,
} from "./investment-lab-modified-dietz.ts";
import {
  buildInvestmentLabUnitPricePath,
  type InvestmentLabUnitPathBlocker,
  type InvestmentLabUnitPathResult,
} from "./investment-lab-unit-price-path.ts";

export type InvestmentLabAnchorAllocationWeight = Readonly<{
  instrumentKey: string;
  weight: number;
}>;

export type InvestmentLabAnchorAllocationBlocker = Readonly<{
  reason:
    | "anchor_selection_unavailable"
    | "evidence_unavailable"
    | "invalid_allocation_weights"
    | "component_path_unavailable"
    | "component_axis_mismatch"
    | "component_flow_mismatch"
    | "invalid_scenario_value"
    | "scenario_return_unavailable"
    | "account_composition_incomplete"
    | "account_composition_mismatch";
  instrumentKey: string | null;
  detail: string | null;
}>;

export type InvestmentLabAnchorAllocationPath = Readonly<{
  status: "ready" | "unavailable";
  anchor: InvestmentLabAnchorSelection;
  summary: Readonly<{
    startServiceDate: string;
    endServiceDate: string;
    instrumentCount: number;
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
  }> | null;
  rows: readonly Readonly<{
    serviceDate: string;
    actualMarketValueKrw: number;
    scenarioMarketValueKrw: number;
    differenceKrw: number;
    hasPendingExecution: boolean;
  }>[];
  coverage: Readonly<{
    componentCount: number;
    sourceFlowCount: number;
    scenarioFlowLegCount: number;
    splitExecutionDateRows: number;
    delayedExecutionLegs: number;
    pendingComparisonRows: number;
    manualValuationComponentCount: number;
    manualObservationRows: number;
    manualCarryRows: number;
  }>;
  evidenceBlockers: readonly InvestmentLabAnchorEvidenceBlocker[];
  blockers: readonly InvestmentLabAnchorAllocationBlocker[];
}>;

export function buildInvestmentLabAnchorAllocationPath(input: Readonly<{
  anchor: InvestmentLabAnchorSelection;
  actualPath: readonly InvestmentLabActualPathPoint[];
  evidence: InvestmentLabAnchorEvidenceResolution | null;
  actualReturn: number | null;
  weights: readonly InvestmentLabAnchorAllocationWeight[];
}>): InvestmentLabAnchorAllocationPath {
  if (input.anchor.status !== "ready") {
    return unavailable(input.anchor, [blocker("anchor_selection_unavailable")]);
  }
  if (input.evidence?.status !== "ready") {
    return unavailable(
      input.anchor,
      [blocker("evidence_unavailable")],
      input.evidence?.blockers ?? [],
    );
  }
  const resolvedAnchor = markManualValuationCoverage(
    input.anchor,
    input.evidence,
  );
  const weights = resolveWeights(input.weights, input.evidence);
  if (!weights) {
    return unavailable(resolvedAnchor, [blocker("invalid_allocation_weights")]);
  }

  const componentPaths = input.evidence.components.map((component) => ({
    instrumentKey: component.instrument.key,
    path: buildInvestmentLabUnitPricePath({
      actualPath: input.actualPath,
      valuations: component.valuations,
      executions: component.executions,
    }),
  }));
  const blockedComponent = componentPaths.find(
    (component) => component.path.status !== "ready",
  );
  if (blockedComponent) {
    return unavailable(resolvedAnchor, [
      blocker(
        "component_path_unavailable",
        blockedComponent.instrumentKey,
        firstPathBlocker(blockedComponent.path),
      ),
    ]);
  }

  const readyPaths = componentPaths as readonly Readonly<{
    instrumentKey: string;
    path: Extract<InvestmentLabUnitPathResult, { status: "ready" }>;
  }>[];
  if (!componentsMatchActualAxis(input.actualPath, readyPaths)) {
    return unavailable(resolvedAnchor, [blocker("component_axis_mismatch")]);
  }

  const flowResolution = resolveWeightedFlows(readyPaths, weights);
  if (!flowResolution) {
    return unavailable(resolvedAnchor, [blocker("component_flow_mismatch")]);
  }

  const rows = input.actualPath.map((actual, index) => {
    const scenarioMarketValueKrw = compensatedSum(
      readyPaths.map(
        (component) =>
          component.path.rows[index].investedMarketValueKrw *
          weights.get(component.instrumentKey)!,
      ),
    );
    return Object.freeze({
      serviceDate: actual.serviceDate,
      actualMarketValueKrw: actual.totalMarketValueKrw,
      scenarioMarketValueKrw,
      differenceKrw: scenarioMarketValueKrw - actual.totalMarketValueKrw,
      hasPendingExecution: readyPaths.some(
        (component) => component.path.rows[index].hasPendingExecution,
      ),
    });
  });
  if (
    rows.some(
      (row) =>
        !Number.isFinite(row.scenarioMarketValueKrw) ||
        row.scenarioMarketValueKrw < 0,
    )
  ) {
    return unavailable(resolvedAnchor, [blocker("invalid_scenario_value")]);
  }

  const scenarioReturn = calculateInvestmentLabModifiedDietz({
    valuations: rows.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row.scenarioMarketValueKrw,
    })),
    flows: flowResolution.scenarioFlows,
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
        })
      : null;

  const latest = rows.at(-1)!;
  return Object.freeze({
    status: "ready",
    anchor: resolvedAnchor,
    summary: Object.freeze({
      startServiceDate: rows[0].serviceDate,
      endServiceDate: latest.serviceDate,
      instrumentCount: readyPaths.length,
      actualEndValueKrw: latest.actualMarketValueKrw,
      scenarioEndValueKrw: latest.scenarioMarketValueKrw,
      endDifferenceKrw: latest.differenceKrw,
      comparisonDateCount: rows.length,
    }),
    returnEstimate,
    rows: Object.freeze(rows),
    coverage: Object.freeze({
      componentCount: readyPaths.length,
      sourceFlowCount: flowResolution.sourceFlowCount,
      scenarioFlowLegCount: flowResolution.scenarioFlows.length,
      splitExecutionDateRows: flowResolution.splitExecutionDateRows,
      delayedExecutionLegs: readyPaths.reduce(
        (sum, component) => sum + component.path.delayedExecutionRows,
        0,
      ),
      pendingComparisonRows: rows.filter((row) => row.hasPendingExecution)
        .length,
      manualValuationComponentCount: input.evidence.components.filter(
        (component) => component.valuationBasis === "stored_manual_valuation",
      ).length,
      manualObservationRows: input.evidence.coverage.manualObservationRows,
      manualCarryRows: input.evidence.coverage.manualCarryRows,
    }),
    evidenceBlockers: [] as const,
    blockers:
      returnEstimate === null
        ? Object.freeze([blocker("scenario_return_unavailable")])
        : ([] as const),
  });
}

function resolveWeights(
  values: readonly InvestmentLabAnchorAllocationWeight[],
  evidence: InvestmentLabAnchorEvidenceResolution,
) {
  if (values.length !== evidence.components.length || values.length === 0) {
    return null;
  }
  const weights = new Map<string, number>();
  for (const row of values) {
    if (
      weights.has(row.instrumentKey) ||
      !Number.isFinite(row.weight) ||
      row.weight < 0 ||
      row.weight > 1
    ) {
      return null;
    }
    weights.set(row.instrumentKey, row.weight);
  }
  if (
    evidence.components.some(
      (component) => !weights.has(component.instrument.key),
    ) ||
    !nearlyEqual(compensatedSum([...weights.values()]), 1)
  ) {
    return null;
  }
  return weights;
}

function componentsMatchActualAxis(
  actualPath: readonly InvestmentLabActualPathPoint[],
  components: readonly Readonly<{
    path: Extract<InvestmentLabUnitPathResult, { status: "ready" }>;
  }>[],
) {
  return (
    actualPath.length >= 2 &&
    components.length > 0 &&
    components.every(
      (component) =>
        component.path.rows.length === actualPath.length &&
        component.path.rows.every(
          (row, index) =>
            row.serviceDate === actualPath[index].serviceDate &&
            nearlyEqual(
              row.actualMarketValueKrw,
              actualPath[index].totalMarketValueKrw,
            ),
        ),
    )
  );
}

function resolveWeightedFlows(
  components: readonly Readonly<{
    instrumentKey: string;
    path: Extract<InvestmentLabUnitPathResult, { status: "ready" }>;
  }>[],
  weights: ReadonlyMap<string, number>,
) {
  const indexed = components.map((component) => {
    const rows = new Map(
      component.path.appliedFlows.map((flow) => [flow.sourceIndex, flow]),
    );
    return rows.size === component.path.appliedFlows.length ? rows : null;
  });
  if (indexed.some((rows) => rows === null)) return null;
  const indexes = indexed as Map<
    number,
    Extract<
      InvestmentLabUnitPathResult,
      { status: "ready" }
    >["appliedFlows"][number]
  >[];
  const sourceIndexes = [...indexes[0].keys()].sort((left, right) => left - right);
  if (indexes.some((rows) => rows.size !== sourceIndexes.length)) return null;

  const scenarioFlows: InvestmentLabReturnFlow[] = [];
  let splitExecutionDateRows = 0;
  for (const sourceIndex of sourceIndexes) {
    const flows = indexes.map((rows) => rows.get(sourceIndex));
    if (flows.some((flow) => flow === undefined)) return null;
    const resolved = flows as NonNullable<(typeof flows)[number]>[];
    const reference = resolved[0];
    if (
      resolved.some(
        (flow) =>
          flow.direction !== reference.direction ||
          !nearlyEqual(flow.amountKrw, reference.amountKrw),
      )
    ) {
      return null;
    }
    if (new Set(resolved.map((flow) => flow.executionServiceDate)).size > 1) {
      splitExecutionDateRows += 1;
    }
    resolved.forEach((flow, componentIndex) => {
      const weight = weights.get(components[componentIndex].instrumentKey)!;
      if (weight === 0) return;
      scenarioFlows.push(
        Object.freeze({
          effectiveServiceDate: flow.executionServiceDate,
          sequence: sourceIndex * components.length + componentIndex,
          direction: flow.direction,
          amountKrw: flow.amountKrw * weight,
        }),
      );
    });
  }
  return Object.freeze({
    sourceFlowCount: sourceIndexes.length,
    splitExecutionDateRows,
    scenarioFlows: Object.freeze(scenarioFlows),
  });
}

function firstPathBlocker(path: InvestmentLabUnitPathResult) {
  if (path.status === "ready") return null;
  const first = path.blockers[0];
  return first ? serializePathBlocker(first) : null;
}

function serializePathBlocker(blockerValue: InvestmentLabUnitPathBlocker) {
  return [
    blockerValue.reason,
    blockerValue.serviceDate,
    blockerValue.sourceIndex,
  ]
    .filter((value) => value !== null)
    .join(":");
}

function blocker(
  reason: InvestmentLabAnchorAllocationBlocker["reason"],
  instrumentKey: string | null = null,
  detail: string | null = null,
) {
  return Object.freeze({ reason, instrumentKey, detail });
}

function unavailable(
  anchor: InvestmentLabAnchorSelection,
  blockers: readonly InvestmentLabAnchorAllocationBlocker[],
  evidenceBlockers: readonly InvestmentLabAnchorEvidenceBlocker[] = [],
): InvestmentLabAnchorAllocationPath {
  return Object.freeze({
    status: "unavailable",
    anchor,
    summary: null,
    returnEstimate: null,
    rows: [] as const,
    coverage: Object.freeze({
      componentCount: 0,
      sourceFlowCount: 0,
      scenarioFlowLegCount: 0,
      splitExecutionDateRows: 0,
      delayedExecutionLegs: 0,
      pendingComparisonRows: 0,
      manualValuationComponentCount: 0,
      manualObservationRows: 0,
      manualCarryRows: 0,
    }),
    evidenceBlockers: Object.freeze([...evidenceBlockers]),
    blockers: Object.freeze([...blockers]),
  });
}

function markManualValuationCoverage(
  anchor: InvestmentLabAnchorSelection,
  evidence: InvestmentLabAnchorEvidenceResolution,
): InvestmentLabAnchorSelection {
  if (
    evidence.status !== "ready" ||
    evidence.coverage.manualObservationRows + evidence.coverage.manualCarryRows ===
      0
  ) {
    return anchor;
  }
  return Object.freeze({
    ...anchor,
    specialHoldingEvidence: Object.freeze(
      anchor.specialHoldingEvidence.map((row) =>
        row.historicalAuthorityOutcome === "manual_valuation_history_required"
          ? Object.freeze({
              ...row,
              historicalCoverageStatus: "covered" as const,
              reason: "stored_manual_valuation_history_covered" as const,
            })
          : row,
      ),
    ),
  });
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
