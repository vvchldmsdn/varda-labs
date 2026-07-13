import { isRiskDate } from "./portfolio-risk-calendar.ts";

export const INVESTMENT_LAB_CONTRIBUTION_EXPERIMENT_POLICY = Object.freeze({
  version: "historical_fixed_scenario_contribution_v1",
  timing: "selected_observed_valuation_boundary",
  actualPathMutation: "forbidden",
  fractionalUnits: true,
  residualCashKrw: 0,
  transactionCostsKrw: 0,
  interpolation: "forbidden",
  latestPriceFallback: "forbidden",
  persistence: "none_client_memory_only",
  targetOrRecommendationAuthority: "excluded",
} as const);

export type InvestmentLabContributionScenarioId = "kodex200" | "voo";

export type InvestmentLabContributionPriceBasis =
  | "adjusted_close_krw"
  | "raw_close_usd_times_stored_snapshot_fx";

export type InvestmentLabContributionScenarioPoint = Readonly<{
  serviceDate: string;
  valuationPriceDate: string;
  unitValueKrw: number;
  baseScenarioValueKrw: number;
}>;

export type InvestmentLabContributionScenarioEvidence = Readonly<{
  scenarioId: InvestmentLabContributionScenarioId;
  priceBasis: InvestmentLabContributionPriceBasis;
  points: readonly InvestmentLabContributionScenarioPoint[];
}>;

export type InvestmentLabContributionExperimentRow = Readonly<{
  serviceDate: string;
  valuationPriceDate: string;
  baseScenarioValueKrw: number;
  additionalValueKrw: number;
  projectedScenarioValueKrw: number;
}>;

export type InvestmentLabContributionExperimentBlocker =
  | "invalid_scenario_evidence"
  | "invalid_contribution_amount"
  | "contribution_date_unavailable"
  | "invalid_calculation_result";

export type InvestmentLabContributionExperimentResult =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_CONTRIBUTION_EXPERIMENT_POLICY;
      scenarioId: InvestmentLabContributionScenarioId;
      priceBasis: InvestmentLabContributionPriceBasis;
      contributionServiceDate: string;
      contributionPriceDate: string;
      endServiceDate: string;
      contributionAmountKrw: number;
      additionalUnits: number;
      baseEndValueKrw: number;
      additionalEndValueKrw: number;
      projectedEndValueKrw: number;
      additionalProfitKrw: number;
      additionalReturn: number;
      rows: readonly InvestmentLabContributionExperimentRow[];
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      policy: typeof INVESTMENT_LAB_CONTRIBUTION_EXPERIMENT_POLICY;
      scenarioId: InvestmentLabContributionScenarioId | null;
      priceBasis: InvestmentLabContributionPriceBasis | null;
      contributionServiceDate: null;
      contributionPriceDate: null;
      endServiceDate: null;
      contributionAmountKrw: null;
      additionalUnits: null;
      baseEndValueKrw: null;
      additionalEndValueKrw: null;
      projectedEndValueKrw: null;
      additionalProfitKrw: null;
      additionalReturn: null;
      rows: readonly [];
      blockers: readonly InvestmentLabContributionExperimentBlocker[];
    }>;

export function createInvestmentLabContributionScenarioEvidence(input: {
  scenarioId: InvestmentLabContributionScenarioId;
  priceBasis: InvestmentLabContributionPriceBasis;
  points: readonly InvestmentLabContributionScenarioPoint[];
}): InvestmentLabContributionScenarioEvidence | null {
  const candidate = {
    scenarioId: input.scenarioId,
    priceBasis: input.priceBasis,
    points: input.points,
  } as const;
  if (!isValidScenarioEvidence(candidate)) return null;

  return Object.freeze({
    scenarioId: candidate.scenarioId,
    priceBasis: candidate.priceBasis,
    points: Object.freeze(
      candidate.points.map((point) => Object.freeze({ ...point })),
    ),
  });
}

