import type { InvestmentLabAnchorBasketScenario } from "./investment-lab-anchor-basket-scenario.ts";
import type { InvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import type { InvestmentLabScenarioMatrixId } from "./investment-lab-scenario-matrix.ts";

export const INVESTMENT_LAB_SCENARIO_CHART_POLICY = Object.freeze({
  version: "same_axis_available_scenario_paths_v1",
  observedAxisAuthority: "observed_path_service_dates",
  initialAnchorRequirement: "same_scope_adjusted_initial_value",
  yDomain: "single_domain_across_ready_paths",
  missingScenarioHandling: "omit_only_unavailable_scenario",
  interpolation: "forbidden",
  ranking: "forbidden",
} as const);

export type InvestmentLabScenarioChartPoint = Readonly<{
  serviceDate: string;
  valueKrw: number;
  hasPendingExecution: boolean;
}>;

export type InvestmentLabScenarioChartLine = Readonly<{
  id: InvestmentLabScenarioMatrixId;
  label: string;
  color: string;
  points: readonly InvestmentLabScenarioChartPoint[];
}>;

export type InvestmentLabScenarioChart = Readonly<{
  status: "ready" | "partial" | "unavailable";
  policy: typeof INVESTMENT_LAB_SCENARIO_CHART_POLICY;
  period: Readonly<{
    startServiceDate: string;
    endServiceDate: string;
    comparisonDateCount: number;
  }> | null;
  lines: readonly InvestmentLabScenarioChartLine[];
  unavailableScenarioIds: readonly InvestmentLabScenarioMatrixId[];
}>;

const SCENARIOS = Object.freeze([
  "actual",
  "zero_return",
  "kodex200",
  "voo",
  "fixed_mix",
  "anchor_basket",
] as const satisfies readonly InvestmentLabScenarioMatrixId[]);

const COLORS: Readonly<Record<InvestmentLabScenarioMatrixId, string>> = {
  actual: "#173f38",
  zero_return: "#70756d",
  kodex200: "#d75645",
  voo: "#2369a8",
  fixed_mix: "#8b5a9e",
  anchor_basket: "#b47a13",
};

export function buildInvestmentLabScenarioChart(input: Readonly<{
  model: InvestmentLabCounterfactualReadModel;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
}>): InvestmentLabScenarioChart {
  if (input.model.observedPath.status !== "ready") {
    return unavailableChart();
  }

  const observed = input.model.observedPath;
  const axis = observed.rows.map((row) => row.serviceDate);
  const initialAnchorKrw = observed.rows[0].marketValueKrw;
  const chartLine = (
    id: InvestmentLabScenarioMatrixId,
    label: string,
    points: readonly InvestmentLabScenarioChartPoint[],
  ) => line(id, label, axis, initialAnchorKrw, points);
  const candidates = new Map<
    InvestmentLabScenarioMatrixId,
    InvestmentLabScenarioChartLine | null
  >([
    [
      "actual",
      chartLine(
        "actual",
        "실제 포트폴리오",
        observed.rows.map((row) => ({
          serviceDate: row.serviceDate,
          valueKrw: row.marketValueKrw,
          hasPendingExecution: false,
        })),
      ),
    ],
    [
      "zero_return",
      input.model.cashComparison?.status === "ready"
        ? chartLine(
            "zero_return",
            "제로수익 동일흐름",
            input.model.cashComparison.rows.map(toScenarioPoint),
          )
        : null,
    ],
    [
      "kodex200",
      input.model.status === "ready"
        ? chartLine(
            "kodex200",
            "전액 KODEX 200",
            input.model.rows.map(toScenarioPoint),
          )
        : null,
    ],
    [
      "voo",
      input.model.vooComparison?.status === "ready"
        ? chartLine(
            "voo",
            "전액 VOO",
            input.model.vooComparison.rows.map(toScenarioPoint),
          )
        : null,
    ],
    [
      "fixed_mix",
      input.model.fixedMixScenario?.status === "ready"
        ? chartLine(
            "fixed_mix",
            fixedMixLabel(input.model),
            input.model.fixedMixScenario.rows.map(toScenarioPoint),
          )
        : null,
    ],
    [
      "anchor_basket",
      input.anchorBasketScenario.status === "ready"
        ? chartLine(
            "anchor_basket",
            anchorLabel(input.anchorBasketScenario),
            input.anchorBasketScenario.rows.map(toScenarioPoint),
          )
        : null,
    ],
  ]);
  const lines = Object.freeze(
    SCENARIOS.flatMap((id) => {
      const candidate = candidates.get(id);
      return candidate ? [candidate] : [];
    }),
  );
  const unavailableScenarioIds = Object.freeze(
    SCENARIOS.filter((id) => !candidates.get(id)),
  );

  return Object.freeze({
    status:
      lines.length === 0
        ? "unavailable"
        : unavailableScenarioIds.length === 0
          ? "ready"
          : "partial",
    policy: INVESTMENT_LAB_SCENARIO_CHART_POLICY,
    period: Object.freeze({
      startServiceDate: observed.summary.startServiceDate,
      endServiceDate: observed.summary.endServiceDate,
      comparisonDateCount: observed.summary.comparisonDateCount,
    }),
    lines,
    unavailableScenarioIds,
  });
}

function line(
  id: InvestmentLabScenarioMatrixId,
  label: string,
  axis: readonly string[],
  initialAnchorKrw: number,
  points: readonly InvestmentLabScenarioChartPoint[],
) {
  if (
    axis.length < 2 ||
    points.length !== axis.length ||
    !nearlyEqual(points[0]?.valueKrw, initialAnchorKrw) ||
    points.some(
      (point, index) =>
        point.serviceDate !== axis[index] ||
        !Number.isFinite(point.valueKrw) ||
        point.valueKrw < 0,
    )
  ) {
    return null;
  }
  return Object.freeze({
    id,
    label,
    color: COLORS[id],
    points: Object.freeze(points.map((point) => Object.freeze({ ...point }))),
  });
}

function nearlyEqual(left: number | undefined, right: number) {
  return (
    left !== undefined &&
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <=
      1e-8 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function toScenarioPoint(row: Readonly<{
  serviceDate: string;
  scenarioMarketValueKrw: number;
  hasPendingExecution: boolean;
}>): InvestmentLabScenarioChartPoint {
  return Object.freeze({
    serviceDate: row.serviceDate,
    valueKrw: row.scenarioMarketValueKrw,
    hasPendingExecution: row.hasPendingExecution,
  });
}

function fixedMixLabel(model: InvestmentLabCounterfactualReadModel) {
  const weights = model.fixedMixScenario?.weights;
  return weights
    ? `고정혼합 ${weights.kodexWeightBps / 100}:${weights.vooWeightBps / 100}`
    : "고정혼합";
}

function anchorLabel(anchor: InvestmentLabAnchorBasketScenario) {
  return anchor.summary?.allocationBasis ===
    "named_account_equal_weight_then_sum"
    ? "계좌별 동일 비중"
    : "기준일 동일 비중";
}

function unavailableChart(): InvestmentLabScenarioChart {
  return Object.freeze({
    status: "unavailable" as const,
    policy: INVESTMENT_LAB_SCENARIO_CHART_POLICY,
    period: null,
    lines: [] as const,
    unavailableScenarioIds: SCENARIOS,
  });
}
