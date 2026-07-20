import type { InvestmentLabAnchorBasketScenario } from "./investment-lab-anchor-basket-scenario.ts";
import type { InvestmentLabAnchorValueWeightScenario } from "./investment-lab-anchor-value-weight-scenario.ts";
import type { InvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import { INVESTMENT_LAB_MODIFIED_DIETZ_POLICY } from "./investment-lab-modified-dietz.ts";

export const INVESTMENT_LAB_SCENARIO_MATRIX_POLICY = Object.freeze({
  version: "same_period_scenario_comparison_matrix_v1",
  sourceAuthority: "existing_read_models_only",
  periodRequirement: "exact_start_end_and_comparison_date_count",
  unavailableHandling: "preserve_without_partial_substitution",
  ranking: "forbidden",
} as const);

export type InvestmentLabScenarioMatrixId =
  | "actual"
  | "kodex200"
  | "voo"
  | "fixed_mix"
  | "zero_return"
  | "anchor_basket"
  | "anchor_value_weight";

export type InvestmentLabScenarioPriceBasis =
  | "stored_position_market_value"
  | "kodex200_adjusted_close"
  | "voo_raw_close"
  | "kodex_adjusted_and_voo_raw_close"
  | "zero_return_no_price"
  | "anchor_instrument_raw_close"
  | "anchor_instrument_close_and_stored_manual";

export type InvestmentLabScenarioFxBasis =
  | "stored_krw_market_value"
  | "krw_not_applicable"
  | "stored_snapshot_and_execution_usdkrw"
  | "krw_and_stored_usdkrw"
  | "zero_return_not_applicable"
  | "stored_usdkrw_for_usd_legs";

export type InvestmentLabScenarioMatrixRow = Readonly<{
  id: InvestmentLabScenarioMatrixId;
  status: "ready" | "unavailable";
  endValueKrw: number | null;
  endDifferenceKrw: number | null;
  returnEstimate: Readonly<{
    status: "ready" | "unavailable";
    value: number | null;
    method: string | null;
  }>;
  flowCount: number | null;
  pendingComparisonCount: number | null;
  priceBasis: InvestmentLabScenarioPriceBasis;
  fxBasis: InvestmentLabScenarioFxBasis;
  reasonCodes: readonly string[];
}>;

export type InvestmentLabScenarioMatrix = Readonly<{
  status: "ready" | "unavailable";
  policy: typeof INVESTMENT_LAB_SCENARIO_MATRIX_POLICY;
  period: Readonly<{
    startServiceDate: string;
    endServiceDate: string;
    comparisonDateCount: number;
  }> | null;
  rows: readonly InvestmentLabScenarioMatrixRow[];
  coverage: Readonly<{
    rowCount: number;
    readyRowCount: number;
    unavailableRowCount: number;
  }>;
}>;

type Summary = Readonly<{
  startServiceDate: string;
  endServiceDate: string;
  scenarioEndValueKrw: number;
  endDifferenceKrw: number;
  comparisonDateCount: number;
}>;

export function buildInvestmentLabScenarioMatrix(input: Readonly<{
  model: InvestmentLabCounterfactualReadModel;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
}>): InvestmentLabScenarioMatrix {
  const period = resolvePeriod(input.model);
  const rows = period
    ? buildRows(
        input.model,
        input.anchorBasketScenario,
        input.anchorValueWeightScenario,
        period,
      )
    : unavailableRows(
        input.model,
        input.anchorBasketScenario,
        input.anchorValueWeightScenario,
      );
  const readyRowCount = rows.filter((row) => row.status === "ready").length;

  return Object.freeze({
    status: period ? "ready" : "unavailable",
    policy: INVESTMENT_LAB_SCENARIO_MATRIX_POLICY,
    period,
    rows: Object.freeze(rows),
    coverage: Object.freeze({
      rowCount: rows.length,
      readyRowCount,
      unavailableRowCount: rows.length - readyRowCount,
    }),
  });
}

function buildRows(
  model: InvestmentLabCounterfactualReadModel,
  anchor: InvestmentLabAnchorBasketScenario,
  anchorValueWeight: InvestmentLabAnchorValueWeightScenario,
  period: NonNullable<InvestmentLabScenarioMatrix["period"]>,
) {
  const observedSummary = model.observedPath.summary!;
  const actualReturn = readReturn(
    model.observedPath.returnEstimate.status === "ready"
      ? model.observedPath.returnEstimate.actualReturn
      : null,
    model.observedPath.returnEstimate.status === "ready"
      ? model.observedPath.returnEstimate.method.version
      : null,
  );
  const kodexReturn = readReturn(
    model.returnEstimate?.status === "ready"
      ? model.returnEstimate.scenarioReturn
      : null,
    model.returnEstimate?.status === "ready"
      ? model.returnEstimate.method.version
      : null,
  );

  return [
    readyRow({
      id: "actual",
      endValueKrw: observedSummary.endValueKrw,
      endDifferenceKrw: 0,
      returnEstimate: actualReturn,
      flowCount: model.coverage.eligibleFlowRows,
      pendingComparisonCount: null,
      priceBasis: "stored_position_market_value",
      fxBasis: "stored_krw_market_value",
      reasonCodes: returnReasons(
        model.observedPath.returnEstimate.blockers,
      ),
    }),
    scenarioRow({
      id: "zero_return",
      summary: model.cashComparison?.summary ?? null,
      period,
      returnEstimate: readReturn(
        model.cashComparison?.returnComparison?.status === "ready"
          ? model.cashComparison.returnComparison.cashReturn
          : null,
        model.cashComparison?.returnComparison?.status === "ready"
          ? INVESTMENT_LAB_MODIFIED_DIETZ_POLICY.version
          : null,
      ),
      flowCount:
        model.cashComparison?.status === "ready"
          ? model.cashComparison.coverage.appliedFlowRows
          : null,
      pendingComparisonCount:
        model.cashComparison?.status === "ready" ? 0 : null,
      priceBasis: "zero_return_no_price",
      fxBasis: "zero_return_not_applicable",
      sourceReady: model.cashComparison?.status === "ready",
      sourceReasons:
        model.cashComparison?.status === "unavailable"
          ? model.cashComparison.blockers
          : returnReasons(
              model.cashComparison?.returnComparison?.blockers,
            ),
    }),
    scenarioRow({
      id: "kodex200",
      summary: model.summary,
      period,
      returnEstimate: kodexReturn,
      flowCount:
        model.status === "ready" ? model.coverage.appliedFlowRows : null,
      pendingComparisonCount:
        model.status === "ready"
          ? model.coverage.pendingComparisonRows
          : null,
      priceBasis: "kodex200_adjusted_close",
      fxBasis: "krw_not_applicable",
      sourceReady: model.status === "ready" && model.summary !== null,
      sourceReasons:
        model.status === "ready"
          ? returnReasons(model.returnEstimate?.blockers)
          : model.blockers,
    }),
    scenarioRow({
      id: "voo",
      summary: model.vooComparison?.summary ?? null,
      period,
      returnEstimate: readReturn(
        model.vooComparison?.returnEstimate?.status === "ready"
          ? model.vooComparison.returnEstimate.scenarioReturn
          : null,
        model.vooComparison?.returnEstimate?.status === "ready"
          ? model.vooComparison.returnEstimate.method.version
          : null,
      ),
      flowCount:
        model.vooComparison?.status === "ready"
          ? model.vooComparison.coverage.appliedFlowRows
          : null,
      pendingComparisonCount:
        model.vooComparison?.status === "ready"
          ? model.vooComparison.coverage.pendingComparisonRows
          : null,
      priceBasis: "voo_raw_close",
      fxBasis: "stored_snapshot_and_execution_usdkrw",
      sourceReady: model.vooComparison?.status === "ready",
      sourceReasons:
        model.vooComparison?.status === "unavailable"
          ? model.vooComparison.blockers
          : returnReasons(model.vooComparison?.returnEstimate?.blockers),
    }),
    scenarioRow({
      id: "fixed_mix",
      summary: model.fixedMixScenario?.summary ?? null,
      period,
      returnEstimate: readReturn(
        model.fixedMixScenario?.status === "ready"
          ? model.fixedMixScenario.returnEstimate.scenarioReturn
          : null,
        model.fixedMixScenario?.status === "ready"
          ? model.fixedMixScenario.returnEstimate.method.version
          : null,
      ),
      flowCount:
        model.fixedMixScenario?.status === "ready"
          ? model.fixedMixScenario.coverage.componentFlowSourceCount
          : null,
      pendingComparisonCount:
        model.fixedMixScenario?.status === "ready"
          ? model.fixedMixScenario.coverage.pendingComparisonRows
          : null,
      priceBasis: "kodex_adjusted_and_voo_raw_close",
      fxBasis: "krw_and_stored_usdkrw",
      sourceReady: model.fixedMixScenario?.status === "ready",
      sourceReasons:
        model.fixedMixScenario?.status === "unavailable"
          ? model.fixedMixScenario.blockers
          : [],
    }),
    scenarioRow({
      id: "anchor_basket",
      summary: anchor.summary,
      period,
      returnEstimate: readReturn(
        anchor.returnEstimate?.scenarioReturn ?? null,
        anchor.returnEstimate?.method.version ?? null,
      ),
      flowCount:
        anchor.status === "ready" ? anchor.coverage.sourceFlowCount : null,
      pendingComparisonCount:
        anchor.status === "ready"
          ? anchor.coverage.pendingComparisonRows
          : null,
      priceBasis: anchorPriceBasis(anchor),
      fxBasis: "stored_usdkrw_for_usd_legs",
      sourceReady: anchor.status === "ready",
      sourceReasons: anchorReasons(anchor),
    }),
    scenarioRow({
      id: "anchor_value_weight",
      summary: anchorValueWeight.summary,
      period,
      returnEstimate: readReturn(
        anchorValueWeight.returnEstimate?.scenarioReturn ?? null,
        anchorValueWeight.returnEstimate?.method.version ?? null,
      ),
      flowCount:
        anchorValueWeight.status === "ready"
          ? anchorValueWeight.coverage.sourceFlowCount
          : null,
      pendingComparisonCount:
        anchorValueWeight.status === "ready"
          ? anchorValueWeight.coverage.pendingComparisonRows
          : null,
      priceBasis: anchorPriceBasis(anchorValueWeight),
      fxBasis: "stored_usdkrw_for_usd_legs",
      sourceReady: anchorValueWeight.status === "ready",
      sourceReasons: anchorReasons(anchorValueWeight),
    }),
  ];
}

function scenarioRow(input: Readonly<{
  id: Exclude<InvestmentLabScenarioMatrixId, "actual">;
  summary: Summary | null;
  period: NonNullable<InvestmentLabScenarioMatrix["period"]>;
  returnEstimate: InvestmentLabScenarioMatrixRow["returnEstimate"];
  flowCount: number | null;
  pendingComparisonCount: number | null;
  priceBasis: InvestmentLabScenarioPriceBasis;
  fxBasis: InvestmentLabScenarioFxBasis;
  sourceReady: boolean;
  sourceReasons: readonly string[];
}>): InvestmentLabScenarioMatrixRow {
  if (!input.sourceReady || !input.summary) {
    return unavailableRow(input, ["source_unavailable", ...input.sourceReasons]);
  }
  if (!matchesPeriod(input.summary, input.period)) {
    return unavailableRow(input, ["period_mismatch"]);
  }
  return readyRow({
    id: input.id,
    endValueKrw: input.summary.scenarioEndValueKrw,
    endDifferenceKrw: input.summary.endDifferenceKrw,
    returnEstimate: input.returnEstimate,
    flowCount: input.flowCount,
    pendingComparisonCount: input.pendingComparisonCount,
    priceBasis: input.priceBasis,
    fxBasis: input.fxBasis,
    reasonCodes:
      input.returnEstimate.status === "ready"
        ? []
        : ["return_unavailable", ...input.sourceReasons],
  });
}

function readyRow(
  input: Omit<InvestmentLabScenarioMatrixRow, "status">,
): InvestmentLabScenarioMatrixRow {
  return Object.freeze({
    ...input,
    status: "ready" as const,
    reasonCodes: Object.freeze(unique(input.reasonCodes)),
  });
}

function unavailableRow(
  input: Pick<
    InvestmentLabScenarioMatrixRow,
    "id" | "priceBasis" | "fxBasis"
  >,
  reasons: readonly string[],
): InvestmentLabScenarioMatrixRow {
  return Object.freeze({
    ...input,
    status: "unavailable" as const,
    endValueKrw: null,
    endDifferenceKrw: null,
    returnEstimate: readReturn(null, null),
    flowCount: null,
    pendingComparisonCount: null,
    reasonCodes: Object.freeze(unique(reasons)),
  });
}

function unavailableRows(
  model: InvestmentLabCounterfactualReadModel,
  anchor: InvestmentLabAnchorBasketScenario,
  anchorValueWeight: InvestmentLabAnchorValueWeightScenario,
) {
  const reasons = ["base_period_unavailable", ...model.blockers];
  return [
    unavailableRow(
      {
        id: "actual",
        priceBasis: "stored_position_market_value",
        fxBasis: "stored_krw_market_value",
      },
      reasons,
    ),
    unavailableRow(
      {
        id: "zero_return",
        priceBasis: "zero_return_no_price",
        fxBasis: "zero_return_not_applicable",
      },
      reasons,
    ),
    unavailableRow(
      {
        id: "kodex200",
        priceBasis: "kodex200_adjusted_close",
        fxBasis: "krw_not_applicable",
      },
      reasons,
    ),
    unavailableRow(
      {
        id: "voo",
        priceBasis: "voo_raw_close",
        fxBasis: "stored_snapshot_and_execution_usdkrw",
      },
      reasons,
    ),
    unavailableRow(
      {
        id: "fixed_mix",
        priceBasis: "kodex_adjusted_and_voo_raw_close",
        fxBasis: "krw_and_stored_usdkrw",
      },
      reasons,
    ),
    unavailableRow(
      {
        id: "anchor_basket",
        priceBasis: anchorPriceBasis(anchor),
        fxBasis: "stored_usdkrw_for_usd_legs",
      },
      [...reasons, ...anchorReasons(anchor)],
    ),
    unavailableRow(
      {
        id: "anchor_value_weight",
        priceBasis: anchorPriceBasis(anchorValueWeight),
        fxBasis: "stored_usdkrw_for_usd_legs",
      },
      [...reasons, ...anchorReasons(anchorValueWeight)],
    ),
  ];
}

function resolvePeriod(model: InvestmentLabCounterfactualReadModel) {
  if (model.observedPath.status !== "ready") return null;
  const { startServiceDate, endServiceDate, comparisonDateCount } =
    model.observedPath.summary;
  if (
    !startServiceDate ||
    !endServiceDate ||
    startServiceDate > endServiceDate ||
    !Number.isInteger(comparisonDateCount) ||
    comparisonDateCount < 2
  ) {
    return null;
  }
  return Object.freeze({
    startServiceDate,
    endServiceDate,
    comparisonDateCount,
  });
}

function anchorPriceBasis(
  anchor:
    | InvestmentLabAnchorBasketScenario
    | InvestmentLabAnchorValueWeightScenario,
): InvestmentLabScenarioPriceBasis {
  return anchor.anchor.instruments.some(
    (instrument) => instrument.valuationModel === "stored_manual",
  )
    ? "anchor_instrument_close_and_stored_manual"
    : "anchor_instrument_raw_close";
}

function matchesPeriod(
  summary: Summary,
  period: NonNullable<InvestmentLabScenarioMatrix["period"]>,
) {
  return (
    summary.startServiceDate === period.startServiceDate &&
    summary.endServiceDate === period.endServiceDate &&
    summary.comparisonDateCount === period.comparisonDateCount
  );
}

function readReturn(value: number | null, method: string | null) {
  const ready = value !== null && Number.isFinite(value) && Boolean(method);
  return Object.freeze({
    status: ready ? ("ready" as const) : ("unavailable" as const),
    value: ready ? value : null,
    method: ready ? method : null,
  });
}

function returnReasons(values: readonly unknown[] | undefined) {
  return values?.map(String) ?? [];
}

function anchorReasons(
  anchor:
    | InvestmentLabAnchorBasketScenario
    | InvestmentLabAnchorValueWeightScenario,
) {
  return unique([
    ...anchor.anchor.blockers,
    ...anchor.evidenceBlockers.map((row) => row.reason),
    ...anchor.blockers.map((row) => row.reason),
  ]);
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}