export function calculateInvestmentLabContributionExperiment(input: {
  scenario: InvestmentLabContributionScenarioEvidence;
  contributionServiceDate: string;
  contributionAmountKrw: number;
}): InvestmentLabContributionExperimentResult {
  if (!isValidScenarioEvidence(input.scenario)) {
    return blocked("invalid_scenario_evidence");
  }
  if (
    !Number.isSafeInteger(input.contributionAmountKrw) ||
    input.contributionAmountKrw <= 0
  ) {
    return blocked("invalid_contribution_amount", input.scenario);
  }

  const selectedIndex = input.scenario.points.findIndex(
    (point) => point.serviceDate === input.contributionServiceDate,
  );
  if (selectedIndex < 0) {
    return blocked("contribution_date_unavailable", input.scenario);
  }

  const selected = input.scenario.points[selectedIndex];
  const additionalUnits = input.contributionAmountKrw / selected.unitValueKrw;
  if (!positiveFinite(additionalUnits)) {
    return blocked("invalid_calculation_result", input.scenario);
  }

  const rows: InvestmentLabContributionExperimentRow[] = [];
  for (
    let index = selectedIndex;
    index < input.scenario.points.length;
    index += 1
  ) {
    const point = input.scenario.points[index];
    const additionalValueKrw =
      index === selectedIndex
        ? input.contributionAmountKrw
        : additionalUnits * point.unitValueKrw;
    const projectedScenarioValueKrw =
      point.baseScenarioValueKrw + additionalValueKrw;
    if (
      !safeNonnegativeCurrency(additionalValueKrw) ||
      !safeNonnegativeCurrency(projectedScenarioValueKrw)
    ) {
      return blocked("invalid_calculation_result", input.scenario);
    }
    rows.push(
      Object.freeze({
        serviceDate: point.serviceDate,
        valuationPriceDate: point.valuationPriceDate,
        baseScenarioValueKrw: point.baseScenarioValueKrw,
        additionalValueKrw,
        projectedScenarioValueKrw,
      }),
    );
  }

  const latest = rows.at(-1);
  if (!latest) return blocked("invalid_calculation_result", input.scenario);
  const additionalProfitKrw =
    latest.additionalValueKrw - input.contributionAmountKrw;
  const additionalReturn =
    additionalProfitKrw / input.contributionAmountKrw;
  if (
    !Number.isFinite(additionalProfitKrw) ||
    !Number.isFinite(additionalReturn)
  ) {
    return blocked("invalid_calculation_result", input.scenario);
  }

  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_CONTRIBUTION_EXPERIMENT_POLICY,
    scenarioId: input.scenario.scenarioId,
    priceBasis: input.scenario.priceBasis,
    contributionServiceDate: selected.serviceDate,
    contributionPriceDate: selected.valuationPriceDate,
    endServiceDate: latest.serviceDate,
    contributionAmountKrw: input.contributionAmountKrw,
    additionalUnits,
    baseEndValueKrw: latest.baseScenarioValueKrw,
    additionalEndValueKrw: latest.additionalValueKrw,
    projectedEndValueKrw: latest.projectedScenarioValueKrw,
    additionalProfitKrw,
    additionalReturn,
    rows: Object.freeze(rows),
    blockers: [] as const,
  });
}

function isValidScenarioEvidence(
  value: InvestmentLabContributionScenarioEvidence,
) {
  if (
    !expectedPriceBasis(value.scenarioId, value.priceBasis) ||
    value.points.length < 2
  ) {
    return false;
  }

  return value.points.every(
    (point, index) =>
      isRiskDate(point.serviceDate) &&
      isRiskDate(point.valuationPriceDate) &&
      point.valuationPriceDate <= point.serviceDate &&
      positiveFinite(point.unitValueKrw) &&
      safeNonnegativeCurrency(point.baseScenarioValueKrw) &&
      (index === 0 ||
        value.points[index - 1].serviceDate < point.serviceDate),
  );
}

function expectedPriceBasis(
  scenarioId: InvestmentLabContributionScenarioId,
  priceBasis: InvestmentLabContributionPriceBasis,
) {
  return (
    (scenarioId === "kodex200" && priceBasis === "adjusted_close_krw") ||
    (scenarioId === "voo" &&
      priceBasis === "raw_close_usd_times_stored_snapshot_fx")
  );
}

function blocked(
  reason: InvestmentLabContributionExperimentBlocker,
  scenario?: InvestmentLabContributionScenarioEvidence,
): InvestmentLabContributionExperimentResult {
  return Object.freeze({
    status: "blocked",
    policy: INVESTMENT_LAB_CONTRIBUTION_EXPERIMENT_POLICY,
    scenarioId: scenario?.scenarioId ?? null,
    priceBasis: scenario?.priceBasis ?? null,
    contributionServiceDate: null,
    contributionPriceDate: null,
    endServiceDate: null,
    contributionAmountKrw: null,
    additionalUnits: null,
    baseEndValueKrw: null,
    additionalEndValueKrw: null,
    projectedEndValueKrw: null,
    additionalProfitKrw: null,
    additionalReturn: null,
    rows: [] as const,
    blockers: Object.freeze([reason]),
  });
}

function positiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function safeNonnegativeCurrency(value: number) {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}
